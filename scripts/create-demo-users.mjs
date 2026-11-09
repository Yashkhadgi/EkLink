// scripts/create-demo-users.mjs
// Creates the 7 TemplateOS demo accounts in EkLink (SYNC_CONTRACT.md section 8), in the
// demo directory DEMO / DEMO-INST / {CS, ACAD} that migration 0006 created.
//
//   Dry run (default, changes nothing):  node --env-file=.env scripts/create-demo-users.mjs
//   Create them:                          node --env-file=.env scripts/create-demo-users.mjs --apply
//   Other TemplateOS env file:            ... --templateos-env ../TemplateOS/.env
//
// Emails and passwords come from TemplateOS/.env (SIT_<ROLE>_EMAIL / SIT_<ROLE>_PASSWORD), so
// the demo users sign in with the same credentials everywhere. Passwords are never printed.
// Accounts are is_demo = true and must_change_password = false. People that already exist
// (same login ID or email) are skipped, so the script is safe to re-run.

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const DEMO_USERS = [
  { env: 'SIT_SUPER_ADMIN', login_id: 'DEMO-SUPER', name: 'Demo Super Admin', role: 'admin', platform_role: 'super_admin', member_type: null, dept: null, orgOnly: true },
  { env: 'SIT_ORG_ADMIN', login_id: 'DEMO-ORG', name: 'Demo Organization Admin', role: 'admin', platform_role: 'org_admin', member_type: null, dept: null, orgOnly: true },
  { env: 'SIT_DEPARTMENT_ADMIN', login_id: 'DEMO-DEPT', name: 'Demo Department Admin', role: 'admin', platform_role: 'department_admin', member_type: 'faculty', dept: 'CS' },
  { env: 'SIT_FACULTY', login_id: 'DEMO-FAC', name: 'Demo Faculty', role: 'faculty', platform_role: 'faculty', member_type: null, dept: 'CS' },
  { env: 'SIT_STUDENT', login_id: 'DEMO-STU', name: 'Demo Student', role: 'student', platform_role: 'student', member_type: null, dept: 'CS' },
  { env: 'SIT_APPROVER', login_id: 'DEMO-APPR', name: 'Demo Approver', role: 'staff', platform_role: 'staff', member_type: null, dept: 'ACAD', job: 'Other' },
  { env: 'SIT_NORMAL_USER', login_id: 'DEMO-USER', name: 'Demo User', role: 'staff', platform_role: 'staff', member_type: null, dept: 'ACAD' },
];

function parseArgs(argv) {
  const args = { apply: false, templateosEnv: path.resolve(process.cwd(), '..', 'TemplateOS', '.env') };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--templateos-env') args.templateosEnv = path.resolve(argv[++i] ?? '');
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function readEnvFile(file) {
  if (!fs.existsSync(file)) throw new Error(`TemplateOS env file not found: ${file}`);
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

async function lookupDirectory(admin) {
  const { data: org, error: orgError } = await admin.from('organizations').select('id').eq('code', 'DEMO').maybeSingle();
  if (orgError) throw new Error(`could not read organizations (${orgError.code ?? 'error'})`);
  if (!org) throw new Error('Demo organization DEMO not found. Apply supabase/migrations/0006_sync.sql first.');
  const { data: inst } = await admin.from('institutes').select('id').eq('organization_id', org.id).eq('code', 'DEMO-INST').maybeSingle();
  if (!inst) throw new Error('Demo institute DEMO-INST not found. Apply 0006_sync.sql first.');
  const { data: depts } = await admin.from('departments').select('id, code').eq('institute_id', inst.id);
  const byCode = Object.fromEntries((depts ?? []).map((dept) => [dept.code, dept.id]));
  for (const code of ['CS', 'ACAD']) if (!byCode[code]) throw new Error(`Demo department ${code} not found.`);
  return { orgId: org.id, instId: inst.id, deptIds: byCode };
}

async function findAuthUserId(admin, email) {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`could not list auth users (${error.status ?? error.code ?? 'error'})`);
    const hit = data.users.find((user) => user.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY missing. Run with: node --env-file=.env ...');
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const tEnv = readEnvFile(args.templateosEnv);
  const directory = await lookupDirectory(admin);
  console.log(args.apply ? 'APPLY: creating demo users' : 'DRY RUN (add --apply to create)');

  let created = 0;
  let skipped = 0;
  let failed = 0;
  for (const user of DEMO_USERS) {
    const email = (tEnv[`${user.env}_EMAIL`] ?? '').trim().toLowerCase();
    const password = tEnv[`${user.env}_PASSWORD`] ?? '';
    const label = `${user.login_id.padEnd(11)} ${user.platform_role.padEnd(17)}`;
    if (!email || !password) {
      console.log(`${label} SKIP: ${user.env}_EMAIL / ${user.env}_PASSWORD missing in TemplateOS env`);
      failed++;
      continue;
    }

    const [{ data: byLogin }, { data: byEmail }] = await Promise.all([
      admin.from('profiles').select('id').eq('login_id', user.login_id).maybeSingle(),
      admin.from('profiles').select('id').eq('college_email', email).maybeSingle(),
    ]);
    if (byLogin || byEmail) {
      console.log(`${label} exists, skipped`);
      skipped++;
      continue;
    }

    const placement = user.orgOnly
      ? { organization_id: directory.orgId }
      : { department_id: directory.deptIds[user.dept] };
    const where = user.orgOnly ? 'DEMO' : `DEMO/DEMO-INST/${user.dept}`;

    if (!args.apply) {
      console.log(`${label} would create (${email}, ${where}${user.job ? `, job ${user.job}` : ''})`);
      continue;
    }

    let userId = null;
    const createdAuth = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (createdAuth.error) {
      // An auth user without a profile (e.g. an earlier half-finished run) is reused.
      const existingId = await findAuthUserId(admin, email);
      if (!existingId) {
        console.log(`${label} FAILED: auth user (${createdAuth.error.status ?? createdAuth.error.code ?? 'error'}: ${createdAuth.error.message})`);
        failed++;
        continue;
      }
      const updated = await admin.auth.admin.updateUserById(existingId, { password, email_confirm: true });
      if (updated.error) {
        console.log(`${label} FAILED: could not update existing auth user (${updated.error.status ?? 'error'})`);
        failed++;
        continue;
      }
      userId = existingId;
    } else {
      userId = createdAuth.data.user.id;
    }

    const { error: profileError } = await admin.from('profiles').insert({
      id: userId,
      login_id: user.login_id,
      college_email: email,
      name: user.name,
      role: user.role,
      platform_role: user.platform_role,
      member_type: user.member_type,
      is_demo: true,
      must_change_password: false,
      ...placement,
    });
    if (profileError) {
      if (!createdAuth.error) await admin.auth.admin.deleteUser(userId);
      console.log(`${label} FAILED: profile (${profileError.code ?? 'error'})`);
      failed++;
      continue;
    }

    if (user.job) {
      const { error: jobError } = await admin.from('approver_assignments').insert({
        profile_id: userId,
        title: user.job,
        scope_level: 'department',
        organization_id: directory.orgId,
        institute_id: directory.instId,
        department_id: directory.deptIds[user.dept],
      });
      if (jobError) console.log(`${label} created, but approver job failed (${jobError.code ?? 'error'})`);
    }

    await admin.from('audit_log').insert({
      action: 'user_created',
      target: userId,
      details: { role: user.role, platform_role: user.platform_role, source: 'create-demo-users', is_demo: true },
    });
    console.log(`${label} created (${where}${user.job ? `, job ${user.job}` : ''})`);
    created++;
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped, ${failed} failed.`);
  if (created) console.log('The change events are pushed to the apps by the running EkLink server (within 60 s).');
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`create-demo-users: ${error.message}`);
  process.exit(1);
});
