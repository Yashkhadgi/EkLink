-- 0005_org_hierarchy.sql
--
-- Adds the organisation tree (organization -> institute -> department) and a
-- platform_role to profiles. Purely additive:
--   * no existing column is changed or dropped;
--   * profiles.role keeps its old values (ApproveIt and apps.allowed_roles use them);
--   * profiles.department (free text) is left untouched.
-- Rollback: supabase/rollback/0005_org_hierarchy_down.sql

begin;

-- ---------------------------------------------------------------- directory
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint organizations_code_clean check (code = upper(btrim(code)) and code ~ '^[A-Z0-9-]+$')
);

create table public.institutes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  code             text not null,
  name             text not null,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  constraint institutes_code_clean check (code = upper(btrim(code)) and code ~ '^[A-Z0-9-]+$'),
  constraint institutes_org_code_unique unique (organization_id, code)
);

create table public.departments (
  id            uuid primary key default gen_random_uuid(),
  institute_id  uuid not null references public.institutes(id) on delete restrict,
  code          text not null,
  name          text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint departments_code_clean check (code = upper(btrim(code)) and code ~ '^[A-Z0-9-]+$'),
  constraint departments_inst_code_unique unique (institute_id, code)
);

create index institutes_org_idx  on public.institutes (organization_id);
create index departments_inst_idx on public.departments (institute_id);

-- The directory is not secret: signed-in users may read it (dashboard/profile
-- show their institute and department). Writes stay service-role only.
alter table public.organizations enable row level security;
alter table public.institutes    enable row level security;
alter table public.departments   enable row level security;
revoke all on public.organizations from anon, authenticated;
revoke all on public.institutes    from anon, authenticated;
revoke all on public.departments   from anon, authenticated;
grant select on public.organizations to authenticated;
grant select on public.institutes    to authenticated;
grant select on public.departments   to authenticated;
create policy "organizations: signed-in read" on public.organizations for select to authenticated using (true);
create policy "institutes: signed-in read"    on public.institutes    for select to authenticated using (true);
create policy "departments: signed-in read"   on public.departments   for select to authenticated using (true);

-- ---------------------------------------------------------------- profiles
alter table public.profiles
  add column organization_id uuid references public.organizations(id) on delete restrict,
  add column institute_id    uuid references public.institutes(id)    on delete restrict,
  add column department_id   uuid references public.departments(id)   on delete restrict,
  add column platform_role   text,
  add column semester        smallint,
  add column designation     text;

alter table public.profiles
  add constraint profiles_platform_role_check check (platform_role is null or platform_role in
    ('super_admin','org_admin','institute_admin','department_admin','faculty','staff','student')),
  add constraint profiles_semester_range check (semester is null or semester between 1 and 12);

create index profiles_department_idx on public.profiles (department_id);
create index profiles_institute_idx  on public.profiles (institute_id);

-- Keep the placement consistent: a department implies its institute and
-- organization, an institute implies its organization. Mismatches are refused.
create or replace function public.profiles_placement_sync()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_inst uuid;
  v_org  uuid;
begin
  if new.department_id is not null then
    select d.institute_id, i.organization_id into v_inst, v_org
      from public.departments d join public.institutes i on i.id = d.institute_id
     where d.id = new.department_id;
    if new.institute_id is not null and new.institute_id <> v_inst then
      raise exception 'department % is not in institute %', new.department_id, new.institute_id;
    end if;
    new.institute_id := v_inst;
  end if;
  if new.institute_id is not null then
    select i.organization_id into v_org from public.institutes i where i.id = new.institute_id;
    if new.organization_id is not null and new.organization_id <> v_org then
      raise exception 'institute % is not in organization %', new.institute_id, new.organization_id;
    end if;
    new.organization_id := v_org;
  end if;
  return new;
end;
$$;

create trigger profiles_placement_sync
  before insert or update of organization_id, institute_id, department_id on public.profiles
  for each row execute function public.profiles_placement_sync();

-- Every profile gets a platform_role: when none is given, derive it from the
-- old role (new accounts from scripts / provisioning need no extra field).
create or replace function public.profiles_platform_role_default()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.platform_role is null then
    new.platform_role := case new.role
                           when 'student'  then 'student'
                           when 'faculty'  then 'faculty'
                           when 'hod'      then 'faculty'
                           when 'director' then 'faculty'
                           when 'staff'    then 'staff'
                           when 'finance'  then 'staff'
                           when 'admin'    then 'super_admin'
                         end;
  end if;
  return new;
end;
$$;

create trigger profiles_platform_role_default
  before insert or update of role, platform_role on public.profiles
  for each row execute function public.profiles_platform_role_default();

-- ---------------------------------------------------------------- seed + backfill
insert into public.organizations (code, name) values ('SIU', 'Symbiosis International University');
insert into public.institutes (organization_id, code, name)
  select id, 'SIT', 'Symbiosis Institute of Technology, Nagpur' from public.organizations where code = 'SIU';
insert into public.departments (institute_id, code, name)
  select id, 'CSE', 'Computer Science and Engineering' from public.institutes where code = 'SIT';

update public.profiles
   set department_id = (select d.id from public.departments d
                          join public.institutes i on i.id = d.institute_id
                         where d.code = 'CSE' and i.code = 'SIT');

update public.profiles
   set platform_role = case role
                         when 'student'  then 'student'
                         when 'faculty'  then 'faculty'
                         when 'hod'      then 'faculty'
                         when 'director' then 'faculty'
                         when 'staff'    then 'staff'
                         when 'finance'  then 'staff'
                         when 'admin'    then 'super_admin'
                       end;

-- The platform super admin's login ID.
update public.profiles set login_id = 'SU-ADMIN001' where login_id = 'ADMIN001';

commit;
