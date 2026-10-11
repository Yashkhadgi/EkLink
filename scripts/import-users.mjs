// scripts/import-users.mjs
// Creates EkLink accounts from the spreadsheets in data/.
//
//   Dry run (default, creates nothing):  node --env-file=.env.local scripts/import-users.mjs
//   Create 5 accounts from one file:     node --env-file=.env.local scripts/import-users.mjs --apply --limit 5 --file Faculty
//   Create everything:                   node --env-file=.env.local scripts/import-users.mjs --apply
//
// Rules this script follows (see md/rules.md):
//   * never prints names, emails, IDs or passwords to the console
//   * temporary passwords go only to a file in data/ (git-ignored, mode 600)
//   * every account must change its password at first login (must_change_password = true)
//   * safe to re-run: people who already exist are skipped

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';

const DATA_DIR = 'data';
const ROLES = new Set(['student', 'faculty', 'staff', 'hod', 'director', 'finance', 'admin']);
const ROLE_ALIASES = { 'deputy director': 'faculty' }; // not an allowed DB role yet
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CONCURRENCY = 4;

// ---------------------------------------------------------------- passwords
const UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no I, L, O (look-alikes)
const LOWER = 'abcdefghijkmnpqrstuvwxyz'; // no l, o
const DIGIT = '23456789'; // no 0, 1
const SYMBOL = '!@#$%&*?';

export function generatePassword(length = 12) {
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SYMBOL)];
  const all = UPPER + LOWER + DIGIT + SYMBOL;
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// ---------------------------------------------------------------- reading files
function cellText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.text !== undefined) return cellText(v.text);
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if (v.result !== undefined) return cellText(v.result);
    if (v instanceof Date) return v.toISOString();
    return '';
  }
  return String(v);
}
const clean = (v) => cellText(v).replace(/\s+/g, ' ').trim();

async function readSheetRows(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('no worksheet');

  // The real header is within the first few rows (row 1 may be a title like "Table 1").
  let headerRow = 0;
  const headerIdx = {};
  for (let r = 1; r <= Math.min(ws.rowCount, 6) && !headerRow; r++) {
    const names = [];
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, c) => names.push([clean(cell.value).toLowerCase(), c]));
    if (names.some(([n]) => n === 'role')) {
      headerRow = r;
      for (const [n, c] of names) if (!(n in headerIdx)) headerIdx[n] = c;
    }
  }
  if (!headerRow) throw new Error('header row with a "role" column not found');

  const rows = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (c) => (c ? clean(row.getCell(c).value) : '');
    const raw = {
      loginId: get(1), // column A
      name: get(2), // column B
      email: get(3), // column C
      role: get(headerIdx.role),
      batch: get(headerIdx.batch),
      section: get(headerIdx.section),
      department: get(headerIdx.department),
    };
    if (Object.values(raw).every((x) => x === '')) continue; // empty row
    rows.push({ rowNumber: r, raw });
  }
  return rows;
}

function validate(raw) {
  const loginId = raw.loginId;
  const email = raw.email.replace(/\s+/g, '').toLowerCase();
  const roleKey = raw.role.toLowerCase();
  const role = ROLE_ALIASES[roleKey] ?? roleKey;
  const batch = raw.batch || null;
  const section = raw.section ? raw.section.toUpperCase() : null;
  if (!loginId) return { reason: 'missing login_id' };
  if (!raw.name) return { reason: 'missing name' };
  if (!EMAIL_RE.test(email)) return { reason: 'invalid email' };
  if (!ROLES.has(role)) return { reason: 'unknown role' };
  if (batch && !/^\d{4}-\d{2}$/.test(batch)) return { reason: 'invalid batch' };
  if (section && !/^[A-Z]$/.test(section)) return { reason: 'invalid section' };
  return {
    record: { loginId, name: raw.name, email, role, department: raw.department || null, batch, section },
  };
}

// ---------------------------------------------------------------- helpers
function parseArgs(argv) {
  const a = { apply: false, limit: null, file: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') a.apply = true;
    else if (argv[i] === '--limit') a.limit = Number(argv[++i]);
    else if (argv[i] === '--file') a.file = (argv[++i] ?? '').toLowerCase();
  }
  if (a.limit !== null && (!Number.isInteger(a.limit) || a.limit < 1)) throw new Error('--limit must be a positive integer');
  return a;
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

async function fetchExisting(admin) {
  const logins = new Set();
  const emails = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('profiles').select('login_id,college_email').range(from, from + 999);
    if (error) throw new Error(`could not read existing profiles (${error.code ?? 'error'})`);
    for (const p of data) {
      if (p.login_id) logins.add(p.login_id);
      if (p.college_email) emails.add(p.college_email);
    }
    if (data.length < 1000) break;
  }
  return { logins, emails };
}

function assertDataIsGitIgnored() {
  try {
    execSync(`git check-ignore -q ${DATA_DIR}/x.xlsx`, { stdio: 'ignore' });
  } catch {
    throw new Error(`${DATA_DIR}/ is not git-ignored. Add "data/" to .gitignore first. Nothing was created.`);
  }
}

async function withRetry(fn) {
  for (let attempt = 1; ; attempt++) {
    const result = await fn();
    const status = result.error?.status ?? 0;
    const transient = status === 429 || status >= 500 || /fetch failed/i.test(result.error?.message ?? '');
    if (!result.error || !transient || attempt >= 3) return result;
    await new Promise((r) => setTimeout(r, 500 * attempt * attempt));
  }
}

async function createOne(admin, rec) {
  const password = generatePassword();
  const created = await withRetry(() => admin.auth.admin.createUser({ email: rec.email, password, email_confirm: true }));
  if (created.error) return { ok: false, reason: `auth_create_failed:${created.error.status ?? created.error.code ?? 'error'}` };
  const id = created.data.user.id;
  const inserted = await withRetry(() =>
    admin.from('profiles').insert({
      id,
      login_id: rec.loginId,
      college_email: rec.email,
      name: rec.name,
      role: rec.role,
      department: rec.department,
      batch: rec.batch,
      section: rec.section,
      must_change_password: true,
    }),
  );
  if (inserted.error) {
    await admin.auth.admin.deleteUser(id); // never leave an account without a profile
    return { ok: false, reason: `profile_insert_failed:${inserted.error.code ?? 'error'}` };
  }
  return { ok: true, id, password };
}

async function pool(items, size, worker) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await worker(items[next++]);
    }),
  );
}

// ---------------------------------------------------------------- main
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  const haveCreds = Boolean(url && secret);
  if (args.apply && !haveCreds) throw new Error('Supabase env variables missing. Run with: node --env-file=.env.local ...');
  const admin = haveCreds ? createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

  if (!fs.existsSync(DATA_DIR)) throw new Error(`Folder "${DATA_DIR}/" not found. Run this from the project root.`);
  let files = fs.readdirSync(DATA_DIR).filter((f) => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~$')).sort();
  if (args.file) files = files.filter((f) => f.toLowerCase().includes(args.file));
  if (!files.length) throw new Error('No matching .xlsx files in data/.');

  const existing = admin ? await fetchExisting(admin) : null;
  if (!existing) console.log('(no Supabase credentials found: skipping the "already exists" check)');

  const seenLogin = new Set();
  const seenEmail = new Set();
  const report = []; // { file, row, result, reason } (no personal data)
  const toCreate = [];
  const perFile = [];

  for (const file of files) {
    const stats = { file, rows: 0, invalid: 0, duplicate: 0, existing: 0, toCreate: 0 };
    let rows;
    try {
      rows = await readSheetRows(path.join(DATA_DIR, file));
    } catch (e) {
      console.log(`! ${file}: cannot read (${e.message}). Skipped.`);
      continue;
    }
    for (const { rowNumber, raw } of rows) {
      stats.rows++;
      const v = validate(raw);
      if (v.reason) { stats.invalid++; report.push({ file, row: rowNumber, result: 'skipped', reason: v.reason }); continue; }
      const rec = v.record;
      if (seenLogin.has(rec.loginId) || seenEmail.has(rec.email)) {
        stats.duplicate++; report.push({ file, row: rowNumber, result: 'skipped', reason: 'duplicate in files' }); continue;
      }
      seenLogin.add(rec.loginId); seenEmail.add(rec.email);
      if (existing && (existing.logins.has(rec.loginId) || existing.emails.has(rec.email))) {
        stats.existing++; report.push({ file, row: rowNumber, result: 'skipped', reason: 'already exists' }); continue;
      }
      stats.toCreate++;
      toCreate.push({ file, row: rowNumber, rec });
    }
    perFile.push(stats);
  }

  console.log('\nFile summary (counts only):');
  console.table(perFile);
  const totalPlanned = toCreate.length;
  const planned = args.limit ? toCreate.slice(0, args.limit) : toCreate;
  console.log(`Accounts that would be created: ${planned.length}${args.limit ? ` (limited from ${totalPlanned})` : ''}`);

  if (!args.apply) {
    const reportPath = path.join(DATA_DIR, `import-report-${stamp()}.csv`);
    fs.writeFileSync(reportPath, ['file,row,result,reason', ...report.map((r) => [r.file, r.row, r.result, r.reason].map(csvCell).join(','))].join('\n'), { mode: 0o600 });
    console.log(`\nDRY RUN: nothing was created. Skipped rows are listed (row numbers only) in ${reportPath}`);
    console.log('To create accounts add --apply (try --limit 5 first).');
    return;
  }

  assertDataIsGitIgnored();
  if (!planned.length) { console.log('Nothing to create.'); return; }
  if (planned.length > 20) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`\nCreate ${planned.length} accounts in project ${new URL(url).host}? Type IMPORT to continue: `);
    rl.close();
    if (answer.trim() !== 'IMPORT') { console.log('Cancelled. Nothing was created.'); return; }
  }

  const pwPath = path.join(DATA_DIR, `temp-passwords-${stamp()}.csv`);
  const fd = fs.openSync(pwPath, 'wx', 0o600);
  fs.writeSync(fd, 'login_id,name,college_email,temp_password\n');

  const auditRows = [];
  let created = 0, failed = 0, done = 0;
  await pool(planned, CONCURRENCY, async ({ file, row, rec }) => {
    const res = await createOne(admin, rec);
    if (res.ok) {
      created++;
      fs.writeSync(fd, [rec.loginId, rec.name, rec.email, res.password].map(csvCell).join(',') + '\n');
      auditRows.push({ actor_id: null, action: 'user_created', target: res.id, details: { source: 'import-script' } });
      report.push({ file, row, result: 'created', reason: '' });
    } else {
      failed++;
      report.push({ file, row, result: 'failed', reason: res.reason });
    }
    if (++done % 50 === 0) console.log(`  ...${done}/${planned.length}`);
  });
  fs.closeSync(fd);

  for (let i = 0; i < auditRows.length; i += 200) {
    const { error } = await admin.from('audit_log').insert(auditRows.slice(i, i + 200));
    if (error) { console.log('! could not write some audit rows'); break; }
  }

  const reportPath = path.join(DATA_DIR, `import-report-${stamp()}.csv`);
  fs.writeFileSync(reportPath, ['file,row,result,reason', ...report.map((r) => [r.file, r.row, r.result, r.reason].map(csvCell).join(','))].join('\n'), { mode: 0o600 });

  console.log(`\nDone. Created: ${created}. Failed: ${failed}.`);
  console.log(`Temporary passwords: ${pwPath}  (keep private; hand over securely; delete when done)`);
  console.log(`Report (row numbers only): ${reportPath}`);
  if (failed) console.log('Fix the failed rows (see report) and run again: existing accounts are skipped.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(`\nERROR: ${e.message}`); process.exit(1); });
}
