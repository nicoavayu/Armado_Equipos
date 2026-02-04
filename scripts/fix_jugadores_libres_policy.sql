-- ============================================================================
-- FIX: Políticas RLS para 'jugadores_sin_partido' (Lista de "Quiero Jugar")
-- ============================================================================

-- 1. Habilitar RLS (por si acaso no está)
ALTER TABLE public.jugadores_sin_partido ENABLE ROW LEVEL SECURITY;

-- 2. Limpiar políticas viejas para evitar conflictos
DROP POLICY IF EXISTS "Allow Select All" ON public.jugadores_sin_partido;
DROP POLICY IF EXISTS "Allow Insert Authenticated" ON public.jugadores_sin_partido;
DROP POLICY IF EXISTS "Allow Update Own" ON public.jugadores_sin_partido;
DROP POLICY IF EXISTS "Allow Delete Own" ON public.jugadores_sin_partido;
DROP POLICY IF EXISTS "Public Select" ON public.jugadores_sin_partido;
DROP POLICY IF EXISTS "Authenticated Insert" ON public.jugadores_sin_partido;
DROP POLICY IF EXISTS "User Update Own" ON public.jugadores_sin_partido;

-- 3. Crear nuevas políticas PERMISIVAS pero seguras

-- A) VER: Todos los usuarios autenticados pueden VER la lista de jugadores libres
CREATE POLICY "Allow Select All Authenticated"
ON public.jugadores_sin_partido
FOR SELECT
TO authenticated
USING (true);

-- B) INSERTAR: Cualquier usuario autenticado puede ANOTARSE
CREATE POLICY "Allow Insert Authenticated"
ON public.jugadores_sin_partido
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- C) ACTUALIZAR: Solo el dueño del registro puede modificar su estado (ej: cambiar 'disponible')
CREATE POLICY "Allow Update Own"
ON public.jugadores_sin_partido
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- D) BORRAR: Solo el dueño del registro puede borrarse
CREATE POLICY "Allow Delete Own"
ON public.jugadores_sin_partido
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- 4. Verificar Grants (Permisos básicos)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jugadores_sin_partido TO authenticated;
-- (Secuencia removida para evitar errores si usa UUID)
