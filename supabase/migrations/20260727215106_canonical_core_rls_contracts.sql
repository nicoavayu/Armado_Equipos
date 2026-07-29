-- Core contracts that predated the tracked migration history.
--
-- Keep privileged membership lookups in a non-exposed schema so public RLS
-- policies do not recurse through partidos <-> jugadores.

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

create extension if not exists pg_cron with schema pg_catalog;

alter table public.partidos
  add column if not exists precio_cancha_por_persona numeric,
  add column if not exists equipos jsonb;

alter table public.match_join_requests
  add column if not exists cancelled_at timestamptz;

alter table public.partido_team_confirmations
  add column if not exists participants jsonb not null default '[]'::jsonb;

-- Historical functions pin search_path to public and some explicitly qualify
-- pgcrypto helpers as public.*. Keep narrow wrappers; no API role can execute
-- them directly.
create or replace function public.gen_random_uuid()
returns uuid
language sql
volatile
set search_path = ''
as $$
  select extensions.gen_random_uuid()
$$;

create or replace function public.gen_random_bytes(p_length integer)
returns bytea
language sql
volatile
set search_path = ''
as $$
  select extensions.gen_random_bytes(p_length)
$$;

revoke all on function public.gen_random_uuid() from public, anon, authenticated, service_role;
revoke all on function public.gen_random_bytes(integer) from public, anon, authenticated, service_role;

-- pg_dump --schema=public preserves the sync function but cannot preserve
-- triggers owned by auth.users. Reattach the canonical Auth -> usuarios bridge.
drop trigger if exists trg_sync_usuarios_from_auth_insert on auth.users;
create trigger trg_sync_usuarios_from_auth_insert
after insert on auth.users
for each row
execute function public.sync_usuarios_from_auth_users();

drop trigger if exists trg_sync_usuarios_from_auth_update on auth.users;
create trigger trg_sync_usuarios_from_auth_update
after update of email, raw_user_meta_data on auth.users
for each row
execute function public.sync_usuarios_from_auth_users();

insert into public.usuarios (
  id,
  nombre,
  email,
  avatar_url,
  ranking,
  partidos_jugados,
  acepta_invitaciones,
  perfil_completo,
  profile_completion,
  partidos_abandonados,
  updated_at
)
select
  auth_user.id,
  coalesce(
    nullif(trim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(auth_user.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(auth_user.email, ''), '@', 1), ''),
    'Jugador'
  ),
  auth_user.email,
  coalesce(
    nullif(trim(auth_user.raw_user_meta_data ->> 'avatar_url'), ''),
    nullif(trim(auth_user.raw_user_meta_data ->> 'picture'), '')
  ),
  5.0,
  0,
  true,
  false,
  0,
  0,
  now()
from auth.users auth_user
left join public.usuarios app_user on app_user.id = auth_user.id
where app_user.id is null
on conflict (id) do nothing;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to anon, authenticated, service_role;

create or replace function app_private.is_match_admin(
  p_partido_id bigint,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_user_id is not null
    and exists (
      select 1
      from public.partidos match_row
      where match_row.id = p_partido_id
        and coalesce(match_row.creado_por, match_row.admin_id) = p_user_id
    )
$$;

create or replace function app_private.is_match_player(
  p_partido_id bigint,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_user_id is not null
    and exists (
      select 1
      from public.jugadores player_row
      where player_row.partido_id = p_partido_id
        and player_row.usuario_id = p_user_id
    )
$$;

create or replace function app_private.is_match_starter(
  p_partido_id bigint,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_user_id is not null
    and exists (
      select 1
      from public.jugadores player_row
      where player_row.partido_id = p_partido_id
        and player_row.usuario_id = p_user_id
        and coalesce(player_row.is_substitute, false) = false
        and coalesce(player_row.titular, true) = true
    )
$$;

create or replace function app_private.is_public_match_visible(p_partido_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.partidos match_row
    where match_row.id = p_partido_id
      and match_row.codigo is not null
      and match_row.deleted_at is null
      and public.normalize_partido_estado(match_row.estado) not in ('deleted', 'cancelado')
  )
$$;

revoke all on all functions in schema app_private from public;
grant execute on all functions in schema app_private to anon, authenticated, service_role;

-- Compatibility RPCs that lived in pre-versioned SQL directories or remote
-- state and are still called by the shipped clients/functions.
create or replace function public.resolve_match_by_code(p_codigo text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select match_row.id
  from public.partidos match_row
  where upper(trim(match_row.codigo)) = upper(trim(coalesce(p_codigo, '')))
    and match_row.deleted_at is null
    and public.normalize_partido_estado(match_row.estado) not in ('deleted', 'cancelado')
  order by match_row.id desc
  limit 1
$$;

create or replace function public.get_partido_by_invite(
  p_partido_id bigint,
  p_codigo text
)
returns table (
  id bigint,
  nombre text,
  fecha date,
  hora time,
  sede text,
  modalidad text,
  cupo integer,
  foto_url text,
  codigo text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    match_row.id,
    match_row.nombre,
    match_row.fecha,
    nullif(match_row.hora, '')::time,
    match_row.sede,
    match_row.modalidad,
    coalesce(match_row.cupo_jugadores, 0),
    null::text,
    match_row.codigo
  from public.partidos match_row
  where match_row.id = p_partido_id
    and match_row.codigo = trim(p_codigo)
    and match_row.deleted_at is null
    and public.normalize_partido_estado(match_row.estado) not in ('deleted', 'cancelado')
$$;

create or replace function public.consume_guest_match_invite(
  p_partido_id bigint,
  p_token text
)
returns table (
  ok boolean,
  reason text,
  expires_at timestamptz,
  max_uses integer,
  uses_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite_row public.guest_match_invites%rowtype;
begin
  update public.guest_match_invites invite
  set uses_count = invite.uses_count + 1
  where invite.partido_id = p_partido_id
    and invite.token = p_token
    and invite.revoked_at is null
    and invite.expires_at > now()
    and invite.uses_count < invite.max_uses
  returning * into invite_row;

  if not found then
    return query
    select false, 'invalid_or_expired'::text, null::timestamptz, null::integer, null::integer;
    return;
  end if;

  return query
  select true, null::text, invite_row.expires_at, invite_row.max_uses, invite_row.uses_count;
end;
$$;

-- Guest invite consumption and player creation are one database operation.
-- The match row is the per-roster lock, so retries and concurrent joins share
-- the same capacity decision and substitute queue ordering.
create or replace function public.join_guest_match_with_invite(
  p_partido_id bigint,
  p_token text,
  p_guest_uuid uuid,
  p_nombre text,
  p_avatar_url text default null
)
returns table (
  ok boolean,
  status text,
  jugador_id bigint,
  nombre text,
  uuid uuid,
  is_substitute boolean,
  substitute_order smallint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_player public.jugadores%rowtype;
  joined_player public.jugadores%rowtype;
begin
  if p_partido_id is null
     or p_partido_id <= 0
     or p_token is null
     or p_guest_uuid is null
     or p_nombre is null
     or p_nombre <> btrim(p_nombre)
     or char_length(p_nombre) not between 1 and 40
  then
    return query
    select
      false,
      'invalid_payload'::text,
      null::bigint,
      null::text,
      null::uuid,
      null::boolean,
      null::smallint;
    return;
  end if;

  perform 1
  from public.partidos match_row
  where match_row.id = p_partido_id
  for update;

  if not found then
    return query
    select
      false,
      'not_found'::text,
      null::bigint,
      null::text,
      null::uuid,
      null::boolean,
      null::smallint;
    return;
  end if;

  select player_row.*
  into existing_player
  from public.jugadores player_row
  where player_row.partido_id = p_partido_id
    and player_row.uuid = p_guest_uuid;

  if found then
    if existing_player.usuario_id is null then
      return query
      select
        true,
        'already_joined'::text,
        existing_player.id,
        existing_player.nombre,
        existing_player.uuid,
        existing_player.is_substitute,
        existing_player.substitute_order;
    else
      return query
      select
        false,
        'guest_identity_conflict'::text,
        null::bigint,
        null::text,
        null::uuid,
        null::boolean,
        null::smallint;
    end if;
    return;
  end if;

  begin
    update public.guest_match_invites invite
    set uses_count = invite.uses_count + 1
    where invite.partido_id = p_partido_id
      and invite.token = p_token
      and invite.revoked_at is null
      and invite.expires_at > now()
      and invite.uses_count < invite.max_uses;

    if not found then
      return query
      select
        false,
        'invalid_invite'::text,
        null::bigint,
        null::text,
        null::uuid,
        null::boolean,
        null::smallint;
      return;
    end if;

    insert into public.jugadores (
      partido_id,
      usuario_id,
      nombre,
      uuid,
      avatar_url
    )
    values (
      p_partido_id,
      null,
      p_nombre,
      p_guest_uuid,
      p_avatar_url
    )
    returning * into joined_player;
  exception
    when unique_violation then
      select player_row.*
      into existing_player
      from public.jugadores player_row
      where player_row.partido_id = p_partido_id
        and player_row.uuid = p_guest_uuid;

      if found and existing_player.usuario_id is null then
        return query
        select
          true,
          'already_joined'::text,
          existing_player.id,
          existing_player.nombre,
          existing_player.uuid,
          existing_player.is_substitute,
          existing_player.substitute_order;
      else
        return query
        select
          false,
          'guest_identity_conflict'::text,
          null::bigint,
          null::text,
          null::uuid,
          null::boolean,
          null::smallint;
      end if;
      return;
    when raise_exception then
      if sqlerrm = 'MATCH_FULL_WITH_SUBSTITUTES' then
        return query
        select
          false,
          'full'::text,
          null::bigint,
          null::text,
          null::uuid,
          null::boolean,
          null::smallint;
        return;
      end if;
      raise;
  end;

  return query
  select
    true,
    'accepted'::text,
    joined_player.id,
    joined_player.nombre,
    joined_player.uuid,
    joined_player.is_substitute,
    joined_player.substitute_order;
end;
$$;

create or replace function public.delete_my_notifications()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count bigint;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  delete from public.notifications notification_row
  where notification_row.user_id = auth.uid();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

create or replace function public.inc_numeric(
  p_table text,
  p_column text,
  p_id uuid,
  p_amount numeric default 1
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_table <> 'usuarios'
     or p_column not in (
       'partidos_jugados', 'partidos_ganados', 'partidos_perdidos',
       'partidos_empatados', 'partidos_abandonados', 'mvps',
       'guantes_dorados', 'tarjetas_rojas'
     ) then
    raise exception using errcode = '42501', message = 'numeric_target_not_allowed';
  end if;
  if p_id <> auth.uid()
     and not exists (
       select 1
       from public.jugadores player_row
       join public.partidos match_row on match_row.id = player_row.partido_id
       where player_row.usuario_id = p_id
         and coalesce(match_row.creado_por, match_row.admin_id) = auth.uid()
     ) then
    raise exception using errcode = '42501', message = 'numeric_target_not_authorized';
  end if;

  execute format(
    'update public.usuarios set %I = coalesce(%I, 0) + $1, updated_at = now() where id = $2',
    p_column,
    p_column
  ) using p_amount, p_id;
end;
$$;

create or replace function public.increment_matches_played(user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select public.inc_numeric('usuarios', 'partidos_jugados', user_id, 1)
$$;

create or replace function public.increment_matches_abandoned(user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select public.inc_numeric('usuarios', 'partidos_abandonados', user_id, 1)
$$;

revoke all on function public.resolve_match_by_code(text) from public, anon, authenticated, service_role;
revoke all on function public.get_partido_by_invite(bigint, text) from public, anon, authenticated, service_role;
revoke all on function public.consume_guest_match_invite(bigint, text) from public, anon, authenticated, service_role;
revoke all on function public.join_guest_match_with_invite(bigint, text, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.assign_substitute_slot() from public, anon, authenticated, service_role;
revoke all on function public.promote_substitute_after_player_leave() from public, anon, authenticated, service_role;
revoke all on function public.delete_my_notifications() from public, anon, authenticated, service_role;
revoke all on function public.inc_numeric(text, text, uuid, numeric) from public, anon, authenticated, service_role;
revoke all on function public.increment_matches_played(uuid) from public, anon, authenticated, service_role;
revoke all on function public.increment_matches_abandoned(uuid) from public, anon, authenticated, service_role;

grant execute on function public.resolve_match_by_code(text) to anon, authenticated, service_role;
grant execute on function public.get_partido_by_invite(bigint, text) to anon, authenticated, service_role;
grant execute on function public.consume_guest_match_invite(bigint, text) to service_role;
grant execute on function public.join_guest_match_with_invite(bigint, text, uuid, text, text) to service_role;
grant execute on function public.delete_my_notifications() to authenticated, service_role;
grant execute on function public.inc_numeric(text, text, uuid, numeric) to authenticated, service_role;
grant execute on function public.increment_matches_played(uuid) to authenticated, service_role;
grant execute on function public.increment_matches_abandoned(uuid) to authenticated, service_role;

-- Required by send_call_to_vote's stable ON CONFLICT target. NULL match keys
-- remain unconstrained, while per-match notification retries are idempotent.
create unique index if not exists notifications_user_match_type_unique
on public.notifications (user_id, (data ->> 'match_id'), type);

-- Profiles: searchable by signed-in users, writable only by the owner.
create policy usuarios_select_authenticated
on public.usuarios for select
to authenticated
using (true);

create policy usuarios_insert_own
on public.usuarios for insert
to authenticated
with check (id = (select auth.uid()));

create policy usuarios_update_own
on public.usuarios for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy profiles_select_authenticated
on public.profiles for select
to authenticated
using (true);

create policy profiles_insert_own
on public.profiles for insert
to authenticated
with check (id = (select auth.uid()));

create policy profiles_update_own
on public.profiles for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- Matches: public shared-code pages keep working; signed-in discovery can read
-- operational rows, while direct mutations remain creator-owned.
create policy partidos_select_public_shared
on public.partidos for select
to anon
using (app_private.is_public_match_visible(id));

create policy partidos_select_authenticated
on public.partidos for select
to authenticated
using (deleted_at is null or app_private.is_match_admin(id));

create policy partidos_insert_creator
on public.partidos for insert
to authenticated
with check (
  creado_por = (select auth.uid())
  and (admin_id is null or admin_id = (select auth.uid()))
);

create policy partidos_update_admin
on public.partidos for update
to authenticated
using (app_private.is_match_admin(id))
with check (app_private.is_match_admin(id));

create policy partidos_delete_admin
on public.partidos for delete
to authenticated
using (app_private.is_match_admin(id));

-- Roster reads feed public invites/voting. Writes are self-service or admin.
create policy jugadores_select_public_shared
on public.jugadores for select
to anon
using (app_private.is_public_match_visible(partido_id));

create policy jugadores_select_authenticated
on public.jugadores for select
to authenticated
using (true);

create policy jugadores_insert_self_or_admin
on public.jugadores for insert
to authenticated
with check (
  usuario_id = (select auth.uid())
  or app_private.is_match_admin(partido_id)
);

create policy jugadores_update_self_or_admin
on public.jugadores for update
to authenticated
using (
  usuario_id = (select auth.uid())
  or app_private.is_match_admin(partido_id)
)
with check (
  usuario_id = (select auth.uid())
  or app_private.is_match_admin(partido_id)
);

create policy jugadores_delete_self_or_admin
on public.jugadores for delete
to authenticated
using (
  usuario_id = (select auth.uid())
  or app_private.is_match_admin(partido_id)
);

-- Authenticated voting is starter-only. Public voting writes stay behind the
-- code/token RPCs and therefore receive no direct anon write policy.
create policy votos_select_match_member
on public.votos for select
to authenticated
using (
  app_private.is_match_player(partido_id)
  or app_private.is_match_admin(partido_id)
);

create policy votos_insert_starter
on public.votos for insert
to authenticated
with check (
  app_private.is_match_starter(partido_id)
  and exists (
    select 1
    from public.jugadores voter
    where voter.partido_id = votos.partido_id
      and voter.usuario_id = (select auth.uid())
      and (
        voter.id::text = votos.votante_id
        or voter.uuid::text = votos.votante_id
        or voter.usuario_id::text = votos.votante_id
      )
  )
);

create policy votos_delete_owner_or_admin
on public.votos for delete
to authenticated
using (
  app_private.is_match_admin(partido_id)
  or exists (
    select 1
    from public.jugadores voter
    where voter.partido_id = votos.partido_id
      and voter.usuario_id = (select auth.uid())
      and (
        voter.id::text = votos.votante_id
        or voter.uuid::text = votos.votante_id
        or voter.usuario_id::text = votos.votante_id
      )
  )
);

create policy public_voters_select_match_member
on public.public_voters for select
to authenticated
using (
  app_private.is_match_player(partido_id)
  or app_private.is_match_admin(partido_id)
);

create policy votos_publicos_select_match_member
on public.votos_publicos for select
to authenticated
using (
  app_private.is_match_player(partido_id)
  or app_private.is_match_admin(partido_id)
);

-- Post-match responses and aggregate snapshots.
create policy post_match_surveys_select_member
on public.post_match_surveys for select
to authenticated
using (
  app_private.is_match_player(partido_id)
  or app_private.is_match_admin(partido_id)
);

create policy post_match_surveys_insert_own_starter
on public.post_match_surveys for insert
to authenticated
with check (
  app_private.is_match_starter(partido_id)
  and exists (
    select 1
    from public.jugadores voter
    where voter.id = post_match_surveys.votante_id
      and voter.partido_id = post_match_surveys.partido_id
      and voter.usuario_id = (select auth.uid())
  )
);

create policy survey_results_select_member
on public.survey_results for select
to authenticated
using (
  app_private.is_match_player(partido_id)
  or app_private.is_match_admin(partido_id)
);

create policy survey_results_insert_member
on public.survey_results for insert
to authenticated
with check (
  app_private.is_match_player(partido_id)
  or app_private.is_match_admin(partido_id)
);

create policy survey_results_update_member
on public.survey_results for update
to authenticated
using (
  app_private.is_match_player(partido_id)
  or app_private.is_match_admin(partido_id)
)
with check (
  app_private.is_match_player(partido_id)
  or app_private.is_match_admin(partido_id)
);

create policy partido_team_confirmations_select_member
on public.partido_team_confirmations for select
to authenticated
using (
  app_private.is_match_player(partido_id)
  or app_private.is_match_admin(partido_id)
);

create policy partido_team_confirmations_write_admin
on public.partido_team_confirmations for all
to authenticated
using (app_private.is_match_admin(partido_id))
with check (app_private.is_match_admin(partido_id));

create policy player_awards_select_authenticated
on public.player_awards for select
to authenticated
using (true);

create policy player_awards_insert_match_member
on public.player_awards for insert
to authenticated
with check (
  app_private.is_match_player(partido_id)
  or app_private.is_match_admin(partido_id)
);

-- Social graph and user-owned utility tables.
create policy amigos_select_related
on public.amigos for select
to authenticated
using (
  user_id = (select auth.uid())
  or friend_id = (select auth.uid())
);

create policy amigos_insert_sender
on public.amigos for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and friend_id <> (select auth.uid())
);

create policy amigos_update_recipient_or_sender
on public.amigos for update
to authenticated
using (
  user_id = (select auth.uid())
  or friend_id = (select auth.uid())
)
with check (
  user_id = (select auth.uid())
  or friend_id = (select auth.uid())
);

create policy amigos_delete_related
on public.amigos for delete
to authenticated
using (
  user_id = (select auth.uid())
  or friend_id = (select auth.uid())
);

create policy partidos_frecuentes_manage_owner
on public.partidos_frecuentes for all
to authenticated
using (coalesce(usuario_id, creado_por) = (select auth.uid()))
with check (coalesce(usuario_id, creado_por) = (select auth.uid()));

create policy partidos_manuales_manage_owner
on public.partidos_manuales for all
to authenticated
using (usuario_id = (select auth.uid()))
with check (usuario_id = (select auth.uid()));

create policy lesiones_manage_owner
on public.lesiones for all
to authenticated
using (usuario_id = (select auth.uid()))
with check (usuario_id = (select auth.uid()));

create policy player_absences_manage_owner
on public.player_absences for all
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy cleared_matches_manage_owner
on public.cleared_matches for all
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- Penalty/recovery writes are allowed only for the affected player or an
-- administrator of a match containing that player.
drop policy if exists no_show_recovery_state_insert_authenticated
on public.no_show_recovery_state;
drop policy if exists no_show_recovery_state_update_authenticated
on public.no_show_recovery_state;

create policy no_show_recovery_state_insert_authorized
on public.no_show_recovery_state for insert
to authenticated
with check (
  user_id = (select auth.uid())
  or exists (
    select 1
    from public.jugadores player_row
    where player_row.usuario_id = no_show_recovery_state.user_id
      and app_private.is_match_admin(player_row.partido_id)
  )
);

create policy no_show_recovery_state_update_authorized
on public.no_show_recovery_state for update
to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1
    from public.jugadores player_row
    where player_row.usuario_id = no_show_recovery_state.user_id
      and app_private.is_match_admin(player_row.partido_id)
  )
)
with check (
  user_id = (select auth.uid())
  or exists (
    select 1
    from public.jugadores player_row
    where player_row.usuario_id = no_show_recovery_state.user_id
      and app_private.is_match_admin(player_row.partido_id)
  )
);

drop policy if exists rating_adjustments_insert_authenticated
on public.rating_adjustments;

create policy rating_adjustments_insert_authorized
on public.rating_adjustments for insert
to authenticated
with check (
  user_id = (select auth.uid())
  or app_private.is_match_admin(partido_id)
);

drop policy if exists survey_progress_authenticated_all
on public.survey_progress;

create policy survey_progress_select_member
on public.survey_progress for select
to authenticated
using (
  app_private.is_match_player(partido_id)
  or app_private.is_match_admin(partido_id)
);

create policy survey_progress_insert_admin
on public.survey_progress for insert
to authenticated
with check (app_private.is_match_admin(partido_id));

create policy survey_progress_update_admin
on public.survey_progress for update
to authenticated
using (app_private.is_match_admin(partido_id))
with check (app_private.is_match_admin(partido_id));

create policy survey_progress_delete_admin
on public.survey_progress for delete
to authenticated
using (app_private.is_match_admin(partido_id));

-- In-app notifications are private to their recipient. Keep the historical
-- authenticated insert contract because several current clients fan out
-- notifications directly; the target must still be a real auth user.
create policy notifications_select_own
on public.notifications for select
to authenticated
using (user_id = (select auth.uid()));

create policy notifications_update_own
on public.notifications for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy notifications_delete_own
on public.notifications for delete
to authenticated
using (user_id = (select auth.uid()));

-- Realtime contracts used by personal matches and notifications.
do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'public.partidos',
    'public.jugadores',
    'public.notifications',
    'public.mensajes_partido'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table %s', relation_name);
    exception
      when duplicate_object then null;
    end;
  end loop;
end
$$;

-- Pin the remaining legacy helpers that did not declare a search_path. This
-- removes role-mutable resolution without rewriting their bodies.
do $$
declare
  procedure_row record;
begin
  for procedure_row in
    select procedure_oid.oid, procedure_oid.oid::regprocedure as signature
    from pg_proc procedure_oid
    where procedure_oid.pronamespace = 'public'::regnamespace
      and not exists (
        select 1
        from unnest(coalesce(procedure_oid.proconfig, array[]::text[])) setting
        where setting like 'search_path=%'
      )
  loop
    execute format(
      'alter function %s set search_path = public, extensions',
      procedure_row.signature
    );
  end loop;
end
$$;

drop index if exists public.idx_notification_delivery_log_unique_per_correlation;

-- pg_dump of the public schema cannot include pg_cron state. Recreate the
-- final scheduler contract after every reset.
do $$
declare
  scheduled_job record;
begin
  for scheduled_job in
    select jobid
    from cron.job
    where jobname = any(array[
      'survey_start_backend_scheduler',
      'match_reminder_1h_scheduler',
      'survey_reminder_backend_scheduler',
      'push_sender_dispatch_scheduler',
      'notifications_retention_cleanup_scheduler',
      'challenge_result_survey_backend_fanout',
      'directed_challenge_expiry_scheduler',
      'auto_match_sweep'
    ])
  loop
    perform cron.unschedule(scheduled_job.jobid);
  end loop;

  perform cron.schedule(
    'survey_start_backend_scheduler',
    '* * * * *',
    'select public.process_survey_start_notifications_backend();'
  );
  perform cron.schedule(
    'match_reminder_1h_scheduler',
    '*/5 * * * *',
    'select public.process_match_reminder_notifications_backend();'
  );
  perform cron.schedule(
    'survey_reminder_backend_scheduler',
    '* * * * *',
    'select public.process_survey_reminder_notifications_backend(60, 1, 200);'
  );
  perform cron.schedule(
    'push_sender_dispatch_scheduler',
    '* * * * *',
    'select public.run_push_sender_scheduler_tick();'
  );
  perform cron.schedule(
    'notifications_retention_cleanup_scheduler',
    '17 3 * * *',
    'select public.run_notifications_retention_cleanup();'
  );
  perform cron.schedule(
    'challenge_result_survey_backend_fanout',
    '* * * * *',
    'select public.process_challenge_result_survey_notifications_backend(200);'
  );
  perform cron.schedule(
    'directed_challenge_expiry_scheduler',
    '*/10 * * * *',
    'select public.expire_stale_directed_challenges();'
  );
  perform cron.schedule(
    'auto_match_sweep',
    '*/5 * * * *',
    'select public.auto_match_scheduled_sweep();'
  );
end
$$;


-- Canonical integration: safe-main Stage A followed by Stage B.
-- Logical rollout order is intentional: every Stage A compatibility contract,
-- including the 20260726120000 hotfix, is installed before final Stage B closure.

-- BEGIN incorporated migration: 20260724121000_secure_no_show_ranking_stage_a.sql
-- ===========================================================================
-- Security patch M1 — No-show ranking (Stage A)
-- ---------------------------------------------------------------------------
-- Closes the confirmed hole where any `authenticated` user could forge rows in
-- `rating_adjustments` / `no_show_recovery_state` (SELECT/INSERT/UPDATE `true`).
--
-- Stage A (this migration) is ADDITIVE and NON-BREAKING for pre-patch clients:
--   * Adds the single authoritative, transactional, idempotent RPC
--     `process_match_no_show_ranking(p_partido_id, p_emit_notifications)` that
--     recomputes penalties/recoveries EXCLUSIVELY from post_match_surveys, never
--     trusts client-supplied amounts and never lets the client pick who to
--     penalize. Writes rating_adjustments + no_show_recovery_state + usuarios
--     aggregates in ONE transaction; safe to retry (ON CONFLICT / recompute).
--   * Tightens SELECT on both tables (own rows, or a match shared with the row's
--     user for the results view). This is safe: StatsView reads own rows and the
--     survey-results view reads co-players.
--   * Adds NOT VALID domain CHECK constraints as an immediate mitigation for the
--     window where legacy clients still hold direct INSERT.
--
-- The direct INSERT/UPDATE/DELETE grants for `authenticated` are intentionally
-- LEFT IN PLACE here; they are revoked in Stage B
-- (20260724131000_revoke_direct_rating_writes_stage_b.sql) once the secure app
-- build (1.1.19/40) is live. Rollback SQL is documented at the bottom.
--
-- Behaviour parity: constants and formulas mirror src/services/db/penalties.js
-- exactly (threshold 2 confirmations, penalty -0.5, recovery step 0.2, cycle
-- every 3 assists, rating clamp 1..10). No formula/value/behaviour change.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Rating clamp helper (mirrors utils/playerRating: min 1, max 10, 2 dp).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._clamp_player_rating(p_value numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT round(LEAST(10::numeric, GREATEST(1::numeric, COALESCE(p_value, 1))), 2);
$$;

REVOKE ALL ON FUNCTION public._clamp_player_rating(numeric) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Internal helpers — confirmed absentees and eligibility for a match.
--    Derived ONLY from post_match_surveys. Kept out of PostgREST (no grants).
-- ---------------------------------------------------------------------------

-- A match is eligible for no-show processing when at least one survey row says
-- the match was played (se_jugo=true) OR was not played due to a confirmed
-- absence-without-notice reason.
CREATE OR REPLACE FUNCTION public._match_no_show_eligible(p_partido_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.post_match_surveys s
    WHERE s.partido_id = p_partido_id
      AND (
        s.se_jugo IS TRUE
        OR (
          s.se_jugo IS FALSE
          AND lower(btrim(COALESCE(s.motivo_no_jugado, ''))) IN
              ('absence_without_notice', 'ausencia_sin_aviso')
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public._match_no_show_eligible(bigint) FROM PUBLIC, anon, authenticated;

-- Player ids confirmed absent for a match: absentee referenced by >=2 DISTINCT
-- voters (a voter cannot confirm their own absence). Only counts eligible
-- survey rows. Mirrors buildAbsentConfirmMap + ABSENCE_CONFIRMATION_THRESHOLD.
CREATE OR REPLACE FUNCTION public._no_show_confirmed_absent_player_ids(p_partido_id bigint)
RETURNS bigint[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH eligible AS (
    SELECT s.votante_id, s.jugadores_ausentes
    FROM public.post_match_surveys s
    WHERE s.partido_id = p_partido_id
      AND (
        s.se_jugo IS TRUE
        OR (
          s.se_jugo IS FALSE
          AND lower(btrim(COALESCE(s.motivo_no_jugado, ''))) IN
              ('absence_without_notice', 'ausencia_sin_aviso')
        )
      )
      AND s.votante_id IS NOT NULL
  ),
  expanded AS (
    SELECT e.votante_id::text AS voter,
           (absent_elem)::bigint AS absent_player_id
    FROM eligible e
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(to_jsonb(e.jugadores_ausentes), '[]'::jsonb)) AS absent_elem
    WHERE absent_elem ~ '^[0-9]+$'
  ),
  filtered AS (
    -- a voter cannot confirm their own absence
    SELECT absent_player_id, voter
    FROM expanded
    WHERE voter <> absent_player_id::text
  )
  SELECT COALESCE(array_agg(absent_player_id ORDER BY absent_player_id), ARRAY[]::bigint[])
  FROM (
    SELECT absent_player_id
    FROM filtered
    GROUP BY absent_player_id
    HAVING COUNT(DISTINCT voter) >= 2
  ) confirmed;
$$;

REVOKE ALL ON FUNCTION public._no_show_confirmed_absent_player_ids(bigint) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Authoritative, transactional, idempotent no-show processor.
--    Authorization equivalent to legitimate survey closure
--    (creator or participant of the match; see finalize_match_survey_closure).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_match_no_show_ranking(
  p_partido_id bigint,
  p_emit_notifications boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_authorized boolean := false;
  v_match_name text;
  v_confirmed bigint[];
  v_penalized uuid[] := ARRAY[]::uuid[];
  v_recovered uuid[] := ARRAY[]::uuid[];
  r record;
  v_uid_user uuid;
  v_debt numeric;
  v_streak int;
  v_new_streak int;
  v_current_rating numeric;
  v_headroom numeric;
  v_recover numeric;
  v_inserted bigint;
  v_base_ranking numeric;
  v_base_abandoned int;
  v_sum_amount numeric;
  v_penalty_count int;
  v_final_streak int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_partido_id IS NULL OR p_partido_id <= 0 THEN
    RAISE EXCEPTION 'invalid_match_id' USING ERRCODE = '22023';
  END IF;

  SELECT
    (p.creado_por = v_uid
     OR EXISTS (SELECT 1 FROM public.jugadores j
                WHERE j.partido_id = p.id AND j.usuario_id = v_uid)),
    p.nombre
  INTO v_authorized, v_match_name
  FROM public.partidos p
  WHERE p.id = p_partido_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'match_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_match_name := COALESCE(NULLIF(btrim(v_match_name), ''), 'partido ' || p_partido_id::text);

  -- Do NOT modify any rating before the survey is genuinely closed AND its
  -- results are finalized. This rejects premature calls (partial surveys while
  -- the survey window is still open): no adjustment is written.
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.partidos p
      WHERE p.id = p_partido_id
        AND lower(COALESCE(p.survey_status, '')) = 'closed'
    )
    AND EXISTS (
      SELECT 1 FROM public.survey_results sr
      WHERE sr.partido_id = p_partido_id
        AND sr.results_ready IS TRUE
    )
  ) THEN
    RAISE EXCEPTION 'survey_not_closed' USING ERRCODE = '55000';
  END IF;

  -- Nothing to do if the match is not eligible for no-show processing.
  IF NOT public._match_no_show_eligible(p_partido_id) THEN
    RETURN jsonb_build_object('success', true, 'penalized', '[]'::jsonb, 'recovered', '[]'::jsonb);
  END IF;

  v_confirmed := public._no_show_confirmed_absent_player_ids(p_partido_id);

  -- --- Capture aggregate bases BEFORE inserting this run's adjustments -------
  -- Tracked users = every registered player of this match. base = current value
  -- with all existing no-show effects stripped out (idempotent reconcile).
  CREATE TEMP TABLE _ns_base ON COMMIT DROP AS
  WITH tracked AS (
    SELECT DISTINCT j.usuario_id AS uid
    FROM public.jugadores j
    WHERE j.partido_id = p_partido_id
      AND j.usuario_id IS NOT NULL
  ),
  adj AS (
    SELECT ra.user_id AS uid,
           COALESCE(SUM(ra.amount), 0)::numeric AS sum_amount,
           COUNT(*) FILTER (WHERE ra.type = 'no_show_penalty')::int AS penalty_count
    FROM public.rating_adjustments ra
    JOIN tracked t ON t.uid = ra.user_id
    WHERE ra.type IN ('no_show_penalty', 'no_show_recovery')
    GROUP BY ra.user_id
  )
  SELECT
    t.uid,
    public._clamp_player_rating(COALESCE(u.ranking, 0) - COALESCE(a.sum_amount, 0)) AS base_ranking,
    GREATEST(0, COALESCE(u.partidos_abandonados, 0) - COALESCE(a.penalty_count, 0)) AS base_abandoned
  FROM tracked t
  JOIN public.usuarios u ON u.id = t.uid
  LEFT JOIN adj a ON a.uid = t.uid;

  -- --- Penalties: confirmed absentees mapped to their usuario_id -------------
  IF array_length(v_confirmed, 1) IS NOT NULL THEN
    FOR r IN
      SELECT DISTINCT j.usuario_id AS uid
      FROM public.jugadores j
      WHERE j.partido_id = p_partido_id
        AND j.usuario_id IS NOT NULL
        AND j.id = ANY (v_confirmed)
    LOOP
      INSERT INTO public.rating_adjustments (user_id, partido_id, type, amount, meta, created_at)
      VALUES (
        r.uid, p_partido_id, 'no_show_penalty', -0.5,
        jsonb_build_object('reason', 'absence_without_notice'),
        now()
      )
      ON CONFLICT (user_id, partido_id, type) DO NOTHING;

      IF FOUND THEN
        v_penalized := array_append(v_penalized, r.uid);
      END IF;
    END LOOP;
  END IF;

  -- --- Recoveries: attendees with outstanding debt at a 3-assist cycle -------
  FOR r IN
    SELECT DISTINCT j.id AS player_id, j.usuario_id AS uid
    FROM public.jugadores j
    WHERE j.partido_id = p_partido_id
      AND j.usuario_id IS NOT NULL
  LOOP
    v_uid_user := r.uid;

    -- attended = NOT confirmed absent
    IF v_confirmed IS NOT NULL AND r.player_id = ANY (v_confirmed) THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(CASE WHEN ra.type = 'no_show_penalty' THEN abs(ra.amount) ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN ra.type = 'no_show_recovery' THEN GREATEST(0, ra.amount) ELSE 0 END), 0)
    INTO v_debt
    FROM public.rating_adjustments ra
    WHERE ra.user_id = v_uid_user
      AND ra.type IN ('no_show_penalty', 'no_show_recovery');

    IF v_debt <= 0 THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(s.current_streak, 0) INTO v_streak
    FROM public.no_show_recovery_state s
    WHERE s.user_id = v_uid_user;
    v_streak := COALESCE(v_streak, 0);
    v_new_streak := v_streak + 1;

    IF v_new_streak % 3 <> 0 THEN
      CONTINUE;
    END IF;

    -- Skip if a recovery for this match already exists (idempotent).
    IF EXISTS (
      SELECT 1 FROM public.rating_adjustments ra
      WHERE ra.user_id = v_uid_user
        AND ra.partido_id = p_partido_id
        AND ra.type = 'no_show_recovery'
    ) THEN
      CONTINUE;
    END IF;

    SELECT public._clamp_player_rating(u.ranking) INTO v_current_rating
    FROM public.usuarios u WHERE u.id = v_uid_user;
    v_headroom := GREATEST(0, 10::numeric - COALESCE(v_current_rating, 1));
    v_recover := round(LEAST(0.2::numeric, v_debt, v_headroom), 2);

    IF v_recover <= 0 THEN
      CONTINUE;
    END IF;

    INSERT INTO public.rating_adjustments (user_id, partido_id, type, amount, meta, created_at)
    VALUES (
      v_uid_user, p_partido_id, 'no_show_recovery', v_recover,
      jsonb_build_object('cycle_index', v_new_streak / 3, 'source_partido_id', p_partido_id),
      now()
    )
    ON CONFLICT (user_id, partido_id, type) DO NOTHING;

    IF FOUND THEN
      v_recovered := array_append(v_recovered, v_uid_user);
    END IF;
  END LOOP;

  -- --- Reconcile aggregates from base + all adjustments (idempotent) ---------
  FOR r IN SELECT uid, base_ranking, base_abandoned FROM _ns_base LOOP
    SELECT COALESCE(SUM(ra.amount), 0)::numeric,
           COUNT(*) FILTER (WHERE ra.type = 'no_show_penalty')::int
    INTO v_sum_amount, v_penalty_count
    FROM public.rating_adjustments ra
    WHERE ra.user_id = r.uid
      AND ra.type IN ('no_show_penalty', 'no_show_recovery');

    UPDATE public.usuarios u
    SET ranking = public._clamp_player_rating(r.base_ranking + COALESCE(v_sum_amount, 0)),
        partidos_abandonados = GREATEST(0, r.base_abandoned + COALESCE(v_penalty_count, 0))
    WHERE u.id = r.uid;

    -- Streak derived by replaying the user's closed, eligible match history.
    v_final_streak := public._derive_no_show_streak(r.uid);

    INSERT INTO public.no_show_recovery_state (user_id, current_streak, updated_at)
    VALUES (r.uid, v_final_streak, now())
    ON CONFLICT (user_id) DO UPDATE
      SET current_streak = EXCLUDED.current_streak,
          updated_at = now();
  END LOOP;

  -- --- Notifications for newly applied penalties/recoveries (server content) -
  IF p_emit_notifications THEN
    IF array_length(v_penalized, 1) IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, message, data, read, partido_id, created_at)
      SELECT uid, 'no_show_penalty',
             'Perdiste ranking por inasistencia',
             'Perdiste 0,5 puntos de ranking por faltar al partido "' || v_match_name || '".',
             jsonb_build_object('match_name', v_match_name, 'ranking_delta', -0.5),
             false, p_partido_id, now()
      FROM unnest(v_penalized) AS uid;
    END IF;

    IF array_length(v_recovered, 1) IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, message, data, read, partido_id, created_at)
      SELECT ra.user_id, 'no_show_recovery',
             'Recuperaste ranking',
             'Recuperaste puntos de ranking por cumplir 3 partidos sin faltar. Último partido contabilizado: "' || v_match_name || '".',
             jsonb_build_object('match_name', v_match_name, 'ranking_delta', ra.amount),
             false, p_partido_id, now()
      FROM public.rating_adjustments ra
      WHERE ra.partido_id = p_partido_id
        AND ra.type = 'no_show_recovery'
        AND ra.user_id = ANY (v_recovered);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'penalized', to_jsonb(v_penalized),
    'recovered', to_jsonb(v_recovered)
  );
END;
$$;

-- Streak derivation (buildCurrentRecoveryStates): replays the user's closed,
-- eligible matches chronologically. Split out so the reconcile loop stays
-- readable and so tests can target it directly.
CREATE OR REPLACE FUNCTION public._derive_no_show_streak(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debt numeric := 0;
  v_streak int := 0;
  m record;
  v_absent boolean;
  v_penalty numeric;
  v_recovery numeric;
BEGIN
  FOR m IN
    SELECT j.partido_id,
           j.id AS player_id,
           COALESCE(sr.encuesta_cerrada_at, sr.finished_at, sr.updated_at, sr.created_at) AS closed_at
    FROM public.jugadores j
    JOIN public.survey_results sr
      ON sr.partido_id = j.partido_id AND sr.results_ready IS TRUE
    WHERE j.usuario_id = p_user_id
      AND public._match_no_show_eligible(j.partido_id)
    ORDER BY COALESCE(sr.encuesta_cerrada_at, sr.finished_at, sr.updated_at, sr.created_at) NULLS FIRST,
             j.partido_id
  LOOP
    v_absent := (m.player_id = ANY (public._no_show_confirmed_absent_player_ids(m.partido_id)));

    SELECT COALESCE(SUM(CASE WHEN ra.type = 'no_show_penalty' THEN abs(ra.amount) ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN ra.type = 'no_show_recovery' THEN GREATEST(0, ra.amount) ELSE 0 END), 0)
    INTO v_penalty, v_recovery
    FROM public.rating_adjustments ra
    WHERE ra.user_id = p_user_id AND ra.partido_id = m.partido_id;

    IF v_absent THEN
      v_debt := round(v_debt + v_penalty, 2);
      v_streak := 0;
    ELSIF v_debt <= 0 THEN
      v_debt := round(GREATEST(0, v_debt - v_recovery), 2);
      v_streak := 0;
    ELSE
      v_debt := round(GREATEST(0, v_debt - v_recovery), 2);
      v_streak := v_streak + 1;
    END IF;
  END LOOP;

  RETURN v_streak;
END;
$$;

REVOKE ALL ON FUNCTION public._derive_no_show_streak(uuid) FROM PUBLIC, anon, authenticated;

-- The authoritative RPC is callable only by authenticated + service_role.
REVOKE ALL ON FUNCTION public.process_match_no_show_ranking(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_match_no_show_ranking(bigint, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Tighten SELECT (own rows, or a match shared with the row's user).
--    NON-BREAKING: StatsView reads own; results view reads co-players.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS rating_adjustments_select_authenticated ON public.rating_adjustments;
CREATE POLICY rating_adjustments_select_scoped
ON public.rating_adjustments
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.jugadores j_self
    JOIN public.jugadores j_row
      ON j_row.partido_id = j_self.partido_id
    WHERE j_self.usuario_id = auth.uid()
      AND j_row.usuario_id = public.rating_adjustments.user_id
  )
);

DROP POLICY IF EXISTS no_show_recovery_state_select_authenticated ON public.no_show_recovery_state;
CREATE POLICY no_show_recovery_state_select_own
ON public.no_show_recovery_state
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. Immediate mitigation while legacy clients still hold direct INSERT:
--    bound amounts/types so a forged row cannot inflate ranking arbitrarily.
--    NOT VALID => applies to new rows only; does not scan/lock existing data.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.rating_adjustments'::regclass
      AND conname = 'rating_adjustments_amount_domain_check'
  ) THEN
    ALTER TABLE public.rating_adjustments
      ADD CONSTRAINT rating_adjustments_amount_domain_check
      CHECK (
        (type = 'no_show_penalty' AND amount < 0 AND amount >= -0.5)
        OR (type = 'no_show_recovery' AND amount > 0 AND amount <= 0.2)
      ) NOT VALID;
  END IF;
END
$$;

-- ===========================================================================
-- ROLLBACK (Stage A)
-- ===========================================================================
-- BEGIN;
-- ALTER TABLE public.rating_adjustments DROP CONSTRAINT IF EXISTS rating_adjustments_amount_domain_check;
-- DROP POLICY IF EXISTS no_show_recovery_state_select_own ON public.no_show_recovery_state;
-- CREATE POLICY no_show_recovery_state_select_authenticated ON public.no_show_recovery_state
--   FOR SELECT TO authenticated USING (true);
-- DROP POLICY IF EXISTS rating_adjustments_select_scoped ON public.rating_adjustments;
-- CREATE POLICY rating_adjustments_select_authenticated ON public.rating_adjustments
--   FOR SELECT TO authenticated USING (true);
-- DROP FUNCTION IF EXISTS public.process_match_no_show_ranking(bigint, boolean);
-- DROP FUNCTION IF EXISTS public._derive_no_show_streak(uuid);
-- DROP FUNCTION IF EXISTS public._no_show_confirmed_absent_player_ids(bigint);
-- DROP FUNCTION IF EXISTS public._match_no_show_eligible(bigint);
-- DROP FUNCTION IF EXISTS public._clamp_player_rating(numeric);
-- COMMIT;
-- END incorporated migration: 20260724121000_secure_no_show_ranking_stage_a.sql

-- BEGIN incorporated migration: 20260724122000_secure_notifications_stage_a.sql
-- ===========================================================================
-- Security patch M3 — Notifications (Stage A)
-- ---------------------------------------------------------------------------
-- Confirmed hole: policy `notifications_insert_authenticated_any_user`
-- (INSERT ... WITH CHECK (true)) lets any authenticated user insert a
-- notification with an ARBITRARY user_id / type / title / message / data — i.e.
-- forge a notification to any other user (phishing / impersonation).
--
-- Cross-user notifications ALREADY flow through relationship-validating
-- SECURITY DEFINER RPCs (send_match_invite, send_call_to_vote,
-- enqueue_partido_notification, enqueue_match_participant_notification,
-- cancel_partido_with_notification). The abuse surface is the DIRECT client
-- `INSERT` path. This migration:
--
--   * Adds a strict `create_notification(p_type, p_recipient_id, p_context)`
--     RPC (SECURITY DEFINER) that GENERATES type/title/message/data server-side
--     from typed IDs, validates the sender↔recipient relationship per type, and
--     ignores any client-supplied free text. This is the target for the direct
--     `from('notifications').insert()` call sites (see PR call-site table).
--   * Replaces the `WITH CHECK (true)` policy with a Stage A INTERIM policy that
--     is NON-BREAKING for legacy clients: allows self-notifications and inserts
--     to a related recipient (shared match / team / friendship), restricted to a
--     known `type` allowlist and bounded title/message length. This closes the
--     arbitrary-recipient abuse immediately without breaking installed apps.
--
-- Stage B (20260724132000_notifications_rpc_only_stage_b.sql) drops the interim
-- policy and leaves only self-insert; all cross-user inserts then go through the
-- (DEFINER) RPCs. Rollback SQL at the bottom.
--
-- Per-type authorization (review round 3): create_notification does not merely
-- require sender+recipient to share the match. Each sensitive type is gated on
-- the real server state — admin-only events (match_kicked/cancelled/
-- falta_jugadores/call_to_vote) require the emitter to be the match creator;
-- match_cancelled requires the match to be really cancelled and call_to_vote
-- requires voting to be open; survey_* require the real survey state; awards/mvp
-- require a persisted player_awards / results row; award_won additionally
-- requires a MANDATORY canonical award_type AND that the matching player_awards
-- row belongs to the recipient (jugador_id resolved to the registered user via
-- this match's roster) — so "Ganaste un premio" can never be sent to a non-winner;
-- match_join_request requires a real pending request from the actor; payments
-- require a real payment row; team
-- challenge events require both parties to be the concrete challenge's creator/
-- acceptor (typed challenge_id). send_match_invite / send_call_to_vote content
-- passthrough is removed in 20260724125000; that migration also authorizes
-- send_call_to_vote to the match admin and fails the deploy if the
-- send_match_invite passthrough survives.
-- ===========================================================================

ALTER TABLE IF EXISTS public.notifications ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 0. Canonical award-type normalizer. Mirrors the client `normalizeAwardType`
--    and the alias sets already used by 20260316233000: maps every historic
--    alias to the canonical mvp / best_gk / red_card and returns NULL for an
--    empty or unknown value, so create_notification can REJECT a missing or
--    bogus award_type instead of trusting whatever the client sent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._normalize_award_type(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE lower(btrim(coalesce(p_value, '')))
    WHEN 'mvp' THEN 'mvp'
    WHEN 'best_gk' THEN 'best_gk'
    WHEN 'guante_dorado' THEN 'best_gk'
    WHEN 'guante dorado' THEN 'best_gk'
    WHEN 'goalkeeper' THEN 'best_gk'
    WHEN 'golden_glove' THEN 'best_gk'
    WHEN 'golden glove' THEN 'best_gk'
    WHEN 'best_goalkeeper' THEN 'best_gk'
    WHEN 'best goalkeeper' THEN 'best_gk'
    WHEN 'mejor_arquero' THEN 'best_gk'
    WHEN 'mejor arquero' THEN 'best_gk'
    WHEN 'red_card' THEN 'red_card'
    WHEN 'red card' THEN 'red_card'
    WHEN 'red_cards' THEN 'red_card'
    WHEN 'tarjeta_roja' THEN 'red_card'
    WHEN 'tarjeta roja' THEN 'red_card'
    WHEN 'tarjetas_rojas' THEN 'red_card'
    WHEN 'tarjetas rojas' THEN 'red_card'
    WHEN 'negative_fair_play' THEN 'red_card'
    WHEN 'dirty_player' THEN 'red_card'
    WHEN 'dirty player' THEN 'red_card'
    WHEN 'player_dirty' THEN 'red_card'
    WHEN 'mas_sucio' THEN 'red_card'
    WHEN 'mas sucio' THEN 'red_card'
    WHEN 'sucio' THEN 'red_card'
    ELSE NULL
  END
$$;
REVOKE ALL ON FUNCTION public._normalize_award_type(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._normalize_award_type(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Strict, server-content notification RPC for direct-insert domains.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_notification(
  p_type text,
  p_recipient_id uuid,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_match_id bigint := NULLIF(p_context->>'match_id', '')::bigint;
  v_match_name text;
  v_challenge_id uuid := NULLIF(p_context->>'challenge_id', '')::uuid;
  v_survey_status text;
  v_authorized boolean := false;
  v_is_admin boolean := false;
  v_sender_in_match boolean := false;
  v_recipient_in_match boolean := false;
  v_award_type text := NULLIF(p_context->>'award_type', '');
  v_award_label text;
  v_title text;
  v_message text;
  v_data jsonb;
  v_type text := lower(btrim(coalesce(p_type, '')));
  v_notif_id public.notifications.id%TYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_recipient_id IS NULL THEN
    RAISE EXCEPTION 'invalid_recipient' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(nombre, 'Alguien') INTO v_actor_name FROM public.usuarios WHERE id = v_actor;
  PERFORM 1 FROM public.usuarios WHERE id = p_recipient_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'recipient_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_match_id IS NOT NULL THEN
    SELECT COALESCE(NULLIF(btrim(nombre), ''), 'el partido'), survey_status
      INTO v_match_name, v_survey_status
    FROM public.partidos WHERE id = v_match_id;
    -- "admin" of a match == its creator (see payments_is_match_admin).
    v_is_admin := EXISTS (SELECT 1 FROM public.partidos p WHERE p.id = v_match_id AND p.creado_por = v_actor);
    v_sender_in_match := v_is_admin
      OR EXISTS (SELECT 1 FROM public.jugadores j WHERE j.partido_id = v_match_id AND j.usuario_id = v_actor);
    v_recipient_in_match :=
      EXISTS (SELECT 1 FROM public.jugadores j WHERE j.partido_id = v_match_id AND j.usuario_id = p_recipient_id)
      OR EXISTS (SELECT 1 FROM public.partidos p WHERE p.id = v_match_id AND p.creado_por = p_recipient_id);
    v_data := jsonb_build_object('match_id', v_match_id, 'matchId', v_match_id, 'partido_id', v_match_id);
  END IF;

  -- Per-type authorization + server-generated content. Only typed IDs from
  -- p_context are read; client title/message/data are NEVER used.
  CASE v_type
    -- ---- Friendship: require a REAL relationship row (no arbitrary events) --
    WHEN 'friend_request' THEN
      IF p_recipient_id = v_actor THEN RAISE EXCEPTION 'cannot_notify_self'; END IF;
      v_authorized := EXISTS (
        SELECT 1 FROM public.amigos a
        WHERE a.user_id = v_actor AND a.friend_id = p_recipient_id
          AND lower(COALESCE(a.status, 'pending')) = 'pending'
      );
      v_title := 'Solicitud de amistad';
      v_message := v_actor_name || ' te envió una solicitud de amistad';
      v_data := jsonb_build_object('sender_id', v_actor, 'sender_name', v_actor_name);

    WHEN 'friend_accepted' THEN
      -- actor accepted a request the recipient originally sent
      v_authorized := EXISTS (
        SELECT 1 FROM public.amigos a
        WHERE a.user_id = p_recipient_id AND a.friend_id = v_actor
          AND lower(COALESCE(a.status, '')) = 'accepted'
      );
      v_title := 'Solicitud de amistad aceptada';
      v_message := v_actor_name || ' aceptó tu solicitud de amistad';
      v_data := jsonb_build_object('sender_id', v_actor, 'sender_name', v_actor_name);

    WHEN 'friend_rejected' THEN
      -- a request from recipient -> actor must have existed (now rejected)
      v_authorized := EXISTS (
        SELECT 1 FROM public.amigos a
        WHERE a.user_id = p_recipient_id AND a.friend_id = v_actor
          AND lower(COALESCE(a.status, '')) = 'rejected'
      );
      v_title := 'Solicitud de amistad rechazada';
      v_message := 'Tu solicitud de amistad ha sido rechazada';
      v_data := jsonb_build_object('sender_id', v_actor);

    -- ---- Admin-only match events: the EMITTER must be the match creator/admin.
    -- A plain participant can NOT kick, cancel, ask for players or open voting.
    WHEN 'match_kicked', 'match_cancelled', 'falta_jugadores', 'call_to_vote' THEN
      IF v_match_id IS NULL THEN RAISE EXCEPTION 'match_id_required'; END IF;
      v_authorized := v_is_admin AND v_recipient_in_match;
      IF v_type = 'match_cancelled' THEN
        -- must reflect a REAL cancellation, not a fabricated one
        v_authorized := v_authorized AND EXISTS (
          SELECT 1 FROM public.partidos p
          WHERE p.id = v_match_id
            AND lower(coalesce(p.estado, '')) IN ('cancelado', 'cancelled', 'canceled')
        );
      ELSIF v_type = 'call_to_vote' THEN
        -- voting must actually be OPEN (right moment of the flow)
        v_authorized := v_authorized AND public.is_public_voting_open(v_match_id);
      END IF;
      IF v_type = 'match_kicked' THEN
        v_title := 'Expulsado del partido';
        v_message := 'Has sido expulsado del partido "' || v_match_name || '"';
      ELSIF v_type = 'match_cancelled' THEN
        v_title := 'Partido cancelado';
        v_message := 'El partido "' || v_match_name || '" fue cancelado';
      ELSIF v_type = 'falta_jugadores' THEN
        v_title := 'Faltan jugadores';
        v_message := 'El partido "' || v_match_name || '" necesita jugadores';
      ELSE -- call_to_vote
        v_title := '¡Hora de votar!';
        v_message := 'Entrá a la app y calificá a los jugadores para armar los equipos.';
      END IF;

    -- ---- Peer match events: sender AND recipient must belong to the match ---
    WHEN 'match_update', 'pre_match_vote', 'match_player_joined' THEN
      IF v_match_id IS NULL THEN RAISE EXCEPTION 'match_id_required'; END IF;
      v_authorized := v_sender_in_match AND v_recipient_in_match;
      IF v_type = 'pre_match_vote' THEN
        v_title := '¡Armemos los equipos!';
        v_message := 'Calificá a los jugadores para armar el partido más parejo.';
      ELSIF v_type = 'match_player_joined' THEN
        v_title := 'Nuevo jugador';
        v_message := 'Se sumó un jugador al partido "' || v_match_name || '"';
      ELSE -- match_update
        v_title := 'Actualización del partido';
        v_message := 'Hay novedades en el partido "' || v_match_name || '"';
      END IF;

    -- ---- Survey lifecycle: must reflect the REAL survey state. A participant
    -- can NOT fabricate a survey open/close/results event out of the flow.
    WHEN 'survey_start', 'survey_reminder', 'survey_finished', 'survey_results_ready' THEN
      IF v_match_id IS NULL THEN RAISE EXCEPTION 'match_id_required'; END IF;
      v_authorized := v_sender_in_match AND v_recipient_in_match;
      IF v_type = 'survey_finished' THEN
        v_authorized := v_authorized AND (
          lower(coalesce(v_survey_status, '')) IN ('closed', 'finished', 'completed')
          OR EXISTS (
            SELECT 1 FROM public.survey_results sr
            WHERE sr.partido_id = v_match_id
              AND (sr.results_ready OR sr.encuesta_cerrada_at IS NOT NULL OR sr.finished_at IS NOT NULL)
          )
        );
        v_title := 'Encuesta cerrada';
        v_message := 'La encuesta del partido "' || v_match_name || '" se cerró.';
      ELSIF v_type = 'survey_results_ready' THEN
        v_authorized := v_authorized AND EXISTS (
          SELECT 1 FROM public.survey_results sr
          WHERE sr.partido_id = v_match_id AND sr.results_ready = true
        );
        v_title := 'Resultados listos';
        v_message := 'Ya están los resultados del partido "' || v_match_name || '".';
      ELSE
        -- survey_start / survey_reminder: the survey lifecycle must have begun
        v_authorized := v_authorized AND (
          lower(coalesce(v_survey_status, '')) IN ('open', 'active', 'closed', 'finished', 'completed')
          OR EXISTS (SELECT 1 FROM public.survey_results sr WHERE sr.partido_id = v_match_id)
        );
        IF v_type = 'survey_start' THEN
          v_title := '¡Encuesta lista!';
          v_message := 'Ya podés completar la encuesta del partido "' || v_match_name || '".';
        ELSE
          v_title := 'Recordatorio de encuesta';
          v_message := 'No te olvides de completar la encuesta del partido "' || v_match_name || '".';
        END IF;
      END IF;

    -- ---- Awards broadcast: only when awards were REALLY persisted. A
    -- participant can NOT invent an MVP or "premios listos" event.
    WHEN 'awards_ready', 'mvp' THEN
      IF v_match_id IS NULL THEN RAISE EXCEPTION 'match_id_required'; END IF;
      v_authorized := v_sender_in_match AND v_recipient_in_match;
      IF v_type = 'mvp' THEN
        v_authorized := v_authorized AND EXISTS (
          SELECT 1 FROM public.player_awards pa
          WHERE pa.partido_id = v_match_id AND lower(coalesce(pa.award_type, '')) = 'mvp'
        );
        v_title := 'MVP del partido';
        v_message := 'Se eligió el MVP del partido "' || v_match_name || '".';
      ELSE
        v_authorized := v_authorized AND (
          EXISTS (SELECT 1 FROM public.player_awards pa WHERE pa.partido_id = v_match_id)
          OR EXISTS (SELECT 1 FROM public.survey_results sr WHERE sr.partido_id = v_match_id AND sr.results_ready = true)
        );
        v_title := 'Premios listos';
        v_message := 'Ya están los premios del partido "' || v_match_name || '".';
      END IF;

    -- ---- Match join request: a REAL pending request from the actor must
    -- exist, and the recipient must be the match admin (its creator).
    WHEN 'match_join_request' THEN
      IF v_match_id IS NULL THEN RAISE EXCEPTION 'match_id_required'; END IF;
      v_authorized :=
        EXISTS (SELECT 1 FROM public.partidos p WHERE p.id = v_match_id AND p.creado_por = p_recipient_id)
        AND EXISTS (
          SELECT 1 FROM public.match_join_requests r
          WHERE r.match_id = v_match_id AND r.user_id = v_actor
            AND lower(coalesce(r.status, '')) = 'pending'
        );
      v_title := 'Solicitud para unirse';
      v_message := v_actor_name || ' quiere unirse al partido "' || v_match_name || '"';

    -- ---- Payments -----------------------------------------------------------
    -- reporter (participant) -> match admin, with a REAL reported-paid row.
    WHEN 'payment_reported' THEN
      IF v_match_id IS NULL THEN RAISE EXCEPTION 'match_id_required'; END IF;
      v_authorized :=
        v_sender_in_match
        AND EXISTS (SELECT 1 FROM public.partidos p WHERE p.id = v_match_id AND p.creado_por = p_recipient_id)
        AND EXISTS (
          SELECT 1 FROM public.match_player_payments mpp
          WHERE mpp.partido_id = v_match_id AND mpp.user_id = v_actor
            AND lower(coalesce(mpp.status, '')) IN ('reported_paid', 'paid')
        );
      v_title := 'Pago a confirmar';
      v_message := v_actor_name || ' avisó que pagó "' || v_match_name || '".';

    -- admin -> a participant that has a REAL pending payment row.
    WHEN 'payment_reminder', 'payment_admin' THEN
      IF v_match_id IS NULL THEN RAISE EXCEPTION 'match_id_required'; END IF;
      v_authorized :=
        v_is_admin
        AND EXISTS (
          SELECT 1 FROM public.match_player_payments mpp
          WHERE mpp.partido_id = v_match_id AND mpp.user_id = p_recipient_id
            AND lower(coalesce(mpp.status, '')) = 'pending'
        );
      v_title := 'Pago pendiente';
      v_message := 'Tenés pendiente el pago de "' || v_match_name || '".';

    -- ---- Awards (personal): "Ganaste un premio". award_type is MANDATORY and
    -- must be canonical (mvp / best_gk / red_card; historic aliases normalized
    -- server-side). The matching award must be REALLY persisted for THIS match,
    -- of THIS type, AND belong to THE RECIPIENT — not merely exist for some other
    -- player. jugador_id was normalized to the registered user id (usuarios.id);
    -- older rows may still carry a jugadores.uuid / jugadores.id, which we resolve
    -- through the roster of THIS match only, never trusting a client-supplied id.
    WHEN 'award_won' THEN
      IF v_match_id IS NULL THEN RAISE EXCEPTION 'match_id_required'; END IF;
      v_award_type := public._normalize_award_type(v_award_type);
      IF v_award_type IS NULL THEN
        RAISE EXCEPTION 'invalid_award' USING ERRCODE = '22023';
      END IF;
      v_authorized := v_sender_in_match AND v_recipient_in_match AND EXISTS (
        SELECT 1 FROM public.player_awards pa
        WHERE pa.partido_id = v_match_id
          AND public._normalize_award_type(pa.award_type) = v_award_type
          AND (
            -- normalized form: jugador_id already IS the registered user id
            pa.jugador_id::text = p_recipient_id::text
            -- historic forms: resolve through the roster of THIS match only
            OR EXISTS (
              SELECT 1 FROM public.jugadores j
              WHERE j.partido_id = v_match_id
                AND j.usuario_id = p_recipient_id
                AND pa.jugador_id::text IN (j.usuario_id::text, j.uuid::text, j.id::text)
            )
          )
      );
      v_award_label := CASE v_award_type
        WHEN 'mvp' THEN 'MVP'
        WHEN 'best_gk' THEN 'Mejor Arquero'
        WHEN 'red_card' THEN 'Jugador más sucio'
        ELSE 'Premio'
      END;
      v_title := 'Ganaste un premio: ' || v_award_label;
      v_message := 'Ganaste "' || v_award_label || '" en el partido "' || v_match_name || '".';
      v_data := COALESCE(v_data, '{}'::jsonb) || jsonb_build_object('award_type', v_award_type, 'award_label', v_award_label);

    -- ---- Team challenge: BOTH actor and recipient must be the concrete
    -- parties (creator / acceptor) of the SAME challenge (typed challenge_id).
    -- A member of one team can NOT notify a member of an unrelated challenge.
    WHEN 'team_challenge_accepted', 'challenge', 'team_match' THEN
      IF v_challenge_id IS NULL THEN RAISE EXCEPTION 'challenge_id_required'; END IF;
      v_authorized := EXISTS (
        SELECT 1 FROM public.challenges c
        WHERE c.id = v_challenge_id
          AND v_actor IN (c.created_by_user_id, c.accepted_by_user_id)
          AND p_recipient_id IN (c.created_by_user_id, c.accepted_by_user_id)
      );
      v_data := COALESCE(v_data, '{}'::jsonb) || jsonb_build_object('challenge_id', v_challenge_id);
      v_title := 'Novedades del desafío';
      v_message := 'Hay novedades en tu desafío de equipos.';

    ELSE
      RAISE EXCEPTION 'unsupported_notification_type: %', v_type USING ERRCODE = '22023';
  END CASE;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- award_won is idempotent: never emit a second "Ganaste un premio" for the
  -- same recipient + match (matches the notifications (user_id, data->>'match_id',
  -- type) unique index and the client-side dedupe). Return the existing row so a
  -- repeated call is a silent no-op instead of a duplicate or a unique violation.
  IF v_type = 'award_won' THEN
    SELECT n.id INTO v_notif_id
    FROM public.notifications n
    WHERE n.user_id = p_recipient_id
      AND n.type = 'award_won'
      AND COALESCE(n.partido_id, NULLIF(n.data->>'match_id', '')::bigint) = v_match_id
    ORDER BY n.id
    LIMIT 1;
    IF v_notif_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'id', v_notif_id, 'duplicate', true);
    END IF;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message, data, read, partido_id, created_at)
  VALUES (p_recipient_id, v_type, v_title, v_message, COALESCE(v_data, '{}'::jsonb), false, v_match_id, now())
  RETURNING id INTO v_notif_id;

  RETURN jsonb_build_object('success', true, 'id', v_notif_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_notification(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_notification(text, uuid, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Replace WITH CHECK(true) with a Stage A interim, non-breaking policy.
--    Allows: self-notifications, OR a recipient related to the sender by a
--    shared match / team / friendship. Bounded content + known type allowlist.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS notifications_insert_authenticated_any_user ON public.notifications;

DROP POLICY IF EXISTS notifications_insert_related_or_self ON public.notifications;
CREATE POLICY notifications_insert_related_or_self
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
  char_length(COALESCE(title, '')) <= 200
  AND char_length(COALESCE(message, '')) <= 1000
  AND type IN (
    'friend_request','friend_accepted','friend_rejected',
    'match_invite','match_update','match_kicked','match_cancelled','match_player_joined',
    'match_join_request','falta_jugadores','call_to_vote','pre_match_vote',
    'team_invite','team_match','challenge','challenge_squad_open',
    'payment_reported','payment_reminder','payment_admin',
    'auto_match_ready','award_won','awards_ready','mvp',
    'survey_start','survey_reminder','survey_finished','survey_results_ready',
    'no_show_penalty','no_show_recovery','info','success','warning'
  )
  AND (
    -- self-notifications are always allowed
    user_id = auth.uid()
    -- shared match (either direction, incl. match creator)
    OR EXISTS (
      SELECT 1 FROM public.jugadores j_self
      JOIN public.jugadores j_rec ON j_rec.partido_id = j_self.partido_id
      WHERE j_self.usuario_id = auth.uid() AND j_rec.usuario_id = public.notifications.user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.partidos p
      WHERE (p.creado_por = auth.uid() OR EXISTS (
              SELECT 1 FROM public.jugadores j WHERE j.partido_id = p.id AND j.usuario_id = auth.uid()))
        AND (p.creado_por = public.notifications.user_id OR EXISTS (
              SELECT 1 FROM public.jugadores j2 WHERE j2.partido_id = p.id AND j2.usuario_id = public.notifications.user_id))
    )
    -- shared team (team_members links via jugadores.usuario_id)
    OR EXISTS (
      SELECT 1
      FROM public.team_members tm_self
      JOIN public.jugadores js ON js.id = tm_self.jugador_id AND js.usuario_id = auth.uid()
      JOIN public.team_members tm_rec ON tm_rec.team_id = tm_self.team_id
      JOIN public.jugadores jr ON jr.id = tm_rec.jugador_id AND jr.usuario_id = public.notifications.user_id
    )
    -- friendship (accepted or pending, either direction)
    OR EXISTS (
      SELECT 1 FROM public.amigos a
      WHERE (a.user_id = auth.uid() AND a.friend_id = public.notifications.user_id)
         OR (a.user_id = public.notifications.user_id AND a.friend_id = auth.uid())
    )
  )
);

-- ===========================================================================
-- ROLLBACK (Stage A)
-- ===========================================================================
-- BEGIN;
-- DROP POLICY IF EXISTS notifications_insert_related_or_self ON public.notifications;
-- CREATE POLICY notifications_insert_authenticated_any_user ON public.notifications
--   FOR INSERT TO authenticated WITH CHECK (true);
-- DROP FUNCTION IF EXISTS public.create_notification(text, uuid, jsonb);
-- DROP FUNCTION IF EXISTS public._normalize_award_type(text);
-- COMMIT;
-- END incorporated migration: 20260724122000_secure_notifications_stage_a.sql

-- BEGIN incorporated migration: 20260724123000_secure_survey_progress_stage_a.sql
-- ===========================================================================
-- Security patch M1 (observability tables) — survey_progress (Stage A)
-- ---------------------------------------------------------------------------
-- `survey_progress` had `FOR ALL authenticated USING(true) WITH CHECK(true)`.
-- It is written ONLY by the AFTER INSERT triggers on post_match_surveys / votos
-- (check_survey_completion_from_post_match_surveys / check_survey_completion),
-- and read by nobody in the client. Those trigger functions are SECURITY
-- INVOKER today, so they need the invoking role (incl. anon during public
-- voting) to hold write access.
--
-- Fix: convert BOTH trigger functions to SECURITY DEFINER + SET search_path
-- (bodies unchanged), then revoke ALL direct access for authenticated/anon and
-- drop the permissive policy. The public survey submit KEEPS working — the
-- INSERT into post_match_surveys by anon fires the DEFINER trigger, which
-- populates survey_progress with owner rights regardless of anon's grants.
-- This is NON-BREAKING and hardens the anon path. Rollback SQL at the bottom.
-- ===========================================================================

-- Observability-only trigger (post_match_surveys). Body identical to
-- 20260310183000_fix_survey_closure_single_path.sql, now SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.check_survey_completion_from_post_match_surveys()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_response_count int;
BEGIN
  INSERT INTO public.survey_progress (
    partido_id,
    enabled_at,
    first_response_at,
    response_count,
    results_notified,
    created_at,
    updated_at
  )
  VALUES (NEW.partido_id, now(), NEW.created_at, 0, false, now(), now())
  ON CONFLICT (partido_id) DO NOTHING;

  SELECT COUNT(DISTINCT s.votante_id)
  INTO v_response_count
  FROM public.post_match_surveys s
  WHERE s.partido_id = NEW.partido_id;

  UPDATE public.survey_progress
  SET
    response_count = COALESCE(v_response_count, 0),
    first_response_at = COALESCE(first_response_at, NEW.created_at, now()),
    updated_at = now()
  WHERE partido_id = NEW.partido_id;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.check_survey_completion_from_post_match_surveys()
IS 'Observability-only trigger: tracks survey_progress response_count. SECURITY DEFINER so public/anon survey submit populates survey_progress without direct grants.';

-- Legacy compatibility trigger (votos). Body identical, now SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.check_survey_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.survey_progress (
    partido_id,
    enabled_at,
    first_response_at,
    response_count,
    results_notified,
    created_at,
    updated_at
  )
  VALUES (NEW.partido_id, now(), now(), 0, false, now(), now())
  ON CONFLICT (partido_id) DO NOTHING;

  UPDATE public.survey_progress
  SET
    response_count = COALESCE(response_count, 0) + 1,
    first_response_at = COALESCE(first_response_at, now()),
    updated_at = now()
  WHERE partido_id = NEW.partido_id;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.check_survey_completion()
IS 'Legacy compatibility only. SECURITY DEFINER; does not enqueue notifications or close surveys.';

-- Lock down direct access. Only the DEFINER triggers and service_role write it.
DROP POLICY IF EXISTS survey_progress_authenticated_all ON public.survey_progress;
-- (survey_progress_service_role_all is kept as-is.)

REVOKE ALL ON public.survey_progress FROM authenticated, anon;
GRANT ALL ON public.survey_progress TO service_role;

-- ===========================================================================
-- ROLLBACK (Stage A)
-- ===========================================================================
-- BEGIN;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON public.survey_progress TO authenticated;
-- CREATE POLICY survey_progress_authenticated_all ON public.survey_progress
--   FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- -- Re-create the two trigger functions with LANGUAGE plpgsql (no SECURITY DEFINER)
-- -- using the bodies from 20260310183000_fix_survey_closure_single_path.sql.
-- COMMIT;
-- END incorporated migration: 20260724123000_secure_survey_progress_stage_a.sql

-- BEGIN incorporated migration: 20260724124000_secure_jugadores_fotos_stage_a.sql
-- ===========================================================================
-- Security patch M4 — Storage jugadores-fotos (Stage A)
-- ---------------------------------------------------------------------------
-- Confirmed holes (bucket jugadores-fotos): anon INSERT + anon UPDATE scoped
-- ONLY by bucket_id => anyone can overwrite anyone's photo; no allowed_mime_types
-- or file_size_limit; predictable object names.
--
-- Stage A (NON-BREAKING):
--   * DROP the anon/authenticated UPDATE policy (there is no legitimate UPDATE:
--     uploads use unique names, so overwriting an existing object is never
--     needed). This closes "overwrite anyone's photo" immediately.
--   * ADD owner-scoped INSERT + UPDATE policies for authenticated, compatible
--     with BOTH the new path "{uid}/{random}.ext" and the legacy flat name
--     "{uid}_{ts}.ext" (name LIKE auth.uid()||'%'). Legacy installed apps keep
--     uploading their own photo.
--   * Constrain the bucket: allowed_mime_types (real image types; SVG dropped —
--     stored-XSS vector in a public bucket) and a 15 MB file_size_limit
--     (matches the client's own DEFAULT_MAX_IMAGE_BYTES so no legit upload is
--     rejected; jpeg/png/webp are already re-encoded to <=1.5 MB client-side).
--   * ADD the guest-photo capability-token table used by the upload Edge
--     Functions (issue-voting-photo-token / upload-voting-photo). RLS on, no
--     anon/authenticated policies => only service_role (Edge Functions) touch it.
--
-- The broad anon INSERT policy (jugadores_fotos_anon_authenticated_insert) is
-- intentionally LEFT until Stage B (20260724134000), which drops it once the
-- web build routes guest uploads through the Edge Function. `public` is NOT
-- changed (would break already-served images). Rollback SQL at the bottom.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Guest-photo capability token (single-use, short-lived). service_role only.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.voting_photo_upload_tokens (
  token_hash text PRIMARY KEY,
  match_id bigint NOT NULL,
  player_id bigint NOT NULL,
  guest_session_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS voting_photo_upload_tokens_match_session_idx
  ON public.voting_photo_upload_tokens (match_id, guest_session_id);
CREATE INDEX IF NOT EXISTS voting_photo_upload_tokens_expires_idx
  ON public.voting_photo_upload_tokens (expires_at);

ALTER TABLE public.voting_photo_upload_tokens ENABLE ROW LEVEL SECURITY;
-- No policies for anon/authenticated: table is reachable only via service_role
-- (the Edge Functions), which bypasses RLS.
REVOKE ALL ON public.voting_photo_upload_tokens FROM anon, authenticated;
GRANT ALL ON public.voting_photo_upload_tokens TO service_role;

COMMENT ON TABLE public.voting_photo_upload_tokens
  IS 'Single-use, short-lived capability tokens binding a guest voting session to one match/player slot for avatar upload. Written/consumed only by Edge Functions (service_role).';

-- Durable session->slot binding (survives the short token window). A guest
-- session may only ever upload for the ONE player slot it first claimed, even
-- after the rate-limit / token window elapses. PK enforces one slot per
-- (match, session). service_role only.
CREATE TABLE IF NOT EXISTS public.voting_photo_slot_claims (
  match_id bigint NOT NULL,
  guest_session_id text NOT NULL,
  player_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, guest_session_id)
);
ALTER TABLE public.voting_photo_slot_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voting_photo_slot_claims FROM anon, authenticated;
GRANT ALL ON public.voting_photo_slot_claims TO service_role;

COMMENT ON TABLE public.voting_photo_slot_claims
  IS 'Durable (match_id, guest_session_id) -> player_id binding for guest photo uploads. Prevents a session from switching slots regardless of elapsed time. service_role only.';

-- Atomic, permanent claim: binds the session to the requested player if unbound,
-- and ALWAYS returns the bound player_id. The caller (Edge Function) rejects when
-- the returned id differs from the requested one (session already owns another
-- slot). ON CONFLICT DO NOTHING makes concurrent claims deterministic.
CREATE OR REPLACE FUNCTION public.bind_voting_photo_slot(
  p_match_id bigint,
  p_guest_session_id text,
  p_player_id bigint
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bound bigint;
BEGIN
  INSERT INTO public.voting_photo_slot_claims (match_id, guest_session_id, player_id)
  VALUES (p_match_id, p_guest_session_id, p_player_id)
  ON CONFLICT (match_id, guest_session_id) DO NOTHING;

  SELECT player_id INTO v_bound
  FROM public.voting_photo_slot_claims
  WHERE match_id = p_match_id AND guest_session_id = p_guest_session_id;

  RETURN v_bound;
END;
$$;

REVOKE ALL ON FUNCTION public.bind_voting_photo_slot(bigint, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bind_voting_photo_slot(bigint, text, bigint) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Remove anon/authenticated UPDATE (overwrite-anyone hole).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS jugadores_fotos_anon_authenticated_update ON storage.objects;

-- ---------------------------------------------------------------------------
-- 3. Owner-scoped INSERT/UPDATE for authenticated (legacy + new name schemes).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS jugadores_fotos_owner_insert ON storage.objects;
CREATE POLICY jugadores_fotos_owner_insert
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'jugadores-fotos'
  AND name LIKE (auth.uid()::text || '%')
);

DROP POLICY IF EXISTS jugadores_fotos_owner_update ON storage.objects;
CREATE POLICY jugadores_fotos_owner_update
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'jugadores-fotos'
  AND name LIKE (auth.uid()::text || '%')
)
WITH CHECK (
  bucket_id = 'jugadores-fotos'
  AND name LIKE (auth.uid()::text || '%')
);

-- ---------------------------------------------------------------------------
-- 4. Bucket constraints: real image MIME types + size cap.
-- ---------------------------------------------------------------------------
UPDATE storage.buckets
SET
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  file_size_limit = 15728640  -- 15 MB, matches client DEFAULT_MAX_IMAGE_BYTES
WHERE id = 'jugadores-fotos';

-- ===========================================================================
-- ROLLBACK (Stage A)
-- ===========================================================================
-- BEGIN;
-- UPDATE storage.buckets SET allowed_mime_types = NULL, file_size_limit = NULL
--   WHERE id = 'jugadores-fotos';
-- DROP POLICY IF EXISTS jugadores_fotos_owner_update ON storage.objects;
-- DROP POLICY IF EXISTS jugadores_fotos_owner_insert ON storage.objects;
-- CREATE POLICY jugadores_fotos_anon_authenticated_update ON storage.objects
--   FOR UPDATE TO anon, authenticated
--   USING (bucket_id = 'jugadores-fotos') WITH CHECK (bucket_id = 'jugadores-fotos');
-- DROP FUNCTION IF EXISTS public.bind_voting_photo_slot(bigint, text, bigint);
-- DROP TABLE IF EXISTS public.voting_photo_slot_claims;
-- DROP TABLE IF EXISTS public.voting_photo_upload_tokens;
-- COMMIT;
-- END incorporated migration: 20260724124000_secure_jugadores_fotos_stage_a.sql

-- BEGIN incorporated migration: 20260724125000_harden_notification_rpc_content_stage_a.sql
-- ===========================================================================
-- Security patch M3 (Stage A) — remove client-content passthrough in the
-- existing SECURITY DEFINER notification RPCs.
-- ---------------------------------------------------------------------------
-- send_match_invite / send_call_to_vote accept optional p_title/p_message and
-- fall back to server defaults only when NULL, i.e. an authorized caller can
-- still inject arbitrary title/message text. This migration forces the content
-- to ALWAYS be server-generated (client p_title/p_message are ignored) and adds
-- a safe search_path to send_call_to_vote. Signatures are preserved so existing
-- clients keep compiling; the parameters simply become inert.
--
-- send_match_invite is rewritten in place via pg_get_functiondef + regex (its
-- body is large and only the two COALESCE(p_title/p_message, …) need to change),
-- guarded so it is a no-op where the function is not present (e.g. test stub).
--
-- Review round 3 adds two things:
--   * A post-rewrite VERIFICATION gate that inspects pg_get_functiondef and
--     FAILS the migration (blocking the deploy) if the p_title/p_message
--     passthrough survived the regex — so a future refactor of the COALESCE
--     shape can never silently reintroduce the client-content hole.
--   * send_call_to_vote AUTHORIZATION: only the match creator/admin may call it;
--     anon and unrelated authenticated users are rejected.
-- Rollback: re-apply the prior definitions (see 20260316184500 / 20260316223000).
-- ===========================================================================

-- send_match_invite: make COALESCE(p_title, …) / COALESCE(p_message, …) always
-- resolve to the server-side default by neutralising the client argument.
DO $mig$
DECLARE
  v_fn text;
BEGIN
  IF to_regprocedure('public.send_match_invite(uuid, bigint, text, text, text)') IS NOT NULL THEN
    v_fn := pg_get_functiondef('public.send_match_invite(uuid, bigint, text, text, text)'::regprocedure);
    v_fn := regexp_replace(v_fn, 'coalesce\(\s*p_title\s*,',   'coalesce(NULL::text,', 'gi');
    v_fn := regexp_replace(v_fn, 'coalesce\(\s*p_message\s*,', 'coalesce(NULL::text,', 'gi');
    EXECUTE v_fn;
  END IF;
END
$mig$;

-- Verification gate (review round 3): after the rewrite above, the effective
-- definition MUST no longer feed the client p_title / p_message into the
-- inserted content (i.e. no `coalesce(p_title, …)` / `coalesce(p_message, …)`
-- passthrough may survive). If the regex failed to match the real prod body
-- (e.g. a future refactor changed the COALESCE shape), FAIL the migration so the
-- deploy is blocked instead of silently shipping a client-content hole. The
-- signature keeps p_title/p_message as inert parameters, so we assert on the
-- passthrough shape, not on the bare identifier. No-op where the function is
-- absent (test stub without send_match_invite).
DO $verify$
DECLARE
  v_def text;
BEGIN
  IF to_regprocedure('public.send_match_invite(uuid, bigint, text, text, text)') IS NOT NULL THEN
    v_def := pg_get_functiondef('public.send_match_invite(uuid, bigint, text, text, text)'::regprocedure);
    IF v_def ~* 'coalesce\(\s*p_title\b' THEN
      RAISE EXCEPTION 'send_match_invite still passes client p_title into inserted content (passthrough not neutralised)';
    END IF;
    IF v_def ~* 'coalesce\(\s*p_message\b' THEN
      RAISE EXCEPTION 'send_match_invite still passes client p_message into inserted content (passthrough not neutralised)';
    END IF;
  END IF;
END
$verify$;

-- send_call_to_vote: hardcode server content + add SET search_path = public.
-- (Recipients are already server-derived: the match's registered players.)
CREATE OR REPLACE FUNCTION public.send_call_to_vote(
  p_partido_id bigint,
  p_title text DEFAULT '¡Hora de votar!',
  p_message text DEFAULT 'Entrá a la app y calificá a los jugadores para armar los equipos.'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows_affected int := 0;
  v_match_code text;
  v_actor uuid := auth.uid();
BEGIN
  -- Authorization (review round 3): only the match creator/admin may broadcast a
  -- call-to-vote. Reject anon (no JWT) and any authenticated user that is not the
  -- match's creator. Recipients + content stay fully server-derived below.
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT codigo INTO v_match_code FROM public.partidos WHERE id = p_partido_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partido % not found', p_partido_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.partidos p WHERE p.id = p_partido_id AND p.creado_por = v_actor
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.notifications
    WHERE (
      (data ->> 'match_id')::text = p_partido_id::text
      OR (data ->> 'matchId')::text = p_partido_id::text
    )
    AND type IN ('survey_start', 'post_match_survey', 'survey_reminder')
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'survey_exists');
  END IF;

  WITH recipients AS (
    SELECT DISTINCT j.usuario_id AS user_id
    FROM public.jugadores j
    WHERE j.partido_id = p_partido_id
      AND j.usuario_id IS NOT NULL
  ),
  upserted AS (
    INSERT INTO public.notifications (
      user_id, title, message, type, partido_id, data, read, created_at, send_at
    )
    SELECT
      r.user_id,
      '¡Hora de votar!',
      'Entrá a la app y calificá a los jugadores para armar los equipos.',
      'call_to_vote',
      p_partido_id,
      jsonb_build_object(
        'match_id', p_partido_id::text,
        'matchId', p_partido_id,
        'matchCode', v_match_code
      ),
      false,
      now(),
      now()
    FROM recipients r
    ON CONFLICT (user_id, (data ->> 'match_id'), type)
    DO UPDATE SET
      title = EXCLUDED.title,
      message = EXCLUDED.message,
      partido_id = EXCLUDED.partido_id,
      data = EXCLUDED.data,
      read = false,
      send_at = now()
    RETURNING id
  )
  SELECT count(*) INTO v_rows_affected FROM upserted;

  RETURN jsonb_build_object('success', true, 'inserted', v_rows_affected);
END;
$$;

-- ===========================================================================
-- ROLLBACK: re-apply the previous send_match_invite (20260316184500) and
-- send_call_to_vote (20260316223000) definitions verbatim.
-- ===========================================================================
-- END incorporated migration: 20260724125000_harden_notification_rpc_content_stage_a.sql

-- BEGIN incorporated migration: 20260726120000_drop_legacy_notifications_insert_policy_stage_a.sql
-- ===========================================================================
-- Security patch M3 — Notifications (Stage A hotfix): remove the SECOND legacy
-- CHECK(true) INSERT policy that 20260724122000 did not drop (finding #22).
-- ---------------------------------------------------------------------------
-- Prod `public.notifications` carried TWO permissive INSERT policies for
-- `authenticated`, each WITH CHECK (true):
--   * notifications_insert_authenticated_any_user  (20260226123000)  -> dropped
--       by the Stage A migration 20260724122000.
--   * "Allow Insert Authenticated"                 (legacy, ad-hoc)  -> NEVER
--       dropped by Stage A NOR by Stage B.
-- RLS INSERT policies are OR-combined, so a single surviving CHECK(true) policy
-- re-opens the exact forge / impersonation hole Stage A set out to close: any
-- authenticated user can still INSERT a notification with an ARBITRARY user_id /
-- type / title / message / data for ANY other user. While "Allow Insert
-- Authenticated" exists the strict Stage A policy
-- notifications_insert_related_or_self is INERT (it can only ever add more, and
-- CHECK(true) already permits everything).
--
-- This migration:
--   1. DROPs "Allow Insert Authenticated" so the strict Stage A relationship
--      policy actually governs direct inserts.
--   2. Adds NARROW, relationship-validated Stage A COMPATIBILITY policies for
--      the direct-insert flows of the CURRENTLY INSTALLED client (main /
--      1.1.19) that notifications_insert_related_or_self does NOT cover, so
--      dropping the broad policy does not break installed apps. NONE of them is
--      WITH CHECK(true): each validates a REAL database relationship and never
--      trusts client title / message / data beyond a length bound. See the
--      installed-client call-site audit in the PR description.
--   3. Runs a verification GATE (inside the same transaction) that FAILS the
--      deploy if any permissive `authenticated` INSERT policy with an
--      unrestricted WITH CHECK survives, and asserts "Allow Insert
--      Authenticated" is gone.
--
-- Stage B (20260724132000_notifications_rpc_only_stage_b.sql) drops the interim
-- relationship policy AND every compatibility policy added here, leaving ONLY
-- self-insert; all cross-user inserts then flow through the SECURITY DEFINER
-- RPCs (create_notification, send_match_invite, send_call_to_vote, enqueue_*).
-- Rollback SQL at the bottom.
-- ===========================================================================

ALTER TABLE IF EXISTS public.notifications ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 1. Remove the surviving broad CHECK(true) policy (finding #22).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow Insert Authenticated" ON public.notifications;

-- ---------------------------------------------------------------------------
-- 2. Stage A compatibility policies for installed-client direct inserts.
--    Every policy below is relationship-validated; none is unrestricted.
-- ---------------------------------------------------------------------------

-- 2a. SELF: a user may always create a notification addressed to THEMSELVES.
--     This is NOT the abuse the finding targets (forging to OTHER users) — the
--     row is only ever visible to its owner (notifications_select_own), so a
--     self-insert can neither phish nor impersonate anyone. Covers the
--     installed-client self-inserts whose `type` is outside the strict Stage A
--     allowlist: challenge_result_survey (challengeResultNotificationService)
--     and the generic NotificationContext.createNotification path (which emits
--     e.g. `post_match_survey` to the current user).
DROP POLICY IF EXISTS notifications_insert_self_compat ON public.notifications;
CREATE POLICY notifications_insert_self_compat
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND char_length(COALESCE(title, '')) <= 200
  AND char_length(COALESCE(message, '')) <= 1000
);

-- 2b. TEAM CHALLENGE parties: the two concrete parties (creator / acceptor) of
--     the SAME real challenge may notify each other even though rival teams do
--     not share a match / team / friendship. The relationship is validated
--     against the real public.challenges row — the pairing is NOT taken from
--     client-supplied `data`. Covers teamChallenges.js `team_challenge_accepted`
--     (the directed-challenge push) and the `match_update` accept fan-out.
DROP POLICY IF EXISTS notifications_insert_challenge_parties_compat ON public.notifications;
CREATE POLICY notifications_insert_challenge_parties_compat
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
  type IN ('team_challenge_accepted', 'challenge', 'team_match', 'match_update')
  AND char_length(COALESCE(title, '')) <= 200
  AND char_length(COALESCE(message, '')) <= 1000
  AND EXISTS (
    SELECT 1 FROM public.challenges c
    WHERE auth.uid() IN (c.created_by_user_id, c.accepted_by_user_id)
      AND public.notifications.user_id IN (c.created_by_user_id, c.accepted_by_user_id)
      AND public.notifications.user_id <> auth.uid()
  )
);

-- 2c. NO-SHOW ranking messages: the survey-finalizer notifies a co-participant
--     of a real no-show penalty / recovery. This is the SAME shared-match
--     relationship notifications_insert_related_or_self already trusts; the only
--     gap is that the installed client uses the `*_applied` type names, which are
--     outside the Stage A allowlist. Covers penalties.js
--     insertPrivateRankingNotification. The relationship mirrors the Stage A
--     shared-match branches EXACTLY (creator-inclusive, both directions): the
--     process that closes the survey may be the match ADMIN (partidos.creado_por)
--     rather than a roster row, and must still be able to notify the penalized
--     roster player.
DROP POLICY IF EXISTS notifications_insert_match_ranking_compat ON public.notifications;
CREATE POLICY notifications_insert_match_ranking_compat
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
  type IN ('no_show_penalty_applied', 'no_show_recovery_applied')
  AND char_length(COALESCE(title, '')) <= 200
  AND char_length(COALESCE(message, '')) <= 1000
  AND (
    -- both are roster players of the same match
    EXISTS (
      SELECT 1
      FROM public.jugadores j_self
      JOIN public.jugadores j_rec ON j_rec.partido_id = j_self.partido_id
      WHERE j_self.usuario_id = auth.uid()
        AND j_rec.usuario_id = public.notifications.user_id
    )
    -- or the match creator/participant notifies a creator/participant (mirrors
    -- notifications_insert_related_or_self so the admin-finalizer case is covered)
    OR EXISTS (
      SELECT 1 FROM public.partidos p
      WHERE (p.creado_por = auth.uid() OR EXISTS (
              SELECT 1 FROM public.jugadores j WHERE j.partido_id = p.id AND j.usuario_id = auth.uid()))
        AND (p.creado_por = public.notifications.user_id OR EXISTS (
              SELECT 1 FROM public.jugadores j2 WHERE j2.partido_id = p.id AND j2.usuario_id = public.notifications.user_id))
    )
  )
);

-- 2d. MATCH JOIN REQUEST: a user with a REAL pending join request may notify the
--     match admin (its creator). Mirrors create_notification's
--     match_join_request check and covers the matchJoinNotificationService
--     direct-insert FALLBACK (used only when the enqueue_* RPC is unavailable).
--     Validated against the real match_join_requests + partidos rows — only
--     `partido_id` is read from the row, and only to be checked against those
--     tables (never client free text).
DROP POLICY IF EXISTS notifications_insert_join_request_compat ON public.notifications;
CREATE POLICY notifications_insert_join_request_compat
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
  type = 'match_join_request'
  AND char_length(COALESCE(title, '')) <= 200
  AND char_length(COALESCE(message, '')) <= 1000
  AND partido_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.match_join_requests r
    JOIN public.partidos p ON p.id = r.match_id
    WHERE r.match_id = public.notifications.partido_id
      AND r.user_id = auth.uid()
      AND lower(COALESCE(r.status, '')) = 'pending'
      AND p.creado_por = public.notifications.user_id
  )
);

-- ---------------------------------------------------------------------------
-- 3. Verification gate (in-transaction; rolls the whole migration back if it
--    fires). No-op against a correctly patched database.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_leftover text;
BEGIN
  -- (b) the named legacy policy must be gone
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notifications'
      AND policyname = 'Allow Insert Authenticated'
  ) THEN
    RAISE EXCEPTION
      'notifications hardening gate: legacy policy "Allow Insert Authenticated" still present on public.notifications';
  END IF;

  -- (a) no permissive INSERT policy for authenticated/public with an
  --     unrestricted WITH CHECK (true, (true), or an omitted check) survives.
  SELECT string_agg(policyname, ', ')
    INTO v_leftover
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'notifications'
    AND cmd = 'INSERT'
    AND permissive = 'PERMISSIVE'
    AND (roles && ARRAY['authenticated', 'public']::name[])
    AND regexp_replace(lower(COALESCE(with_check, 'true')), '[[:space:]()]', '', 'g') = 'true';

  IF v_leftover IS NOT NULL THEN
    RAISE EXCEPTION
      'notifications hardening gate: permissive authenticated INSERT policy with an unrestricted WITH CHECK survives: %',
      v_leftover;
  END IF;
END $$;

-- ===========================================================================
-- ROLLBACK (Stage A hotfix -> pre-hotfix Stage A state)
-- ===========================================================================
-- BEGIN;
-- DROP POLICY IF EXISTS notifications_insert_self_compat ON public.notifications;
-- DROP POLICY IF EXISTS notifications_insert_challenge_parties_compat ON public.notifications;
-- DROP POLICY IF EXISTS notifications_insert_match_ranking_compat ON public.notifications;
-- DROP POLICY IF EXISTS notifications_insert_join_request_compat ON public.notifications;
-- CREATE POLICY "Allow Insert Authenticated" ON public.notifications
--   FOR INSERT TO authenticated WITH CHECK (true);
-- COMMIT;
-- END incorporated migration: 20260726120000_drop_legacy_notifications_insert_policy_stage_a.sql

-- BEGIN incorporated migration: 20260724131000_revoke_direct_rating_writes_stage_b.sql
-- ===========================================================================
-- Security patch M1 — No-show ranking (Stage B: full closure)
-- ---------------------------------------------------------------------------
-- Apply ONLY after the secure app build (1.1.19/40) is live in both stores
-- (see rollout in the PR). This revokes the direct write paths so
-- rating_adjustments / no_show_recovery_state can be written ONLY through the
-- SECURITY DEFINER RPC process_match_no_show_ranking (or service_role).
--
-- BREAKING for pre-1.1.19/40 clients: their in-app no-show processing (direct
-- INSERT/UPSERT during survey finalization) stops working. Accepted per the
-- approved rollout (web is already on the RPC; few native users; update prompt).
-- Reading own/ shared rows is unaffected. Rollback SQL at the bottom.
-- ===========================================================================

-- rating_adjustments: remove the permissive INSERT policy and direct write grants.
DROP POLICY IF EXISTS rating_adjustments_insert_authenticated ON public.rating_adjustments;
REVOKE INSERT, UPDATE, DELETE ON public.rating_adjustments FROM authenticated;

-- no_show_recovery_state: remove permissive INSERT/UPDATE policies and grants.
DROP POLICY IF EXISTS no_show_recovery_state_insert_authenticated ON public.no_show_recovery_state;
DROP POLICY IF EXISTS no_show_recovery_state_update_authenticated ON public.no_show_recovery_state;
REVOKE INSERT, UPDATE, DELETE ON public.no_show_recovery_state FROM authenticated;

-- service_role keeps full access; SELECT stays governed by the scoped policies
-- created in 20260724121000 (own rows / shared-match for rating_adjustments,
-- own row for no_show_recovery_state).

-- ===========================================================================
-- ROLLBACK (Stage B -> Stage A state)
-- ===========================================================================
-- BEGIN;
-- GRANT INSERT ON public.rating_adjustments TO authenticated;
-- CREATE POLICY rating_adjustments_insert_authenticated ON public.rating_adjustments
--   FOR INSERT TO authenticated WITH CHECK (true);
-- GRANT INSERT, UPDATE ON public.no_show_recovery_state TO authenticated;
-- CREATE POLICY no_show_recovery_state_insert_authenticated ON public.no_show_recovery_state
--   FOR INSERT TO authenticated WITH CHECK (true);
-- CREATE POLICY no_show_recovery_state_update_authenticated ON public.no_show_recovery_state
--   FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
-- COMMIT;
-- END incorporated migration: 20260724131000_revoke_direct_rating_writes_stage_b.sql

-- BEGIN incorporated migration: 20260724132000_notifications_rpc_only_stage_b.sql
-- ===========================================================================
-- Security patch M3 — Notifications (Stage B: full closure)
-- ---------------------------------------------------------------------------
-- Apply ONLY after the secure app build (1.1.19/40) is live AND every direct
-- cross-user `from('notifications').insert()` client call site is routed
-- through a validating RPC (see the call-site table in the PR). This drops the
-- Stage A interim relationship policy, the Stage A hotfix compatibility policies
-- (20260726120000) AND the legacy "Allow Insert Authenticated" policy
-- (finding #22), leaving ONLY self-insert; all cross-user notifications then
-- flow through SECURITY DEFINER RPCs (create_notification, send_match_invite,
-- send_call_to_vote, enqueue_*), which generate content server-side and validate
-- the relationship.
--
-- BREAKING for pre-1.1.19/40 clients: any client still inserting a notification
-- directly for ANOTHER user is denied. Accepted per the approved rollout.
-- Rollback SQL at the bottom.
-- ===========================================================================

DROP POLICY IF EXISTS notifications_insert_related_or_self ON public.notifications;

-- Also drop the legacy CHECK(true) policy (finding #22) and every Stage A hotfix
-- compatibility policy so Stage B truly leaves ONLY self-insert. Belt-and-
-- suspenders: the 20260726120000 hotfix already dropped "Allow Insert
-- Authenticated", but Stage B must be self-sufficient regardless of apply order.
DROP POLICY IF EXISTS "Allow Insert Authenticated" ON public.notifications;
DROP POLICY IF EXISTS notifications_insert_self_compat ON public.notifications;
DROP POLICY IF EXISTS notifications_insert_challenge_parties_compat ON public.notifications;
DROP POLICY IF EXISTS notifications_insert_match_ranking_compat ON public.notifications;
DROP POLICY IF EXISTS notifications_insert_join_request_compat ON public.notifications;

DROP POLICY IF EXISTS notifications_insert_self_only ON public.notifications;
CREATE POLICY notifications_insert_self_only
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Deploy gate: after Stage B, no permissive authenticated/public INSERT policy
-- with an unrestricted WITH CHECK may survive, and only self-insert remains.
DO $$
DECLARE
  v_leftover text;
BEGIN
  SELECT string_agg(policyname, ', ')
    INTO v_leftover
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'notifications'
    AND cmd = 'INSERT'
    AND permissive = 'PERMISSIVE'
    AND (roles && ARRAY['authenticated', 'public']::name[])
    AND regexp_replace(lower(COALESCE(with_check, 'true')), '[[:space:]()]', '', 'g') = 'true';
  IF v_leftover IS NOT NULL THEN
    RAISE EXCEPTION
      'Stage B gate: permissive authenticated INSERT policy with an unrestricted WITH CHECK survives: %',
      v_leftover;
  END IF;
END $$;

-- ===========================================================================
-- ROLLBACK (Stage B -> Stage A state)
-- ===========================================================================
-- BEGIN;
-- DROP POLICY IF EXISTS notifications_insert_self_only ON public.notifications;
-- -- Recreate the Stage A interim policy from 20260724122000 (see that file).
-- COMMIT;
-- END incorporated migration: 20260724132000_notifications_rpc_only_stage_b.sql

-- BEGIN incorporated migration: 20260724134000_drop_anon_insert_jugadores_fotos_stage_b.sql
-- ===========================================================================
-- Security patch M4 — Storage jugadores-fotos (Stage B: full closure)
-- ---------------------------------------------------------------------------
-- Apply ONLY after the web build routing guest uploads through the Edge
-- Function (upload-voting-photo, service_role) is live. This drops the broad
-- anon/authenticated INSERT policy, leaving:
--   * public SELECT (jugadores_fotos_public_read) — images keep loading;
--   * owner-scoped INSERT/UPDATE for authenticated (jugadores_fotos_owner_*
--     from 20260724124000) — users upload only into their own namespace;
--   * NO anon write path at all — guest photo uploads go through the Edge
--     Function with a validated single-use capability token (service_role).
--
-- After this migration there is NO anonymous INSERT/UPDATE/DELETE on
-- storage.objects for this bucket. Rollback SQL at the bottom.
-- ===========================================================================

DROP POLICY IF EXISTS jugadores_fotos_anon_authenticated_insert ON storage.objects;

-- ===========================================================================
-- ROLLBACK (Stage B -> Stage A state)
-- ===========================================================================
-- BEGIN;
-- CREATE POLICY jugadores_fotos_anon_authenticated_insert ON storage.objects
--   FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'jugadores-fotos');
-- COMMIT;
-- END incorporated migration: 20260724134000_drop_anon_insert_jugadores_fotos_stage_b.sql

-- Canonical anon-write closure. Public writes flow through validated RPCs or Edge Functions.
REVOKE INSERT, UPDATE, DELETE ON public.rating_adjustments FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.no_show_recovery_state FROM anon;

-- The original canonical dump used broad authenticated bucket policies under
-- different names than the rollout migration knew about. Remove those aliases
-- so only the owner-scoped policies installed by Stage A remain.
DROP POLICY IF EXISTS jugadores_fotos_authenticated_insert ON storage.objects;
DROP POLICY IF EXISTS jugadores_fotos_authenticated_update ON storage.objects;

-- BEGIN AUTHENTICATED EXECUTE ALLOWLIST
-- Exact, versioned identities. New client RPCs or RLS helpers must be reviewed
-- and added here; name-only grants and silent catalog expansion are forbidden.
revoke execute on all functions in schema public from authenticated;

do $authenticated_execute_allowlist$
declare
  allowed_signature text;
begin
  for allowed_signature in
    select allowlist.signature
    from (values
    ('public.accept_tournament_team_invitation(text)', 'frontend_legitimate'),
    ('public.acknowledge_tournament_document(uuid,boolean)', 'frontend_legitimate'),
    ('public.add_tournament_match_event(uuid,uuid,jsonb)', 'frontend_legitimate'),
    ('public.add_tournament_roster_player(uuid,uuid,uuid,uuid,uuid,text,text,smallint,text,text,boolean)', 'frontend_legitimate'),
    ('public.admin_close_payments(bigint,boolean)', 'frontend_legitimate'),
    ('public.admin_remind_pending_payments(bigint)', 'frontend_legitimate'),
    ('public.admin_set_payment_status(bigint,bigint,text)', 'frontend_legitimate'),
    ('public.admin_update_payment_settings(bigint,numeric,uuid,text,text,text)', 'frontend_legitimate'),
    ('public.archive_tournament_team_entry(uuid,uuid,text)', 'frontend_legitimate'),
    ('public.auto_match_user_in_proposal(bigint,uuid)', 'rls_helper_required'),
    ('public.auto_schedule_tournament_matches(uuid,uuid)', 'frontend_legitimate'),
    ('public.can_read_tournament_fixture_scope(uuid,uuid)', 'rls_helper_required'),
    ('public.can_read_tournament_match(uuid)', 'rls_helper_required'),
    ('public.can_read_tournament_projection_scope(uuid,uuid)', 'rls_helper_required'),
    ('public.can_read_tournament_team_entry(uuid,uuid)', 'rls_helper_required'),
    ('public.cancel_my_availability()', 'frontend_legitimate'),
    ('public.cancel_own_match_join_request(bigint)', 'frontend_legitimate'),
    ('public.cancel_partido_as_admin(bigint,text)', 'frontend_legitimate'),
    ('public.cancel_tournament_media_upload_session(uuid)', 'frontend_legitimate'),
    ('public.challenge_user_is_owner_or_captain(uuid,uuid)', 'rls_helper_required'),
    ('public.change_tournament_media_gallery_state(uuid,text,text)', 'frontend_legitimate'),
    ('public.change_tournament_status(uuid,uuid,text)', 'frontend_legitimate'),
    ('public.claim_auto_match_organizer(bigint)', 'frontend_legitimate'),
    ('public.cleanup_voting_access_state_as_admin(bigint)', 'frontend_legitimate'),
    ('public.create_guest_match_invite(bigint)', 'frontend_legitimate'),
    ('public.create_manual_fixture_version(uuid,uuid,uuid,uuid,uuid)', 'frontend_legitimate'),
    ('public.create_my_auto_match_proposal(text)', 'frontend_legitimate'),
    ('public.create_notification(text,uuid,jsonb)', 'frontend_legitimate'),
    ('public.create_push_test_notification(text,bigint)', 'frontend_legitimate'),
    ('public.create_tournament_announcement_draft(uuid,uuid,uuid,text,text,text,text,text,text,timestamp with time zone,uuid,text,uuid)', 'frontend_legitimate'),
    ('public.create_tournament_court(uuid,uuid,text,text,text)', 'frontend_legitimate'),
    ('public.create_tournament_disciplinary_override(uuid,text,integer,text,uuid)', 'frontend_legitimate'),
    ('public.create_tournament_document(uuid,uuid,uuid,text,text,text,text,text,timestamp with time zone,uuid)', 'frontend_legitimate'),
    ('public.create_tournament_match_correction(uuid,uuid)', 'frontend_legitimate'),
    ('public.create_tournament_media_gallery(uuid,uuid,uuid,uuid,uuid,text,text,text,uuid)', 'frontend_legitimate'),
    ('public.create_tournament_organization(text,text,uuid)', 'frontend_legitimate'),
    ('public.create_tournament_points_adjustment(uuid,uuid,uuid,uuid,uuid,integer,text,uuid)', 'frontend_legitimate'),
    ('public.create_tournament_provisional_player(uuid,uuid,text)', 'frontend_legitimate'),
    ('public.create_tournament_season(uuid,text,text,date,date,uuid)', 'frontend_legitimate'),
    ('public.create_tournament_team_entry(uuid,uuid,uuid,uuid,text,text,text,text,text,uuid,text,text,uuid)', 'frontend_legitimate'),
    ('public.create_tournament_venue(uuid,text,text,text,double precision,double precision,text,text,text)', 'frontend_legitimate'),
    ('public.create_tournament_with_defaults(uuid,uuid,text,text,text,text,text,text,date,date,uuid)', 'frontend_legitimate'),
    ('public.deactivate_device_token(text,text,text,text)', 'frontend_legitimate'),
    ('public.delete_my_notifications()', 'frontend_legitimate'),
    ('public.enqueue_match_participant_notification_as_actor(bigint,text,text,text,jsonb,uuid,boolean)', 'frontend_legitimate'),
    ('public.enqueue_partido_notification_as_actor(bigint,text,text,text,jsonb)', 'frontend_legitimate'),
    ('public.ensure_match_payments(bigint)', 'frontend_legitimate'),
    ('public.execute_tournament_group_draw(uuid,uuid,uuid,integer,text,boolean)', 'frontend_legitimate'),
    ('public.finalize_auto_match_proposal(bigint,text,date,text,text,numeric,text,text,text,double precision,double precision)', 'frontend_legitimate'),
    ('public.find_my_availability_matches(integer)', 'frontend_legitimate'),
    ('public.freeze_tournament_participants(uuid,uuid,uuid,uuid)', 'frontend_legitimate'),
    ('public.generate_tournament_fixture(uuid,uuid,uuid,text,jsonb,uuid)', 'frontend_legitimate'),
    ('public.get_auto_match_proposal_members(bigint)', 'frontend_legitimate'),
    ('public.get_invite_landing(text)', 'frontend_legitimate'),
    ('public.get_managed_tournament_matches()', 'frontend_legitimate'),
    ('public.get_match_squad_context(uuid,uuid,uuid)', 'frontend_legitimate'),
    ('public.get_my_auto_match_proposals()', 'frontend_legitimate'),
    ('public.get_my_managed_match_squad_context(uuid)', 'frontend_legitimate'),
    ('public.get_my_tournament_memberships(integer,integer)', 'frontend_legitimate'),
    ('public.get_my_tournament_notification_preferences(uuid)', 'frontend_legitimate'),
    ('public.get_partido_by_invite(bigint,text)', 'frontend_legitimate'),
    ('public.get_player_tournament_matches()', 'frontend_legitimate'),
    ('public.get_player_tournament_statistics(uuid)', 'frontend_legitimate'),
    ('public.get_player_tournament_suspensions(uuid)', 'frontend_legitimate'),
    ('public.get_published_tournament_documents(uuid,uuid)', 'frontend_legitimate'),
    ('public.get_published_tournament_matches(uuid,uuid,text,uuid,integer,integer)', 'frontend_legitimate'),
    ('public.get_published_tournament_media(uuid,uuid,uuid,integer,integer)', 'frontend_legitimate'),
    ('public.get_published_tournament_standings(uuid,uuid,uuid,uuid)', 'frontend_legitimate'),
    ('public.get_published_tournament_statistics(uuid,uuid,uuid,uuid)', 'frontend_legitimate'),
    ('public.get_published_tournament_teams(uuid,uuid,integer,integer)', 'frontend_legitimate'),
    ('public.get_survey_scheduler_health(integer)', 'frontend_legitimate'),
    ('public.get_team_registration_context(uuid,uuid)', 'frontend_legitimate'),
    ('public.get_tournament_announcement(uuid)', 'frontend_legitimate'),
    ('public.get_tournament_communications_admin_context(uuid,uuid)', 'frontend_legitimate'),
    ('public.get_tournament_communications_inbox(uuid,text,integer,integer)', 'frontend_legitimate'),
    ('public.get_tournament_competition_context(uuid)', 'frontend_legitimate'),
    ('public.get_tournament_fixture_context(uuid,uuid,uuid)', 'frontend_legitimate'),
    ('public.get_tournament_match_operation_context(uuid,uuid)', 'frontend_legitimate'),
    ('public.get_tournament_match_operations_context(uuid,uuid,uuid)', 'frontend_legitimate'),
    ('public.get_tournament_media_admin_context(uuid,uuid,text,integer,integer)', 'frontend_legitimate'),
    ('public.get_tournament_participant_hub(uuid,uuid)', 'frontend_legitimate'),
    ('public.get_tournament_participant_match(uuid)', 'frontend_legitimate'),
    ('public.get_tournament_schedule_context(uuid,uuid,uuid)', 'frontend_legitimate'),
    ('public.get_tournament_standings_context(uuid,uuid,uuid,uuid,uuid)', 'frontend_legitimate'),
    ('public.get_tournament_statistics_context(uuid,uuid,uuid,uuid,uuid)', 'frontend_legitimate'),
    ('public.get_tournament_teams_context(uuid,uuid)', 'frontend_legitimate'),
    ('public.get_tournament_workspace_context()', 'frontend_legitimate'),
    ('public.handle_tournament_media_report(uuid,text,text)', 'frontend_legitimate'),
    ('public.has_tournament_organization_capability(uuid,text)', 'rls_helper_required'),
    ('public.inc_numeric(text,text,uuid,numeric)', 'frontend_legitimate'),
    ('public.increment_matches_abandoned(uuid)', 'frontend_legitimate'),
    ('public.increment_matches_played(uuid)', 'frontend_legitimate'),
    ('public.invite_tournament_team_manager(uuid,uuid,text,text,text)', 'frontend_legitimate'),
    ('public.is_public_voting_open(bigint)', 'frontend_legitimate'),
    ('public.is_tournament_organization_member(uuid)', 'rls_helper_required'),
    ('public.is_tournament_organization_slug_available(text)', 'frontend_legitimate'),
    ('public.is_tournament_team_manager(uuid,boolean)', 'rls_helper_required'),
    ('public.leave_owned_match_with_transfer(bigint)', 'frontend_legitimate'),
    ('public.lock_tournament_roster(uuid,uuid,uuid)', 'frontend_legitimate'),
    ('public.make_tournament_match_official(uuid,uuid)', 'frontend_legitimate'),
    ('public.mark_tournament_announcement_read(uuid,boolean)', 'frontend_legitimate'),
    ('public.mark_tournament_suspension_served(uuid,uuid,text)', 'frontend_legitimate'),
    ('public.open_tournament_match_operation(uuid,uuid,text)', 'frontend_legitimate'),
    ('public.payments_is_match_admin(bigint,uuid)', 'rls_helper_required'),
    ('public.payments_is_match_member(bigint,uuid)', 'rls_helper_required'),
    ('public.prepare_challenge_team_squad_as_actor(uuid,boolean)', 'frontend_legitimate'),
    ('public.preview_tournament_announcement_audience(uuid)', 'frontend_legitimate'),
    ('public.private_friend_group_is_active_owner(uuid)', 'rls_helper_required'),
    ('public.private_friend_group_is_owner(uuid)', 'rls_helper_required'),
    ('public.process_match_no_show_ranking(bigint,boolean)', 'frontend_legitimate'),
    ('public.public_has_voter_already_voted(bigint,text,text)', 'frontend_legitimate'),
    ('public.public_mark_voter_completed(bigint,text,text)', 'frontend_legitimate'),
    ('public.public_submit_no_lo_conozco(bigint,text,text,bigint)', 'frontend_legitimate'),
    ('public.public_submit_player_rating(bigint,text,text,bigint,integer)', 'frontend_legitimate'),
    ('public.publish_tournament_announcement(uuid,integer)', 'frontend_legitimate'),
    ('public.publish_tournament_document_version(uuid)', 'frontend_legitimate'),
    ('public.publish_tournament_fixture(uuid,uuid)', 'frontend_legitimate'),
    ('public.publish_tournament_media_gallery(uuid)', 'frontend_legitimate'),
    ('public.publish_tournament_standings_revision(uuid,text)', 'frontend_legitimate'),
    ('public.rebuild_tournament_standings(uuid,uuid,uuid,uuid,uuid,text,uuid)', 'frontend_legitimate'),
    ('public.record_manual_match_availability(uuid,uuid,uuid,text,text,text)', 'frontend_legitimate'),
    ('public.remove_tournament_roster_player(uuid,uuid,uuid)', 'frontend_legitimate'),
    ('public.reopen_own_match_join_request(bigint,text)', 'frontend_legitimate'),
    ('public.reopen_tournament_participants(uuid,uuid,uuid,text)', 'frontend_legitimate'),
    ('public.reorder_tournament_media_item(uuid,uuid,integer)', 'frontend_legitimate'),
    ('public.replace_tournament_announcement_audience(uuid,text,uuid,uuid,uuid,uuid)', 'frontend_legitimate'),
    ('public.report_my_payment(bigint)', 'frontend_legitimate'),
    ('public.report_tournament_media_asset(uuid,text,text,boolean,uuid)', 'frontend_legitimate'),
    ('public.request_tournament_match_correction(uuid,uuid,text)', 'frontend_legitimate'),
    ('public.request_tournament_media_upload_session(uuid,text,text,bigint,uuid)', 'frontend_legitimate'),
    ('public.reschedule_tournament_match(uuid,uuid,timestamp with time zone,uuid,uuid,integer,text,boolean)', 'frontend_legitimate'),
    ('public.reset_votacion(bigint)', 'frontend_legitimate'),
    ('public.resolve_match_by_code(text)', 'frontend_legitimate'),
    ('public.resolve_tournament_qualification(uuid,text)', 'frontend_legitimate'),
    ('public.respond_match_availability(uuid,text,text)', 'frontend_legitimate'),
    ('public.respond_to_auto_match_proposal(bigint,text,boolean)', 'frontend_legitimate'),
    ('public.respond_to_auto_match_substitute(bigint,text)', 'frontend_legitimate'),
    ('public.review_tournament_match_operation(uuid,uuid,text,text)', 'frontend_legitimate'),
    ('public.review_tournament_team_entry(uuid,uuid,text,text,jsonb)', 'frontend_legitimate'),
    ('public.revoke_tournament_points_adjustment(uuid,text)', 'frontend_legitimate'),
    ('public.rpc_accept_challenge(uuid,uuid)', 'frontend_legitimate'),
    ('public.rpc_accept_team_invitation(uuid)', 'frontend_legitimate'),
    ('public.rpc_can_manage_team_match(uuid)', 'frontend_legitimate'),
    ('public.rpc_cancel_team_match(uuid)', 'frontend_legitimate'),
    ('public.rpc_complete_challenge(uuid,smallint,smallint,timestamp with time zone)', 'frontend_legitimate'),
    ('public.rpc_confirm_challenge(uuid)', 'frontend_legitimate'),
    ('public.rpc_create_directed_challenge(uuid,uuid,timestamp with time zone,text,text)', 'frontend_legitimate'),
    ('public.rpc_get_challenge_head_to_head_stats(uuid,uuid,uuid)', 'frontend_legitimate'),
    ('public.rpc_get_team_challenge_rankings(text,text,text,integer,text)', 'frontend_legitimate'),
    ('public.rpc_list_incoming_team_invitations(uuid)', 'frontend_legitimate'),
    ('public.rpc_list_team_match_members(uuid)', 'frontend_legitimate'),
    ('public.rpc_reject_directed_challenge(uuid)', 'frontend_legitimate'),
    ('public.rpc_reject_team_invitation(uuid)', 'frontend_legitimate'),
    ('public.rpc_report_challenge_result(uuid,text)', 'frontend_legitimate'),
    ('public.rpc_resolve_challenge_result(uuid,text)', 'frontend_legitimate'),
    ('public.rpc_revoke_team_invitation(uuid)', 'frontend_legitimate'),
    ('public.rpc_search_challengeable_teams(text,text,text,integer)', 'frontend_legitimate'),
    ('public.rpc_send_team_invitation(uuid,uuid)', 'frontend_legitimate'),
    ('public.rpc_set_challenge_availability(uuid,text,uuid,text)', 'frontend_legitimate'),
    ('public.rpc_set_challenge_availability(uuid,text)', 'frontend_legitimate'),
    ('public.rpc_set_challenge_squad_status(uuid,text)', 'frontend_legitimate'),
    ('public.rpc_team_history_by_rival(uuid)', 'frontend_legitimate'),
    ('public.rpc_transfer_team_captaincy(uuid,uuid)', 'frontend_legitimate'),
    ('public.rpc_update_team_match_details(uuid,timestamp with time zone,text,numeric,text,smallint)', 'frontend_legitimate'),
    ('public.rpc_update_team_match_details(uuid,timestamp with time zone,text,numeric,text)', 'frontend_legitimate'),
    ('public.rpc_update_team_member_shirt_number(uuid,smallint)', 'frontend_legitimate'),
    ('public.rpc_upsert_challenge_team_selection(uuid,uuid,text,text,boolean)', 'frontend_legitimate'),
    ('public.save_match_final_teams(bigint,jsonb,jsonb)', 'frontend_legitimate'),
    ('public.save_match_squad(uuid,uuid,uuid,jsonb)', 'frontend_legitimate'),
    ('public.save_tournament_category(uuid,uuid,uuid,text,text,text,integer,smallint,smallint,text,text,smallint,text)', 'frontend_legitimate'),
    ('public.save_tournament_draw_pots(uuid,uuid,uuid,jsonb)', 'frontend_legitimate'),
    ('public.save_tournament_match_operation_draft(uuid,uuid,text,text)', 'frontend_legitimate'),
    ('public.save_tournament_schedule_windows(uuid,uuid,jsonb)', 'frontend_legitimate'),
    ('public.schedule_tournament_match(uuid,uuid,timestamp with time zone,uuid,uuid,integer,boolean,text)', 'frontend_legitimate'),
    ('public.search_tournament_arma2_teams(uuid,uuid,text,integer)', 'frontend_legitimate'),
    ('public.search_tournament_players(uuid,uuid,text,integer,uuid)', 'frontend_legitimate'),
    ('public.send_auto_match_proposal_chat_message(bigint,text,text)', 'frontend_legitimate'),
    ('public.send_call_to_vote(bigint,text,text)', 'frontend_legitimate'),
    ('public.send_match_chat_message(bigint,text,text)', 'frontend_legitimate'),
    ('public.send_match_invite(uuid,bigint,text,text,text)', 'frontend_legitimate'),
    ('public.send_match_kicked_notification_as_admin(uuid,bigint)', 'frontend_legitimate'),
    ('public.send_team_chat_message(uuid,text,text)', 'frontend_legitimate'),
    ('public.send_team_match_chat_message(uuid,text,text)', 'frontend_legitimate'),
    ('public.set_active_tournament_context(uuid,uuid,uuid)', 'frontend_legitimate'),
    ('public.set_my_tournament_hub_category(uuid,uuid)', 'frontend_legitimate'),
    ('public.set_tournament_announcement_audience(uuid,text,uuid,uuid,uuid,uuid)', 'frontend_legitimate'),
    ('public.set_tournament_announcement_link(uuid,text,uuid,text,text,integer)', 'frontend_legitimate'),
    ('public.set_tournament_match_outcome(uuid,uuid,jsonb)', 'frontend_legitimate'),
    ('public.set_tournament_match_score(uuid,uuid,jsonb)', 'frontend_legitimate'),
    ('public.set_tournament_media_cover(uuid,uuid)', 'frontend_legitimate'),
    ('public.set_tournament_workspace_preference(text,uuid)', 'frontend_legitimate'),
    ('public.submit_match_squad(uuid,uuid,uuid)', 'frontend_legitimate'),
    ('public.submit_tournament_match_operation(uuid,uuid)', 'frontend_legitimate'),
    ('public.submit_tournament_team_entry(uuid,uuid)', 'frontend_legitimate'),
    ('public.supersede_tournament_fixture(uuid,uuid,uuid)', 'frontend_legitimate'),
    ('public.sync_my_auto_match_gestations()', 'frontend_legitimate'),
    ('public.sync_my_auto_match_location_from_profile()', 'frontend_legitimate'),
    ('public.sync_team_match_to_partido_as_actor(uuid)', 'frontend_legitimate'),
    ('public.team_user_is_admin_or_owner(uuid,uuid)', 'rls_helper_required'),
    ('public.team_user_is_captain_or_owner(uuid,uuid)', 'rls_helper_required'),
    ('public.team_user_is_member(uuid,uuid)', 'rls_helper_required'),
    ('public.transfer_match_admin(bigint,uuid)', 'frontend_legitimate'),
    ('public.transition_tournament_media_asset(uuid,text,text)', 'frontend_legitimate'),
    ('public.update_draft_fixture(uuid,uuid,text,jsonb)', 'frontend_legitimate'),
    ('public.update_my_tournament_notification_preferences(uuid,boolean,boolean,boolean,boolean,boolean,boolean)', 'frontend_legitimate'),
    ('public.update_tournament_announcement_draft(uuid,text,text,text,text,text,timestamp with time zone)', 'frontend_legitimate'),
    ('public.update_tournament_configuration(uuid,uuid,jsonb)', 'frontend_legitimate'),
    ('public.update_tournament_court(uuid,uuid,jsonb)', 'frontend_legitimate'),
    ('public.update_tournament_media_gallery(uuid,text,text,text,boolean)', 'frontend_legitimate'),
    ('public.update_tournament_organization(uuid,text,text,text)', 'frontend_legitimate'),
    ('public.update_tournament_roster_player(uuid,uuid,uuid,smallint,text,text,boolean)', 'frontend_legitimate'),
    ('public.update_tournament_season(uuid,uuid,text,text,date,date,text,boolean,boolean)', 'frontend_legitimate'),
    ('public.update_tournament_team_entry(uuid,uuid,jsonb)', 'frontend_legitimate'),
    ('public.update_tournament_venue(uuid,uuid,jsonb)', 'frontend_legitimate'),
    ('public.upsert_my_availability(smallint[],time without time zone,time without time zone,text[],integer,double precision,double precision,boolean)', 'frontend_legitimate'),
    ('public.validate_guest_match_invite(bigint,text,text)', 'frontend_legitimate'),
    ('public.validate_tournament_fixture(uuid,uuid)', 'frontend_legitimate'),
    ('public.validate_tournament_match_operation(uuid,uuid)', 'frontend_legitimate'),
    ('public.validate_tournament_match_schedule(uuid,uuid,timestamp with time zone,uuid,uuid,integer)', 'frontend_legitimate'),
    ('public.void_tournament_match_event(uuid,uuid,text)', 'frontend_legitimate'),
    ('public.void_tournament_match_operation(uuid,uuid,text)', 'frontend_legitimate'),
    ('public.withdraw_tournament_team_entry(uuid,uuid,text)', 'frontend_legitimate')
    ) as allowlist(signature, category)
  loop
    perform allowed_signature::regprocedure;
    execute format(
      'grant execute on function %s to authenticated',
      allowed_signature
    );
  end loop;
end
$authenticated_execute_allowlist$;
-- END AUTHENTICATED EXECUTE ALLOWLIST

-- BEGIN AUTO-MATCH SERVICE_ROLE EXECUTE ALLOWLIST
-- Estos grants estabilizan una diferencia real entre imágenes de Supabase.
-- No constituyen acceso de cliente.
revoke execute on function public.auto_match_account_is_eligible(p_user_id uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.auto_match_account_is_eligible(p_user_id uuid)
  to service_role;

revoke execute on function public.auto_match_availabilities_are_compatible(
  p_availability_a bigint,
  p_availability_b bigint
) from public, anon, authenticated, service_role;
grant execute on function public.auto_match_availabilities_are_compatible(
  p_availability_a bigint,
  p_availability_b bigint
) to service_role;

revoke execute on function public.auto_match_availability_fits_proposal(
  p_availability_id bigint,
  p_proposal_id bigint
) from public, anon, authenticated, service_role;
grant execute on function public.auto_match_availability_fits_proposal(
  p_availability_id bigint,
  p_proposal_id bigint
) to service_role;

revoke execute on function public.auto_match_availability_has_free_slot(
  p_availability_id bigint,
  p_proposal_id bigint
) from public, anon, authenticated, service_role;
grant execute on function public.auto_match_availability_has_free_slot(
  p_availability_id bigint,
  p_proposal_id bigint
) to service_role;

revoke execute on function public.auto_match_availability_is_eligible(
  p_availability_id bigint
) from public, anon, authenticated, service_role;
grant execute on function public.auto_match_availability_is_eligible(
  p_availability_id bigint
) to service_role;

revoke execute on function public.auto_match_distance_km(
  p_latitude_a double precision,
  p_longitude_a double precision,
  p_latitude_b double precision,
  p_longitude_b double precision
) from public, anon, authenticated, service_role;
grant execute on function public.auto_match_distance_km(
  p_latitude_a double precision,
  p_longitude_a double precision,
  p_latitude_b double precision,
  p_longitude_b double precision
) to service_role;

revoke execute on function public.auto_match_duration(p_format text)
  from public, anon, authenticated, service_role;
grant execute on function public.auto_match_duration(p_format text)
  to service_role;

revoke execute on function public.auto_match_has_valid_coordinates(
  p_latitude double precision,
  p_longitude double precision
) from public, anon, authenticated, service_role;
grant execute on function public.auto_match_has_valid_coordinates(
  p_latitude double precision,
  p_longitude double precision
) to service_role;

revoke execute on function public.auto_match_member_has_free_slot(
  p_proposal_id bigint,
  p_user_id uuid
) from public, anon, authenticated, service_role;
grant execute on function public.auto_match_member_has_free_slot(
  p_proposal_id bigint,
  p_user_id uuid
) to service_role;

revoke execute on function public.auto_match_member_snapshot_fits_proposal(
  p_proposal_id bigint,
  p_user_id uuid
) from public, anon, authenticated, service_role;
grant execute on function public.auto_match_member_snapshot_fits_proposal(
  p_proposal_id bigint,
  p_user_id uuid
) to service_role;

revoke execute on function public.auto_match_member_snapshot_is_valid_for_proposal(
  p_proposal_id bigint,
  p_user_id uuid
) from public, anon, authenticated, service_role;
grant execute on function public.auto_match_member_snapshot_is_valid_for_proposal(
  p_proposal_id bigint,
  p_user_id uuid
) to service_role;

revoke execute on function public.auto_match_member_snapshots_are_compatible(
  p_proposal_id bigint,
  p_user_a uuid,
  p_user_b uuid
) from public, anon, authenticated, service_role;
grant execute on function public.auto_match_member_snapshots_are_compatible(
  p_proposal_id bigint,
  p_user_a uuid,
  p_user_b uuid
) to service_role;

revoke execute on function public.auto_match_play_range(
  p_starts_at timestamp with time zone,
  p_format text
) from public, anon, authenticated, service_role;
grant execute on function public.auto_match_play_range(
  p_starts_at timestamp with time zone,
  p_format text
) to service_role;

revoke execute on function public.auto_match_snapshots_are_compatible(
  p_latitude_a double precision,
  p_longitude_a double precision,
  p_radius_a integer,
  p_latitude_b double precision,
  p_longitude_b double precision,
  p_radius_b integer
) from public, anon, authenticated, service_role;
grant execute on function public.auto_match_snapshots_are_compatible(
  p_latitude_a double precision,
  p_longitude_a double precision,
  p_radius_a integer,
  p_latitude_b double precision,
  p_longitude_b double precision,
  p_radius_b integer
) to service_role;

revoke execute on function public.auto_match_user_real_match_conflict(
  p_user_id uuid,
  p_starts_at timestamp with time zone,
  p_format text,
  p_exclude_partido_id bigint
) from public, anon, authenticated, service_role;
grant execute on function public.auto_match_user_real_match_conflict(
  p_user_id uuid,
  p_starts_at timestamp with time zone,
  p_format text,
  p_exclude_partido_id bigint
) to service_role;

revoke execute on function public.auto_match_window_has_free_slot(
  p_user_id uuid,
  p_proposed_starts_at timestamp with time zone,
  p_format text,
  p_days_of_week smallint[],
  p_time_start time without time zone,
  p_time_end time without time zone,
  p_timezone text,
  p_fixed_time boolean,
  p_exclude_partido_id bigint
) from public, anon, authenticated, service_role;
grant execute on function public.auto_match_window_has_free_slot(
  p_user_id uuid,
  p_proposed_starts_at timestamp with time zone,
  p_format text,
  p_days_of_week smallint[],
  p_time_start time without time zone,
  p_time_end time without time zone,
  p_timezone text,
  p_fixed_time boolean,
  p_exclude_partido_id bigint
) to service_role;

revoke execute on function public.capture_auto_match_member_snapshot()
  from public, anon, authenticated, service_role;
grant execute on function public.capture_auto_match_member_snapshot()
  to service_role;

revoke execute on function public.enforce_auto_match_member_eligibility()
  from public, anon, authenticated, service_role;
grant execute on function public.enforce_auto_match_member_eligibility()
  to service_role;

revoke execute on function public.prevent_auto_match_member_snapshot_update()
  from public, anon, authenticated, service_role;
grant execute on function public.prevent_auto_match_member_snapshot_update()
  to service_role;

revoke execute on function public.sync_active_auto_match_gestations()
  from public, anon, authenticated, service_role;
grant execute on function public.sync_active_auto_match_gestations()
  to service_role;

revoke execute on function public.user_declined_auto_match_slot(
  p_user_id uuid,
  p_format text,
  p_starts_at timestamp with time zone
) from public, anon, authenticated, service_role;
grant execute on function public.user_declined_auto_match_slot(
  p_user_id uuid,
  p_format text,
  p_starts_at timestamp with time zone
) to service_role;

revoke execute on function public.user_has_overlapping_auto_match(
  p_user_id uuid,
  p_starts_at timestamp with time zone,
  p_exclude_proposal_id bigint
) from public, anon, authenticated, service_role;
grant execute on function public.user_has_overlapping_auto_match(
  p_user_id uuid,
  p_starts_at timestamp with time zone,
  p_exclude_proposal_id bigint
) to service_role;
-- END AUTO-MATCH SERVICE_ROLE EXECUTE ALLOWLIST
