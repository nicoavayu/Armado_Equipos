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
-- Per-type authorization (review round 3): create_notification does not merely
-- require sender+recipient to share the match. Each sensitive type is gated on
-- the real server state — admin-only events (match_kicked/cancelled/
-- falta_jugadores/call_to_vote) require the emitter to be the match creator;
-- match_cancelled requires the match to be really cancelled and call_to_vote
-- requires voting to be open; survey_* require the real survey state; awards/mvp
-- require a persisted player_awards / results row; match_join_request requires a
-- real pending request from the actor; payments require a real payment row; team
-- challenge events require both parties to be the concrete challenge's creator/
-- acceptor (typed challenge_id). send_match_invite / send_call_to_vote content
-- passthrough is removed in 20260724125000; that migration also authorizes
-- send_call_to_vote to the match admin and fails the deploy if the
-- send_match_invite passthrough survives.
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
  v_match_id bigint := NULLIF(p_context->>'match_id', '')::bigint;
  v_match_name text;
  v_challenge_id uuid := NULLIF(p_context->>'challenge_id', '')::uuid;
  v_survey_status text;
  v_authorized boolean := false;
  v_is_admin boolean := false;
  v_sender_in_match boolean := false;
  v_recipient_in_match boolean := false;
  v_award_type text := NULLIF(p_context->>'award_type', '');
  v_award_label text;
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
    SELECT COALESCE(NULLIF(btrim(nombre), ''), 'el partido'), survey_status
      INTO v_match_name, v_survey_status
    FROM public.partidos WHERE id = v_match_id;
    -- "admin" of a match == its creator (see payments_is_match_admin).
    v_is_admin := EXISTS (SELECT 1 FROM public.partidos p WHERE p.id = v_match_id AND p.creado_por = v_actor);
    v_sender_in_match := v_is_admin
      OR EXISTS (SELECT 1 FROM public.jugadores j WHERE j.partido_id = v_match_id AND j.usuario_id = v_actor);
    v_recipient_in_match :=
      EXISTS (SELECT 1 FROM public.jugadores j WHERE j.partido_id = v_match_id AND j.usuario_id = p_recipient_id)
      OR EXISTS (SELECT 1 FROM public.partidos p WHERE p.id = v_match_id AND p.creado_por = p_recipient_id);
    v_data := jsonb_build_object('match_id', v_match_id, 'matchId', v_match_id, 'partido_id', v_match_id);
  END IF;

  -- Per-type authorization + server-generated content. Only typed IDs from
  -- p_context are read; client title/message/data are NEVER used.
  CASE v_type
    -- ---- Friendship: require a REAL relationship row (no arbitrary events) --
    WHEN 'friend_request' THEN
      IF p_recipient_id = v_actor THEN RAISE EXCEPTION 'cannot_notify_self'; END IF;
      v_authorized := EXISTS (
        SELECT 1 FROM public.amigos a
        WHERE a.user_id = v_actor AND a.friend_id = p_recipient_id
          AND lower(COALESCE(a.status, 'pending')) = 'pending'
      );
      v_title := 'Solicitud de amistad';
      v_message := v_actor_name || ' te envió una solicitud de amistad';
      v_data := jsonb_build_object('sender_id', v_actor, 'sender_name', v_actor_name);

    WHEN 'friend_accepted' THEN
      -- actor accepted a request the recipient originally sent
      v_authorized := EXISTS (
        SELECT 1 FROM public.amigos a
        WHERE a.user_id = p_recipient_id AND a.friend_id = v_actor
          AND lower(COALESCE(a.status, '')) = 'accepted'
      );
      v_title := 'Solicitud de amistad aceptada';
      v_message := v_actor_name || ' aceptó tu solicitud de amistad';
      v_data := jsonb_build_object('sender_id', v_actor, 'sender_name', v_actor_name);

    WHEN 'friend_rejected' THEN
      -- a request from recipient -> actor must have existed (now rejected)
      v_authorized := EXISTS (
        SELECT 1 FROM public.amigos a
        WHERE a.user_id = p_recipient_id AND a.friend_id = v_actor
          AND lower(COALESCE(a.status, '')) = 'rejected'
      );
      v_title := 'Solicitud de amistad rechazada';
      v_message := 'Tu solicitud de amistad ha sido rechazada';
      v_data := jsonb_build_object('sender_id', v_actor);

    -- ---- Admin-only match events: the EMITTER must be the match creator/admin.
    -- A plain participant can NOT kick, cancel, ask for players or open voting.
    WHEN 'match_kicked', 'match_cancelled', 'falta_jugadores', 'call_to_vote' THEN
      IF v_match_id IS NULL THEN RAISE EXCEPTION 'match_id_required'; END IF;
      v_authorized := v_is_admin AND v_recipient_in_match;
      IF v_type = 'match_cancelled' THEN
        -- must reflect a REAL cancellation, not a fabricated one
        v_authorized := v_authorized AND EXISTS (
          SELECT 1 FROM public.partidos p
          WHERE p.id = v_match_id
            AND lower(coalesce(p.estado, '')) IN ('cancelado', 'cancelled', 'canceled')
        );
      ELSIF v_type = 'call_to_vote' THEN
        -- voting must actually be OPEN (right moment of the flow)
        v_authorized := v_authorized AND public.is_public_voting_open(v_match_id);
      END IF;
      IF v_type = 'match_kicked' THEN
        v_title := 'Expulsado del partido';
        v_message := 'Has sido expulsado del partido "' || v_match_name || '"';
      ELSIF v_type = 'match_cancelled' THEN
        v_title := 'Partido cancelado';
        v_message := 'El partido "' || v_match_name || '" fue cancelado';
      ELSIF v_type = 'falta_jugadores' THEN
        v_title := 'Faltan jugadores';
        v_message := 'El partido "' || v_match_name || '" necesita jugadores';
      ELSE -- call_to_vote
        v_title := '¡Hora de votar!';
        v_message := 'Entrá a la app y calificá a los jugadores para armar los equipos.';
      END IF;

    -- ---- Peer match events: sender AND recipient must belong to the match ---
    WHEN 'match_update', 'pre_match_vote', 'match_player_joined' THEN
      IF v_match_id IS NULL THEN RAISE EXCEPTION 'match_id_required'; END IF;
      v_authorized := v_sender_in_match AND v_recipient_in_match;
      IF v_type = 'pre_match_vote' THEN
        v_title := '¡Armemos los equipos!';
        v_message := 'Calificá a los jugadores para armar el partido más parejo.';
      ELSIF v_type = 'match_player_joined' THEN
        v_title := 'Nuevo jugador';
        v_message := 'Se sumó un jugador al partido "' || v_match_name || '"';
      ELSE -- match_update
        v_title := 'Actualización del partido';
        v_message := 'Hay novedades en el partido "' || v_match_name || '"';
      END IF;

    -- ---- Survey lifecycle: must reflect the REAL survey state. A participant
    -- can NOT fabricate a survey open/close/results event out of the flow.
    WHEN 'survey_start', 'survey_reminder', 'survey_finished', 'survey_results_ready' THEN
      IF v_match_id IS NULL THEN RAISE EXCEPTION 'match_id_required'; END IF;
      v_authorized := v_sender_in_match AND v_recipient_in_match;
      IF v_type = 'survey_finished' THEN
        v_authorized := v_authorized AND (
          lower(coalesce(v_survey_status, '')) IN ('closed', 'finished', 'completed')
          OR EXISTS (
            SELECT 1 FROM public.survey_results sr
            WHERE sr.partido_id = v_match_id
              AND (sr.results_ready OR sr.encuesta_cerrada_at IS NOT NULL OR sr.finished_at IS NOT NULL)
          )
        );
        v_title := 'Encuesta cerrada';
        v_message := 'La encuesta del partido "' || v_match_name || '" se cerró.';
      ELSIF v_type = 'survey_results_ready' THEN
        v_authorized := v_authorized AND EXISTS (
          SELECT 1 FROM public.survey_results sr
          WHERE sr.partido_id = v_match_id AND sr.results_ready = true
        );
        v_title := 'Resultados listos';
        v_message := 'Ya están los resultados del partido "' || v_match_name || '".';
      ELSE
        -- survey_start / survey_reminder: the survey lifecycle must have begun
        v_authorized := v_authorized AND (
          lower(coalesce(v_survey_status, '')) IN ('open', 'active', 'closed', 'finished', 'completed')
          OR EXISTS (SELECT 1 FROM public.survey_results sr WHERE sr.partido_id = v_match_id)
        );
        IF v_type = 'survey_start' THEN
          v_title := '¡Encuesta lista!';
          v_message := 'Ya podés completar la encuesta del partido "' || v_match_name || '".';
        ELSE
          v_title := 'Recordatorio de encuesta';
          v_message := 'No te olvides de completar la encuesta del partido "' || v_match_name || '".';
        END IF;
      END IF;

    -- ---- Awards broadcast: only when awards were REALLY persisted. A
    -- participant can NOT invent an MVP or "premios listos" event.
    WHEN 'awards_ready', 'mvp' THEN
      IF v_match_id IS NULL THEN RAISE EXCEPTION 'match_id_required'; END IF;
      v_authorized := v_sender_in_match AND v_recipient_in_match;
      IF v_type = 'mvp' THEN
        v_authorized := v_authorized AND EXISTS (
          SELECT 1 FROM public.player_awards pa
          WHERE pa.partido_id = v_match_id AND lower(coalesce(pa.award_type, '')) = 'mvp'
        );
        v_title := 'MVP del partido';
        v_message := 'Se eligió el MVP del partido "' || v_match_name || '".';
      ELSE
        v_authorized := v_authorized AND (
          EXISTS (SELECT 1 FROM public.player_awards pa WHERE pa.partido_id = v_match_id)
          OR EXISTS (SELECT 1 FROM public.survey_results sr WHERE sr.partido_id = v_match_id AND sr.results_ready = true)
        );
        v_title := 'Premios listos';
        v_message := 'Ya están los premios del partido "' || v_match_name || '".';
      END IF;

    -- ---- Match join request: a REAL pending request from the actor must
    -- exist, and the recipient must be the match admin (its creator).
    WHEN 'match_join_request' THEN
      IF v_match_id IS NULL THEN RAISE EXCEPTION 'match_id_required'; END IF;
      v_authorized :=
        EXISTS (SELECT 1 FROM public.partidos p WHERE p.id = v_match_id AND p.creado_por = p_recipient_id)
        AND EXISTS (
          SELECT 1 FROM public.match_join_requests r
          WHERE r.match_id = v_match_id AND r.user_id = v_actor
            AND lower(coalesce(r.status, '')) = 'pending'
        );
      v_title := 'Solicitud para unirse';
      v_message := v_actor_name || ' quiere unirse al partido "' || v_match_name || '"';

    -- ---- Payments -----------------------------------------------------------
    -- reporter (participant) -> match admin, with a REAL reported-paid row.
    WHEN 'payment_reported' THEN
      IF v_match_id IS NULL THEN RAISE EXCEPTION 'match_id_required'; END IF;
      v_authorized :=
        v_sender_in_match
        AND EXISTS (SELECT 1 FROM public.partidos p WHERE p.id = v_match_id AND p.creado_por = p_recipient_id)
        AND EXISTS (
          SELECT 1 FROM public.match_player_payments mpp
          WHERE mpp.partido_id = v_match_id AND mpp.user_id = v_actor
            AND lower(coalesce(mpp.status, '')) IN ('reported_paid', 'paid')
        );
      v_title := 'Pago a confirmar';
      v_message := v_actor_name || ' avisó que pagó "' || v_match_name || '".';

    -- admin -> a participant that has a REAL pending payment row.
    WHEN 'payment_reminder', 'payment_admin' THEN
      IF v_match_id IS NULL THEN RAISE EXCEPTION 'match_id_required'; END IF;
      v_authorized :=
        v_is_admin
        AND EXISTS (
          SELECT 1 FROM public.match_player_payments mpp
          WHERE mpp.partido_id = v_match_id AND mpp.user_id = p_recipient_id
            AND lower(coalesce(mpp.status, '')) = 'pending'
        );
      v_title := 'Pago pendiente';
      v_message := 'Tenés pendiente el pago de "' || v_match_name || '".';

    -- ---- Awards (personal): the award must be REALLY persisted for the match
    -- and the recipient must be a real participant. No fabricated premios.
    WHEN 'award_won' THEN
      IF v_match_id IS NULL THEN RAISE EXCEPTION 'match_id_required'; END IF;
      v_authorized := v_sender_in_match AND v_recipient_in_match AND EXISTS (
        SELECT 1 FROM public.player_awards pa
        WHERE pa.partido_id = v_match_id
          AND (v_award_type IS NULL OR lower(coalesce(pa.award_type, '')) = lower(v_award_type))
      );
      v_award_label := CASE v_award_type
        WHEN 'mvp' THEN 'MVP'
        WHEN 'best_gk' THEN 'Mejor Arquero'
        WHEN 'red_card' THEN 'Jugador más sucio'
        ELSE 'Premio'
      END;
      v_title := 'Ganaste un premio: ' || v_award_label;
      v_message := 'Ganaste "' || v_award_label || '" en el partido "' || v_match_name || '".';
      v_data := COALESCE(v_data, '{}'::jsonb) || jsonb_build_object('award_type', COALESCE(v_award_type, 'award'), 'award_label', v_award_label);

    -- ---- Team challenge: BOTH actor and recipient must be the concrete
    -- parties (creator / acceptor) of the SAME challenge (typed challenge_id).
    -- A member of one team can NOT notify a member of an unrelated challenge.
    WHEN 'team_challenge_accepted', 'challenge', 'team_match' THEN
      IF v_challenge_id IS NULL THEN RAISE EXCEPTION 'challenge_id_required'; END IF;
      v_authorized := EXISTS (
        SELECT 1 FROM public.challenges c
        WHERE c.id = v_challenge_id
          AND v_actor IN (c.created_by_user_id, c.accepted_by_user_id)
          AND p_recipient_id IN (c.created_by_user_id, c.accepted_by_user_id)
      );
      v_data := COALESCE(v_data, '{}'::jsonb) || jsonb_build_object('challenge_id', v_challenge_id);
      v_title := 'Novedades del desafío';
      v_message := 'Hay novedades en tu desafío de equipos.';

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
