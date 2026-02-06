-- ============================================================================
-- NEW RPC: send_call_to_vote (UPDATED)
-- ============================================================================
-- Sends 'call_to_vote' notifications to all players in a match.
-- Bypasses RLS by running as SECURITY DEFINER.
-- REMOVED: check for survey_scheduled (column does not exist)

CREATE OR REPLACE FUNCTION public.send_call_to_vote(
    p_partido_id bigint,
    p_title text DEFAULT '¡Hora de votar!',
    p_message text DEFAULT 'Entrá a la app y calificá a los jugadores para armar los equipos.'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_rows_inserted int;
    v_match_code text;
BEGIN
    -- 1. Get match info (removed survey_scheduled check)
    SELECT codigo INTO v_match_code
    FROM public.partidos 
    WHERE id = p_partido_id;

    -- 2. Check if a survey notification already exists for this match
    -- (logic matches notificationService.js: survey_start, post_match_survey, survey_reminder)
    IF EXISTS (
        SELECT 1 FROM public.notifications
        WHERE (
            (data->>'match_id')::text = p_partido_id::text
            OR (data->>'matchId')::text = p_partido_id::text
        )
        AND type IN ('survey_start', 'post_match_survey', 'survey_reminder')
    ) THEN
        RETURN jsonb_build_object('success', false, 'reason', 'survey_exists');
    END IF;

    -- 3. Insert notifications for all players with a user_id
    WITH inserted AS (
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
            usuario_id,
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
        FROM public.jugadores
        WHERE partido_id = p_partido_id
        AND usuario_id IS NOT NULL
        RETURNING id
    )
    SELECT count(*) INTO v_rows_inserted FROM inserted;

    RETURN jsonb_build_object('success', true, 'inserted', v_rows_inserted);
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_call_to_vote TO authenticated;
