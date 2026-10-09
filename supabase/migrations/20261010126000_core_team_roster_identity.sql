-- Core: a team is permanent — leaving a match keeps you in it, and a new account can join.
--
-- team_members.jugador_id points at a jugadores row and cascades on delete. The app and
-- rpc_accept_team_invitation were written for match-less "roster" rows (they insert
-- jugadores without partido_id), but jugadores.partido_id is NOT NULL in the canonical
-- schema, so:
--   * a brand-new account (no match yet) could not accept a team invitation;
--   * the invitation anchored the membership to the user's latest MATCH row, and leaving
--     that match (or being removed from it) deleted the team membership in cascade;
--   * a team admin could not add a player without an account (NOT NULL, then RLS).
-- Fix:
--   1. partido_id may be NULL: such a row is the player's team roster identity (one per
--      account; local players have no account). Match rows are unchanged.
--   2. rpc_accept_team_invitation uses (or creates) the roster row, and accepting when
--      already in the team only answers the invitation.
--   3. Before a MATCH row is deleted, team memberships and challenge squad entries that
--      point at it move to the player's roster row (created if missing), so the cascade
--      no longer removes anyone from a team. Existing memberships are not rewritten in
--      bulk: they move only when their match row is deleted.
--   4. rpc_create_team_local_player lets a team owner/admin/captain create the roster row
--      of a player without an account.
-- Readers of a user's jugadores rows already skip a NULL partido_id (see the Core report).

alter table public.jugadores alter column partido_id drop not null;

CREATE OR REPLACE FUNCTION public.rpc_accept_team_invitation(p_invitation_id uuid)
 RETURNS team_invitations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_invitation public.team_invitations%ROWTYPE;
  v_jugador_id public.jugadores.id%TYPE;
  v_player_name text;
  v_player_avatar text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT *
  INTO v_invitation
  FROM public.team_invitations ti
  WHERE ti.id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitacion no encontrada';
  END IF;

  IF v_invitation.invited_user_id <> v_uid THEN
    RAISE EXCEPTION 'No podes aceptar una invitacion ajena';
  END IF;

  IF v_invitation.status <> 'pending' THEN
    RAISE EXCEPTION 'La invitacion ya fue respondida';
  END IF;

  -- The team roster identity is the user's match-less jugadores row, never a match row
  -- (leaving that match used to delete the membership through the FK cascade).
  SELECT j.id
  INTO v_jugador_id
  FROM public.jugadores j
  WHERE j.usuario_id = v_uid
    AND j.partido_id IS NULL
  ORDER BY j.id
  LIMIT 1;

  IF v_jugador_id IS NULL THEN
    SELECT NULLIF(TRIM(u.nombre), ''), NULLIF(TRIM(u.avatar_url), '')
    INTO v_player_name, v_player_avatar
    FROM public.usuarios u
    WHERE u.id = v_uid;

    IF v_player_name IS NULL THEN
      SELECT split_part(COALESCE(au.email, 'Jugador'), '@', 1)
      INTO v_player_name
      FROM auth.users au
      WHERE au.id = v_uid;
    END IF;

    INSERT INTO public.jugadores (
      nombre,
      usuario_id,
      avatar_url,
      partido_id
    ) VALUES (
      COALESCE(v_player_name, 'Jugador'),
      v_uid,
      v_player_avatar,
      NULL
    )
    RETURNING id INTO v_jugador_id;
  END IF;

  -- Already in the team (by account, or through an older roster row): accepting again
  -- only answers the invitation.
  IF NOT EXISTS (
    SELECT 1
    FROM public.team_members tm
    WHERE tm.team_id = v_invitation.team_id
      AND (
        tm.user_id = v_uid
        OR tm.jugador_id IN (SELECT j.id FROM public.jugadores j WHERE j.usuario_id = v_uid)
      )
  ) THEN
  INSERT INTO public.team_members (
    team_id,
    jugador_id,
    user_id,
    permissions_role,
    role,
    is_captain
  ) VALUES (
    v_invitation.team_id,
    v_jugador_id,
    v_uid,
    'member',
    'player',
    false
  )
  ON CONFLICT (team_id, jugador_id)
  DO UPDATE
  SET
    user_id = COALESCE(team_members.user_id, EXCLUDED.user_id),
    permissions_role = CASE
      WHEN team_members.permissions_role IN ('owner', 'admin') THEN team_members.permissions_role
      ELSE 'member'
    END;
  END IF;

  UPDATE public.team_invitations ti
  SET
    status = 'accepted',
    responded_at = now(),
    updated_at = now()
  WHERE ti.id = v_invitation.id
  RETURNING * INTO v_invitation;

  UPDATE public.notifications n
  SET
    read = true,
    data = jsonb_set(COALESCE(n.data, '{}'::jsonb), '{status}', '"accepted"'::jsonb, true)
  WHERE n.user_id = v_uid
    AND n.type = 'team_invite'
    AND COALESCE(n.data->>'invitation_id', '') = v_invitation.id::text;

  RETURN v_invitation;
END;
$function$;


create or replace function app_private.keep_team_roster_on_match_player_delete()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_roster_id bigint;
begin
  if old.partido_id is null then
    return old;
  end if;

  if not exists (select 1 from public.team_members member_row where member_row.jugador_id = old.id)
     and not exists (select 1 from public.challenge_team_squad squad_row where squad_row.player_id = old.id) then
    return old;
  end if;

  if old.usuario_id is not null then
    select roster_row.id
    into v_roster_id
    from public.jugadores roster_row
    where roster_row.usuario_id = old.usuario_id
      and roster_row.partido_id is null
    order by roster_row.id
    limit 1;
  end if;

  if v_roster_id is null then
    insert into public.jugadores (nombre, usuario_id, avatar_url, partido_id)
    values (coalesce(nullif(btrim(old.nombre), ''), 'Jugador'), old.usuario_id, old.avatar_url, null)
    returning id into v_roster_id;
  end if;

  -- A team (or a squad) that already has the roster row keeps that one.
  delete from public.team_members member_row
  where member_row.jugador_id = old.id
    and exists (
      select 1 from public.team_members other_row
      where other_row.team_id = member_row.team_id
        and other_row.jugador_id = v_roster_id
    );
  update public.team_members
  set jugador_id = v_roster_id
  where jugador_id = old.id;

  delete from public.challenge_team_squad squad_row
  where squad_row.player_id = old.id
    and exists (
      select 1 from public.challenge_team_squad other_row
      where other_row.challenge_id = squad_row.challenge_id
        and other_row.team_id = squad_row.team_id
        and other_row.player_id = v_roster_id
    );
  update public.challenge_team_squad
  set player_id = v_roster_id
  where player_id = old.id;

  return old;
end;
$function$;

revoke all on function app_private.keep_team_roster_on_match_player_delete() from public;

drop trigger if exists trg_keep_team_roster_on_match_player_delete on public.jugadores;
create trigger trg_keep_team_roster_on_match_player_delete
before delete on public.jugadores
for each row execute function app_private.keep_team_roster_on_match_player_delete();

create or replace function public.rpc_create_team_local_player(p_team_id uuid, p_nombre text)
returns table (id bigint, usuario_id uuid, nombre text, avatar_url text, score numeric)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_nombre, ''));
begin
  if v_uid is null then
    raise exception 'Usuario no autenticado' using errcode = '42501';
  end if;
  if p_team_id is null or not public.team_user_is_admin_or_owner(p_team_id, v_uid) then
    raise exception 'Solo el owner, un admin o el capitan pueden agregar jugadores sin cuenta'
      using errcode = '42501';
  end if;
  if char_length(v_name) = 0 or char_length(v_name) > 80 then
    raise exception 'Nombre de jugador invalido' using errcode = '22023';
  end if;

  return query
  insert into public.jugadores as created_row (nombre, usuario_id, partido_id)
  values (v_name, null, null)
  returning created_row.id, created_row.usuario_id, created_row.nombre, created_row.avatar_url, created_row.score;
end;
$function$;

revoke all on function public.rpc_create_team_local_player(uuid, text) from public, anon;
grant execute on function public.rpc_create_team_local_player(uuid, text) to authenticated, service_role;

do $team_roster_identity_check$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'jugadores'
      and column_name = 'partido_id' and is_nullable = 'NO'
  ) then
    raise exception 'jugadores.partido_id must accept team roster rows';
  end if;
  if position('partido_id IS NULL' in pg_get_functiondef('public.rpc_accept_team_invitation(uuid)'::regprocedure)) = 0 then
    raise exception 'rpc_accept_team_invitation must anchor memberships to the roster row';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.jugadores'::regclass
      and tgname = 'trg_keep_team_roster_on_match_player_delete'
  ) then
    raise exception 'team roster trigger did not install';
  end if;
end
$team_roster_identity_check$;
