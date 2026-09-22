-- Core → Torneos contract v1 (Phase 3A): verified email, directory, frozen team snapshot.
--
-- Core stays the source of truth for identity, session validity, email verification,
-- player discoverability and team ownership. The isolated Torneos backend never reads
-- these tables: its server calls the `torneos-core-contract` Edge Function, which
-- authenticates the service request and evaluates everything below in ONE transaction
-- (nonce, session, operation), so a replayed nonce is never evaluated twice and a
-- denied request still consumes its nonce.
--
-- Exact request/response schemas: backend/torneos/phase2a/schemas.json.
-- Denials are returned as data ({status, body}) so the transaction commits; only
-- infrastructure failures raise. No email, phone, document, password, session or
-- membership data ever leaves this function beyond the strict allowlist.

begin;

create schema if not exists app_private;

-- Service-request replay protection: one nonce, one evaluation, retained 61 s.
create table app_private.torneos_contract_nonces (
  nonce text primary key,
  expires_at timestamptz not null,
  constraint torneos_contract_nonces_format check (nonce ~ '^[0-9a-f]{32}$')
);
create index torneos_contract_nonces_expiry
  on app_private.torneos_contract_nonces (expires_at);

-- Directory rate limit: 30 requests per Core actor per rolling 60 s, both kinds.
create table app_private.torneos_contract_rate_events (
  id bigint generated always as identity primary key,
  core_user_id uuid not null,
  created_at timestamptz not null default now()
);
create index torneos_contract_rate_events_actor
  on app_private.torneos_contract_rate_events (core_user_id, created_at);

-- Owner-only tables: RLS enabled with no policies, no API-role grants.
alter table app_private.torneos_contract_nonces enable row level security;
alter table app_private.torneos_contract_rate_events enable row level security;
revoke all on app_private.torneos_contract_nonces from public, anon, authenticated, service_role;
revoke all on app_private.torneos_contract_rate_events from public, anon, authenticated, service_role;

-- Matching policy for the verified-email contract (Phase 2A): ASCII, exactly one "@",
-- non-empty parts, no whitespace anywhere (edge whitespace rejected, not trimmed),
-- 3..254 characters, lowercased. No alias rewriting, no IDNA aliasing. NULL = invalid.
create function app_private.torneos_contract_email(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null then null
    when char_length(p_value) < 3 or char_length(p_value) > 254 then null
    when p_value !~ '^[\x21-\x7e]+$' then null
    when length(p_value) - length(replace(p_value, '@', '')) <> 1 then null
    when split_part(p_value, '@', 1) = '' or split_part(p_value, '@', 2) = '' then null
    else lower(p_value)
  end
$$;

-- URLs cross the boundary only as HTTPS references of at most 2048 characters.
create function app_private.torneos_contract_url(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value ~ '^https://[^[:space:]]+$' and char_length(p_value) <= 2048 then p_value
    else null
  end
$$;

-- Privacy projection of one Core player, or NULL when the player is not exposable:
-- account deleted/banned/anonymous, not explicitly discoverable (the user's own
-- "acepta invitaciones" toggle), or a display name outside the contract's 2..100.
-- Positions are the user's declared positions, at most eight of 1..32 characters.
create function app_private.torneos_contract_visible_player(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'core_user_id', profile.id,
    'display_name', btrim(profile.nombre),
    'avatar_url', app_private.torneos_contract_url(profile.avatar_url),
    'positions', coalesce((
      select jsonb_agg(position order by ordinality)
      from unnest(coalesce(profile.posiciones, array[]::text[])) with ordinality as p(position, ordinality)
      where char_length(position) between 1 and 32 and ordinality <= 8
    ), '[]'::jsonb)
  )
  from public.usuarios profile
  join auth.users account on account.id = profile.id
  where profile.id = p_user_id
    and account.deleted_at is null
    and (account.banned_until is null or account.banned_until <= now())
    and coalesce(account.is_anonymous, false) = false
    and profile.acepta_invitaciones = true
    and char_length(btrim(coalesce(profile.nombre, ''))) between 2 and 100
$$;

-- A team is exposable to a caller only when it is active and the caller currently
-- holds Core import authority over it (owner, admin or captain). Unknown, inactive
-- and unauthorized teams are indistinguishable to the caller.
create function app_private.torneos_contract_importable_team(p_user_id uuid, p_team_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'core_team_id', team.id,
    'name', btrim(team.name),
    'crest_url', app_private.torneos_contract_url(team.crest_url),
    'source_revision', floor(extract(epoch from team.updated_at))::integer
  )
  from public.teams team
  where team.id = p_team_id
    and team.is_active
    and public.team_user_is_admin_or_owner(team.id, p_user_id)
    and char_length(btrim(team.name)) between 2 and 100
$$;

-- Single entry point. Executable only by service_role (the Edge Function).
-- p_operation: verified_email | directory | team_snapshot
-- p_nonce: 32 hex characters chosen by the caller (already HMAC-bound by the function)
-- p_request: the contract request object; for directory the Edge Function replaces the
--            signed cursor by the keyset position it authenticated (`after`).
create function public.torneos_contract_execute(p_operation text, p_nonce text, p_request jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_user_id uuid;
  v_session_id uuid;
  v_expected text;
  v_current text;
  v_verified boolean;
  v_kind text;
  v_query text;
  v_normalized text;
  v_limit integer;
  v_after uuid;
  v_items jsonb;
  v_count integer;
  v_team_id uuid;
  v_team jsonb;
  v_players jsonb;
  v_player_count integer;
  v_keys text[];
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'INVALID_REQUEST'));
  end if;

  -- Replay protection first: a nonce is consumed by its first evaluation, whatever
  -- the verdict. The insert is unique-constrained, so concurrent replays serialize.
  if p_nonce is null or p_nonce !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('status', 401, 'body', jsonb_build_object('error', 'SERVICE_AUTH_REQUIRED'));
  end if;
  delete from app_private.torneos_contract_nonces where expires_at <= v_now;
  begin
    insert into app_private.torneos_contract_nonces (nonce, expires_at)
    values (p_nonce, v_now + interval '61 seconds');
  exception when unique_violation then
    return jsonb_build_object('status', 401, 'body', jsonb_build_object('error', 'REPLAY'));
  end;

  -- Exact key sets per operation (closed schemas).
  v_keys := case p_operation
    when 'verified_email' then array['core_user_id', 'session_id', 'expected_email']
    when 'directory' then array['core_user_id', 'session_id', 'kind', 'query', 'limit', 'after']
    when 'team_snapshot' then array['core_user_id', 'session_id', 'core_team_id']
    else null end;
  if v_keys is null then
    return jsonb_build_object('status', 404, 'body', jsonb_build_object('error', 'NOT_FOUND'));
  end if;
  if (select coalesce(array_agg(key order by key), array[]::text[]) from jsonb_object_keys(p_request) key)
     <> (select array_agg(key order by key) from unnest(v_keys) key) then
    return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'INVALID_REQUEST'));
  end if;

  begin
    v_user_id := (p_request->>'core_user_id')::uuid;
    v_session_id := (p_request->>'session_id')::uuid;
  exception when invalid_text_representation then
    return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'INVALID_REQUEST'));
  end;
  if v_user_id is null or v_session_id is null
     or p_request->>'core_user_id' <> v_user_id::text or p_request->>'session_id' <> v_session_id::text then
    return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'INVALID_REQUEST'));
  end if;

  -- Core session authority: the session must exist, belong to this user, be unexpired
  -- and the account must be live (not deleted, not banned, not anonymous). Logout
  -- deletes the session row, so a revoked session fails here.
  if not exists (
    select 1
    from auth.sessions session
    join auth.users account on account.id = session.user_id
    where session.id = v_session_id
      and session.user_id = v_user_id
      and (session.not_after is null or session.not_after > v_now)
      and account.deleted_at is null
      and (account.banned_until is null or account.banned_until <= v_now)
      and coalesce(account.is_anonymous, false) = false
  ) then
    return jsonb_build_object('status', 403, 'body', jsonb_build_object('error', 'FORBIDDEN'));
  end if;

  if p_operation = 'verified_email' then
    if jsonb_typeof(p_request->'expected_email') <> 'string' then
      return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'INVALID_REQUEST'));
    end if;
    v_expected := app_private.torneos_contract_email(p_request->>'expected_email');
    if v_expected is null then
      return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'INVALID_REQUEST'));
    end if;
    -- The user's current address and its current verification state, read fresh.
    -- Neither the address nor its timestamp is returned.
    select app_private.torneos_contract_email(account.email), account.email_confirmed_at is not null
    into v_current, v_verified
    from auth.users account
    where account.id = v_user_id;
    v_verified := coalesce(v_verified, false) and v_current is not null;
    return jsonb_build_object('status', 200, 'body', jsonb_build_object(
      'verified', v_verified,
      'matches', coalesce(v_verified and v_current = v_expected, false),
      'checked_at', floor(extract(epoch from v_now))::bigint
    ));
  end if;

  if p_operation = 'directory' then
    v_kind := p_request->>'kind';
    if jsonb_typeof(p_request->'query') <> 'string'
       or jsonb_typeof(p_request->'limit') <> 'number'
       or jsonb_typeof(p_request->'after') not in ('string', 'null')
       or v_kind not in ('players', 'teams')
       or (p_request->>'limit') !~ '^[0-9]+$' then
      return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'INVALID_REQUEST'));
    end if;
    v_query := p_request->>'query';
    v_limit := (p_request->>'limit')::integer;
    if char_length(btrim(v_query)) < 2 or char_length(btrim(v_query)) > 100 or v_limit < 1 or v_limit > 12 then
      return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'INVALID_REQUEST'));
    end if;
    begin
      v_after := (p_request->>'after')::uuid;
    exception when invalid_text_representation then
      return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'INVALID_CURSOR'));
    end;

    -- Rate limit per actor, evaluated atomically for this actor; pagination counts.
    perform pg_advisory_xact_lock(hashtext('torneos_contract_rate'), hashtext(v_user_id::text));
    delete from app_private.torneos_contract_rate_events where created_at <= v_now - interval '2 minutes';
    if (
      select count(*) from app_private.torneos_contract_rate_events event
      where event.core_user_id = v_user_id and event.created_at > v_now - interval '60 seconds'
    ) >= 30 then
      return jsonb_build_object('status', 429, 'body', jsonb_build_object('error', 'RATE_LIMITED'));
    end if;
    insert into app_private.torneos_contract_rate_events (core_user_id, created_at) values (v_user_id, v_now);

    -- Case-folded, accent-insensitive substring match using Core's own normalizer.
    v_normalized := btrim(public.normalize_tournament_person_name(v_query));
    if v_normalized = '' then
      return jsonb_build_object('status', 200, 'body', jsonb_build_object('items', '[]'::jsonb, 'has_more', false));
    end if;

    if v_kind = 'players' then
      select coalesce(jsonb_agg(candidate.item order by candidate.id), '[]'::jsonb), count(*)
      into v_items, v_count
      from (
        select profile.id, app_private.torneos_contract_visible_player(profile.id) as item
        from public.usuarios profile
        where (v_after is null or profile.id > v_after)
          and public.normalize_tournament_person_name(profile.nombre) like '%' || v_normalized || '%'
          and app_private.torneos_contract_visible_player(profile.id) is not null
        order by profile.id
        limit v_limit + 1
      ) candidate;
    else
      select coalesce(jsonb_agg(candidate.item - 'source_revision' order by candidate.id), '[]'::jsonb), count(*)
      into v_items, v_count
      from (
        select team.id, app_private.torneos_contract_importable_team(v_user_id, team.id) as item
        from public.teams team
        where (v_after is null or team.id > v_after)
          and team.is_active
          and public.normalize_tournament_person_name(team.name) like '%' || v_normalized || '%'
          and app_private.torneos_contract_importable_team(v_user_id, team.id) is not null
        order by team.id
        limit v_limit + 1
      ) candidate;
    end if;
    return jsonb_build_object('status', 200, 'body', jsonb_build_object(
      'items', case when v_count > v_limit then v_items - (v_count - 1) else v_items end,
      'has_more', v_count > v_limit
    ));
  end if;

  if p_operation = 'team_snapshot' then
    begin
      v_team_id := (p_request->>'core_team_id')::uuid;
    exception when invalid_text_representation then
      return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'INVALID_REQUEST'));
    end;
    if v_team_id is null or p_request->>'core_team_id' <> v_team_id::text then
      return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'INVALID_REQUEST'));
    end if;
    v_team := app_private.torneos_contract_importable_team(v_user_id, v_team_id);
    if v_team is null then
      return jsonb_build_object('status', 404, 'body', jsonb_build_object('error', 'NOT_FOUND'));
    end if;
    -- Candidates: current members that resolve to a live, discoverable Core account.
    -- Guest members without an account cannot cross the boundary (no core_user_id).
    select coalesce(jsonb_agg(candidate.item order by candidate.user_id), '[]'::jsonb), count(*)
    into v_players, v_player_count
    from (
      select distinct member_user.user_id, app_private.torneos_contract_visible_player(member_user.user_id) as item
      from (
        select coalesce(member.user_id, player.usuario_id) as user_id
        from public.team_members member
        left join public.jugadores player on player.id = member.jugador_id
        where member.team_id = v_team_id
      ) member_user
      where member_user.user_id is not null
        and app_private.torneos_contract_visible_player(member_user.user_id) is not null
    ) candidate;
    if v_player_count > 80 then
      return jsonb_build_object('status', 409, 'body', jsonb_build_object('error', 'INVALID_REQUEST'));
    end if;
    return jsonb_build_object('status', 200, 'body', jsonb_build_object(
      'core_team_id', v_team->>'core_team_id',
      'name', v_team->>'name',
      'crest_url', v_team->'crest_url',
      'players', v_players,
      'source_revision', (v_team->>'source_revision')::integer,
      'captured_at', floor(extract(epoch from v_now))::bigint
    ));
  end if;

  return jsonb_build_object('status', 404, 'body', jsonb_build_object('error', 'NOT_FOUND'));
end;
$$;

revoke all on function app_private.torneos_contract_email(text) from public, anon, authenticated, service_role;
revoke all on function app_private.torneos_contract_url(text) from public, anon, authenticated, service_role;
revoke all on function app_private.torneos_contract_visible_player(uuid) from public, anon, authenticated, service_role;
revoke all on function app_private.torneos_contract_importable_team(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.torneos_contract_execute(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.torneos_contract_execute(text, text, jsonb) to service_role;

commit;
