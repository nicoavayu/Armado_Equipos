
-- ============================================================================
-- FIX: "Mis Partidos" Visibility
-- ============================================================================
-- Issue: Users join a match but cannot see it in "Mis Partidos" because
-- RLS (Row Level Security) prevents selecting the match row from 'partidos'.

-- 1. Enable RLS (Safety first)
ALTER TABLE public.partidos ENABLE ROW LEVEL SECURITY;

-- 2. Policy: Creators can view their own matches
DROP POLICY IF EXISTS "Creators can view their own matches" ON public.partidos;
CREATE POLICY "Creators can view their own matches" ON public.partidos
FOR SELECT
USING (auth.uid() = creado_por);

-- 3. Policy: Players can view matches they are in
-- This requires 'jugadores' table to be readable (covered by previous fixes)
DROP POLICY IF EXISTS "Players can view matches they are in" ON public.partidos;
CREATE POLICY "Players can view matches they are in" ON public.partidos
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.jugadores j
    WHERE j.partido_id = partidos.id
    AND j.usuario_id = auth.uid()
  )
);

-- 4. Notify schema reload
SELECT pg_notify('pgrst', 'reload schema');
