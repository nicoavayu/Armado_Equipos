-- DEBUG SCRIPT: Inspect Match Data
-- Run this in Supabase SQL Editor

DO $$
DECLARE
  v_match_id BIGINT := 260; -- Based on logs
  r RECORD; -- Variable declaration added here
BEGIN
  RAISE NOTICE '=== DEBUG START: MATCH % ===', v_match_id;
  
  -- 1. Check Requests
  RAISE NOTICE '--- Join Requests ---';
  FOR r IN SELECT * FROM public.match_join_requests WHERE match_id = v_match_id LOOP
    RAISE NOTICE 'Request ID: %, User: %, Status: %', r.id, r.user_id, r.status;
  END LOOP;
  
  -- 2. Check Players
  RAISE NOTICE '--- Players (Jugadores) ---';
  FOR r IN SELECT * FROM public.jugadores WHERE partido_id = v_match_id LOOP
    RAISE NOTICE 'Player ID: %, User ID: %, Name: %', r.id, r.usuario_id, r.nombre;
  END LOOP;

  -- 3. Check Match Metadata
  RAISE NOTICE '--- Match Info ---';
  FOR r IN SELECT * FROM public.partidos WHERE id = v_match_id LOOP
    RAISE NOTICE 'Match ID: %, Created By: %', r.id, r.creado_por;
  END LOOP;
  
  RAISE NOTICE '=== DEBUG END ===';
END $$;
