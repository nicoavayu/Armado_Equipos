-- ===========================================================================
-- Security patch M3 — Notifications (Stage A)
-- ---------------------------------------------------------------------------
-- Confirmed hole: policy `notifications_insert_authenticated_any_user`
-- (INSERT ... WITH CHECK (true)) lets any authenticated user insert a
-- notification with an ARBITRARY user_id / type / title / message / data — i.e.
-- forge a notification to any other user (phishing / impersonation).
--
-- Cross-user notifications ALREADY flow through relationship-validating
-- SECURITY DEFINER RPCs (send_match_invite, send_call_to_vote,
-- enqueue_partido_notification, enqueue_match_participant_notification,
-- cancel_partido_with_notification). The abuse surface is the DIRECT client
-- `INSERT` path. This migration:
--
--   * Adds a strict `create_notification(p_type, p_recipient_id, p_context)`
--     RPC (SECURITY DEFINER) that GENERATES type/title/message/data server-side
--     from typed IDs, validates the sender↔recipient relationship per type, and
--     ignores any client-supplied free text. This is the target for the direct
--     `from('notifications').insert()` call sites (see PR call-site table).
--   * Replaces the `WITH CHECK (true)` policy with a Stage A INTERIM policy that
--     is NON-BREAKING for legacy clients: allows self-notifications and inserts
--     to a related recipient (shared match / team / friendship), restricted to a
--     known `type` allowlist and bounded title/message length. This closes the
--     arbitrary-recipient abuse immediately without breaking installed apps.
--
-- Stage B (20260724132000_notifications_rpc_only_stage_b.sql) drops the interim
-- policy and leaves only self-insert; all cross-user inserts then go through the
-- (DEFINER) RPCs. Rollback SQL at the bottom.
--
-- NOTE (documented follow-up, low severity): send_match_invite / send_call_to_vote
-- still accept optional p_title/p_message (server-side defaults when NULL). The
-- new client passes NULL so content is server-generated; fully removing the
-- passthrough in those large push-pipeline RPCs is a separate, targeted change.
-- ===========================================================================

BEGIN;

ALTER TABLE IF EXISTS public.notifications ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 1. Strict, server-content notification RPC for direct-insert domains.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_notification(
  p_type text,
  p_recipient_id uuid,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_recipient_name text;
  v_match_id bigint := NULLIF(p_context->>'match_id', '')::bigint;
  v_match_name text;
  v_authorized boolean := false;
  v_title text;
  v_message text;
  v_data jsonb;
  v_type text := lower(btrim(coalesce(p_type, '')));
  v_notif_id bigint;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_recipient_id IS NULL THEN
    RAISE EXCEPTION 'invalid_recipient' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(nombre, 'Alguien') INTO v_actor_name FROM public.usuarios WHERE id = v_actor;
  PERFORM 1 FROM public.usuarios WHERE id = p_recipient_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'recipient_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_match_id IS NOT NULL THEN
    SELECT COALESCE(NULLIF(btrim(nombre), ''), 'el partido') INTO v_match_name
    FROM public.partidos WHERE id = v_match_id;
  END IF;

  -- Per-type authorization + server-generated content. Free text from the
  -- client is never used; only typed IDs in p_context are read.
  CASE v_type
    WHEN 'friend_request' THEN
      IF p_recipient_id = v_actor THEN RAISE EXCEPTION 'cannot_notify_self'; END IF;
      v_authorized := true; -- anyone may request friendship of anyone
      v_title := 'Solicitud de amistad';
      v_message := v_actor_name || ' te envió una solicitud de amistad';
      v_data := jsonb_build_object('sender_id', v_actor, 'sender_name', v_actor_name);

    WHEN 'friend_accepted' THEN
      v_authorized := EXISTS (
        SELECT 1 FROM public.amigos a
        WHERE ((a.user_id = v_actor AND a.friend_id = p_recipient_id)
            OR (a.user_id = p_recipient_id AND a.friend_id = v_actor))
      );
      v_title := 'Solicitud de amistad aceptada';
      v_message := v_actor_name || ' aceptó tu solicitud de amistad';
      v_data := jsonb_build_object('sender_id', v_actor, 'sender_name', v_actor_name);

    WHEN 'friend_rejected' THEN
      v_authorized := (p_recipient_id <> v_actor);
      v_title := 'Solicitud de amistad rechazada';
      v_message := 'Tu solicitud de amistad ha sido rechazada';
      v_data := jsonb_build_object('sender_id', v_actor);

    WHEN 'match_update', 'match_kicked', 'match_cancelled', 'falta_jugadores',
         'call_to_vote', 'pre_match_vote', 'match_player_joined' THEN
      IF v_match_id IS NULL THEN RAISE EXCEPTION 'match_id_required'; END IF;
      -- sender must be the match creator/admin or a participant
      v_authorized := EXISTS (
        SELECT 1 FROM public.partidos p WHERE p.id = v_match_id AND p.creado_por = v_actor
      ) OR EXISTS (
        SELECT 1 FROM public.jugadores j WHERE j.partido_id = v_match_id AND j.usuario_id = v_actor
      );
      -- recipient must be a participant of that match (or the admin)
      v_authorized := v_authorized AND (
        EXISTS (SELECT 1 FROM public.jugadores j WHERE j.partido_id = v_match_id AND j.usuario_id = p_recipient_id)
        OR EXISTS (SELECT 1 FROM public.partidos p WHERE p.id = v_match_id AND p.creado_por = p_recipient_id)
      );
      v_data := jsonb_build_object('match_id', v_match_id, 'matchId', v_match_id, 'partido_id', v_match_id);
      CASE v_type
        WHEN 'match_kicked' THEN
          v_title := 'Expulsado del partido';
          v_message := 'Has sido expulsado del partido "' || v_match_name || '"';
        WHEN 'match_cancelled' THEN
          v_title := 'Partido cancelado';
          v_message := 'El partido "' || v_match_name || '" fue cancelado';
        WHEN 'falta_jugadores' THEN
          v_title := 'Faltan jugadores';
          v_message := 'El partido "' || v_match_name || '" necesita jugadores';
        WHEN 'call_to_vote' THEN
          v_title := '¡Hora de votar!';
          v_message := 'Entrá a la app y calificá a los jugadores para armar los equipos.';
        WHEN 'pre_match_vote' THEN
          v_title := '¡Armemos los equipos!';
          v_message := 'Calificá a los jugadores para armar el partido más parejo.';
        WHEN 'match_player_joined' THEN
          v_title := 'Nuevo jugador';
          v_message := 'Se sumó un jugador al partido "' || v_match_name || '"';
        ELSE
          v_title := 'Actualización del partido';
          v_message := 'Hay novedades en el partido "' || v_match_name || '"';
      END CASE;

    ELSE
      RAISE EXCEPTION 'unsupported_notification_type: %', v_type USING ERRCODE = '22023';
  END CASE;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message, data, read, partido_id, created_at)
  VALUES (p_recipient_id, v_type, v_title, v_message, COALESCE(v_data, '{}'::jsonb), false, v_match_id, now())
  RETURNING id INTO v_notif_id;

  RETURN jsonb_build_object('success', true, 'id', v_notif_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_notification(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_notification(text, uuid, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Replace WITH CHECK(true) with a Stage A interim, non-breaking policy.
--    Allows: self-notifications, OR a recipient related to the sender by a
--    shared match / team / friendship. Bounded content + known type allowlist.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS notifications_insert_authenticated_any_user ON public.notifications;

DROP POLICY IF EXISTS notifications_insert_related_or_self ON public.notifications;
CREATE POLICY notifications_insert_related_or_self
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
  char_length(COALESCE(title, '')) <= 200
  AND char_length(COALESCE(message, '')) <= 1000
  AND type IN (
    'friend_request','friend_accepted','friend_rejected',
    'match_invite','match_update','match_kicked','match_cancelled','match_player_joined',
    'match_join_request','falta_jugadores','call_to_vote','pre_match_vote',
    'team_invite','team_match','challenge','challenge_squad_open',
    'payment_reported','payment_reminder','payment_admin',
    'auto_match_ready','award_won','awards_ready','mvp',
    'survey_start','survey_reminder','survey_finished','survey_results_ready',
    'no_show_penalty','no_show_recovery','info','success','warning'
  )
  AND (
    -- self-notifications are always allowed
    user_id = auth.uid()
    -- shared match (either direction, incl. match creator)
    OR EXISTS (
      SELECT 1 FROM public.jugadores j_self
      JOIN public.jugadores j_rec ON j_rec.partido_id = j_self.partido_id
      WHERE j_self.usuario_id = auth.uid() AND j_rec.usuario_id = public.notifications.user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.partidos p
      WHERE (p.creado_por = auth.uid() OR EXISTS (
              SELECT 1 FROM public.jugadores j WHERE j.partido_id = p.id AND j.usuario_id = auth.uid()))
        AND (p.creado_por = public.notifications.user_id OR EXISTS (
              SELECT 1 FROM public.jugadores j2 WHERE j2.partido_id = p.id AND j2.usuario_id = public.notifications.user_id))
    )
    -- shared team (team_members links via jugadores.usuario_id)
    OR EXISTS (
      SELECT 1
      FROM public.team_members tm_self
      JOIN public.jugadores js ON js.id = tm_self.jugador_id AND js.usuario_id = auth.uid()
      JOIN public.team_members tm_rec ON tm_rec.team_id = tm_self.team_id
      JOIN public.jugadores jr ON jr.id = tm_rec.jugador_id AND jr.usuario_id = public.notifications.user_id
    )
    -- friendship (accepted or pending, either direction)
    OR EXISTS (
      SELECT 1 FROM public.amigos a
      WHERE (a.user_id = auth.uid() AND a.friend_id = public.notifications.user_id)
         OR (a.user_id = public.notifications.user_id AND a.friend_id = auth.uid())
    )
  )
);

COMMIT;

-- ===========================================================================
-- ROLLBACK (Stage A)
-- ===========================================================================
-- BEGIN;
-- DROP POLICY IF EXISTS notifications_insert_related_or_self ON public.notifications;
-- CREATE POLICY notifications_insert_authenticated_any_user ON public.notifications
--   FOR INSERT TO authenticated WITH CHECK (true);
-- DROP FUNCTION IF EXISTS public.create_notification(text, uuid, jsonb);
-- COMMIT;
