-- 0002_user_provisioning.sql

alter table public.profiles
  add column must_change_password boolean not null default true,
  add column batch   text,
  add column section text;

alter table public.profiles
  add constraint profiles_batch_format check (batch is null or batch ~ '^[0-9]{4}-[0-9]{2}$'),
  add constraint profiles_section_format check (section is null or section ~ '^[A-Z]$');

-- The existing admin was created by hand and does not need a forced change.
update public.profiles set must_change_password = false where role = 'admin';