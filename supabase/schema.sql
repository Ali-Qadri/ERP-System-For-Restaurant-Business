-- Run this once in the Supabase SQL editor.
create table if not exists public.restaurant_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.restaurant_state enable row level security;

-- This demo uses the Vite anon key without authentication.
-- Replace these policies with authenticated-user policies before production use.
drop policy if exists "restaurant state is readable" on public.restaurant_state;
create policy "restaurant state is readable"
  on public.restaurant_state for select
  to anon, authenticated
  using (true);

drop policy if exists "restaurant state is writable" on public.restaurant_state;
create policy "restaurant state is writable"
  on public.restaurant_state for all
  to anon, authenticated
  using (true)
  with check (true);
