-- Rollback of 20261010139000 (roster added_by private). Run as postgres, in one transaction,
-- before the rollback of 138000. Data: none lost — every value recorded in
-- app_private.jugadores_added_by (including rows added while 139000 was live) goes back to
-- the column; the private table is kept. Effect: any account that can read a roster row reads
-- who added that player again.
alter table public.jugadores add column if not exists added_by uuid;
comment on column public.jugadores.added_by is
  'Account that inserted the roster row (set by trigger from auth.uid(); null for rows created before 20261010128000 or by the backend).';

drop trigger if exists trg_jugadores_added_by on public.jugadores;
update public.jugadores j
set added_by = a.added_by
from app_private.jugadores_added_by a
where a.jugador_id = j.id and j.added_by is distinct from a.added_by;

-- The trigger as 20261010128000 created it (sets the column, keeps it on update).
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
grant execute on function app_private.tg_jugadores_added_by() to public;
create trigger trg_jugadores_added_by
before insert or update on public.jugadores
for each row execute function app_private.tg_jugadores_added_by();

-- get_match_contact_phone as 20261010135000 left it.
CREATE OR REPLACE FUNCTION public.get_match_contact_phone(p_partido_id bigint, p_user_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  select nullif(btrim(private_row.telefono), '')
  into v_phone
  from app_private.usuarios_private private_row
  where private_row.user_id = p_user_id;

  return v_phone;
end;
$function$;

delete from supabase_migrations.schema_migrations where version = '20261010139000';
