-- Rollback for 0006_sync.sql. Removes only what 0006 added. No person is deleted:
-- the demo directory rows are removed only when nobody is placed in them (demo users
-- created by scripts/create-demo-users.mjs keep them; remove those users first if
-- you really want the demo directory gone).
begin;

-- triggers
drop trigger if exists approver_assignments_sync_emit        on public.approver_assignments;
drop trigger if exists approver_assignments_placement        on public.approver_assignments;
drop trigger if exists approver_assignments_touch_updated_at on public.approver_assignments;
drop trigger if exists profiles_sync_emit                    on public.profiles;
drop trigger if exists profiles_login_id_lock                on public.profiles;
drop trigger if exists profiles_sync_before                  on public.profiles;
drop trigger if exists organizations_sync_emit               on public.organizations;
drop trigger if exists institutes_sync_emit                  on public.institutes;
drop trigger if exists departments_sync_emit                 on public.departments;
drop trigger if exists organizations_touch_updated_at        on public.organizations;
drop trigger if exists institutes_touch_updated_at           on public.institutes;
drop trigger if exists departments_touch_updated_at          on public.departments;

-- functions
drop function if exists public.sync_snapshot();
drop function if exists public.sync_mark_failed(bigint[], text);
drop function if exists public.sync_mark_delivered(bigint[]);
drop function if exists public.sync_next_batch(uuid, integer);
drop function if exists public.approver_assignments_sync_emit();
drop function if exists public.approver_assignments_placement();
drop function if exists public.directory_sync_emit();
drop function if exists public.profiles_sync_emit();
drop function if exists public.rename_login_id(uuid, text);
drop function if exists public.profiles_login_id_lock();
drop function if exists public.profiles_sync_before();
drop function if exists public.sync_touch_updated_at();
drop function if exists public.sync_emit(text, text, jsonb);
drop function if exists public.sync_approver_payload(uuid);
drop function if exists public.sync_directory_payload(text, uuid);
drop function if exists public.sync_person_payload(uuid);
drop function if exists public.sync_member_type(text, text, text);

-- tables
drop table if exists public.event_deliveries;
drop table if exists public.change_events;
drop table if exists public.approver_assignments;

-- demo directory (only when unused)
delete from public.departments d
 using public.institutes i, public.organizations o
 where d.institute_id = i.id and i.organization_id = o.id
   and o.code = 'DEMO' and i.code = 'DEMO-INST' and d.code in ('CS', 'ACAD')
   and not exists (select 1 from public.profiles p where p.department_id = d.id);
delete from public.institutes i
 using public.organizations o
 where i.organization_id = o.id and o.code = 'DEMO' and i.code = 'DEMO-INST'
   and not exists (select 1 from public.departments d where d.institute_id = i.id)
   and not exists (select 1 from public.profiles p where p.institute_id = i.id);
delete from public.organizations o
 where o.code = 'DEMO'
   and not exists (select 1 from public.institutes i where i.organization_id = o.id)
   and not exists (select 1 from public.profiles p where p.organization_id = o.id);

-- columns
alter table public.apps
  drop constraint if exists apps_platform_roles_valid,
  drop constraint if exists apps_sync_url_http,
  drop column if exists allowed_platform_roles,
  drop column if exists sync_url;

alter table public.departments
  drop constraint if exists departments_code_length,
  drop column if exists is_demo,
  drop column if exists updated_at;
alter table public.institutes
  drop constraint if exists institutes_code_length,
  drop column if exists is_demo,
  drop column if exists updated_at;
alter table public.organizations
  drop constraint if exists organizations_code_length,
  drop column if exists is_demo,
  drop column if exists updated_at;

alter table public.profiles
  drop constraint if exists profiles_member_type_check,
  drop column if exists member_type,
  drop column if exists is_demo,
  drop column if exists updated_at,
  drop column if exists deactivated_at;

commit;
