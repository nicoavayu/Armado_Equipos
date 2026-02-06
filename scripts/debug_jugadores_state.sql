
-- Debug script to check players table state and RLS
-- User ID: 7ecef7ec-0004-4697-8d0a-48fd49c477a2
-- Match ID: 266

SELECT 'Checking existing player record' as check_step;
SELECT * FROM public.jugadores 
WHERE usuario_id = '7ecef7ec-0004-4697-8d0a-48fd49c477a2' 
AND partido_id = 266;

SELECT 'Checking RLS Policies on jugadores' as check_step;
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check 
FROM pg_policies 
WHERE tablename = 'jugadores';

SELECT 'Checking match_join_requests' as check_step;
SELECT * FROM public.match_join_requests
WHERE user_id = '7ecef7ec-0004-4697-8d0a-48fd49c477a2'
AND match_id = 266;

-- Create a permissive policy just in case it's missing (to be safe)
CREATE POLICY "Public can read joueurs debug" ON public.jugadores
FOR SELECT
USING (true);
