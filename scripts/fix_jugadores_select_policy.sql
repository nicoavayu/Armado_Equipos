-- ============================================================================
-- DIAGNOSE & FIX: Jugadores Select Policy
-- ============================================================================

-- 1. Check if "Public can read jugadores" exists
SELECT tablename, policyname, permissive, roles, cmd, qual, with_check 
FROM pg_policies 
WHERE tablename = 'jugadores';

-- 2. Force drop bad policies that might conflict
DROP POLICY IF EXISTS "jugadores_select_if_player_or_admin" ON public.jugadores;
DROP POLICY IF EXISTS "jugadores_select" ON public.jugadores;

-- 3. Force create the permissive select policy
DROP POLICY IF EXISTS "Public can read jugadores" ON public.jugadores;

CREATE POLICY "Public can read jugadores"
ON public.jugadores
FOR SELECT
USING (true);  -- Allow everyone to read everything

-- 4. Reload schema to ensure changes take effect immediately
SELECT pg_notify('pgrst', 'reload schema');

-- 5. Check row count for the problem match (Replace [MATCH_ID] with actual ID if debugging specific)
-- SELECT count(*) FROM jugadores WHERE partido_id = [ID];
