-- ============================================================================
-- UPDATE RPC: send_match_invite with UPSERT support (Fixed)
-- ============================================================================
-- Allows re-inviting a user by updating the existing notification.
-- Uses index inference instead of constraint name to avoid "constraint does not exist" errors.

CREATE OR REPLACE FUNCTION public.send_match_invite(
    p_user_id uuid,      -- A quién invitamos
    p_partido_id bigint, -- A qué partido
    p_title text,
    p_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO public.notifications (
        user_id,
        partido_id,
        type,
        title,
        message,
        read,
        data,
        send_at
    ) VALUES (
        p_user_id,
        p_partido_id,
        'match_invite',
        p_title,
        p_message,
        false,
        jsonb_build_object(
            'action', 'open_match',
            'match_id', p_partido_id
        ),
        now()
    )
    -- Conflict target matches the unique index: uniq_notif_user_match_type
    -- Index def: (user_id, ((data ->> 'match_id'::text)), type)
    ON CONFLICT (user_id, (data ->> 'match_id'), type)
    DO UPDATE SET
        read = false,
        title = EXCLUDED.title,
        message = EXCLUDED.message,
        send_at = now(),
        data = EXCLUDED.data;
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_match_invite TO authenticated;
