begin;

-- Canonical global availability contract. The caller can only mutate its own
-- state: the actor always comes from auth.uid() and no user id is accepted.
--
-- The Auto-Match user lock is deliberately the first lock. It serializes this
-- toggle with upsert/cancel/sync and also makes concurrent repeated toggles
-- deterministic. The certified cancellation implementation remains untouched
-- and is composed through cancel_my_availability_detailed().
create or replace function public.set_my_global_availability(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.usuarios%rowtype;
  v_free_player_id uuid;
  v_cancel record;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_enabled is null then
    raise exception using errcode = '22023', message = 'global_availability_enabled_required';
  end if;

  -- First lock in the transaction. Reentrant when the cancellation RPC takes
  -- the same lock below.
  perform public.auto_match_lock_user(v_uid);

  select profile.*
  into v_profile
  from public.usuarios profile
  where profile.id = v_uid
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'profile_not_found';
  end if;

  update public.usuarios profile
  set acepta_invitaciones = p_enabled,
      updated_at = pg_catalog.now()
  where profile.id = v_uid;

  if p_enabled then
    -- Reuse the newest historical free-player row and keep every older row
    -- inactive. The per-user advisory lock makes the read/update/insert branch
    -- race-free even though the legacy table has no unique(user_id) constraint.
    select free_player.id
    into v_free_player_id
    from public.jugadores_sin_partido free_player
    where free_player.user_id = v_uid
    order by free_player.created_at desc, free_player.id desc
    limit 1
    for update;

    if v_free_player_id is null then
      insert into public.jugadores_sin_partido (
        user_id,
        nombre,
        localidad,
        avatar_url,
        disponible
      ) values (
        v_uid,
        coalesce(nullif(pg_catalog.btrim(v_profile.nombre), ''), 'Usuario'),
        coalesce(nullif(pg_catalog.btrim(v_profile.localidad), ''), 'Sin especificar'),
        v_profile.avatar_url,
        true
      )
      returning id into v_free_player_id;
    else
      update public.jugadores_sin_partido free_player
      set disponible = (free_player.id = v_free_player_id),
          nombre = case
            when free_player.id = v_free_player_id
              then coalesce(nullif(pg_catalog.btrim(v_profile.nombre), ''), 'Usuario')
            else free_player.nombre
          end,
          localidad = case
            when free_player.id = v_free_player_id
              then coalesce(nullif(pg_catalog.btrim(v_profile.localidad), ''), 'Sin especificar')
            else free_player.localidad
          end,
          avatar_url = case
            when free_player.id = v_free_player_id then v_profile.avatar_url
            else free_player.avatar_url
          end
      where free_player.user_id = v_uid;
    end if;

    -- Enabling global availability never creates or revives Auto-Match.
    return pg_catalog.jsonb_build_object(
      'enabled', true,
      'invitationsEnabled', true,
      'freePlayerAvailable', true,
      'autoMatchStarted', false
    );
  end if;

  update public.jugadores_sin_partido free_player
  set disponible = false
  where free_player.user_id = v_uid
    and free_player.disponible;

  -- Same certified semantics as the dedicated "Dejar de buscar" flow:
  -- player_availability plus proposal memberships/invites and cleanup.
  select cancellation.*
  into v_cancel
  from public.cancel_my_availability_detailed() cancellation;

  return pg_catalog.jsonb_build_object(
    'enabled', false,
    'invitationsEnabled', false,
    'freePlayerAvailable', false,
    'autoMatchStarted', false,
    'availabilityCancelled', coalesce(v_cancel.availability_cancelled, 0),
    'gestationMembershipsReleased', coalesce(v_cancel.gestation_memberships_released, 0),
    'createdInvitesWithdrawn', coalesce(v_cancel.created_invites_withdrawn, 0),
    'createdMembershipsKept', coalesce(v_cancel.created_memberships_kept, 0)
  );
end;
$$;

revoke all on function public.set_my_global_availability(boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.set_my_global_availability(boolean)
  to authenticated;

commit;
