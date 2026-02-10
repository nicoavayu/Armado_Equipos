-- DEBUG ONLY
-- Limpieza de notificaciones para despejar campanitas sin tocar lógica de negocio.
-- Ejecutar en Supabase SQL Editor.

BEGIN;

-- Opcion A (recomendada para pruebas): borrar TODO el historial de notificaciones.
DELETE FROM public.notifications;

-- Opcion B (alternativa menos agresiva): descomentar y usar en lugar de la Opcion A.
-- DELETE FROM public.notifications
-- WHERE read = true
--    OR created_at < now() - interval '48 hours';

COMMIT;

