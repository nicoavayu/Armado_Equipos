-- ============================================================================
-- FIX: NOTIFICATIONS RLS POLICY
-- ============================================================================

-- El error "new row violates row-level security policy for table notifications"
-- indica que el usuario NO tiene permiso para INSERTAR una notificación para OTRO usuario.

-- 1. Eliminar políticas restrictivas previas
DROP POLICY IF EXISTS "Users can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Anyone can insert notifications" ON public.notifications;

-- 2. Crear política permisiva para INSERT
-- "Un usuario autenticado puede crear notificaciones para cualquiera"
-- (Necesario para enviar invitaciones a amigos)
CREATE POLICY "Enable insert for authenticated users"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (true);

-- 3. Asegurar lectura (Opcional, pero buena práctica)
-- "Cada usuario ve SUS propias notificaciones"
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
CREATE POLICY "Users can view own notifications"
ON public.notifications
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- 4. Recargar esquema
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
SELECT pg_notify('pgrst', 'reload schema');
