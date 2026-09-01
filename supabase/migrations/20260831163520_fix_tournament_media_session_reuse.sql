begin;

-- Upload-session idempotency is scoped to the current live attempt. Keeping
-- expired/failed rows is intentional: their object names remain available to
-- the cleanup worker, while a retry can receive a fresh path and credential.
alter table public.tournament_media_upload_sessions
  drop constraint tournament_media_upload_sessions_request_unique;

create unique index tournament_media_upload_sessions_live_request_unique
  on public.tournament_media_upload_sessions (
    organization_id, requested_by, idempotency_key
  )
  where status = 'issued';

create or replace function public.request_tournament_media_upload_session(
  p_gallery_id uuid, p_file_name text, p_declared_mime text,
  p_byte_size bigint, p_idempotency_key uuid
) returns jsonb
language plpgsql security definer
set search_path to ''
as $function$
declare
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
  v_max_file bigint;
  v_max_open integer;
  v_expires interval;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  v_tier := case v_mode
    when 'PROCESSOR_EXTERNAL' then 'processor_external'
    when 'MVP_SIMPLE' then 'mvp_simple'
    else null
  end;
  perform public.tournament_media_require_upload_tier(v_tier);

  select * into v_gallery from public.tournament_media_galleries
  where id = p_gallery_id;
  if v_gallery.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'TORNEOS_IDEMPOTENCY_REQUIRED';
  end if;

  -- The actor lock serializes both ordinary emissions and credential rotation.
  -- Organization/gallery locks preserve the existing quota and ownership
  -- decisions. No lock scope is widened by the recovery path.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(auth.uid()::text,2)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_gallery.organization_id::text,0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_gallery_id::text,1)
  );
  select * into v_gallery from public.tournament_media_galleries
  where id = p_gallery_id for share;
  if (v_tier = 'mvp_simple' and not public.tournament_media_mvp_user_can_upload(
      auth.uid(),p_gallery_id
    )) or (v_tier = 'processor_external' and not public.tournament_media_user_can_upload(
      auth.uid(),p_gallery_id
    ))
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  end if;

  v_max_file := case when v_tier = 'mvp_simple' then 4194304 else 12582912 end;
  v_max_open := case when v_tier = 'mvp_simple' then 10 else 40 end;
  v_expires := case when v_tier = 'mvp_simple' then interval '5 minutes'
    else interval '10 minutes' end;
  v_extension := case p_declared_mime
    when 'image/jpeg' then 'jpg' when 'image/png' then 'png'
    when 'image/webp' then 'webp' else null end;
  if v_extension is null or p_byte_size is null
    or p_byte_size < 1 or p_byte_size > v_max_file
    or not (
      (p_declared_mime = 'image/jpeg' and lower(p_file_name) ~ '\.(jpe?g)$')
      or (p_declared_mime = 'image/png' and lower(p_file_name) ~ '\.png$')
      or (p_declared_mime = 'image/webp' and lower(p_file_name) ~ '\.webp$')
    )
  then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_FILE_INVALID';
  end if;

  -- More than one historical attempt may now carry the same logical key. The
  -- newest row is authoritative; the partial unique index guarantees at most
  -- one live `issued` attempt for this actor/organization/key.
  select * into v_existing
  from public.tournament_media_upload_sessions session
  where session.organization_id = v_gallery.organization_id
    and session.requested_by = auth.uid()
    and session.idempotency_key = p_idempotency_key
  order by
    (session.status = 'issued' and session.expires_at > now()) desc,
    session.created_at desc,
    session.id desc
  limit 1
  for update;

  if v_existing.id is not null then
    if v_existing.gallery_id is distinct from p_gallery_id
      or v_existing.requested_mime is distinct from p_declared_mime
      or v_existing.requested_size is distinct from p_byte_size
      or v_existing.processing_tier is distinct from v_tier
      or right(v_existing.safe_name,char_length(v_extension) + 1)
        is distinct from '.' || v_extension
    then
      raise exception using errcode = '22023',
        message = 'TORNEOS_MEDIA_IDEMPOTENCY_CONFLICT';
    end if;

    -- A consumed request already completed its logical operation. Never
    -- resurrect it into a second upload or detach it from its asset.
    if v_existing.asset_id is not null or v_existing.consumed_at is not null then
      raise exception using errcode = '22023',
        message = 'TORNEOS_MEDIA_IDEMPOTENCY_CONFLICT';
    end if;

    -- A live assetless intent with an unused path is reusable. Rotate the
    -- credential because only its hash is persisted; returning NULL cannot
    -- prove that the caller still has a usable token.
    if v_existing.status = 'issued'
      and v_existing.expires_at > now()
      and v_existing.token_hash ~ '^[0-9a-f]{64}$'
      and not exists (
        select 1 from public.tournament_media_assets asset
        where asset.internal_path = v_existing.internal_path
      )
      and not exists (
        select 1 from storage.objects object
        where object.bucket_id = v_existing.bucket
          and object.name = v_existing.internal_path
      )
    then
      update public.tournament_media_upload_sessions
      set token_hash = encode(public.digest(v_token,'sha256'),'hex')
      where id = v_existing.id;
      return jsonb_build_object(
        'sessionId',v_existing.id,'safeName',v_existing.safe_name,
        'expiresAt',v_existing.expires_at,'token',v_token,'reused',true,
        'processingTier',v_existing.processing_tier,'uploadReady',true,
        'requiresStagingStorageSigner',false
      );
    end if;

    -- Preserve the old row/path for scoped cleanup. Only an outstanding issued
    -- row must be closed before the partial uniqueness rule permits a new
    -- attempt. A written-but-unfinalized object is failed rather than called
    -- expired so the audit state reflects why its path was abandoned.
    if v_existing.status = 'issued' then
      update public.tournament_media_upload_sessions
      set status = case
        when v_existing.expires_at <= now() then 'expired'
        else 'failed'
      end
      where id = v_existing.id;
    end if;
  end if;

  select
    coalesce((select sum(asset.byte_size) from public.tournament_media_assets asset
      where asset.organization_id = v_gallery.organization_id and asset.status <> 'revoked'),0)
    + coalesce((select sum(session.requested_size)
      from public.tournament_media_upload_sessions session
      where session.organization_id = v_gallery.organization_id
        and session.status = 'issued' and session.expires_at > now()),0)
  into v_org_bytes;
  select
    coalesce((select sum(asset.byte_size) from public.tournament_media_assets asset
      where asset.tournament_id = v_gallery.tournament_id and asset.status <> 'revoked'),0)
    + coalesce((select sum(session.requested_size)
      from public.tournament_media_upload_sessions session
      where session.tournament_id = v_gallery.tournament_id
        and session.status = 'issued' and session.expires_at > now()),0)
  into v_tournament_bytes;
  select
    coalesce((select sum(asset.byte_size) from public.tournament_media_assets asset
      where asset.gallery_id = p_gallery_id and asset.status <> 'revoked'),0)
    + coalesce((select sum(session.requested_size)
      from public.tournament_media_upload_sessions session
      where session.gallery_id = p_gallery_id
        and session.status = 'issued' and session.expires_at > now()),0)
  into v_gallery_bytes;
  select count(*) into v_open_sessions
  from public.tournament_media_upload_sessions session
  where session.requested_by = auth.uid() and session.status = 'issued'
    and session.expires_at > now();

  if v_tier = 'mvp_simple' then
    select count(*) into v_recent_emissions
    from public.tournament_media_upload_sessions session
    where session.requested_by = auth.uid()
      and session.created_at > now() - interval '15 minutes';
    if v_recent_emissions >= 30 then
      raise exception using errcode = 'P0001',
        message = 'TORNEOS_MEDIA_MVP_RATE_LIMITED';
    end if;
  end if;

  if v_open_sessions >= v_max_open then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_QUOTA_EXCEEDED';
  end if;

  v_safe_name := 'foto-' || substr(replace(v_file_id::text,'-',''),1,12)
    || '.' || v_extension;
  v_path := v_gallery.organization_id::text || '/' || v_gallery.tournament_id::text
    || '/' || v_gallery.id::text || '/' || v_file_id::text || '.' || v_extension;
  insert into public.tournament_media_upload_sessions (
    organization_id,tournament_id,gallery_id,requested_by,token_hash,
    internal_path,safe_name,requested_mime,requested_size,max_size,
    processing_tier,idempotency_key,quota_snapshot,expires_at
  ) values (
    v_gallery.organization_id,v_gallery.tournament_id,v_gallery.id,auth.uid(),
    encode(public.digest(v_token,'sha256'),'hex'),v_path,v_safe_name,
    p_declared_mime,p_byte_size,v_max_file,v_tier,p_idempotency_key,
    jsonb_build_object(
      'organizationBytes',v_org_bytes,'tournamentBytes',v_tournament_bytes,
      'galleryBytes',v_gallery_bytes,'maxFileBytes',v_max_file,
      'processingTier',v_tier
    ),now() + v_expires
  ) returning id into v_session_id;
  perform public.append_tournament_audit(
    v_gallery.organization_id,'media.upload_session.issued',
    'media_upload_session',v_session_id,null,v_gallery.tournament_id,
    jsonb_build_object(
      'galleryId',v_gallery.id,'byteSize',p_byte_size,'processingTier',v_tier,
      'replacesSessionId',v_existing.id
    )
  );
  return jsonb_build_object(
    'sessionId',v_session_id,'safeName',v_safe_name,
    'expiresAt',now() + v_expires,'token',v_token,'reused',false,
    'processingTier',v_tier,'uploadReady',true,
    'requiresStagingStorageSigner',false
  );
end;
$function$;

comment on function public.request_tournament_media_upload_session(
  uuid,text,text,bigint,uuid
) is
  'Issues or safely recredentials actor-bound upload sessions. Only live, assetless, unwritten intents are reused; invalid attempts remain available to scoped cleanup.';

commit;
