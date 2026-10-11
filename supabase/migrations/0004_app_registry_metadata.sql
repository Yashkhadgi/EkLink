alter table public.apps
  add column description text,
  add column status text not null default 'live';

alter table public.apps
  add constraint apps_status_check check (status in ('live', 'coming_soon'));
