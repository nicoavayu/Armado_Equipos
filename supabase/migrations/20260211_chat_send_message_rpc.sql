-- ============================================================================
-- CHAT RPC: send_match_chat_message
-- ============================================================================
-- Allows authenticated match participants/admins to send chat messages through
-- a SECURITY DEFINER function, avoiding fragile client-side INSERTs blocked by RLS.

CREATE OR REPLACE FUNCTION public.send_match_chat_message(
    p_partido_id bigint,
    p_autor text,
    p_mensaje text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_uid uuid;
    v_is_allowed boolean;
BEGIN
    v_uid := auth.uid();

    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'No autenticado' USING ERRCODE = 'P0001';
    END IF;

    IF p_partido_id IS NULL OR p_partido_id <= 0 THEN
        RAISE EXCEPTION 'Partido inválido' USING ERRCODE = 'P0001';
    END IF;

    IF COALESCE(trim(p_mensaje), '') = '' THEN
        RAISE EXCEPTION 'Mensaje vacío' USING ERRCODE = 'P0001';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.partidos p
        WHERE p.id = p_partido_id
          AND (
            p.creado_por = v_uid
            OR EXISTS (
                SELECT 1
                FROM public.jugadores j
                WHERE j.partido_id = p_partido_id
                  AND j.usuario_id = v_uid
            )
          )
    )
    INTO v_is_allowed;

    IF NOT COALESCE(v_is_allowed, false) THEN
        RAISE EXCEPTION 'Sin permiso para enviar mensajes en este partido'
            USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.mensajes_partido (partido_id, autor, mensaje)
    VALUES (p_partido_id, COALESCE(NULLIF(trim(p_autor), ''), 'Usuario'), trim(p_mensaje));
END;
$$;
GRANT EXECUTE ON FUNCTION public.send_match_chat_message(bigint, text, text) TO authenticated;
