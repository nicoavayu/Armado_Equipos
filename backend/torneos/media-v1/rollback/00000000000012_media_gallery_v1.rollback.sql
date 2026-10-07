-- Rollback of 00000000000012_media_gallery_v1.sql (MEDIA-V1). Documented, never automatic; run only with an explicit GO
-- and AFTER the gateway runs with TORNEOS_MEDIA_MODE=off and the frontend without REACT_APP_TORNEOS_MEDIA_MODE.
--
-- What it does NOT touch, on purpose: the `tournament-media` bucket and its objects (photos and thumbnails), and every
-- gallery / asset / variant / session row. Photos are user content: removing them is a separate, explicit data decision (backend/torneos/media-v1/ACTIVATION.md
-- §Rollback). With the policies below gone, nothing can read or write those objects except the service role.
-- The pipeline mode is restored by the operator step that changed it (ACTIVATION.md), not here.
BEGIN;

drop policy if exists tournament_media_gateway_insert on storage.objects;
drop policy if exists tournament_media_gateway_delete on storage.objects;
drop policy if exists tournament_media_reader_select on storage.objects;
drop policy if exists tournament_media_client_update_denied on storage.objects;
drop policy if exists tournament_media_service_read on storage.objects;
drop policy if exists tournament_media_service_insert on storage.objects;
drop policy if exists tournament_media_service_update on storage.objects;
drop policy if exists tournament_media_service_delete on storage.objects;

-- 00000000000001's exposure decision for the moderation / lifecycle / report RPCs.
revoke execute on function public.transition_tournament_media_asset(uuid,text,text) from anon, authenticated;
revoke execute on function public.change_tournament_media_gallery_state(uuid,text,text) from anon, authenticated;
revoke execute on function public.report_tournament_media_asset(uuid,text,text,boolean,uuid) from anon, authenticated;

drop function if exists public.get_tournament_media_read_targets(uuid[],text);
drop function if exists public.fail_tournament_media_gallery_upload(uuid,text);
drop function if exists public.complete_tournament_media_gallery_upload(uuid,text,text,bigint,integer,integer,text,bigint,integer,integer,text);
drop function if exists public.begin_tournament_media_gallery_upload(uuid,uuid,text,bigint,bigint);
drop function if exists public.tournament_media_storage_budget_status();
drop function if exists public.can_read_tournament_media_object(text);
drop function if exists public.can_delete_tournament_media_gateway_object(text);
drop function if exists public.can_write_tournament_media_gateway_object(text);
drop function if exists public.tournament_media_thumbnail_path(text);
drop function if exists private.tournament_media_gateway_session();
-- The budget is configuration, not content: it goes with the contract that enforced it.
drop table if exists public.tournament_media_storage_budget;

-- The baseline bodies, verbatim (00000000000000_torneos_baseline_v1.sql).
SELECT pg_catalog.set_config('search_path', '', true);
CREATE OR REPLACE FUNCTION public.tournament_media_storage_contract_status() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_schema_present boolean := to_regclass('storage.buckets') is not null;
  v_bucket_present boolean := false;
  v_bucket_private boolean := false;
  v_public_url_disabled boolean := false;
  v_policy_names text[] := array[]::text[];
  v_write_open_to_clients boolean := false;
begin
  if v_schema_present then
    execute $q$
      select
        count(*) > 0,
        coalesce(bool_and(not bucket.public), false),
        coalesce(bool_and(not bucket.public), false)
      from storage.buckets bucket
      where bucket.id = 'tournament-media'
    $q$ into v_bucket_present, v_bucket_private, v_public_url_disabled;

    execute $q$
      select coalesce(array_agg(policy.policyname::text order by policy.policyname), array[]::text[])
      from pg_policies policy
      where policy.schemaname = 'storage'
        and policy.tablename = 'objects'
        and policy.policyname like 'tournament_media_%'
    $q$ into v_policy_names;

    -- Any policy on storage.objects that names the bucket and is granted to a
    -- client role is a contract violation, whoever created it.
    execute $q$
      select exists (
        select 1
        from pg_policies policy
        where policy.schemaname = 'storage'
          and policy.tablename = 'objects'
          and policy.cmd <> 'SELECT'
          and (policy.roles && array['anon','authenticated','public']::name[])
          and coalesce(policy.qual, '') || coalesce(policy.with_check, '')
            like '%tournament-media%'
      )
    $q$ into v_write_open_to_clients;
  end if;

  return jsonb_build_object(
    'bucket','tournament-media',
    'storageSchemaPresent',v_schema_present,
    'bucketPresent',v_bucket_present,
    'bucketPrivate',v_bucket_private,
    'publicUrlDisabled',v_public_url_disabled,
    'servicePoliciesPresent',(
      v_policy_names @> array[
        'tournament_media_service_read',
        'tournament_media_service_insert',
        'tournament_media_service_update',
        'tournament_media_service_delete'
      ]::text[]
    ),
    'clientWriteBlocked',not v_write_open_to_clients,
    'policies',to_jsonb(v_policy_names)
  );
end;
$_$;

CREATE OR REPLACE FUNCTION public.tournament_media_effective_readiness() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_mode text := public.tournament_media_current_pipeline_mode();
  v_robust jsonb;
  v_storage jsonb := public.tournament_media_storage_contract_status();
  v_storage_ready boolean;
  v_simple_contract boolean;
  v_ready boolean := false;
  v_blockers jsonb := '[]'::jsonb;
BEGIN
  v_storage_ready :=
    coalesce((v_storage->>'bucketPresent')::boolean,false)
    AND coalesce((v_storage->>'bucketPrivate')::boolean,false)
    AND coalesce((v_storage->>'publicUrlDisabled')::boolean,false)
    AND coalesce((v_storage->>'servicePoliciesPresent')::boolean,false)
    AND coalesce((v_storage->>'clientWriteBlocked')::boolean,false);

  v_simple_contract :=
    pg_catalog.to_regprocedure(
      'public.request_tournament_media_upload_session(uuid,text,text,bigint,uuid)'
    ) IS NOT NULL
    AND pg_catalog.to_regprocedure(
      'public.tournament_media_require_upload_tier(text)'
    ) IS NOT NULL
    AND pg_catalog.to_regprocedure(
      'public.tournament_media_mvp_user_can_upload(uuid,uuid)'
    ) IS NOT NULL
    AND pg_catalog.to_regprocedure(
      'public.authorize_tournament_media_upload_target(uuid,text,uuid)'
    ) IS NOT NULL
    AND pg_catalog.to_regprocedure(
      'public.complete_tournament_media_simple_upload(uuid,uuid,text,text,bigint,integer,integer,text,boolean)'
    ) IS NOT NULL
    AND pg_catalog.to_regprocedure(
      'public.fail_tournament_media_upload_session(uuid,text)'
    ) IS NOT NULL;

  IF v_mode = 'PROCESSOR_EXTERNAL' THEN
    v_robust := public.tournament_media_pipeline_readiness();
    RETURN v_robust || jsonb_build_object(
      'mode',v_mode,'processingTier','processor_external',
      'maxSelectedFileBytes',50331648,'maxConcurrentUploads',3,
      'maxEdge',12000,'allowHeicTranscode',true
    );
  ELSIF v_mode = 'MVP_SIMPLE' THEN
    v_ready := v_storage_ready AND v_simple_contract;
    IF NOT coalesce((v_storage->>'bucketPresent')::boolean,false) THEN
      v_blockers := v_blockers || '"storage.bucket_absent"'::jsonb;
    ELSIF NOT coalesce((v_storage->>'bucketPrivate')::boolean,false) THEN
      v_blockers := v_blockers || '"storage.bucket_public"'::jsonb;
    END IF;
    IF NOT coalesce((v_storage->>'servicePoliciesPresent')::boolean,false) THEN
      v_blockers := v_blockers || '"storage.service_policies_absent"'::jsonb;
    END IF;
    IF NOT coalesce((v_storage->>'clientWriteBlocked')::boolean,false) THEN
      v_blockers := v_blockers || '"storage.client_write_open"'::jsonb;
    END IF;
    IF NOT v_simple_contract THEN
      v_blockers := v_blockers || '"simple.contract_absent"'::jsonb;
    END IF;
    RETURN jsonb_build_object(
      'mode',v_mode,'processingTier','mvp_simple',
      'bucket','tournament-media',
      'private',coalesce((v_storage->>'bucketPrivate')::boolean,false),
      'uploadReady',v_ready,
      'storageReady',v_storage_ready,
      'simpleContractReady',v_simple_contract,
      'signerReady',null,'processorReady',null,
      'blockers',v_blockers,
      'storage',v_storage,
      'maxSelectedFileBytes',8388608,'maxFileBytes',4194304,
      'maxPixels',2560000,'maxEdge',1600,
      'maxBatchFiles',10,'maxConcurrentUploads',2,
      'signedUrlTtlSeconds',300,'allowHeicTranscode',false,
      -- These are honest reduced-tier claims, not attestations.
      'pixelTranscode',false,'antivirusScanning',false
    );
  END IF;
  RETURN jsonb_build_object(
    'mode','DISABLED','processingTier',null,
    'bucket','tournament-media','private',true,'uploadReady',false,
    'blockers',jsonb_build_array('pipeline.disabled'),
    'maxSelectedFileBytes',8388608,'maxFileBytes',4194304,
    'maxPixels',2560000,'maxEdge',1600,
    'maxBatchFiles',10,'maxConcurrentUploads',2,
    'signedUrlTtlSeconds',300,'allowHeicTranscode',false,
    'pixelTranscode',false,'antivirusScanning',false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_published_tournament_media(p_tournament_id uuid, p_category_id uuid DEFAULT NULL::uuid, p_match_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_result jsonb;
  v_readiness jsonb := public.tournament_media_pipeline_readiness();
  v_delivery jsonb;
begin
  if private.current_identity_id() is null or not public.can_read_tournament_participant_hub(
    p_tournament_id,p_category_id
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  if p_limit < 1 or p_limit > 50 or p_offset < 0 then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_FILTER_INVALID';
  end if;
  if p_match_id is not null and not exists (
    select 1 from public.tournament_matches match
    where match.id = p_match_id and match.tournament_id = p_tournament_id
      and (p_category_id is null or match.category_id = p_category_id)
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  -- Reading requires the signer only. A missing processor blocks new uploads
  -- but must not hide media that was already published.
  v_delivery := jsonb_build_object(
    'status',case
      when (v_readiness->>'storageReady')::boolean
        and (v_readiness->>'signerReady')::boolean
      then 'signed_urls' else 'staging_required' end,
    'signedUrlTtlSeconds',300,'originalsRestricted',true
  );
  select jsonb_build_object(
    'delivery',v_delivery,
    'items',coalesce(jsonb_agg(jsonb_build_object(
      'id',gallery.id,'title',gallery.title,'description',gallery.description,
      'visibility',gallery.visibility,'matchId',gallery.match_id,
      'publishedAt',gallery.published_at,'coverAssetId',gallery.cover_asset_id,
      'assets',(
        select coalesce(jsonb_agg(jsonb_build_object(
          'id',asset.id,'safeName',asset.safe_name,
          'width',asset.width,'height',asset.height,
          'caption',item.caption,'sortOrder',item.sort_order,
          'thumbnailUrl',null,'gridUrl',null,'detailUrl',null,
          'originalAvailable',false
        ) order by item.sort_order),'[]'::jsonb)
        from public.tournament_media_gallery_items item
        join public.tournament_media_assets asset on asset.id = item.asset_id
        where item.gallery_id = gallery.id and asset.status = 'published'
      )
    ) order by gallery.published_at desc),'[]'::jsonb)
  ) into v_result
  from (
    select *
    from public.tournament_media_galleries gallery_page
    where gallery_page.tournament_id = p_tournament_id
      and gallery_page.status = 'published'
      and (p_category_id is null or gallery_page.category_id is null
        or gallery_page.category_id = p_category_id)
      and (p_match_id is null or gallery_page.match_id = p_match_id)
      and public.can_current_user_read_media_gallery(gallery_page.id)
    order by gallery_page.published_at desc
    limit p_limit offset p_offset
  ) gallery;
  return coalesce(v_result,jsonb_build_object(
    'delivery',v_delivery,'items','[]'::jsonb
  ));
end;
$$;

DO $post$
BEGIN
  IF to_regprocedure('public.begin_tournament_media_gallery_upload(uuid,uuid,text,bigint,bigint)') IS NOT NULL
    OR to_regclass('public.tournament_media_storage_budget') IS NOT NULL
    OR (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'tournament_media_%') <> 0
    OR has_function_privilege('authenticated', 'public.transition_tournament_media_asset(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TORNEOS_MEDIA_V1_ROLLBACK_POSTCONDITION_FAILED';
  END IF;
END $post$;

COMMIT;
