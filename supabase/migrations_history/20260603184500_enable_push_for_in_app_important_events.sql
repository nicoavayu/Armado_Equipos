BEGIN;

-- Important bell notifications should also be push-eligible unless an explicit
-- policy skips them. Keep dedicated channels so cooldown/dedupe does not make
-- results, awards, admin transfers, and social updates block each other.
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
    WHEN 'match_update' THEN RETURN 'MATCH_UPDATE';
    ELSE
      RETURN 'INFO';
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.notification_channel_allows_push(p_channel text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(upper($1), '') = ANY (
    ARRAY[
      'INVITATION',
      'CANCELLATION',
      'SURVEY',
      'ACCEPTED',
      'JOIN_REQUEST',
      'VOTE_REQUEST',
      'REMINDER',
      'SURVEY_RESULTS',
      'AWARDS_READY',
      'SOCIAL',
      'ADMIN_TRANSFER',
      'MATCH_UPDATE'
    ]
  );
$$;

CREATE OR REPLACE FUNCTION public.notification_push_dedupe_key(
  p_type text,
  p_partido_id bigint,
  p_data jsonb
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_type text := lower(trim(COALESCE(p_type, '')));
  v_data jsonb := COALESCE(p_data, '{}'::jsonb);
  v_match_id text := COALESCE(
    CASE WHEN p_partido_id IS NOT NULL THEN p_partido_id::text ELSE NULL END,
    NULLIF(trim(COALESCE(v_data ->> 'partido_id', '')), ''),
    NULLIF(trim(COALESCE(v_data ->> 'partidoId', '')), ''),
    NULLIF(trim(COALESCE(v_data ->> 'match_id', '')), ''),
    NULLIF(trim(COALESCE(v_data ->> 'matchId', '')), '')
  );
  v_request_id text := COALESCE(
    NULLIF(trim(COALESCE(v_data ->> 'request_id', '')), ''),
    NULLIF(trim(COALESCE(v_data ->> 'requestId', '')), ''),
    NULLIF(trim(COALESCE(v_data ->> 'friendshipId', '')), ''),
    NULLIF(trim(COALESCE(v_data ->> 'friendship_id', '')), '')
  );
  v_team_id text := COALESCE(
    NULLIF(trim(COALESCE(v_data ->> 'team_id', '')), ''),
    NULLIF(trim(COALESCE(v_data ->> 'teamId', '')), '')
  );
  v_new_admin_id text := COALESCE(
    NULLIF(trim(COALESCE(v_data ->> 'new_admin_id', '')), ''),
    NULLIF(trim(COALESCE(v_data ->> 'newAdminId', '')), '')
  );
BEGIN
  IF v_type IN ('survey_results_ready', 'survey_finished') AND v_match_id IS NOT NULL THEN
    RETURN 'survey_results:' || v_match_id;
  END IF;

  IF v_type = 'awards_ready' AND v_match_id IS NOT NULL THEN
    RETURN 'awards_ready:' || v_match_id;
  END IF;

  IF v_type IN ('friend_accepted', 'friend_rejected') AND v_request_id IS NOT NULL THEN
    RETURN v_type || ':' || v_request_id;
  END IF;

  IF v_type = 'admin_transfer' AND v_match_id IS NOT NULL THEN
    RETURN 'admin_transfer:' || v_match_id || ':' || COALESCE(v_new_admin_id, '');
  END IF;

  IF v_type = 'team_captain_transfer' AND v_team_id IS NOT NULL THEN
    RETURN 'team_captain_transfer:' || v_team_id;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.match_update_push_decision(
  p_recipient_user_id uuid,
  p_title text,
  p_message text,
  p_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_data jsonb := COALESCE(p_data, '{}'::jsonb);
  v_actor_user_id text := COALESCE(
    NULLIF(trim(COALESCE(v_data ->> 'player_user_id', '')), ''),
    NULLIF(trim(COALESCE(v_data ->> 'playerUserId', '')), ''),
    NULLIF(trim(COALESCE(v_data ->> 'actor_user_id', '')), ''),
    NULLIF(trim(COALESCE(v_data ->> 'actorUserId', '')), ''),
    NULLIF(trim(COALESCE(v_data ->> 'sender_id', '')), ''),
    NULLIF(trim(COALESCE(v_data ->> 'senderId', '')), '')
  );
  v_joined_via text := lower(trim(COALESCE(
    NULLIF(v_data ->> 'joined_via', ''),
    NULLIF(v_data ->> 'joinedVia', ''),
    ''
  )));
  v_left_via text := lower(trim(COALESCE(
    NULLIF(v_data ->> 'left_via', ''),
    NULLIF(v_data ->> 'leftVia', ''),
    ''
  )));
  v_source text := lower(trim(COALESCE(v_data ->> 'source', '')));
  v_update_type text := lower(trim(COALESCE(
    NULLIF(v_data ->> 'update_type', ''),
    NULLIF(v_data ->> 'updateType', ''),
    ''
  )));
  v_push_relevant text := lower(trim(COALESCE(
    NULLIF(v_data ->> 'push_relevant', ''),
    NULLIF(v_data ->> 'pushRelevant', ''),
    ''
  )));
  v_text text := lower(trim(COALESCE(p_title, '') || ' ' || COALESCE(p_message, '')));
BEGIN
  IF p_recipient_user_id IS NOT NULL
     AND v_actor_user_id IS NOT NULL
     AND v_actor_user_id = p_recipient_user_id::text
  THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'actor_recipient');
  END IF;

  IF v_joined_via <> '' THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'handled_by_match_player_joined_push');
  END IF;

  IF v_left_via <> '' THEN
    IF v_left_via = 'admin_transfer' THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'admin_transfer_has_dedicated_push');
    END IF;
    RETURN jsonb_build_object('allowed', false, 'reason', 'handled_by_match_player_left_push');
  END IF;

  IF v_source = 'team_challenge'
     OR NULLIF(trim(COALESCE(v_data ->> 'challenge_id', '')), '') IS NOT NULL
     OR NULLIF(trim(COALESCE(v_data ->> 'challengeId', '')), '') IS NOT NULL
  THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'handled_by_challenge_accepted_push');
  END IF;

  IF v_push_relevant IN ('true', '1', 'yes', 'si', 'sí') THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'explicit_push_relevant');
  END IF;

  IF v_update_type IN (
    'rescheduled',
    'location_changed',
    'venue_changed',
    'time_changed',
    'date_changed',
    'cancelled',
    'canceled',
    'suspended'
  ) THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'relevant_update_type');
  END IF;

  IF v_text LIKE '%invitaci%n rechaz%'
     OR v_text LIKE '%reprogram%'
     OR v_text LIKE '%cambio de sede%'
     OR v_text LIKE '%cambio de cancha%'
     OR v_text LIKE '%cambio de hora%'
     OR v_text LIKE '%cambio de fecha%'
     OR v_text LIKE '%cancelad%'
     OR v_text LIKE '%suspend%'
  THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'relevant_match_update_copy');
  END IF;

  RETURN jsonb_build_object('allowed', false, 'reason', 'non_relevant_match_update');
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_remote_push_from_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_channel text;
  v_partido_id bigint;
  v_correlation_id uuid := gen_random_uuid();
  v_payload jsonb;
  v_push_enabled boolean := true;
  v_is_active boolean := false;
  v_last_seen_partido_id bigint := NULL;
  v_admin_id uuid := NULL;
  v_existing_group_id uuid;
  v_existing_group_count int := 1;
  v_existing_count int := 0;
  v_skip_reason text;
  v_now timestamptz := now();
  v_push_dedupe_key text;
  v_match_update_decision jsonb;
BEGIN
  IF to_regclass('public.notification_delivery_log') IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS NULL OR COALESCE(NEW.read, false) = true THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.read, false) = COALESCE(NEW.read, false)
     AND OLD.title IS NOT DISTINCT FROM NEW.title
     AND OLD.message IS NOT DISTINCT FROM NEW.message
     AND OLD.data IS NOT DISTINCT FROM NEW.data
  THEN
    RETURN NEW;
  END IF;

  v_channel := public.notification_event_channel(NEW.type);
  v_partido_id := public.notification_resolve_partido_id(NEW.partido_id, NEW.data);

  -- These event families are dispatched by targeted kick flows to avoid double
  -- sends and preserve their specialized recipient filters.
  IF v_channel IN ('JOIN_REQUEST', 'VOTE_REQUEST') THEN
    RETURN NEW;
  END IF;

  IF NEW.type = 'match_kicked' THEN
    RETURN NEW;
  END IF;

  IF NOT public.notification_channel_allows_push(v_channel) THEN
    INSERT INTO public.notification_delivery_log (
      partido_id,
      user_id,
      notification_type,
      payload_json,
      correlation_id,
      channel,
      status,
      error_text
    ) VALUES (
      v_partido_id,
      NEW.user_id,
      NEW.type,
      jsonb_build_object(
        'event_channel', v_channel,
        'notification_id', NEW.id
      ),
      v_correlation_id,
      'push',
      'skipped',
      'in_app_only_channel'
    );

    RETURN NEW;
  END IF;

  IF to_regclass('public.usuarios') IS NOT NULL THEN
    BEGIN
      SELECT
        COALESCE(u.push_enabled, true),
        COALESCE(u.is_active, false),
        u.last_seen_partido_id
      INTO
        v_push_enabled,
        v_is_active,
        v_last_seen_partido_id
      FROM public.usuarios u
      WHERE u.id = NEW.user_id;
    EXCEPTION
      WHEN undefined_column THEN
        v_push_enabled := true;
        v_is_active := false;
        v_last_seen_partido_id := NULL;
    END;
  END IF;

  IF COALESCE(v_push_enabled, true) = false THEN
    INSERT INTO public.notification_delivery_log (
      partido_id,
      user_id,
      notification_type,
      payload_json,
      correlation_id,
      channel,
      status,
      error_text
    ) VALUES (
      v_partido_id,
      NEW.user_id,
      NEW.type,
      jsonb_build_object(
        'event_channel', v_channel,
        'notification_id', NEW.id
      ),
      v_correlation_id,
      'push',
      'skipped',
      'push_disabled'
    );

    RETURN NEW;
  END IF;

  IF v_channel = 'MATCH_UPDATE' THEN
    v_match_update_decision := public.match_update_push_decision(
      NEW.user_id,
      NEW.title,
      NEW.message,
      NEW.data
    );

    IF COALESCE((v_match_update_decision ->> 'allowed')::boolean, false) = false THEN
      INSERT INTO public.notification_delivery_log (
        partido_id,
        user_id,
        notification_type,
        payload_json,
        correlation_id,
        channel,
        status,
        error_text
      ) VALUES (
        v_partido_id,
        NEW.user_id,
        NEW.type,
        jsonb_build_object(
          'event_channel', v_channel,
          'notification_id', NEW.id,
          'match_update_push_policy', v_match_update_decision
        ),
        v_correlation_id,
        'push',
        'skipped',
        COALESCE(v_match_update_decision ->> 'reason', 'non_relevant_match_update')
      );

      RETURN NEW;
    END IF;
  END IF;

  IF v_partido_id IS NOT NULL
     AND COALESCE(v_is_active, false)
     AND v_last_seen_partido_id = v_partido_id
     AND v_channel NOT IN ('CANCELLATION')
  THEN
    INSERT INTO public.notification_delivery_log (
      partido_id,
      user_id,
      notification_type,
      payload_json,
      correlation_id,
      channel,
      status,
      error_text
    ) VALUES (
      v_partido_id,
      NEW.user_id,
      NEW.type,
      jsonb_build_object(
        'event_channel', v_channel,
        'notification_id', NEW.id
      ),
      v_correlation_id,
      'push',
      'skipped',
      'user_active_on_match'
    );

    RETURN NEW;
  END IF;

  v_push_dedupe_key := public.notification_push_dedupe_key(NEW.type, v_partido_id, NEW.data);

  IF v_push_dedupe_key IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.notification_delivery_log l
       WHERE l.channel = 'push'
         AND l.user_id = NEW.user_id
         AND COALESCE(l.payload_json ->> 'push_dedupe_key', '') = v_push_dedupe_key
         AND l.status IN ('queued', 'processing', 'sent', 'retryable_failed')
         AND l.created_at >= v_now - interval '30 days'
     )
  THEN
    INSERT INTO public.notification_delivery_log (
      partido_id,
      user_id,
      notification_type,
      payload_json,
      correlation_id,
      channel,
      status,
      error_text
    ) VALUES (
      v_partido_id,
      NEW.user_id,
      NEW.type,
      jsonb_build_object(
        'event_channel', v_channel,
        'notification_id', NEW.id,
        'push_dedupe_key', v_push_dedupe_key
      ),
      v_correlation_id,
      'push',
      'skipped',
      'duplicate_push_dedupe_key'
    );

    RETURN NEW;
  END IF;

  -- JOIN_REQUEST/VOTE_REQUEST aggregation window retained for compatibility
  -- with older deployments where those channels are not short-circuited above.
  IF v_channel IN ('JOIN_REQUEST', 'VOTE_REQUEST') AND v_partido_id IS NOT NULL THEN
    SELECT
      l.id,
      COALESCE(NULLIF((l.payload_json ->> 'group_count')::int, 0), 1)
    INTO
      v_existing_group_id,
      v_existing_group_count
    FROM public.notification_delivery_log l
    WHERE l.channel = 'push'
      AND l.user_id = NEW.user_id
      AND l.partido_id = v_partido_id
      AND COALESCE(l.payload_json ->> 'event_channel', '') = v_channel
      AND (
        (
          l.status IN ('queued', 'processing', 'sent')
          AND l.created_at >= v_now - interval '5 minutes'
        )
        OR (
          l.status = 'retryable_failed'
          AND COALESCE(l.next_retry_at, l.created_at) >= v_now - interval '5 minutes'
        )
      )
    ORDER BY l.created_at DESC
    LIMIT 1;

    IF v_existing_group_id IS NOT NULL THEN
      v_existing_group_count := GREATEST(v_existing_group_count + 1, 2);

      UPDATE public.notification_delivery_log
      SET payload_json = COALESCE(payload_json, '{}'::jsonb) || jsonb_build_object(
        'event_channel', v_channel,
        'grouped', true,
        'group_count', v_existing_group_count,
        'title', CASE
          WHEN v_channel = 'JOIN_REQUEST' THEN 'Nuevas solicitudes para unirse'
          ELSE 'Nuevos pedidos para votar'
        END,
        'message', CASE
          WHEN v_channel = 'JOIN_REQUEST'
            THEN format('Tenés %s solicitudes para revisar en este partido.', v_existing_group_count)
          ELSE format('Tenés %s pedidos para votar en este partido.', v_existing_group_count)
        END,
        'last_notification_id', NEW.id,
        'last_created_at', NEW.created_at
      )
      WHERE id = v_existing_group_id;

      v_skip_reason := format('grouped_with_%s', v_existing_group_id::text);
      INSERT INTO public.notification_delivery_log (
        partido_id,
        user_id,
        notification_type,
        payload_json,
        correlation_id,
        channel,
        status,
        error_text
      ) VALUES (
        v_partido_id,
        NEW.user_id,
        NEW.type,
        jsonb_build_object(
          'event_channel', v_channel,
          'notification_id', NEW.id,
          'grouped_into', v_existing_group_id
        ),
        v_correlation_id,
        'push',
        'skipped',
        v_skip_reason
      );

      RETURN NEW;
    END IF;
  END IF;

  -- Cooldown 30m by (user_id, partido_id, channel), except immediate/critical
  -- channels. This is what keeps relevant match_update pushes from becoming
  -- spam when minor edits arrive close together.
  IF v_channel NOT IN ('CANCELLATION', 'REMINDER')
     AND v_partido_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.notification_delivery_log l
       WHERE l.channel = 'push'
         AND l.user_id = NEW.user_id
         AND l.partido_id = v_partido_id
         AND COALESCE(l.payload_json ->> 'event_channel', '') = v_channel
         AND (
           (
             l.status IN ('queued', 'processing', 'sent')
             AND l.created_at >= v_now - interval '30 minutes'
           )
           OR (
             l.status = 'retryable_failed'
             AND COALESCE(l.next_retry_at, l.created_at) >= v_now - interval '30 minutes'
           )
         )
     )
  THEN
    INSERT INTO public.notification_delivery_log (
      partido_id,
      user_id,
      notification_type,
      payload_json,
      correlation_id,
      channel,
      status,
      error_text
    ) VALUES (
      v_partido_id,
      NEW.user_id,
      NEW.type,
      jsonb_build_object(
        'event_channel', v_channel,
        'notification_id', NEW.id
      ),
      v_correlation_id,
      'push',
      'skipped',
      'cooldown_30m'
    );

    RETURN NEW;
  END IF;

  -- Survey policy: max 2 survey-form pushes per (user, match): first push +
  -- optional reminder. Results/awards use distinct channels above.
  IF v_channel = 'SURVEY' AND v_partido_id IS NOT NULL THEN
    SELECT count(*)
    INTO v_existing_count
    FROM public.notification_delivery_log l
    WHERE l.channel = 'push'
      AND l.user_id = NEW.user_id
      AND l.partido_id = v_partido_id
      AND COALESCE(l.payload_json ->> 'event_channel', '') = 'SURVEY'
      AND (
        l.status IN ('queued', 'processing', 'sent')
        OR (
          l.status = 'retryable_failed'
          AND COALESCE(l.next_retry_at, l.created_at) >= v_now - interval '24 hours'
        )
      );

    IF v_existing_count >= 2 THEN
      INSERT INTO public.notification_delivery_log (
        partido_id,
        user_id,
        notification_type,
        payload_json,
        correlation_id,
        channel,
        status,
        error_text
      ) VALUES (
        v_partido_id,
        NEW.user_id,
        NEW.type,
        jsonb_build_object(
          'event_channel', v_channel,
          'notification_id', NEW.id
        ),
        v_correlation_id,
        'push',
        'skipped',
        'survey_push_limit_reached'
      );

      RETURN NEW;
    END IF;
  END IF;

  v_payload := COALESCE(NEW.data, '{}'::jsonb) || jsonb_build_object(
    'event_channel', v_channel,
    'notification_id', NEW.id,
    'notification_type', NEW.type,
    'title', NEW.title,
    'message', NEW.message,
    'partido_id', v_partido_id,
    'source', CASE WHEN TG_OP = 'UPDATE' THEN 'notifications_update' ELSE 'notifications_insert' END
  );

  IF v_push_dedupe_key IS NOT NULL THEN
    v_payload := v_payload || jsonb_build_object('push_dedupe_key', v_push_dedupe_key);
  END IF;

  IF v_channel = 'MATCH_UPDATE' AND v_match_update_decision IS NOT NULL THEN
    v_payload := v_payload || jsonb_build_object('match_update_push_policy', v_match_update_decision);
  END IF;

  INSERT INTO public.notification_delivery_log (
    partido_id,
    user_id,
    notification_type,
    payload_json,
    correlation_id,
    channel,
    status
  ) VALUES (
    v_partido_id,
    NEW.user_id,
    NEW.type,
    v_payload,
    v_correlation_id,
    'push',
    'queued'
  );

  RETURN NEW;
END;
$$;

COMMIT;
