BEGIN;

CREATE OR REPLACE FUNCTION public.process_challenge_result_survey_notifications_backend(
  p_limit integer DEFAULT 200
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := GREATEST(COALESCE(p_limit, 200), 1);
  v_scanned integer := 0;
  v_inserted integer := 0;
  v_queued_pushes integer := 0;
  v_resolved_stale integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('challenge_result_survey_backend_fanout'));

  WITH stale_notifications AS (
    UPDATE public.notifications n
    SET
      read = true,
      status = 'resolved'
    FROM public.team_matches tm
    WHERE n.type = 'challenge_result_survey'
      AND COALESCE(n.status, '') IS DISTINCT FROM 'resolved'
      AND tm.id::text = COALESCE(n.data ->> 'team_match_id', n.data ->> 'teamMatchId')
      AND tm.result_status IS NOT NULL
    RETURNING n.id
  )
  SELECT COUNT(*) INTO v_resolved_stale
  FROM stale_notifications;

  WITH eligible_matches AS (
    SELECT
      tm.id AS team_match_id,
      tm.challenge_id,
      tm.partido_id,
      tm.team_a_id,
      tm.team_b_id,
      tm.scheduled_at,
      COALESCE(team_a.name, 'Equipo A') AS team_a_name,
      COALESCE(team_b.name, 'Equipo B') AS team_b_name,
      c.challenger_team_id,
      c.accepted_team_id,
      c.status AS challenge_status
    FROM public.team_matches tm
    JOIN public.challenges c
      ON c.id = tm.challenge_id
    LEFT JOIN public.teams team_a
      ON team_a.id = tm.team_a_id
    LEFT JOIN public.teams team_b
      ON team_b.id = tm.team_b_id
    WHERE tm.challenge_id IS NOT NULL
      AND c.accepted_team_id IS NOT NULL
      AND tm.team_a_id = c.challenger_team_id
      AND tm.team_b_id = c.accepted_team_id
      AND COALESCE(tm.scheduled_at, tm.played_at, c.scheduled_at) <= now()
      AND lower(COALESCE(c.status, '')) IN ('accepted', 'confirmed', 'completed')
      AND lower(COALESCE(tm.status, '')) IN ('accepted', 'confirmed', 'played', 'completed')
      AND lower(COALESCE(c.status, '')) NOT IN ('open', 'cancelled', 'canceled', 'rejected')
      AND lower(COALESCE(tm.status, '')) NOT IN ('open', 'cancelled', 'canceled', 'rejected')
      AND tm.result_status IS NULL
    ORDER BY COALESCE(tm.scheduled_at, tm.played_at, c.scheduled_at) ASC
    LIMIT v_limit
  ),
  recipients AS (
    SELECT DISTINCT ON (e.team_match_id, r.user_id)
      e.team_match_id,
      e.challenge_id,
      e.partido_id,
      e.team_a_id,
      e.team_b_id,
      e.team_a_name,
      e.team_b_name,
      e.challenger_team_id,
      e.accepted_team_id,
      r.user_id,
      r.managed_team_id
    FROM eligible_matches e
    CROSS JOIN LATERAL (
      SELECT t.owner_user_id AS user_id, t.id AS managed_team_id
      FROM public.teams t
      WHERE t.id IN (e.team_a_id, e.team_b_id)
        AND t.owner_user_id IS NOT NULL

      UNION

      SELECT tm.user_id AS user_id, tm.team_id AS managed_team_id
      FROM public.team_members tm
      WHERE tm.team_id IN (e.team_a_id, e.team_b_id)
        AND tm.user_id IS NOT NULL
        AND (
          COALESCE(tm.is_captain, false) = true
          OR lower(COALESCE(tm.permissions_role, '')) IN ('owner', 'admin')
        )

      UNION

      SELECT j.usuario_id AS user_id, tm.team_id AS managed_team_id
      FROM public.team_members tm
      JOIN public.jugadores j
        ON j.id = tm.jugador_id
      WHERE tm.team_id IN (e.team_a_id, e.team_b_id)
        AND j.usuario_id IS NOT NULL
        AND (
          COALESCE(tm.is_captain, false) = true
          OR lower(COALESCE(tm.permissions_role, '')) IN ('owner', 'admin')
        )
    ) r
    WHERE r.user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.notifications existing
        WHERE existing.user_id = r.user_id
          AND existing.type = 'challenge_result_survey'
          AND COALESCE(existing.data ->> 'team_match_id', existing.data ->> 'teamMatchId') = e.team_match_id::text
      )
    ORDER BY
      e.team_match_id,
      r.user_id,
      CASE WHEN r.managed_team_id = e.team_a_id THEN 0 ELSE 1 END
  ),
  inserted_notifications AS (
    INSERT INTO public.notifications (
      user_id,
      partido_id,
      type,
      title,
      message,
      data,
      status,
      read,
      send_at,
      created_at
    )
    SELECT
      r.user_id,
      r.partido_id,
      'challenge_result_survey',
      'Resultado pendiente',
      '¿Cómo salió el desafío vs ' ||
        CASE
          WHEN r.managed_team_id = r.team_a_id THEN r.team_b_name
          ELSE r.team_a_name
        END || '?',
      jsonb_build_object(
        'source', 'team_challenge',
        'source_detail', 'backend_scheduler',
        'action', 'open_challenge_result_modal',
        'team_match_id', r.team_match_id,
        'teamMatchId', r.team_match_id,
        'challenge_id', r.challenge_id,
        'challengeId', r.challenge_id,
        'partido_id', r.partido_id,
        'partidoId', r.partido_id,
        'challenger_team_id', r.challenger_team_id,
        'accepted_team_id', r.accepted_team_id,
        'rival_team_id',
          CASE
            WHEN r.managed_team_id = r.team_a_id THEN r.team_b_id
            ELSE r.team_a_id
          END,
        'rival_name',
          CASE
            WHEN r.managed_team_id = r.team_a_id THEN r.team_b_name
            ELSE r.team_a_name
          END,
        'team_a_name', r.team_a_name,
        'team_b_name', r.team_b_name,
        'target_path', '/desafios/equipos/partidos/' || r.team_match_id::text || '?action=open_challenge_result_modal',
        'route', '/desafios/equipos/partidos/' || r.team_match_id::text || '?action=open_challenge_result_modal',
        'link', '/desafios/equipos/partidos/' || r.team_match_id::text || '?action=open_challenge_result_modal'
      ),
      'sent',
      false,
      now(),
      now()
    FROM recipients r
    ON CONFLICT DO NOTHING
    RETURNING id, user_id, partido_id, type, title, message, data
  ),
  queued_pushes AS (
    INSERT INTO public.notification_delivery_log (
      partido_id,
      user_id,
      notification_type,
      payload_json,
      channel,
      status
    )
    SELECT
      n.partido_id,
      n.user_id,
      'challenge_result_survey',
      n.data || jsonb_build_object(
        'event_channel', 'ACTION',
        'notification_id', n.id,
        'source_notification_type', n.type,
        'notification_type', 'challenge_result_survey',
        'title', COALESCE(n.title, 'Resultado pendiente'),
        'message', COALESCE(n.message, 'Respondé cómo salió el desafío.'),
        'source', 'backend_scheduler'
      ),
      'push',
      'queued'
    FROM inserted_notifications n
    RETURNING id
  )
  SELECT
    (SELECT COUNT(*) FROM eligible_matches),
    (SELECT COUNT(*) FROM inserted_notifications),
    (SELECT COUNT(*) FROM queued_pushes)
  INTO v_scanned, v_inserted, v_queued_pushes;

  RETURN jsonb_build_object(
    'success', true,
    'scanned', v_scanned,
    'inserted_notifications', v_inserted,
    'queued_pushes', v_queued_pushes,
    'resolved_stale', v_resolved_stale
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_challenge_result_survey_notifications_backend(integer) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'service_role'
  ) THEN
    GRANT EXECUTE ON FUNCTION public.process_challenge_result_survey_notifications_backend(integer) TO service_role;
  END IF;
END
$$;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_extension
    WHERE extname = 'pg_cron'
  ) THEN
    RAISE NOTICE 'Skipping challenge result survey cron schedule because pg_cron is not enabled.';
    RETURN;
  END IF;

  FOR v_job_id IN
    EXECUTE $sql$
      SELECT jobid
      FROM cron.job
      WHERE jobname IN (
        'challenge_result_survey_backend_fanout',
        'challenge_result_survey_scheduler'
      )
    $sql$
  LOOP
    EXECUTE format('SELECT cron.unschedule(%s)', v_job_id);
  END LOOP;

  EXECUTE $sql$
    SELECT cron.schedule(
      'challenge_result_survey_backend_fanout',
      '* * * * *',
      'SELECT public.process_challenge_result_survey_notifications_backend(200);'
    )
  $sql$;
END
$$;

COMMENT ON FUNCTION public.process_challenge_result_survey_notifications_backend(integer)
IS 'Backend fanout for challenge result prompts. Creates challenge_result_survey notifications and queued push delivery rows for eligible past accepted team matches.';

COMMIT;
