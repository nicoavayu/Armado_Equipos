-- ============================================================================
-- FIX: Usuarios Visibility (Allow seeing friends' profiles)
-- ============================================================================

-- El problema es la política "usuarios_select_own" que dice:
-- "Solo puedo ver mi propio usuario (id = auth.uid())"
-- Esto hace que cuando buscas amigos, la base de datos te devuelva "nada" para los demás.

-- 1. Eliminar la política restrictiva
DROP POLICY IF EXISTS "usuarios_select_own" ON public.usuarios;

-- 2. Crear una política que permita ver perfiles públicos
-- Permitimos que cualquier usuario autenticado vea a los demás.
-- Esto es necesario para buscarlos e invitarlos.
CREATE POLICY "Authenticated can view all profiles"
ON public.usuarios
FOR SELECT
TO authenticated
USING (true);

-- 3. Recargar permisos
SELECT pg_notify('pgrst', 'reload schema');
