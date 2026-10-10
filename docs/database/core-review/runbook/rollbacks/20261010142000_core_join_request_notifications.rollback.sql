-- Rollback of 20261010142000 (join request notifications). Run as postgres, in one transaction.
-- Data: none. Effect: back to Production's function, where a second join request to a match
-- fails with 23505 (only the first requester of each match can ask to join).
do $rollback$
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
end
$rollback$;
delete from supabase_migrations.schema_migrations where version = '20261010142000';
