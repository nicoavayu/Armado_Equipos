-- ============================================================================
-- Push real para "Recordar pendientes" (pagos post partido)
-- Date: 2026-06-20
--
-- El trigger trg_notifications_queue_remote_push (enqueue_remote_push_from_notification)
-- encola un push SOLO si notification_event_channel(type) cae en un canal
-- push-allowed; los tipos desconocidos caen en 'INFO' (sin push). Hasta ahora
-- 'payment_reminder' caía en 'INFO', por eso "Recordar pendientes" sólo creaba
-- la notificación interna y nunca disparaba push.
--
-- Mapeamos 'payment_reminder' al canal 'REMINDER' (ya permitido por
-- notification_channel_allows_push y EXENTO del cooldown de 30m, igual que
-- 'match_reminder_1h' / 'award_won'): así, al insertar la notificación interna,
-- el trigger encola la fila de push y el scheduler pg_cron (push-sender, cada
-- minuto) entrega el push real a los jugadores pendientes. Sólo se entrega a
-- quien recibe la notificación (admin_remind_pending_payments devuelve únicamente
-- los 'pending'), nunca a 'paid'/'exempt'/'reported_paid'.
--
-- Sólo se AGREGA una rama al CASE; el resto se reproduce verbatim
-- (base: 20260617122000_team_challenge_push_channels). No se tocan edge
-- functions ni el scheduler de push.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.notification_event_channel(p_type text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_type text := lower(trim(COALESCE(p_type, '')));
BEGIN
  CASE v_type
    WHEN 'match_invite' THEN RETURN 'INVITATION';
    WHEN 'match_cancelled' THEN RETURN 'CANCELLATION';
    WHEN 'match_deleted' THEN RETURN 'CANCELLATION';
    WHEN 'match_kicked' THEN RETURN 'CANCELLATION';
    WHEN 'survey_start' THEN RETURN 'SURVEY';
    WHEN 'post_match_survey' THEN RETURN 'SURVEY';
    WHEN 'survey_reminder' THEN RETURN 'SURVEY';
    WHEN 'survey_reminder_12h' THEN RETURN 'SURVEY';
    WHEN 'match_join_approved' THEN RETURN 'ACCEPTED';
    WHEN 'match_join_request' THEN RETURN 'JOIN_REQUEST';
    WHEN 'call_to_vote' THEN RETURN 'VOTE_REQUEST';
    WHEN 'match_reminder_1h' THEN RETURN 'REMINDER';
    WHEN 'substitute_promoted' THEN RETURN 'REMINDER';
    WHEN 'award_won' THEN RETURN 'REMINDER';
    WHEN 'no_show_penalty_applied' THEN RETURN 'REMINDER';
    WHEN 'no_show_recovery_applied' THEN RETURN 'REMINDER';
    WHEN 'awards_ready' THEN RETURN 'AWARDS_READY';
    WHEN 'survey_results_ready' THEN RETURN 'SURVEY_RESULTS';
    WHEN 'survey_finished' THEN RETURN 'SURVEY_RESULTS';
    WHEN 'friend_request' THEN RETURN 'INVITATION';
    WHEN 'friend_accepted' THEN RETURN 'SOCIAL';
    WHEN 'friend_rejected' THEN RETURN 'SOCIAL';
    WHEN 'admin_transfer' THEN RETURN 'ADMIN_TRANSFER';
    WHEN 'team_captain_transfer' THEN RETURN 'ADMIN_TRANSFER';
    WHEN 'team_challenge_received' THEN RETURN 'INVITATION';
    WHEN 'team_challenge_accepted' THEN RETURN 'ACCEPTED';
    WHEN 'team_challenge_rejected' THEN RETURN 'SOCIAL';
    WHEN 'payment_reminder' THEN RETURN 'REMINDER';
    WHEN 'match_update' THEN RETURN 'MATCH_UPDATE';
    ELSE
      RETURN 'INFO';
  END CASE;
END;
$$;

COMMIT;
