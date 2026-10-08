-- Arma2 Torneos — MEDIA-V1 0014: retiring a gallery's last published photo returns the gallery to draft.
-- Applies after 00000000000012 (0013, COMMERCE-PRODUCTION, is independent: either order). Rollback (documented, never
-- automatic): backend/torneos/media-v1/rollback/00000000000014_media_gallery_draft_on_retire.rollback.sql
--
-- Product decision (2026-10-08): in the baseline, retiring (hide / revoke / request_deletion) the cover of a published
-- gallery with no other published photo ARCHIVED the gallery, and archived is terminal: no un-archive, and restore
-- refuses an archived gallery. One «Retirar» on the last photo closed the gallery for good. Now:
--   * transition_tournament_media_asset sends that gallery back to DRAFT (cover cleared, submitted/published stamps
--     cleared as the lifecycle check requires, version + 1, audited as media.gallery.unpublished). Participants stop
--     seeing it at once (reads require a published gallery); a signed URL already issued lives out its 300 s.
--   * publish_tournament_media_gallery publishes the APPROVED photos: retired (hidden), revoked and rejected items no
--     longer block publication and stay out of view, so the organizer can restore the retired photo or approve
--     another one, choose the cover and publish again. A photo pending review still blocks it.
-- Archiving stays the explicit «Archivar galería» (change_tournament_media_gallery_state), unchanged.
--
-- Exactly two bodies change, each starting from its certified baseline text (md5 pinned below); ACL, owner, SECURITY
-- DEFINER and search_path are those of CREATE OR REPLACE (unchanged). Nothing outside media is touched, in particular
-- nothing 0013 pins (purchase / payment / grant / entitlement chain, has_tournament_season_*, *production*).
BEGIN;

DO $pre$
DECLARE
  v_md5 text;
BEGIN
  IF to_regprocedure('public.begin_tournament_media_gallery_upload(uuid,uuid,text,bigint,bigint)') IS NULL THEN
    RAISE EXCEPTION 'TORNEOS_MEDIA_V1_0014_PRECONDITION_FAILED: 00000000000012 is not in force';
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.transition_tournament_media_asset(uuid,text,text)'::regprocedure;
  IF v_md5 IS DISTINCT FROM 'bbf724512ff4e767d51343a2a199ba25' THEN
    RAISE EXCEPTION 'TORNEOS_MEDIA_V1_0014_PRECONDITION_FAILED: transition_tournament_media_asset body is not the expected one (%)', v_md5;
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.publish_tournament_media_gallery(uuid)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '9eb5ac61631329a44139f1f0c6071c28' THEN
    RAISE EXCEPTION 'TORNEOS_MEDIA_V1_0014_PRECONDITION_FAILED: publish_tournament_media_gallery body is not the expected one (%)', v_md5;
  END IF;
END $pre$;

CREATE OR REPLACE FUNCTION public.transition_tournament_media_asset(p_asset_id uuid, p_action text, p_reason text DEFAULT NULL::text) RETURNS jsonb
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
  IF NOT (public.has_tournament_media_capability(
    v_asset.organization_id,v_capability
  ) and public.has_tournament_season_access(v_asset.organization_id, (select g.season_id from public.tournament_media_galleries g where g.id = v_asset.gallery_id))) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'TORNEOS_MEDIA_FORBIDDEN';
  END IF;
  v_next := CASE
    WHEN p_action = 'approve' AND v_asset.status = 'pending_review' THEN 'approved'
    WHEN p_action = 'reject' AND v_asset.status = 'pending_review' THEN 'rejected'
    WHEN p_action = 'hide' AND v_asset.status IN ('approved','published') THEN 'hidden'
    -- Restaurar sólo existe mientras la galería todavía puede mostrar la foto.
    -- `archived` y `revoked` no aparecen en ninguna de las dos ramas: no hay
    -- rama que las contemple y por eso caen al ELSE NULL.
    WHEN p_action = 'restore' AND v_asset.status = 'hidden'
      AND v_gallery.status = 'published' AND v_asset.published_at IS NOT NULL
      THEN 'published'
    WHEN p_action = 'restore' AND v_asset.status = 'hidden'
      AND v_gallery.status IN ('draft','under_review','published')
      THEN 'approved'
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
    approved_by = CASE WHEN v_next = 'approved' THEN private.current_identity_id() ELSE approved_by END,
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
      -- MEDIA-V1 0014: no published photo is left, so the gallery goes back to draft instead of being archived. Its
      -- photos stay (the retired one can be restored) and it can be published again; archiving is only the explicit
      -- action (change_tournament_media_gallery_state). Draft carries no submitted/published stamps (lifecycle check).
      UPDATE public.tournament_media_galleries
      SET status = 'draft',cover_asset_id = NULL,submitted_at = NULL,published_at = NULL,published_by = NULL,
        version = version + 1 WHERE id = v_gallery.id;
      PERFORM public.append_tournament_audit(
        v_asset.organization_id,'media.gallery.unpublished','media_gallery',v_gallery.id,
        null,v_asset.tournament_id,jsonb_build_object('assetId',p_asset_id,'action',p_action)
      );
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
    p_action,v_asset.status,v_next,nullif(btrim(p_reason),''),private.current_identity_id()
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

COMMENT ON FUNCTION public.transition_tournament_media_asset(p_asset_id uuid, p_action text, p_reason text) IS 'Moderación de una foto. Retirar la última foto publicada (la portada) devuelve la galería a borrador, nunca la archiva. Restaurar exige una galería que todavía pueda mostrarla: draft, under_review o published. archived y revoked fallan cerrado con TORNEOS_MEDIA_TRANSITION_INVALID.';

CREATE OR REPLACE FUNCTION public.publish_tournament_media_gallery(p_gallery_id uuid) RETURNS jsonb
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
  if v_gallery.id is null or not (public.has_tournament_media_capability(
    v_gallery.organization_id,'media.publish'
  ) and public.has_tournament_season_access(v_gallery.organization_id, v_gallery.season_id)) then
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
  -- MEDIA-V1 0014: what gets published is the approved photos. Retired (hidden), revoked or rejected ones stay in the
  -- gallery out of view (a retired one can be restored later); a photo still pending review blocks publication.
  select count(*) into v_count
  from public.tournament_media_gallery_items item
  join public.tournament_media_assets asset on asset.id = item.asset_id
  where item.gallery_id = p_gallery_id and asset.status = 'approved';
  if v_count < 1 or v_gallery.cover_asset_id is null or not exists (
    select 1 from public.tournament_media_assets asset
    where asset.id = v_gallery.cover_asset_id
      and asset.gallery_id = p_gallery_id and asset.status = 'approved'
  ) or exists (
    select 1
    from public.tournament_media_gallery_items item
    join public.tournament_media_assets asset on asset.id = item.asset_id
    where item.gallery_id = p_gallery_id
      and asset.status not in ('approved','hidden','revoked','rejected')
  ) or exists (
    select 1
    from public.tournament_media_gallery_items item
    join public.tournament_media_assets asset on asset.id = item.asset_id
    where item.gallery_id = p_gallery_id and asset.status = 'approved'
      and not public.tournament_media_asset_publication_ready(item.asset_id)
  ) then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_GALLERY_NOT_PUBLISHABLE';
  end if;
  if exists (
    select 1
    from public.tournament_media_gallery_items item
    join public.tournament_media_assets asset on asset.id = item.asset_id
    where item.gallery_id = p_gallery_id and asset.status = 'approved'
      and not public.tournament_media_asset_has_internal_consent(item.asset_id)
  ) then
    raise exception using errcode = '22023', message = 'TORNEOS_MEDIA_CONSENT_REQUIRED';
  end if;

  update public.tournament_media_assets asset
  set status = 'published',published_at = now()
  where asset.gallery_id = p_gallery_id and asset.status = 'approved';
  update public.tournament_media_galleries
  set status = 'published',submitted_at = coalesce(submitted_at,now()),
      published_by = private.current_identity_id(),published_at = now(),version = version + 1
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

DO $post$
DECLARE
  v_md5 text;
  v_count integer;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.transition_tournament_media_asset(uuid,text,text)'::regprocedure;
  IF v_md5 IS DISTINCT FROM 'ec3357d48b3a17561975126e7144939c' THEN
    RAISE EXCEPTION 'TORNEOS_MEDIA_V1_0014_POSTCONDITION_FAILED: transition_tournament_media_asset body is not the expected one (%)', v_md5;
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.publish_tournament_media_gallery(uuid)'::regprocedure;
  IF v_md5 IS DISTINCT FROM 'b16c376ab0421c98cd2ecbdfa78d5c1e' THEN
    RAISE EXCEPTION 'TORNEOS_MEDIA_V1_0014_POSTCONDITION_FAILED: publish_tournament_media_gallery body is not the expected one (%)', v_md5;
  END IF;
  SELECT count(*) INTO v_count FROM pg_proc
  WHERE oid IN ('public.transition_tournament_media_asset(uuid,text,text)'::regprocedure, 'public.publish_tournament_media_gallery(uuid)'::regprocedure)
    AND has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE')
    AND prosecdef AND proconfig = ARRAY['search_path=""'];
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'TORNEOS_MEDIA_V1_0014_POSTCONDITION_FAILED: grants, SECURITY DEFINER or search_path changed';
  END IF;
END $post$;

COMMIT;
