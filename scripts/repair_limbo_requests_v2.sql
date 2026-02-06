-- REPAIR SCRIPT V2: Fix "Approved but stuck" requests
-- Run this in Supabase SQL Editor

DO $$
DECLARE
  r RECORD;
  v_inserted_count INT := 0;
  v_player_exists BOOLEAN;
BEGIN
  RAISE NOTICE 'Starting repair process V2...';

  -- Loop through all APPROVED requests
  FOR r IN
    SELECT mr.match_id, mr.user_id, mr.id, u.email
    FROM public.match_join_requests mr
    JOIN public.usuarios u ON u.id = mr.user_id
    WHERE mr.status = 'approved'
  LOOP
    
    -- Check if player exists in jugadores
    SELECT EXISTS (
      SELECT 1 FROM public.jugadores j
      WHERE j.partido_id = r.match_id
      AND j.usuario_id = r.user_id
    ) INTO v_player_exists;

    IF NOT v_player_exists THEN
      RAISE NOTICE 'Found broken record! User % (ID: %) is approved for Match % but NOT in players list.', r.email, r.user_id, r.match_id;

      -- Attempt insert
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
      
      -- Verify if it worked
      IF FOUND THEN
        v_inserted_count := v_inserted_count + 1;
        RAISE NOTICE '-> FIXED: User inserted into match.';
      ELSE
         RAISE NOTICE '-> WARNING: Insert returned no rows (maybe conflict or error).';
      END IF;

    ELSE
      -- Raise debug for healthy records just to be sure
      -- RAISE NOTICE 'Record healthy: User % in Match %', r.user_id, r.match_id;
    END IF;

  END LOOP;
  
  RAISE NOTICE '------------------------------------------------';
  RAISE NOTICE 'Repair complete. Fixed % missing players.', v_inserted_count;
  RAISE NOTICE 'If count is > 0, the "Sincronizando" error should be gone.';
END $$;
