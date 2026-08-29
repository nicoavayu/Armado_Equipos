-- Arma2 Torneos · Multimedia · restaurar respeta la galería cerrada
--
-- FPR-001.2. `resolveMediaAssetActions` ya no ofrece «Restaurar» cuando la
-- galería está `archived` o `revoked`, porque restaurar ahí no lleva a ninguna
-- parte: no existe `unarchive`, no existe `republish`, y una galería cerrada no
-- vuelve a mostrarse a los participantes. Pero eso era una decisión del cliente
-- y el RPC no la compartía: `transition_tournament_media_asset` tenía una rama
-- de restore SIN compuerta de galería, así que
--
--     archived + hidden --restore--> approved, galería sigue archived
--
-- era una llamada perfectamente aceptada. El asset quedaba `approved` dentro de
-- un contenedor que nadie puede reabrir: ni se ve, ni se publica, ni se puede
-- volver a ocultar (`hide` exige `approved`/`published`, así que el ciclo sí
-- admitía ida y vuelta, pero sobre un estado que el producto no representa).
-- Un botón escondido no es un contrato; el contrato es lo que la función acepta.
--
-- Este cambio NO agrega estados ni capacidades. Es la compuerta que faltaba, y
-- se limita a las dos galerías terminales:
--
--   * `draft` / `under_review` — restaurar devuelve la foto a `approved`, que
--     es donde la curaduría todavía decide. Sin cambios.
--   * `published` — restaurar devuelve la foto a `published` cuando ya lo
--     estuvo, y `tournament_media_asset_has_internal_consent` sigue siendo la
--     compuerta que decide si vuelve. Sin cambios.
--   * `archived` / `revoked` — fail closed. `v_next` queda NULL y la llamada
--     muere en el `TORNEOS_MEDIA_TRANSITION_INVALID` que la función ya tenía,
--     que es el código cuyo copy —«Ese cambio de estado ya no está
--     disponible.»— describe exactamente lo que pasó.
--
-- El resto de la función queda intacto byte a byte: locks, capacidades
-- (`media.review` para approve/reject/restore, `media.revoke` para las bajas),
-- motivos obligatorios, la exigencia de cuatro variantes en
-- `processor_external`, el recheck de consentimiento al publicar, el reemplazo
-- atómico de portada, la acción de moderación y la auditoría.

BEGIN;

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

COMMENT ON FUNCTION "public"."transition_tournament_media_asset"(uuid,text,text) IS
  'Moderación de una foto. Restaurar exige una galería que todavía pueda mostrarla: draft, under_review o published. archived y revoked fallan cerrado con TORNEOS_MEDIA_TRANSITION_INVALID.';

COMMIT;
