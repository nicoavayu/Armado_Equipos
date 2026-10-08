-- PHASE B (match access code) — NOT A MIGRATION. Apply by hand, with a GO, in the same
-- window as phase-b-usuarios-private-columns.sql and with the same readiness evidence
-- (PROMOTION.md): installed apps up to 1.1.21 read partidos with select('*') (and create a
-- match with insert(...).select()), which this revoke breaks.
--
-- Effect: accounts and anonymous visitors can read every partidos column except codigo.
-- Members get the code through get_match_access_codes() and the views
-- (app_private.match_access_code, 20261010133000); links resolve the code server-side.
-- Rows stay readable exactly as today (RLS unchanged); writes are unchanged.
-- Rollback: grant select on table public.partidos to anon, authenticated;
-- NOTE once applied: a new partidos column must be granted explicitly
-- (grant select (<column>) on public.partidos to anon, authenticated).
-- Verified in the Core lab: integration/core-lab/tests/match-access-code.test.mjs applies
-- this file inside rolled-back transactions.

do $partidos_access_code$
declare
  v_columns text;
begin
  if to_regprocedure('app_private.match_access_code(bigint)') is null
     or to_regprocedure('public.get_match_access_codes(bigint[])') is null then
    raise exception 'apply phase A (20261010133000) first';
  end if;

  select string_agg(format('%I', attribute.attname), ', ' order by attribute.attnum)
  into v_columns
  from pg_attribute attribute
  where attribute.attrelid = 'public.partidos'::regclass
    and attribute.attnum > 0
    and not attribute.attisdropped
    and attribute.attname <> 'codigo';

  revoke select on table public.partidos from anon, authenticated;
  execute format('grant select (%s) on table public.partidos to anon, authenticated', v_columns);
end
$partidos_access_code$;

do $partidos_access_code_check$
begin
  if has_column_privilege('authenticated', 'public.partidos', 'codigo', 'select')
     or has_column_privilege('anon', 'public.partidos', 'codigo', 'select') then
    raise exception 'partidos.codigo is still readable through the API';
  end if;
  if not has_column_privilege('authenticated', 'public.partidos', 'nombre', 'select')
     or not has_column_privilege('authenticated', 'public.partidos', 'codigo', 'insert')
     or not has_column_privilege('authenticated', 'public.partidos', 'nombre', 'update') then
    raise exception 'partidos public columns or writes lost their privileges';
  end if;
end
$partidos_access_code_check$;
