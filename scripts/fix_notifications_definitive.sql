-- ============================================================================
-- FIX DEFINITIVO: NOTIFICACIONES (Permisos de Invitación)
-- ============================================================================

-- IMPORTANTE: Este script resetea los permisos de la tabla Notifications.
-- Objetivo: Que puedas enviar invitaciones a tus amigos (INSERT).

BEGIN;

-- 1. Asegurar limpieza total de políticas viejas
DROP POLICY IF EXISTS "Users can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Anyone can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.notifications;
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
DROP POLICY IF EXISTS "service_role_manage_notifications" ON public.notifications;
DROP POLICY IF EXISTS "policy_insert_notifications" ON public.notifications;
DROP POLICY IF EXISTS "policy_select_notifications" ON public.notifications;

-- 2. Habilitar RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 3. PERMITIR INSERTAR (Clave para las invitaciones)
-- "Cualquier usuario logueado puede crear una notificación para quien sea".
CREATE POLICY "Allow Insert Authenticated"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (true);

-- 4. PERMITIR LEER (Solo tus propias notificaciones)
CREATE POLICY "Allow Select Own"
ON public.notifications
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- 5. PERMITIR ACTUALIZAR (Solo tus propias notificaciones - ej: marcar como leída)
CREATE POLICY "Allow Update Own"
ON public.notifications
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

-- 6. Recargar caché de esquema de Supabase
SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
