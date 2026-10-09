-- Core: a match's access code is for the people who already have access to it.
--
-- partidos.codigo opens the match's public voting and its invitation page. Any signed-in
-- account could list every code (SELECT on partidos and on its views is open to
-- authenticated, and the "Quiero jugar" RPC returned it). Rule
-- (docs/database/core-review/partidos-access-code-proposal.md):
--   the code is visible to the match admin and the players in its roster; every other
--   account still discovers published matches (everything but the code), and whoever got
--   the code in a link (WhatsApp) keeps using it: the server validates it, never hands it out.
-- Phase A (this migration, safe for installed apps, which never read other matches' codes
-- from these views or from discovery):
--   * app_private.match_access_code(match): the code for its admin or a roster player,
--     NULL for anyone else (and for anonymous visitors);
--   * partidos_view, partidos_abiertos_operativos(_v2) return that instead of the column
--     (members see the code, everybody else NULL) — and get_open_matches_for_quiero_jugar_v2
--     reads _v2, so discovery no longer carries codes;
--   * get_match_access_codes(ids): the codes of the caller's own matches, for the client
--     (share, vote, invite).
-- Phase B (docs/database/core-review/phase-b-partidos-access-code.sql, by hand, together
-- with the usuarios phase B): revoke the column on the table itself.
-- Links keep working: resolve_match_by_code, public_get_match_by_code, get_partido_by_invite,
-- validate_guest_match_invite and the public voting RPCs take the code as input.

create or replace function app_private.match_access_code(p_partido_id bigint)
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select match_row.codigo
  from public.partidos match_row
  where match_row.id = p_partido_id
    and auth.uid() is not null
    and (
      coalesce(match_row.creado_por, match_row.admin_id) = auth.uid()
      or match_row.admin_id = auth.uid()
      or exists (
        select 1 from public.jugadores roster_player
        where roster_player.partido_id = match_row.id and roster_player.usuario_id = auth.uid()
      )
    )
$function$;

-- The views run as the caller (security_invoker), so the caller needs to execute it; it
-- lives in app_private (not exposed by the API) and only answers members.
revoke all on function app_private.match_access_code(bigint) from public;
grant execute on function app_private.match_access_code(bigint) to anon, authenticated, service_role;

create or replace function public.get_match_access_codes(p_partido_ids bigint[])
returns table (partido_id bigint, codigo text)
language sql
stable
security definer
set search_path to ''
as $function$
  select requested.id, app_private.match_access_code(requested.id)
  from (select distinct unnest((coalesce(p_partido_ids, '{}'::bigint[]))[1:200]) as id) requested
  where app_private.match_access_code(requested.id) is not null
$function$;

revoke all on function public.get_match_access_codes(bigint[]) from public, anon;
grant execute on function public.get_match_access_codes(bigint[]) to authenticated, service_role;

-- The three views keep their own definition and only return the masked code instead of the
-- column. They are rewritten from their CURRENT definition: Core Production's partidos_view is
-- not the repository's (other columns, an embedded roster, no deleted_at filter), and
-- installed apps read it with select('*'), so nothing but codigo may change.
do $match_access_code_views$
declare
  v_view text;
  v_def text;
  v_new text;
begin
  foreach v_view in array array['partidos_view', 'partidos_abiertos_operativos', 'partidos_abiertos_operativos_v2'] loop
    v_def := pg_get_viewdef(format('public.%I', v_view)::regclass);
    if v_def ~ 'match_access_code' then
      continue;
    end if;
    v_new := regexp_replace(v_def, '(\n\s+)(p\.)?codigo,', '\1app_private.match_access_code(p.id) AS codigo,');
    if v_new = v_def then
      raise exception 'view % has no codigo column to mask', v_view;
    end if;
    execute format('create or replace view public.%I with (security_invoker = on) as %s', v_view, v_new);
  end loop;
end
$match_access_code_views$;

do $match_access_code_check$
begin
  if has_function_privilege('anon', 'public.get_match_access_codes(bigint[])', 'execute') then
    raise exception 'get_match_access_codes must not be executable by anon';
  end if;
  if exists (
    select 1 from pg_class view_row
    where view_row.oid in ('public.partidos_view'::regclass, 'public.partidos_abiertos_operativos'::regclass,
                           'public.partidos_abiertos_operativos_v2'::regclass)
      and not coalesce(view_row.reloptions @> array['security_invoker=on'], false)
  ) then
    raise exception 'match views must stay security_invoker';
  end if;
end
$match_access_code_check$;
