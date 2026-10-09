-- Core: the phone is a contact for the match organizer, not public data; and the public
-- profile is an explicit list.
--
-- usuarios.telefono is readable by every signed-in account (usuarios_select_authenticated
-- USING (true), every column granted), while Perfil promises "Teléfono (sólo visible para
-- admins)": the player card only hid it in the client. This migration (additive, safe for
-- installed apps) adds:
--   * app_private.usuarios_public_columns(): the explicit list of public profile columns.
--     Everything else (email, telefono, fecha_nacimiento, exact location, activity
--     timestamps, push settings and any future column) is private by default;
--   * get_public_profiles(uuid[]) now returns only that list (telefono included in the
--     private side);
--   * get_match_contact_phone(match, user): the phone for its owner, or for an organizer of
--     that match when the PLAYER acted toward it: joined it themselves (their own roster
--     row), asked to join it (request pending or approved) or accepted its invitation. What
--     the organizer alone can do does not count: anyone can create a match, add any account
--     to its roster or send it an invitation, and that must not turn into reading phones.
--     Anything else raises not_authorized.
--   * jugadores.added_by: who inserted the roster row, always set by the server
--     (auth.uid()) and never changed afterwards. Rows from before this migration have none
--     and do not count.
--   * match_join_requests: user_id and match_id can no longer be rewritten through the API
--     (the creator's update policy only checked the new status, so a request could be
--     re-pointed to another account).
-- Closing the table read itself is phase B (docs/database/core-review/), which now also
-- revokes telefono and uses this same list.

create or replace function app_private.usuarios_public_columns()
returns text[]
language sql
immutable
set search_path to ''
as $function$
  select array[
    'id', 'nombre', 'avatar_url', 'avatar_zoom', 'avatar_pos_x', 'avatar_pos_y',
    'ciudad', 'localidad', 'location_label', 'location_city', 'location_state', 'location_country',
    'posicion', 'posiciones', 'pierna_habil', 'nivel', 'numero', 'bio', 'nacionalidad', 'pais_codigo',
    'disponible_arquero', 'acepta_invitaciones', 'lesion_activa', 'is_active',
    'ranking', 'partidos_jugados', 'partidos_ganados', 'partidos_perdidos', 'partidos_empatados',
    'partidos_abandonados', 'mvps', 'guantes_dorados', 'tarjetas_rojas',
    'perfil_completo', 'profile_completion', 'created_at', 'updated_at'
  ]::text[]
$function$;

-- Not secret (it is the public list); the RPCs below read it as their owner.

create or replace function public.get_public_profiles(p_user_ids uuid[])
returns setof jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select (
    select coalesce(jsonb_object_agg(field.key, field.value), '{}'::jsonb)
    from jsonb_each(to_jsonb(profile_row)) field
    where field.key = any (app_private.usuarios_public_columns())
  )
  from public.usuarios profile_row
  where auth.uid() is not null
    and profile_row.id = any ((coalesce(p_user_ids, '{}'::uuid[]))[1:500])
$function$;

alter table public.jugadores add column if not exists added_by uuid;

comment on column public.jugadores.added_by is
  'Account that inserted the roster row (set by trigger from auth.uid(); null for rows created before 20261010128000 or by the backend).';

create or replace function app_private.tg_jugadores_added_by()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if tg_op = 'INSERT' then
    new.added_by := auth.uid();
  else
    new.added_by := old.added_by;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_jugadores_added_by on public.jugadores;
create trigger trg_jugadores_added_by
before insert or update on public.jugadores
for each row execute function app_private.tg_jugadores_added_by();

create or replace function app_private.tg_match_join_request_identity_immutable()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if current_user in ('anon', 'authenticated')
     and (new.user_id is distinct from old.user_id or new.match_id is distinct from old.match_id) then
    raise exception 'match_join_requests: user_id and match_id cannot change'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_match_join_request_identity_immutable on public.match_join_requests;
create trigger trg_match_join_request_identity_immutable
before update on public.match_join_requests
for each row execute function app_private.tg_match_join_request_identity_immutable();

create or replace function public.get_match_contact_phone(p_partido_id bigint, p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_phone text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_user_id is null then
    return null;
  end if;

  if p_user_id <> v_uid then
    if p_partido_id is null or not app_private.is_match_admin(p_partido_id, v_uid) then
      raise exception 'not_authorized: solo el organizador del partido ve el contacto'
        using errcode = '42501';
    end if;
    -- Only the player's own actions link them: a roster row they inserted themselves
    -- (added_by is set by the server), a join request (only its user can insert it, and its
    -- user_id/match_id cannot be rewritten), or an invitation they accepted (only the invitee
    -- can mark it 'accepted': send_match_invite always writes 'pending' and notifications
    -- are insert-self-only).
    if not (
      exists (
        select 1 from public.jugadores roster_player
        where roster_player.partido_id = p_partido_id and roster_player.usuario_id = p_user_id
          and roster_player.added_by = p_user_id
      )
      or exists (
        select 1 from public.match_join_requests join_request
        where join_request.match_id = p_partido_id and join_request.user_id = p_user_id
          and join_request.status in ('pending', 'approved')
      )
      or exists (
        select 1 from public.notifications invite_notice
        where invite_notice.user_id = p_user_id
          and invite_notice.type = 'match_invite'
          and lower(btrim(coalesce(invite_notice.data ->> 'status', ''))) = 'accepted'
          and (
            invite_notice.partido_id = p_partido_id
            or coalesce(invite_notice.data ->> 'match_id', '') = p_partido_id::text
            or coalesce(invite_notice.data ->> 'matchId', '') = p_partido_id::text
          )
      )
    ) then
      raise exception 'not_authorized: el jugador no se sumó, no pidió sumarse ni aceptó una invitación a este partido'
        using errcode = '42501';
    end if;
  end if;

  select nullif(btrim(profile_row.telefono), '')
  into v_phone
  from public.usuarios profile_row
  where profile_row.id = p_user_id;

  return v_phone;
end;
$function$;

revoke all on function public.get_match_contact_phone(bigint, uuid) from public, anon;
grant execute on function public.get_match_contact_phone(bigint, uuid) to authenticated, service_role;

do $contact_phone_check$
begin
  if 'telefono' = any (app_private.usuarios_public_columns())
     or 'email' = any (app_private.usuarios_public_columns()) then
    raise exception 'private columns cannot be in the public profile list';
  end if;
  if has_function_privilege('anon', 'public.get_match_contact_phone(bigint,uuid)', 'execute') then
    raise exception 'get_match_contact_phone must not be executable by anon';
  end if;
end
$contact_phone_check$;
