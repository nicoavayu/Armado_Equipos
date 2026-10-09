-- Core (URGENT): only the organizer of a match can cancel it through the API.
--
-- In Core Production, public.cancel_partido_with_notification(bigint, text) is SECURITY DEFINER,
-- executable by PUBLIC, anon, authenticated and service_role, and checks nobody: anyone, with
-- no session, can cancel and soft-delete ANY match (estado = 'cancelado', deleted_at = now())
-- and send its roster the cancellation notice.
-- Callers (review of 2026-10-09): only installed 1.1.21 (dad2a0b9, src/services/db/matches.js),
-- as the organizer, with a session. The web on main, the edge functions, the other SQL
-- functions and pg_cron do not call it.
-- Change (stand-alone: it needs nothing from 20261010119000…, and applies on Production's schema
-- as it is and on the repository's):
--   * the body gets a guard at its top: when called through the API (role anon or
--     authenticated), the caller must be the match's creado_por (or its admin_id, on a schema
--     that has that column); otherwise 42501 and nothing changes. service_role, the owner and
--     pg_cron are not affected. The rest of the body is unchanged;
--   * anon and PUBLIC lose EXECUTE; authenticated and service_role keep what they had.
-- Only the reviewed body (md5 of prosrc 3651c2dc0a7d0543730dbb541eeaa91a, identical in Production
-- and in the repository) is changed; an already guarded one is left alone (re-running is a
-- no-op); any other body stops the migration. The original body and its ACL are saved in
-- app_private.core_function_before for the exact rollback
-- (docs/database/core-review/runbook/rollbacks/20261010118000_core_cancel_match_organizer_only.rollback.sql).

create table if not exists app_private.core_function_before (
  function_name text primary key,
  prosrc text not null,
  acl text not null,
  saved_by text not null,
  saved_at timestamptz not null default now()
);
revoke all on table app_private.core_function_before from public, anon, authenticated;

do $cancel$
declare
  v_fn constant regprocedure := 'public.cancel_partido_with_notification(bigint,text)'::regprocedure;
  v_src text;
  v_acl text;
  v_new text;
  v_guard constant text := $guard$
  -- 20261010118000: through the API only the match's organizer can cancel it.
  IF coalesce(nullif(current_setting('role', true), ''), 'none') IN ('anon', 'authenticated') THEN
    IF auth.uid() IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.partidos organizer_match
      WHERE organizer_match.id = p_partido_id
        AND auth.uid()::text IN (to_jsonb(organizer_match) ->> 'creado_por', to_jsonb(organizer_match) ->> 'admin_id')
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'only the organizer of this match can cancel it';
    END IF;
  END IF;
$guard$;
begin
  select p.prosrc, coalesce(p.proacl, acldefault('f'::"char", p.proowner))::text into v_src, v_acl
  from pg_proc p where p.oid = v_fn;
  if v_src ~ '20261010118000' then
    raise notice 'cancel_partido_with_notification already guarded (20261010118000): nothing to do';
    return;
  end if;
  if md5(v_src) <> '3651c2dc0a7d0543730dbb541eeaa91a' then
    raise exception 'cancel_partido_with_notification is not the reviewed body (md5 %): stop and review', md5(v_src);
  end if;
  if position(E'\nBEGIN\n' in v_src) = 0 then
    raise exception 'cancel_partido_with_notification: no BEGIN to put the guard after';
  end if;
  insert into app_private.core_function_before (function_name, prosrc, acl, saved_by)
  values (v_fn::text, v_src, v_acl, '20261010118000')
  on conflict (function_name) do nothing;
  v_new := overlay(v_src placing E'\nBEGIN\n' || v_guard from position(E'\nBEGIN\n' in v_src) for length(E'\nBEGIN\n'));
  execute format(
    'create or replace function public.cancel_partido_with_notification(p_partido_id bigint, p_reason text default %L::text) '
    'returns jsonb language plpgsql security definer as %s',
    'Partido cancelado', quote_literal(v_new));
  revoke execute on function public.cancel_partido_with_notification(bigint, text) from public, anon;
end
$cancel$;

do $$
begin
  if has_function_privilege('anon', 'public.cancel_partido_with_notification(bigint,text)', 'execute') then
    raise exception 'cancel_partido_with_notification is still executable by anon';
  end if;
  if (select prosrc !~ '20261010118000' or not prosecdef from pg_proc
      where oid = 'public.cancel_partido_with_notification(bigint,text)'::regprocedure) then
    raise exception 'cancel_partido_with_notification has no organizer guard';
  end if;
end;
$$;
