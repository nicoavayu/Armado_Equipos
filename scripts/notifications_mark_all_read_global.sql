-- DEBUG / MANTENIMIENTO
-- Marcar TODAS las notificaciones como leídas para TODOS los usuarios
-- (limpia campanitas sin borrar historial ni romper deduplicación).

BEGIN;

UPDATE public.notifications
SET
  read = true,
  read_at = COALESCE(read_at, now()),
  status = COALESCE(status, 'sent')
WHERE read IS DISTINCT FROM true;

COMMIT;

-- Verificación rápida:
-- SELECT read, count(*) FROM public.notifications GROUP BY read;

