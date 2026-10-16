-- Arma2 Core — inventario SOLO LECTURA del bucket público `team-crests` (SVG).
--
-- Paquete: docs/ops/core-storage/TEAM-CRESTS-SVG.md
-- Proyecto objetivo: Core Production (rcyuuoaqfwcembdajcss) — lo ejecuta una
-- persona con GO, nunca un agente ni CI.
--
-- Contrato:
--   * Sólo SELECT dentro de BEGIN READ ONLY; termina en ROLLBACK.
--   * No escribe, no borra, no cambia buckets ni policies.
--   * Nunca selecciona columnas de partidos/usuarios/jugadores: sólo
--     EXISTS por la columna que referencia la URL (o el id), sin listas
--     explícitas de columnas.
--   * La consulta 8 es SALIDA SENSIBLE (ids de objeto ligados a rutas con
--     uid): guardarla fuera del repo, no pegarla en PRs ni chats. No devuelve
--     rutas, nombres ni emails.
--   * Ninguna consulta abre ni descarga el contenido de un objeto.
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

-- 7) Control cruzado en jugadores-fotos (hoy no admite SVG; inventario
--    2026-10-16: 6 SVG legacy, anteriores al allowlist actual).
SELECT count(*) AS svg_en_jugadores_fotos
FROM storage.objects
WHERE bucket_id = 'jugadores-fotos'
  AND (metadata->>'mimetype' = 'image/svg+xml'
       OR name ILIKE '%.svg'
       OR name ILIKE '%.svgz');

-- 8) SALIDA SENSIBLE — SVG legacy en jugadores-fotos, una fila por objeto.
--    Inventario 2026-10-16: 6 objetos. Devuelve sólo id de objeto, forma de
--    la ruta, forma del owner, fecha, tamaño, MIME y si alguna fila los
--    referencia. NO devuelve la ruta (contiene uids), ni nombres ni emails.
--    Referencia = la columna contiene '/jugadores-fotos/<name>' (strpos, no
--    LIKE: '_' y '%' del nombre no actúan como comodines). Limitación: no
--    decodifica URLs (%20 etc.); un nombre con caracteres codificados puede
--    figurar como no referenciado.
WITH svg AS (
  SELECT o.id, o.name, o.owner_id, o.created_at, o.metadata
  FROM storage.objects o
  WHERE o.bucket_id = 'jugadores-fotos'
    AND (o.metadata->>'mimetype' = 'image/svg+xml'
         OR o.name ILIKE '%.svg'
         OR o.name ILIKE '%.svgz')
),
shaped AS (
  SELECT s.id,
         s.owner_id,
         s.created_at,
         s.metadata,
         CASE
           WHEN s.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
             THEN 'uid_carpeta'
           WHEN s.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_'
             THEN 'uid_prefijo_legacy'
           WHEN s.name LIKE 'guest/%' THEN 'invitado_votacion'
           WHEN s.name LIKE 'partido\_%' THEN 'partido_frecuente_legacy'
           ELSE 'otra'
         END AS forma_ruta,
         lower(substring(s.name FROM '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})')) AS uid_ruta,
         '/jugadores-fotos/' || s.name AS needle
  FROM svg s
)
SELECT sh.id AS object_id,
       sh.forma_ruta,
       CASE
         WHEN sh.owner_id IS NULL THEN 'sin_owner'
         WHEN sh.uid_ruta IS NULL THEN 'owner_sin_uid_en_ruta'
         WHEN lower(sh.owner_id) = sh.uid_ruta THEN 'owner_igual_ruta'
         ELSE 'owner_distinto_ruta'
       END AS owner_forma,
       sh.created_at,
       (sh.metadata->>'size')::bigint AS bytes,
       sh.metadata->>'mimetype' AS mimetype,
       (sh.uid_ruta IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.usuarios u WHERE u.id::text = sh.uid_ruta)) AS cuenta_existe,
       EXISTS (SELECT 1 FROM public.usuarios u
               WHERE strpos(u.avatar_url, sh.needle) > 0) AS ref_usuarios,
       EXISTS (SELECT 1 FROM public.jugadores j
               WHERE strpos(j.avatar_url, sh.needle) > 0) AS ref_jugadores,
       EXISTS (SELECT 1 FROM public.profiles p
               WHERE strpos(p.avatar_url, sh.needle) > 0) AS ref_profiles,
       EXISTS (SELECT 1 FROM public.team_members tm
               WHERE strpos(tm.photo_url, sh.needle) > 0) AS ref_team_members,
       EXISTS (SELECT 1 FROM public.teams t
               WHERE strpos(t.crest_url, sh.needle) > 0) AS ref_teams,
       EXISTS (SELECT 1 FROM public.tournament_roster_players trp
               WHERE strpos(trp.avatar_url, sh.needle) > 0) AS ref_tournament_roster,
       EXISTS (SELECT 1 FROM public.tournament_match_squad_players tsp
               WHERE strpos(tsp.avatar_url_snapshot, sh.needle) > 0) AS ref_tournament_squad_snapshot,
       EXISTS (SELECT 1 FROM public.tournament_match_operation_players top
               WHERE strpos(top.avatar_url_snapshot, sh.needle) > 0) AS ref_tournament_operation_snapshot
FROM shaped sh
ORDER BY sh.created_at, sh.id;

-- 9) Resumen NO sensible de la consulta 8 (sólo conteos por forma de ruta).
SELECT CASE
         WHEN o.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
           THEN 'uid_carpeta'
         WHEN o.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_'
           THEN 'uid_prefijo_legacy'
         WHEN o.name LIKE 'guest/%' THEN 'invitado_votacion'
         WHEN o.name LIKE 'partido\_%' THEN 'partido_frecuente_legacy'
         ELSE 'otra'
       END AS forma_ruta,
       count(*) AS objetos,
       min(o.created_at) AS primero,
       max(o.created_at) AS ultimo
FROM storage.objects o
WHERE o.bucket_id = 'jugadores-fotos'
  AND (o.metadata->>'mimetype' = 'image/svg+xml'
       OR o.name ILIKE '%.svg'
       OR o.name ILIKE '%.svgz')
GROUP BY 1
ORDER BY objetos DESC;

ROLLBACK;
