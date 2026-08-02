-- Arma2 Torneos · Multimedia Upload pipeline
--
-- Turns the previously simulated `uploadReady:false` constants into a value
-- derived from verifiable capabilities, and adds the service-side contracts a
-- signer/processor pair needs in order to move real bytes.
--
-- What this migration deliberately does NOT do:
--   * it never creates, alters or deletes the `tournament-media` bucket. Bucket
--     provisioning is an OPERATIONAL step (see
--     `scripts/storage/provision-tournament-media-local.mjs` and
--     `docs/arma2-torneos/21-media-upload-pipeline.md`). A migration that
--     created it would provision cloud storage on every `db push`, including
--     Staging and Production.
--   * it never marks an asset ready because an object exists in Storage. The
--     processor must attest the object it verified.
--   * it never grants `anon`/`authenticated` anything new.
--
-- The existing media contract is reused verbatim: paths, safe names, variant
-- taxonomy (thumbnail/grid/detail/original), quotas, single-use sessions and
-- the publication invariants all keep their original definitions.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Service attestations
-- ---------------------------------------------------------------------------
-- `uploadReady` must not be a constant, and it must not be a deploy-time guess
-- either. Each service that participates in the pipeline (signer, processor)
-- writes a short-lived attestation describing what it can actually do against
-- THIS backend. Readiness is the conjunction of the storage contract and fresh
-- attestations. If a service stops attesting, uploads close by themselves.

CREATE TABLE IF NOT EXISTS "public"."tournament_media_service_attestations" (
    "service" "text" NOT NULL,
    "release" "text" NOT NULL,
    "capabilities" "jsonb" NOT NULL,
    "attested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    CONSTRAINT "tournament_media_service_attestations_pkey" PRIMARY KEY ("service"),
    CONSTRAINT "tournament_media_service_attestations_service_check"
      CHECK (("service" = ANY (ARRAY['signer'::"text", 'processor'::"text"]))),
    CONSTRAINT "tournament_media_service_attestations_release_check"
      CHECK (("release" ~ '^[a-z0-9][a-z0-9._-]{0,60}$'::"text")),
    CONSTRAINT "tournament_media_service_attestations_capabilities_check"
      CHECK ((("jsonb_typeof"("capabilities") = 'object'::"text")
        AND ("pg_column_size"("capabilities") <= 4096))),
    CONSTRAINT "tournament_media_service_attestations_expiry_check"
      CHECK ((("expires_at" > "attested_at")
        AND ("expires_at" <= ("attested_at" + '24:00:00'::interval))))
);

ALTER TABLE "public"."tournament_media_service_attestations"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."tournament_media_service_attestations" FROM PUBLIC;
REVOKE ALL ON TABLE "public"."tournament_media_service_attestations" FROM "anon";
REVOKE ALL ON TABLE "public"."tournament_media_service_attestations" FROM "authenticated";

COMMENT ON TABLE "public"."tournament_media_service_attestations" IS
  'Short-lived, self-expiring capability attestations from the media signer and processor. Never client readable.';

-- ---------------------------------------------------------------------------
-- 2. Deterministic variant geometry
-- ---------------------------------------------------------------------------
-- Single source of truth for the derived sizes. The browser mirrors this in
-- `src/features/torneos/domain/mediaPipeline.js` and the processor mirrors it
-- in `supabase/functions/_shared/tournamentMediaContract.ts`; the three are
-- pinned together by tests. Nothing downstream may invent a fifth variant or a
-- different box: the taxonomy stays thumbnail/grid/detail/original.

CREATE OR REPLACE FUNCTION "public"."tournament_media_variant_box"("p_kind" "text")
  RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select case p_kind
    when 'thumbnail' then 320
    when 'grid' then 800
    when 'detail' then 1600
    else null
  end;
$$;

CREATE OR REPLACE FUNCTION "public"."tournament_media_variant_geometry"(
  "p_kind" "text", "p_width" integer, "p_height" integer
) RETURNS "jsonb"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
declare
  v_box integer := public.tournament_media_variant_box(p_kind);
  v_longest integer;
  v_width integer;
  v_height integer;
begin
  if p_kind = 'original' then
    return jsonb_build_object('kind','original','width',p_width,'height',p_height);
  end if;
  if v_box is null or p_width is null or p_height is null
    or p_width < 1 or p_height < 1
  then
    return null;
  end if;
  v_longest := greatest(p_width, p_height);
  if v_longest <= v_box then
    v_width := p_width;
    v_height := p_height;
  else
    -- floor(x + 0.5) so PostgreSQL, JavaScript and TypeScript agree bit for bit.
    v_width := greatest(1, floor((p_width::numeric * v_box) / v_longest + 0.5)::integer);
    v_height := greatest(1, floor((p_height::numeric * v_box) / v_longest + 0.5)::integer);
  end if;
  return jsonb_build_object('kind',p_kind,'width',v_width,'height',v_height);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."tournament_media_variant_plan"(
  "p_width" integer, "p_height" integer
) RETURNS "jsonb"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select coalesce(jsonb_agg(
    public.tournament_media_variant_geometry(kind, p_width, p_height)
    order by ordinality
  ), '[]'::jsonb)
  from unnest(array['thumbnail','grid','detail']::text[])
    with ordinality as variant(kind, ordinality);
$$;

-- ---------------------------------------------------------------------------
-- 3. Verifiable storage contract
-- ---------------------------------------------------------------------------
-- Reads the real state of `storage.buckets` / `pg_policies`. On a backend with
-- no storage schema at all (the embedded-postgres harness) every fact reads
-- false, which is the correct fail-closed answer.

CREATE OR REPLACE FUNCTION "public"."tournament_media_storage_contract_status"()
  RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

-- ---------------------------------------------------------------------------
-- 4. Pipeline readiness
-- ---------------------------------------------------------------------------
-- `uploadReady` is true only when every gate below is independently satisfied.
-- Losing any one of them (bucket deleted, processor stops attesting, a client
-- write policy appears) closes uploads without a deploy.

CREATE OR REPLACE FUNCTION "public"."tournament_media_pipeline_readiness"()
  RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_storage jsonb := public.tournament_media_storage_contract_status();
  v_signer public.tournament_media_service_attestations%rowtype;
  v_processor public.tournament_media_service_attestations%rowtype;
  v_signer_ready boolean;
  v_processor_ready boolean;
  v_storage_ready boolean;
  v_blockers text[] := array[]::text[];
begin
  select * into v_signer
  from public.tournament_media_service_attestations
  where service = 'signer' and expires_at > now();
  select * into v_processor
  from public.tournament_media_service_attestations
  where service = 'processor' and expires_at > now();

  v_storage_ready := (v_storage->>'bucketPresent')::boolean
    and (v_storage->>'bucketPrivate')::boolean
    and (v_storage->>'publicUrlDisabled')::boolean
    and (v_storage->>'servicePoliciesPresent')::boolean
    and (v_storage->>'clientWriteBlocked')::boolean;
  v_signer_ready := v_signer.service is not null
    and coalesce((v_signer.capabilities->>'signedUploadUrls')::boolean, false)
    and coalesce((v_signer.capabilities->>'signedReadUrls')::boolean, false)
    and coalesce((v_signer.capabilities->>'derivesPathServerSide')::boolean, false);
  v_processor_ready := v_processor.service is not null
    and coalesce((v_processor.capabilities->>'contentSniffing')::boolean, false)
    and coalesce((v_processor.capabilities->>'structuralDecode')::boolean, false)
    and coalesce((v_processor.capabilities->>'metadataStripping')::boolean, false)
    and coalesce((v_processor.capabilities->>'checksumVerification')::boolean, false)
    and coalesce((v_processor.capabilities->>'variantGeneration')::boolean, false);

  if not (v_storage->>'bucketPresent')::boolean then
    v_blockers := v_blockers || 'storage.bucket_absent'::text;
  elsif not (v_storage->>'bucketPrivate')::boolean then
    v_blockers := v_blockers || 'storage.bucket_public'::text;
  end if;
  if not (v_storage->>'servicePoliciesPresent')::boolean then
    v_blockers := v_blockers || 'storage.service_policies_absent'::text;
  end if;
  if not (v_storage->>'clientWriteBlocked')::boolean then
    v_blockers := v_blockers || 'storage.client_write_open'::text;
  end if;
  if not v_signer_ready then
    v_blockers := v_blockers || 'service.signer_unattested'::text;
  end if;
  if not v_processor_ready then
    v_blockers := v_blockers || 'service.processor_unattested'::text;
  end if;

  return jsonb_build_object(
    'bucket','tournament-media',
    'private',true,
    'uploadReady',v_storage_ready and v_signer_ready and v_processor_ready,
    'storageReady',v_storage_ready,
    'signerReady',v_signer_ready,
    'processorReady',v_processor_ready,
    'blockers',to_jsonb(v_blockers),
    'signer',case when v_signer.service is null then null else jsonb_build_object(
      'release',v_signer.release,'capabilities',v_signer.capabilities,
      'expiresAt',v_signer.expires_at
    ) end,
    'processor',case when v_processor.service is null then null else jsonb_build_object(
      'release',v_processor.release,'capabilities',v_processor.capabilities,
      'expiresAt',v_processor.expires_at
    ) end,
    'storage',v_storage,
    'maxFileBytes',12582912,'maxPixels',36000000,
    'allowedMime',jsonb_build_array('image/jpeg','image/png','image/webp'),
    'maxBatchFiles',40,'signedUrlTtlSeconds',300,
    -- The pixel transcode tier is intentionally NOT claimed here. See
    -- docs/arma2-torneos/21-media-upload-pipeline.md.
    'antivirusScanning',false,
    'pixelTranscode',coalesce(
      (v_processor.capabilities->>'pixelTranscode')::boolean, false
    )
  );
end;
$$;

CREATE OR REPLACE FUNCTION "public"."attest_tournament_media_service"(
  "p_service" "text", "p_release" "text", "p_capabilities" "jsonb",
  "p_ttl_seconds" integer DEFAULT 3600
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_expires timestamp with time zone;
begin
  if p_service not in ('signer','processor')
    or p_release is null
    or jsonb_typeof(coalesce(p_capabilities,'null'::jsonb)) <> 'object'
    or p_ttl_seconds is null or p_ttl_seconds < 60 or p_ttl_seconds > 86400
  then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_ATTESTATION_INVALID';
  end if;
  v_expires := now() + make_interval(secs => p_ttl_seconds);
  insert into public.tournament_media_service_attestations (
    service, release, capabilities, attested_at, expires_at
  ) values (
    p_service, p_release, p_capabilities, now(), v_expires
  ) on conflict (service) do update set
    release = excluded.release,
    capabilities = excluded.capabilities,
    attested_at = excluded.attested_at,
    expires_at = excluded.expires_at;
  return jsonb_build_object(
    'service',p_service,'release',p_release,'expiresAt',v_expires
  );
end;
$$;

CREATE OR REPLACE FUNCTION "public"."revoke_tournament_media_service_attestation"("p_service" "text")
  RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if p_service not in ('signer','processor') then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_ATTESTATION_INVALID';
  end if;
  delete from public.tournament_media_service_attestations where service = p_service;
  return jsonb_build_object('service',p_service,'revoked',true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Upload target authorisation
-- ---------------------------------------------------------------------------
-- The signer never receives a path. It receives a session id plus the session
-- token and gets back the ONE object name the DB already derived when the
-- session was issued. A caller cannot retarget a gallery, a tournament, a
-- tenant, an existing object or a variant slot through this contract.

CREATE OR REPLACE FUNCTION "public"."authorize_tournament_media_upload_target"(
  "p_session_id" "uuid", "p_token" "text", "p_actor_user_id" "uuid"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_session public.tournament_media_upload_sessions%rowtype;
  v_gallery public.tournament_media_galleries%rowtype;
begin
  select * into v_session
  from public.tournament_media_upload_sessions
  where id = p_session_id;
  if v_session.id is null
    or v_session.status <> 'issued'
    or v_session.expires_at <= now()
    or p_actor_user_id is null
    or p_actor_user_id <> v_session.requested_by
    or encode(public.digest(coalesce(p_token,''),'sha256'),'hex') <> v_session.token_hash
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_UPLOAD_SESSION_INVALID';
  end if;
  select * into v_gallery
  from public.tournament_media_galleries
  where id = v_session.gallery_id;
  -- Re-check live authorisation: a photographer revoked after the session was
  -- issued, a gallery published or archived meanwhile, a suspended membership.
  if v_gallery.status not in ('draft','under_review')
    or not public.tournament_media_user_can_upload(
      v_session.requested_by, v_session.gallery_id
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_UPLOAD_SESSION_INVALID';
  end if;
  -- An object already parked on this name means a replay attempt or an
  -- abandoned upload; either way the session may not be signed again.
  if exists (
    select 1 from public.tournament_media_assets asset
    where asset.internal_path = v_session.internal_path
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_UPLOAD_SESSION_INVALID';
  end if;
  return jsonb_build_object(
    'sessionId',v_session.id,
    'bucket',v_session.bucket,
    'objectName',v_session.internal_path,
    'contentType',v_session.requested_mime,
    'maxBytes',v_session.max_size,
    'expectedBytes',v_session.requested_size,
    'expiresAt',v_session.expires_at,
    'organizationId',v_session.organization_id,
    'tournamentId',v_session.tournament_id,
    'galleryId',v_session.gallery_id
  );
end;
$_$;

-- ---------------------------------------------------------------------------
-- 6. Variant finalisation
-- ---------------------------------------------------------------------------
-- `complete_tournament_media_upload` inserts thumbnail/grid/detail as
-- `processing`. Only the processor can move them to `ready`, and only with the
-- geometry the DB itself derives from the asset it already verified. This is
-- what keeps "the object exists in Storage" from ever meaning "ready".

CREATE OR REPLACE FUNCTION "public"."finalize_tournament_media_variants"(
  "p_asset_id" "uuid", "p_variants" "jsonb"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_asset public.tournament_media_assets%rowtype;
  v_kind text;
  v_entry jsonb;
  v_expected jsonb;
  v_extension text;
  v_ready integer;
begin
  if jsonb_typeof(coalesce(p_variants,'null'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_VARIANT_PAYLOAD_INVALID';
  end if;
  select * into v_asset
  from public.tournament_media_assets where id = p_asset_id;
  if v_asset.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_asset.organization_id::text,0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_asset.gallery_id::text,1)
  );
  select * into v_asset
  from public.tournament_media_assets where id = p_asset_id for update;
  if v_asset.status not in ('pending_review','processing') then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_TRANSITION_INVALID';
  end if;
  v_extension := case v_asset.detected_mime
    when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end;

  foreach v_kind in array array['thumbnail','grid','detail'] loop
    v_entry := p_variants -> v_kind;
    v_expected := public.tournament_media_variant_geometry(
      v_kind, v_asset.width, v_asset.height
    );
    if v_entry is null or jsonb_typeof(v_entry) <> 'object' then
      raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_VARIANT_PAYLOAD_INVALID';
    end if;
    if coalesce(v_entry->>'detectedMime','') <> v_asset.detected_mime
      or coalesce((v_entry->>'width')::integer, -1) <> (v_expected->>'width')::integer
      or coalesce((v_entry->>'height')::integer, -1) <> (v_expected->>'height')::integer
      or coalesce((v_entry->>'byteSize')::bigint, 0) < 1
      or coalesce((v_entry->>'byteSize')::bigint, 0) > 12582912
      or coalesce(v_entry->>'checksumSha256','') !~ '^[0-9a-f]{64}$'
      or coalesce((v_entry->>'metadataStripped')::boolean, false) is not true
    then
      raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_VARIANT_PAYLOAD_INVALID';
    end if;
    update public.tournament_media_variants variant
    set byte_size = (v_entry->>'byteSize')::bigint,
        width = (v_expected->>'width')::integer,
        height = (v_expected->>'height')::integer,
        checksum_sha256 = v_entry->>'checksumSha256',
        detected_mime = v_asset.detected_mime,
        metadata_stripped = true,
        status = 'ready'
    where variant.asset_id = p_asset_id
      and variant.kind = v_kind
      and variant.status = 'processing'
      and variant.internal_path = regexp_replace(
        v_asset.internal_path, '\.(jpg|png|webp)$', '-' || v_kind || '.' || v_extension
      );
    if not found then
      raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_VARIANT_SLOT_INVALID';
    end if;
  end loop;

  select count(*) into v_ready
  from public.tournament_media_variants variant
  where variant.asset_id = p_asset_id
    and variant.kind in ('thumbnail','grid','detail','original')
    and variant.status = 'ready'
    and variant.metadata_stripped;
  if v_ready <> 4 then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_PROCESSING_REQUIRED';
  end if;

  insert into public.tournament_audit_log (
    organization_id, actor_user_id, actor_type, action, resource_type,
    resource_id, tournament_id, metadata
  ) values (
    v_asset.organization_id, v_asset.uploaded_by, 'system',
    'media.variants.ready', 'media_asset', p_asset_id, v_asset.tournament_id,
    jsonb_build_object('galleryId', v_asset.gallery_id, 'variants', 3)
  );
  return jsonb_build_object(
    'assetId',p_asset_id,'variantsReady',v_ready,'status',v_asset.status
  );
end;
$_$;

CREATE OR REPLACE FUNCTION "public"."fail_tournament_media_upload_session"(
  "p_session_id" "uuid", "p_failure_code" "text"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_session public.tournament_media_upload_sessions%rowtype;
begin
  if p_failure_code is null or p_failure_code !~ '^[A-Z][A-Z0-9_]{2,80}$' then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_FAILURE_CODE_INVALID';
  end if;
  select * into v_session
  from public.tournament_media_upload_sessions
  where id = p_session_id for update;
  if v_session.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_UPLOAD_SESSION_INVALID';
  end if;
  if v_session.status <> 'issued' then
    return jsonb_build_object(
      'sessionId',p_session_id,'status',v_session.status,'changed',false
    );
  end if;
  update public.tournament_media_upload_sessions
  set status = 'failed' where id = p_session_id;
  insert into public.tournament_audit_log (
    organization_id, actor_user_id, actor_type, action, resource_type,
    resource_id, tournament_id, metadata
  ) values (
    v_session.organization_id, v_session.requested_by, 'system',
    'media.upload.failed', 'media_upload_session', p_session_id,
    v_session.tournament_id,
    jsonb_build_object('galleryId', v_session.gallery_id, 'failureCode', p_failure_code)
  );
  return jsonb_build_object(
    'sessionId',p_session_id,'status','failed','changed',true,
    'objectName',v_session.internal_path,'bucket',v_session.bucket
  );
end;
$_$;

-- ---------------------------------------------------------------------------
-- 7. Read authorisation for signed downloads
-- ---------------------------------------------------------------------------
-- The database never mints a URL. It answers a narrower question: "may this
-- user read this variant of this asset, and if so which object name is it".
-- Participants are structurally unable to reach `original`, and the object name
-- is returned to the signer only — never to a client.
--
-- The audience predicate is NOT reimplemented here. The signer runs as
-- service_role on behalf of somebody else, so the function borrows that user's
-- identity for the duration of the check by setting the same GUC `auth.uid()`
-- already reads, then restores it. `can_current_user_read_media_gallery` and
-- `can_read_tournament_participant_hub` therefore keep being the single
-- definition of who may see a published gallery.

CREATE OR REPLACE FUNCTION "public"."authorize_tournament_media_read"(
  "p_actor_user_id" "uuid", "p_asset_id" "uuid", "p_kind" "text"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_asset public.tournament_media_assets%rowtype;
  v_gallery public.tournament_media_galleries%rowtype;
  v_variant public.tournament_media_variants%rowtype;
  v_previous_claim text := coalesce(
    pg_catalog.current_setting('request.jwt.claim.sub', true), ''
  );
  v_is_manager boolean := false;
  v_is_participant boolean := false;
begin
  if p_actor_user_id is null
    or p_kind not in ('thumbnail','grid','detail','original')
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  select * into v_asset
  from public.tournament_media_assets where id = p_asset_id;
  if v_asset.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  select * into v_gallery
  from public.tournament_media_galleries where id = v_asset.gallery_id;

  perform pg_catalog.set_config(
    'request.jwt.claim.sub', p_actor_user_id::text, true
  );
  begin
    v_is_manager := public.has_tournament_media_capability(
      v_asset.organization_id, 'media.read'
    );
    -- A photographer may re-read only their own upload, and only while the
    -- assignment is still active. Revoking the assignment cuts reads too.
    if not v_is_manager and v_asset.uploaded_by = p_actor_user_id then
      v_is_manager := exists (
        select 1 from public.tournament_media_assignments assignment
        where assignment.gallery_id = v_asset.gallery_id
          and assignment.user_id = p_actor_user_id
          and assignment.status = 'active'
          and assignment.can_upload
      );
    end if;
    v_is_participant := v_asset.status = 'published'
      and v_gallery.status = 'published'
      and public.tournament_media_asset_has_internal_consent(p_asset_id)
      and public.can_current_user_read_media_gallery(v_asset.gallery_id);
  exception when others then
    perform pg_catalog.set_config('request.jwt.claim.sub', v_previous_claim, true);
    raise;
  end;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_previous_claim, true);

  if p_kind = 'original' and not v_is_manager then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  if not v_is_manager and not v_is_participant then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;

  select * into v_variant
  from public.tournament_media_variants
  where asset_id = p_asset_id and kind = p_kind and status = 'ready';
  if v_variant.id is null then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_PROCESSING_REQUIRED';
  end if;
  return jsonb_build_object(
    'assetId',p_asset_id,'kind',p_kind,'bucket',v_variant.bucket,
    'objectName',v_variant.internal_path,'width',v_variant.width,
    'height',v_variant.height,'contentType',v_variant.detected_mime,
    'audience',case when v_is_manager then 'manager' else 'participant' end
  );
end;
$$;

-- Actor binding for the processor.
--
-- `complete_tournament_media_upload` is service_role-only *and* demands an
-- authenticated actor equal to the session requester — a deliberate belt and
-- braces from the original audit. A service calling over PostgREST has a role
-- but no `sub`, so it cannot satisfy the second half. Rather than relax the
-- audited contract or duplicate it, this adapter binds the actor for the
-- duration of the call and delegates. All validation still happens inside the
-- original function.
CREATE OR REPLACE FUNCTION "public"."complete_tournament_media_upload_for_actor"(
  "p_actor_user_id" "uuid", "p_session_id" "uuid", "p_token" "text",
  "p_detected_mime" "text", "p_byte_size" bigint, "p_width" integer,
  "p_height" integer, "p_checksum_sha256" "text"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_previous_claim text := coalesce(
    pg_catalog.current_setting('request.jwt.claim.sub', true), ''
  );
  v_result jsonb;
begin
  if p_actor_user_id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  perform pg_catalog.set_config(
    'request.jwt.claim.sub', p_actor_user_id::text, true
  );
  begin
    v_result := public.complete_tournament_media_upload(
      p_session_id, p_token, p_detected_mime, p_byte_size,
      p_width, p_height, p_checksum_sha256
    );
  exception when others then
    perform pg_catalog.set_config('request.jwt.claim.sub', v_previous_claim, true);
    raise;
  end;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_previous_claim, true);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Cleanup
-- ---------------------------------------------------------------------------
-- Expires abandoned intents and hands the worker the exact object names it may
-- purge. Consumed sessions are never returned: their bytes belong to an asset.

CREATE OR REPLACE FUNCTION "public"."cleanup_tournament_media_upload_sessions"(
  "p_limit" integer DEFAULT 200
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_expired jsonb;
  v_purgeable jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_FILTER_INVALID';
  end if;
  with stale as (
    select id
    from public.tournament_media_upload_sessions
    where status = 'issued' and expires_at <= now()
    order by expires_at
    limit p_limit
    for update skip locked
  ), expired as (
    update public.tournament_media_upload_sessions session
    set status = 'expired'
    from stale
    where session.id = stale.id
    returning session.id, session.bucket, session.internal_path
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'sessionId',id,'bucket',bucket,'objectName',internal_path
  )),'[]'::jsonb) into v_expired from expired;

  -- Everything that may be deleted from the bucket: object names reserved by a
  -- session that will never be consumed, and whose name was not adopted by an
  -- asset. An asset's own paths are never purgeable through this contract.
  select coalesce(jsonb_agg(jsonb_build_object(
    'bucket',session.bucket,'objectName',session.internal_path
  )),'[]'::jsonb) into v_purgeable
  from public.tournament_media_upload_sessions session
  where session.status in ('expired','revoked','failed')
    and not exists (
      select 1 from public.tournament_media_assets asset
      where asset.internal_path = session.internal_path
    )
  limit p_limit;

  return jsonb_build_object(
    'expired',v_expired,'purgeable',v_purgeable,'checkedAt',now()
  );
end;
$$;

-- Reconciliation surface for orphan sweeps: the authoritative set of object
-- names the pipeline owns under a given tenant prefix. Anything in the bucket
-- that is not in here and not reserved by a live session is an orphan.
CREATE OR REPLACE FUNCTION "public"."tournament_media_known_object_names"(
  "p_organization_id" "uuid"
) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select jsonb_build_object(
    'organizationId',p_organization_id,
    'objectNames',coalesce((
      select jsonb_agg(distinct name) from (
        select variant.internal_path as name
        from public.tournament_media_variants variant
        where variant.organization_id = p_organization_id
        union all
        select session.internal_path
        from public.tournament_media_upload_sessions session
        where session.organization_id = p_organization_id
          and session.status = 'issued'
          and session.expires_at > now()
      ) owned
    ),'[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- 9. Readiness-derived getters
-- ---------------------------------------------------------------------------
-- Same projections as before, with the three hardcoded fail-closed constants
-- replaced by `tournament_media_pipeline_readiness()`. Both stay STABLE and
-- read-only. Assets now expose how many variants are actually ready so the UI
-- can distinguish "processing" from "pending review" without guessing.

CREATE OR REPLACE FUNCTION "public"."get_tournament_media_admin_context"("p_organization_id" "uuid", "p_tournament_id" "uuid" DEFAULT NULL::"uuid", "p_status" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 30, "p_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_result jsonb;
  v_can_handle_reports boolean;
  v_readiness jsonb;
begin
  if not public.has_tournament_media_capability(p_organization_id,'media.read') then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  if p_limit < 1 or p_limit > 100 or p_offset < 0 then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_FILTER_INVALID';
  end if;
  v_can_handle_reports := public.has_tournament_media_capability(
    p_organization_id,'media.handle_reports'
  );
  v_readiness := public.tournament_media_pipeline_readiness();
  select jsonb_build_object(
    'storage',jsonb_build_object(
      'bucket','tournament-media','private',true,
      'certified',(v_readiness->>'uploadReady')::boolean,
      'uploadReady',(v_readiness->>'uploadReady')::boolean,
      'requiresStagingGate',not (v_readiness->>'uploadReady')::boolean,
      'storageReady',v_readiness->'storageReady',
      'signerReady',v_readiness->'signerReady',
      'processorReady',v_readiness->'processorReady',
      'blockers',v_readiness->'blockers',
      'pixelTranscode',v_readiness->'pixelTranscode',
      'antivirusScanning',v_readiness->'antivirusScanning',
      'signedUrlTtlSeconds',v_readiness->'signedUrlTtlSeconds',
      'maxFileBytes',12582912,'maxPixels',36000000,
      'allowedMime',jsonb_build_array('image/jpeg','image/png','image/webp'),
      'maxBatchFiles',40
    ),
    'capabilities',to_jsonb(public.tournament_media_role_capabilities(membership.role)),
    'tournaments',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',tournament.id,'name',tournament.name,'seasonId',tournament.season_id,
        'status',tournament.status,'categories',(
          select coalesce(jsonb_agg(jsonb_build_object(
            'id',category.id,'name',category.name
          ) order by category.sort_order,category.name),'[]'::jsonb)
          from public.tournament_categories category
          where category.tournament_id = tournament.id and category.status = 'active'
        ),
        'matches',(
          select coalesce(jsonb_agg(jsonb_build_object(
            'id',match.id,'categoryId',match.category_id,
            'roundId',match.round_id,'matchNumber',match.match_number,
            'scheduledAt',match.scheduled_at,'status',match.status
          ) order by match.scheduled_at nulls last,match.match_number),'[]'::jsonb)
          from public.tournament_matches match
          join public.tournament_fixture_versions fixture
            on fixture.id = match.fixture_version_id
          where match.tournament_id = tournament.id
            and match.status <> 'cancelled'
            and fixture.status = 'published'
            and fixture.invalidated_at is null
        )
      ) order by tournament.updated_at desc)
      from public.tournaments tournament
      where tournament.organization_id = p_organization_id
        and tournament.status <> 'archived'
        and (p_tournament_id is null or tournament.id = p_tournament_id)
    ),'[]'::jsonb),
    'galleries',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',gallery.id,'tournamentId',gallery.tournament_id,
        'categoryId',gallery.category_id,'roundId',gallery.round_id,
        'matchId',gallery.match_id,'title',gallery.title,
        'description',gallery.description,'status',gallery.status,
        'visibility',gallery.visibility,'coverAssetId',gallery.cover_asset_id,
        'minorRestriction',gallery.minor_restriction,'version',gallery.version,
        'createdAt',gallery.created_at,'updatedAt',gallery.updated_at,
        'publishedAt',gallery.published_at,
        'assets',(
          select coalesce(jsonb_agg(jsonb_build_object(
            'id',asset.id,'safeName',asset.safe_name,
            'mime',asset.detected_mime,'byteSize',asset.byte_size,
            'width',asset.width,'height',asset.height,'status',asset.status,
            'sortOrder',item.sort_order,'caption',item.caption,
            'uploadedAt',asset.created_at,
            'variantsReady',(
              select count(*)
              from public.tournament_media_variants variant
              where variant.asset_id = asset.id
                and variant.kind in ('thumbnail','grid','detail','original')
                and variant.status = 'ready'
                and variant.metadata_stripped
            )
          ) order by item.sort_order),'[]'::jsonb)
          from public.tournament_media_gallery_items item
          join public.tournament_media_assets asset on asset.id = item.asset_id
          where item.gallery_id = gallery.id
        ),
        'reportCount',case when v_can_handle_reports then (
          select count(*) from public.tournament_media_reports report
          where report.gallery_id = gallery.id and report.status in ('open','under_review')
        ) else 0 end
      ) order by gallery.updated_at desc)
      from (
        select *
        from public.tournament_media_galleries gallery_page
        where gallery_page.organization_id = p_organization_id
          and (p_tournament_id is null or gallery_page.tournament_id = p_tournament_id)
          and (p_status is null or gallery_page.status = p_status)
        order by gallery_page.updated_at desc
        limit p_limit offset p_offset
      ) gallery
    ),'[]'::jsonb),
    'reports',case when v_can_handle_reports then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',report.id,'galleryId',report.gallery_id,'assetId',report.asset_id,
        'reason',report.reason,'detail',report.detail,
        'requestHide',report.request_hide,'status',report.status,
        'createdAt',report.created_at
      ) order by report.created_at desc)
      from public.tournament_media_reports report
      where report.organization_id = p_organization_id
        and report.status in ('open','under_review')
        and (p_tournament_id is null or report.tournament_id = p_tournament_id)
    ),'[]'::jsonb) else '[]'::jsonb end
  ) into v_result
  from public.tournament_organization_members membership
  where membership.organization_id = p_organization_id
    and membership.user_id = auth.uid() and membership.status = 'active';
  return coalesce(v_result,'{}'::jsonb);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."request_tournament_media_upload_session"("p_gallery_id" "uuid", "p_file_name" "text", "p_declared_mime" "text", "p_byte_size" bigint, "p_idempotency_key" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_gallery public.tournament_media_galleries%rowtype;
  v_existing public.tournament_media_upload_sessions%rowtype;
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
  v_upload_ready boolean := (
    public.tournament_media_pipeline_readiness()->>'uploadReady'
  )::boolean;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_gallery
  from public.tournament_media_galleries
  where id = p_gallery_id;
  if v_gallery.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'TORNEOS_IDEMPOTENCY_REQUIRED';
  end if;

  -- Todas las reservas toman primero organización y luego galería.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_gallery.organization_id::text,0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_gallery_id::text,1)
  );
  select * into v_gallery
  from public.tournament_media_galleries
  where id = p_gallery_id
  for share;
  if not public.tournament_media_user_can_upload(auth.uid(),p_gallery_id) then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;

  v_extension := case p_declared_mime
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    else null
  end;
  if v_extension is null
    or p_byte_size is null or p_byte_size < 1 or p_byte_size > 12582912
    or not (
      (p_declared_mime = 'image/jpeg' and lower(p_file_name) ~ '\.(jpe?g)$')
      or (p_declared_mime = 'image/png' and lower(p_file_name) ~ '\.png$')
      or (p_declared_mime = 'image/webp' and lower(p_file_name) ~ '\.webp$')
    )
  then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_FILE_INVALID';
  end if;
  select * into v_existing
  from public.tournament_media_upload_sessions session
  where session.organization_id = v_gallery.organization_id
    and session.requested_by = auth.uid()
    and session.idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.gallery_id is distinct from p_gallery_id
      or v_existing.requested_mime is distinct from p_declared_mime
      or v_existing.requested_size is distinct from p_byte_size
      or right(v_existing.safe_name,char_length(v_extension) + 1)
        is distinct from '.' || v_extension
    then
      raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object(
      'sessionId',v_existing.id,'safeName',v_existing.safe_name,
      'expiresAt',v_existing.expires_at,'token',null,'reused',true,
      'uploadReady',v_upload_ready,
      'requiresStagingStorageSigner',not v_upload_ready
    );
  end if;

  select
    coalesce((
      select sum(asset.byte_size)
      from public.tournament_media_assets asset
      where asset.organization_id = v_gallery.organization_id
        and asset.status <> 'revoked'
    ),0) + coalesce((
      select sum(session.requested_size)
      from public.tournament_media_upload_sessions session
      where session.organization_id = v_gallery.organization_id
        and session.status = 'issued' and session.expires_at > now()
    ),0)
  into v_org_bytes;
  select
    coalesce((
      select sum(asset.byte_size)
      from public.tournament_media_assets asset
      where asset.tournament_id = v_gallery.tournament_id
        and asset.status <> 'revoked'
    ),0) + coalesce((
      select sum(session.requested_size)
      from public.tournament_media_upload_sessions session
      where session.tournament_id = v_gallery.tournament_id
        and session.status = 'issued' and session.expires_at > now()
    ),0)
  into v_tournament_bytes;
  select
    coalesce((
      select sum(asset.byte_size)
      from public.tournament_media_assets asset
      where asset.gallery_id = p_gallery_id
        and asset.status <> 'revoked'
    ),0) + coalesce((
      select sum(session.requested_size)
      from public.tournament_media_upload_sessions session
      where session.gallery_id = p_gallery_id
        and session.status = 'issued' and session.expires_at > now()
    ),0)
  into v_gallery_bytes;
  select count(*) into v_open_sessions
  from public.tournament_media_upload_sessions session
  where session.requested_by = auth.uid()
    and session.status = 'issued'
    and session.expires_at > now();
  if v_open_sessions >= 40
    or v_org_bytes + p_byte_size > 5368709120
    or v_tournament_bytes + p_byte_size > 2147483648
    or v_gallery_bytes + p_byte_size > 536870912
  then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_QUOTA_EXCEEDED';
  end if;

  v_safe_name := 'foto-' || substr(replace(v_file_id::text,'-',''),1,12) || '.' || v_extension;
  v_path := v_gallery.organization_id::text || '/' || v_gallery.tournament_id::text
    || '/' || v_gallery.id::text || '/' || v_file_id::text || '.' || v_extension;
  insert into public.tournament_media_upload_sessions (
    organization_id,tournament_id,gallery_id,requested_by,token_hash,
    internal_path,safe_name,requested_mime,requested_size,idempotency_key,
    quota_snapshot,expires_at
  ) values (
    v_gallery.organization_id,v_gallery.tournament_id,v_gallery.id,auth.uid(),
    encode(public.digest(v_token,'sha256'),'hex'),v_path,v_safe_name,
    p_declared_mime,p_byte_size,p_idempotency_key,
    jsonb_build_object(
      'organizationBytes',v_org_bytes,'tournamentBytes',v_tournament_bytes,
      'galleryBytes',v_gallery_bytes,'maxFileBytes',12582912
    ),
    now() + interval '10 minutes'
  ) returning id into v_session_id;
  perform public.append_tournament_audit(
    v_gallery.organization_id,'media.upload_session.issued',
    'media_upload_session',v_session_id,null,v_gallery.tournament_id,
    jsonb_build_object('galleryId',v_gallery.id,'byteSize',p_byte_size)
  );
  return jsonb_build_object(
    'sessionId',v_session_id,'safeName',v_safe_name,
    'expiresAt',now() + interval '10 minutes','token',v_token,'reused',false,
    'uploadReady',v_upload_ready,
    'requiresStagingStorageSigner',not v_upload_ready
  );
end;
$_$;

CREATE OR REPLACE FUNCTION "public"."get_published_tournament_media"("p_tournament_id" "uuid", "p_category_id" "uuid" DEFAULT NULL::"uuid", "p_match_id" "uuid" DEFAULT NULL::"uuid", "p_limit" integer DEFAULT 20, "p_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_result jsonb;
  v_readiness jsonb := public.tournament_media_pipeline_readiness();
  v_delivery jsonb;
begin
  if auth.uid() is null or not public.can_read_tournament_participant_hub(
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

-- ---------------------------------------------------------------------------
-- 10. Grants
-- ---------------------------------------------------------------------------
-- Every new contract is service-only. No client role gains a single new
-- EXECUTE: the browser reaches the pipeline exclusively through the signer and
-- processor Edge Functions.

REVOKE ALL ON FUNCTION "public"."tournament_media_variant_box"("p_kind" "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."tournament_media_variant_geometry"("p_kind" "text", "p_width" integer, "p_height" integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."tournament_media_variant_plan"("p_width" integer, "p_height" integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."tournament_media_storage_contract_status"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."tournament_media_pipeline_readiness"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."attest_tournament_media_service"("p_service" "text", "p_release" "text", "p_capabilities" "jsonb", "p_ttl_seconds" integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."revoke_tournament_media_service_attestation"("p_service" "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."authorize_tournament_media_upload_target"("p_session_id" "uuid", "p_token" "text", "p_actor_user_id" "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."finalize_tournament_media_variants"("p_asset_id" "uuid", "p_variants" "jsonb") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."fail_tournament_media_upload_session"("p_session_id" "uuid", "p_failure_code" "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."authorize_tournament_media_read"("p_actor_user_id" "uuid", "p_asset_id" "uuid", "p_kind" "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."cleanup_tournament_media_upload_sessions"("p_limit" integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."tournament_media_known_object_names"("p_organization_id" "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."complete_tournament_media_upload_for_actor"("p_actor_user_id" "uuid", "p_session_id" "uuid", "p_token" "text", "p_detected_mime" "text", "p_byte_size" bigint, "p_width" integer, "p_height" integer, "p_checksum_sha256" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."tournament_media_variant_geometry"("p_kind" "text", "p_width" integer, "p_height" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."tournament_media_variant_plan"("p_width" integer, "p_height" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."tournament_media_storage_contract_status"() TO "service_role";
GRANT ALL ON FUNCTION "public"."tournament_media_pipeline_readiness"() TO "service_role";
GRANT ALL ON FUNCTION "public"."attest_tournament_media_service"("p_service" "text", "p_release" "text", "p_capabilities" "jsonb", "p_ttl_seconds" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."revoke_tournament_media_service_attestation"("p_service" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."authorize_tournament_media_upload_target"("p_session_id" "uuid", "p_token" "text", "p_actor_user_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."finalize_tournament_media_variants"("p_asset_id" "uuid", "p_variants" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."fail_tournament_media_upload_session"("p_session_id" "uuid", "p_failure_code" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."authorize_tournament_media_read"("p_actor_user_id" "uuid", "p_asset_id" "uuid", "p_kind" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."cleanup_tournament_media_upload_sessions"("p_limit" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."tournament_media_known_object_names"("p_organization_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."complete_tournament_media_upload_for_actor"("p_actor_user_id" "uuid", "p_session_id" "uuid", "p_token" "text", "p_detected_mime" "text", "p_byte_size" bigint, "p_width" integer, "p_height" integer, "p_checksum_sha256" "text") TO "service_role";

COMMIT;
