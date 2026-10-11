// scripts/register-app.mjs
// Registers one EkLink client app without printing or storing client secrets
// anywhere except the single create/rotate output.
//
// Example:
//   node --env-file=.env.local scripts/register-app.mjs --slug infivoice --name Infivoice --url http://localhost:3001 --callback http://localhost:3001/auth/callback --roles faculty,staff,hod,director,finance,admin --icon receipt --description "Invoices, reimbursements and finance paperwork"

import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const ROLES = ['student', 'faculty', 'staff', 'hod', 'director', 'finance', 'admin'];
const ROLE_SET = new Set(ROLES);
const STATUSES = new Set(['live', 'coming_soon']);
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function usage() {
  return [
    'Usage:',
    '  node --env-file=.env.local scripts/register-app.mjs \\',
    '    --slug <slug> --name <name> --url <url> --callback <url> \\',
    '    --roles <role[,role...]|all> --icon <icon-name> --description <text> \\',
    '    [--status live|coming_soon] [--rotate-secret]',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    callbacks: [],
    rotateSecret: false,
    status: 'live',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      return value;
    };

    if (arg === '--slug') args.slug = next();
    else if (arg === '--name') args.name = next();
    else if (arg === '--url') args.url = next();
    else if (arg === '--callback') args.callbacks.push(next());
    else if (arg === '--roles') args.roles = next();
    else if (arg === '--icon') args.icon = next();
    else if (arg === '--description') args.description = next();
    else if (arg === '--status') args.status = next();
    else if (arg === '--rotate-secret') args.rotateSecret = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function requireText(args, key) {
  const value = args[key]?.trim();
  if (!value) throw new Error(`--${key} is required`);
  return value;
}

function parseRoles(value) {
  if (value.trim() === 'all') return ROLES;
  const roles = value
    .split(',')
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);

  if (!roles.length) throw new Error('--roles must include at least one role');
  for (const role of roles) {
    if (!ROLE_SET.has(role)) throw new Error(`Unknown role: ${role}`);
  }
  return [...new Set(roles)];
}

function assertUrl(value, label) {
  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
}

function generateSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) throw new Error('Supabase env variables missing. Run with: node --env-file=.env.local ...');

  const slug = requireText(args, 'slug');
  if (!SLUG_RE.test(slug)) throw new Error('--slug must be lowercase letters, numbers and single hyphens');
  const name = requireText(args, 'name');
  const appUrl = assertUrl(requireText(args, 'url'), '--url');
  const icon = requireText(args, 'icon');
  const description = requireText(args, 'description');
  const status = requireText(args, 'status');
  if (!STATUSES.has(status)) throw new Error('--status must be live or coming_soon');
  if (!args.callbacks.length) throw new Error('--callback is required at least once');
  const callbackUrls = args.callbacks.map((callback) => assertUrl(callback, '--callback'));
  const allowedRoles = parseRoles(requireText(args, 'roles'));

  const admin = createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data: existing, error: readError } = await admin
    .from('apps')
    .select('id, client_id, client_secret_hash')
    .eq('slug', slug)
    .maybeSingle();
  if (readError) throw new Error(`could not read app (${readError.code ?? 'error'})`);

  const app = {
    slug,
    name,
    url: appUrl,
    callback_urls: callbackUrls,
    icon,
    allowed_roles: allowedRoles,
    description,
    status,
    is_active: true,
  };

  let clientSecret = null;
  let clientId = existing?.client_id;
  if (!existing) {
    clientSecret = generateSecret();
    clientId = `${slug}_${crypto.randomBytes(6).toString('base64url')}`;
    const { error } = await admin.from('apps').insert({
      ...app,
      client_id: clientId,
      client_secret_hash: hashSecret(clientSecret),
    });
    if (error) throw new Error(`could not create app (${error.code ?? 'error'})`);
  } else {
    const updates = { ...app };
    if (args.rotateSecret) {
      clientSecret = generateSecret();
      updates.client_secret_hash = hashSecret(clientSecret);
    }

    const { error } = await admin.from('apps').update(updates).eq('id', existing.id);
    if (error) throw new Error(`could not update app (${error.code ?? 'error'})`);
  }

  console.log(`Registered app: ${slug}`);
  console.log(`client_id: ${clientId}`);
  if (clientSecret) {
    console.log(`client_secret: ${clientSecret}`);
    console.log('Save this secret now. It cannot be recovered from EkLink.');
  } else {
    console.log('client_secret: unchanged (use --rotate-secret to generate a new one)');
  }
}

main().catch((error) => {
  console.error(error.message);
  console.error(usage());
  process.exit(1);
});
