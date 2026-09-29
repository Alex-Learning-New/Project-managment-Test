-- ============================================================
-- Daily Worksheet — run once in the Supabase SQL editor
-- ============================================================

-- 1. Worksheet submissions (one row per submitted worksheet)
create table if not exists public.worksheets (
  id                   uuid primary key default gen_random_uuid(),
  user_id              text not null,
  user_name            text,
  work_date            date not null,
  task_id              text,            -- null when "Other / General work"
  project_title        text,
  project_manager_id   text,
  work_title           text not null,
  description          text not null,
  start_time           text not null,   -- "HH:MM"
  end_time             text not null,   -- "HH:MM"
  total_hours          numeric(5,2) not null,
  work_status          text not null,   -- completed | in-progress | pending | blocked
  files                jsonb not null default '[]'::jsonb,  -- [{name, path, url, size}]
  remarks              text,
  created_at           timestamptz not null default now()
);

create index if not exists worksheets_work_date_idx on public.worksheets (work_date desc);
create index if not exists worksheets_user_idx      on public.worksheets (user_id);

-- The app talks to Supabase directly with the anon key (custom login, no
-- Supabase Auth), so this policy mirrors that: anyone holding the key can
-- read/write. Tighten it if you later move to Supabase Auth.
alter table public.worksheets enable row level security;
drop policy if exists "worksheets app access" on public.worksheets;
create policy "worksheets app access" on public.worksheets
  for all to anon, authenticated
  using (true) with check (true);

-- 2. Storage bucket for the "Project Files" uploads.
--    Public bucket: files are reachable by anyone who has the link.
insert into storage.buckets (id, name, public)
values ('worksheet-files', 'worksheet-files', true)
on conflict (id) do nothing;

drop policy if exists "worksheet files upload" on storage.objects;
create policy "worksheet files upload" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'worksheet-files');

drop policy if exists "worksheet files read" on storage.objects;
create policy "worksheet files read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'worksheet-files');
