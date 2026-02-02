-- Migration: Create match_join_requests table with specific schema
-- Date: 2026-01-30

create table if not exists public.match_join_requests (
  id uuid primary key default gen_random_uuid(),
  match_id bigint not null,
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

-- Unique constraint to prevent duplicate requests from same user to same match
create unique index if not exists match_join_requests_unique
on public.match_join_requests (match_id, requester_user_id);

-- Enable RLS
alter table public.match_join_requests enable row level security;

-- Policies
create policy "insert own join request"
on public.match_join_requests
for insert
to authenticated
with check (requester_user_id = auth.uid());

create policy "select own join request"
on public.match_join_requests
for select
to authenticated
using (requester_user_id = auth.uid());
