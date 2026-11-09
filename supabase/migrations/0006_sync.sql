-- 0006_sync.sql
--
-- EkLink becomes the source of truth that TemplateOS and ApproveIt mirror
-- (SYNC_CONTRACT.md section 3). Purely additive:
--   * new columns on profiles / directory tables / apps;
--   * new tables approver_assignments, change_events, event_deliveries;
--   * triggers that write one change_events row (+ one event_deliveries row per
--     active app with a sync_url) for every real change;
--   * login_id is locked; public.rename_login_id() is the only way to change it.
-- Existing rows get no events: adding columns does not fire the triggers, and apps
-- start with a full snapshot (/api/sync/snapshot) anyway.
-- Rollback: supabase/rollback/0006_sync_down.sql

begin;

-- ---------------------------------------------------------------- columns
alter table public.profiles
  add column member_type    text,
  add column is_demo        boolean not null default false,
  add column updated_at     timestamptz not null default now(),
  add column deactivated_at timestamptz;

alter table public.profiles
  add constraint profiles_member_type_check check (member_type is null or member_type in ('faculty','staff','student'));

alter table public.organizations
  add column is_demo    boolean not null default false,
  add column updated_at timestamptz not null default now();
alter table public.institutes
  add column is_demo    boolean not null default false,
  add column updated_at timestamptz not null default now();
alter table public.departments
  add column is_demo    boolean not null default false,
  add column updated_at timestamptz not null default now();

alter table public.organizations add constraint organizations_code_length check (length(code) <= 32);
alter table public.institutes    add constraint institutes_code_length    check (length(code) <= 32);
alter table public.departments   add constraint departments_code_length   check (length(code) <= 32);

alter table public.apps
  add column allowed_platform_roles text[],
  add column sync_url               text;

alter table public.apps
  add constraint apps_platform_roles_valid check (allowed_platform_roles is null or allowed_platform_roles <@ array
    ['super_admin','org_admin','institute_admin','department_admin','faculty','staff','student']::text[]),
  add constraint apps_sync_url_http check (sync_url is null or sync_url ~ '^https?://');

-- ---------------------------------------------------------------- new tables
create table public.approver_assignments (
  id               uuid primary key default gen_random_uuid(),
  profile_id       uuid not null references public.profiles(id) on delete restrict,
  title            text not null,
  scope_level      text not null,
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  institute_id     uuid references public.institutes(id) on delete restrict,
  department_id    uuid references public.departments(id) on delete restrict,
  scope_key        text,
  valid_from       date not null default current_date,
  valid_to         date,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint approver_assignments_title_check check (title in
    ('HOD','Director','Dean','Class Teacher','Mentor','Course Faculty','Exam Cell','Admin Staff','Event In-charge','Other')),
  constraint approver_assignments_scope_level_check check (scope_level in ('organization','institute','department')),
  constraint approver_assignments_scope_shape check (
       (scope_level = 'organization' and institute_id is null     and department_id is null)
    or (scope_level = 'institute'    and institute_id is not null and department_id is null)
    or (scope_level = 'department'   and institute_id is not null and department_id is not null)),
  constraint approver_assignments_scope_key_length check (scope_key is null or (length(scope_key) between 1 and 64)),
  -- valid_to is the last day of the job; ending a job on its first day gives valid_from - 1.
  constraint approver_assignments_dates check (valid_to is null or valid_to >= valid_from - 1)
);

create index approver_assignments_profile_idx on public.approver_assignments (profile_id);
create index approver_assignments_dept_idx    on public.approver_assignments (department_id);
create index approver_assignments_inst_idx    on public.approver_assignments (institute_id);

create table public.change_events (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  type        text not null,
  entity_key  text not null,
  data        jsonb not null
);

create table public.event_deliveries (
  id               bigint generated always as identity primary key,
  event_id         bigint not null references public.change_events(id) on delete cascade,
  app_id           uuid not null references public.apps(id) on delete cascade,
  status           text not null default 'pending',
  attempts         integer not null default 0,
  last_error       text,
  next_attempt_at  timestamptz default now(),
  delivered_at     timestamptz,
  constraint event_deliveries_status_check check (status in ('pending','delivered','failed')),
  constraint event_deliveries_event_app_unique unique (event_id, app_id)
);

create index event_deliveries_app_status_idx on public.event_deliveries (app_id, status, event_id);

alter table public.approver_assignments enable row level security;
alter table public.change_events        enable row level security;
alter table public.event_deliveries     enable row level security;
revoke all on public.approver_assignments from anon, authenticated;
revoke all on public.change_events        from anon, authenticated;
revoke all on public.event_deliveries     from anon, authenticated;

-- ---------------------------------------------------------------- payload builders
create or replace function public.sync_member_type(p_platform_role text, p_role text, p_stored text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when p_platform_role in ('faculty','staff','student') then p_platform_role
           when p_stored is not null then p_stored
           else case p_role
                  when 'student'  then 'student'
                  when 'faculty'  then 'faculty'
                  when 'hod'      then 'faculty'
                  when 'director' then 'faculty'
                  when 'staff'    then 'staff'
                  when 'finance'  then 'staff'
                  else null
                end
         end;
$$;

create or replace function public.sync_person_payload(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'sub',             p.id,
           'login_id',        p.login_id,
           'email',           p.college_email,
           'name',            p.name,
           'role',            p.role,
           'platform_role',   p.platform_role,
           'member_type',     public.sync_member_type(p.platform_role, p.role, p.member_type),
           'org_code',        o.code,
           'institute_code',  i.code,
           'department_code', d.code,
           'batch',           p.batch,
           'section',         p.section,
           'semester',        p.semester,
           'designation',     p.designation,
           'is_active',       p.is_active,
           'is_demo',         p.is_demo)
    from public.profiles p
    left join public.organizations o on o.id = p.organization_id
    left join public.institutes    i on i.id = p.institute_id
    left join public.departments   d on d.id = p.department_id
   where p.id = p_id;
$$;

create or replace function public.sync_directory_payload(p_level text, p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case p_level
    when 'organization' then (
      select jsonb_build_object('level','organization','code',o.code,'name',o.name,
                                'org_code',o.code,'institute_code',null,
                                'is_active',o.is_active,'is_demo',o.is_demo)
        from public.organizations o where o.id = p_id)
    when 'institute' then (
      select jsonb_build_object('level','institute','code',i.code,'name',i.name,
                                'org_code',o.code,'institute_code',i.code,
                                'is_active',i.is_active,'is_demo',i.is_demo)
        from public.institutes i join public.organizations o on o.id = i.organization_id
       where i.id = p_id)
    when 'department' then (
      select jsonb_build_object('level','department','code',d.code,'name',d.name,
                                'org_code',o.code,'institute_code',i.code,
                                'is_active',d.is_active,'is_demo',d.is_demo)
        from public.departments d
        join public.institutes i on i.id = d.institute_id
        join public.organizations o on o.id = i.organization_id
       where d.id = p_id)
  end;
$$;

create or replace function public.sync_approver_payload(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'id',              a.id,
           'person_sub',      a.profile_id,
           'login_id',        p.login_id,
           'title',           a.title,
           'scope_level',     a.scope_level,
           'org_code',        o.code,
           'institute_code',  i.code,
           'department_code', d.code,
           'scope_key',       a.scope_key,
           'valid_from',      to_char(a.valid_from, 'YYYY-MM-DD'),
           'valid_to',        to_char(a.valid_to, 'YYYY-MM-DD'))
    from public.approver_assignments a
    join public.profiles p on p.id = a.profile_id
    join public.organizations o on o.id = a.organization_id
    left join public.institutes  i on i.id = a.institute_id
    left join public.departments d on d.id = a.department_id
   where a.id = p_id;
$$;

-- One event + one delivery per active app that receives pushes. The advisory lock
-- (held until commit) makes event ids commit in ascending order, so an app that
-- skips ids <= its last_event_id never skips an event committed later.
create or replace function public.sync_emit(p_type text, p_key text, p_data jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  perform pg_advisory_xact_lock(7340006);
  insert into public.change_events (type, entity_key, data)
  values (p_type, p_key, p_data)
  returning id into v_id;

  insert into public.event_deliveries (event_id, app_id, status, next_attempt_at)
  select v_id, a.id, 'pending', now()
    from public.apps a
   where a.is_active and a.sync_url is not null;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------- triggers: updated_at
create or replace function public.sync_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger organizations_touch_updated_at before update on public.organizations
  for each row execute function public.sync_touch_updated_at();
create trigger institutes_touch_updated_at before update on public.institutes
  for each row execute function public.sync_touch_updated_at();
create trigger departments_touch_updated_at before update on public.departments
  for each row execute function public.sync_touch_updated_at();
create trigger approver_assignments_touch_updated_at before update on public.approver_assignments
  for each row execute function public.sync_touch_updated_at();

create or replace function public.profiles_sync_before()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  if new.is_active then
    new.deactivated_at := null;
  elsif tg_op = 'INSERT' or old.is_active then
    new.deactivated_at := coalesce(new.deactivated_at, now());
  end if;
  return new;
end;
$$;

create trigger profiles_sync_before before insert or update on public.profiles
  for each row execute function public.profiles_sync_before();

-- ---------------------------------------------------------------- triggers: login_id lock
create or replace function public.profiles_login_id_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.login_id is distinct from old.login_id
     and coalesce(current_setting('eklink.allow_login_id_change', true), 'off') <> 'on' then
    raise exception 'login_id is locked; use public.rename_login_id()'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_login_id_lock before update of login_id on public.profiles
  for each row execute function public.profiles_login_id_lock();

create or replace function public.rename_login_id(p_sub uuid, p_new text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
  v_new text := btrim(coalesce(p_new, ''));
begin
  if v_new = '' or length(v_new) > 128 then
    raise exception 'invalid login_id' using errcode = '22023';
  end if;
  select login_id into v_old from public.profiles where id = p_sub for update;
  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  if v_old = v_new then
    return;
  end if;
  if exists (select 1 from public.profiles where login_id = v_new) then
    raise exception 'login_id already in use' using errcode = '23505';
  end if;

  perform public.sync_emit('person.login_id_changed', 'person:' || p_sub,
    jsonb_build_object('sub', p_sub, 'old_login_id', v_old, 'new_login_id', v_new));

  perform set_config('eklink.allow_login_id_change', 'on', true);
  update public.profiles set login_id = v_new where id = p_sub;
  perform set_config('eklink.allow_login_id_change', 'off', true);
end;
$$;

-- ---------------------------------------------------------------- triggers: events
create or replace function public.profiles_sync_emit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Sign-in bookkeeping (last_login_at, failed_logins, token_version, ...) is not
  -- part of the person object, so it does not produce an event.
  if tg_op = 'UPDATE' and
     (old.login_id, old.college_email, old.name, old.role, old.platform_role, old.member_type,
      old.organization_id, old.institute_id, old.department_id, old.batch, old.section,
      old.semester, old.designation, old.is_active, old.is_demo)
     is not distinct from
     (new.login_id, new.college_email, new.name, new.role, new.platform_role, new.member_type,
      new.organization_id, new.institute_id, new.department_id, new.batch, new.section,
      new.semester, new.designation, new.is_active, new.is_demo) then
    return null;
  end if;
  perform public.sync_emit('person.upserted', 'person:' || new.id, public.sync_person_payload(new.id));
  return null;
end;
$$;

create trigger profiles_sync_emit after insert or update on public.profiles
  for each row execute function public.profiles_sync_emit();

create or replace function public.directory_sync_emit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level text := tg_argv[0];
  v_data  jsonb;
  v_key   text;
begin
  if tg_op = 'UPDATE' and
     (to_jsonb(old) - 'updated_at' - 'created_at') = (to_jsonb(new) - 'updated_at' - 'created_at') then
    return null;
  end if;
  v_data := public.sync_directory_payload(v_level, new.id);
  v_key := v_level || ':' || concat_ws('/', v_data->>'org_code',
             case when v_level = 'organization' then null else v_data->>'institute_code' end,
             case when v_level = 'department' then v_data->>'code' else null end);
  perform public.sync_emit('directory.upserted', v_key, v_data);
  return null;
end;
$$;

create trigger organizations_sync_emit after insert or update on public.organizations
  for each row execute function public.directory_sync_emit('organization');
create trigger institutes_sync_emit after insert or update on public.institutes
  for each row execute function public.directory_sync_emit('institute');
create trigger departments_sync_emit after insert or update on public.departments
  for each row execute function public.directory_sync_emit('department');

-- Approver placement: a department implies its institute and organization.
create or replace function public.approver_assignments_placement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_inst uuid;
  v_org  uuid;
begin
  if new.department_id is not null then
    select d.institute_id into v_inst from public.departments d where d.id = new.department_id;
    if new.institute_id is not null and new.institute_id <> v_inst then
      raise exception 'department is not in that institute' using errcode = '23514';
    end if;
    new.institute_id := v_inst;
  end if;
  if new.institute_id is not null then
    select i.organization_id into v_org from public.institutes i where i.id = new.institute_id;
    if new.organization_id is not null and new.organization_id <> v_org then
      raise exception 'institute is not in that organization' using errcode = '23514';
    end if;
    new.organization_id := v_org;
  end if;
  if new.scope_key is not null then
    new.scope_key := nullif(btrim(new.scope_key), '');
  end if;
  return new;
end;
$$;

create trigger approver_assignments_placement before insert or update on public.approver_assignments
  for each row execute function public.approver_assignments_placement();

create or replace function public.approver_assignments_sync_emit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and
     (to_jsonb(old) - 'updated_at') = (to_jsonb(new) - 'updated_at') then
    return null;
  end if;
  perform public.sync_emit('approver.upserted', 'approver:' || new.id, public.sync_approver_payload(new.id));
  return null;
end;
$$;

create trigger approver_assignments_sync_emit after insert or update on public.approver_assignments
  for each row execute function public.approver_assignments_sync_emit();

-- ---------------------------------------------------------------- dispatcher helpers
-- Next batch for one app, in ascending event id. Empty while the oldest undelivered
-- event is a failure that is not due yet (order is never broken).
create or replace function public.sync_next_batch(p_app_id uuid, p_limit integer default 100)
returns table (delivery_id bigint, event_id bigint, type text, at timestamptz, data jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_head record;
begin
  select d.status, d.next_attempt_at into v_head
    from public.event_deliveries d
   where d.app_id = p_app_id and d.status <> 'delivered'
   order by d.event_id
   limit 1;
  if not found or (v_head.status = 'failed' and v_head.next_attempt_at > now()) then
    return;
  end if;
  return query
    select d.id, e.id, e.type, e.at, e.data
      from public.event_deliveries d
      join public.change_events e on e.id = d.event_id
     where d.app_id = p_app_id and d.status <> 'delivered'
     order by d.event_id
     limit least(greatest(coalesce(p_limit, 100), 1), 100);
end;
$$;

create or replace function public.sync_mark_delivered(p_ids bigint[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.event_deliveries
     set status = 'delivered', delivered_at = now(), attempts = attempts + 1,
         last_error = null, next_attempt_at = null
   where id = any(p_ids);
$$;

-- Backoff: 1, 5, 15, 60 minutes, then hourly.
create or replace function public.sync_mark_failed(p_ids bigint[], p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.event_deliveries
     set status = 'failed',
         attempts = attempts + 1,
         last_error = left(p_error, 1000),
         next_attempt_at = now() + case attempts + 1
                                     when 1 then interval '1 minute'
                                     when 2 then interval '5 minutes'
                                     when 3 then interval '15 minutes'
                                     else interval '60 minutes'
                                   end
   where id = any(p_ids);
$$;

-- Full current state in one consistent read.
create or replace function public.sync_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'last_event_id', coalesce((select max(id) from public.change_events), 0),
    'directory', coalesce((
       select jsonb_agg(x.data order by x.ord, x.k)
         from (select 1 as ord, o.code as k, public.sync_directory_payload('organization', o.id) as data
                 from public.organizations o
               union all
               select 2, o.code || '/' || i.code, public.sync_directory_payload('institute', i.id)
                 from public.institutes i join public.organizations o on o.id = i.organization_id
               union all
               select 3, o.code || '/' || i.code || '/' || d.code, public.sync_directory_payload('department', d.id)
                 from public.departments d
                 join public.institutes i on i.id = d.institute_id
                 join public.organizations o on o.id = i.organization_id) x), '[]'::jsonb),
    'people', coalesce((
       select jsonb_agg(public.sync_person_payload(p.id) order by p.login_id)
         from public.profiles p), '[]'::jsonb),
    'approvers', coalesce((
       select jsonb_agg(public.sync_approver_payload(a.id) order by a.created_at, a.id)
         from public.approver_assignments a), '[]'::jsonb));
$$;

-- ---------------------------------------------------------------- function privileges
revoke all on function public.sync_member_type(text, text, text)          from public, anon, authenticated;
revoke all on function public.sync_person_payload(uuid)                   from public, anon, authenticated;
revoke all on function public.sync_directory_payload(text, uuid)          from public, anon, authenticated;
revoke all on function public.sync_approver_payload(uuid)                 from public, anon, authenticated;
revoke all on function public.sync_emit(text, text, jsonb)                from public, anon, authenticated;
revoke all on function public.sync_touch_updated_at()                     from public, anon, authenticated;
revoke all on function public.profiles_sync_before()                      from public, anon, authenticated;
revoke all on function public.profiles_login_id_lock()                    from public, anon, authenticated;
revoke all on function public.rename_login_id(uuid, text)                 from public, anon, authenticated;
revoke all on function public.profiles_sync_emit()                        from public, anon, authenticated;
revoke all on function public.directory_sync_emit()                       from public, anon, authenticated;
revoke all on function public.approver_assignments_placement()            from public, anon, authenticated;
revoke all on function public.approver_assignments_sync_emit()            from public, anon, authenticated;
revoke all on function public.sync_next_batch(uuid, integer)              from public, anon, authenticated;
revoke all on function public.sync_mark_delivered(bigint[])               from public, anon, authenticated;
revoke all on function public.sync_mark_failed(bigint[], text)            from public, anon, authenticated;
revoke all on function public.sync_snapshot()                             from public, anon, authenticated;

grant execute on function public.sync_member_type(text, text, text)       to service_role;
grant execute on function public.sync_person_payload(uuid)                to service_role;
grant execute on function public.sync_directory_payload(text, uuid)       to service_role;
grant execute on function public.sync_approver_payload(uuid)              to service_role;
grant execute on function public.rename_login_id(uuid, text)              to service_role;
grant execute on function public.sync_next_batch(uuid, integer)           to service_role;
grant execute on function public.sync_mark_delivered(bigint[])            to service_role;
grant execute on function public.sync_mark_failed(bigint[], text)         to service_role;
grant execute on function public.sync_snapshot()                          to service_role;

-- ---------------------------------------------------------------- data
-- Push targets and new-role access (set first, so the seed events below are queued).
update public.apps
   set sync_url = 'http://localhost:8000/api/v1/sync/eklink/events',
       allowed_platform_roles = array['super_admin','org_admin','institute_admin','department_admin','faculty','staff','student']
 where slug = 'templateos';
update public.apps
   set sync_url = 'http://localhost:3002/api/sync/eklink/events',
       allowed_platform_roles = array['super_admin','org_admin','institute_admin','department_admin','faculty','staff','student']
 where slug = 'approveit';

-- Demo directory (SYNC_CONTRACT.md section 8).
insert into public.organizations (code, name, is_demo)
values ('DEMO', 'TemplateOS Demo Institute', true)
on conflict (code) do nothing;

insert into public.institutes (organization_id, code, name, is_demo)
select o.id, 'DEMO-INST', 'TemplateOS Demo Institute', true
  from public.organizations o where o.code = 'DEMO'
on conflict (organization_id, code) do nothing;

insert into public.departments (institute_id, code, name, is_demo)
select i.id, v.code, v.name, true
  from public.institutes i
  join public.organizations o on o.id = i.organization_id
 cross join (values ('CS', 'Computer Science'), ('ACAD', 'Academic Affairs')) as v(code, name)
 where o.code = 'DEMO' and i.code = 'DEMO-INST'
on conflict (institute_id, code) do nothing;

-- Approver jobs moved into EkLink (people that do not exist are skipped).
insert into public.approver_assignments (profile_id, title, scope_level, organization_id, institute_id, department_id, scope_key)
select p.id, s.title, s.scope_level, o.id, i.id,
       case when s.scope_level = 'department' then d.id end,
       s.scope_key
  from (values
          ('T004', 'HOD',             'department', null::text),
          ('T001', 'Director',        'institute',  null::text),
          ('T009', 'Exam Cell',       'institute',  null::text),
          ('T036', 'Event In-charge', 'department', 'hackathon')
       ) as s(login_id, title, scope_level, scope_key)
  join public.profiles p      on p.login_id = s.login_id
  join public.organizations o on o.code = 'SIU'
  join public.institutes i    on i.organization_id = o.id and i.code = 'SIT'
  join public.departments d   on d.institute_id = i.id and d.code = 'CSE'
 where not exists (
         select 1 from public.approver_assignments a
          where a.profile_id = p.id and a.title = s.title and a.valid_to is null);

commit;
