-- Interactive onboarding: per-user, cross-device state.
--
-- Purely additive. Creates a dedicated table so we never touch the (remote-only)
-- RLS of `usuarios`. One row per user; the user can only read/write their own
-- row. The client keeps a local fallback (Capacitor Preferences / localStorage)
-- for offline/first-paint and reconciles idempotently against this table.
--
-- Versioned state (client CURRENT_ONBOARDING_VERSION): `completed_version`
-- records the highest onboarding version the user finished, so a future version
-- bump can re-offer a fresh mini-tour without losing the "already saw v1" fact.
-- `status` distinguishes an in-progress run from a completed/skipped one.
-- `chosen_path` is the branch the user picked (organizer / auto_match / overview).
-- `coach_marks` is a jsonb map of { "<coach_mark_key>": true } for seen marks.
-- `checklist` is a jsonb map for any client-tracked, non-derivable checklist
-- signals (derivable steps come from real product data, not from here).

begin;

create table if not exists public.user_onboarding_state (
  user_id uuid primary key references public.usuarios(id) on delete cascade,
  -- Highest onboarding version the user completed (0 = never completed one).
  completed_version integer not null default 0,
  -- Lifecycle of the *current* onboarding version for this user.
  status text not null default 'not_started',
  -- Branch chosen in the goal selector, when the user picked one.
  chosen_path text,
  -- Seen coach marks: { "<key>": true }.
  coach_marks jsonb not null default '{}'::jsonb,
  -- Client-tracked checklist flags that cannot be derived from product data.
  checklist jsonb not null default '{}'::jsonb,
  -- The optional, dismissable Home discovery card ("Conocé todo lo que podés
  -- hacer con Arma2") shown to pre-existing users.
  welcome_card_dismissed boolean not null default false,
  -- First time the client observed this user for onboarding purposes. Lets the
  -- server-side row corroborate "new vs existing" without trusting the client.
  first_seen_at timestamptz not null default now(),
  completed_at timestamptz,
  skipped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_onboarding_status_check
    check (status in ('not_started', 'in_progress', 'completed', 'skipped')),
  constraint user_onboarding_path_check
    check (chosen_path is null or chosen_path in ('organizer', 'auto_match', 'overview')),
  constraint user_onboarding_completed_version_check
    check (completed_version >= 0),
  constraint user_onboarding_coach_marks_is_object
    check (jsonb_typeof(coach_marks) = 'object'),
  constraint user_onboarding_checklist_is_object
    check (jsonb_typeof(checklist) = 'object')
);

alter table public.user_onboarding_state enable row level security;

-- Own row only: a user can read and write exactly their own onboarding state.
-- No cross-user visibility, no service-role needed from the client.
drop policy if exists user_onboarding_state_manage_own on public.user_onboarding_state;
create policy user_onboarding_state_manage_own
  on public.user_onboarding_state for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Keep `updated_at` honest on every write (client never sets it).
create or replace function public.set_user_onboarding_state_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_user_onboarding_state_set_updated_at on public.user_onboarding_state;
create trigger trg_user_onboarding_state_set_updated_at
before update on public.user_onboarding_state
for each row
execute function public.set_user_onboarding_state_updated_at();

-- Scoped grants: authenticated users operate on their own row (RLS-gated).
-- anon has no business here.
revoke all on table public.user_onboarding_state from public, anon;
grant select, insert, update, delete on table public.user_onboarding_state to authenticated;

commit;
