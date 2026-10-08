-- Core: a match link opens that match, not the list of every match.
--
-- anon (no session) could read every match that has a code — all of them — together with
-- its code, plus every roster: partidos_select_public_shared and
-- jugadores_select_public_shared allowed app_private.is_public_match_visible(id), which is
-- just "not deleted and has a code". Without opening any link, anyone could list who plays
-- where and when, and collect the codes that open public voting and guest joining.
-- Now anon reads one match at a time and only by presenting its code:
--   * public_get_match_by_code(p_codigo, p_partido_id) returns { partido, jugadores } for
--     that single match (the same rows the public pages read before from partidos,
--     partidos_view and jugadores), or NULL;
--   * the two anon policies are dropped, so anon has no direct read on partidos,
--     jugadores or the views over them.
-- The code-gated RPCs that already existed (resolve_match_by_code, get_partido_by_invite,
-- validate_guest_match_invite, public voting) are unchanged. Signed-in accounts are
-- unchanged: any account still lists every match with its code (which matches count as
-- private is a product decision; see the Core report).

create or replace function public.public_get_match_by_code(p_codigo text, p_partido_id bigint default null)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'partido', to_jsonb(match_row),
    'jugadores', coalesce((
      select jsonb_agg(to_jsonb(roster_player) order by roster_player.id)
      from public.jugadores roster_player
      where roster_player.partido_id = match_row.id
    ), '[]'::jsonb)
  )
  from public.partidos match_row
  where nullif(btrim(coalesce(p_codigo, '')), '') is not null
    and upper(btrim(match_row.codigo)) = upper(btrim(p_codigo))
    and (p_partido_id is null or match_row.id = p_partido_id)
    and match_row.deleted_at is null
    and public.normalize_partido_estado(match_row.estado) not in ('deleted', 'cancelado')
  order by match_row.id desc
  limit 1
$function$;

revoke all on function public.public_get_match_by_code(text, bigint) from public;
grant execute on function public.public_get_match_by_code(text, bigint) to anon, authenticated, service_role;

drop policy if exists partidos_select_public_shared on public.partidos;
drop policy if exists jugadores_select_public_shared on public.jugadores;

do $public_match_reads_check$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('partidos', 'jugadores')
      and cmd in ('SELECT', 'ALL')
      and ('anon' = any (roles) or 'public' = any (roles))
  ) then
    raise exception 'anon can still read partidos or jugadores directly';
  end if;
  if not has_function_privilege('anon', 'public.public_get_match_by_code(text,bigint)', 'execute') then
    raise exception 'public_get_match_by_code must be callable from public links';
  end if;
end
$public_match_reads_check$;
