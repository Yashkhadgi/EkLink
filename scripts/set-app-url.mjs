// scripts/set-app-url.mjs
// Points an already-registered EkLink app at a new address (for example the
// EC2 public IP) WITHOUT touching its name, roles, icon or client secret.
//   - `url` (the dashboard card link) is replaced
//   - each --callback is ADDED to callback_urls (existing ones are kept, so
//     localhost sign-in keeps working)
//
// Examples:
//   node --env-file=.env scripts/set-app-url.mjs --list
//   node --env-file=.env scripts/set-app-url.mjs --slug approveit \
//     --url http://1.2.3.4:8002 --callback http://1.2.3.4:8002/auth/callback
//
// Note: the registry lives in EkLink's Supabase project, so every EkLink that
// uses the same Supabase project sees the new card URL.

import { createClient } from '@supabase/supabase-js';

function parseArgs(argv) {
  const args = { callbacks: [], list: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === '--slug') args.slug = next();
    else if (arg === '--url') args.url = next();
    else if (arg === '--callback') args.callbacks.push(next());
    else if (arg === '--list') args.list = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function checkUrl(value, label) {
  try {
    return new URL(value).toString().replace(/\/$/, '');
  } catch {
    throw new Error(`${label} must be a valid URL (got "${value}")`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY missing. Run with: node --env-file=.env ...');
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  if (args.list) {
    const { data, error } = await admin.from('apps').select('slug, url, callback_urls, status, is_active').order('slug');
    if (error) throw new Error(`could not read apps (${error.code ?? error.message})`);
    for (const app of data) {
      console.log(`${app.slug.padEnd(14)} ${app.status}/${app.is_active ? 'active' : 'inactive'}  url=${app.url}`);
      for (const cb of app.callback_urls ?? []) console.log(`${''.padEnd(14)}   callback=${cb}`);
    }
    return;
  }

  if (!args.slug) throw new Error('--slug is required (or use --list)');
  if (!args.url && !args.callbacks.length) throw new Error('give --url and/or --callback');

  const { data: app, error: readError } = await admin
    .from('apps').select('id, url, callback_urls').eq('slug', args.slug).maybeSingle();
  if (readError) throw new Error(`could not read app (${readError.code ?? readError.message})`);
  if (!app) throw new Error(`no app with slug "${args.slug}". Register it first with scripts/register-app.mjs`);

  const updates = {};
  if (args.url) updates.url = checkUrl(args.url, '--url');
  if (args.callbacks.length) {
    const merged = new Set(app.callback_urls ?? []);
    for (const cb of args.callbacks) merged.add(checkUrl(cb, '--callback'));
    updates.callback_urls = [...merged];
  }

  const { error } = await admin.from('apps').update(updates).eq('id', app.id);
  if (error) throw new Error(`could not update app (${error.code ?? error.message})`);
  console.log(`Updated ${args.slug}: url ${app.url} -> ${updates.url ?? app.url}`);
  for (const cb of updates.callback_urls ?? app.callback_urls) console.log(`  callback ${cb}`);
}

main().catch((error) => {
  console.error(`set-app-url: ${error.message}`);
  process.exit(1);
});
