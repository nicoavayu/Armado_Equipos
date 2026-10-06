-- Core → Torneos contract v1.2 — adds the `my_teams` operation.
--
-- CONNECTED-V1 (registration requests from Explorar torneos) needs to tell a person which of THEIR Core teams they
-- can register in a tournament (owner/admin: Core's own team_user_is_admin_or_owner) and which ones they only belong
-- to (so the request must come from its responsible). The directory operation cannot answer that: it needs a search
-- text and only returns teams the caller administers. Like v1.1 (session), this migration re-creates
-- public.torneos_contract_execute with the identical body plus one branch. No new table, no new grant, no new helper:
-- SECURITY DEFINER, search_path = '', EXECUTE only for service_role, nonce consumed exactly like every operation, the
-- Core session authority checked first, and the directory's per-actor rate limit.
--
-- p_operation: session | verified_email | directory | team_snapshot | my_teams
-- my_teams request: {core_user_id, session_id, limit (1-30)};
--   200 {items: [{core_team_id, name, crest_url, can_register}], has_more, checked_at}. Active teams with a 2-100
--   character name where the caller is owner/admin (can_register = true) or a member (can_register = false), own
--   teams first. No member list, role, contact or account data.

create or replace function public.torneos_contract_execute(p_operation text, p_nonce text, p_request jsonb)
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
    when 'session' then array['core_user_id', 'session_id']
    when 'verified_email' then array['core_user_id', 'session_id', 'expected_email']
    when 'directory' then array['core_user_id', 'session_id', 'kind', 'query', 'limit', 'after']
    when 'team_snapshot' then array['core_user_id', 'session_id', 'core_team_id']
    when 'my_teams' then array['core_user_id', 'session_id', 'limit']
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

  -- Phase 3B: session validation as its own operation. Exactly the Core session authority
  -- verdict above and nothing else; lets the Torneos gateway revoke online over HTTPS
  -- without any Core database access. Same nonce/replay/signature discipline.
  if p_operation = 'session' then
    return jsonb_build_object('status', 200, 'body', jsonb_build_object(
      'active', true,
      'checked_at', floor(extract(epoch from v_now))::bigint
    ));
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

  if p_operation = 'my_teams' then
    -- v1.2: the caller's own active teams — the ones they can register (owner/admin, Core's own rule) and the ones
    -- they only belong to — so Torneos can explain which team a representative must register. Names and crests only:
    -- no member, role, contact or other account crosses. Bounded and rate-limited like the directory.
    if jsonb_typeof(p_request->'limit') <> 'number' or (p_request->>'limit') !~ '^[0-9]+$' then
      return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'INVALID_REQUEST'));
    end if;
    v_limit := (p_request->>'limit')::integer;
    if v_limit < 1 or v_limit > 30 then
      return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'INVALID_REQUEST'));
    end if;
    perform pg_advisory_xact_lock(hashtext('torneos_contract_rate'), hashtext(v_user_id::text));
    delete from app_private.torneos_contract_rate_events where created_at <= v_now - interval '2 minutes';
    if (
      select count(*) from app_private.torneos_contract_rate_events event
      where event.core_user_id = v_user_id and event.created_at > v_now - interval '60 seconds'
    ) >= 30 then
      return jsonb_build_object('status', 429, 'body', jsonb_build_object('error', 'RATE_LIMITED'));
    end if;
    insert into app_private.torneos_contract_rate_events (core_user_id, created_at) values (v_user_id, v_now);
    select coalesce(jsonb_agg(candidate.item order by candidate.can_register desc, candidate.sort_name, candidate.id), '[]'::jsonb),
      count(*)
    into v_items, v_count
    from (
      select team.id, lower(btrim(team.name)) as sort_name, authority.can_register,
        jsonb_build_object(
          'core_team_id', team.id,
          'name', btrim(team.name),
          'crest_url', app_private.torneos_contract_url(team.crest_url),
          'can_register', authority.can_register
        ) as item
      from public.teams team
      cross join lateral (select public.team_user_is_admin_or_owner(team.id, v_user_id) as can_register) authority
      where team.is_active
        and char_length(btrim(team.name)) between 2 and 100
        and (
          authority.can_register
          or exists (
            select 1
            from public.team_members member
            left join public.jugadores player on player.id = member.jugador_id
            where member.team_id = team.id
              and coalesce(member.user_id, player.usuario_id) = v_user_id
          )
        )
      order by authority.can_register desc, lower(btrim(team.name)), team.id
      limit v_limit + 1
    ) candidate;
    return jsonb_build_object('status', 200, 'body', jsonb_build_object(
      'items', case when v_count > v_limit then v_items - (v_count - 1) else v_items end,
      'has_more', v_count > v_limit,
      'checked_at', floor(extract(epoch from v_now))::bigint
    ));
  end if;

  return jsonb_build_object('status', 404, 'body', jsonb_build_object('error', 'NOT_FOUND'));
end;
$$;

-- The ACL of the Phase 3A migration is unchanged; restated so this file is self-contained.
revoke all on function public.torneos_contract_execute(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.torneos_contract_execute(text, text, jsonb) to service_role;
