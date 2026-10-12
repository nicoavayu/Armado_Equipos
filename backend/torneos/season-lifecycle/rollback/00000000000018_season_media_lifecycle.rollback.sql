-- ROLLBACK of 00000000000018_season_media_lifecycle.sql (documented, never automatic; run by the operator driver).
-- Generated from the exact previous bodies (pinned by md5 after). Restores the 0016 notification kinds, PREMIUM 1000 and
-- its label, and removes what 0018 added. Photos marked for removal that still exist go back to active.
-- **Photos already purged are NOT recovered**: their rows stay 'storage_purged' and their objects are gone.
-- The 0018 season notices are deleted. 0012's storage budget is untouched (0018 never changed it).
BEGIN;

DO $pre$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.update_tournament_season(uuid,uuid,text,text,date,date,text,boolean,boolean,boolean)')) IS DISTINCT FROM 'df3a51e6988a5ea3adf83d4ac8501d82'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.enforce_tournament_media_gallery_limit()'::regprocedure) IS DISTINCT FROM 'd9966b4e32e02c1f749784f6185de6bc' THEN
    RAISE EXCEPTION 'TORNEOS_0018_ROLLBACK_PRECONDITION_FAILED: the 0018 bodies are not in force';
  END IF;
END $pre$;

DROP FUNCTION public.run_tournament_season_media_lifecycle();
DROP FUNCTION public.claim_tournament_media_purge(integer);
DROP FUNCTION public.complete_tournament_media_purge(uuid);
DROP FUNCTION private.notify_tournament_season_media_deletion();

DELETE FROM public.tournament_user_notifications WHERE kind IN ('season.media_deletion_7d', 'season.media_deletion_1d');
DROP INDEX public.tournament_user_notifications_season_media_key;
ALTER TABLE public.tournament_user_notifications
  DROP CONSTRAINT tournament_user_notifications_season_shape_check,
  DROP CONSTRAINT tournament_user_notifications_kind_check,
  ADD CONSTRAINT tournament_user_notifications_kind_check CHECK (kind IN (
    'registration.submitted', 'registration.received', 'registration.approved',
    'registration.changes_requested', 'registration.rejected', 'match.rescheduled', 'match.postponed'
  )),
  DROP COLUMN season_id,
  DROP COLUMN media_deadline_at;

UPDATE public.tournament_media_assets
SET storage_state = 'active', retention_marked_at = NULL, retention_reason = NULL, updated_at = now()
WHERE storage_state = 'retention_marked' AND retention_reason LIKE 'SEASON_ENDED:%';
ALTER TABLE public.tournament_media_assets DROP COLUMN purge_claimed_until;

CREATE OR REPLACE FUNCTION public.enforce_tournament_media_gallery_limit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE OR REPLACE FUNCTION public.can_read_tournament_media_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_identity uuid := private.current_identity_id();
  v_asset_id uuid;
begin
  if v_identity is null or p_name is null then
    return false;
  end if;
  if exists (
    select 1 from public.tournament_media_upload_sessions session
    where session.id = private.tournament_media_gateway_session()
      and p_name in (session.internal_path, public.tournament_media_thumbnail_path(session.internal_path))
      and session.requested_by = v_identity
  ) then
    return true;
  end if;
  select asset.id into v_asset_id
  from public.tournament_media_assets asset
  where asset.internal_path = p_name and asset.bucket = 'tournament-media';
  if v_asset_id is null then
    select variant.asset_id into v_asset_id
    from public.tournament_media_variants variant
    where variant.internal_path = p_name and variant.bucket = 'tournament-media' and variant.status = 'ready';
  end if;
  if v_asset_id is null then
    return false;
  end if;
  perform public.authorize_tournament_media_read(v_identity, v_asset_id, 'detail');
  return true;
exception when insufficient_privilege or invalid_parameter_value then
  return false;
end;
$$;

CREATE OR REPLACE FUNCTION public.get_tournament_season_media_usage(p_organization_id uuid, p_season_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE OR REPLACE FUNCTION public.get_effective_tournament_season_entitlements(p_organization_id uuid, p_season_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_result jsonb; v_usage integer;
begin
  if private.current_identity_id() is null then raise exception using errcode='42501',message='TORNEOS_AUTH_REQUIRED'; end if;
  -- The (organization, season) pair must exist as such: has_tournament_season_access lets an organization owner
  -- through without looking at the season.
  if p_organization_id is null or p_season_id is null or not exists (
    select 1 from public.tournament_seasons season
    where season.organization_id=p_organization_id and season.id=p_season_id
  ) or not public.has_tournament_season_access(p_organization_id,p_season_id) then
    raise exception using errcode='42501',message='TORNEOS_ENTITLEMENTS_FORBIDDEN';
  end if;
  v_result := public.resolve_effective_tournament_season_entitlements_at(
    p_organization_id,p_season_id,now(),false,null
  );
  -- Fail closed: an unresolved scope is refused, never answered as 200 null.
  if v_result is null then
    raise exception using errcode='42501',message='TORNEOS_ENTITLEMENTS_FORBIDDEN';
  end if;
  select count(*)::integer into v_usage
  from public.tournament_season_member_assignments
  where organization_id=p_organization_id and season_id=p_season_id;
  return jsonb_set(v_result,'{administration,currentAdministrativeSeatUsage}',to_jsonb(v_usage),true);
end;
$$;

DROP FUNCTION public.update_tournament_season(uuid, uuid, text, text, date, date, text, boolean, boolean, boolean);
CREATE FUNCTION public.update_tournament_season(p_organization_id uuid, p_season_id uuid, p_name text DEFAULT NULL::text, p_slug text DEFAULT NULL::text, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date, p_status text DEFAULT NULL::text, p_clear_start_date boolean DEFAULT false, p_clear_end_date boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_season public.tournament_seasons%rowtype;
  v_name text; v_slug text; v_start_date date; v_end_date date;
begin
  if private.current_identity_id() is null then raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED'; end if;
  if not public.has_tournament_season_capability(
    p_organization_id,p_season_id,
    case when p_status = 'archived' then 'seasons.archive' else 'seasons.update' end
  ) then raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN'; end if;
  select * into v_season from public.tournament_seasons
  where id = p_season_id and organization_id = p_organization_id for update;
  if v_season.id is null or v_season.status = 'archived' then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  if p_status is not null and not (
    (v_season.status = 'draft' and p_status in ('active','archived'))
    or (v_season.status = 'active' and p_status = 'completed')
    or (v_season.status = 'completed' and p_status = 'archived')
  ) then raise exception using errcode = '22023', message = 'TORNEOS_INVALID_SEASON_TRANSITION'; end if;
  if p_status = 'archived' and exists (
    select 1 from public.tournaments where organization_id = p_organization_id
      and season_id = p_season_id and status <> 'archived'
  ) then raise exception using errcode = '23514', message = 'TORNEOS_SEASON_HAS_TOURNAMENTS'; end if;
  v_name := case when p_name is null then v_season.name else btrim(p_name) end;
  v_slug := case when p_slug is null then v_season.slug else public.normalize_tournament_competition_slug(p_slug) end;
  v_start_date := case when p_clear_start_date then null else coalesce(p_start_date,v_season.start_date) end;
  v_end_date := case when p_clear_end_date then null else coalesce(p_end_date,v_season.end_date) end;
  if char_length(v_name) not between 3 and 80 or char_length(v_slug) not between 3 and 48
    or (v_start_date is not null and v_end_date is not null and v_end_date < v_start_date) then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_SEASON';
  end if;
  begin
    update public.tournament_seasons set name=v_name,slug=v_slug,start_date=v_start_date,
      end_date=v_end_date,status=coalesce(p_status,status),
      archived_at=case when p_status='archived' then now() else archived_at end
    where id=p_season_id returning * into v_season;
  exception when unique_violation then
    raise exception using errcode='23505',message='TORNEOS_SEASON_SLUG_TAKEN';
  end;
  if v_season.status='archived' then
    update public.user_tournament_context_preferences set active_season_id=null,active_tournament_id=null
    where organization_id=p_organization_id and active_season_id=p_season_id;
  end if;
  return jsonb_build_object('id',v_season.id,'organizationId',v_season.organization_id,
    'name',v_season.name,'slug',v_season.slug,'status',v_season.status,
    'startDate',v_season.start_date,'endDate',v_season.end_date,
    'createdAt',v_season.created_at,'updatedAt',v_season.updated_at);
end;
$$;
REVOKE ALL ON FUNCTION public.update_tournament_season(uuid, uuid, text, text, date, date, text, boolean, boolean) FROM PUBLIC, anon;
GRANT ALL ON FUNCTION public.update_tournament_season(uuid, uuid, text, text, date, date, text, boolean, boolean) TO service_role;
GRANT ALL ON FUNCTION public.update_tournament_season(uuid, uuid, text, text, date, date, text, boolean, boolean) TO authenticated;

DROP FUNCTION private.mark_tournament_season_media_for_deletion(uuid, uuid);
DROP FUNCTION private.tournament_season_lifecycle_json(uuid, uuid);
DROP FUNCTION private.tournament_season_media_open(uuid, uuid);
ALTER TABLE public.tournament_seasons
  DROP CONSTRAINT tournament_seasons_activation_status_check,
  DROP CONSTRAINT tournament_seasons_activation_shape_check,
  DROP COLUMN activated_at,
  DROP COLUMN media_deadline_at,
  DROP COLUMN activation_basis;
DROP FUNCTION private.tournament_season_media_deadline(timestamptz);

UPDATE public.tournament_plan_catalog SET gallery_asset_limit = 1000, updated_at = now() WHERE plan_code = 'PREMIUM';
COMMENT ON TABLE public.tournament_plan_catalog IS
  'Authoritative FREE/PREMIUM limits per tournament_seasons.id: media 25/1000, collaborators 1/10, optional branding only in PREMIUM.';
UPDATE public.tournament_commercial_products
SET public_capabilities = (
  select jsonb_agg(
    case when element->>'code' = 'media.season_100'
      then jsonb_build_object('code', 'media.season_1000', 'label', 'Hasta 1.000 archivos multimedia por temporada',
        'availability', element->>'availability')
      else element end
    order by position)
  from jsonb_array_elements(public_capabilities) with ordinality as item(element, position)
), updated_at = now()
WHERE product_code = 'torneos_premium' AND public_capabilities @> '[{"code": "media.season_100"}]'::jsonb;

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('public.enforce_tournament_media_gallery_limit()');
  IF v_md5 IS DISTINCT FROM '4c985973a92c677919703bbfc0bfbca2' THEN RAISE EXCEPTION 'TORNEOS_0018_ROLLBACK_POSTCONDITION_FAILED: enforce_tournament_media_gallery_limit (%)', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('public.update_tournament_season(uuid,uuid,text,text,date,date,text,boolean,boolean)');
  IF v_md5 IS DISTINCT FROM '3e6a6f6a5fa220ec1b83471b128eed62' THEN RAISE EXCEPTION 'TORNEOS_0018_ROLLBACK_POSTCONDITION_FAILED: update_tournament_season (%)', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('public.can_read_tournament_media_object(text)');
  IF v_md5 IS DISTINCT FROM '5316ae2ddb16f714071d43dc76b5c704' THEN RAISE EXCEPTION 'TORNEOS_0018_ROLLBACK_POSTCONDITION_FAILED: can_read_tournament_media_object (%)', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('public.get_tournament_season_media_usage(uuid,uuid)');
  IF v_md5 IS DISTINCT FROM '27bd920bcb72052296f31016dcd4cc97' THEN RAISE EXCEPTION 'TORNEOS_0018_ROLLBACK_POSTCONDITION_FAILED: get_tournament_season_media_usage (%)', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('public.get_effective_tournament_season_entitlements(uuid,uuid)');
  IF v_md5 IS DISTINCT FROM 'bf263acafb185ee0993117d5805bc701' THEN RAISE EXCEPTION 'TORNEOS_0018_ROLLBACK_POSTCONDITION_FAILED: get_effective_tournament_season_entitlements (%)', v_md5; END IF;
  IF has_function_privilege('anon', 'public.update_tournament_season(uuid,uuid,text,text,date,date,text,boolean,boolean)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.update_tournament_season(uuid,uuid,text,text,date,date,text,boolean,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TORNEOS_0018_ROLLBACK_POSTCONDITION_FAILED: update_tournament_season grants';
  END IF;
END $post$;

COMMIT;
