-- ============================================================================
-- Challenge result survey fanout: 60-minute delay + recent-window anti-backfill
-- Date: 2026-06-16
--
-- 20260616120000 created the backend fanout, but its eligibility was wrong:
--   * It fired as soon as the kickoff time passed (no 60-minute delay).
--   * It had no upper time bound, so EVERY past confirmed challenge without a
--     loaded result stayed eligible forever. Combined with LIMIT 200 ordered by
--     scheduled_at ASC, a backlog of very old matches permanently occupied the
--     batch and starved freshly played matches (the new prompt never appeared
--     while ancient ones kept being pushed as if brand new).
--   * Its tm.status whitelist used statuses that team_matches never actually
--     stores ('accepted'/'completed') while omitting the real pre-played status
--     'pending', so some eligible matches were skipped.
--
-- Product rule: generate the prompt exactly when scheduled_at + 60 minutes has
-- passed, only while the match is still recent (last 48h), even with the app
-- closed (cron). Old unreported matches stay answerable through Recap / Mis
-- Desafíos / detail (team_matches based), but must NOT generate fresh pushes.
--
-- 20260616120000 is already applied in Remote; keep it immutable and replace
-- only the function behavior here, then neutralize the legacy backfill spam.
-- ============================================================================

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
      AND COALESCE(tm.scheduled_at, c.scheduled_at) IS NOT NULL
      -- Only 60 minutes after the scheduled kickoff (not the moment it starts).
      AND COALESCE(tm.scheduled_at, c.scheduled_at) + interval '60 minutes' <= now()
      -- Anti-backfill: only matches whose kickoff is still recent (last 48h), so
      -- ancient unreported matches never spam fresh pushes nor starve the batch.
      AND COALESCE(tm.scheduled_at, c.scheduled_at) >= now() - interval '48 hours'
      AND lower(COALESCE(c.status, '')) IN ('accepted', 'confirmed', 'completed')
      AND lower(COALESCE(c.status, '')) NOT IN ('open', 'cancelled', 'canceled', 'cancelado', 'rejected')
      AND lower(COALESCE(tm.status, '')) NOT IN ('open', 'cancelled', 'canceled', 'cancelado', 'rejected')
      AND tm.result_status IS NULL
    ORDER BY COALESCE(tm.scheduled_at, c.scheduled_at) DESC
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

COMMENT ON FUNCTION public.process_challenge_result_survey_notifications_backend(integer)
IS 'Backend fanout for challenge result prompts. Creates challenge_result_survey notifications and queued push delivery rows only for matches 60+ minutes past kickoff and within the last 48h (anti-backfill).';

-- ---------------------------------------------------------------------------
-- One-time cleanup of the previous (window-less) fanout spam.
-- Matches whose kickoff is now older than the recent window and that still have
-- no loaded result: stop their prompts from showing as fresh activity/push.
-- They remain answerable from Recap / Mis Desafíos / detail (team_matches
-- based). No rows are deleted.
-- ---------------------------------------------------------------------------
WITH aged_notifications AS (
  SELECT n.id
  FROM public.notifications n
  JOIN public.team_matches tm
    ON tm.id::text = COALESCE(n.data ->> 'team_match_id', n.data ->> 'teamMatchId')
  LEFT JOIN public.challenges c
    ON c.id = tm.challenge_id
  WHERE n.type = 'challenge_result_survey'
    AND COALESCE(n.status, '') IS DISTINCT FROM 'resolved'
    AND tm.result_status IS NULL
    AND COALESCE(tm.scheduled_at, c.scheduled_at) < now() - interval '48 hours'
)
UPDATE public.notifications n
SET
  read = true,
  status = 'resolved'
FROM aged_notifications a
WHERE n.id = a.id;

UPDATE public.notification_delivery_log l
SET
  status = 'skipped',
  error_code = COALESCE(l.error_code, 'stale_backfill_window'),
  error_text = COALESCE(l.error_text, 'Skipped challenge_result_survey push for a match outside the recent (48h) window.'),
  next_retry_at = NULL,
  processing_started_at = NULL,
  processing_by = NULL
FROM public.team_matches tm
LEFT JOIN public.challenges c
  ON c.id = tm.challenge_id
WHERE l.notification_type = 'challenge_result_survey'
  AND l.channel = 'push'
  AND l.status IN ('queued', 'processing', 'retryable_failed')
  AND tm.id::text = COALESCE(l.payload_json ->> 'team_match_id', l.payload_json ->> 'teamMatchId')
  AND tm.result_status IS NULL
  AND COALESCE(tm.scheduled_at, c.scheduled_at) < now() - interval '48 hours';

COMMIT;
