-- Rollback of 20261010133000 (match access code). Run as postgres, in one transaction, after the
-- rollback of 134000. The three views return the column codigo again (rewritten from their
-- current definition, like the migration did); the code RPCs are removed. Data: none. Effect:
-- every account that can read a match row through a view reads its code again.
do $rollback$
declare
  v_view text;
  v_def text;
begin
  foreach v_view in array array['partidos_view', 'partidos_abiertos_operativos', 'partidos_abiertos_operativos_v2'] loop
    v_def := pg_get_viewdef(format('public.%I', v_view)::regclass);
    -- (a single-table view prints the call without its alias)
    if v_def ~ 'app_private\.match_access_code\((p\.)?id\) AS codigo' then
      execute format('create or replace view public.%I with (security_invoker = on) as %s', v_view,
        regexp_replace(v_def, 'app_private\.match_access_code\((p\.)?id\) AS codigo', 'p.codigo'));
    end if;
  end loop;
end
$rollback$;
drop function if exists public.get_match_access_codes(bigint[]);
drop function if exists app_private.match_access_code(bigint);
delete from supabase_migrations.schema_migrations where version = '20261010133000';
