-- Social Studio V2: previewable catalog + theme-aware export policy.
-- FREE keeps baseFamilyLimit=3. This migration does not change plan grants.

begin;

create or replace function public.get_tournament_social_snapshot(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_category_id uuid,
  p_phase_id uuid,
  p_piece text,
  p_round_id uuid default null,
  p_group_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_season_id uuid; v_policy jsonb; v_snapshot jsonb;
begin
  select season_id into v_season_id from public.tournaments
  where organization_id=p_organization_id and id=p_tournament_id;
  if v_season_id is null or not public.has_tournament_season_access(p_organization_id,v_season_id) then
    raise exception using errcode='42501',message='TORNEOS_SOCIAL_FORBIDDEN';
  end if;
  v_policy:=public.resolve_effective_tournament_season_entitlements_at(
    p_organization_id,v_season_id,now(),false,p_tournament_id
  );
  -- Snapshot access is preview/catalog access. Export authorization below is
  -- the product gate; FREE may inspect all eleven families without gaining use.
  v_snapshot:=public.get_tournament_social_snapshot_plan_legacy(
    p_organization_id,p_tournament_id,p_category_id,p_phase_id,p_piece,p_round_id,p_group_id
  );
  return v_snapshot || jsonb_build_object('seasonId',v_season_id,
    'plan',v_policy->>'plan','social',v_policy->'social','branding',v_policy->'branding');
end;
$$;

revoke all on function public.authorize_tournament_social_export(uuid,uuid,text,boolean)
  from public,anon,authenticated,service_role;
drop function public.authorize_tournament_social_export(uuid,uuid,text,boolean);

create function public.authorize_tournament_social_export(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_piece text,
  p_theme text,
  p_include_arma2_branding boolean
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_season_id uuid;
  v_policy jsonb;
  v_premium boolean;
  v_effective_branding boolean;
begin
  select season_id into v_season_id from public.tournaments
  where organization_id=p_organization_id and id=p_tournament_id;
  if v_season_id is null
    or not public.has_tournament_season_access(p_organization_id,v_season_id)
    or not public.has_tournament_social_capability(p_organization_id,'social.export') then
    raise exception using errcode='42501',message='TORNEOS_SOCIAL_EXPORT_FORBIDDEN';
  end if;

  if p_theme not in ('base','heritage','street','scoreboard','editorial') then
    raise exception using errcode='22023',message='TORNEOS_SOCIAL_THEME_UNKNOWN';
  end if;
  if p_piece not in (
    'round_results','next_fixture','standings','mvp','final','champion',
    'scorers','discipline','best_eleven','round_summary','semifinals'
  ) then
    raise exception using errcode='22023',message='TORNEOS_SOCIAL_PIECE_UNKNOWN';
  end if;

  v_policy:=public.resolve_effective_tournament_season_entitlements_at(
    p_organization_id,v_season_id,now(),false,p_tournament_id
  );
  v_premium:=coalesce(
    (v_policy->'capabilities'->>'social_studio.premium')::boolean,
    false
  );

  if not v_premium and (
    p_theme <> 'base'
    or p_piece not in ('round_results','standings','next_fixture')
  ) then
    raise exception using errcode='42501',message='TORNEOS_SOCIAL_PREMIUM_REQUIRED';
  end if;

  if p_theme = 'base' then
    if not v_premium and not p_include_arma2_branding then
      raise exception using errcode='42501',message='TORNEOS_BRANDING_PREMIUM_REQUIRED';
    end if;
    v_effective_branding:=case when v_premium then p_include_arma2_branding else true end;
  else
    -- Every Premium theme is intrinsically white-label, irrespective of input.
    v_effective_branding:=false;
  end if;

  return jsonb_build_object(
    'authorized',true,
    'organizationId',p_organization_id,
    'seasonId',v_season_id,
    'tournamentId',p_tournament_id,
    'piece',p_piece,
    'theme',p_theme,
    'plan',v_policy->>'plan',
    'capability','social_studio.premium',
    'includeArma2Branding',v_effective_branding
  );
end;
$$;

revoke all on function public.get_tournament_social_snapshot(uuid,uuid,uuid,uuid,text,uuid,uuid)
  from public,anon;
grant execute on function public.get_tournament_social_snapshot(uuid,uuid,uuid,uuid,text,uuid,uuid)
  to authenticated,service_role;
revoke all on function public.authorize_tournament_social_export(uuid,uuid,text,text,boolean)
  from public,anon;
grant execute on function public.authorize_tournament_social_export(uuid,uuid,text,text,boolean)
  to authenticated,service_role;

commit;
