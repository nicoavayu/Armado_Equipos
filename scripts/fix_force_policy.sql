-- ============================================================================
-- FIX: FORCE JUGADORES VISIBILITY (CORRECTED)
-- ============================================================================

-- 1. Primero borramos la política si ya existe para evitar el error "42710"
DROP POLICY IF EXISTS "Universal read players" ON public.jugadores;

-- 2. Borrar otras políticas viejas por si acaso
DROP POLICY IF EXISTS "jugadores_select" ON public.jugadores;
DROP POLICY IF EXISTS "jugadores_select_policy" ON public.jugadores;
DROP POLICY IF EXISTS "Anyone can read match players" ON public.jugadores;
DROP POLICY IF EXISTS "Public select players" ON public.jugadores;

-- 3. Crear la política UNIVERSAL de lectura
CREATE POLICY "Universal read players"
ON public.jugadores
FOR SELECT
USING (true);

-- 4. Asegurar RLS y recargar
ALTER TABLE public.jugadores ENABLE ROW LEVEL SECURITY;
SELECT pg_notify('pgrst', 'reload schema');
