CREATE OR REPLACE FUNCTION public.normalize_notification_identity_ref(
  p_value text
) RETURNS text AS $$
  SELECT NULLIF(lower(trim(COALESCE(p_value, ''))), '');
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.collect_notification_refs_from_team_payload(
  p_payload jsonb
) RETURNS text[] AS $$
DECLARE
  v_refs text[] := ARRAY[]::text[];
BEGIN
  IF jsonb_typeof(COALESCE(p_payload, 'null'::jsonb)) <> 'array' THEN
    RETURN v_refs;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT ref), ARRAY[]::text[])
  INTO v_refs
  FROM (
    SELECT public.normalize_notification_identity_ref(
      CASE
        WHEN jsonb_typeof(player) = 'object' THEN
          COALESCE(
            player ->> 'usuario_id',
            player ->> 'uuid',
            player ->> 'id',
            player ->> 'nombre'
          )
        ELSE trim(both '"' FROM player::text)
      END
    ) AS ref
    FROM jsonb_array_elements(COALESCE(p_payload, '[]'::jsonb)) team
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(COALESCE(team -> 'players', 'null'::jsonb)) = 'array'
          THEN team -> 'players'
        ELSE '[]'::jsonb
      END
    ) player
  ) collected
  WHERE ref IS NOT NULL;

  RETURN COALESCE(v_refs, ARRAY[]::text[]);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.resolve_partido_notification_recipients_from_refs(
  p_partido_id bigint,
  p_refs text[]
) RETURNS uuid[] AS $$
DECLARE
  v_recipients uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_partido_id IS NULL OR p_partido_id <= 0 OR COALESCE(array_length(p_refs, 1), 0) = 0 THEN
    RETURN v_recipients;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT j.usuario_id), ARRAY[]::uuid[])
  INTO v_recipients
  FROM public.jugadores j
  WHERE j.partido_id = p_partido_id
    AND j.usuario_id IS NOT NULL
    AND (
      public.normalize_notification_identity_ref(j.usuario_id::text) = ANY(p_refs)
      OR public.normalize_notification_identity_ref(j.uuid::text) = ANY(p_refs)
      OR public.normalize_notification_identity_ref(j.id::text) = ANY(p_refs)
      OR public.normalize_notification_identity_ref(j.nombre) = ANY(p_refs)
    );

  RETURN COALESCE(v_recipients, ARRAY[]::uuid[]);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.resolve_partido_survey_notification_recipients(
  p_partido_id bigint
) RETURNS uuid[] AS $$
DECLARE
  v_recipients uuid[] := ARRAY[]::uuid[];
  v_refs text[] := ARRAY[]::text[];
  v_payload jsonb := NULL;
BEGIN
  IF p_partido_id IS NULL OR p_partido_id <= 0 THEN
    RETURN v_recipients;
  END IF;

  -- 1) Effective confirmed participants of the match.
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT uid), ARRAY[]::uuid[])
    INTO v_recipients
    FROM (
      SELECT CASE
        WHEN token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN token::uuid
        ELSE NULL::uuid
      END AS uid
      FROM public.partido_team_confirmations ptc
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(COALESCE(ptc.participants, 'null'::jsonb)) = 'array'
            THEN ptc.participants
          ELSE '[]'::jsonb
        END
      ) participant
      CROSS JOIN LATERAL (
        VALUES (
          public.normalize_notification_identity_ref(
            COALESCE(
              participant ->> 'user_id',
              participant -> 'jugador' ->> 'usuario_id',
              participant ->> 'usuario_id'
            )
          )
        )
      ) candidate(token)
      WHERE ptc.partido_id = p_partido_id
    ) resolved
    WHERE uid IS NOT NULL;
  EXCEPTION
    WHEN undefined_table OR undefined_column THEN
      v_recipients := ARRAY[]::uuid[];
  END;

  IF COALESCE(array_length(v_recipients, 1), 0) > 0 THEN
    RETURN v_recipients;
  END IF;

  -- 2) Confirmed effective roster refs from participants/teams.
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT ref), ARRAY[]::text[])
    INTO v_refs
    FROM (
      SELECT public.normalize_notification_identity_ref(candidate_value) AS ref
      FROM public.partido_team_confirmations ptc
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(COALESCE(ptc.participants, 'null'::jsonb)) = 'array'
            THEN ptc.participants
          ELSE '[]'::jsonb
        END
      ) participant
      CROSS JOIN LATERAL (
        VALUES
          (
            COALESCE(
              participant ->> 'user_id',
              participant -> 'jugador' ->> 'usuario_id',
              participant ->> 'usuario_id'
            )
          ),
          (participant -> 'jugador' ->> 'uuid'),
          (participant -> 'jugador' ->> 'id'),
          (participant -> 'jugador' ->> 'nombre')
      ) candidate(candidate_value)
      WHERE ptc.partido_id = p_partido_id

      UNION

      SELECT public.normalize_notification_identity_ref(uid::text) AS ref
      FROM public.partido_team_confirmations ptc
      CROSS JOIN LATERAL unnest(COALESCE(ptc.team_a, ARRAY[]::uuid[])) uid
      WHERE ptc.partido_id = p_partido_id

      UNION

      SELECT public.normalize_notification_identity_ref(uid::text) AS ref
      FROM public.partido_team_confirmations ptc
      CROSS JOIN LATERAL unnest(COALESCE(ptc.team_b, ARRAY[]::uuid[])) uid
      WHERE ptc.partido_id = p_partido_id

      UNION

      SELECT ref_value AS ref
      FROM public.partido_team_confirmations ptc
      CROSS JOIN LATERAL unnest(
        public.collect_notification_refs_from_team_payload(COALESCE(ptc.teams_json, '[]'::jsonb))
      ) AS teams_json_refs(ref_value)
      WHERE ptc.partido_id = p_partido_id
    ) confirmed_refs
    WHERE ref IS NOT NULL;
  EXCEPTION
    WHEN undefined_table OR undefined_column THEN
      v_refs := ARRAY[]::text[];
  END;

  v_recipients := public.resolve_partido_notification_recipients_from_refs(p_partido_id, v_refs);
  IF COALESCE(array_length(v_recipients, 1), 0) > 0 THEN
    RETURN v_recipients;
  END IF;

  -- 3) Persisted effective roster payload on the match.
  BEGIN
    SELECT p.equipos_json
    INTO v_payload
    FROM public.partidos p
    WHERE p.id = p_partido_id;

    v_refs := public.collect_notification_refs_from_team_payload(v_payload);
  EXCEPTION
    WHEN undefined_column THEN
      v_refs := ARRAY[]::text[];
  END;

  v_recipients := public.resolve_partido_notification_recipients_from_refs(p_partido_id, v_refs);
  IF COALESCE(array_length(v_recipients, 1), 0) > 0 THEN
    RETURN v_recipients;
  END IF;

  BEGIN
    SELECT p.equipos::jsonb
    INTO v_payload
    FROM public.partidos p
    WHERE p.id = p_partido_id;

    v_refs := public.collect_notification_refs_from_team_payload(v_payload);
  EXCEPTION
    WHEN undefined_column OR invalid_text_representation THEN
      v_refs := ARRAY[]::text[];
  END;

  v_recipients := public.resolve_partido_notification_recipients_from_refs(p_partido_id, v_refs);
  IF COALESCE(array_length(v_recipients, 1), 0) > 0 THEN
    RETURN v_recipients;
  END IF;

  -- 4) Persisted survey/final teams.
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT ref), ARRAY[]::text[])
    INTO v_refs
    FROM (
      SELECT public.normalize_notification_identity_ref(ref_value) AS ref
      FROM public.partidos p
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(COALESCE(p.survey_team_a, 'null'::jsonb)) = 'array'
            AND jsonb_array_length(p.survey_team_a) > 0
            THEN p.survey_team_a
          WHEN jsonb_typeof(COALESCE(p.final_team_a, 'null'::jsonb)) = 'array'
            THEN p.final_team_a
          ELSE '[]'::jsonb
        END
      ) AS team_a_refs(ref_value)
      WHERE p.id = p_partido_id

      UNION

      SELECT public.normalize_notification_identity_ref(ref_value) AS ref
      FROM public.partidos p
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(COALESCE(p.survey_team_b, 'null'::jsonb)) = 'array'
            AND jsonb_array_length(p.survey_team_b) > 0
            THEN p.survey_team_b
          WHEN jsonb_typeof(COALESCE(p.final_team_b, 'null'::jsonb)) = 'array'
            THEN p.final_team_b
          ELSE '[]'::jsonb
        END
      ) AS team_b_refs(ref_value)
      WHERE p.id = p_partido_id
    ) persisted_refs
    WHERE ref IS NOT NULL;
  EXCEPTION
    WHEN undefined_column THEN
      v_refs := ARRAY[]::text[];
  END;

  v_recipients := public.resolve_partido_notification_recipients_from_refs(p_partido_id, v_refs);
  IF COALESCE(array_length(v_recipients, 1), 0) > 0 THEN
    RETURN v_recipients;
  END IF;

  -- 5) Defensive fallback: starter roster only.
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT j.usuario_id), ARRAY[]::uuid[])
    INTO v_recipients
    FROM public.jugadores j
    WHERE j.partido_id = p_partido_id
      AND j.usuario_id IS NOT NULL
      AND COALESCE(j.is_substitute, false) = false;
  EXCEPTION
    WHEN undefined_column THEN
      v_recipients := ARRAY[]::uuid[];
  END;

  IF COALESCE(array_length(v_recipients, 1), 0) > 0 THEN
    RETURN v_recipients;
  END IF;

  RETURN COALESCE(v_recipients, ARRAY[]::uuid[]);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.normalize_notification_identity_ref(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_notification_identity_ref(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.collect_notification_refs_from_team_payload(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.collect_notification_refs_from_team_payload(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_partido_notification_recipients_from_refs(bigint, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_partido_notification_recipients_from_refs(bigint, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_partido_survey_notification_recipients(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_partido_survey_notification_recipients(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.send_call_to_vote(
  p_partido_id bigint,
  p_title text DEFAULT '¡Hora de votar!',
  p_message text DEFAULT 'Entrá a la app y calificá a los jugadores para armar los equipos.'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows_affected int := 0;
  v_match_code text;
  v_gate record;
  v_recipients uuid[] := ARRAY[]::uuid[];
BEGIN
  SELECT codigo
  INTO v_match_code
  FROM public.partidos
  WHERE id = p_partido_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partido % not found', p_partido_id;
  END IF;

  SELECT *
  INTO v_gate
  FROM public.get_match_post_match_gate(p_partido_id);

  IF COALESCE(v_gate.qualifies, false) = false THEN
    PERFORM public.mark_match_assumed_not_played(
      p_partido_id,
      COALESCE(v_gate.reason, 'match_assumed_not_played')
    );

    RETURN jsonb_build_object(
      'success', false,
      'reason', COALESCE(v_gate.reason, 'incomplete_roster_for_match_type'),
      'match_assumed_not_played', true,
      'modalidad', v_gate.modalidad,
      'cupo_jugadores', v_gate.cupo_jugadores,
      'starter_slots', v_gate.starter_slots,
      'required_players', v_gate.required_players,
      'roster_count', v_gate.roster_count,
      'registered_roster_count', v_gate.registered_roster_count
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.notifications
    WHERE (
      (data ->> 'match_id')::text = p_partido_id::text
      OR (data ->> 'matchId')::text = p_partido_id::text
    )
    AND type IN ('survey_start', 'post_match_survey', 'survey_reminder', 'survey_reminder_12h')
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'survey_exists');
  END IF;

  v_recipients := public.resolve_partido_survey_notification_recipients(p_partido_id);

  WITH recipients AS (
    SELECT DISTINCT uid AS user_id
    FROM unnest(COALESCE(v_recipients, ARRAY[]::uuid[])) uid
    WHERE uid IS NOT NULL
  ),
  upserted AS (
    INSERT INTO public.notifications (
      user_id,
      title,
      message,
      type,
      partido_id,
      data,
      read,
      created_at,
      send_at
    )
    SELECT
      r.user_id,
      p_title,
      p_message,
      'call_to_vote',
      p_partido_id,
      jsonb_build_object(
        'match_id', p_partido_id::text,
        'matchId', p_partido_id,
        'matchCode', v_match_code
      ),
      false,
      now(),
      now()
    FROM recipients r
    ON CONFLICT (user_id, (data ->> 'match_id'), type)
    DO UPDATE SET
      title = EXCLUDED.title,
      message = EXCLUDED.message,
      partido_id = EXCLUDED.partido_id,
      data = EXCLUDED.data,
      read = false,
      send_at = now()
    RETURNING id
  )
  SELECT count(*) INTO v_rows_affected FROM upserted;

  RETURN jsonb_build_object('success', true, 'inserted', v_rows_affected);
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_partido_notification(
  p_partido_id bigint,
  p_type text,
  p_title text DEFAULT NULL,
  p_message text DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb AS $$
DECLARE
  v_correlation_id uuid := gen_random_uuid();
  v_recipient_id uuid;
  v_recipients uuid[];
  v_count int := 0;
  v_admin_id uuid;
  v_mutated_rows int := 0;
BEGIN
  SELECT creado_por INTO v_admin_id
  FROM public.partidos
  WHERE id = p_partido_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partido % not found', p_partido_id;
  END IF;

  CASE p_type
    WHEN 'call_to_vote', 'survey_start', 'post_match_survey', 'survey_reminder', 'survey_reminder_12h' THEN
      v_recipients := public.resolve_partido_survey_notification_recipients(p_partido_id);
    WHEN 'match_cancelled', 'match_deleted', 'match_kicked', 'survey_results_ready', 'awards_ready', 'match_reminder_1h' THEN
      SELECT ARRAY_AGG(DISTINCT usuario_id)
      INTO v_recipients
      FROM public.jugadores
      WHERE partido_id = p_partido_id
        AND usuario_id IS NOT NULL;

      IF v_admin_id IS NOT NULL THEN
        v_recipients := array_append(v_recipients, v_admin_id);
      END IF;
    ELSE
      v_recipients := ARRAY[v_admin_id];
  END CASE;

  v_recipients := ARRAY(
    SELECT DISTINCT uid
    FROM unnest(COALESCE(v_recipients, ARRAY[]::uuid[])) AS uid
    WHERE uid IS NOT NULL
  );

  FOREACH v_recipient_id IN ARRAY v_recipients
  LOOP
    IF EXISTS (
      SELECT 1
      FROM auth.users au
      WHERE au.id = v_recipient_id
    ) THEN
      v_mutated_rows := 0;

      BEGIN
        IF p_type = 'match_update' THEN
          INSERT INTO public.notifications (
            user_id,
            partido_id,
            type,
            title,
            message,
            data,
            read,
            created_at,
            send_at
          ) VALUES (
            v_recipient_id,
            p_partido_id,
            p_type,
            COALESCE(p_title, 'Notificación de partido'),
            COALESCE(p_message, 'Tienes una nueva notificación'),
            COALESCE(p_payload, '{}'::jsonb),
            false,
            now(),
            now()
          )
          ON CONFLICT DO NOTHING;

          GET DIAGNOSTICS v_mutated_rows = ROW_COUNT;

          IF v_mutated_rows = 0 THEN
            UPDATE public.notifications
            SET
              partido_id = p_partido_id,
              title = COALESCE(p_title, 'Notificación de partido'),
              message = COALESCE(p_message, 'Tienes una nueva notificación'),
              data = COALESCE(p_payload, '{}'::jsonb),
              read = false,
              created_at = now(),
              send_at = now()
            WHERE user_id = v_recipient_id
              AND type = p_type
              AND (
                partido_id = p_partido_id
                OR COALESCE(
                  data ->> 'match_id',
                  data ->> 'matchId',
                  data ->> 'partido_id',
                  data ->> 'partidoId'
                ) = p_partido_id::text
              );

            GET DIAGNOSTICS v_mutated_rows = ROW_COUNT;
          END IF;
        ELSE
          INSERT INTO public.notifications (
            user_id,
            partido_id,
            type,
            title,
            message,
            data,
            read
          ) VALUES (
            v_recipient_id,
            p_partido_id,
            p_type,
            COALESCE(p_title, 'Notificación de partido'),
            COALESCE(p_message, 'Tienes una nueva notificación'),
            COALESCE(p_payload, '{}'::jsonb),
            false
          )
          ON CONFLICT DO NOTHING;

          GET DIAGNOSTICS v_mutated_rows = ROW_COUNT;
        END IF;
      EXCEPTION
        WHEN foreign_key_violation THEN
          IF to_regclass('public.notification_delivery_log') IS NOT NULL THEN
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
              p_partido_id,
              NULL,
              p_type,
              COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object('skipped_user_id', v_recipient_id::text),
              v_correlation_id,
              'in_app',
              'skipped',
              COALESCE(SQLERRM, format('Skipped recipient %s due FK violation on notifications', v_recipient_id))
            ) ON CONFLICT DO NOTHING;
          END IF;
          CONTINUE;
      END;

      IF v_mutated_rows > 0 THEN
        IF to_regclass('public.notification_delivery_log') IS NOT NULL THEN
          INSERT INTO public.notification_delivery_log (
            partido_id,
            user_id,
            notification_type,
            payload_json,
            correlation_id,
            channel,
            status
          ) VALUES (
            p_partido_id,
            v_recipient_id,
            p_type,
            COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object(
              'event_channel', public.notification_event_channel(p_type)
            ),
            v_correlation_id,
            'in_app',
            'queued'
          ) ON CONFLICT DO NOTHING;
        END IF;

        v_count := v_count + 1;
      END IF;
    ELSE
      IF to_regclass('public.notification_delivery_log') IS NOT NULL THEN
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
          p_partido_id,
          NULL,
          p_type,
          COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object('skipped_user_id', v_recipient_id::text),
          v_correlation_id,
          'in_app',
          'skipped',
          format('Skipped recipient %s because user does not exist in auth.users', v_recipient_id)
        ) ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'correlation_id', v_correlation_id,
    'recipients_count', v_count,
    'recipients', COALESCE(v_recipients, ARRAY[]::uuid[])
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.send_call_to_vote(bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_call_to_vote(bigint, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_partido_notification(bigint, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_partido_notification(bigint, text, text, text, jsonb) TO service_role;
