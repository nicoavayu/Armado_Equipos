-- Script to repair "Limbo" Join Requests
-- Finds requests that are 'approved' but the user is NOT in the 'jugadores' table
-- and fixes them by inserting the player.

DO $$
DECLARE
  r RECORD;
  v_inserted_count INT := 0;
BEGIN
  RAISE NOTICE 'Starting repair of limbo requests...';

  FOR r IN
    SELECT mr.match_id, mr.user_id, mr.id
    FROM public.match_join_requests mr
    WHERE mr.status = 'approved'
    AND NOT EXISTS (
      SELECT 1 FROM public.jugadores j
      WHERE j.partido_id = mr.match_id
      AND j.usuario_id = mr.user_id
    )
  LOOP
    RAISE NOTICE 'Fixing limbo request ID %: User % in Match %', r.id, r.user_id, r.match_id;
    
    -- Insert into jugadores
    INSERT INTO public.jugadores (
        partido_id,
        usuario_id,
        nombre,
        avatar_url,
        score,
        is_goalkeeper
    )
    SELECT
        r.match_id,
        r.user_id,
        COALESCE(p.nombre, u.nombre, 'Jugador Recuperado'),
        COALESCE(p.avatar_url, u.avatar_url),
        5,
        false
    FROM public.usuarios u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE u.id = r.user_id
    ON CONFLICT (partido_id, usuario_id) DO NOTHING;
    
    v_inserted_count := v_inserted_count + 1;
  END LOOP;
  
  RAISE NOTICE 'Repair complete. Fixed % records.', v_inserted_count;
END $$;
