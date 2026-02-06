-- Fix approve_join_request RPC and ensure constraint exists
-- Date: 2026-02-06
-- Author: Antigravity

-- 1. Ensure unique index exists on public.jugadores(partido_id, usuario_id)
-- This is required for the ON CONFLICT clause in the RPC to work correctly.
-- We use CREATE UNIQUE INDEX IF NOT EXISTS which is safer and simpler than checking constraints manually.
CREATE UNIQUE INDEX IF NOT EXISTS idx_jugadores_partido_usuario_unique 
ON public.jugadores(partido_id, usuario_id);

-- 2. Create or replace the RPC function
-- This function approves a join request and adds the user to the jugadores table.

-- DROP first to avoid "cannot change return type" error
DROP FUNCTION IF EXISTS public.approve_join_request(bigint);

CREATE OR REPLACE FUNCTION public.approve_join_request(
  p_request_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_match_id bigint;
  v_user_id uuid;
  v_status text;
  v_profile record;
  v_usuario record;
  v_nombre text;
  v_avatar_url text;
BEGIN
  -- Get request details
  SELECT match_id, user_id, status
  INTO v_match_id, v_user_id, v_status
  FROM public.match_join_requests
  WHERE id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  -- 3. Update request status
  UPDATE public.match_join_requests
  SET status = 'approved',
      decided_at = now(),
      decided_by = auth.uid()
  WHERE id = p_request_id;

  -- 4. Fetch user profile data to populate jugadores table
  -- We prioritize 'profiles' table/view, then 'usuarios' table
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  SELECT * INTO v_usuario FROM public.usuarios WHERE id = v_user_id;
  
  v_nombre := COALESCE(v_profile.nombre, v_usuario.nombre, 'Jugador');
  v_avatar_url := COALESCE(v_profile.avatar_url, v_usuario.avatar_url);

  -- 5. Insert into jugadores
  -- usage of ON CONFLICT requires the unique index created above
  INSERT INTO public.jugadores (
    partido_id,
    usuario_id,
    nombre,
    avatar_url,
    score,
    is_goalkeeper
  ) VALUES (
    v_match_id,
    v_user_id,
    v_nombre,
    v_avatar_url,
    5, -- Default score
    false -- Default goalkeeper status
  )
  ON CONFLICT (partido_id, usuario_id) DO NOTHING;

  RETURN jsonb_build_object('success', true);
END;
$$;
