-- ============================================================================
-- RESET TOTAL: POLITICAS DE NOTIFICACIONES
-- ============================================================================
-- Este script BORRA TODAS las reglas y deja SOLO las 3 necesarias.

BEGIN;

-- 1. Borrar CUALQUIER política que haya existido (lista exhaustiva)
DROP POLICY IF EXISTS "notifications_insert_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_delete_none" ON public.notifications;
DROP POLICY IF EXISTS "Allow Insert Authenticated" ON public.notifications;
DROP POLICY IF EXISTS "Allow Select Own" ON public.notifications;
DROP POLICY IF EXISTS "Allow Update Own" ON public.notifications;
DROP POLICY IF EXISTS "Users can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Anyone can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.notifications;
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;

-- 2. Asegurarse que RLS está activo
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 3. Crear las 3 reglas de oro

-- INSERT: Cualquiera logueado puede crear (para invitar amigos)
CREATE POLICY "Allow Insert Authenticated"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (true);

-- SELECT: Solo ver las tuyas
CREATE POLICY "Allow Select Own"
ON public.notifications
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- UPDATE: Solo actualizar las tuyas (marcar leída)
CREATE POLICY "Allow Update Own"
ON public.notifications
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

-- 4. Notificar recarga de caché
SELECT pg_notify('pgrst', 'reload schema');

COMMIT;

-- 5. Verificar (Mostrar qué quedó)
SELECT policyname, cmd, roles, permissive 
FROM pg_policies 
WHERE tablename = 'notifications';
