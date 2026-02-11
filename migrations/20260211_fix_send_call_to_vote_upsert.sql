-- ============================================================================
-- FIX RPC: send_call_to_vote with UPSERT
-- ============================================================================
-- Prevents duplicate-key failures on unique index (uniq_notif_user_match_type)
-- when restarting/resetting voting for the same match.

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
    v_rows_affected int;
    v_match_code text;
BEGIN
    SELECT codigo INTO v_match_code
    FROM public.partidos
    WHERE id = p_partido_id;

    IF EXISTS (
        SELECT 1
        FROM public.notifications
        WHERE (
            (data->>'match_id')::text = p_partido_id::text
            OR (data->>'matchId')::text = p_partido_id::text
        )
        AND type IN ('survey_start', 'post_match_survey', 'survey_reminder')
    ) THEN
        RETURN jsonb_build_object('success', false, 'reason', 'survey_exists');
    END IF;

    WITH upserted AS (
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
            j.usuario_id,
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
        FROM public.jugadores j
        WHERE j.partido_id = p_partido_id
          AND j.usuario_id IS NOT NULL
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

GRANT EXECUTE ON FUNCTION public.send_call_to_vote(bigint, text, text) TO authenticated;

