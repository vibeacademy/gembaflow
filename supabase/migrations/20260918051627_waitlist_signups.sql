-- Waitlist signups — coming-soon landing page email collection.
--
-- Filename is timestamp-based per docs/PATTERN-LIBRARY.md #5 (Supabase:
-- Migration Filename Collisions) — never sequential numeric prefixes.
--
-- Security model: RLS is ENABLED with NO policies. anon and authenticated
-- roles can neither read nor write this table through PostgREST — every
-- insert goes through the server-side service-role client
-- (lib/supabase/service.ts), which bypasses RLS. The unique constraint on
-- email is the dedupe mechanism: the API route treats a 23505
-- unique-violation as a friendly "already on the list" success, never an
-- error.

create table if not exists public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  created_at timestamptz not null default now()
);

comment on table public.waitlist_signups is
  'Coming-soon waitlist emails. Service-role writes only; no anon access (RLS enabled, zero policies).';

alter table public.waitlist_signups enable row level security;

-- Intentionally NO create policy statements: with RLS enabled and no
-- policies, PostgREST denies all anon/authenticated access. Do not add
-- policies to this table unless you deliberately want to expose it.
