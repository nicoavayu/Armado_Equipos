-- Arma2 Torneos · season-wide multimedia, social families and export branding.

set check_function_bodies = off;

begin;

-- -------------------------------------------------------------------------
-- 1. Multimedia accounting is aggregate across all child competitions.
-- Existing object paths and physical assets remain unchanged.
-- -------------------------------------------------------------------------

create or replace function public.enforce_tournament_media_gallery_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_season_id uuid;
  v_policy jsonb;
  v_limit integer;
  v_count integer;
begin
  select season_id into v_season_id from public.tournaments
  where organization_id = new.organization_id and id = new.tournament_id;
  if v_season_id is null then
    raise exception using errcode='22023',message='TORNEOS_MEDIA_SCOPE_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.organization_id::text || ':' || v_season_id::text,43)
  );
  v_policy := public.resolve_effective_tournament_season_entitlements_at(
    new.organization_id,v_season_id,now(),false,new.tournament_id
  );
  v_limit := (v_policy->'media'->>'galleryAssetLimit')::integer;
  select
    (select count(*)
     from public.tournament_media_assets asset
     join public.tournaments tournament
       on tournament.organization_id=asset.organization_id and tournament.id=asset.tournament_id
     where asset.organization_id=new.organization_id and tournament.season_id=v_season_id
       and asset.status not in ('rejected','revoked','failed')
       and asset.storage_state <> 'storage_purged')
    +
    (select count(*)
     from public.tournament_media_upload_sessions session
     join public.tournaments tournament
       on tournament.organization_id=session.organization_id and tournament.id=session.tournament_id
     where session.organization_id=new.organization_id and tournament.season_id=v_season_id
       and session.status in ('issued','uploaded') and session.expires_at>now())
  into v_count;
  if v_limit is not null and v_count>=v_limit then
    raise exception using errcode='22023',message='TORNEOS_SEASON_MEDIA_QUOTA_EXCEEDED',
      detail=jsonb_build_object('seasonId',v_season_id,'usage',v_count,'limit',v_limit,
        'upgradeRequired',v_policy->>'plan'='FREE')::text;
  end if;
  new.quota_snapshot := coalesce(new.quota_snapshot,'{}'::jsonb) || jsonb_build_object(
    'scope','season','seasonId',v_season_id,'plan',v_policy->>'plan',
    'galleryAssetLimit',v_limit,'galleryAssetUsage',v_count
  );
  return new;
end;
$$;

create or replace function public.tournament_media_mvp_user_can_upload(
  p_user_id uuid,
  p_gallery_id uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id is not null and exists (
    select 1
    from public.tournament_media_galleries gallery
    join public.tournaments tournament
      on tournament.organization_id=gallery.organization_id and tournament.id=gallery.tournament_id
    join public.tournament_organizations organization on organization.id=gallery.organization_id
    join public.tournament_organization_members membership
      on membership.organization_id=gallery.organization_id
     and membership.user_id=p_user_id and membership.status='active'
     and membership.role in ('owner','admin')
    where gallery.id=p_gallery_id and gallery.status in ('draft','under_review')
      and organization.status='active'
      and (membership.role='owner' or exists (
        select 1 from public.tournament_season_member_assignments assignment
        where assignment.organization_id=gallery.organization_id
          and assignment.season_id=tournament.season_id
          and assignment.membership_id=membership.id
      ))
  );
$$;

create or replace function public.tournament_media_user_can_upload(
  p_user_id uuid,
  p_gallery_id uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id is not null and exists (
    select 1
    from public.tournament_media_galleries gallery
    join public.tournaments tournament
      on tournament.organization_id=gallery.organization_id and tournament.id=gallery.tournament_id
    join public.tournament_organizations organization on organization.id=gallery.organization_id
    where gallery.id=p_gallery_id and gallery.status in ('draft','under_review')
      and organization.status='active' and (
        exists (
          select 1 from public.tournament_organization_members membership
          where membership.organization_id=gallery.organization_id
            and membership.user_id=p_user_id and membership.status='active'
            and 'media.upload'=any(public.tournament_media_role_capabilities(membership.role))
            and (membership.role='owner' or exists (
              select 1 from public.tournament_season_member_assignments assignment
              where assignment.organization_id=gallery.organization_id
                and assignment.season_id=tournament.season_id
                and assignment.membership_id=membership.id
            ))
        )
        or exists (
          select 1 from public.tournament_media_assignments assignment
          where assignment.gallery_id=gallery.id and assignment.user_id=p_user_id
            and assignment.status='active' and assignment.can_upload
        )
      )
  );
$$;

create or replace function public.get_tournament_season_media_usage(
  p_organization_id uuid,
  p_season_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_policy jsonb; v_assets integer; v_pending integer; v_limit integer;
begin
  if not public.has_tournament_season_access(p_organization_id,p_season_id) then
    raise exception using errcode='42501',message='TORNEOS_MEDIA_FORBIDDEN';
  end if;
  v_policy:=public.resolve_effective_tournament_season_entitlements_at(
    p_organization_id,p_season_id,now(),false,null
  );
  select count(*)::integer into v_assets
  from public.tournament_media_assets asset join public.tournaments tournament
    on tournament.organization_id=asset.organization_id and tournament.id=asset.tournament_id
  where asset.organization_id=p_organization_id and tournament.season_id=p_season_id
    and asset.status not in ('rejected','revoked','failed') and asset.storage_state<>'storage_purged';
  select count(*)::integer into v_pending
  from public.tournament_media_upload_sessions session join public.tournaments tournament
    on tournament.organization_id=session.organization_id and tournament.id=session.tournament_id
  where session.organization_id=p_organization_id and tournament.season_id=p_season_id
    and session.status in ('issued','uploaded') and session.expires_at>now();
  v_limit:=(v_policy->'media'->>'galleryAssetLimit')::integer;
  return jsonb_build_object('schemaVersion',1,'organizationId',p_organization_id,
    'seasonId',p_season_id,'plan',v_policy->>'plan','assetCount',v_assets,
    'pendingCount',v_pending,'usage',v_assets+v_pending,'limit',v_limit,
    'remaining',greatest(v_limit-v_assets-v_pending,0));
end;
$$;

-- -------------------------------------------------------------------------
-- 2. Social family gate is enforced before the certified snapshot resolver.
-- FREE: 3 Base families. PREMIUM: all 11, with result styles surfaced by the
-- entitlement projection. The legacy resolver becomes service-internal.
-- -------------------------------------------------------------------------

alter function public.get_tournament_social_snapshot(uuid,uuid,uuid,uuid,text,uuid,uuid)
  rename to get_tournament_social_snapshot_plan_legacy;

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
  if v_policy->>'plan'='FREE' and p_piece not in ('round_results','standings','next_fixture') then
    raise exception using errcode='42501',message='TORNEOS_SOCIAL_PREMIUM_REQUIRED',
      detail=jsonb_build_object('piece',p_piece,'allowedFamilies',
        jsonb_build_array('round_results','standings','next_fixture'))::text;
  end if;
  v_snapshot:=public.get_tournament_social_snapshot_plan_legacy(
    p_organization_id,p_tournament_id,p_category_id,p_phase_id,p_piece,p_round_id,p_group_id
  );
  return v_snapshot || jsonb_build_object('seasonId',v_season_id,
    'plan',v_policy->>'plan','social',v_policy->'social','branding',v_policy->'branding');
end;
$$;

alter function public.get_tournament_social_studio_context(uuid)
  rename to get_tournament_social_studio_context_organization_legacy;

create or replace function public.get_tournament_social_studio_context(
  p_organization_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_payload jsonb; v_tournaments jsonb;
begin
  v_payload:=public.get_tournament_social_studio_context_organization_legacy(p_organization_id);
  select coalesce(jsonb_agg(item),'[]'::jsonb) into v_tournaments
  from jsonb_array_elements(v_payload->'tournaments') item
  join public.tournaments tournament on tournament.id=(item->>'id')::uuid
  where tournament.organization_id=p_organization_id
    and public.has_tournament_season_access(p_organization_id,tournament.season_id);
  return v_payload || jsonb_build_object('tournaments',v_tournaments,
    'commercialUnit','season','freeBaseFamilies',
    jsonb_build_array('round_results','standings','next_fixture'));
end;
$$;

create or replace function public.authorize_tournament_social_export(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_piece text,
  p_include_arma2_branding boolean
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_season_id uuid; v_policy jsonb;
begin
  select season_id into v_season_id from public.tournaments
  where organization_id=p_organization_id and id=p_tournament_id;
  if v_season_id is null
    or not public.has_tournament_season_access(p_organization_id,v_season_id)
    or not public.has_tournament_social_capability(p_organization_id,'social.export') then
    raise exception using errcode='42501',message='TORNEOS_SOCIAL_EXPORT_FORBIDDEN';
  end if;
  v_policy:=public.resolve_effective_tournament_season_entitlements_at(
    p_organization_id,v_season_id,now(),false,p_tournament_id
  );
  if v_policy->>'plan'='FREE' and p_piece not in ('round_results','standings','next_fixture') then
    raise exception using errcode='42501',message='TORNEOS_SOCIAL_PREMIUM_REQUIRED';
  end if;
  if not p_include_arma2_branding and not coalesce(
    (v_policy->'branding'->>'canRemoveArma2')::boolean,false
  ) then raise exception using errcode='42501',message='TORNEOS_BRANDING_PREMIUM_REQUIRED'; end if;
  return jsonb_build_object('authorized',true,'organizationId',p_organization_id,
    'seasonId',v_season_id,'tournamentId',p_tournament_id,'piece',p_piece,
    'plan',v_policy->>'plan','includeArma2Branding',p_include_arma2_branding);
end;
$$;

revoke all on function public.get_tournament_social_snapshot_plan_legacy(
  uuid,uuid,uuid,uuid,text,uuid,uuid
) from public,anon,authenticated;
revoke all on function public.get_tournament_social_studio_context_organization_legacy(uuid)
  from public,anon,authenticated;
revoke all on function public.get_tournament_social_snapshot(uuid,uuid,uuid,uuid,text,uuid,uuid)
  from public,anon;
revoke all on function public.get_tournament_social_studio_context(uuid) from public,anon;
revoke all on function public.authorize_tournament_social_export(uuid,uuid,text,boolean)
  from public,anon;
revoke all on function public.get_tournament_season_media_usage(uuid,uuid) from public,anon;
revoke all on function public.enforce_tournament_media_gallery_limit()
  from public,anon,authenticated,service_role;

grant execute on function public.get_tournament_social_snapshot(uuid,uuid,uuid,uuid,text,uuid,uuid)
  to authenticated,service_role;
grant execute on function public.get_tournament_social_studio_context(uuid)
  to authenticated,service_role;
grant execute on function public.authorize_tournament_social_export(uuid,uuid,text,boolean)
  to authenticated,service_role;
grant execute on function public.get_tournament_season_media_usage(uuid,uuid)
  to authenticated,service_role;

commit;
