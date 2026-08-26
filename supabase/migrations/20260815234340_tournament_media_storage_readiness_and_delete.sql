-- Arma2 Torneos · Multimedia 1A · private Storage readiness and hard delete
--
-- The `tournament-media` bucket remains provisioned by the existing
-- loopback-only, versioned Storage procedure. This migration deliberately
-- does not enable MVP_SIMPLE: PROCESSOR_EXTERNAL remains the default for every
-- freshly migrated database. The reduced tier is activated only by the local
-- QA procedure.
--
-- Hard delete is a two-phase service operation:
--   1. begin marks the asset as delete-pending and returns DB-derived paths;
--   2. the trusted gateway removes those objects through the Storage API;
--   3. complete removes domain metadata in one PostgreSQL transaction.
-- If Storage or finalization fails, the delete-pending row remains retryable
-- and no new signed read can be minted for it.

BEGIN;

CREATE OR REPLACE FUNCTION public.begin_tournament_media_asset_delete(
  p_actor_user_id uuid,
  p_asset_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_asset public.tournament_media_assets%rowtype;
  v_previous_claim text := coalesce(
    pg_catalog.current_setting('request.jwt.claim.sub', true), ''
  );
  v_object_names jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR p_asset_id IS NULL THEN
    RAISE EXCEPTION USING
      errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  END IF;

  SELECT * INTO v_asset
  FROM public.tournament_media_assets
  WHERE id = p_asset_id;
  IF v_asset.id IS NULL THEN
    RAISE EXCEPTION USING
      errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  END IF;

  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub', p_actor_user_id::text, true
  );
  BEGIN
    IF NOT public.has_tournament_media_capability(
      v_asset.organization_id, 'media.revoke'
    ) THEN
      RAISE EXCEPTION USING
        errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_asset.organization_id::text, 0)
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_asset.gallery_id::text, 1)
    );
    SELECT * INTO v_asset
    FROM public.tournament_media_assets
    WHERE id = p_asset_id
    FOR UPDATE;
    IF v_asset.id IS NULL THEN
      RAISE EXCEPTION USING
        errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
    END IF;
    IF v_asset.status IN ('uploading', 'processing') THEN
      RAISE EXCEPTION USING
        errcode = '22023', message = 'TORNEOS_MEDIA_PROCESSING_REQUIRED';
    END IF;

    -- Object names are accepted only from the canonical tenant/tournament/
    -- gallery/UUID path contract. No user filename participates in security.
    IF v_asset.bucket <> 'tournament-media'
      OR v_asset.internal_path !~
        '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}(-(?:thumbnail|grid|detail|original))?\.(jpg|png|webp)$'
      OR EXISTS (
        SELECT 1
        FROM public.tournament_media_variants variant
        WHERE variant.asset_id = p_asset_id
          AND (
            variant.bucket <> 'tournament-media'
            OR variant.internal_path !~
              '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}-(thumbnail|grid|detail|original)\.(jpg|png|webp)$'
          )
      )
    THEN
      RAISE EXCEPTION USING
        errcode = '55000', message = 'TORNEOS_MEDIA_STORAGE_PATH_INVALID';
    END IF;

    IF v_asset.storage_state = 'active' THEN
      UPDATE public.tournament_media_assets
      SET storage_state = 'retention_marked',
          retention_marked_at = pg_catalog.now(),
          storage_purged_at = NULL,
          retention_reason = 'USER_REQUESTED_DELETE:' || v_asset.status,
          updated_at = pg_catalog.now()
      WHERE id = p_asset_id;
    ELSIF NOT (
      v_asset.storage_state = 'retention_marked'
      AND v_asset.retention_reason LIKE 'USER_REQUESTED_DELETE:%'
    ) THEN
      RAISE EXCEPTION USING
        errcode = '22023', message = 'TORNEOS_MEDIA_DELETE_INVALID';
    END IF;

    SELECT coalesce(jsonb_agg(name ORDER BY name), '[]'::jsonb)
    INTO v_object_names
    FROM (
      SELECT v_asset.internal_path AS name
      UNION
      SELECT variant.internal_path
      FROM public.tournament_media_variants variant
      WHERE variant.asset_id = p_asset_id
    ) objects;
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config(
      'request.jwt.claim.sub', v_previous_claim, true
    );
    RAISE;
  END;
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub', v_previous_claim, true
  );

  RETURN jsonb_build_object(
    'assetId', p_asset_id,
    'bucket', 'tournament-media',
    'objectNames', v_object_names,
    'deletePending', true
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_tournament_media_asset_delete(
  p_actor_user_id uuid,
  p_asset_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_asset public.tournament_media_assets%rowtype;
  v_gallery public.tournament_media_galleries%rowtype;
  v_previous_claim text := coalesce(
    pg_catalog.current_setting('request.jwt.claim.sub', true), ''
  );
  v_replacement uuid;
BEGIN
  IF p_actor_user_id IS NULL OR p_asset_id IS NULL THEN
    RAISE EXCEPTION USING
      errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  END IF;

  SELECT * INTO v_asset
  FROM public.tournament_media_assets
  WHERE id = p_asset_id;
  IF v_asset.id IS NULL THEN
    RAISE EXCEPTION USING
      errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  END IF;

  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub', p_actor_user_id::text, true
  );
  BEGIN
    IF NOT public.has_tournament_media_capability(
      v_asset.organization_id, 'media.revoke'
    ) THEN
      RAISE EXCEPTION USING
        errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_asset.organization_id::text, 0)
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_asset.gallery_id::text, 1)
    );
    SELECT * INTO v_gallery
    FROM public.tournament_media_galleries
    WHERE id = v_asset.gallery_id
    FOR UPDATE;
    SELECT * INTO v_asset
    FROM public.tournament_media_assets
    WHERE id = p_asset_id
    FOR UPDATE;
    IF v_asset.id IS NULL THEN
      RAISE EXCEPTION USING
        errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
    END IF;
    IF NOT (
      v_asset.storage_state = 'retention_marked'
      AND v_asset.retention_reason LIKE 'USER_REQUESTED_DELETE:%'
    ) THEN
      RAISE EXCEPTION USING
        errcode = '22023', message = 'TORNEOS_MEDIA_DELETE_INVALID';
    END IF;

    IF v_gallery.cover_asset_id = p_asset_id THEN
      SELECT asset.id INTO v_replacement
      FROM public.tournament_media_gallery_items item
      JOIN public.tournament_media_assets asset ON asset.id = item.asset_id
      WHERE item.gallery_id = v_gallery.id
        AND asset.id <> p_asset_id
        AND asset.status IN ('approved', 'published')
        AND asset.storage_state = 'active'
      ORDER BY item.sort_order, asset.created_at
      LIMIT 1;

      UPDATE public.tournament_media_galleries
      SET cover_asset_id = v_replacement,
          status = CASE
            WHEN status = 'published' AND v_replacement IS NULL THEN 'archived'
            ELSE status
          END,
          archived_at = CASE
            WHEN status = 'published' AND v_replacement IS NULL
              THEN pg_catalog.now()
            ELSE archived_at
          END,
          version = version + 1,
          updated_at = pg_catalog.now()
      WHERE id = v_gallery.id;
    END IF;

    DELETE FROM public.tournament_media_gallery_items
    WHERE asset_id = p_asset_id;
    DELETE FROM public.tournament_media_consent_events
    WHERE asset_id = p_asset_id;
    DELETE FROM public.tournament_media_consents
    WHERE asset_id = p_asset_id;
    DELETE FROM public.tournament_media_reports
    WHERE asset_id = p_asset_id;
    DELETE FROM public.tournament_media_relations
    WHERE asset_id = p_asset_id;
    DELETE FROM public.tournament_media_moderation_actions
    WHERE asset_id = p_asset_id;
    DELETE FROM public.tournament_media_variants
    WHERE asset_id = p_asset_id;
    DELETE FROM public.tournament_media_processing_jobs
    WHERE asset_id = p_asset_id
       OR session_id IN (
         SELECT session.id
         FROM public.tournament_media_upload_sessions session
         WHERE session.asset_id = p_asset_id
       );
    DELETE FROM public.tournament_media_upload_sessions
    WHERE asset_id = p_asset_id;
    DELETE FROM public.tournament_media_assets
    WHERE id = p_asset_id;

    -- Domain rows are removed, while the general audit survives without a
    -- foreign key to the deleted asset.
    PERFORM public.append_tournament_audit(
      v_asset.organization_id,
      'media.asset.deleted',
      'media_asset',
      p_asset_id,
      NULL,
      v_asset.tournament_id,
      jsonb_build_object(
        'galleryId', v_asset.gallery_id,
        'storagePurged', true
      )
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config(
      'request.jwt.claim.sub', v_previous_claim, true
    );
    RAISE;
  END;
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub', v_previous_claim, true
  );

  RETURN jsonb_build_object('assetId', p_asset_id, 'deleted', true);
END;
$function$;

-- A delete-pending asset cannot mint a new signed read. Signed URLs already
-- issued remain valid only until their existing short TTL expires; the object
-- removal makes them return not-found as soon as Storage completes.
CREATE OR REPLACE FUNCTION public.authorize_tournament_media_read(
  p_actor_user_id uuid,
  p_asset_id uuid,
  p_kind text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
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
  IF p_actor_user_id IS NULL
    OR p_kind NOT IN ('thumbnail','grid','detail','original')
  THEN
    RAISE EXCEPTION USING
      errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  END IF;

  SELECT * INTO v_asset
  FROM public.tournament_media_assets
  WHERE id = p_asset_id;
  IF v_asset.id IS NULL
    OR v_asset.storage_state = 'storage_purged'
    OR (
      v_asset.storage_state = 'retention_marked'
      AND v_asset.retention_reason LIKE 'USER_REQUESTED_DELETE:%'
    )
  THEN
    RAISE EXCEPTION USING
      errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  END IF;

  SELECT * INTO v_gallery
  FROM public.tournament_media_galleries
  WHERE id = v_asset.gallery_id;
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub', p_actor_user_id::text, true
  );
  BEGIN
    v_is_staff := public.has_tournament_media_capability(
      v_asset.organization_id, 'media.read'
    );
    v_owns_upload := v_asset.uploaded_by = p_actor_user_id AND EXISTS (
      SELECT 1
      FROM public.tournament_media_assignments assignment
      WHERE assignment.gallery_id = v_asset.gallery_id
        AND assignment.user_id = p_actor_user_id
        AND assignment.status = 'active'
        AND assignment.can_upload
    );
    v_can_read_original := v_owns_upload
      OR public.has_tournament_media_capability(
        v_asset.organization_id, 'media.review'
      );
    v_is_participant := v_asset.status = 'published'
      AND v_gallery.status = 'published'
      AND public.tournament_media_asset_has_internal_consent(p_asset_id)
      AND public.can_current_user_read_media_gallery(v_asset.gallery_id);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config(
      'request.jwt.claim.sub', v_previous_claim, true
    );
    RAISE;
  END;
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub', v_previous_claim, true
  );

  IF p_kind = 'original' AND NOT v_can_read_original THEN
    RAISE EXCEPTION USING
      errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  END IF;
  IF NOT v_is_staff AND NOT v_owns_upload AND NOT v_is_participant THEN
    RAISE EXCEPTION USING
      errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  END IF;

  IF v_asset.processing_tier = 'mvp_simple' THEN
    RETURN jsonb_build_object(
      'assetId', p_asset_id,
      'kind', p_kind,
      'bucket', v_asset.bucket,
      'objectName', v_asset.internal_path,
      'width', v_asset.width,
      'height', v_asset.height,
      'contentType', v_asset.detected_mime,
      'audience', CASE
        WHEN v_is_staff OR v_owns_upload THEN 'manager'
        ELSE 'participant'
      END
    );
  END IF;

  SELECT * INTO v_variant
  FROM public.tournament_media_variants
  WHERE asset_id = p_asset_id
    AND kind = p_kind
    AND status = 'ready';
  IF v_variant.id IS NULL THEN
    RAISE EXCEPTION USING
      errcode = '22023', message = 'TORNEOS_MEDIA_PROCESSING_REQUIRED';
  END IF;

  RETURN jsonb_build_object(
    'assetId', p_asset_id,
    'kind', p_kind,
    'bucket', v_variant.bucket,
    'objectName', v_variant.internal_path,
    'width', v_variant.width,
    'height', v_variant.height,
    'contentType', v_variant.detected_mime,
    'audience', CASE
      WHEN v_is_staff OR v_owns_upload THEN 'manager'
      ELSE 'participant'
    END
  );
END;
$function$;

REVOKE ALL ON FUNCTION
  public.begin_tournament_media_asset_delete(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.begin_tournament_media_asset_delete(uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION
  public.complete_tournament_media_asset_delete(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.complete_tournament_media_asset_delete(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.begin_tournament_media_asset_delete(uuid, uuid) IS
  'Service-only phase 1: authorize actor, block new signed reads, and return DB-derived Storage object names.';
COMMENT ON FUNCTION public.complete_tournament_media_asset_delete(uuid, uuid) IS
  'Service-only phase 2 after Storage removal: transactionally remove asset metadata and retain general audit.';

COMMIT;
