-- Guest self-join invite tokens:
-- - expire after 6 hours
-- - max 14 uses
-- - generated/reused only by match admin via RPC
-- - consumed atomically by edge function (service role)

create extension if not exists pgcrypto;

create table if not exists public.guest_match_invites (
  id bigserial primary key,
  partido_id bigint not null references public.partidos(id) on delete cascade,
  token text not null unique,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  max_uses int not null default 14,
  uses_count int not null default 0,
  revoked_at timestamptz null
);

create index if not exists guest_match_invites_partido_id_idx on public.guest_match_invites(partido_id);
create index if not exists guest_match_invites_token_idx on public.guest_match_invites(token);

alter table public.guest_match_invites enable row level security;

-- Only the admin should be able to create/retrieve an invite token (via RPC).
-- We keep the table locked down (no direct policies). The function is SECURITY DEFINER.

create or replace function public.create_guest_match_invite(p_partido_id bigint)
returns table(token text, expires_at timestamptz, max_uses int, uses_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.guest_match_invites%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if not exists (
    select 1
    from public.partidos p
    where p.id = p_partido_id
      and p.creado_por = v_uid
  ) then
    raise exception 'not_admin';
  end if;

  -- Reuse the newest active token if it is still valid and has remaining uses.
  select *
    into v_existing
  from public.guest_match_invites g
  where g.partido_id = p_partido_id
    and g.revoked_at is null
    and g.expires_at > now()
    and g.uses_count < g.max_uses
  order by g.created_at desc
  limit 1;

  if found then
    return query
      select v_existing.token, v_existing.expires_at, v_existing.max_uses, v_existing.uses_count;
    return;
  end if;

  insert into public.guest_match_invites(partido_id, token, created_by, expires_at, max_uses, uses_count)
  values (
    p_partido_id,
    -- short-ish token for URL; still unguessable enough for our scale
    replace(gen_random_uuid()::text, '-', ''),
    v_uid,
    now() + interval '6 hours',
    14,
    0
  )
  returning guest_match_invites.token, guest_match_invites.expires_at, guest_match_invites.max_uses, guest_match_invites.uses_count
  into token, expires_at, max_uses, uses_count;

  return next;
end;
$$;

grant execute on function public.create_guest_match_invite(bigint) to authenticated;

