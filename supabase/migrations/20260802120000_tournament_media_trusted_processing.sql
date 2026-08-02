-- Arma2 Torneos · Multimedia · procesamiento confiable y contrato fail-closed
--
-- `20260802090000_tournament_media_upload_pipeline.sql` derived `uploadReady`
-- from attestations, which was the right shape but the wrong contents. Three
-- holes were confirmed against the embedded harness before this file existed:
--
--   1. `uploadReady` could be true while `pixelTranscode` and
--      `antivirusScanning` were false: neither was a gate, `antivirusScanning`
--      was a hardcoded `false` in the projection, and the processor gate
--      accepted `structuralDecode` — a container walk — in place of a real
--      pixel decode.
--   2. `attest_tournament_media_service` accepted ANY jsonb object. A single
--      manual call claiming `pixelTranscode: true` was enough to flip the
--      projection, with no self-test, no codec, no backend binding.
--   3. `request_tournament_media_upload_session` computed `uploadReady` and
--      then ignored it: it inserted a session row, reserved quota, minted a
--      64-hex token, derived the object path and wrote the issued-session audit
--      entry while readiness was false.
--
-- What this migration changes:
--
--   * Readiness becomes the conjunction of TEN independently verified gates and
--     reports each one separately, with explicit blockers.
--   * Attestations are validated server-side against a per-service allowlist
--     and schema, bound to a release, a worker type, a codec version, an
--     antivirus version and signature date, this backend's fingerprint and a
--     real self-test, and they expire quickly. `structuralDecode` is no longer
--     a capability name at all, so it cannot stand in for `pixelDecode`.
--   * Every write path — issuing a session, authorising an upload target,
--     completing an upload, finalising variants — refuses before touching a row
--     when readiness is false, with one stable, sanitised error.
--   * A job queue plus an authenticated callback contract is added for the
--     external image worker that will do the real decode/transcode/scan. The
--     worker itself is NOT deployed by this migration and is not reachable from
--     the Edge runtime; until a real worker attests, `uploadReady` stays false.
--
-- No client role gains a single new privilege here.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Backend fingerprint
-- ---------------------------------------------------------------------------
-- An attestation minted against another project must not be replayable here.
-- The fingerprint is a hash of local catalogue identifiers: stable for a given
-- backend, different across backends, and carrying nothing sensitive.

CREATE OR REPLACE FUNCTION "public"."tournament_media_backend_fingerprint"()
  RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select encode(public.digest(
    coalesce((
      select database.oid::text
      from pg_catalog.pg_database database
      where database.datname = pg_catalog.current_database()
    ), 'no-db')
    || ':' || coalesce((
      select class.oid::text
      from pg_catalog.pg_class class
      join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
      where class.relname = 'tournament_media_service_attestations'
        and namespace.nspname = 'public'
    ), 'no-table')
    || ':tournament-media',
    'sha256'
  ), 'hex');
$$;

COMMENT ON FUNCTION "public"."tournament_media_backend_fingerprint"() IS
  'Non-sensitive hash of local catalogue identifiers. Binds a service attestation to THIS backend.';

-- ---------------------------------------------------------------------------
-- 2. Capability allowlist
-- ---------------------------------------------------------------------------
-- A service may only claim names that exist here. Anything else — including
-- the old `structuralDecode` — is a rejected attestation, not an ignored key.

CREATE OR REPLACE FUNCTION "public"."tournament_media_capability_allowlist"("p_service" "text")
  RETURNS "text"[]
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select case p_service
    when 'signer' then array[
      'signedUploadUrls','signedReadUrls','derivesPathServerSide'
    ]
    when 'processor' then array[
      'contentSniffing','pixelDecode','pixelTranscode','metadataStrippingApplied',
      'checksumVerification','variantGeneration','antivirusScanning',
      'storageReadWrite','cleanup'
    ]
    else null
  end::text[];
$$;

-- The worker types allowed to attest as `processor`. The Edge runtime is
-- deliberately absent: it cannot host libvips or ClamAV, so it can never
-- honestly claim the advanced tier.
CREATE OR REPLACE FUNCTION "public"."tournament_media_worker_type_allowlist"()
  RETURNS "text"[]
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select array['external_image_worker']::text[];
$$;

-- ---------------------------------------------------------------------------
-- 3. Attestation validation
-- ---------------------------------------------------------------------------
-- Shape:
--   {
--     "capabilities": { "<allowlisted>": <boolean>, ... },
--     "evidence": {
--       "selfTest": { "passed": true, "checks": { "<capability>": <boolean> } },
--       "backendFingerprint": "<64 hex>",
--       "probedAt": "<timestamptz, within 10 minutes>",
--       "workerType": "external_image_worker",              -- processor only
--       "codec":     { "name": ..., "version": ... },       -- processor only
--       "antivirus": { "name": ..., "version": ...,
--                      "signaturesAt": "<timestamptz>" }    -- iff antivirusScanning
--     }
--   }
--
-- Every capability claimed true must have a matching self-test check that
-- passed. A hand-written `{"pixelTranscode": true}` therefore does nothing.

CREATE OR REPLACE FUNCTION "public"."tournament_media_attestation_rejection"(
  "p_service" "text", "p_capabilities" "jsonb", "p_ttl_seconds" integer
) RETURNS "text"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
declare
  v_allowed text[] := public.tournament_media_capability_allowlist(p_service);
  v_caps jsonb;
  v_evidence jsonb;
  v_self_test jsonb;
  v_checks jsonb;
  v_key text;
  v_probed_at timestamp with time zone;
  v_signatures_at timestamp with time zone;
  v_max_ttl integer := case p_service when 'processor' then 900 else 3600 end;
begin
  if v_allowed is null then
    return 'service_unknown';
  end if;
  if p_ttl_seconds is null or p_ttl_seconds < 60 or p_ttl_seconds > v_max_ttl then
    return 'ttl_out_of_range';
  end if;
  if jsonb_typeof(coalesce(p_capabilities,'null'::jsonb)) <> 'object' then
    return 'payload_not_object';
  end if;
  -- No stray top-level keys: the envelope is exactly two members.
  if exists (
    select 1 from jsonb_object_keys(p_capabilities) as envelope_key
    where envelope_key not in ('capabilities','evidence')
  ) then
    return 'envelope_unknown_key';
  end if;

  v_caps := p_capabilities -> 'capabilities';
  v_evidence := p_capabilities -> 'evidence';
  if jsonb_typeof(coalesce(v_caps,'null'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(v_evidence,'null'::jsonb)) <> 'object'
  then
    return 'envelope_incomplete';
  end if;

  -- Capabilities: allowlisted names, boolean values, nothing else.
  for v_key in select capability_key from jsonb_object_keys(v_caps) as capability_key loop
    if not (v_key = any (v_allowed)) then
      return 'capability_not_allowlisted:' || v_key;
    end if;
    if jsonb_typeof(v_caps -> v_key) <> 'boolean' then
      return 'capability_not_boolean:' || v_key;
    end if;
  end loop;

  -- Backend binding.
  if coalesce(v_evidence->>'backendFingerprint','')
    <> public.tournament_media_backend_fingerprint()
  then
    return 'backend_fingerprint_mismatch';
  end if;

  -- Freshness of the probe itself, independent of the row's own expiry.
  begin
    v_probed_at := (v_evidence->>'probedAt')::timestamp with time zone;
  exception when others then
    v_probed_at := null;
  end;
  if v_probed_at is null
    or v_probed_at > now() + interval '2 minutes'
    or v_probed_at < now() - interval '10 minutes'
  then
    return 'probe_stale';
  end if;

  -- Self-test: it has to exist, it has to have passed, and every capability
  -- claimed true has to name a check that also passed.
  v_self_test := v_evidence -> 'selfTest';
  if jsonb_typeof(coalesce(v_self_test,'null'::jsonb)) <> 'object'
    or coalesce((v_self_test->>'passed')::boolean, false) is not true
  then
    return 'self_test_absent';
  end if;
  v_checks := v_self_test -> 'checks';
  if jsonb_typeof(coalesce(v_checks,'null'::jsonb)) <> 'object' then
    return 'self_test_checks_absent';
  end if;
  for v_key in
    select capability_key from jsonb_object_keys(v_caps) as capability_key
    where coalesce((v_caps ->> capability_key)::boolean, false)
  loop
    if coalesce((v_checks ->> v_key)::boolean, false) is not true then
      return 'self_test_missing_check:' || v_key;
    end if;
  end loop;

  if p_service = 'processor' then
    if not (coalesce(v_evidence->>'workerType','')
      = any (public.tournament_media_worker_type_allowlist()))
    then
      return 'worker_type_not_allowlisted';
    end if;
    -- A pixel tier without a named, versioned codec is a claim, not evidence.
    if coalesce((v_caps->>'pixelDecode')::boolean, false)
      or coalesce((v_caps->>'pixelTranscode')::boolean, false)
    then
      if coalesce(v_evidence#>>'{codec,name}','') !~ '^[a-z0-9][a-z0-9._+-]{1,40}$'
        or coalesce(v_evidence#>>'{codec,version}','') !~ '^[0-9][0-9a-zA-Z._+-]{0,30}$'
      then
        return 'codec_evidence_absent';
      end if;
    end if;
    if coalesce((v_caps->>'antivirusScanning')::boolean, false) then
      if coalesce(v_evidence#>>'{antivirus,name}','') !~ '^[a-z0-9][a-z0-9._+-]{1,40}$'
        or coalesce(v_evidence#>>'{antivirus,version}','') !~ '^[0-9][0-9a-zA-Z._+-]{0,30}$'
      then
        return 'antivirus_evidence_absent';
      end if;
      begin
        v_signatures_at := (v_evidence#>>'{antivirus,signaturesAt}')::timestamp with time zone;
      exception when others then
        v_signatures_at := null;
      end;
      -- Definitions older than a week are treated as no antivirus at all.
      if v_signatures_at is null
        or v_signatures_at > now() + interval '1 day'
        or v_signatures_at < now() - interval '7 days'
      then
        return 'antivirus_signatures_stale';
      end if;
    end if;
  end if;

  return null;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."attest_tournament_media_service"(
  "p_service" "text", "p_release" "text", "p_capabilities" "jsonb",
  "p_ttl_seconds" integer DEFAULT 900
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_rejection text;
  v_expires timestamp with time zone;
begin
  if p_service is null or p_release is null then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_ATTESTATION_INVALID';
  end if;
  v_rejection := public.tournament_media_attestation_rejection(
    p_service, p_capabilities, p_ttl_seconds
  );
  if v_rejection is not null then
    -- The caller learns only that it was refused. A service that needs the
    -- reason calls `tournament_media_attestation_rejection` itself, which is
    -- read-only and service-only.
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

-- ---------------------------------------------------------------------------
-- 4. Readiness — ten gates, reported separately
-- ---------------------------------------------------------------------------
-- Every capability the audit demanded is now an independent boolean AND a
-- conjunct of `uploadReady`. Losing any one of them closes uploads with a
-- named blocker and without a deploy.

CREATE OR REPLACE FUNCTION "public"."tournament_media_pipeline_readiness"()
  RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_storage jsonb := public.tournament_media_storage_contract_status();
  v_signer public.tournament_media_service_attestations%rowtype;
  v_processor public.tournament_media_service_attestations%rowtype;
  v_signer_caps jsonb := '{}'::jsonb;
  v_processor_caps jsonb := '{}'::jsonb;
  v_processor_evidence jsonb := '{}'::jsonb;
  v_processor_present boolean;
  v_storage_ready boolean;
  v_signer_ready boolean;
  v_processor_ready boolean;
  v_pixel_decode boolean;
  v_pixel_transcode boolean;
  v_metadata boolean;
  v_antivirus boolean;
  v_cleanup boolean;
  v_cleanup_contract boolean;
  v_upload_ready boolean;
  v_blockers text[] := array[]::text[];
begin
  select * into v_signer
  from public.tournament_media_service_attestations
  where service = 'signer' and expires_at > now();
  select * into v_processor
  from public.tournament_media_service_attestations
  where service = 'processor' and expires_at > now();

  if v_signer.service is not null then
    v_signer_caps := coalesce(v_signer.capabilities -> 'capabilities', '{}'::jsonb);
  end if;
  v_processor_present := v_processor.service is not null;
  if v_processor_present then
    v_processor_caps := coalesce(v_processor.capabilities -> 'capabilities', '{}'::jsonb);
    v_processor_evidence := coalesce(v_processor.capabilities -> 'evidence', '{}'::jsonb);
  end if;

  v_storage_ready := (v_storage->>'bucketPresent')::boolean
    and (v_storage->>'bucketPrivate')::boolean
    and (v_storage->>'publicUrlDisabled')::boolean
    and (v_storage->>'servicePoliciesPresent')::boolean
    and (v_storage->>'clientWriteBlocked')::boolean;

  v_signer_ready := v_signer.service is not null
    and coalesce((v_signer_caps->>'signedUploadUrls')::boolean, false)
    and coalesce((v_signer_caps->>'signedReadUrls')::boolean, false)
    and coalesce((v_signer_caps->>'derivesPathServerSide')::boolean, false);

  -- Baseline processor duties. The pixel, metadata and antivirus tiers are
  -- separate gates below; none of them may be inferred from this one.
  v_processor_ready := v_processor_present
    and coalesce((v_processor_caps->>'contentSniffing')::boolean, false)
    and coalesce((v_processor_caps->>'checksumVerification')::boolean, false)
    and coalesce((v_processor_caps->>'variantGeneration')::boolean, false)
    and coalesce((v_processor_caps->>'storageReadWrite')::boolean, false)
    and coalesce(v_processor_evidence->>'workerType','')
      = any (public.tournament_media_worker_type_allowlist());

  v_pixel_decode := v_processor_present
    and coalesce((v_processor_caps->>'pixelDecode')::boolean, false);
  v_pixel_transcode := v_processor_present
    and coalesce((v_processor_caps->>'pixelTranscode')::boolean, false);
  v_metadata := v_processor_present
    and coalesce((v_processor_caps->>'metadataStrippingApplied')::boolean, false);
  v_antivirus := v_processor_present
    and coalesce((v_processor_caps->>'antivirusScanning')::boolean, false);

  -- Cleanup needs both halves: the sweeping contracts have to exist in this
  -- database, and the worker has to say it can execute them.
  v_cleanup_contract :=
    pg_catalog.to_regprocedure('public.cleanup_tournament_media_upload_sessions(integer)') is not null
    and pg_catalog.to_regprocedure('public.cleanup_tournament_media_processing_jobs(integer)') is not null;
  v_cleanup := v_cleanup_contract
    and v_processor_present
    and coalesce((v_processor_caps->>'cleanup')::boolean, false);

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
  if not v_pixel_decode then
    v_blockers := v_blockers || 'processor.pixel_decode_absent'::text;
  end if;
  if not v_pixel_transcode then
    v_blockers := v_blockers || 'processor.pixel_transcode_absent'::text;
  end if;
  if not v_metadata then
    v_blockers := v_blockers || 'processor.metadata_sanitization_absent'::text;
  end if;
  if not v_antivirus then
    v_blockers := v_blockers || 'processor.antivirus_absent'::text;
  end if;
  if not v_cleanup then
    v_blockers := v_blockers || 'cleanup.unavailable'::text;
  end if;

  v_upload_ready := v_storage_ready and v_signer_ready and v_processor_ready
    and v_pixel_decode and v_pixel_transcode and v_metadata
    and v_antivirus and v_cleanup;

  return jsonb_build_object(
    'bucket','tournament-media',
    'private',true,
    'uploadReady',v_upload_ready,
    'storageReady',v_storage_ready,
    'signerReady',v_signer_ready,
    'processorReady',v_processor_ready,
    'pixelDecodeReady',v_pixel_decode,
    'pixelTranscodeReady',v_pixel_transcode,
    'metadataSanitizationReady',v_metadata,
    'antivirusReady',v_antivirus,
    'cleanupReady',v_cleanup,
    'blockers',to_jsonb(v_blockers),
    'signer',case when v_signer.service is null then null else jsonb_build_object(
      'release',v_signer.release,'capabilities',v_signer_caps,
      'expiresAt',v_signer.expires_at
    ) end,
    'processor',case when not v_processor_present then null else jsonb_build_object(
      'release',v_processor.release,'capabilities',v_processor_caps,
      'workerType',v_processor_evidence->>'workerType',
      'codec',v_processor_evidence->'codec',
      'antivirus',jsonb_build_object(
        'name',v_processor_evidence#>>'{antivirus,name}',
        'version',v_processor_evidence#>>'{antivirus,version}',
        'signaturesAt',v_processor_evidence#>>'{antivirus,signaturesAt}'
      ),
      'expiresAt',v_processor.expires_at
    ) end,
    'storage',v_storage,
    'maxFileBytes',12582912,'maxPixels',36000000,
    'allowedMime',jsonb_build_array('image/jpeg','image/png','image/webp'),
    'maxBatchFiles',40,'signedUrlTtlSeconds',300,
    -- Kept for the existing projections. Both are now derived, never constants.
    'pixelTranscode',v_pixel_transcode,
    'antivirusScanning',v_antivirus
  );
end;
$$;

-- One stable, sanitised refusal for every write path. It names no bucket, no
-- service, no capability and no environment.
CREATE OR REPLACE FUNCTION "public"."tournament_media_require_pipeline_ready"()
  RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not coalesce(
    (public.tournament_media_pipeline_readiness()->>'uploadReady')::boolean, false
  ) then
    raise exception using errcode = '55000',
      message = 'TORNEOS_MEDIA_PIPELINE_NOT_READY';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Sessions refuse before any write
-- ---------------------------------------------------------------------------
-- Identical to the audited definition except for the gate on line one of the
-- body: no row, no quota reservation, no token, no derived path, no audit
-- entry when the pipeline is not ready.

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
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  -- Fail closed BEFORE anything is read, locked, reserved or written.
  perform public.tournament_media_require_pipeline_ready();

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
      'uploadReady',true,
      'requiresStagingStorageSigner',false
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
    'uploadReady',true,
    'requiresStagingStorageSigner',false
  );
end;
$_$;

-- ---------------------------------------------------------------------------
-- 6. The signer and the processor refuse once readiness drops
-- ---------------------------------------------------------------------------
-- A readiness collapse after a session was issued must stop that session dead:
-- no new signature, no completion, no variant flip. The session then expires on
-- its own and the sweeper hands its object name to cleanup. Reads are NOT
-- gated: media that was already published stays visible.

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
  perform public.tournament_media_require_pipeline_ready();
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
  if v_gallery.status not in ('draft','under_review')
    or not public.tournament_media_user_can_upload(
      v_session.requested_by, v_session.gallery_id
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_UPLOAD_SESSION_INVALID';
  end if;
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
  perform public.tournament_media_require_pipeline_ready();
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
-- 7. Processing jobs and the worker callback
-- ---------------------------------------------------------------------------
-- The Edge runtime cannot host libvips or ClamAV, so it is an ORCHESTRATOR: it
-- records the intent to process and never finalises anything. An external
-- worker leases the job, downloads the quarantined object, decodes it with a
-- real codec, re-encodes it, strips metadata, generates the variants, scans
-- them and only then calls back.
--
-- Until such a worker attests, readiness is false and both the callback and
-- the finalisation below refuse.

CREATE TABLE IF NOT EXISTS "public"."tournament_media_processing_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "tournament_id" "uuid" NOT NULL,
    "gallery_id" "uuid" NOT NULL,
    "requested_by" "uuid" NOT NULL,
    "bucket" "text" DEFAULT 'tournament-media'::"text" NOT NULL,
    "quarantine_path" "text" NOT NULL,
    "declared_mime" "text" NOT NULL,
    "expected_bytes" bigint NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "max_attempts" integer DEFAULT 3 NOT NULL,
    "lease_token" "text",
    "lease_expires_at" timestamp with time zone,
    "worker_id" "text",
    "last_error" "text",
    "asset_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tournament_media_processing_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tournament_media_processing_jobs_session_key" UNIQUE ("session_id"),
    CONSTRAINT "tournament_media_processing_jobs_status_check"
      CHECK (("status" = ANY (ARRAY['queued'::"text",'leased'::"text",'succeeded'::"text",'failed'::"text",'abandoned'::"text"]))),
    CONSTRAINT "tournament_media_processing_jobs_provider_check"
      CHECK (("bucket" = 'tournament-media'::"text")),
    -- The job may only ever point at a QUARANTINE object: the raw upload name.
    -- A derived variant name is structurally impossible here, and the variants
    -- table's own path constraint makes the reverse impossible too.
    CONSTRAINT "tournament_media_processing_jobs_path_check"
      CHECK ((("quarantine_path" ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'::"text")
        AND ("quarantine_path" !~~ '%..%'::"text"))),
    CONSTRAINT "tournament_media_processing_jobs_mime_check"
      CHECK (("declared_mime" = ANY (ARRAY['image/jpeg'::"text",'image/png'::"text",'image/webp'::"text"]))),
    CONSTRAINT "tournament_media_processing_jobs_bytes_check"
      CHECK ((("expected_bytes" >= 1) AND ("expected_bytes" <= 12582912))),
    CONSTRAINT "tournament_media_processing_jobs_attempts_check"
      CHECK ((("attempts" >= 0) AND ("max_attempts" BETWEEN 1 AND 10) AND ("attempts" <= "max_attempts"))),
    CONSTRAINT "tournament_media_processing_jobs_lease_check"
      CHECK (((("status" = 'leased'::"text") AND ("lease_token" ~ '^[0-9a-f]{64}$'::"text") AND ("lease_expires_at" IS NOT NULL) AND ("worker_id" IS NOT NULL))
        OR (("status" <> 'leased'::"text") AND ("lease_token" IS NULL) AND ("lease_expires_at" IS NULL)))),
    CONSTRAINT "tournament_media_processing_jobs_error_check"
      CHECK ((("last_error" IS NULL) OR ("last_error" ~ '^[A-Z][A-Z0-9_]{2,80}$'::"text"))),
    CONSTRAINT "tournament_media_processing_jobs_worker_check"
      CHECK ((("worker_id" IS NULL) OR ("worker_id" ~ '^[a-z0-9][a-z0-9._:-]{2,60}$'::"text")))
);

ALTER TABLE "public"."tournament_media_processing_jobs" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."tournament_media_processing_jobs" FROM PUBLIC;
REVOKE ALL ON TABLE "public"."tournament_media_processing_jobs" FROM "anon";
REVOKE ALL ON TABLE "public"."tournament_media_processing_jobs" FROM "authenticated";

CREATE INDEX IF NOT EXISTS "tournament_media_processing_jobs_queue_idx"
  ON "public"."tournament_media_processing_jobs" ("status", "created_at");

COMMENT ON TABLE "public"."tournament_media_processing_jobs" IS
  'Work queue for the external image worker. Points only at quarantined objects; never client readable.';

CREATE OR REPLACE FUNCTION "public"."enqueue_tournament_media_processing_job"(
  "p_session_id" "uuid", "p_token" "text", "p_actor_user_id" "uuid"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_target jsonb;
  v_job public.tournament_media_processing_jobs%rowtype;
  v_job_id uuid;
begin
  -- Re-uses the audited authorisation wholesale: token, expiry, single use,
  -- gallery lifecycle, live photographer assignment — and the readiness gate.
  v_target := public.authorize_tournament_media_upload_target(
    p_session_id, p_token, p_actor_user_id
  );
  select * into v_job
  from public.tournament_media_processing_jobs
  where session_id = p_session_id;
  if v_job.id is not null then
    return jsonb_build_object(
      'jobId',v_job.id,'status',v_job.status,'created',false
    );
  end if;
  insert into public.tournament_media_processing_jobs (
    session_id, organization_id, tournament_id, gallery_id, requested_by,
    quarantine_path, declared_mime, expected_bytes
  ) values (
    p_session_id,
    (v_target->>'organizationId')::uuid,
    (v_target->>'tournamentId')::uuid,
    (v_target->>'galleryId')::uuid,
    p_actor_user_id,
    v_target->>'objectName',
    v_target->>'contentType',
    (v_target->>'expectedBytes')::bigint
  ) returning id into v_job_id;
  -- Written directly rather than through `append_tournament_audit`: the worker
  -- path runs as a service and has no `sub`, and the helper demands one.
  insert into public.tournament_audit_log (
    organization_id, actor_user_id, actor_type, action, resource_type,
    resource_id, tournament_id, metadata
  ) values (
    (v_target->>'organizationId')::uuid, p_actor_user_id, 'system',
    'media.processing_job.queued', 'media_processing_job', v_job_id,
    (v_target->>'tournamentId')::uuid,
    jsonb_build_object('galleryId', v_target->>'galleryId')
  );
  return jsonb_build_object('jobId',v_job_id,'status','queued','created',true);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."lease_tournament_media_processing_jobs"(
  "p_worker_id" "text", "p_lease_seconds" integer DEFAULT 300,
  "p_limit" integer DEFAULT 1
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_leases jsonb;
begin
  if p_worker_id is null or p_worker_id !~ '^[a-z0-9][a-z0-9._:-]{2,60}$'
    or p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 1800
    or p_limit is null or p_limit < 1 or p_limit > 20
  then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_FILTER_INVALID';
  end if;
  -- Leasing is deliberately NOT readiness-gated: when readiness collapses the
  -- worker still has to be able to drain the queue and purge what it wrote.
  with candidate as (
    select job.id
    from public.tournament_media_processing_jobs job
    where job.status = 'queued'
    order by job.created_at
    limit p_limit
    for update skip locked
  ), leased as (
    update public.tournament_media_processing_jobs job
    set status = 'leased',
        attempts = job.attempts + 1,
        lease_token = encode(public.gen_random_bytes(32),'hex'),
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        worker_id = p_worker_id,
        updated_at = now()
    from candidate
    where job.id = candidate.id
    returning job.id, job.session_id, job.bucket, job.quarantine_path,
      job.declared_mime, job.expected_bytes, job.lease_token,
      job.lease_expires_at, job.attempts, job.max_attempts,
      job.organization_id, job.gallery_id, job.requested_by
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'jobId',id,'sessionId',session_id,'bucket',bucket,
    'objectName',quarantine_path,'declaredMime',declared_mime,
    'expectedBytes',expected_bytes,'leaseToken',lease_token,
    'leaseExpiresAt',lease_expires_at,'attempts',attempts,
    'maxAttempts',max_attempts,'organizationId',organization_id,
    'galleryId',gallery_id,'requestedBy',requested_by
  )),'[]'::jsonb) into v_leases from leased;
  return jsonb_build_object('jobs',v_leases,'leasedAt',now());
end;
$_$;

CREATE OR REPLACE FUNCTION "public"."complete_tournament_media_processing_job"(
  "p_job_id" "uuid", "p_lease_token" "text", "p_asset_id" "uuid"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_job public.tournament_media_processing_jobs%rowtype;
  v_ready integer;
begin
  -- A worker that lost its attestation between leasing and calling back may
  -- not publish anything.
  perform public.tournament_media_require_pipeline_ready();
  select * into v_job
  from public.tournament_media_processing_jobs
  where id = p_job_id for update;
  if v_job.id is null
    or v_job.status <> 'leased'
    or v_job.lease_expires_at <= now()
    or p_lease_token is null
    or v_job.lease_token is distinct from p_lease_token
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_JOB_LEASE_INVALID';
  end if;
  -- The job may only close over an asset that already has its four final,
  -- metadata-stripped variants. A partially ready asset can never be reported
  -- as a success.
  select count(*) into v_ready
  from public.tournament_media_variants variant
  where variant.asset_id = p_asset_id
    and variant.kind in ('thumbnail','grid','detail','original')
    and variant.status = 'ready'
    and variant.metadata_stripped;
  if v_ready <> 4 then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_PROCESSING_REQUIRED';
  end if;
  update public.tournament_media_processing_jobs
  set status = 'succeeded', asset_id = p_asset_id, lease_token = null,
      lease_expires_at = null, last_error = null, updated_at = now()
  where id = p_job_id;
  return jsonb_build_object('jobId',p_job_id,'status','succeeded','assetId',p_asset_id);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."fail_tournament_media_processing_job"(
  "p_job_id" "uuid", "p_lease_token" "text", "p_failure_code" "text"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_job public.tournament_media_processing_jobs%rowtype;
  v_next text;
begin
  if p_failure_code is null or p_failure_code !~ '^[A-Z][A-Z0-9_]{2,80}$' then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_FAILURE_CODE_INVALID';
  end if;
  select * into v_job
  from public.tournament_media_processing_jobs
  where id = p_job_id for update;
  if v_job.id is null
    or v_job.status <> 'leased'
    or p_lease_token is null
    or v_job.lease_token is distinct from p_lease_token
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_JOB_LEASE_INVALID';
  end if;
  v_next := case when v_job.attempts >= v_job.max_attempts
    then 'abandoned' else 'queued' end;
  update public.tournament_media_processing_jobs
  set status = v_next, lease_token = null, lease_expires_at = null,
      last_error = p_failure_code, updated_at = now()
  where id = p_job_id;
  -- The last attempt closes the session too, which is what makes the
  -- quarantined object purgeable through the existing sweeper.
  if v_next = 'abandoned' then
    perform public.fail_tournament_media_upload_session(
      v_job.session_id, p_failure_code
    );
  end if;
  return jsonb_build_object(
    'jobId',p_job_id,'status',v_next,'attempts',v_job.attempts,
    'maxAttempts',v_job.max_attempts
  );
end;
$_$;

-- Completion, bound to the LEASE rather than to the session token.
--
-- The worker never receives the browser's session token, so it cannot hold a
-- reusable credential and none is stored at rest for it. Instead the database
-- re-keys the session to a token it mints inside this transaction and consumes
-- immediately. Two things follow, both wanted:
--   * the audited `complete_tournament_media_upload` still performs every
--     check it always did, on a token it verifies normally;
--   * the browser's own token stops working the moment the worker takes over,
--     so an upload under processing can no longer be re-signed or replayed.
CREATE OR REPLACE FUNCTION "public"."complete_tournament_media_upload_for_job"(
  "p_job_id" "uuid", "p_lease_token" "text", "p_detected_mime" "text",
  "p_byte_size" bigint, "p_width" integer, "p_height" integer,
  "p_checksum_sha256" "text"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_job public.tournament_media_processing_jobs%rowtype;
  v_session public.tournament_media_upload_sessions%rowtype;
  v_token text := encode(public.gen_random_bytes(32),'hex');
begin
  perform public.tournament_media_require_pipeline_ready();
  select * into v_job
  from public.tournament_media_processing_jobs
  where id = p_job_id for update;
  if v_job.id is null
    or v_job.status <> 'leased'
    or v_job.lease_expires_at <= now()
    or p_lease_token is null
    or v_job.lease_token is distinct from p_lease_token
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_JOB_LEASE_INVALID';
  end if;
  select * into v_session
  from public.tournament_media_upload_sessions
  where id = v_job.session_id for update;
  if v_session.id is null
    or v_session.status <> 'issued'
    or v_session.expires_at <= now()
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_UPLOAD_SESSION_INVALID';
  end if;
  update public.tournament_media_upload_sessions
  set token_hash = encode(public.digest(v_token,'sha256'),'hex')
  where id = v_session.id;
  return public.complete_tournament_media_upload_for_actor(
    v_session.requested_by, v_session.id, v_token, p_detected_mime,
    p_byte_size, p_width, p_height, p_checksum_sha256
  );
end;
$$;

-- Returns expired leases to the queue and hands the sweeper the object names
-- of everything that will never be processed.
CREATE OR REPLACE FUNCTION "public"."cleanup_tournament_media_processing_jobs"(
  "p_limit" integer DEFAULT 200
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_requeued jsonb;
  v_purgeable jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_FILTER_INVALID';
  end if;
  with stale as (
    select job.id
    from public.tournament_media_processing_jobs job
    where job.status = 'leased' and job.lease_expires_at <= now()
    order by job.lease_expires_at
    limit p_limit
    for update skip locked
  ), requeued as (
    update public.tournament_media_processing_jobs job
    set status = case when job.attempts >= job.max_attempts
          then 'abandoned' else 'queued' end,
        lease_token = null, lease_expires_at = null,
        last_error = 'LEASE_EXPIRED', updated_at = now()
    from stale
    where job.id = stale.id
    returning job.id, job.status
  )
  select coalesce(jsonb_agg(jsonb_build_object('jobId',id,'status',status)),'[]'::jsonb)
  into v_requeued from requeued;

  select coalesce(jsonb_agg(jsonb_build_object(
    'bucket',job.bucket,'objectName',job.quarantine_path
  )),'[]'::jsonb) into v_purgeable
  from public.tournament_media_processing_jobs job
  where job.status = 'abandoned'
    and not exists (
      select 1 from public.tournament_media_assets asset
      where asset.internal_path = job.quarantine_path
    )
  limit p_limit;

  return jsonb_build_object(
    'requeued',v_requeued,'purgeable',v_purgeable,'checkedAt',now()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Variant finalisation refuses without a certified pipeline
-- ---------------------------------------------------------------------------
-- Same audited body, plus the gate. Nothing may reach `ready` — and therefore
-- nothing may be approved or published — while readiness is false.

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
  perform public.tournament_media_require_pipeline_ready();
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
      -- The worker states, per object, that it re-encoded from decoded pixels
      -- and that the object passed the scanner. A payload without both is a
      -- browser rendition, and browser renditions are no longer publishable.
      or coalesce((v_entry->>'pixelTranscoded')::boolean, false) is not true
      or coalesce((v_entry->>'antivirusClean')::boolean, false) is not true
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

-- ---------------------------------------------------------------------------
-- 9. Projections
-- ---------------------------------------------------------------------------
-- The admin context now surfaces every gate, so the operator sees exactly what
-- is missing instead of a single closed door.

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
      'pixelDecodeReady',v_readiness->'pixelDecodeReady',
      'pixelTranscodeReady',v_readiness->'pixelTranscodeReady',
      'metadataSanitizationReady',v_readiness->'metadataSanitizationReady',
      'antivirusReady',v_readiness->'antivirusReady',
      'cleanupReady',v_readiness->'cleanupReady',
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

-- ---------------------------------------------------------------------------
-- 10. Grants
-- ---------------------------------------------------------------------------
-- Service-only, exactly as before. No client role gains anything.

REVOKE ALL ON FUNCTION "public"."tournament_media_backend_fingerprint"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."tournament_media_capability_allowlist"("p_service" "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."tournament_media_worker_type_allowlist"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."tournament_media_attestation_rejection"("p_service" "text", "p_capabilities" "jsonb", "p_ttl_seconds" integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."attest_tournament_media_service"("p_service" "text", "p_release" "text", "p_capabilities" "jsonb", "p_ttl_seconds" integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."tournament_media_pipeline_readiness"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."tournament_media_require_pipeline_ready"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."enqueue_tournament_media_processing_job"("p_session_id" "uuid", "p_token" "text", "p_actor_user_id" "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."lease_tournament_media_processing_jobs"("p_worker_id" "text", "p_lease_seconds" integer, "p_limit" integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."complete_tournament_media_processing_job"("p_job_id" "uuid", "p_lease_token" "text", "p_asset_id" "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."fail_tournament_media_processing_job"("p_job_id" "uuid", "p_lease_token" "text", "p_failure_code" "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."cleanup_tournament_media_processing_jobs"("p_limit" integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."complete_tournament_media_upload_for_job"("p_job_id" "uuid", "p_lease_token" "text", "p_detected_mime" "text", "p_byte_size" bigint, "p_width" integer, "p_height" integer, "p_checksum_sha256" "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."authorize_tournament_media_upload_target"("p_session_id" "uuid", "p_token" "text", "p_actor_user_id" "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."finalize_tournament_media_variants"("p_asset_id" "uuid", "p_variants" "jsonb") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."complete_tournament_media_upload_for_actor"("p_actor_user_id" "uuid", "p_session_id" "uuid", "p_token" "text", "p_detected_mime" "text", "p_byte_size" bigint, "p_width" integer, "p_height" integer, "p_checksum_sha256" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."tournament_media_backend_fingerprint"() TO "service_role";
GRANT ALL ON FUNCTION "public"."tournament_media_capability_allowlist"("p_service" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."tournament_media_worker_type_allowlist"() TO "service_role";
GRANT ALL ON FUNCTION "public"."tournament_media_attestation_rejection"("p_service" "text", "p_capabilities" "jsonb", "p_ttl_seconds" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."attest_tournament_media_service"("p_service" "text", "p_release" "text", "p_capabilities" "jsonb", "p_ttl_seconds" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."tournament_media_pipeline_readiness"() TO "service_role";
GRANT ALL ON FUNCTION "public"."enqueue_tournament_media_processing_job"("p_session_id" "uuid", "p_token" "text", "p_actor_user_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."lease_tournament_media_processing_jobs"("p_worker_id" "text", "p_lease_seconds" integer, "p_limit" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."complete_tournament_media_processing_job"("p_job_id" "uuid", "p_lease_token" "text", "p_asset_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."fail_tournament_media_processing_job"("p_job_id" "uuid", "p_lease_token" "text", "p_failure_code" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."cleanup_tournament_media_processing_jobs"("p_limit" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."complete_tournament_media_upload_for_job"("p_job_id" "uuid", "p_lease_token" "text", "p_detected_mime" "text", "p_byte_size" bigint, "p_width" integer, "p_height" integer, "p_checksum_sha256" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."authorize_tournament_media_upload_target"("p_session_id" "uuid", "p_token" "text", "p_actor_user_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."finalize_tournament_media_variants"("p_asset_id" "uuid", "p_variants" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."complete_tournament_media_upload_for_actor"("p_actor_user_id" "uuid", "p_session_id" "uuid", "p_token" "text", "p_detected_mime" "text", "p_byte_size" bigint, "p_width" integer, "p_height" integer, "p_checksum_sha256" "text") TO "service_role";

-- `tournament_media_require_pipeline_ready` is an internal helper: it is called
-- from SECURITY DEFINER bodies and never over PostgREST.

COMMIT;
