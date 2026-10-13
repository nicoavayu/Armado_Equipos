-- Arma2 Torneos — 0018 SEASON MEDIA LIFECYCLE: a season lasts at most six months from its explicit activation, and its
-- photos and thumbnails are removed when it ends (results, tables, history and shared logos stay).
-- Applies on POST_0017. Independent of 0013 (payments): it reads no commerce object and changes none.
-- Rollback (documented, never automatic, never brings deleted photos back):
--   backend/torneos/season-lifecycle/rollback/00000000000018_season_media_lifecycle.rollback.sql
-- Semantics and decisions: docs/torneos/commercial-season/INVENTARIO-Y-SEMANTICA.md (S1–S7).
--
-- What it adds or changes, and nothing else:
--   * tournament_seasons.activated_at / media_deadline_at / activation_basis. media_deadline_at is THE moment the season's
--     photos and thumbnails are removed: activated_at + 6 months on the Buenos Aires calendar (draft → active, basis
--     'explicit'), or the moment of a confirmed early close. Every season that is not a draft when this runs — active,
--     completed or archived — gets activated_at = this migration (basis 'migration_0018') and six full months: an already
--     closed season stays closed to uploads, but keeps its photos readable and downloadable until that announced date,
--     and the 7d / 1d notices reach it too (no surprise deletion of history; Nico 2026-10-12, Codex review). Buying
--     Premium never moves the date (no commerce code touches it).
--   * update_tournament_season gains p_confirm_media_deletion (default false; same name, same ACL): finishing a season
--     before its deadline requires it, and finishing or archiving marks the season's photos for removal.
--   * Photos of a closed season (completed, archived, or past its deadline even if no job ran yet) are no longer
--     uploaded (enforce_tournament_media_gallery_limit) or signed (can_read_tournament_media_object).
--   * PREMIUM: 100 photos per season (was 1000). FREE stays 25. Product capability label follows.
--   * MVP_SIMPLE upload sessions: photo and thumbnail at most 500 000 bytes each.
--   * The global storage ceiling is 0012's tournament_media_storage_budget (project / gallery bytes, uploads in flight),
--     unchanged: removing a closed season's objects frees room in it.
--   * Inbox notices 'season.media_deletion_7d' / 'season.media_deletion_1d' (audience organization, one per tournament
--     with photos and recipient, never twice), to the members who can review the season's tournaments.
--   * Service RPCs (service_role only): run_tournament_season_media_lifecycle (close expired seasons, notify, mark),
--     claim_tournament_media_purge / complete_tournament_media_purge (the torneos-media-store function removes the
--     objects in between; logos live in another bucket and are never listed).
--   * seasonLifecycle in get_effective_tournament_season_entitlements and get_tournament_season_media_usage, so Mi plan
--     and Multimedia show the date before paying or uploading.
-- Every replaced body is pinned by md5 before and after. ACL, owner, SECURITY DEFINER and search_path are those of
-- CREATE OR REPLACE except update_tournament_season (new signature: dropped and re-created with the same grants).
BEGIN;

-- ============================================================================================ 1. preconditions
DO $pre$
DECLARE
  v_md5 text;
BEGIN
  IF to_regprocedure('public.authorize_tournament_storage_objects(text,text,text[])') IS NULL THEN
    RAISE EXCEPTION 'TORNEOS_0018_PRECONDITION_FAILED: 00000000000017 is not in force';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tournament_seasons'
             AND column_name IN ('activated_at', 'media_deadline_at', 'activation_basis'))
    OR to_regprocedure('public.run_tournament_season_media_lifecycle()') IS NOT NULL THEN
    RAISE EXCEPTION 'TORNEOS_0018_PRECONDITION_FAILED: already applied';
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.enforce_tournament_media_gallery_limit()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '4c985973a92c677919703bbfc0bfbca2' THEN
    RAISE EXCEPTION 'TORNEOS_0018_PRECONDITION_FAILED: enforce_tournament_media_gallery_limit is not the expected body (%)', v_md5;
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc
  WHERE oid = 'public.update_tournament_season(uuid,uuid,text,text,date,date,text,boolean,boolean)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '3e6a6f6a5fa220ec1b83471b128eed62' THEN
    RAISE EXCEPTION 'TORNEOS_0018_PRECONDITION_FAILED: update_tournament_season is not the expected body (%)', v_md5;
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.can_read_tournament_media_object(text)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '5316ae2ddb16f714071d43dc76b5c704' THEN
    RAISE EXCEPTION 'TORNEOS_0018_PRECONDITION_FAILED: can_read_tournament_media_object is not the expected body (%)', v_md5;
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.get_tournament_season_media_usage(uuid,uuid)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '27bd920bcb72052296f31016dcd4cc97' THEN
    RAISE EXCEPTION 'TORNEOS_0018_PRECONDITION_FAILED: get_tournament_season_media_usage is not the expected body (%)', v_md5;
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.get_effective_tournament_season_entitlements(uuid,uuid)'::regprocedure;
  IF v_md5 IS DISTINCT FROM 'bf263acafb185ee0993117d5805bc701' THEN
    RAISE EXCEPTION 'TORNEOS_0018_PRECONDITION_FAILED: get_effective_tournament_season_entitlements is not the 0007 body (%)', v_md5;
  END IF;
  IF (SELECT gallery_asset_limit FROM public.tournament_plan_catalog WHERE plan_code = 'FREE') IS DISTINCT FROM 25
    OR (SELECT gallery_asset_limit FROM public.tournament_plan_catalog WHERE plan_code = 'PREMIUM') IS DISTINCT FROM 1000 THEN
    RAISE EXCEPTION 'TORNEOS_0018_PRECONDITION_FAILED: the plan catalog is not FREE 25 / PREMIUM 1000';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
      WHERE conrelid = 'public.tournament_user_notifications'::regclass AND conname = 'tournament_user_notifications_kind_check')
    IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''registration.submitted''::text, ''registration.received''::text, ''registration.approved''::text, ''registration.changes_requested''::text, ''registration.rejected''::text, ''match.rescheduled''::text, ''match.postponed''::text])))'
  THEN
    RAISE EXCEPTION 'TORNEOS_0018_PRECONDITION_FAILED: the notification kinds are not the 0016 ones';
  END IF;
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'TORNEOS_0018_PRECONDITION_FAILED: the project has no Storage schema';
  END IF;
END $pre$;

-- ============================================================================================ 2. season activation
ALTER TABLE public.tournament_seasons
  ADD COLUMN activated_at timestamptz,
  ADD COLUMN media_deadline_at timestamptz,
  ADD COLUMN activation_basis text;

-- Six calendar months on the Buenos Aires wall clock: activated on 15/03 at 20:00 → deadline 15/09 at 20:00 (local).
create function private.tournament_season_media_deadline(p_activated_at timestamptz)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select ((p_activated_at at time zone 'America/Argentina/Buenos_Aires') + interval '6 months')
    at time zone 'America/Argentina/Buenos_Aires';
$$;
revoke all on function private.tournament_season_media_deadline(timestamptz) from public, anon, authenticated, service_role;

-- Seasons already past their draft get six months from now (their real activation moment was never recorded).
UPDATE public.tournament_seasons
SET activated_at = now(), activation_basis = 'migration_0018',
    media_deadline_at = private.tournament_season_media_deadline(now())
WHERE status <> 'draft';

ALTER TABLE public.tournament_seasons
  ADD CONSTRAINT tournament_seasons_activation_shape_check CHECK (
    (activated_at IS NULL AND media_deadline_at IS NULL AND activation_basis IS NULL)
    OR (activated_at IS NOT NULL AND media_deadline_at >= activated_at
        AND activation_basis IN ('explicit', 'migration_0018'))
  ),
  -- A draft was never activated; an active or completed season always was. An archived one may have been either.
  ADD CONSTRAINT tournament_seasons_activation_status_check CHECK (
    (status <> 'draft' OR activated_at IS NULL) AND (status NOT IN ('active', 'completed') OR activated_at IS NOT NULL)
  );
COMMENT ON COLUMN public.tournament_seasons.activated_at IS
  'Explicit draft → active moment (basis explicit), or the moment 0018 ran for seasons that were already past draft (basis migration_0018). Never edited by any RPC.';
COMMENT ON COLUMN public.tournament_seasons.media_deadline_at IS
  'activated_at + 6 months (Buenos Aires calendar). At this moment the season closes and its photos and thumbnails are removed. Purchases never move it.';

-- Open for photos: a draft, or an active season before its deadline.
create function private.tournament_season_media_open(p_organization_id uuid, p_season_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tournament_seasons season
    where season.organization_id = p_organization_id and season.id = p_season_id
      and season.status in ('draft', 'active')
      and (season.media_deadline_at is null or season.media_deadline_at > now())
  );
$$;
revoke all on function private.tournament_season_media_open(uuid, uuid) from public, anon, authenticated, service_role;

-- Readable (and downloadable) until the announced deletion moment, whatever the status: an already closed season keeps
-- its photos until its date; a draft (no date) is readable.
create function private.tournament_season_media_readable(p_organization_id uuid, p_season_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tournament_seasons season
    where season.organization_id = p_organization_id and season.id = p_season_id
      and (season.media_deadline_at is null or season.media_deadline_at > now())
  );
$$;
revoke all on function private.tournament_season_media_readable(uuid, uuid) from public, anon, authenticated, service_role;

-- The lifecycle the clients show (Mi plan before paying, Multimedia before uploading).
create function private.tournament_season_lifecycle_json(p_organization_id uuid, p_season_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', season.status,
    'activatedAt', season.activated_at,
    'activationBasis', season.activation_basis,
    'mediaDeadlineAt', season.media_deadline_at,
    'mediaOpen', private.tournament_season_media_open(season.organization_id, season.id),
    'mediaReadable', private.tournament_season_media_readable(season.organization_id, season.id),
    'maxMonths', 6,
    'photosPendingDeletion', (
      select count(*) from public.tournament_media_assets asset
      join public.tournaments tournament
        on tournament.organization_id = asset.organization_id and tournament.id = asset.tournament_id
      where asset.organization_id = season.organization_id and tournament.season_id = season.id
        and asset.storage_state = 'retention_marked' and asset.retention_reason like 'SEASON_ENDED:%'
    )
  )
  from public.tournament_seasons season
  where season.organization_id = p_organization_id and season.id = p_season_id;
$$;
revoke all on function private.tournament_season_lifecycle_json(uuid, uuid) from public, anon, authenticated, service_role;

-- Marks every photo of the season still in storage for removal (the purge worker removes the objects). Idempotent.
create function private.mark_tournament_season_media_for_deletion(p_organization_id uuid, p_season_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_marked integer;
begin
  update public.tournament_media_assets asset
  set storage_state = 'retention_marked', retention_marked_at = now(),
      retention_reason = 'SEASON_ENDED:' || p_season_id::text, updated_at = now()
  from public.tournaments tournament
  where tournament.organization_id = asset.organization_id and tournament.id = asset.tournament_id
    and tournament.season_id = p_season_id and asset.organization_id = p_organization_id
    and asset.storage_state = 'active';
  get diagnostics v_marked = row_count;
  -- Sessions in flight for the season can no longer complete into an asset.
  update public.tournament_media_upload_sessions session
  set status = 'revoked'
  from public.tournaments tournament
  where tournament.organization_id = session.organization_id and tournament.id = session.tournament_id
    and tournament.season_id = p_season_id and session.organization_id = p_organization_id
    and session.status in ('issued', 'uploaded');
  return v_marked;
end;
$$;
revoke all on function private.mark_tournament_season_media_for_deletion(uuid, uuid) from public, anon, authenticated, service_role;

-- ============================================================================================ 3. update_tournament_season
DROP FUNCTION public.update_tournament_season(uuid, uuid, text, text, date, date, text, boolean, boolean);
CREATE FUNCTION public.update_tournament_season(p_organization_id uuid, p_season_id uuid, p_name text DEFAULT NULL::text, p_slug text DEFAULT NULL::text, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date, p_status text DEFAULT NULL::text, p_clear_start_date boolean DEFAULT false, p_clear_end_date boolean DEFAULT false, p_confirm_media_deletion boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_season public.tournament_seasons%rowtype;
  v_name text; v_slug text; v_start_date date; v_end_date date;
  v_marked integer := 0;
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
  -- Finishing before the deadline removes the photos early: the organizer has to say so explicitly.
  if p_status = 'completed' and v_season.media_deadline_at > now() and not coalesce(p_confirm_media_deletion, false) then
    raise exception using errcode = '22023', message = 'TORNEOS_SEASON_MEDIA_DELETION_CONFIRMATION_REQUIRED';
  end if;
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
      archived_at=case when p_status='archived' then now() else archived_at end,
      activated_at=case when p_status='active' then now() else activated_at end,
      activation_basis=case when p_status='active' then 'explicit' else activation_basis end,
      media_deadline_at=case when p_status='active' then private.tournament_season_media_deadline(now())
        when p_status='completed' and media_deadline_at > now() then now() else media_deadline_at end
    where id=p_season_id returning * into v_season;
  exception when unique_violation then
    raise exception using errcode='23505',message='TORNEOS_SEASON_SLUG_TAKEN';
  end;
  -- Photos go only at the announced moment (or a confirmed early close, which made it now): archiving a season closed
  -- before 0018 keeps its photos until its date.
  if v_season.media_deadline_at is not null and v_season.media_deadline_at <= now() then
    v_marked := private.mark_tournament_season_media_for_deletion(p_organization_id, p_season_id);
  end if;
  if p_status in ('active','completed') then
    perform public.append_tournament_audit(
      p_organization_id, 'season.' || p_status, 'season', p_season_id, null, null,
      jsonb_build_object('mediaDeadlineAt', v_season.media_deadline_at, 'photosMarkedForDeletion', v_marked,
        'confirmedMediaDeletion', coalesce(p_confirm_media_deletion, false))
    );
  end if;
  if v_season.status='archived' then
    update public.user_tournament_context_preferences set active_season_id=null,active_tournament_id=null
    where organization_id=p_organization_id and active_season_id=p_season_id;
  end if;
  return jsonb_build_object('id',v_season.id,'organizationId',v_season.organization_id,
    'name',v_season.name,'slug',v_season.slug,'status',v_season.status,
    'startDate',v_season.start_date,'endDate',v_season.end_date,
    'createdAt',v_season.created_at,'updatedAt',v_season.updated_at,
    'activatedAt',v_season.activated_at,'mediaDeadlineAt',v_season.media_deadline_at,
    'activationBasis',v_season.activation_basis,'photosMarkedForDeletion',v_marked);
end;
$$;
REVOKE ALL ON FUNCTION public.update_tournament_season(uuid, uuid, text, text, date, date, text, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT ALL ON FUNCTION public.update_tournament_season(uuid, uuid, text, text, date, date, text, boolean, boolean, boolean) TO service_role;
GRANT ALL ON FUNCTION public.update_tournament_season(uuid, uuid, text, text, date, date, text, boolean, boolean, boolean) TO authenticated;

-- ============================================================================================ 4. catalog and limits
UPDATE public.tournament_plan_catalog SET gallery_asset_limit = 100, updated_at = now() WHERE plan_code = 'PREMIUM';
COMMENT ON TABLE public.tournament_plan_catalog IS
  'Authoritative FREE/PREMIUM limits per tournament_seasons.id: photos 25/100 (0018), collaborators 1/10, optional branding only in PREMIUM.';
UPDATE public.tournament_commercial_products
SET public_capabilities = (
  select jsonb_agg(
    case when element->>'code' = 'media.season_1000'
      then jsonb_build_object('code', 'media.season_100', 'label', 'Hasta 100 fotos por temporada',
        'availability', element->>'availability')
      else element end
    order by position)
  from jsonb_array_elements(public_capabilities) with ordinality as item(element, position)
), updated_at = now()
WHERE product_code = 'torneos_premium'
  AND public_capabilities @> '[{"code": "media.season_1000"}]'::jsonb;

-- ============================================================================================ 5. upload guard
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
  -- 0018: a closed season (completed, archived, past its deadline) takes no more photos. The season row is held FOR
  -- SHARE first, so a close (FOR UPDATE) either waits for this session to commit — and then revokes it with the others —
  -- or commits first and this check sees it closed. Lock order everywhere: season row, then the advisory locks.
  perform 1 from public.tournament_seasons season
  where season.organization_id = new.organization_id and season.id = v_season_id for share;
  if not private.tournament_season_media_open(new.organization_id, v_season_id) then
    raise exception using errcode='22023',message='TORNEOS_SEASON_MEDIA_CLOSED';
  end if;
  -- 0018: at most 500 000 bytes for the optimized photo (the thumbnail's 500 000 is enforced by the gateway and the
  -- torneos-media-store function, which verify its real bytes; 0012 records its size after this insert).
  if new.processing_tier = 'mvp_simple' and new.requested_size > 500000 then
    raise exception using errcode='22023',message='TORNEOS_MEDIA_FILE_TOO_LARGE';
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

-- ============================================================================================ 6. read guard
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
  v_organization_id uuid;
  v_season_id uuid;
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
  -- 0018: nothing is signed after the season's deletion moment (not even for its staff), nor a photo marked for removal.
  select asset.organization_id, tournament.season_id into v_organization_id, v_season_id
  from public.tournament_media_assets asset
  join public.tournaments tournament
    on tournament.organization_id = asset.organization_id and tournament.id = asset.tournament_id
  where asset.id = v_asset_id and asset.storage_state = 'active';
  if v_season_id is null or not private.tournament_season_media_readable(v_organization_id, v_season_id) then
    return false;
  end if;
  perform public.authorize_tournament_media_read(v_identity, v_asset_id, 'detail');
  return true;
exception when insufficient_privilege or invalid_parameter_value then
  return false;
end;
$$;

-- ============================================================================================ 7. lifecycle in the reads
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
    'remaining',greatest(v_limit-v_assets-v_pending,0),
    'seasonLifecycle',private.tournament_season_lifecycle_json(p_organization_id,p_season_id));
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
  return jsonb_set(v_result,'{administration,currentAdministrativeSeatUsage}',to_jsonb(v_usage),true)
    || jsonb_build_object('seasonLifecycle',private.tournament_season_lifecycle_json(p_organization_id,p_season_id));
end;
$$;

-- ============================================================================================ 8. notices
ALTER TABLE public.tournament_user_notifications
  ADD COLUMN season_id uuid,
  ADD COLUMN media_deadline_at timestamptz,
  DROP CONSTRAINT tournament_user_notifications_kind_check,
  ADD CONSTRAINT tournament_user_notifications_kind_check CHECK (kind IN (
    'registration.submitted', 'registration.received', 'registration.approved',
    'registration.changes_requested', 'registration.rejected', 'match.rescheduled', 'match.postponed',
    'season.media_deletion_7d', 'season.media_deletion_1d'
  )),
  ADD CONSTRAINT tournament_user_notifications_season_shape_check CHECK (
    (kind IN ('season.media_deletion_7d', 'season.media_deletion_1d')) = (
      season_id IS NOT NULL AND media_deadline_at IS NOT NULL AND audience = 'organization'
      AND team_entry_id IS NULL AND message IS NULL
    )
  );
CREATE UNIQUE INDEX tournament_user_notifications_season_media_key
  ON public.tournament_user_notifications (season_id, tournament_id, kind, recipient_user_id)
  WHERE season_id IS NOT NULL;

create function private.notify_tournament_season_media_deletion()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_sent integer;
begin
  with due as (
    select season.organization_id, season.id season_id, season.name season_name, season.media_deadline_at,
      case when now() >= season.media_deadline_at - interval '1 day' then 'season.media_deletion_1d'
           else 'season.media_deletion_7d' end kind
    from public.tournament_seasons season
    where season.media_deadline_at > now()
      and now() >= season.media_deadline_at - interval '7 days'
  ),
  with_photos as (
    select distinct due.*, tournament.id tournament_id, tournament.name tournament_name
    from due
    join public.tournaments tournament
      on tournament.organization_id = due.organization_id and tournament.season_id = due.season_id
    where exists (
      select 1 from public.tournament_media_assets asset
      where asset.organization_id = tournament.organization_id and asset.tournament_id = tournament.id
        and asset.storage_state = 'active' and asset.status not in ('rejected','revoked','failed')
    )
  ),
  recipients as (
    select with_photos.*, membership.user_id recipient_user_id
    from with_photos
    join public.tournament_organization_members membership
      on membership.organization_id = with_photos.organization_id and membership.status = 'active'
    join public.tournament_organizations organization
      on organization.id = membership.organization_id and organization.status = 'active'
    where 'team_entries.review' = any(public.tournament_role_capabilities(membership.role))
      and (membership.role = 'owner' or exists (
        select 1 from public.tournament_season_member_assignments assignment
        where assignment.organization_id = with_photos.organization_id
          and assignment.season_id = with_photos.season_id and assignment.membership_id = membership.id))
  )
  insert into public.tournament_user_notifications (
    recipient_user_id, organization_id, tournament_id, audience, kind, title, body, season_id, media_deadline_at
  )
  select recipients.recipient_user_id, recipients.organization_id, recipients.tournament_id, 'organization', recipients.kind,
    case recipients.kind when 'season.media_deletion_1d' then 'Las fotos se eliminan mañana'
      else 'Las fotos se eliminan en 7 días' end,
    left(recipients.tournament_name || ' · ' || recipients.season_name || ': las fotos y miniaturas se eliminan el '
      || to_char(recipients.media_deadline_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY "a las" HH24:MI')
      || '. Descargá las que quieras conservar desde Multimedia. Los resultados, tablas e historial se conservan.', 500),
    recipients.season_id, recipients.media_deadline_at
  from recipients
  on conflict (season_id, tournament_id, kind, recipient_user_id) where season_id is not null do nothing;
  get diagnostics v_sent = row_count;
  return v_sent;
end;
$$;
revoke all on function private.notify_tournament_season_media_deletion() from public, anon, authenticated, service_role;

-- ============================================================================================ 9. service: lifecycle + purge
ALTER TABLE public.tournament_media_assets ADD COLUMN purge_claimed_until timestamptz;

-- Idempotent and safe to run at any frequency: closes the seasons past their deadline, sends the due notices and makes
-- sure every closed season's photos are marked. It removes nothing: the purge does.
create function public.run_tournament_season_media_lifecycle()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_season record;
  v_closed integer := 0;
  v_marked integer := 0;
  v_sent integer;
begin
  for v_season in
    select season.* from public.tournament_seasons season
    where season.status = 'active' and season.media_deadline_at <= now()
    order by season.media_deadline_at
    for update skip locked
  loop
    update public.tournament_seasons set status = 'completed' where id = v_season.id;
    v_marked := v_marked + private.mark_tournament_season_media_for_deletion(v_season.organization_id, v_season.id);
    insert into public.tournament_audit_log (
      organization_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata
    ) values (
      v_season.organization_id, null, 'system', 'season.completed_by_deadline', 'season', v_season.id,
      jsonb_build_object('mediaDeadlineAt', v_season.media_deadline_at)
    );
    v_closed := v_closed + 1;
  end loop;
  for v_season in
    select season.organization_id, season.id from public.tournament_seasons season
    where season.media_deadline_at <= now() and exists (
      select 1 from public.tournament_media_assets asset join public.tournaments tournament
        on tournament.organization_id = asset.organization_id and tournament.id = asset.tournament_id
      where tournament.season_id = season.id and asset.organization_id = season.organization_id
        and asset.storage_state = 'active')
  loop
    v_marked := v_marked + private.mark_tournament_season_media_for_deletion(v_season.organization_id, v_season.id);
  end loop;
  v_sent := private.notify_tournament_season_media_deletion();
  return jsonb_build_object('seasonsClosed', v_closed, 'photosMarked', v_marked, 'noticesSent', v_sent,
    'pendingPurge', (select count(*) from public.tournament_media_assets
                     where storage_state = 'retention_marked' and retention_reason like 'SEASON_ENDED:%'));
end;
$$;
revoke all on function public.run_tournament_season_media_lifecycle() from public, anon, authenticated;
grant execute on function public.run_tournament_season_media_lifecycle() to service_role;

-- A batch of photos to remove (photo, thumbnail and any processor variant), leased for five minutes so two workers never
-- take the same one, plus orphaned objects of closed seasons (in the media bucket, matching no live asset or session).
create function public.claim_tournament_media_purge(p_limit integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_assets jsonb;
  v_orphans jsonb;
begin
  with picked as (
    select asset.id from public.tournament_media_assets asset
    where asset.storage_state = 'retention_marked' and asset.retention_reason like 'SEASON_ENDED:%'
      and (asset.purge_claimed_until is null or asset.purge_claimed_until < now())
    order by asset.retention_marked_at, asset.id
    limit v_limit
    for update skip locked
  ),
  leased as (
    update public.tournament_media_assets asset set purge_claimed_until = now() + interval '5 minutes'
    from picked where asset.id = picked.id
    returning asset.id, asset.internal_path
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'assetId', leased.id,
    'names', (select jsonb_agg(distinct name) from (
      select leased.internal_path name
      union all select public.tournament_media_thumbnail_path(leased.internal_path)
      union all select variant.internal_path from public.tournament_media_variants variant
        where variant.asset_id = leased.id and variant.bucket = 'tournament-media'
    ) names where name is not null)
  ) order by leased.id), '[]'::jsonb) into v_assets
  from leased;
  select coalesce(jsonb_agg(object.name order by object.name), '[]'::jsonb) into v_orphans
  from (
    select object.name from storage.objects object
    join public.tournaments tournament on object.name like tournament.organization_id::text || '/' || tournament.id::text || '/%'
    join public.tournament_seasons season
      on season.organization_id = tournament.organization_id and season.id = tournament.season_id
    where object.bucket_id = 'tournament-media'
      and not private.tournament_season_media_open(season.organization_id, season.id)
      and not exists (select 1 from public.tournament_media_assets asset
        where asset.storage_state <> 'storage_purged'
          and object.name in (asset.internal_path, public.tournament_media_thumbnail_path(asset.internal_path)))
      and not exists (select 1 from public.tournament_media_variants variant
        join public.tournament_media_assets asset on asset.id = variant.asset_id
        where variant.internal_path = object.name and asset.storage_state <> 'storage_purged')
    order by object.name
    limit v_limit
  ) object;
  return jsonb_build_object('assets', v_assets, 'orphans', v_orphans);
end;
$$;
revoke all on function public.claim_tournament_media_purge(integer) from public, anon, authenticated;
grant execute on function public.claim_tournament_media_purge(integer) to service_role;

-- After the worker removed (or found absent) every object of the asset. Idempotent: an asset already purged answers so.
create function public.complete_tournament_media_purge(p_asset_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_asset public.tournament_media_assets%rowtype;
begin
  select * into v_asset from public.tournament_media_assets where id = p_asset_id for update;
  if v_asset.id is null then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_PURGE_INVALID';
  end if;
  if v_asset.storage_state = 'storage_purged' then
    return jsonb_build_object('assetId', p_asset_id, 'purged', true, 'idempotentReplay', true);
  end if;
  if v_asset.storage_state <> 'retention_marked' or v_asset.retention_reason not like 'SEASON_ENDED:%' then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_PURGE_INVALID';
  end if;
  update public.tournament_media_assets
  set storage_state = 'storage_purged', storage_purged_at = now(), purge_claimed_until = null, updated_at = now()
  where id = p_asset_id;
  return jsonb_build_object('assetId', p_asset_id, 'purged', true, 'idempotentReplay', false);
end;
$$;
revoke all on function public.complete_tournament_media_purge(uuid) from public, anon, authenticated;
grant execute on function public.complete_tournament_media_purge(uuid) to service_role;

-- ============================================================================================ 10. postconditions
DO $post$
DECLARE
  v_md5 text;
  v_fn text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.update_tournament_season(uuid,uuid,text,text,date,date,text,boolean,boolean,boolean)'::regprocedure;
  IF v_md5 IS NULL OR to_regprocedure('public.update_tournament_season(uuid,uuid,text,text,date,date,text,boolean,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'TORNEOS_0018_POSTCONDITION_FAILED: update_tournament_season signature';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.update_tournament_season(uuid,uuid,text,text,date,date,text,boolean,boolean,boolean)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.update_tournament_season(uuid,uuid,text,text,date,date,text,boolean,boolean,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TORNEOS_0018_POSTCONDITION_FAILED: update_tournament_season grants';
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.enforce_tournament_media_gallery_limit()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '5623a9fae3d4313c732951d3a6dafc0f' THEN
    RAISE EXCEPTION 'TORNEOS_0018_POSTCONDITION_FAILED: enforce_tournament_media_gallery_limit is not the 0018 body (%)', v_md5;
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.update_tournament_season(uuid,uuid,text,text,date,date,text,boolean,boolean,boolean)'::regprocedure;
  IF v_md5 IS DISTINCT FROM 'e3d3be4f2e6aed2cb85c34d1548dd64b' THEN
    RAISE EXCEPTION 'TORNEOS_0018_POSTCONDITION_FAILED: update_tournament_season is not the 0018 body (%)', v_md5;
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.can_read_tournament_media_object(text)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '91a0b405d7e19f6099f6ba643ef88642' THEN
    RAISE EXCEPTION 'TORNEOS_0018_POSTCONDITION_FAILED: can_read_tournament_media_object is not the 0018 body (%)', v_md5;
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.get_tournament_season_media_usage(uuid,uuid)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '6151acbd48b8a57d762be9c44e0fe5e7' THEN
    RAISE EXCEPTION 'TORNEOS_0018_POSTCONDITION_FAILED: get_tournament_season_media_usage is not the 0018 body (%)', v_md5;
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.get_effective_tournament_season_entitlements(uuid,uuid)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '391497eb0c9a028211e6f62e37b034ef' THEN
    RAISE EXCEPTION 'TORNEOS_0018_POSTCONDITION_FAILED: get_effective_tournament_season_entitlements is not the 0018 body (%)', v_md5;
  END IF;
  FOREACH v_fn IN ARRAY array[
    'public.run_tournament_season_media_lifecycle()', 'public.claim_tournament_media_purge(integer)',
    'public.complete_tournament_media_purge(uuid)'
  ] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
      OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'TORNEOS_0018_POSTCONDITION_FAILED: % must be service_role only', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY array[
    'private.tournament_season_media_deadline(timestamptz)', 'private.tournament_season_media_open(uuid,uuid)',
    'private.tournament_season_media_readable(uuid,uuid)',
    'private.tournament_season_lifecycle_json(uuid,uuid)', 'private.mark_tournament_season_media_for_deletion(uuid,uuid)',
    'private.notify_tournament_season_media_deletion()'
  ] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'TORNEOS_0018_POSTCONDITION_FAILED: % is reachable by an API role', v_fn;
    END IF;
  END LOOP;
  IF (SELECT gallery_asset_limit FROM public.tournament_plan_catalog WHERE plan_code = 'PREMIUM') <> 100
    OR (SELECT gallery_asset_limit FROM public.tournament_plan_catalog WHERE plan_code = 'FREE') <> 25 THEN
    RAISE EXCEPTION 'TORNEOS_0018_POSTCONDITION_FAILED: plan catalog';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_seasons WHERE status <> 'draft' AND activated_at IS NULL)
    OR EXISTS (SELECT 1 FROM public.tournament_seasons WHERE status = 'draft' AND activated_at IS NOT NULL) THEN
    RAISE EXCEPTION 'TORNEOS_0018_POSTCONDITION_FAILED: season activation backfill';
  END IF;
  IF (select public from storage.buckets where id = 'tournament-media') IS DISTINCT FROM false
    OR (select public from storage.buckets where id = 'tournament-branding') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TORNEOS_0018_POSTCONDITION_FAILED: buckets must stay private';
  END IF;
END $post$;

COMMIT;
