BEGIN;

-- Enable canonical + push-eligible friend request notifications.
-- 1) friend_request channel moves from INFO (in-app only) to INVITATION (push-enabled)
-- 2) create canonical notification row directly from amigos inserts/updates to pending

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
    WHEN 'survey_start' THEN RETURN 'SURVEY';
    WHEN 'post_match_survey' THEN RETURN 'SURVEY';
    WHEN 'survey_reminder' THEN RETURN 'SURVEY';
    WHEN 'match_join_approved' THEN RETURN 'ACCEPTED';
    WHEN 'match_join_request' THEN RETURN 'JOIN_REQUEST';
    WHEN 'call_to_vote' THEN RETURN 'VOTE_REQUEST';
    WHEN 'match_reminder_1h' THEN RETURN 'REMINDER';
    WHEN 'award_won' THEN RETURN 'REMINDER';
    WHEN 'no_show_penalty_applied' THEN RETURN 'REMINDER';
    WHEN 'no_show_recovery_applied' THEN RETURN 'REMINDER';
    WHEN 'awards_ready' THEN RETURN 'ACTIVITY';
    WHEN 'survey_results_ready' THEN RETURN 'ACTIVITY';
    WHEN 'survey_finished' THEN RETURN 'ACTIVITY';
    WHEN 'friend_request' THEN RETURN 'INVITATION';
    WHEN 'friend_accepted' THEN RETURN 'INFO';
    WHEN 'friend_rejected' THEN RETURN 'INFO';
    ELSE
      RETURN 'INFO';
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_friend_request_notification_from_amigos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_name text := 'Alguien';
BEGIN
  IF NEW.user_id IS NULL OR NEW.friend_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(lower(trim(NEW.status)), 'pending') <> 'pending' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.user_id = NEW.friend_id
      AND n.type = 'friend_request'
      AND COALESCE(n.data ->> 'requestId', '') = NEW.id::text
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(trim(u.nombre), ''), 'Alguien')
  INTO v_sender_name
  FROM public.usuarios u
  WHERE u.id = NEW.user_id;
  v_sender_name := COALESCE(v_sender_name, 'Alguien');

  INSERT INTO public.notifications (
    user_id,
    type,
    title,
    message,
    data,
    read,
    created_at
  ) VALUES (
    NEW.friend_id,
    'friend_request',
    'Nueva solicitud de amistad',
    format('%s te ha enviado una solicitud de amistad', v_sender_name),
    jsonb_build_object(
      'requestId', NEW.id,
      'senderId', NEW.user_id,
      'senderName', v_sender_name
    ),
    false,
    now()
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_amigos_create_friend_request_notification ON public.amigos;
CREATE TRIGGER trg_amigos_create_friend_request_notification
AFTER INSERT OR UPDATE OF status ON public.amigos
FOR EACH ROW
WHEN (COALESCE(lower(NEW.status), 'pending') = 'pending')
EXECUTE FUNCTION public.create_friend_request_notification_from_amigos();

COMMIT;
