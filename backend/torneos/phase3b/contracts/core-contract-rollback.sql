-- Phase 3B — R3 ROLLBACK (Core staging hhyvmhgpapyuzjgxfnqv ONLY; pinned by sha256 in
-- phase3b/remote/core-contract.mjs and checked by rollback-core-contract.sh before the PAT).
--
-- Reverts EXACTLY what the two Core contract migrations created (v1 2967ae6f…, v1.1 5256413…):
--   • function public.torneos_contract_execute(text, text, jsonb)
--   • functions app_private.torneos_contract_email(text), torneos_contract_url(text),
--     torneos_contract_visible_player(uuid), torneos_contract_importable_team(uuid, uuid)
--   • tables app_private.torneos_contract_nonces, app_private.torneos_contract_rate_events
--     (their indexes torneos_contract_nonces_expiry / _pkey, torneos_contract_rate_events_actor /
--     _pkey drop with them)
--   • the two ledger rows R3 wrote in supabase_migrations.schema_migrations, and ONLY if their
--     statements digest is the one R3 writes (a row R3 did not write aborts the whole rollback).
-- It never drops schema app_private (shared with Core), never names a tournament_* object,
-- auth.*, cron.* or storage.*, and uses no CASCADE: an unexpected dependent aborts everything.
-- One transaction: either every step commits or nothing changes. Re-runnable (IF EXISTS).
begin;
set local lock_timeout = '4s';
set local statement_timeout = '60s';

do $r3_rollback_pre$
declare
  v_bad_ledger text;
begin
  if to_regnamespace('app_private') is null then
    raise exception 'R3_ROLLBACK_ABORTED: schema app_private is missing';
  end if;
  -- Ledger rows for the two versions, if present, must be the rows R3 writes (same digest).
  select string_agg(m.version || ':' || coalesce(md5(array_to_string(m.statements, chr(30))), 'null'), ', ')
    into v_bad_ledger
    from supabase_migrations.schema_migrations m
   where m.version in ('20260914120000', '20260915120000')
     and (m.version, coalesce(md5(array_to_string(m.statements, chr(30))), ''))
         not in (('20260914120000', '09ad7d261523fa1c2bb6e203a1624467'), ('20260915120000', 'b424cc66022e7ab721e8070d0b05cdc7'));
  if v_bad_ledger is not null then
    raise exception 'R3_ROLLBACK_ABORTED: ledger rows not written by R3: %', v_bad_ledger;
  end if;
end
$r3_rollback_pre$;

drop function if exists public.torneos_contract_execute(text, text, jsonb);
drop function if exists app_private.torneos_contract_importable_team(uuid, uuid);
drop function if exists app_private.torneos_contract_visible_player(uuid);
drop function if exists app_private.torneos_contract_url(text);
drop function if exists app_private.torneos_contract_email(text);
drop table if exists app_private.torneos_contract_rate_events;
drop table if exists app_private.torneos_contract_nonces;
delete from supabase_migrations.schema_migrations
 where version in ('20260914120000', '20260915120000');

do $r3_rollback_post$
declare
  v_left bigint;
begin
  select count(*) into v_left
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app_private' and c.relname like 'torneos\_contract\_%';
  if v_left <> 0 then
    raise exception 'R3_ROLLBACK_ABORTED: % torneos_contract_* relations left in app_private', v_left;
  end if;
  select count(*) into v_left
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app_private') and p.proname like 'torneos\_contract\_%';
  if v_left <> 0 then
    raise exception 'R3_ROLLBACK_ABORTED: % torneos_contract_* functions left', v_left;
  end if;
  if to_regnamespace('app_private') is null then
    raise exception 'R3_ROLLBACK_ABORTED: schema app_private vanished';
  end if;
  select count(*) into v_left
    from supabase_migrations.schema_migrations
   where version in ('20260914120000', '20260915120000');
  if v_left <> 0 then
    raise exception 'R3_ROLLBACK_ABORTED: % ledger rows left', v_left;
  end if;
end
$r3_rollback_post$;
commit;
