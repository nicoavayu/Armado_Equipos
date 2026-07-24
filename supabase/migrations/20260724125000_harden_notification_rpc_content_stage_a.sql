-- ===========================================================================
-- Security patch M3 (Stage A) — remove client-content passthrough in the
-- existing SECURITY DEFINER notification RPCs.
-- ---------------------------------------------------------------------------
-- send_match_invite / send_call_to_vote accept optional p_title/p_message and
-- fall back to server defaults only when NULL, i.e. an authorized caller can
-- still inject arbitrary title/message text. This migration forces the content
-- to ALWAYS be server-generated (client p_title/p_message are ignored) and adds
-- a safe search_path to send_call_to_vote. Signatures are preserved so existing
-- clients keep compiling; the parameters simply become inert.
--
-- send_match_invite is rewritten in place via pg_get_functiondef + regex (its
-- body is large and only the two COALESCE(p_title/p_message, …) need to change),
-- guarded so it is a no-op where the function is not present (e.g. test stub).
-- Rollback: re-apply the prior definitions (see 20260316184500 / 20260316223000).
-- ===========================================================================

BEGIN;

-- send_match_invite: make COALESCE(p_title, …) / COALESCE(p_message, …) always
-- resolve to the server-side default by neutralising the client argument.
DO $mig$
DECLARE
  v_fn text;
BEGIN
  IF to_regprocedure('public.send_match_invite(uuid, bigint, text, text, text)') IS NOT NULL THEN
    v_fn := pg_get_functiondef('public.send_match_invite(uuid, bigint, text, text, text)'::regprocedure);
    v_fn := regexp_replace(v_fn, 'coalesce\(\s*p_title\s*,',   'coalesce(NULL::text,', 'gi');
    v_fn := regexp_replace(v_fn, 'coalesce\(\s*p_message\s*,', 'coalesce(NULL::text,', 'gi');
    EXECUTE v_fn;
  END IF;
END
$mig$;

-- send_call_to_vote: hardcode server content + add SET search_path = public.
-- (Recipients are already server-derived: the match's registered players.)
CREATE OR REPLACE FUNCTION public.send_call_to_vote(
  p_partido_id bigint,
  p_title text DEFAULT '¡Hora de votar!',
  p_message text DEFAULT 'Entrá a la app y calificá a los jugadores para armar los equipos.'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows_affected int := 0;
  v_match_code text;
BEGIN
  SELECT codigo INTO v_match_code FROM public.partidos WHERE id = p_partido_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partido % not found', p_partido_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.notifications
    WHERE (
      (data ->> 'match_id')::text = p_partido_id::text
      OR (data ->> 'matchId')::text = p_partido_id::text
    )
    AND type IN ('survey_start', 'post_match_survey', 'survey_reminder')
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'survey_exists');
  END IF;

  WITH recipients AS (
    SELECT DISTINCT j.usuario_id AS user_id
    FROM public.jugadores j
    WHERE j.partido_id = p_partido_id
      AND j.usuario_id IS NOT NULL
  ),
  upserted AS (
    INSERT INTO public.notifications (
      user_id, title, message, type, partido_id, data, read, created_at, send_at
    )
    SELECT
      r.user_id,
      '¡Hora de votar!',
      'Entrá a la app y calificá a los jugadores para armar los equipos.',
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

COMMIT;

-- ===========================================================================
-- ROLLBACK: re-apply the previous send_match_invite (20260316184500) and
-- send_call_to_vote (20260316223000) definitions verbatim.
-- ===========================================================================
