-- ============================================================================
-- Push para notificaciones de desafíos dirigidos
-- Date: 2026-06-17
--
-- El trigger enqueue_remote_push_from_notification encola push SOLO si
-- notification_event_channel(type) cae en un canal push-allowed; los tipos
-- desconocidos caen en 'INFO' (sin push). Mapeamos los 3 tipos nuevos de
-- desafíos dirigidos a canales ya permitidos (INVITATION / ACCEPTED / SOCIAL),
-- evitando 'MATCH_UPDATE' (que se bloquea cuando source='team_challenge').
--
-- Sólo se AGREGAN ramas al CASE; el resto se reproduce verbatim (20260603184500).
-- No se tocan edge functions ni el scheduler de push.
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
    WHEN 'match_update' THEN RETURN 'MATCH_UPDATE';
    ELSE
      RETURN 'INFO';
  END CASE;
END;
$$;

COMMIT;
