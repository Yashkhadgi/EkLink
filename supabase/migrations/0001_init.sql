-- EkLink: 0001_init.sql

-- 1. profiles
create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  login_id       text not null unique,
  college_email  text not null unique,
  name           text not null,
  role           text not null,
  department     text,
  is_active      boolean not null default true,
  token_version  integer not null default 1,
  failed_logins  integer not null default 0,
  locked_until   timestamptz,
  last_login_at  timestamptz,
  created_at     timestamptz not null default now(),

  constraint profiles_role_check check (role in
    ('student','faculty','staff','hod','director','finance','admin')),
  constraint profiles_login_id_clean check (login_id = btrim(login_id) and length(login_id) > 0),
  constraint profiles_email_lowercase check (college_email = lower(btrim(college_email)))
);

-- 2. apps
create table public.apps (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique,
  name                text not null,
  url                 text not null,
  callback_urls       text[] not null,
  icon                text,
  allowed_roles       text[] not null,
  client_id           text not null unique,
  client_secret_hash  text not null,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),

  constraint apps_slug_clean check (slug = lower(slug) and slug ~ '^[a-z0-9-]+$'),
  constraint apps_callbacks_not_empty check (cardinality(callback_urls) > 0),
  constraint apps_roles_not_empty check (cardinality(allowed_roles) > 0),
  constraint apps_roles_valid check (allowed_roles <@ array
    ['student','faculty','staff','hod','director','finance','admin']::text[])
);

-- 3. auth_codes
create table public.auth_codes (
  code_hash     text primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  app_id        uuid not null references public.apps(id) on delete cascade,
  redirect_uri  text not null,
  expires_at    timestamptz not null,
  used_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index auth_codes_expires_at_idx on public.auth_codes (expires_at);

-- 4. audit_log
create table public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,
  action      text not null,
  target      text,
  ip          inet,
  user_agent  text,
  details     jsonb
);

create index audit_log_at_idx     on public.audit_log (at desc);
create index audit_log_actor_idx  on public.audit_log (actor_id);
create index audit_log_action_idx on public.audit_log (action);

-- 5. Row Level Security
alter table public.profiles   enable row level security;
alter table public.apps       enable row level security;
alter table public.auth_codes enable row level security;
alter table public.audit_log  enable row level security;

revoke all on public.profiles   from anon, authenticated;
revoke all on public.apps       from anon, authenticated;
revoke all on public.auth_codes from anon, authenticated;
revoke all on public.audit_log  from anon, authenticated;

grant select on public.profiles to authenticated;

create policy "profiles: read own row"
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

-- 6. Helper functions (server-only)
create or replace function public.consume_auth_code(
  p_code_hash    text,
  p_app_id       uuid,
  p_redirect_uri text
)
returns table (user_id uuid)
language sql
security definer
set search_path = ''
as $$
  update public.auth_codes
     set used_at = now()
   where code_hash    = p_code_hash
     and app_id       = p_app_id
     and redirect_uri = p_redirect_uri
     and used_at is null
     and expires_at > now()
  returning auth_codes.user_id;
$$;

create or replace function public.record_failed_login(
  p_user_id      uuid,
  p_max_attempts integer default 5,
  p_lock_minutes integer default 15
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles
     set failed_logins = failed_logins + 1,
         locked_until  = case
                           when failed_logins + 1 >= p_max_attempts
                           then now() + make_interval(mins => p_lock_minutes)
                           else locked_until
                         end
   where id = p_user_id;
$$;

create or replace function public.purge_expired_auth_codes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.auth_codes where expires_at < now() - interval '1 day';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.consume_auth_code(text, uuid, text)         from public, anon, authenticated;
revoke all on function public.record_failed_login(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.purge_expired_auth_codes()                  from public, anon, authenticated;

grant execute on function public.consume_auth_code(text, uuid, text)         to service_role;
grant execute on function public.record_failed_login(uuid, integer, integer) to service_role;
grant execute on function public.purge_expired_auth_codes()                  to service_role;