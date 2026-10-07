-- Arma2 Torneos — MEDIA-V1: photo galleries of the hybrid composition, stored in the isolated Torneos project.
-- Applies after 00000000000000 … 00000000000011. Rollback (documented, never automatic):
-- backend/torneos/media-v1/rollback/00000000000012_media_gallery_v1.rollback.sql
--
-- Reuses the baseline's gallery domain as is: the 11 tables, galleries / upload sessions / moderation / consent /
-- reports, the MVP_SIMPLE tier (request_tournament_media_upload_session, complete_tournament_media_simple_upload,
-- authorize_tournament_media_read), the season quota of the plan catalog (enforce_tournament_media_gallery_limit:
-- FREE 25 / PREMIUM 1000 photos per season) and the per-matchday entitlement. Nothing here changes a limit.
--
-- What it adds is the one piece the hybrid composition lacked: a trusted writer that is not the browser and not a
-- service key. The browser never writes to the bucket and never completes an upload. The Torneos gateway
-- (torneos-gateway/media.ts) receives the normalized image, verifies its structure (magic bytes, full container walk,
-- no metadata carrier, orientation 1, real dimensions, SHA-256) and only then writes it and completes the session,
-- with a 120 s bridge token that carries `torneos_media_upload_session = <session id>`. Only the gateway can sign
-- that claim (it holds the bridge key ring); the client's own tokens never carry it. So:
--   * storage insert / delete on `tournament-media` require that claim for exactly the session's path;
--   * complete_tournament_media_gallery_upload requires it for exactly that session and passes the gateway's
--     verdict to the baseline's complete_tournament_media_simple_upload (asset in pending_review, never published);
--   * reads stay signed URLs (300 s) that storage RLS authorizes with the baseline's own authorize_tournament_media_read
--     for the caller's identity: staff of the organization, or a participant of a PUBLISHED gallery of a PUBLISHED
--     asset with internal consent and the gallery's audience. Retiring a photo (hide / revoke / archive) stops new
--     signatures at once. No anon policy: visitors read nothing.
--
-- The pipeline mode (public.tournament_media_pipeline_configuration) is NOT changed here. Activation is an explicit,
-- reversible operator step (backend/torneos/media-v1/ACTIVATION.md): MVP_SIMPLE + gateway TORNEOS_MEDIA_MODE=on +
-- frontend REACT_APP_TORNEOS_MEDIA_MODE=on.
BEGIN;

DO $pre$
BEGIN
  IF to_regprocedure('public.search_tournament_players(uuid,uuid,text,integer,uuid)') IS NULL THEN
    RAISE EXCEPTION 'TORNEOS_MEDIA_V1_PRECONDITION_FAILED: 00000000000011 is not in force';
  END IF;
  IF to_regprocedure('public.request_tournament_media_upload_session(uuid,text,text,bigint,uuid)') IS NULL
    OR to_regprocedure('public.complete_tournament_media_simple_upload(uuid,uuid,text,text,bigint,integer,integer,text,boolean)') IS NULL
    OR to_regprocedure('public.fail_tournament_media_upload_session(uuid,text)') IS NULL
    OR to_regprocedure('public.authorize_tournament_media_read(uuid,uuid,text)') IS NULL
    OR to_regprocedure('public.tournament_media_mvp_user_can_upload(uuid,uuid)') IS NULL
    OR to_regprocedure('public.tournament_media_effective_readiness()') IS NULL
    OR to_regprocedure('public.tournament_media_storage_contract_status()') IS NULL
    OR to_regprocedure('public.get_published_tournament_media(uuid,uuid,uuid,integer,integer)') IS NULL
    OR to_regprocedure('public.transition_tournament_media_asset(uuid,text,text)') IS NULL
    OR to_regprocedure('public.change_tournament_media_gallery_state(uuid,text,text)') IS NULL
    OR to_regprocedure('public.report_tournament_media_asset(uuid,text,text,boolean,uuid)') IS NULL
    OR to_regclass('public.tournament_media_upload_sessions') IS NULL
    OR to_regclass('public.tournament_media_pipeline_configuration') IS NULL THEN
    RAISE EXCEPTION 'TORNEOS_MEDIA_V1_PRECONDITION_FAILED: the baseline media domain is incomplete';
  END IF;
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'TORNEOS_MEDIA_V1_PRECONDITION_FAILED: the project has no Storage schema';
  END IF;
END $pre$;

-- ============================================================================================ the gateway claim

-- The upload session the gateway bound to THIS request, or null. Only for a valid bridge identity (same checks as
-- every RPC: private.current_identity_id()); a malformed value is null, never an error.
create or replace function private.tournament_media_gateway_session()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_claims jsonb := nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb;
  v_value text;
begin
  if private.current_identity_id() is null then
    return null;
  end if;
  v_value := v_claims->>'torneos_media_upload_session';
  if v_value is null or v_value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return v_value::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;
revoke all on function private.tournament_media_gateway_session() from public, anon, authenticated, service_role;

-- ============================================================================================ storage rules

-- The thumbnail of a photo: always a JPEG beside the normalized object, `<uuid>-thumbnail.jpg` (the variants path rule).
create or replace function public.tournament_media_thumbnail_path(p_internal_path text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_internal_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
    then pg_catalog.regexp_replace(p_internal_path, '\.(jpg|png|webp)$', '-thumbnail.jpg') end;
$$;

-- Write: exactly the photo (or its declared thumbnail) of the live MVP_SIMPLE session the gateway is completing, for its
-- requester, while the requester may still upload to that gallery and nothing occupies the path.
create or replace function public.can_write_tournament_media_gateway_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_identity_id() is not null and exists (
    select 1
    from public.tournament_media_upload_sessions session
    where session.id = private.tournament_media_gateway_session()
      and (session.internal_path = p_name
        or (session.quota_snapshot ? 'thumbnailBytes'
          and public.tournament_media_thumbnail_path(session.internal_path) = p_name))
      and session.bucket = 'tournament-media'
      and session.requested_by = private.current_identity_id()
      and session.status = 'issued'
      and session.expires_at > now()
      and session.processing_tier = 'mvp_simple'
      and public.tournament_media_mvp_user_can_upload(session.requested_by, session.gallery_id)
      and not exists (
        select 1 from public.tournament_media_assets asset where asset.internal_path = session.internal_path
      )
      and not exists (
        select 1 from public.tournament_media_variants variant where variant.internal_path = p_name
      )
  );
$$;

-- Delete: only the gateway undoing its OWN writes of a session that never became an asset (a completion that failed).
-- A photo that exists as an asset is never deleted here; retiring it is moderation (hide / revoke).
create or replace function public.can_delete_tournament_media_gateway_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_identity_id() is not null and exists (
    select 1
    from public.tournament_media_upload_sessions session
    where session.id = private.tournament_media_gateway_session()
      and p_name in (session.internal_path, public.tournament_media_thumbnail_path(session.internal_path))
      and session.bucket = 'tournament-media'
      and session.requested_by = private.current_identity_id()
      and session.status in ('issued', 'failed')
      and session.asset_id is null
      and not exists (
        select 1 from public.tournament_media_assets asset where asset.internal_path = session.internal_path
      )
  );
$$;

-- Read (and so sign): the baseline's own read authorization for the caller's identity, unchanged — for the photo and
-- for its thumbnail alike (a thumbnail is readable exactly when its photo is). Plus the gateway's own in-flight objects
-- of its session (storage returns the written / removed row).
create or replace function public.can_read_tournament_media_object(p_name text)
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

revoke all on function public.tournament_media_thumbnail_path(text) from public, anon;
revoke all on function public.can_write_tournament_media_gateway_object(text) from public, anon;
revoke all on function public.can_delete_tournament_media_gateway_object(text) from public, anon;
revoke all on function public.can_read_tournament_media_object(text) from public, anon;
grant execute on function public.tournament_media_thumbnail_path(text) to authenticated, service_role;
grant execute on function public.can_write_tournament_media_gateway_object(text) to authenticated, service_role;
grant execute on function public.can_delete_tournament_media_gateway_object(text) to authenticated, service_role;
grant execute on function public.can_read_tournament_media_object(text) to authenticated, service_role;

-- ============================================================================================ storage budget

-- Storage is shared: the Free plan's 1 GB is counted for the whole Supabase organization (Core's files included, which
-- this database cannot see), and inside the Torneos project logos, gallery photos and thumbnails share it. One
-- operator-owned singleton decides how much of it uploads may ever use, and how many uploads may be open at once
-- project-wide; begin_tournament_media_gallery_upload enforces both under one lock, BEFORE any byte is accepted.
-- Conservative defaults (Core's Storage measured at ~0.33 GB on 2026-10-07): Torneos project 450 MiB, gallery photos
-- + thumbnails 400 MiB (the rest of the project stays for logos), 12 simultaneous uploads. The operator sets them at
-- activation as (1 GB − Core's Storage − margin), never a client (ACTIVATION.md).
create table if not exists public.tournament_media_storage_budget (
  singleton boolean primary key default true,
  project_max_bytes bigint not null,
  gallery_max_bytes bigint not null,
  max_inflight_uploads integer not null,
  updated_at timestamptz not null default now(),
  constraint tournament_media_storage_budget_singleton_check check (singleton),
  constraint tournament_media_storage_budget_bytes_check check (
    project_max_bytes between 1048576 and 107374182400
    and gallery_max_bytes between 1048576 and project_max_bytes),
  constraint tournament_media_storage_budget_inflight_check check (max_inflight_uploads between 1 and 200)
);
alter table public.tournament_media_storage_budget enable row level security;
revoke all on table public.tournament_media_storage_budget from public, anon, authenticated;
insert into public.tournament_media_storage_budget (singleton, project_max_bytes, gallery_max_bytes, max_inflight_uploads)
values (true, 471859200, 419430400, 12)
on conflict (singleton) do nothing;

-- What is stored and pending against the budget, in bytes (no names, no paths). Operator / service only.
create or replace function public.tournament_media_storage_budget_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'projectMaxBytes', budget.project_max_bytes,
    'galleryMaxBytes', budget.gallery_max_bytes,
    'maxInflightUploads', budget.max_inflight_uploads,
    'projectStoredBytes', (select coalesce(sum((object.metadata->>'size')::bigint), 0) from storage.objects object),
    'galleryStoredBytes', (select coalesce(sum((object.metadata->>'size')::bigint), 0)
      from storage.objects object where object.bucket_id = 'tournament-media'),
    'brandingStoredBytes', (select coalesce(sum((object.metadata->>'size')::bigint), 0)
      from storage.objects object where object.bucket_id = 'tournament-branding'),
    'pendingBytes', (select coalesce(sum(session.requested_size
        + coalesce((session.quota_snapshot->>'thumbnailBytes')::bigint, 0)), 0)
      from public.tournament_media_upload_sessions session
      where session.status = 'issued' and session.expires_at > now()),
    'inflightUploads', (select count(*) from public.tournament_media_upload_sessions session
      where session.status = 'issued' and session.expires_at > now())
  )
  from public.tournament_media_storage_budget budget
  where budget.singleton;
$$;
revoke all on function public.tournament_media_storage_budget_status() from public, anon, authenticated;
grant execute on function public.tournament_media_storage_budget_status() to service_role;

-- The storage contract the readiness reads: the baseline's verifier, with ONE explicit exception — the two
-- gateway-claim write policies of this migration, by exact name, role and rule. Any other client write policy that
-- names the bucket still makes clientWriteBlocked false and closes uploads.
create or replace function public.tournament_media_storage_contract_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $_$
declare
  v_schema_present boolean := to_regclass('storage.buckets') is not null;
  v_bucket_present boolean := false;
  v_bucket_private boolean := false;
  v_public_url_disabled boolean := false;
  v_policy_names text[] := array[]::text[];
  v_write_open_to_clients boolean := false;
  v_gateway_policies text[] := array[]::text[];
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

    -- MEDIA-V1: the gateway-claim write rules, recognised only with their exact shape.
    execute $q$
      select coalesce(array_agg(policy.policyname::text order by policy.policyname), array[]::text[])
      from pg_policies policy
      where policy.schemaname = 'storage'
        and policy.tablename = 'objects'
        and policy.roles = array['authenticated']::name[]
        and (
          (policy.policyname = 'tournament_media_gateway_insert' and policy.cmd = 'INSERT'
            and policy.qual is null
            and policy.with_check ~ '^\(\(bucket_id = ''tournament-media''::text\) AND (public\.)?can_write_tournament_media_gateway_object\(name\)\)$')
          or (policy.policyname = 'tournament_media_gateway_delete' and policy.cmd = 'DELETE'
            and policy.with_check is null
            and policy.qual ~ '^\(\(bucket_id = ''tournament-media''::text\) AND (public\.)?can_delete_tournament_media_gateway_object\(name\)\)$')
        )
    $q$ into v_gateway_policies;

    -- Any other policy on storage.objects that names the bucket and is granted to a client role is a contract
    -- violation, whoever created it.
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
          and not (policy.policyname::text = any($1))
      )
    $q$ into v_write_open_to_clients using v_gateway_policies;
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
    'gatewayWritePolicies',to_jsonb(v_gateway_policies),
    'policies',to_jsonb(v_policy_names)
  );
end;
$_$;

-- The readiness the browser mirrors, unchanged except for ONE client-side number: the largest file a person may PICK
-- (MVP_SIMPLE and DISABLED: 8 MiB → 25 MiB). The picked file never leaves the device — it is decoded, oriented and
-- re-encoded to ≤ 1600 px / ≤ 4 MiB before anything is sent, and the gateway and the database enforce those. 8 MiB
-- refused ordinary 24 MP phone photos (iPhone 15/16 JPEG exports), so the limit protected nothing and failed people.
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
      'maxSelectedFileBytes',26214400,'maxFileBytes',4194304,
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
    'maxSelectedFileBytes',26214400,'maxFileBytes',4194304,
    'maxPixels',2560000,'maxEdge',1600,
    'maxBatchFiles',10,'maxConcurrentUploads',2,
    'signedUrlTtlSeconds',300,'allowHeicTranscode',false,
    'pixelTranscode',false,'antivirusScanning',false
  );
END;
$$;

-- ============================================================================================ gateway RPCs

-- Opens (or replays) the upload of ONE normalized photo (and its thumbnail) for the caller, through the baseline's
-- session RPC — same authorization, MVP_SIMPLE readiness, rate limit, file contract and season quota trigger — after the
-- project's storage budget and upload concurrency (tournament_media_storage_budget). A retry with the same idempotency
-- key never duplicates a photo:
--   * the key already produced an asset → `uploaded` with that asset (the first answer was lost, not the photo);
--   * the key has a live attempt younger than 45 s → TORNEOS_MEDIA_UPLOAD_IN_PROGRESS (a double tap);
--   * otherwise the baseline reuses the unwritten intent or retires it and issues a fresh one.
create or replace function public.begin_tournament_media_gallery_upload(
  p_gallery_id uuid, p_idempotency_key uuid, p_mime text, p_byte_size bigint, p_thumbnail_size bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity uuid := private.current_identity_id();
  v_organization_id uuid;
  v_last public.tournament_media_upload_sessions%rowtype;
  v_extension text;
  v_budget jsonb;
  v_incoming bigint;
  v_session jsonb;
  v_session_id uuid;
  v_path text;
begin
  if v_identity is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'TORNEOS_IDEMPOTENCY_REQUIRED';
  end if;
  v_extension := case p_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end;
  if v_extension is null or p_byte_size is null or p_byte_size < 1 or p_byte_size > 4194304
    or (p_thumbnail_size is not null and (p_thumbnail_size < 1 or p_thumbnail_size > 524288)) then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_FILE_INVALID';
  end if;
  select gallery.organization_id into v_organization_id
  from public.tournament_media_galleries gallery where gallery.id = p_gallery_id;
  if v_organization_id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  -- The baseline's actor lock: serializes this replay decision with its own emission.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_identity::text, 2));

  select * into v_last
  from public.tournament_media_upload_sessions session
  where session.organization_id = v_organization_id
    and session.requested_by = v_identity
    and session.idempotency_key = p_idempotency_key
  order by session.created_at desc, session.id desc
  limit 1;

  if v_last.id is not null then
    if v_last.gallery_id is distinct from p_gallery_id then
      raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_IDEMPOTENCY_CONFLICT';
    end if;
    if v_last.asset_id is not null then
      return jsonb_build_object(
        'state', 'uploaded', 'sessionId', v_last.id, 'assetId', v_last.asset_id,
        'status', (select asset.status from public.tournament_media_assets asset where asset.id = v_last.asset_id)
      );
    end if;
    if v_last.status = 'issued' and v_last.expires_at > now() and v_last.created_at > now() - interval '45 seconds' then
      raise exception using errcode = 'PT409', message = 'TORNEOS_MEDIA_UPLOAD_IN_PROGRESS';
    end if;
  end if;

  -- Project-wide: one budget decision at a time, so two uploads can never both take the last bytes.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tournament-media:storage-budget', 0));
  v_budget := public.tournament_media_storage_budget_status();
  if v_budget is null then
    raise exception using errcode = '55000', message = 'TORNEOS_MEDIA_PIPELINE_NOT_READY';
  end if;
  if (v_budget->>'inflightUploads')::integer >= (v_budget->>'maxInflightUploads')::integer then
    raise exception using errcode = 'P0001', message = 'TORNEOS_MEDIA_BUSY';
  end if;
  v_incoming := p_byte_size + coalesce(p_thumbnail_size, 0);
  if (v_budget->>'projectStoredBytes')::bigint + (v_budget->>'pendingBytes')::bigint + v_incoming
      > (v_budget->>'projectMaxBytes')::bigint
    or (v_budget->>'galleryStoredBytes')::bigint + (v_budget->>'pendingBytes')::bigint + v_incoming
      > (v_budget->>'galleryMaxBytes')::bigint then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_STORAGE_BUDGET_EXCEEDED';
  end if;

  v_session := public.request_tournament_media_upload_session(
    p_gallery_id, 'foto.' || v_extension, p_mime, p_byte_size, p_idempotency_key
  );
  v_session_id := (v_session->>'sessionId')::uuid;
  -- The thumbnail travels with the photo: its size is part of the session (budget, write rule, completion check).
  update public.tournament_media_upload_sessions session
  set quota_snapshot = case when p_thumbnail_size is null then session.quota_snapshot - 'thumbnailBytes'
    else session.quota_snapshot || jsonb_build_object('thumbnailBytes', p_thumbnail_size) end
  where session.id = v_session_id
  returning session.internal_path into v_path;
  return jsonb_build_object(
    'state', 'issued',
    'sessionId', v_session->'sessionId',
    'token', v_session->'token',
    'expiresAt', v_session->'expiresAt',
    'objectName', v_path,
    'thumbnailObjectName', case when p_thumbnail_size is null then null else public.tournament_media_thumbnail_path(v_path) end
  );
end;
$$;

-- Completes the session with the gateway's verdict. Callable only under the gateway claim for THIS session, and only
-- once the exact objects (photo and declared thumbnail) are in the bucket with the verified sizes. The asset is the
-- baseline's own completion; the thumbnail becomes its ready `thumbnail` variant.
create or replace function public.complete_tournament_media_gallery_upload(
  p_session_id uuid, p_token text, p_detected_mime text, p_byte_size bigint,
  p_width integer, p_height integer, p_checksum_sha256 text,
  p_thumbnail_size bigint, p_thumbnail_width integer, p_thumbnail_height integer, p_thumbnail_checksum text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity uuid := private.current_identity_id();
  v_session public.tournament_media_upload_sessions%rowtype;
  v_thumbnail_path text;
  v_declared bigint;
  v_result jsonb;
begin
  if v_identity is null or p_session_id is null
    or private.tournament_media_gateway_session() is distinct from p_session_id then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_GATEWAY_REQUIRED';
  end if;
  select * into v_session
  from public.tournament_media_upload_sessions session
  where session.id = p_session_id and session.requested_by = v_identity;
  if v_session.id is null or not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'tournament-media'
      and object.name = v_session.internal_path
      and (object.metadata->>'size')::bigint = p_byte_size
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_UPLOAD_SESSION_INVALID';
  end if;
  v_declared := (v_session.quota_snapshot->>'thumbnailBytes')::bigint;
  v_thumbnail_path := public.tournament_media_thumbnail_path(v_session.internal_path);
  -- The thumbnail is all-or-nothing and exactly what the session declared: same photo shape (±1 px of rounding),
  -- ≤ 640 px, and present in the bucket with the verified size.
  if (v_declared is null) <> (p_thumbnail_size is null)
    or (p_thumbnail_size is not null and (
      p_thumbnail_size <> v_declared
      or p_thumbnail_width is null or p_thumbnail_height is null
      or p_thumbnail_width not between 1 and 640 or p_thumbnail_height not between 1 and 640
      or abs(p_thumbnail_width::bigint * p_height - p_thumbnail_height::bigint * p_width) > greatest(p_width, p_height)
      or coalesce(p_thumbnail_checksum, '') !~ '^[0-9a-f]{64}$'
      or not exists (
        select 1 from storage.objects object
        where object.bucket_id = 'tournament-media'
          and object.name = v_thumbnail_path
          and (object.metadata->>'size')::bigint = p_thumbnail_size
      ))) then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_FILE_INVALID';
  end if;
  v_result := public.complete_tournament_media_simple_upload(
    v_identity, p_session_id, p_token, p_detected_mime, p_byte_size, p_width, p_height, p_checksum_sha256, true
  );
  if p_thumbnail_size is not null then
    insert into public.tournament_media_variants (
      organization_id, tournament_id, asset_id, kind, internal_path, detected_mime,
      byte_size, width, height, checksum_sha256, metadata_stripped, status
    ) values (
      v_session.organization_id, v_session.tournament_id, (v_result->>'assetId')::uuid, 'thumbnail', v_thumbnail_path,
      'image/jpeg', p_thumbnail_size, p_thumbnail_width, p_thumbnail_height, p_thumbnail_checksum, true, 'ready'
    );
  end if;
  return v_result || jsonb_build_object('thumbnail', p_thumbnail_size is not null);
end;
$$;

-- Records why the gateway refused or could not finish a session (frees its quota slot at once).
create or replace function public.fail_tournament_media_gallery_upload(p_session_id uuid, p_failure_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.current_identity_id() is null or p_session_id is null
    or private.tournament_media_gateway_session() is distinct from p_session_id
    or not exists (
      select 1 from public.tournament_media_upload_sessions session
      where session.id = p_session_id and session.requested_by = private.current_identity_id()
    ) then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_GATEWAY_REQUIRED';
  end if;
  return public.fail_tournament_media_upload_session(p_session_id, p_failure_code);
end;
$$;

-- The object names the CALLER may read, for at most 60 assets: the baseline's authorize_tournament_media_read per
-- asset for the caller's identity; a refused asset is simply absent. `thumbnail` and `grid` resolve to the photo's ready
-- thumbnail when it has one (the grid never downloads the full photo); `detail` is the photo. The gateway signs these
-- with the caller's token (storage RLS decides again); the names never leave the gateway.
create or replace function public.get_tournament_media_read_targets(p_asset_ids uuid[], p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_identity uuid := private.current_identity_id();
  v_asset_id uuid;
  v_target jsonb;
  v_object text;
  v_out jsonb := '[]'::jsonb;
begin
  if v_identity is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if p_asset_ids is null or cardinality(p_asset_ids) < 1 or cardinality(p_asset_ids) > 60
    or p_kind not in ('thumbnail', 'grid', 'detail') then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_FILTER_INVALID';
  end if;
  for v_asset_id in select distinct id from unnest(p_asset_ids) as id where id is not null loop
    begin
      v_target := public.authorize_tournament_media_read(v_identity, v_asset_id, p_kind);
      v_object := v_target->>'objectName';
      if p_kind in ('thumbnail', 'grid') then
        select coalesce(variant.internal_path, v_object) into v_object
        from (select 1) as one
        left join public.tournament_media_variants variant
          on variant.asset_id = v_asset_id and variant.kind = 'thumbnail' and variant.status = 'ready'
          and variant.bucket = 'tournament-media';
      end if;
      if v_target->>'bucket' = 'tournament-media' then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'assetId', v_asset_id, 'kind', p_kind, 'objectName', v_object
        ));
      end if;
    exception when insufficient_privilege or invalid_parameter_value then
      null;
    end;
  end loop;
  return v_out;
end;
$$;

revoke all on function public.begin_tournament_media_gallery_upload(uuid,uuid,text,bigint,bigint) from public, anon;
revoke all on function public.complete_tournament_media_gallery_upload(uuid,text,text,bigint,integer,integer,text,bigint,integer,integer,text) from public, anon;
revoke all on function public.fail_tournament_media_gallery_upload(uuid,text) from public, anon;
revoke all on function public.get_tournament_media_read_targets(uuid[],text) from public, anon;
grant execute on function public.begin_tournament_media_gallery_upload(uuid,uuid,text,bigint,bigint) to authenticated, service_role;
grant execute on function public.complete_tournament_media_gallery_upload(uuid,text,text,bigint,integer,integer,text,bigint,integer,integer,text) to authenticated, service_role;
grant execute on function public.fail_tournament_media_gallery_upload(uuid,text) to authenticated, service_role;
grant execute on function public.get_tournament_media_read_targets(uuid[],text) to authenticated, service_role;

-- ============================================================================================ participant delivery

-- The participant projection, unchanged except for `delivery`: under MVP_SIMPLE there is no signer attestation
-- (signerReady is null by contract) — the gateway signs — so a ready private bucket is what delivery needs.
create or replace function public.get_published_tournament_media(
  p_tournament_id uuid, p_category_id uuid default null::uuid, p_match_id uuid default null::uuid,
  p_limit integer default 20, p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_readiness jsonb := public.tournament_media_effective_readiness();
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
  v_delivery := jsonb_build_object(
    'status',case
      when coalesce((v_readiness->>'storageReady')::boolean,false)
        and (v_readiness->>'processingTier' = 'mvp_simple'
          or coalesce((v_readiness->>'signerReady')::boolean,false))
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

-- ============================================================================================ retiring content

-- The moderation and lifecycle RPCs the gallery needs, disabled for staging v1 (00000000000001) until a contract used
-- them: approve / reject / hide / restore / revoke a photo, archive / revoke a gallery, and the participant's private
-- report. Each keeps its own capability checks (media.review / media.revoke / media.archive, reporter = authorized
-- reader of a published asset). Tagging, consent management and photographer assignment stay disabled.
grant execute on function public.transition_tournament_media_asset(uuid,text,text) to authenticated;
grant execute on function public.change_tournament_media_gallery_state(uuid,text,text) to authenticated;
grant execute on function public.report_tournament_media_asset(uuid,text,text,boolean,uuid) to authenticated;

-- ============================================================================================ bucket + policies

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tournament-media', 'tournament-media', false, 4194304, array['image/jpeg', 'image/png', 'image/webp']::text[])
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists tournament_media_service_read on storage.objects;
drop policy if exists tournament_media_service_insert on storage.objects;
drop policy if exists tournament_media_service_update on storage.objects;
drop policy if exists tournament_media_service_delete on storage.objects;
drop policy if exists tournament_media_gateway_insert on storage.objects;
drop policy if exists tournament_media_gateway_delete on storage.objects;
drop policy if exists tournament_media_reader_select on storage.objects;
drop policy if exists tournament_media_client_update_denied on storage.objects;

-- The baseline's service contract (Core's canonical definitions): kept so the readiness verifier finds it. Nothing in
-- MEDIA-V1 uses a service key.
create policy tournament_media_service_read
on storage.objects for select
to service_role
using (bucket_id = 'tournament-media');

create policy tournament_media_service_insert
on storage.objects for insert
to service_role
with check (
  bucket_id = 'tournament-media'
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}(-(?:thumbnail|grid|detail|original))?\.(jpg|png|webp)$'
);

create policy tournament_media_service_update
on storage.objects for update
to service_role
using (false)
with check (false);

create policy tournament_media_service_delete
on storage.objects for delete
to service_role
using (false);

create policy tournament_media_gateway_insert
on storage.objects for insert
to authenticated
with check (bucket_id = 'tournament-media' and public.can_write_tournament_media_gateway_object(name));

create policy tournament_media_gateway_delete
on storage.objects for delete
to authenticated
using (bucket_id = 'tournament-media' and public.can_delete_tournament_media_gateway_object(name));

create policy tournament_media_reader_select
on storage.objects for select
to authenticated
using (bucket_id = 'tournament-media' and public.can_read_tournament_media_object(name));

-- Objects are immutable for every client.
create policy tournament_media_client_update_denied
on storage.objects for update
to authenticated
using (false)
with check (false);

-- ============================================================================================ postconditions
DO $post$
DECLARE
  v_storage jsonb := public.tournament_media_storage_contract_status();
BEGIN
  IF (select public from storage.buckets where id = 'tournament-media') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TORNEOS_MEDIA_V1_POSTCONDITION_FAILED: the media bucket must be private';
  END IF;
  IF (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'tournament_media_%') <> 8 THEN
    RAISE EXCEPTION 'TORNEOS_MEDIA_V1_POSTCONDITION_FAILED: media policies';
  END IF;
  IF public.tournament_media_storage_budget_status() IS NULL THEN
    RAISE EXCEPTION 'TORNEOS_MEDIA_V1_POSTCONDITION_FAILED: storage budget';
  END IF;
  IF (v_storage->>'servicePoliciesPresent')::boolean IS NOT TRUE
    OR (v_storage->>'clientWriteBlocked')::boolean IS NOT TRUE
    OR jsonb_array_length(v_storage->'gatewayWritePolicies') <> 2 THEN
    RAISE EXCEPTION 'TORNEOS_MEDIA_V1_POSTCONDITION_FAILED: storage contract %', v_storage;
  END IF;
  IF has_function_privilege('anon', 'public.begin_tournament_media_gallery_upload(uuid,uuid,text,bigint,bigint)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.complete_tournament_media_gallery_upload(uuid,text,text,bigint,integer,integer,text,bigint,integer,integer,text)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.get_tournament_media_read_targets(uuid[],text)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.can_read_tournament_media_object(text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'private.tournament_media_gateway_session()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.tournament_media_storage_budget_status()', 'EXECUTE')
    OR has_table_privilege('authenticated', 'public.tournament_media_storage_budget', 'SELECT') THEN
    RAISE EXCEPTION 'TORNEOS_MEDIA_V1_POSTCONDITION_FAILED: grants';
  END IF;
END $post$;

COMMIT;
