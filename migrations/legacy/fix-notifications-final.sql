-- SOLUCIÓN FINAL: Deshabilitar RLS temporalmente para notifications
-- Esto permite que las invitaciones funcionen mientras mantienes la seguridad en otras tablas

-- Opción 1: Deshabilitar RLS completamente (TEMPORAL)
ALTER TABLE public.notifications DISABLE ROW LEVEL SECURITY;

-- Opción 2: Si prefieres mantener RLS, cambia la referencia de la tabla
-- ALTER TABLE public.notifications DROP CONSTRAINT notifications_user_id_fkey;
-- ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey 
--   FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;

-- Verificar que RLS está deshabilitado
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE tablename = 'notifications';