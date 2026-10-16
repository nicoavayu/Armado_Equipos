-- Arma2 Core — inventario SOLO LECTURA del bucket público `team-crests` (SVG).
--
-- Paquete: docs/ops/core-storage/TEAM-CRESTS-SVG.md
-- Proyecto objetivo: Core Production (rcyuuoaqfwcembdajcss) — lo ejecuta una
-- persona con GO, nunca un agente ni CI.
--
-- Contrato:
--   * Sólo SELECT dentro de BEGIN READ ONLY; termina en ROLLBACK.
--   * No escribe, no borra, no cambia buckets ni policies.
--   * No usa listas explícitas de columnas de partidos/usuarios (no las toca).
--   * Uso sugerido: psql "$CORE_DB_URL_READONLY" -v ON_ERROR_STOP=1 -f <este archivo>
--     (la URL se pasa por entorno/llavero, nunca en un archivo).

BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '1s';
SET LOCAL idle_in_transaction_session_timeout = '30s';

-- 0) Guarda: la transacción debe ser de sólo lectura.
SELECT current_setting('transaction_read_only') AS transaction_read_only;

-- 1) Configuración actual de los buckets de imágenes Core (guardar este
--    resultado: es el valor exacto para el rollback).
SELECT id, public, file_size_limit, allowed_mime_types, updated_at
FROM storage.buckets
WHERE id IN ('team-crests', 'jugadores-fotos')
ORDER BY id;

-- 2) Objetos SVG en team-crests (por MIME guardado o por extensión).
SELECT name, metadata->>'mimetype' AS mimetype, created_at
FROM storage.objects
WHERE bucket_id = 'team-crests'
  AND (metadata->>'mimetype' = 'image/svg+xml' OR name ILIKE '%.svg')
ORDER BY created_at;

-- 3) Conteo por MIME en team-crests (detecta además cualquier tipo no raster,
--    p. ej. text/html o application/xml, que tampoco debería existir).
SELECT coalesce(metadata->>'mimetype', '(sin mimetype)') AS mimetype,
       count(*) AS objetos,
       min(created_at) AS primero,
       max(created_at) AS ultimo
FROM storage.objects
WHERE bucket_id = 'team-crests'
GROUP BY 1
ORDER BY objetos DESC;

-- 4) Objetos de team-crests cuyo MIME no es raster permitido (jpeg/png/webp).
SELECT name, metadata->>'mimetype' AS mimetype, created_at
FROM storage.objects
WHERE bucket_id = 'team-crests'
  AND coalesce(metadata->>'mimetype', '') NOT IN ('image/jpeg', 'image/png', 'image/webp')
ORDER BY created_at;

-- 5) Equipos cuyo escudo apunta a un SVG (decide qué UI se ve afectada).
SELECT t.id AS team_id, t.crest_url
FROM public.teams t
WHERE t.crest_url ILIKE '%.svg%'
   OR t.crest_url ILIKE '%.svgz%'
ORDER BY t.id;

-- 6) Fotos de miembros de equipo que apuntan a un SVG en team-crests.
SELECT tm.id AS team_member_id, tm.team_id, tm.photo_url
FROM public.team_members tm
WHERE tm.photo_url ILIKE '%/team-crests/%'
  AND (tm.photo_url ILIKE '%.svg%' OR tm.photo_url ILIKE '%.svgz%')
ORDER BY tm.team_id, tm.id;

-- 7) Control cruzado en jugadores-fotos (según el repo no admite SVG).
SELECT count(*) AS svg_en_jugadores_fotos
FROM storage.objects
WHERE bucket_id = 'jugadores-fotos'
  AND (metadata->>'mimetype' = 'image/svg+xml' OR name ILIKE '%.svg');

ROLLBACK;
