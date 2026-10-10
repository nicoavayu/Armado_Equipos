-- Core: every join request to a match notifies its organizer (Core Production fix).
--
-- In Core Production a second join request to the same match failed with 23505 on
-- uniq_notifications_user_matchref_type (user_id, match_ref_legacy, type): the AFTER INSERT
-- trigger notify_admin_join_request inserts the organizer's 'match_join_request' notice,
-- normalize_request_scoped_notification_keys clears partido_id on purpose ("request-scoped
-- notifications intentionally avoid legacy match-based unique constraints"), and then
-- fn_notifications_fill_partido_id (which fires after it, by name) puts partido_id back from
-- data.partido_id, so match_ref_legacy and the per-match indexes collide with the previous
-- request's notice and the whole request insert is rolled back. Installed apps and the web
-- both hit it (found on Production's schema, 2026-10-09).
-- Fix: fn_notifications_fill_partido_id leaves request-scoped notifications as normalize left
-- them. The rest of its body is Production's, unchanged. The function only exists in Core
-- Production (not in the repository schema): elsewhere this migration does nothing.

do $join_request_notifications$
begin
  if to_regprocedure('public.fn_notifications_fill_partido_id()') is null then
    return;
  end if;
  execute $definition$
create or replace function public.fn_notifications_fill_partido_id()
 returns trigger
 language plpgsql
as $function$
declare
  pid bigint;
  mru uuid;
begin
  -- Request-scoped notifications (one per join request: match_join_request,
  -- match_join_approved) leave partido_id empty on purpose: the per-match unique indexes
  -- would otherwise let only ONE request per match notify its organizer, and abort every
  -- following request (20261010142000). Their match travels in data.
  if lower(trim(coalesce(new.type, ''))) in ('match_join_request', 'match_join_approved')
     and coalesce(nullif(new.data ->> 'request_id', ''), nullif(new.data ->> 'requestId', '')) is not null then
    return new;
  end if;

  -- 0) Si ya viene partido_id, listo.
  if new.partido_id is not null then
    return new;
  end if;

  -- 1) Si viene match_ref_legacy (bigint), úsalo como partido_id.
  if new.match_ref_legacy is not null then
    new.partido_id := new.match_ref_legacy;
    return new;
  end if;

  -- 2) Si viene match_ref uuid, buscá el partido real (partidos.match_ref -> partidos.id)
  if new.match_ref is not null then
    select p.id into pid
    from public.partidos p
    where p.match_ref = new.match_ref
    limit 1;

    if pid is not null then
      new.partido_id := pid;
      return new;
    end if;
  end if;

  -- 3) Si viene match_ref en JSON (uuid), resolver igual que (2)
  mru := null;
  begin
    mru := nullif(new.data->>'match_ref','')::uuid;
  exception when others then
    mru := null;
  end;

  if mru is null then
    begin
      mru := nullif(new.data->>'matchRef','')::uuid;
    exception when others then
      mru := null;
    end;
  end if;

  if mru is not null then
    select p.id into pid
    from public.partidos p
    where p.match_ref = mru
    limit 1;

    if pid is not null then
      new.partido_id := pid;
      return new;
    end if;
  end if;

  -- 4) Si viene en JSON como bigint (incluye tu caso: data.partido_id)
  pid := null;

  begin
    pid := nullif(new.data->>'partido_id','')::bigint;
  exception when others then
    pid := null;
  end;

  if pid is null then
    begin
      pid := nullif(new.data->>'match_id','')::bigint;
    exception when others then
      pid := null;
    end;
  end if;

  if pid is null then
    begin
      pid := nullif(new.data->>'matchId','')::bigint;
    exception when others then
      pid := null;
    end;
  end if;

  if pid is null then
    begin
      pid := nullif(new.data->'target_params'->>'partido_id','')::bigint;
    exception when others then
      pid := null;
    end;
  end if;

  if pid is not null then
    new.partido_id := pid;
  end if;

  return new;
end;
$function$
$definition$;
  if position('match_join_request' in pg_get_functiondef('public.fn_notifications_fill_partido_id()'::regprocedure)) = 0 then
    raise exception 'fn_notifications_fill_partido_id did not get the request-scoped guard';
  end if;
end
$join_request_notifications$;
