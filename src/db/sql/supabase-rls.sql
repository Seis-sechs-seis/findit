-- ============================================================
-- Row Level Security: deny-all for anon/authenticated roles
-- ============================================================
-- This app uses its own session auth and only ever touches
-- Supabase through the service_role key server-side.
-- The service_role key BYPASSES RLS, so these policies never
-- affect normal app operation.
-- They exist purely as a safety net: if the app ever falls back
-- to the anon key (missing SERVICE_ROLE_KEY in env), no data
-- is readable or writable by that key.
--
-- Run once in the Supabase SQL Editor.
-- Safe to re-run (IF NOT EXISTS / OR REPLACE used throughout).
-- ============================================================

-- users -------------------------------------------------------
alter table public.users enable row level security;

drop policy if exists "deny_anon_users" on public.users;
create policy "deny_anon_users"
  on public.users
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- items -------------------------------------------------------
alter table public.items enable row level security;

drop policy if exists "deny_anon_items" on public.items;
create policy "deny_anon_items"
  on public.items
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- contact_requests --------------------------------------------
alter table public.contact_requests enable row level security;

drop policy if exists "deny_anon_contact_requests" on public.contact_requests;
create policy "deny_anon_contact_requests"
  on public.contact_requests
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- contact_request_messages ------------------------------------
alter table public.contact_request_messages enable row level security;

drop policy if exists "deny_anon_contact_request_messages" on public.contact_request_messages;
create policy "deny_anon_contact_request_messages"
  on public.contact_request_messages
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- contact_request_read_state ----------------------------------
alter table public.contact_request_read_state enable row level security;

drop policy if exists "deny_anon_contact_request_read_state" on public.contact_request_read_state;
create policy "deny_anon_contact_request_read_state"
  on public.contact_request_read_state
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- sessions ----------------------------------------------------
-- Only exists if using SupabaseSessionStore
alter table if exists public.sessions enable row level security;

drop policy if exists "deny_anon_sessions" on public.sessions;
create policy "deny_anon_sessions"
  on public.sessions
  for all
  to anon, authenticated
  using (false)
  with check (false);
