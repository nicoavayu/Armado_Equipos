-- Core: who added each player to a roster leaves the shared row.
--
-- jugadores.added_by (20261010128000) records which account inserted a roster row: it tells
-- whether a player joined by themselves or was added by someone else, and by whom. The
-- server needs it (get_match_contact_phone shows the organizer the phone only of players who
-- joined by themselves) but no client reads it: neither 1.1.21 nor the current web name the
-- column, and select('*') does not depend on it. Rosters of matches published looking for
-- players stay readable by any signed-in account (installed apps show them), so the value
-- moves to app_private (not exposed by the API) and the column is dropped:
--   * app_private.jugadores_added_by(jugador_id, added_by): one row per roster row inserted
--     by a signed-in account; existing values are copied first;
--   * the trigger now records it AFTER INSERT (the roster row must exist for the foreign key)
--     and never changes it; an update cannot touch it because it is not in the row anymore;
--   * get_match_contact_phone reads it from there.
-- Nothing else reads jugadores.added_by (checked in the catalog: the Torneos functions that
-- mention added_by use their own tables).

create table if not exists app_private.jugadores_added_by (
  jugador_id bigint primary key references public.jugadores (id) on delete cascade,
  added_by uuid not null,
  created_at timestamptz not null default now()
);
revoke all on table app_private.jugadores_added_by from public, anon, authenticated;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'jugadores' and column_name = 'added_by') then
    execute 'insert into app_private.jugadores_added_by (jugador_id, added_by)
             select id, added_by from public.jugadores where added_by is not null
             on conflict (jugador_id) do nothing';
  end if;
end;
$$;

create or replace function app_private.tg_jugadores_added_by()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if auth.uid() is not null then
    insert into app_private.jugadores_added_by (jugador_id, added_by)
    values (new.id, auth.uid())
    on conflict (jugador_id) do nothing;
  end if;
  return null;
end;
$function$;
revoke all on function app_private.tg_jugadores_added_by() from public, anon, authenticated;

drop trigger if exists trg_jugadores_added_by on public.jugadores;
create trigger trg_jugadores_added_by
after insert on public.jugadores
for each row execute function app_private.tg_jugadores_added_by();

alter table public.jugadores drop column if exists added_by;

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
    -- (who inserted each roster row is recorded by the server), a join request (only its user can insert it, and its
    -- user_id/match_id cannot be rewritten), or an invitation they accepted (only the invitee
    -- can mark it 'accepted': send_match_invite always writes 'pending' and notifications
    -- are insert-self-only).
    if not (
      exists (
        select 1
        from public.jugadores roster_player
        join app_private.jugadores_added_by roster_origin on roster_origin.jugador_id = roster_player.id
        where roster_player.partido_id = p_partido_id and roster_player.usuario_id = p_user_id
          and roster_origin.added_by = p_user_id
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

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'jugadores' and column_name = 'added_by') then
    raise exception 'public.jugadores.added_by must not exist';
  end if;
  if exists (select 1 from pg_proc p
             where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace)
               and p.prosrc ~ '(roster_player|jugadores?)\.added_by') then
    raise exception 'a function still reads jugadores.added_by';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_jugadores_added_by'
                 and tgrelid = 'public.jugadores'::regclass and not tgisinternal) then
    raise exception 'trg_jugadores_added_by missing';
  end if;
end;
$$;
