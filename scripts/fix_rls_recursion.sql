-- ============================================================================
-- FIX: Infinite Recursion in RLS (Error 42P17)
-- ============================================================================
-- El problema es que "jugadores" tiene políticas que consultan "partidos",
-- y "partidos" tiene políticas que consultan "jugadores".
-- Esto crea un bucle infinito (Recusión).
--
-- Como ya tienes una política "Public can read jugadores" (que permite todo),
-- las políticas restrictivas y complejas son REDUNDANTES y DAÑINAS.
-- Vamos a eliminarlas para romper el bucle.
-- ============================================================================

-- 1. Eliminar política recursiva de SELECT
-- Esta consulta 'partidos' para ver si eres admin, causando el loop.
DROP POLICY IF EXISTS "jugadores_select_if_player_or_admin" ON public.jugadores;

-- 2. Eliminar otras políticas redudantes de SELECT
-- Si "Public can read jugadores" existe (true), estas no sirven y consumen recursos.
DROP POLICY IF EXISTS "jugadores_select" ON public.jugadores;

-- 3. Eliminar políticas de INSERT recursivas (Opcional, pero recomendado por seguridad)
-- Estas consultan 'partidos' durante un insert en 'jugadores'.
-- Si 'partidos' consulta 'jugadores' en sus policies, esto también fallará al unirse a un partido.
DROP POLICY IF EXISTS "jugadores_insert_creator_self" ON public.jugadores;
DROP POLICY IF EXISTS "jugadores_insert_self_or_admin" ON public.jugadores;

-- 4. Asegurar política de lectura simple (si no existía, la creamos)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'jugadores' AND policyname = 'Public can read jugadores'
    ) THEN
        CREATE POLICY "Public can read jugadores" ON public.jugadores
        FOR SELECT
        USING (true);
    END IF;
END
$$;

-- 5. Recargar Schema
SELECT pg_notify('pgrst', 'reload schema');
