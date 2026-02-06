
-- Replace the approve_join_request function with a robust version
-- that GUARANTEES the player is added to the jugadores table.

-- Drop first to avoid return type conflicts
DROP FUNCTION IF EXISTS public.approve_join_request(bigint);

CREATE OR REPLACE FUNCTION public.approve_join_request(p_request_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with superuser privileges to bypass RLS during insertion if needed
AS $function$
DECLARE
    v_match_id bigint;
    v_user_id uuid;
    v_user_name text;
    v_user_avatar text;
    v_request_status text;
BEGIN
    -- 1. Get request details
    SELECT match_id, user_id, status INTO v_match_id, v_user_id, v_request_status
    FROM public.match_join_requests
    WHERE id = p_request_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request not found';
    END IF;

    -- 2. Get user info for the player card
    SELECT nombre, avatar_url INTO v_user_name, v_user_avatar
    FROM public.usuarios
    WHERE id = v_user_id;

    -- Fallback name if missing
    IF v_user_name IS NULL THEN
        v_user_name := 'Jugador';
    END IF;

    -- 3. INSERT INTO JUGADORES (Critical Step)
    -- Using ON CONFLICT to ensure idempotency
    INSERT INTO public.jugadores (partido_id, usuario_id, nombre, avatar_url, score, is_goalkeeper)
    VALUES (v_match_id, v_user_id, v_user_name, v_user_avatar, 5, false)
    ON CONFLICT (partido_id, usuario_id) DO NOTHING;

    -- 4. Update validation status
    UPDATE public.match_join_requests
    SET status = 'approved',
        decided_at = now(),
        decided_by = auth.uid()
    WHERE id = p_request_id;

    RETURN true;
END;
$function$;

-- Grant execute permission just in case
GRANT EXECUTE ON FUNCTION public.approve_join_request(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_join_request(bigint) TO service_role;
