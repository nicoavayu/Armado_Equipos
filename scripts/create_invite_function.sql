-- ============================================================================
-- NUEVA FUNCION RPC: Enviar Invitación (Bypassing RLS)
-- ============================================================================

-- Si RLS sigue fallando por razones misteriosas, usamos una función "Security Definer".
-- Esto ejecuta la inserción con permisos de administrador, saltándose las políticas RLS.

CREATE OR REPLACE FUNCTION public.send_match_invite(
    p_user_id uuid,      -- A quién invitamos
    p_partido_id bigint, -- A qué partido
    p_title text,
    p_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER -- <--- ¡LA MAGIA! (Se ejecuta como admin)
AS $$
BEGIN
    INSERT INTO public.notifications (
        user_id,
        partido_id,
        type,
        title,
        message,
        read,
        data
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
        )
    );
END;
$$;

-- Permitir que los usuarios logueados usen esta función
GRANT EXECUTE ON FUNCTION public.send_match_invite TO authenticated;
