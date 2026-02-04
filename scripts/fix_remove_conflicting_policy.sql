-- ============================================================================
-- FIX: ELIMINAR POLITICA CONFLICTIVA (notifications_insert_own)
-- ============================================================================

-- DIAGNOSTICO:
-- Tenés una política vieja llamada "notifications_insert_own" que dice:
-- "Solo podés insertar notificaciones SI user_id = tu_id".
-- ¡Eso impide que le mandes notificaciones a tus amigos!

-- SOLUCION:
-- Borrar las políticas viejas que no eliminamos antes.

DROP POLICY IF EXISTS "notifications_insert_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_delete_none" ON public.notifications;

-- (Las reglas nuevas "Allow Insert Authenticated" que creamos antes se quedan, esas están bien)
-- No hace falta crearlas de nuevo. Solo borramos las que molestan.

SELECT pg_notify('pgrst', 'reload schema');
