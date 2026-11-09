// scripts/create-staff-users.mjs
// Creates the non-teaching staff accounts from data/staff-accounts-proposed.csv
// (columns: login_id, name, college_email, role, designation, check).
//
//   Dry run (default, creates nothing):  node --env-file=.env scripts/create-staff-users.mjs
//   Create them:                          node --env-file=.env scripts/create-staff-users.mjs --apply
//   Other file:                           ... --file data/other.csv
//
// Rules (same as scripts/import-users.mjs):
//   * never prints names, emails or passwords (counts and login IDs only)
//   * temporary passwords go only to data/temp-passwords-staff-<stamp>.csv (git-ignored, mode 600)
//   * every account must change its password at first login (must_change_password = true)
//   * safe to re-run: people whose login ID or email already exists are skipped
// Placement: institute SIU / SIT, no department (staff are institute-level).
// role = platform_role = member_type = staff; designation from the sheet.
// Afterwards: S007 gets the approver job "Admin Staff" (institute SIU/SIT) unless a current
// Admin Staff job for SIU/SIT already exists.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const DATA_DIR = 'data';
const DEFAULT_FILE = path.join(DATA_DIR, 'staff-accounts-proposed.csv');
const ADMIN_STAFF_LOGIN_ID = 'S007';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// ---------------------------------------------------------------- passwords (as import-users)
const UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const DIGIT = '23456789';
const SYMBOL = '!@#$%&*?';

function generatePassword(length = 12) {
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

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const today = () => new Date().toLocaleDateString('en-CA');

// ---------------------------------------------------------------- csv
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function readStaff(file) {
  if (!fs.existsSync(file)) throw new Error(`file not found: ${file}`);
  const [header, ...lines] = parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const idx = Object.fromEntries(header.map((name, i) => [name.trim().toLowerCase(), i]));
  for (const column of ['login_id', 'name', 'college_email', 'designation']) {
    if (!(column in idx)) throw new Error(`column "${column}" missing in ${file}`);
  }
  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const records = [];
  const problems = [];
  lines.forEach((cells, n) => {
    const rec = {
      row: n + 2,
      loginId: clean(cells[idx.login_id]).toUpperCase(),
      name: clean(cells[idx.name]),
      email: clean(cells[idx.college_email]).toLowerCase(),
      role: clean(cells[idx.role] ?? 'staff').toLowerCase() || 'staff',
      designation: clean(cells[idx.designation]) || null,
    };
    const reason = !rec.loginId ? 'login_id missing'
      : !rec.name ? 'name missing'
      : !EMAIL_RE.test(rec.email) ? 'invalid email'
      : rec.role !== 'staff' ? `role is "${rec.role}", expected staff`
      : rec.designation && rec.designation.length > 128 ? 'designation too long'
      : null;
    if (reason) problems.push({ row: rec.row, loginId: rec.loginId, reason });
    else records.push(rec);
  });
  // duplicates inside the file
  const seen = new Set();
  for (const rec of [...records]) {
    for (const key of [`id:${rec.loginId}`, `email:${rec.email}`]) {
      if (seen.has(key)) {
        problems.push({ row: rec.row, loginId: rec.loginId, reason: 'duplicate in file' });
        records.splice(records.indexOf(rec), 1);
        break;
      }
      seen.add(key);
    }
  }
  return { records, problems };
}

// ---------------------------------------------------------------- database
async function lookupInstitute(admin) {
  const { data: org, error } = await admin.from('organizations').select('id').eq('code', 'SIU').maybeSingle();
  if (error) throw new Error(`could not read organizations (${error.code ?? 'error'})`);
  if (!org) throw new Error('organization SIU not found');
  const { data: inst } = await admin.from('institutes').select('id').eq('organization_id', org.id).eq('code', 'SIT').maybeSingle();
  if (!inst) throw new Error('institute SIU/SIT not found');
  return { orgId: org.id, instId: inst.id };
}

async function existingKeys(admin) {
  const loginIds = new Set();
  const emails = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('profiles').select('login_id, college_email').range(from, from + 999);
    if (error) throw new Error(`could not read profiles (${error.code ?? 'error'})`);
    for (const row of data) {
      loginIds.add(row.login_id.toUpperCase());
      emails.add(row.college_email.toLowerCase());
    }
    if (data.length < 1000) break;
  }
  return { loginIds, emails };
}

async function createOne(admin, rec, placement) {
  const password = generatePassword();
  const created = await admin.auth.admin.createUser({ email: rec.email, password, email_confirm: true });
  if (created.error) return { ok: false, reason: `auth_create_failed:${created.error.status ?? created.error.code ?? 'error'}` };
  const id = created.data.user.id;
  const { error } = await admin.from('profiles').insert({
    id,
    login_id: rec.loginId,
    college_email: rec.email,
    name: rec.name,
    role: 'staff',
    platform_role: 'staff',
    member_type: 'staff',
    designation: rec.designation,
    must_change_password: true,
    organization_id: placement.orgId,
    institute_id: placement.instId,
  });
  if (error) {
    await admin.auth.admin.deleteUser(id);
    return { ok: false, reason: `profile_insert_failed:${error.code ?? 'error'}` };
  }
  return { ok: true, id, password };
}

async function ensureAdminStaffJob(admin, placement, apply) {
  const { data: person } = await admin
    .from('profiles').select('id, is_active').eq('login_id', ADMIN_STAFF_LOGIN_ID).maybeSingle();
  const now = today();
  const { data: jobs, error } = await admin
    .from('approver_assignments')
    .select('id, profile_id')
    .eq('title', 'Admin Staff')
    .eq('scope_level', 'institute')
    .eq('institute_id', placement.instId)
    .lte('valid_from', now)
    .or(`valid_to.is.null,valid_to.gte.${now}`);
  if (error) return `could not read approver jobs (${error.code ?? 'error'})`;
  if (jobs?.length) return `a current Admin Staff job for SIU/SIT already exists${jobs.some((j) => j.profile_id === person?.id) ? ` (${ADMIN_STAFF_LOGIN_ID})` : ''}; not changed`;
  if (!person) return apply ? `${ADMIN_STAFF_LOGIN_ID} not found; Admin Staff job not created` : `would assign Admin Staff (SIU/SIT) to ${ADMIN_STAFF_LOGIN_ID} after creating it`;
  if (!apply) return `would assign Admin Staff (SIU/SIT) to ${ADMIN_STAFF_LOGIN_ID}`;
  const { data: job, error: insertError } = await admin
    .from('approver_assignments')
    .insert({
      profile_id: person.id,
      title: 'Admin Staff',
      scope_level: 'institute',
      organization_id: placement.orgId,
      institute_id: placement.instId,
    })
    .select('id')
    .single();
  if (insertError) return `Admin Staff job FAILED (${insertError.code ?? 'error'})`;
  await admin.from('audit_log').insert({
    action: 'approver_assigned',
    target: job.id,
    details: { person: person.id, login_id: ADMIN_STAFF_LOGIN_ID, title: 'Admin Staff', scope_level: 'institute', source: 'create-staff-users' },
  });
  return `Admin Staff (SIU/SIT) assigned to ${ADMIN_STAFF_LOGIN_ID}`;
}

// ---------------------------------------------------------------- main
function parseArgs(argv) {
  const args = { apply: false, file: DEFAULT_FILE };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') args.apply = true;
    else if (argv[i] === '--file') args.file = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY missing. Run with: node --env-file=.env ...');
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const { records, problems } = readStaff(args.file);
  const placement = await lookupInstitute(admin);
  const existing = await existingKeys(admin);
  const planned = records.filter((rec) => !existing.loginIds.has(rec.loginId) && !existing.emails.has(rec.email));
  const skipped = records.length - planned.length;

  console.log(args.apply ? 'APPLY: creating staff accounts' : 'DRY RUN (add --apply to create)');
  console.log(`rows: ${records.length + problems.length}, valid: ${records.length}, already exist: ${skipped}, to create: ${planned.length}, invalid: ${problems.length}`);
  for (const problem of problems) console.log(`  row ${problem.row} (${problem.loginId || '?'}): ${problem.reason}`);
  console.log('placement: SIU / SIT (no department); role/platform_role/member_type: staff; must change password: yes');

  if (!args.apply) {
    if (planned.length) console.log(`login IDs to create: ${planned.map((rec) => rec.loginId).join(', ')}`);
    console.log(`job: ${await ensureAdminStaffJob(admin, placement, false)}`);
    return;
  }

  let created = 0;
  let failed = 0;
  if (planned.length) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const pwPath = path.join(DATA_DIR, `temp-passwords-staff-${stamp()}.csv`);
    const fd = fs.openSync(pwPath, 'wx', 0o600);
    fs.writeSync(fd, 'login_id,name,college_email,temp_password\n');
    const auditRows = [];
    for (const rec of planned) {
      const res = await createOne(admin, rec, placement);
      if (res.ok) {
        created++;
        fs.writeSync(fd, [rec.loginId, rec.name, rec.email, res.password].map(csvCell).join(',') + '\n');
        auditRows.push({ actor_id: null, action: 'user_created', target: res.id, details: { role: 'staff', platform_role: 'staff', source: 'create-staff-users' } });
      } else {
        failed++;
        console.log(`  ${rec.loginId}: FAILED ${res.reason}`);
      }
    }
    fs.closeSync(fd);
    if (auditRows.length) {
      const { error } = await admin.from('audit_log').insert(auditRows);
      if (error) console.log('! could not write the audit rows');
    }
    console.log(`temporary passwords: ${pwPath} (hand them out, then delete the file)`);
  }

  console.log(`created: ${created}, skipped (already exist): ${skipped}, failed: ${failed}`);
  console.log(`job: ${await ensureAdminStaffJob(admin, placement, true)}`);
  if (created) console.log('The change events are pushed to the apps by the running EkLink server (within 60 s).');
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`create-staff-users: ${error.message}`);
  process.exit(1);
});
