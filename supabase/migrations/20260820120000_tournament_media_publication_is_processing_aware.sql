-- Arma2 Torneos · Multimedia · la publicación conoce su pipeline
--
-- FPR-001. `publish_tournament_media_gallery` exigía cuatro variantes
-- `ready` + `metadata_stripped` por cada item. Ese es el contrato real de
-- PROCESSOR_EXTERNAL, donde el worker deriva y certifica esas cuatro
-- renditions. MVP_SIMPLE nunca las promete: conserva UN solo objeto
-- normalizado y `authorize_tournament_media_read` ya lo sabe — para
-- `mvp_simple` devuelve `asset.internal_path` en las cuatro kinds y jamás
-- consulta `tournament_media_variants`. La lectura ya era tier-aware; la
-- publicación no. Una galería MVP_SIMPLE perfectamente sana quedaba
-- permanentemente no publicable.
--
-- Este cambio NO relaja nada: hace que cada asset se valide contra el
-- contrato del pipeline que realmente lo produjo, y falla cerrado ante un
-- tier desconocido.
--
-- La garantía equivalente en MVP_SIMPLE es la sanitización de metadata.
-- Hoy la ejecuta `verifyNormalizedImage` en el processor (Edge) sobre los
-- bytes ya persistidos en el bucket: si queda cualquier carrier (EXIF, XMP,
-- IPTC, ICC, tEXt/zTXt/iTXt/eXIf, chunks WEBP) lanza `MEDIA_METADATA_PRESENT`
-- y el asset no llega a existir. Pero ese veredicto NO quedaba persistido en
-- ninguna parte: la única huella era una fila de `tournament_audit_log`, que
-- es narrativa append-only y no un estado sobre el que deba decidir una
-- compuerta de publicación. Sin dato durable, la publicación no puede
-- afirmar la garantía — y en LOCAL no se infiere.
--
-- Por eso el veredicto pasa a ser un parámetro atestiguado por el servicio
-- que corrió el verificador, se persiste en el asset y un CHECK impide que
-- un asset `mvp_simple` exista sin él. No se marca nada como stripped por
-- defecto ni se rellenan filas viejas: el CHECK entra NOT VALID justamente
-- para no afirmar retroactivamente algo que esta migración no verificó.

BEGIN;

-- 1. Veredicto durable de normalización a nivel asset.
--
-- En PROCESSOR_EXTERNAL la prueba vive en `tournament_media_variants`
-- (`metadata_stripped`), una por rendition. En MVP_SIMPLE no hay variantes,
-- así que el asset mismo es el único lugar donde la prueba puede vivir.
-- Queda NULL para `processor_external`: ahí la pregunta se responde en las
-- variantes, y un `false` sería una afirmación falsa sobre ese tier.
ALTER TABLE "public"."tournament_media_assets"
  ADD COLUMN "metadata_stripped" boolean,
  ADD COLUMN "normalization_verified_at" timestamp with time zone;

COMMENT ON COLUMN "public"."tournament_media_assets"."metadata_stripped" IS
  'MVP_SIMPLE: veredicto del verificador estructural server-side sobre el objeto persistido. NULL en processor_external, donde la prueba vive por variante.';
COMMENT ON COLUMN "public"."tournament_media_assets"."normalization_verified_at" IS
  'Momento en que el servicio de confianza atestiguó el veredicto de normalización.';

-- NOT VALID a propósito: hace cumplir el invariante sobre toda fila nueva o
-- modificada sin declarar verificadas las que esta migración no verificó.
ALTER TABLE "public"."tournament_media_assets"
  ADD CONSTRAINT "tournament_media_assets_simple_normalization_check"
  CHECK (
    processing_tier <> 'mvp_simple'
    OR (metadata_stripped IS TRUE AND normalization_verified_at IS NOT NULL)
  ) NOT VALID;

-- 2. El finalizador simple exige el veredicto y lo persiste.
--
-- El parámetro no es cosmético: `complete_tournament_media_simple_upload` es
-- el único camino por el que puede nacer un asset `mvp_simple`, y sólo lo
-- llama el processor después de que `verifyNormalizedImage` devolvió — es
-- decir, después de comprobar `alreadyClean` sobre los bytes reales del
-- bucket. La función rechaza cualquier veredicto que no sea afirmativo, así
-- que el asset no existe si nadie verificó. La DB no inventa el valor: lo
-- exige a quien corrió el verificador.
DROP FUNCTION IF EXISTS "public"."complete_tournament_media_simple_upload"(
  uuid,uuid,text,text,bigint,integer,integer,text
);

CREATE OR REPLACE FUNCTION "public"."complete_tournament_media_simple_upload"(
  "p_actor_user_id" uuid, "p_session_id" uuid, "p_token" text,
  "p_detected_mime" text, "p_byte_size" bigint, "p_width" integer,
  "p_height" integer, "p_checksum_sha256" text,
  "p_metadata_stripped" boolean
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
  -- Sin veredicto afirmativo no hay asset. Fail-closed ante NULL o false.
  IF p_metadata_stripped IS NOT TRUE THEN
    UPDATE public.tournament_media_upload_sessions SET status = 'failed'
    WHERE id = p_session_id;
    RAISE EXCEPTION USING errcode = '22023',
      message = 'TORNEOS_MEDIA_METADATA_NOT_STRIPPED';
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
    processing_tier,metadata_stripped,normalization_verified_at
  ) VALUES (
    v_session.organization_id,v_session.tournament_id,v_session.gallery_id,
    v_session.internal_path,v_session.safe_name,p_detected_mime,p_byte_size,
    p_width,p_height,p_checksum_sha256,'pending_review',v_session.requested_by,
    'mvp_simple',true,now()
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
      'metadataStripped',true,
      'checksumSha256',p_checksum_sha256
    )
  );
  RETURN jsonb_build_object(
    'assetId',v_asset_id,'galleryId',v_session.gallery_id,
    'safeName',v_session.safe_name,'status','pending_review',
    'processingTier','mvp_simple','metadataStripped',true
  );
END;
$_$;
REVOKE ALL ON FUNCTION "public"."complete_tournament_media_simple_upload"(
  uuid,uuid,text,text,bigint,integer,integer,text,boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."complete_tournament_media_simple_upload"(
  uuid,uuid,text,text,bigint,integer,integer,text,boolean
) TO "service_role";

-- 3. La readiness fija la firma exacta del contrato simple.
--
-- `v_simple_contract` comprueba por `to_regprocedure` que cada RPC del
-- contrato existe. Al cambiar la aridad del finalizador hay que mover ese
-- pin, o MVP_SIMPLE se declararía no listo y cerraría las subidas.

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

-- 4. Readiness de publicación POR ASSET, según el pipeline que lo produjo.
--
-- Se evalúa asset por asset, nunca a nivel galería: el modo es un singleton
-- que puede cambiar entre subidas, así que una galería puede contener assets
-- de los dos tiers. Cada uno responde a su propio contrato y todos deben
-- pasar. Un tier desconocido devuelve false: fail-closed.
--
-- Esta función responde SÓLO "¿el procesamiento de este asset terminó y
-- entregó lo que su pipeline promete?". La moderación editorial
-- (`pending_review`/`rejected`) y el consentimiento siguen siendo compuertas
-- separadas en `publish_tournament_media_gallery`. FPR-001 no las toca.
CREATE OR REPLACE FUNCTION "public"."tournament_media_asset_publication_ready"(
  "p_asset_id" uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT coalesce((
    SELECT CASE asset.processing_tier
      -- PROCESSOR_EXTERNAL conserva intacto el contrato fuerte: el worker
      -- decodifica, re-encodea, deriva las cuatro renditions y certifica
      -- que cada una quedó sin metadata.
      WHEN 'processor_external' THEN (
        SELECT count(*)
        FROM public.tournament_media_variants variant
        WHERE variant.asset_id = asset.id
          AND variant.kind IN ('thumbnail','grid','detail','original')
          AND variant.status = 'ready'
          AND variant.metadata_stripped
      ) = 4
      -- MVP_SIMPLE no promete variantes: promete UN objeto normalizado,
      -- verificado server-side y sin carriers de metadata. Se le exige
      -- exactamente eso, que es lo que `authorize_tournament_media_read`
      -- ya sirve para las cuatro kinds.
      WHEN 'mvp_simple' THEN
        asset.metadata_stripped IS TRUE
        AND asset.normalization_verified_at IS NOT NULL
        AND asset.storage_state = 'active'
        AND asset.failure_code IS NULL
        AND asset.detected_mime IN ('image/jpeg','image/png','image/webp')
        AND asset.internal_path IS NOT NULL
        AND asset.internal_path <> ''
        AND asset.checksum_sha256 ~ '^[0-9a-f]{64}$'
        AND asset.byte_size BETWEEN 1 AND 4194304
        AND asset.width BETWEEN 1 AND 1600
        AND asset.height BETWEEN 1 AND 1600
      ELSE false
    END
    FROM public.tournament_media_assets asset
    WHERE asset.id = p_asset_id
  ), false);
$$;

REVOKE ALL ON FUNCTION "public"."tournament_media_asset_publication_ready"(uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."tournament_media_asset_publication_ready"(uuid)
  FROM "anon";
REVOKE ALL ON FUNCTION "public"."tournament_media_asset_publication_ready"(uuid)
  FROM "authenticated";

COMMENT ON FUNCTION "public"."tournament_media_asset_publication_ready"(uuid) IS
  'Readiness de procesamiento por asset según su processing_tier. Fail-closed ante tier desconocido. No sustituye moderación ni consentimiento.';

-- 5. La publicación usa el contrato por asset.
--
-- Único cambio respecto de la versión anterior: el bloque que contaba cuatro
-- variantes pasa a delegar en la readiness por tier. Autorización, bloqueo
-- de la galería, moderación, portada, consentimiento, auditoría y
-- atomicidad quedan exactamente como estaban.
CREATE OR REPLACE FUNCTION "public"."publish_tournament_media_gallery"(
  "p_gallery_id" uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
declare
  v_gallery public.tournament_media_galleries%rowtype;
  v_count integer;
begin
  select * into v_gallery
  from public.tournament_media_galleries where id = p_gallery_id;
  if v_gallery.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_gallery.organization_id::text,0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_gallery_id::text,1)
  );
  select * into v_gallery
  from public.tournament_media_galleries where id = p_gallery_id for update;
  if v_gallery.id is null or not public.has_tournament_media_capability(
    v_gallery.organization_id,'media.publish'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  if v_gallery.status = 'published' then
    return jsonb_build_object(
      'galleryId',p_gallery_id,'status','published','publishedAt',v_gallery.published_at
    );
  end if;
  if v_gallery.status not in ('draft','under_review') then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_GALLERY_NOT_PUBLISHABLE';
  end if;
  select count(*) into v_count
  from public.tournament_media_gallery_items item
  join public.tournament_media_assets asset on asset.id = item.asset_id
  where item.gallery_id = p_gallery_id;
  if v_count < 1 or v_gallery.cover_asset_id is null or not exists (
    select 1 from public.tournament_media_assets asset
    where asset.id = v_gallery.cover_asset_id
      and asset.gallery_id = p_gallery_id and asset.status = 'approved'
  ) or exists (
    select 1
    from public.tournament_media_gallery_items item
    join public.tournament_media_assets asset on asset.id = item.asset_id
    where item.gallery_id = p_gallery_id
      and asset.status <> 'approved'
  ) or exists (
    select 1
    from public.tournament_media_gallery_items item
    where item.gallery_id = p_gallery_id
      and not public.tournament_media_asset_publication_ready(item.asset_id)
  ) then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_GALLERY_NOT_PUBLISHABLE';
  end if;
  if exists (
    select 1
    from public.tournament_media_gallery_items item
    where item.gallery_id = p_gallery_id
      and not public.tournament_media_asset_has_internal_consent(item.asset_id)
  ) then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_CONSENT_REQUIRED';
  end if;

  update public.tournament_media_assets asset
  set status = 'published',published_at = now()
  where asset.gallery_id = p_gallery_id and asset.status = 'approved';
  update public.tournament_media_galleries
  set status = 'published',submitted_at = coalesce(submitted_at,now()),
      published_by = auth.uid(),published_at = now(),version = version + 1
  where id = p_gallery_id;
  perform public.append_tournament_audit(
    v_gallery.organization_id,'media.gallery.published','media_gallery',
    p_gallery_id,null,v_gallery.tournament_id,jsonb_build_object('assetCount',v_count)
  );
  return jsonb_build_object(
    'galleryId',p_gallery_id,'status','published',
    'publishedAt',now(),'assetCount',v_count
  );
end;
$$;

COMMIT;
