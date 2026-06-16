-- Run this in Supabase → SQL Editor → New Query

-- 1. Create the user_data table
create table if not exists public.user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reports jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2. Enable Row Level Security (only you can see your data)
alter table public.user_data enable row level security;

-- 3. Policy: users can only read/write their own row
create policy "Owner only"
  on public.user_data
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
