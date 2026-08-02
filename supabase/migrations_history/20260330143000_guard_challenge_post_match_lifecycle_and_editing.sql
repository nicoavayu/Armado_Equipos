BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_survey_notification_match_name(p_nombre text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN NULLIF(trim(COALESCE(p_nombre, '')), '') IS NULL THEN 'este partido'
    WHEN trim(COALESCE(p_nombre, '')) ~ '^[0-9]+$' THEN 'este partido'
    ELSE trim(COALESCE(p_nombre, ''))
  END;
$$;

CREATE OR REPLACE FUNCTION public.is_pending_challenge_team_match_for_post_match(
  p_partido_id bigint
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_matches tm
    WHERE tm.partido_id = p_partido_id
      AND tm.challenge_id IS NOT NULL
      AND lower(COALESCE(tm.status, '')) NOT IN ('played', 'cancelled', 'canceled', 'cancelado')
  );
$$;

CREATE OR REPLACE FUNCTION public.resolve_challenge_post_match_gate(
  p_partido_id bigint
)
RETURNS TABLE (
  team_match_id uuid,
  challenge_id uuid,
  is_pending boolean,
  required_players_per_team integer,
  team_a_count integer,
  team_b_count integer,
  registered_team_a_count integer,
  registered_team_b_count integer,
  team_a_refs text[],
  team_b_refs text[]
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_team_match public.team_matches%ROWTYPE;
  v_modalidad text;
  v_format_token text[];
  v_required_per_team integer := 0;
BEGIN
  IF p_partido_id IS NULL OR p_partido_id <= 0 THEN
    RETURN;
  END IF;

  SELECT *
  INTO v_team_match
  FROM public.team_matches tm
  WHERE tm.partido_id = p_partido_id
    AND tm.challenge_id IS NOT NULL
  ORDER BY tm.updated_at DESC NULLS LAST, tm.created_at DESC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT p.modalidad
  INTO v_modalidad
  FROM public.partidos p
  WHERE p.id = p_partido_id;

  v_required_per_team := GREATEST(COALESCE(v_team_match.format, 0), 0);
  IF v_required_per_team <= 0 THEN
    v_format_token := regexp_match(
      upper(regexp_replace(COALESCE(v_modalidad, ''), '\s+', '', 'g')),
      '^F([0-9]+)$'
    );
    IF v_format_token IS NOT NULL THEN
      v_required_per_team := COALESCE(v_format_token[1], '0')::integer;
    END IF;
  END IF;

  IF v_required_per_team <= 0 THEN
    v_required_per_team := 5;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT 1 AS anchor
  ),
  selected_rows AS (
    SELECT
      cts.team_id,
      CASE
        WHEN j.usuario_id IS NOT NULL THEN j.usuario_id::text
        WHEN j.uuid IS NOT NULL THEN j.uuid::text
        ELSE j.id::text
      END AS roster_ref,
      (j.usuario_id IS NOT NULL) AS is_registered
    FROM public.challenge_team_squad cts
    JOIN public.jugadores j
      ON j.id = cts.player_id
    WHERE cts.challenge_id = v_team_match.challenge_id
      AND cts.team_id IN (v_team_match.team_a_id, v_team_match.team_b_id)
      AND cts.approved_by_captain = true
      AND lower(COALESCE(cts.selection_status, '')) IN ('starter', 'substitute')
  )
  SELECT
    v_team_match.id,
    v_team_match.challenge_id,
    lower(COALESCE(v_team_match.status, '')) NOT IN ('played', 'cancelled', 'canceled', 'cancelado') AS is_pending,
    v_required_per_team,
    COUNT(*) FILTER (WHERE sr.team_id = v_team_match.team_a_id)::integer,
    COUNT(*) FILTER (WHERE sr.team_id = v_team_match.team_b_id)::integer,
    COUNT(*) FILTER (WHERE sr.team_id = v_team_match.team_a_id AND sr.is_registered)::integer,
    COUNT(*) FILTER (WHERE sr.team_id = v_team_match.team_b_id AND sr.is_registered)::integer,
    COALESCE(
      array_agg(DISTINCT sr.roster_ref ORDER BY sr.roster_ref)
        FILTER (WHERE sr.team_id = v_team_match.team_a_id AND sr.roster_ref IS NOT NULL),
      ARRAY[]::text[]
    ),
    COALESCE(
      array_agg(DISTINCT sr.roster_ref ORDER BY sr.roster_ref)
        FILTER (WHERE sr.team_id = v_team_match.team_b_id AND sr.roster_ref IS NOT NULL),
      ARRAY[]::text[]
    )
  FROM base
  LEFT JOIN selected_rows sr
    ON true;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_match_post_match_gate(
  p_partido_id bigint
)
RETURNS TABLE (
  qualifies boolean,
  reason text,
  modalidad text,
  cupo_jugadores integer,
  starter_slots integer,
  required_players integer,
  roster_count integer,
  registered_roster_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_modalidad text;
  v_cupo integer;
  v_starter_slots integer;
  v_required_players integer;
  v_has_is_substitute boolean := false;
  v_roster_count integer := 0;
  v_registered_roster_count integer := 0;
  v_starter_roster_count integer := 0;
  v_registered_starter_roster_count integer := 0;
  v_challenge_gate record;
BEGIN
  IF p_partido_id IS NULL OR p_partido_id <= 0 THEN
    RETURN QUERY
    SELECT
      false,
      'invalid_match_id'::text,
      NULL::text,
      NULL::integer,
      NULL::integer,
      NULL::integer,
      0,
      0;
    RETURN;
  END IF;

  SELECT p.modalidad, p.cupo_jugadores
  INTO v_modalidad, v_cupo
  FROM public.partidos p
  WHERE p.id = p_partido_id;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      false,
      'match_not_found'::text,
      NULL::text,
      NULL::integer,
      NULL::integer,
      NULL::integer,
      0,
      0;
    RETURN;
  END IF;

  SELECT *
  INTO v_challenge_gate
  FROM public.resolve_challenge_post_match_gate(p_partido_id);

  IF v_challenge_gate.team_match_id IS NOT NULL THEN
    v_starter_slots := GREATEST(COALESCE(v_challenge_gate.required_players_per_team, 0), 0) * 2;
    v_required_players := v_starter_slots;
    v_roster_count := COALESCE(v_challenge_gate.team_a_count, 0) + COALESCE(v_challenge_gate.team_b_count, 0);
    v_registered_roster_count := COALESCE(v_challenge_gate.registered_team_a_count, 0) + COALESCE(v_challenge_gate.registered_team_b_count, 0);

    RETURN QUERY
    SELECT
      COALESCE(v_challenge_gate.team_a_count, 0) >= COALESCE(v_challenge_gate.required_players_per_team, 0)
        AND COALESCE(v_challenge_gate.team_b_count, 0) >= COALESCE(v_challenge_gate.required_players_per_team, 0),
      CASE
        WHEN COALESCE(v_challenge_gate.team_a_count, 0) >= COALESCE(v_challenge_gate.required_players_per_team, 0)
          AND COALESCE(v_challenge_gate.team_b_count, 0) >= COALESCE(v_challenge_gate.required_players_per_team, 0)
          THEN 'ok'
        ELSE 'challenge_minimum_not_met'
      END::text,
      v_modalidad,
      v_cupo,
      v_starter_slots,
      v_required_players,
      v_roster_count,
      v_registered_roster_count;
    RETURN;
  END IF;

  v_starter_slots := public.resolve_partido_starter_slots(v_modalidad, v_cupo);
  v_required_players := public.resolve_post_match_required_players(v_starter_slots);

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'jugadores'
      AND column_name = 'is_substitute'
  )
  INTO v_has_is_substitute;

  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE j.usuario_id IS NOT NULL)::integer
  INTO v_roster_count, v_registered_roster_count
  FROM public.jugadores j
  WHERE j.partido_id = p_partido_id;

  IF v_has_is_substitute THEN
    EXECUTE $sql$
      SELECT
        COUNT(*)::integer,
        COUNT(*) FILTER (WHERE j.usuario_id IS NOT NULL)::integer
      FROM public.jugadores j
      WHERE j.partido_id = $1
        AND COALESCE(j.is_substitute, false) = false
    $sql$
    INTO v_starter_roster_count, v_registered_starter_roster_count
    USING p_partido_id;

    IF v_starter_roster_count > 0 THEN
      v_roster_count := v_starter_roster_count;
      v_registered_roster_count := v_registered_starter_roster_count;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    v_roster_count = v_required_players,
    CASE
      WHEN v_roster_count = v_required_players THEN 'ok'
      ELSE 'incomplete_roster_for_match_type'
    END::text,
    v_modalidad,
    v_cupo,
    v_starter_slots,
    v_required_players,
    v_roster_count,
    v_registered_roster_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_pending_challenge_partido_for_post_match(
  p_partido_id bigint,
  p_survey_opened_at timestamptz DEFAULT NULL,
  p_survey_closes_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gate record;
  v_effective_opened_at timestamptz;
  v_effective_closes_at timestamptz;
  v_finished_at timestamptz;
  v_expected_voters integer := 0;
BEGIN
  SELECT *
  INTO v_gate
  FROM public.resolve_challenge_post_match_gate(p_partido_id);

  IF v_gate.team_match_id IS NULL THEN
    RETURN jsonb_build_object('handled', false, 'reason', 'not_challenge_match');
  END IF;

  IF COALESCE(v_gate.is_pending, false) = false THEN
    RETURN jsonb_build_object('handled', false, 'reason', 'challenge_already_closed');
  END IF;

  v_effective_opened_at := COALESCE(
    p_survey_opened_at,
    (SELECT scheduled_at FROM public.team_matches WHERE id = v_gate.team_match_id),
    now()
  );
  v_effective_closes_at := COALESCE(
    p_survey_closes_at,
    v_effective_opened_at + interval '24 hours'
  );
  v_finished_at := COALESCE(
    (SELECT scheduled_at FROM public.team_matches WHERE id = v_gate.team_match_id),
    now()
  );
  v_expected_voters := COALESCE(v_gate.registered_team_a_count, 0) + COALESCE(v_gate.registered_team_b_count, 0);

  UPDATE public.challenges c
  SET
    squad_status = 'finalized',
    squad_closed_at = COALESCE(c.squad_closed_at, now()),
    updated_at = now()
  WHERE c.id = v_gate.challenge_id
    AND c.status NOT IN ('completed', 'canceled');

  IF COALESCE(v_gate.team_a_count, 0) < COALESCE(v_gate.required_players_per_team, 0)
     OR COALESCE(v_gate.team_b_count, 0) < COALESCE(v_gate.required_players_per_team, 0) THEN
    PERFORM public.mark_match_assumed_not_played(
      p_partido_id,
      'challenge_minimum_not_met'
    );

    RETURN jsonb_build_object(
      'handled', true,
      'qualifies', false,
      'reason', 'challenge_minimum_not_met',
      'required_players_per_team', v_gate.required_players_per_team,
      'team_a_count', v_gate.team_a_count,
      'team_b_count', v_gate.team_b_count
    );
  END IF;

  UPDATE public.partidos p
  SET
    estado = 'finalizado',
    survey_status = 'open',
    result_status = 'pending',
    winner_team = NULL,
    finished_at = COALESCE(p.finished_at, v_finished_at),
    survey_opened_at = COALESCE(p.survey_opened_at, v_effective_opened_at),
    survey_closes_at = COALESCE(p.survey_closes_at, v_effective_closes_at),
    survey_expected_voters = GREATEST(COALESCE(p.survey_expected_voters, 0), v_expected_voters),
    survey_team_a = CASE
      WHEN COALESCE(array_length(v_gate.team_a_refs, 1), 0) > 0 THEN to_jsonb(v_gate.team_a_refs)
      ELSE p.survey_team_a
    END,
    survey_team_b = CASE
      WHEN COALESCE(array_length(v_gate.team_b_refs, 1), 0) > 0 THEN to_jsonb(v_gate.team_b_refs)
      ELSE p.survey_team_b
    END,
    final_team_a = CASE
      WHEN COALESCE(array_length(v_gate.team_a_refs, 1), 0) > 0 THEN to_jsonb(v_gate.team_a_refs)
      ELSE p.final_team_a
    END,
    final_team_b = CASE
      WHEN COALESCE(array_length(v_gate.team_b_refs, 1), 0) > 0 THEN to_jsonb(v_gate.team_b_refs)
      ELSE p.final_team_b
    END
  WHERE p.id = p_partido_id;

  RETURN jsonb_build_object(
    'handled', true,
    'qualifies', true,
    'reason', 'ok',
    'required_players_per_team', v_gate.required_players_per_team,
    'team_a_count', v_gate.team_a_count,
    'team_b_count', v_gate.team_b_count,
    'expected_voters', v_expected_voters
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.process_survey_start_notifications_backend(
  p_delay_minutes integer DEFAULT 60,
  p_limit integer DEFAULT 200
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delay interval := make_interval(mins => GREATEST(COALESCE(p_delay_minutes, 60), 0));
  v_now_local timestamp := timezone('America/Argentina/Buenos_Aires', now())::timestamp;
  v_match record;
  v_result jsonb;
  v_gate record;
  v_challenge_prepare jsonb;
  v_scanned int := 0;
  v_notified int := 0;
  v_skipped int := 0;
  v_errors int := 0;
BEGIN
  FOR v_match IN
    WITH candidates AS (
      SELECT
        p.id,
        p.nombre,
        public.resolve_survey_notification_match_name(p.nombre) AS match_display_name,
        p.fecha,
        p.hora,
        (tm.challenge_id IS NOT NULL) AS is_challenge_backed,
        CASE
          WHEN replace(trim(p.hora), '.', ':') ~ '^[0-9]{1,2}:[0-9]{2}' THEN
            p.fecha::timestamp + substring(replace(trim(p.hora), '.', ':') FROM '^[0-9]{1,2}:[0-9]{2}')::time
          ELSE NULL::timestamp
        END AS starts_at_local
      FROM public.partidos p
      LEFT JOIN public.team_matches tm
        ON tm.partido_id = p.id
      WHERE p.fecha IS NOT NULL
        AND p.hora IS NOT NULL
        AND COALESCE(lower(p.estado), 'active') IN ('active', 'activo', 'finalizado', 'finished')
        AND COALESCE(p.surveys_sent, false) = false
    )
    SELECT
      c.id,
      c.nombre,
      c.match_display_name,
      c.fecha,
      c.hora,
      c.is_challenge_backed,
      c.starts_at_local,
      c.starts_at_local
        + CASE
          WHEN c.is_challenge_backed THEN interval '0 minutes'
          ELSE v_delay
        END AS survey_start_local,
      c.starts_at_local
        + CASE
          WHEN c.is_challenge_backed THEN interval '24 hours'
          ELSE v_delay + interval '24 hours'
        END AS survey_deadline_local
    FROM candidates c
    WHERE c.starts_at_local IS NOT NULL
      AND c.starts_at_local
        + CASE
          WHEN c.is_challenge_backed THEN interval '0 minutes'
          ELSE v_delay
        END <= v_now_local
      AND NOT EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.partido_id = c.id
          AND n.type IN ('survey_start', 'post_match_survey')
      )
    ORDER BY c.starts_at_local ASC
    LIMIT GREATEST(COALESCE(p_limit, 200), 1)
  LOOP
    v_scanned := v_scanned + 1;

    IF COALESCE(v_match.is_challenge_backed, false) THEN
      v_challenge_prepare := public.prepare_pending_challenge_partido_for_post_match(
        v_match.id,
        (v_match.survey_start_local AT TIME ZONE 'America/Argentina/Buenos_Aires'),
        (v_match.survey_deadline_local AT TIME ZONE 'America/Argentina/Buenos_Aires')
      );

      IF COALESCE((v_challenge_prepare ->> 'handled')::boolean, false)
         AND COALESCE((v_challenge_prepare ->> 'qualifies')::boolean, false) = false THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
    END IF;

    SELECT *
    INTO v_gate
    FROM public.get_match_post_match_gate(v_match.id);

    IF COALESCE(v_gate.qualifies, false) = false THEN
      PERFORM public.mark_match_assumed_not_played(
        v_match.id,
        COALESCE(v_gate.reason, 'match_assumed_not_played')
      );
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    BEGIN
      v_result := public.enqueue_partido_notification(
        v_match.id,
        'survey_start',
        '¡Encuesta lista!',
        'La encuesta ya está lista para completar sobre el partido ' || v_match.match_display_name || '.',
        jsonb_build_object(
          'match_id', v_match.id,
          'matchId', v_match.id,
          'match_name', v_match.match_display_name,
          'match_date', v_match.fecha,
          'match_time', v_match.hora,
          'link', '/encuesta/' || v_match.id,
          'survey_opened_at', (v_match.survey_start_local AT TIME ZONE 'America/Argentina/Buenos_Aires'),
          'survey_deadline_at', (v_match.survey_deadline_local AT TIME ZONE 'America/Argentina/Buenos_Aires'),
          'source', 'backend_scheduler'
        )
      );

      UPDATE public.partidos
      SET surveys_sent = true
      WHERE id = v_match.id;

      IF COALESCE((v_result ->> 'recipients_count')::int, 0) > 0 THEN
        v_notified := v_notified + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        v_errors := v_errors + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'now_local', v_now_local,
    'delay_minutes', GREATEST(COALESCE(p_delay_minutes, 60), 0),
    'scanned', v_scanned,
    'notified', v_notified,
    'skipped', v_skipped,
    'errors', v_errors
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.process_survey_reminder_notifications_backend(
  p_delay_minutes integer DEFAULT 60,
  p_window_minutes integer DEFAULT 1,
  p_limit integer DEFAULT 200
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delay interval := make_interval(mins => GREATEST(COALESCE(p_delay_minutes, 60), 0));
  v_window interval := make_interval(mins => GREATEST(COALESCE(p_window_minutes, 1), 1));
  v_now_local timestamp := timezone('America/Argentina/Buenos_Aires', now())::timestamp;
  v_match record;
  v_result jsonb;
  v_gate record;
  v_scanned int := 0;
  v_notified int := 0;
  v_skipped int := 0;
  v_errors int := 0;
BEGIN
  FOR v_match IN
    WITH candidates AS (
      SELECT
        p.id,
        p.nombre,
        public.resolve_survey_notification_match_name(p.nombre) AS match_display_name,
        p.fecha,
        p.hora,
        p.survey_status,
        p.result_status,
        p.survey_closes_at,
        p.survey_opened_at,
        (tm.challenge_id IS NOT NULL) AS is_challenge_backed,
        CASE
          WHEN replace(trim(p.hora), '.', ':') ~ '^[0-9]{1,2}:[0-9]{2}' THEN
            p.fecha::timestamp + substring(replace(trim(p.hora), '.', ':') FROM '^[0-9]{1,2}:[0-9]{2}')::time
          ELSE NULL::timestamp
        END AS starts_at_local
      FROM public.partidos p
      LEFT JOIN public.team_matches tm
        ON tm.partido_id = p.id
      WHERE p.fecha IS NOT NULL
        AND p.hora IS NOT NULL
        AND COALESCE(lower(p.estado), 'active') IN ('active', 'activo', 'finalizado', 'finished')
    ),
    normalized AS (
      SELECT
        c.id,
        c.nombre,
        c.match_display_name,
        c.fecha,
        c.hora,
        c.survey_status,
        c.result_status,
        c.survey_closes_at,
        COALESCE(
          timezone('America/Argentina/Buenos_Aires', c.survey_opened_at)::timestamp,
          c.starts_at_local
            + CASE
              WHEN c.is_challenge_backed THEN interval '0 minutes'
              ELSE v_delay
            END
        ) AS survey_start_local
      FROM candidates c
      WHERE c.starts_at_local IS NOT NULL
    ),
    reminder_candidates AS (
      SELECT
        n.id,
        n.nombre,
        n.match_display_name,
        n.fecha,
        n.hora,
        n.survey_status,
        n.result_status,
        n.survey_closes_at,
        n.survey_start_local,
        n.survey_start_local + interval '24 hours' AS survey_deadline_local,
        n.survey_start_local + interval '12 hours' AS reminder_at_local,
        'survey_reminder_12h'::text AS reminder_notification_type,
        '12h_before_deadline'::text AS reminder_payload_type
      FROM normalized n
      UNION ALL
      SELECT
        n.id,
        n.nombre,
        n.match_display_name,
        n.fecha,
        n.hora,
        n.survey_status,
        n.result_status,
        n.survey_closes_at,
        n.survey_start_local,
        n.survey_start_local + interval '24 hours' AS survey_deadline_local,
        n.survey_start_local + interval '23 hours' AS reminder_at_local,
        'survey_reminder'::text AS reminder_notification_type,
        '1h_before_deadline'::text AS reminder_payload_type
      FROM normalized n
    )
    SELECT
      r.id,
      r.nombre,
      r.match_display_name,
      r.fecha,
      r.hora,
      r.survey_start_local,
      r.survey_deadline_local,
      r.reminder_at_local,
      r.reminder_notification_type,
      r.reminder_payload_type
    FROM reminder_candidates r
    WHERE r.survey_start_local <= v_now_local
      AND r.survey_deadline_local > v_now_local
      AND r.reminder_at_local <= v_now_local
      AND r.reminder_at_local > v_now_local - v_window
      AND COALESCE(lower(r.survey_status), 'open') IN ('open', 'abierta')
      AND COALESCE(lower(r.result_status), 'pending') IN ('pending', 'pendiente')
      AND (r.survey_closes_at IS NULL OR r.survey_closes_at > now())
      AND EXISTS (
        SELECT 1
        FROM public.notifications x
        WHERE x.partido_id = r.id
          AND x.type IN ('survey_start', 'post_match_survey')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.notifications y
        WHERE y.partido_id = r.id
          AND y.type = r.reminder_notification_type
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.notifications z
        WHERE z.partido_id = r.id
          AND z.type = 'survey_finished'
      )
    ORDER BY r.survey_start_local ASC
    LIMIT GREATEST(COALESCE(p_limit, 200), 1)
  LOOP
    v_scanned := v_scanned + 1;

    SELECT *
    INTO v_gate
    FROM public.get_match_post_match_gate(v_match.id);

    IF COALESCE(v_gate.qualifies, false) = false THEN
      PERFORM public.mark_match_assumed_not_played(
        v_match.id,
        COALESCE(v_gate.reason, 'match_assumed_not_played')
      );
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    BEGIN
      v_result := public.enqueue_partido_notification(
        v_match.id,
        v_match.reminder_notification_type,
        'Recordatorio de encuesta',
        CASE
          WHEN v_match.reminder_payload_type = '12h_before_deadline' THEN
            'Recordatorio: te quedan 12 horas para completar la encuesta del partido ' || v_match.match_display_name || '.'
          ELSE
            'Recordatorio: te queda 1 hora para completar la encuesta del partido ' || v_match.match_display_name || '.'
        END,
        jsonb_build_object(
          'match_id', v_match.id,
          'matchId', v_match.id,
          'match_name', v_match.match_display_name,
          'match_date', v_match.fecha,
          'match_time', v_match.hora,
          'link', '/encuesta/' || v_match.id,
          'reminder_type', v_match.reminder_payload_type,
          'survey_deadline_at', (v_match.survey_deadline_local AT TIME ZONE 'America/Argentina/Buenos_Aires'),
          'source', 'backend_scheduler'
        )
      );

      IF COALESCE((v_result ->> 'recipients_count')::int, 0) > 0 THEN
        v_notified := v_notified + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        v_errors := v_errors + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'now_local', v_now_local,
    'window_minutes', GREATEST(COALESCE(p_window_minutes, 1), 1),
    'scanned', v_scanned,
    'notified', v_notified,
    'skipped', v_skipped,
    'errors', v_errors
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_update_team_match_details(
  p_match_id uuid,
  p_scheduled_at timestamptz,
  p_location text,
  p_cancha_cost numeric,
  p_mode text,
  p_format smallint DEFAULT NULL
)
RETURNS public.team_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_match public.team_matches%ROWTYPE;
  v_creator_id uuid;
  v_next_status text;
  v_effective_scheduled_at timestamptz;
  v_partido_estado text;
  v_partido_result_status text;
  v_partido_finished_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT *
  INTO v_match
  FROM public.team_matches tm
  WHERE tm.id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partido no encontrado';
  END IF;

  IF lower(COALESCE(v_match.origin_type, '')) <> 'challenge' OR v_match.challenge_id IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT c.created_by_user_id
  INTO v_creator_id
  FROM public.challenges c
  WHERE c.id = v_match.challenge_id;

  IF v_creator_id IS NULL OR v_creator_id <> v_uid THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF v_match.status IN ('played', 'cancelled') THEN
    RAISE EXCEPTION 'No se puede editar un partido %', v_match.status;
  END IF;

  v_effective_scheduled_at := COALESCE(p_scheduled_at, v_match.scheduled_at);
  IF v_effective_scheduled_at IS NOT NULL AND v_effective_scheduled_at <= now() THEN
    RAISE EXCEPTION 'No se puede editar un partido pasado';
  END IF;

  IF v_match.partido_id IS NOT NULL THEN
    SELECT
      p.estado,
      p.result_status,
      p.finished_at
    INTO
      v_partido_estado,
      v_partido_result_status,
      v_partido_finished_at
    FROM public.partidos p
    WHERE p.id = v_match.partido_id;

    IF FOUND AND (
      lower(COALESCE(v_partido_estado, '')) IN ('cancelado', 'cancelled', 'canceled', 'finalizado', 'finished')
      OR lower(COALESCE(v_partido_result_status, '')) IN ('not_played', 'finished', 'draw')
      OR (v_partido_finished_at IS NOT NULL AND v_partido_finished_at <= now())
    ) THEN
      RAISE EXCEPTION 'No se puede editar un partido finalizado';
    END IF;
  END IF;

  IF p_cancha_cost IS NOT NULL AND p_cancha_cost < 0 THEN
    RAISE EXCEPTION 'El costo de cancha no puede ser negativo';
  END IF;

  IF p_format IS NOT NULL AND p_format NOT IN (5, 6, 7, 8, 9, 11) THEN
    RAISE EXCEPTION 'Formato invalido. Valores permitidos: 5,6,7,8,9,11';
  END IF;

  v_next_status := CASE
    WHEN p_scheduled_at IS NOT NULL
      AND NULLIF(btrim(COALESCE(p_location, '')), '') IS NOT NULL THEN 'confirmed'
    ELSE 'pending'
  END;

  UPDATE public.team_matches tm
  SET
    scheduled_at = p_scheduled_at,
    location = NULLIF(btrim(COALESCE(p_location, '')), ''),
    location_name = NULLIF(btrim(COALESCE(p_location, '')), ''),
    cancha_cost = p_cancha_cost,
    mode = NULLIF(btrim(COALESCE(p_mode, '')), ''),
    format = COALESCE(p_format, tm.format),
    status = v_next_status,
    updated_at = now()
  WHERE tm.id = p_match_id
  RETURNING * INTO v_match;

  RETURN v_match;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_update_team_match_details(
  p_match_id uuid,
  p_scheduled_at timestamptz,
  p_location text,
  p_cancha_cost numeric,
  p_mode text
)
RETURNS public.team_matches
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.rpc_update_team_match_details(
    p_match_id,
    p_scheduled_at,
    p_location,
    p_cancha_cost,
    p_mode,
    NULL::smallint
  );
$$;

GRANT EXECUTE ON FUNCTION public.resolve_survey_notification_match_name(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_pending_challenge_team_match_for_post_match(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_challenge_post_match_gate(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_match_post_match_gate(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_pending_challenge_partido_for_post_match(bigint, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_survey_start_notifications_backend(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_survey_reminder_notifications_backend(integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_update_team_match_details(uuid, timestamptz, text, numeric, text, smallint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_update_team_match_details(uuid, timestamptz, text, numeric, text) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.resolve_survey_notification_match_name(text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.is_pending_challenge_team_match_for_post_match(bigint) TO service_role;
    GRANT EXECUTE ON FUNCTION public.resolve_challenge_post_match_gate(bigint) TO service_role;
    GRANT EXECUTE ON FUNCTION public.get_match_post_match_gate(bigint) TO service_role;
    GRANT EXECUTE ON FUNCTION public.prepare_pending_challenge_partido_for_post_match(bigint, timestamptz, timestamptz) TO service_role;
    GRANT EXECUTE ON FUNCTION public.process_survey_start_notifications_backend(integer, integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.process_survey_reminder_notifications_backend(integer, integer, integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.rpc_update_team_match_details(uuid, timestamptz, text, numeric, text, smallint) TO service_role;
    GRANT EXECUTE ON FUNCTION public.rpc_update_team_match_details(uuid, timestamptz, text, numeric, text) TO service_role;
  END IF;
END
$$;

COMMIT;
