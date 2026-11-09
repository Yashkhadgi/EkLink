-- Rollback for 0005_org_hierarchy.sql. Removes only what 0005 added; the
-- original profile columns (role, department, batch, section, ...) were never changed.
begin;

update public.profiles set login_id = 'ADMIN001' where login_id = 'SU-ADMIN001';

drop trigger if exists profiles_platform_role_default on public.profiles;
drop function if exists public.profiles_platform_role_default();
drop trigger if exists profiles_placement_sync on public.profiles;
drop function if exists public.profiles_placement_sync();

alter table public.profiles
  drop constraint if exists profiles_platform_role_check,
  drop constraint if exists profiles_semester_range,
  drop column if exists organization_id,
  drop column if exists institute_id,
  drop column if exists department_id,
  drop column if exists platform_role,
  drop column if exists semester,
  drop column if exists designation;

drop table if exists public.departments;
drop table if exists public.institutes;
drop table if exists public.organizations;

commit;
