-- Arma2 Torneos · Photo galleries · temporary free multimedia MVP
--
-- Code only. This migration does not activate MVP_SIMPLE: the single config
-- row defaults to PROCESSOR_EXTERNAL, preserving the robust readiness gate.
-- No Storage policy is added and no attestation contract is weakened.

BEGIN;

CREATE TABLE "public"."tournament_media_pipeline_configuration" (
  "singleton" boolean PRIMARY KEY DEFAULT true,
  "mode" text NOT NULL DEFAULT 'PROCESSOR_EXTERNAL',
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_by" uuid,
  CONSTRAINT "tournament_media_pipeline_configuration_singleton_check"
    CHECK (singleton),
  CONSTRAINT "tournament_media_pipeline_configuration_mode_check"
    CHECK (mode IN ('DISABLED','MVP_SIMPLE','PROCESSOR_EXTERNAL'))
);

ALTER TABLE "public"."tournament_media_pipeline_configuration" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."tournament_media_pipeline_configuration" FROM PUBLIC;
REVOKE ALL ON TABLE "public"."tournament_media_pipeline_configuration" FROM "anon";
REVOKE ALL ON TABLE "public"."tournament_media_pipeline_configuration" FROM "authenticated";
GRANT SELECT, INSERT, UPDATE ON TABLE "public"."tournament_media_pipeline_configuration"
  TO "service_role";

INSERT INTO "public"."tournament_media_pipeline_configuration" (singleton, mode)
VALUES (true, 'PROCESSOR_EXTERNAL');

COMMENT ON TABLE "public"."tournament_media_pipeline_configuration" IS
  'Fail-closed multimedia mode. MVP_SIMPLE is a temporary reduced-security tier and is not activated by this migration.';

ALTER TABLE "public"."tournament_media_upload_sessions"
  ADD COLUMN "processing_tier" text NOT NULL DEFAULT 'processor_external',
  ADD CONSTRAINT "tournament_media_upload_sessions_processing_tier_check"
    CHECK (processing_tier IN ('processor_external','mvp_simple')),
  ADD CONSTRAINT "tournament_media_upload_sessions_mvp_limits_check"
    CHECK (processing_tier <> 'mvp_simple' OR (
      requested_size BETWEEN 1 AND 4194304 AND max_size = 4194304
    ));

ALTER TABLE "public"."tournament_media_assets"
  ADD COLUMN "processing_tier" text NOT NULL DEFAULT 'processor_external',
  ADD CONSTRAINT "tournament_media_assets_processing_tier_check"
    CHECK (processing_tier IN ('processor_external','mvp_simple')),
  ADD CONSTRAINT "tournament_media_assets_mvp_limits_check"
    CHECK (processing_tier <> 'mvp_simple' OR (
      byte_size BETWEEN 1 AND 4194304
      AND width BETWEEN 1 AND 1600
      AND height BETWEEN 1 AND 1600
      AND width::bigint * height::bigint <= 2560000
    ));

CREATE OR REPLACE FUNCTION "public"."tournament_media_current_pipeline_mode"()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT CASE
    WHEN count(*) = 1
      AND min(mode) IN ('DISABLED','MVP_SIMPLE','PROCESSOR_EXTERNAL')
    THEN min(mode)
    ELSE 'DISABLED'
  END
  FROM public.tournament_media_pipeline_configuration
  WHERE singleton;
$$;

CREATE OR REPLACE FUNCTION "public"."tournament_media_effective_readiness"()
RETURNS jsonb
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
      'public.complete_tournament_media_simple_upload(uuid,uuid,text,text,bigint,integer,integer,text)'
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

CREATE OR REPLACE FUNCTION "public"."get_tournament_media_upload_capability"(
  "p_organization_id" uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  END IF;
  IF NOT public.has_tournament_media_capability(p_organization_id,'media.read') THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  END IF;
  RETURN public.tournament_media_effective_readiness();
END;
$$;

CREATE OR REPLACE FUNCTION "public"."get_tournament_media_asset_processing_tiers"(
  "p_organization_id" uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  END IF;
  IF NOT public.has_tournament_media_capability(p_organization_id,'media.read') THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  END IF;
  RETURN coalesce((
    SELECT jsonb_object_agg(asset.id::text,asset.processing_tier)
    FROM public.tournament_media_assets asset
    WHERE asset.organization_id = p_organization_id
  ),'{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION "public"."tournament_media_require_upload_tier"(
  "p_processing_tier" text
) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_mode text := public.tournament_media_current_pipeline_mode();
BEGIN
  IF p_processing_tier = 'processor_external' THEN
    IF v_mode <> 'PROCESSOR_EXTERNAL'
      OR NOT coalesce(
        (public.tournament_media_pipeline_readiness()->>'uploadReady')::boolean,false
      )
    THEN
      RAISE EXCEPTION USING errcode = '55000',
        message = 'TORNEOS_MEDIA_PIPELINE_NOT_READY';
    END IF;
  ELSIF p_processing_tier = 'mvp_simple' THEN
    IF v_mode <> 'MVP_SIMPLE'
      OR NOT coalesce(
        (public.tournament_media_effective_readiness()->>'uploadReady')::boolean,false
      )
    THEN
      RAISE EXCEPTION USING errcode = '55000',
        message = 'TORNEOS_MEDIA_PIPELINE_NOT_READY';
    END IF;
  ELSE
    RAISE EXCEPTION USING errcode = '55000',
      message = 'TORNEOS_MEDIA_PIPELINE_NOT_READY';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."tournament_media_mvp_user_can_upload"(
  "p_user_id" uuid, "p_gallery_id" uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.tournament_media_galleries gallery
    JOIN public.tournament_organizations organization
      ON organization.id = gallery.organization_id
    JOIN public.tournament_organization_members membership
      ON membership.organization_id = gallery.organization_id
      AND membership.user_id = p_user_id
      AND membership.status = 'active'
      AND membership.role IN ('owner','admin')
    WHERE gallery.id = p_gallery_id
      AND gallery.status IN ('draft','under_review')
      AND organization.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION "public"."request_tournament_media_upload_session"(
  "p_gallery_id" uuid, "p_file_name" text, "p_declared_mime" text,
  "p_byte_size" bigint, "p_idempotency_key" uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $_$
DECLARE
  v_gallery public.tournament_media_galleries%rowtype;
  v_existing public.tournament_media_upload_sessions%rowtype;
  v_mode text := public.tournament_media_current_pipeline_mode();
  v_tier text;
  v_extension text;
  v_file_id uuid := gen_random_uuid();
  v_token text := encode(public.gen_random_bytes(32),'hex');
  v_safe_name text;
  v_path text;
  v_session_id uuid;
  v_org_bytes bigint;
  v_tournament_bytes bigint;
  v_gallery_bytes bigint;
  v_open_sessions integer;
  v_recent_emissions integer := 0;
  v_org_photos integer := 0;
  v_tournament_photos integer := 0;
  v_gallery_photos integer := 0;
  v_max_file bigint;
  v_max_open integer;
  v_org_quota bigint;
  v_tournament_quota bigint;
  v_gallery_quota bigint;
  v_expires interval;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  END IF;
  v_tier := CASE v_mode
    WHEN 'PROCESSOR_EXTERNAL' THEN 'processor_external'
    WHEN 'MVP_SIMPLE' THEN 'mvp_simple'
    ELSE NULL
  END;
  PERFORM public.tournament_media_require_upload_tier(v_tier);

  SELECT * INTO v_gallery FROM public.tournament_media_galleries
  WHERE id = p_gallery_id;
  IF v_gallery.id IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'TORNEOS_IDEMPOTENCY_REQUIRED';
  END IF;

  -- The open-session and emission ceilings are per actor across organizations,
  -- so serialize that actor before calculating either counter.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(auth.uid()::text,2)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_gallery.organization_id::text,0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_gallery_id::text,1)
  );
  SELECT * INTO v_gallery FROM public.tournament_media_galleries
  WHERE id = p_gallery_id FOR SHARE;
  IF (v_tier = 'mvp_simple' AND NOT public.tournament_media_mvp_user_can_upload(
      auth.uid(),p_gallery_id
    )) OR (v_tier = 'processor_external' AND NOT public.tournament_media_user_can_upload(
      auth.uid(),p_gallery_id
    ))
  THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  END IF;

  v_max_file := CASE WHEN v_tier = 'mvp_simple' THEN 4194304 ELSE 12582912 END;
  v_max_open := CASE WHEN v_tier = 'mvp_simple' THEN 10 ELSE 40 END;
  v_org_quota := CASE WHEN v_tier = 'mvp_simple' THEN 419430400 ELSE 5368709120 END;
  v_tournament_quota := CASE WHEN v_tier = 'mvp_simple' THEN 209715200 ELSE 2147483648 END;
  v_gallery_quota := CASE WHEN v_tier = 'mvp_simple' THEN 52428800 ELSE 536870912 END;
  v_expires := CASE WHEN v_tier = 'mvp_simple' THEN interval '5 minutes'
    ELSE interval '10 minutes' END;
  v_extension := CASE p_declared_mime
    WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png'
    WHEN 'image/webp' THEN 'webp' ELSE NULL END;
  IF v_extension IS NULL OR p_byte_size IS NULL
    OR p_byte_size < 1 OR p_byte_size > v_max_file
    OR NOT (
      (p_declared_mime = 'image/jpeg' AND lower(p_file_name) ~ '\.(jpe?g)$')
      OR (p_declared_mime = 'image/png' AND lower(p_file_name) ~ '\.png$')
      OR (p_declared_mime = 'image/webp' AND lower(p_file_name) ~ '\.webp$')
    )
  THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'TORNEOS_MEDIA_FILE_INVALID';
  END IF;

  SELECT * INTO v_existing FROM public.tournament_media_upload_sessions session
  WHERE session.organization_id = v_gallery.organization_id
    AND session.requested_by = auth.uid()
    AND session.idempotency_key = p_idempotency_key;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.gallery_id IS DISTINCT FROM p_gallery_id
      OR v_existing.requested_mime IS DISTINCT FROM p_declared_mime
      OR v_existing.requested_size IS DISTINCT FROM p_byte_size
      OR v_existing.processing_tier IS DISTINCT FROM v_tier
      OR right(v_existing.safe_name,char_length(v_extension) + 1)
        IS DISTINCT FROM '.' || v_extension
    THEN
      RAISE EXCEPTION USING errcode = '22023',
        message = 'TORNEOS_MEDIA_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN jsonb_build_object(
      'sessionId',v_existing.id,'safeName',v_existing.safe_name,
      'expiresAt',v_existing.expires_at,'token',null,'reused',true,
      'processingTier',v_existing.processing_tier,'uploadReady',true,
      'requiresStagingStorageSigner',false
    );
  END IF;

  SELECT
    coalesce((SELECT sum(asset.byte_size) FROM public.tournament_media_assets asset
      WHERE asset.organization_id = v_gallery.organization_id AND asset.status <> 'revoked'),0)
    + coalesce((SELECT sum(session.requested_size)
      FROM public.tournament_media_upload_sessions session
      WHERE session.organization_id = v_gallery.organization_id
        AND session.status = 'issued' AND session.expires_at > now()),0)
  INTO v_org_bytes;
  SELECT
    coalesce((SELECT sum(asset.byte_size) FROM public.tournament_media_assets asset
      WHERE asset.tournament_id = v_gallery.tournament_id AND asset.status <> 'revoked'),0)
    + coalesce((SELECT sum(session.requested_size)
      FROM public.tournament_media_upload_sessions session
      WHERE session.tournament_id = v_gallery.tournament_id
        AND session.status = 'issued' AND session.expires_at > now()),0)
  INTO v_tournament_bytes;
  SELECT
    coalesce((SELECT sum(asset.byte_size) FROM public.tournament_media_assets asset
      WHERE asset.gallery_id = p_gallery_id AND asset.status <> 'revoked'),0)
    + coalesce((SELECT sum(session.requested_size)
      FROM public.tournament_media_upload_sessions session
      WHERE session.gallery_id = p_gallery_id
        AND session.status = 'issued' AND session.expires_at > now()),0)
  INTO v_gallery_bytes;
  SELECT count(*) INTO v_open_sessions
  FROM public.tournament_media_upload_sessions session
  WHERE session.requested_by = auth.uid() AND session.status = 'issued'
    AND session.expires_at > now();

  IF v_tier = 'mvp_simple' THEN
    SELECT count(*) INTO v_recent_emissions
    FROM public.tournament_media_upload_sessions session
    WHERE session.requested_by = auth.uid()
      AND session.created_at > now() - interval '15 minutes';
    SELECT
      (SELECT count(*) FROM public.tournament_media_assets asset
       WHERE asset.organization_id = v_gallery.organization_id AND asset.status <> 'revoked')
      + (SELECT count(*) FROM public.tournament_media_upload_sessions session
         WHERE session.organization_id = v_gallery.organization_id
           AND session.status = 'issued' AND session.expires_at > now()),
      (SELECT count(*) FROM public.tournament_media_assets asset
       WHERE asset.tournament_id = v_gallery.tournament_id AND asset.status <> 'revoked')
      + (SELECT count(*) FROM public.tournament_media_upload_sessions session
         WHERE session.tournament_id = v_gallery.tournament_id
           AND session.status = 'issued' AND session.expires_at > now()),
      (SELECT count(*) FROM public.tournament_media_assets asset
       WHERE asset.gallery_id = p_gallery_id AND asset.status <> 'revoked')
      + (SELECT count(*) FROM public.tournament_media_upload_sessions session
         WHERE session.gallery_id = p_gallery_id
           AND session.status = 'issued' AND session.expires_at > now())
    INTO v_org_photos,v_tournament_photos,v_gallery_photos;
    IF v_recent_emissions >= 30 THEN
      RAISE EXCEPTION USING errcode = 'P0001',
        message = 'TORNEOS_MEDIA_MVP_RATE_LIMITED';
    END IF;
    IF v_org_photos >= 100 OR v_tournament_photos >= 60 OR v_gallery_photos >= 20 THEN
      RAISE EXCEPTION USING errcode = '22023', message = 'TORNEOS_MEDIA_QUOTA_EXCEEDED';
    END IF;
  END IF;

  IF v_open_sessions >= v_max_open
    OR v_org_bytes + p_byte_size > v_org_quota
    OR v_tournament_bytes + p_byte_size > v_tournament_quota
    OR v_gallery_bytes + p_byte_size > v_gallery_quota
  THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'TORNEOS_MEDIA_QUOTA_EXCEEDED';
  END IF;

  v_safe_name := 'foto-' || substr(replace(v_file_id::text,'-',''),1,12)
    || '.' || v_extension;
  v_path := v_gallery.organization_id::text || '/' || v_gallery.tournament_id::text
    || '/' || v_gallery.id::text || '/' || v_file_id::text || '.' || v_extension;
  INSERT INTO public.tournament_media_upload_sessions (
    organization_id,tournament_id,gallery_id,requested_by,token_hash,
    internal_path,safe_name,requested_mime,requested_size,max_size,
    processing_tier,idempotency_key,quota_snapshot,expires_at
  ) VALUES (
    v_gallery.organization_id,v_gallery.tournament_id,v_gallery.id,auth.uid(),
    encode(public.digest(v_token,'sha256'),'hex'),v_path,v_safe_name,
    p_declared_mime,p_byte_size,v_max_file,v_tier,p_idempotency_key,
    jsonb_build_object(
      'organizationBytes',v_org_bytes,'tournamentBytes',v_tournament_bytes,
      'galleryBytes',v_gallery_bytes,'maxFileBytes',v_max_file,
      'processingTier',v_tier
    ),now() + v_expires
  ) RETURNING id INTO v_session_id;
  PERFORM public.append_tournament_audit(
    v_gallery.organization_id,'media.upload_session.issued',
    'media_upload_session',v_session_id,null,v_gallery.tournament_id,
    jsonb_build_object(
      'galleryId',v_gallery.id,'byteSize',p_byte_size,'processingTier',v_tier
    )
  );
  RETURN jsonb_build_object(
    'sessionId',v_session_id,'safeName',v_safe_name,
    'expiresAt',now() + v_expires,'token',v_token,'reused',false,
    'processingTier',v_tier,'uploadReady',true,
    'requiresStagingStorageSigner',false
  );
END;
$_$;

CREATE OR REPLACE FUNCTION "public"."authorize_tournament_media_upload_target"(
  "p_session_id" uuid, "p_token" text, "p_actor_user_id" uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO ''
AS $_$
DECLARE
  v_session public.tournament_media_upload_sessions%rowtype;
  v_gallery public.tournament_media_galleries%rowtype;
BEGIN
  SELECT * INTO v_session FROM public.tournament_media_upload_sessions
  WHERE id = p_session_id;
  IF v_session.id IS NULL OR v_session.status <> 'issued'
    OR v_session.expires_at <= now() OR p_actor_user_id IS NULL
    OR p_actor_user_id <> v_session.requested_by
    OR encode(public.digest(coalesce(p_token,''),'sha256'),'hex') <> v_session.token_hash
  THEN
    RAISE EXCEPTION USING errcode = '42501',
      message = 'TORNEOS_MEDIA_UPLOAD_SESSION_INVALID';
  END IF;
  PERFORM public.tournament_media_require_upload_tier(v_session.processing_tier);
  SELECT * INTO v_gallery FROM public.tournament_media_galleries
  WHERE id = v_session.gallery_id;
  IF v_gallery.status NOT IN ('draft','under_review')
    OR (v_session.processing_tier = 'mvp_simple'
      AND NOT public.tournament_media_mvp_user_can_upload(
        v_session.requested_by,v_session.gallery_id
      ))
    OR (v_session.processing_tier = 'processor_external'
      AND NOT public.tournament_media_user_can_upload(
        v_session.requested_by,v_session.gallery_id
      ))
    OR EXISTS (SELECT 1 FROM public.tournament_media_assets asset
      WHERE asset.internal_path = v_session.internal_path)
  THEN
    RAISE EXCEPTION USING errcode = '42501',
      message = 'TORNEOS_MEDIA_UPLOAD_SESSION_INVALID';
  END IF;
  RETURN jsonb_build_object(
    'sessionId',v_session.id,'bucket',v_session.bucket,
    'objectName',v_session.internal_path,'contentType',v_session.requested_mime,
    'maxBytes',v_session.max_size,'expectedBytes',v_session.requested_size,
    'expiresAt',v_session.expires_at,'organizationId',v_session.organization_id,
    'tournamentId',v_session.tournament_id,'galleryId',v_session.gallery_id,
    'processingTier',v_session.processing_tier
  );
END;
$_$;

CREATE OR REPLACE FUNCTION "public"."enqueue_tournament_media_processing_job"(
  "p_session_id" uuid, "p_token" text, "p_actor_user_id" uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_target jsonb;
  v_job public.tournament_media_processing_jobs%rowtype;
  v_job_id uuid;
BEGIN
  v_target := public.authorize_tournament_media_upload_target(
    p_session_id,p_token,p_actor_user_id
  );
  IF coalesce(v_target->>'processingTier','') <> 'processor_external' THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  END IF;
  SELECT * INTO v_job FROM public.tournament_media_processing_jobs
  WHERE session_id = p_session_id;
  IF v_job.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'jobId',v_job.id,'status',v_job.status,'created',false
    );
  END IF;
  INSERT INTO public.tournament_media_processing_jobs (
    session_id,organization_id,tournament_id,gallery_id,requested_by,
    quarantine_path,declared_mime,expected_bytes
  ) VALUES (
    p_session_id,(v_target->>'organizationId')::uuid,
    (v_target->>'tournamentId')::uuid,(v_target->>'galleryId')::uuid,
    p_actor_user_id,v_target->>'objectName',v_target->>'contentType',
    (v_target->>'expectedBytes')::bigint
  ) RETURNING id INTO v_job_id;
  INSERT INTO public.tournament_audit_log (
    organization_id,actor_user_id,actor_type,action,resource_type,
    resource_id,tournament_id,metadata
  ) VALUES (
    (v_target->>'organizationId')::uuid,p_actor_user_id,'system',
    'media.processing_job.queued','media_processing_job',v_job_id,
    (v_target->>'tournamentId')::uuid,
    jsonb_build_object('galleryId',v_target->>'galleryId')
  );
  RETURN jsonb_build_object('jobId',v_job_id,'status','queued','created',true);
END;
$$;

CREATE OR REPLACE FUNCTION "public"."complete_tournament_media_simple_upload"(
  "p_actor_user_id" uuid, "p_session_id" uuid, "p_token" text,
  "p_detected_mime" text, "p_byte_size" bigint, "p_width" integer,
  "p_height" integer, "p_checksum_sha256" text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $_$
DECLARE
  v_session public.tournament_media_upload_sessions%rowtype;
  v_gallery public.tournament_media_galleries%rowtype;
  v_asset_id uuid;
  v_sort integer;
BEGIN
  SELECT * INTO v_session FROM public.tournament_media_upload_sessions
  WHERE id = p_session_id;
  IF v_session.id IS NULL OR v_session.processing_tier <> 'mvp_simple' THEN
    RAISE EXCEPTION USING errcode = '42501',
      message = 'TORNEOS_MEDIA_UPLOAD_SESSION_INVALID';
  END IF;
  PERFORM public.tournament_media_require_upload_tier('mvp_simple');
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_session.organization_id::text,0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_session.gallery_id::text,1)
  );
  SELECT * INTO v_gallery FROM public.tournament_media_galleries
  WHERE id = v_session.gallery_id FOR SHARE;
  SELECT * INTO v_session FROM public.tournament_media_upload_sessions
  WHERE id = p_session_id FOR UPDATE;
  IF v_session.status <> 'issued' OR v_session.expires_at <= now()
    OR p_actor_user_id IS NULL OR p_actor_user_id <> v_session.requested_by
    OR encode(public.digest(coalesce(p_token,''),'sha256'),'hex') <> v_session.token_hash
    OR v_gallery.status NOT IN ('draft','under_review')
    OR NOT public.tournament_media_mvp_user_can_upload(
      v_session.requested_by,v_session.gallery_id
    )
  THEN
    RAISE EXCEPTION USING errcode = '42501',
      message = 'TORNEOS_MEDIA_UPLOAD_SESSION_INVALID';
  END IF;
  IF p_detected_mime <> v_session.requested_mime
    OR p_detected_mime NOT IN ('image/jpeg','image/png','image/webp')
    OR p_byte_size <> v_session.requested_size OR p_byte_size > 4194304
    OR p_width NOT BETWEEN 1 AND 1600 OR p_height NOT BETWEEN 1 AND 1600
    OR p_width::bigint * p_height::bigint > 2560000
    OR p_checksum_sha256 !~ '^[0-9a-f]{64}$'
  THEN
    UPDATE public.tournament_media_upload_sessions SET status = 'failed'
    WHERE id = p_session_id;
    RAISE EXCEPTION USING errcode = '22023', message = 'TORNEOS_MEDIA_FILE_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_media_assets asset
    WHERE asset.organization_id = v_session.organization_id
      AND asset.checksum_sha256 = p_checksum_sha256 AND asset.status <> 'revoked'
  ) THEN
    RAISE EXCEPTION USING errcode = '23505', message = 'TORNEOS_MEDIA_DUPLICATE';
  END IF;

  INSERT INTO public.tournament_media_assets (
    organization_id,tournament_id,gallery_id,internal_path,safe_name,
    detected_mime,byte_size,width,height,checksum_sha256,status,uploaded_by,
    processing_tier
  ) VALUES (
    v_session.organization_id,v_session.tournament_id,v_session.gallery_id,
    v_session.internal_path,v_session.safe_name,p_detected_mime,p_byte_size,
    p_width,p_height,p_checksum_sha256,'pending_review',v_session.requested_by,
    'mvp_simple'
  ) RETURNING id INTO v_asset_id;
  SELECT coalesce(max(sort_order),-1) + 1 INTO v_sort
  FROM public.tournament_media_gallery_items WHERE gallery_id = v_session.gallery_id;
  INSERT INTO public.tournament_media_gallery_items (
    organization_id,tournament_id,gallery_id,asset_id,sort_order,added_by
  ) VALUES (
    v_session.organization_id,v_session.tournament_id,v_session.gallery_id,
    v_asset_id,v_sort,v_session.requested_by
  );
  UPDATE public.tournament_media_upload_sessions
  SET status = 'consumed',consumed_at = now(),asset_id = v_asset_id
  WHERE id = p_session_id;
  INSERT INTO public.tournament_audit_log (
    organization_id,actor_user_id,actor_type,action,resource_type,
    resource_id,tournament_id,metadata
  ) VALUES (
    v_session.organization_id,v_session.requested_by,'system',
    'media.upload.simple_verified','media_asset',v_asset_id,v_session.tournament_id,
    jsonb_build_object(
      'galleryId',v_session.gallery_id,'byteSize',p_byte_size,
      'processingTier','mvp_simple','structuralValidation',true,
      'checksumSha256',p_checksum_sha256
    )
  );
  RETURN jsonb_build_object(
    'assetId',v_asset_id,'galleryId',v_session.gallery_id,
    'safeName',v_session.safe_name,'status','pending_review',
    'processingTier','mvp_simple'
  );
END;
$_$;

CREATE OR REPLACE FUNCTION "public"."authorize_tournament_media_read"(
  "p_actor_user_id" uuid, "p_asset_id" uuid, "p_kind" text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_asset public.tournament_media_assets%rowtype;
  v_gallery public.tournament_media_galleries%rowtype;
  v_variant public.tournament_media_variants%rowtype;
  v_previous_claim text := coalesce(
    pg_catalog.current_setting('request.jwt.claim.sub', true), ''
  );
  v_is_staff boolean := false;
  v_owns_upload boolean := false;
  v_can_read_original boolean := false;
  v_is_participant boolean := false;
BEGIN
  IF p_actor_user_id IS NULL OR p_kind NOT IN ('thumbnail','grid','detail','original') THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  END IF;
  SELECT * INTO v_asset FROM public.tournament_media_assets WHERE id = p_asset_id;
  IF v_asset.id IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  END IF;
  SELECT * INTO v_gallery FROM public.tournament_media_galleries
  WHERE id = v_asset.gallery_id;
  PERFORM pg_catalog.set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
  BEGIN
    v_is_staff := public.has_tournament_media_capability(
      v_asset.organization_id,'media.read'
    );
    v_owns_upload := v_asset.uploaded_by = p_actor_user_id AND EXISTS (
      SELECT 1 FROM public.tournament_media_assignments assignment
      WHERE assignment.gallery_id = v_asset.gallery_id
        AND assignment.user_id = p_actor_user_id
        AND assignment.status = 'active' AND assignment.can_upload
    );
    v_can_read_original := v_owns_upload OR public.has_tournament_media_capability(
      v_asset.organization_id,'media.review'
    );
    v_is_participant := v_asset.status = 'published'
      AND v_gallery.status = 'published'
      AND public.tournament_media_asset_has_internal_consent(p_asset_id)
      AND public.can_current_user_read_media_gallery(v_asset.gallery_id);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config('request.jwt.claim.sub',v_previous_claim,true);
    RAISE;
  END;
  PERFORM pg_catalog.set_config('request.jwt.claim.sub',v_previous_claim,true);
  IF p_kind = 'original' AND NOT v_can_read_original THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  END IF;
  IF NOT v_is_staff AND NOT v_owns_upload AND NOT v_is_participant THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  END IF;

  IF v_asset.processing_tier = 'mvp_simple' THEN
    RETURN jsonb_build_object(
      'assetId',p_asset_id,'kind',p_kind,'bucket',v_asset.bucket,
      'objectName',v_asset.internal_path,'width',v_asset.width,
      'height',v_asset.height,'contentType',v_asset.detected_mime,
      'audience',CASE WHEN v_is_staff OR v_owns_upload
        THEN 'manager' ELSE 'participant' END
    );
  END IF;
  SELECT * INTO v_variant FROM public.tournament_media_variants
  WHERE asset_id = p_asset_id AND kind = p_kind AND status = 'ready';
  IF v_variant.id IS NULL THEN
    RAISE EXCEPTION USING errcode = '22023',
      message = 'TORNEOS_MEDIA_PROCESSING_REQUIRED';
  END IF;
  RETURN jsonb_build_object(
    'assetId',p_asset_id,'kind',p_kind,'bucket',v_variant.bucket,
    'objectName',v_variant.internal_path,'width',v_variant.width,
    'height',v_variant.height,'contentType',v_variant.detected_mime,
    'audience',CASE WHEN v_is_staff OR v_owns_upload
      THEN 'manager' ELSE 'participant' END
  );
END;
$$;

CREATE OR REPLACE FUNCTION "public"."transition_tournament_media_asset"(
  "p_asset_id" uuid, "p_action" text, "p_reason" text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_asset public.tournament_media_assets%rowtype;
  v_gallery public.tournament_media_galleries%rowtype;
  v_next text;
  v_replacement uuid;
  v_capability text := 'media.review';
BEGIN
  SELECT * INTO v_asset FROM public.tournament_media_assets WHERE id = p_asset_id;
  IF v_asset.id IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_asset.organization_id::text,0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_asset.gallery_id::text,1)
  );
  SELECT * INTO v_gallery FROM public.tournament_media_galleries
  WHERE id = v_asset.gallery_id FOR UPDATE;
  SELECT * INTO v_asset FROM public.tournament_media_assets
  WHERE id = p_asset_id FOR UPDATE;
  IF p_action IN ('hide','revoke','request_deletion') THEN
    v_capability := 'media.revoke';
  END IF;
  IF NOT public.has_tournament_media_capability(
    v_asset.organization_id,v_capability
  ) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  END IF;
  v_next := CASE
    WHEN p_action = 'approve' AND v_asset.status = 'pending_review' THEN 'approved'
    WHEN p_action = 'reject' AND v_asset.status = 'pending_review' THEN 'rejected'
    WHEN p_action = 'hide' AND v_asset.status IN ('approved','published') THEN 'hidden'
    WHEN p_action = 'restore' AND v_asset.status = 'hidden'
      AND v_gallery.status = 'published' AND v_asset.published_at IS NOT NULL
      THEN 'published'
    WHEN p_action = 'restore' AND v_asset.status = 'hidden' THEN 'approved'
    WHEN p_action IN ('revoke','request_deletion')
      AND v_asset.status IN ('pending_review','approved','published','hidden') THEN 'revoked'
    ELSE NULL END;
  IF v_next IS NULL THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'TORNEOS_MEDIA_TRANSITION_INVALID';
  END IF;
  IF p_action IN ('reject','hide','revoke','request_deletion')
    AND (p_reason IS NULL OR char_length(btrim(p_reason)) < 3)
  THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'TORNEOS_REASON_REQUIRED';
  END IF;
  IF p_action IN ('approve','restore')
    AND v_asset.processing_tier = 'processor_external'
    AND (
      SELECT count(*) <> 4 OR count(*) FILTER (
        WHERE variant.status = 'ready' AND variant.metadata_stripped
      ) <> 4
      FROM public.tournament_media_variants variant
      WHERE variant.asset_id = p_asset_id
        AND variant.kind IN ('thumbnail','grid','detail','original')
    )
  THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'TORNEOS_MEDIA_PROCESSING_REQUIRED';
  END IF;
  IF v_next = 'published'
    AND NOT public.tournament_media_asset_has_internal_consent(p_asset_id)
  THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'TORNEOS_MEDIA_CONSENT_REQUIRED';
  END IF;
  UPDATE public.tournament_media_assets
  SET status = v_next,
    approved_by = CASE WHEN v_next = 'approved' THEN auth.uid() ELSE approved_by END,
    approved_at = CASE WHEN v_next = 'approved' THEN now() ELSE approved_at END,
    hidden_at = CASE WHEN v_next = 'hidden' THEN now() ELSE NULL END,
    revoked_at = CASE WHEN v_next = 'revoked' THEN now() ELSE revoked_at END
  WHERE id = p_asset_id;
  IF v_gallery.status IN ('draft','under_review') AND v_next IN ('rejected','revoked') THEN
    DELETE FROM public.tournament_media_gallery_items
    WHERE gallery_id = v_gallery.id AND asset_id = p_asset_id;
    UPDATE public.tournament_media_galleries
    SET cover_asset_id = CASE WHEN cover_asset_id = p_asset_id THEN NULL ELSE cover_asset_id END,
      version = version + 1 WHERE id = v_gallery.id;
  ELSIF v_gallery.status IN ('draft','under_review') AND v_next = 'hidden'
    AND v_gallery.cover_asset_id = p_asset_id
  THEN
    UPDATE public.tournament_media_galleries
    SET cover_asset_id = NULL,version = version + 1 WHERE id = v_gallery.id;
  END IF;
  IF v_gallery.status = 'published' AND p_action IN ('hide','revoke','request_deletion')
    AND v_gallery.cover_asset_id = p_asset_id
  THEN
    SELECT asset.id INTO v_replacement
    FROM public.tournament_media_gallery_items item
    JOIN public.tournament_media_assets asset ON asset.id = item.asset_id
    WHERE item.gallery_id = v_gallery.id AND asset.id <> p_asset_id
      AND asset.status = 'published'
    ORDER BY item.sort_order,asset.created_at LIMIT 1;
    IF v_replacement IS NULL THEN
      UPDATE public.tournament_media_galleries
      SET status = 'archived',cover_asset_id = NULL,archived_at = now(),
        version = version + 1 WHERE id = v_gallery.id;
    ELSE
      UPDATE public.tournament_media_galleries
      SET cover_asset_id = v_replacement,version = version + 1
      WHERE id = v_gallery.id;
    END IF;
  END IF;
  INSERT INTO public.tournament_media_moderation_actions (
    organization_id,tournament_id,gallery_id,asset_id,action,
    previous_status,resulting_status,reason,actor_user_id
  ) VALUES (
    v_asset.organization_id,v_asset.tournament_id,v_asset.gallery_id,p_asset_id,
    p_action,v_asset.status,v_next,nullif(btrim(p_reason),''),auth.uid()
  );
  PERFORM public.append_tournament_audit(
    v_asset.organization_id,'media.asset.' || p_action,'media_asset',p_asset_id,
    null,v_asset.tournament_id,jsonb_build_object(
      'galleryId',v_asset.gallery_id,'from',v_asset.status,'to',v_next
    )
  );
  RETURN jsonb_build_object('assetId',p_asset_id,'status',v_next);
END;
$$;

COMMENT ON COLUMN "public"."tournament_media_assets"."processing_tier" IS
  'processor_external has real derived variants; mvp_simple has one browser-normalized display object.';

REVOKE ALL ON FUNCTION "public"."tournament_media_current_pipeline_mode"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."tournament_media_effective_readiness"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."get_tournament_media_upload_capability"(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."get_tournament_media_upload_capability"(uuid) FROM "anon";
REVOKE ALL ON FUNCTION "public"."get_tournament_media_asset_processing_tiers"(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."get_tournament_media_asset_processing_tiers"(uuid) FROM "anon";
REVOKE ALL ON FUNCTION "public"."tournament_media_require_upload_tier"(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."tournament_media_mvp_user_can_upload"(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."complete_tournament_media_simple_upload"(
  uuid,uuid,text,text,bigint,integer,integer,text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."get_tournament_media_upload_capability"(uuid)
  TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."get_tournament_media_asset_processing_tiers"(uuid)
  TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."tournament_media_current_pipeline_mode"()
  TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."tournament_media_effective_readiness"()
  TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."complete_tournament_media_simple_upload"(
  uuid,uuid,text,text,bigint,integer,integer,text
) TO "service_role";

COMMIT;
