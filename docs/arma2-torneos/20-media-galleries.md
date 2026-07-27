# Fotos y galerías de partidos

Estado: dominio, contratos y superficies implementados para integración exclusiva
en `epic/arma2-torneos`. La carga binaria y la emisión de URLs firmadas continúan
bloqueadas hasta conectar y certificar un bucket privado en el staging aislado.

## Alcance

La fase incorpora:

- galerías por torneo, categoría o partido;
- carga por lotes con validación parcial y sesiones efímeras de un solo uso;
- moderación antes de publicar;
- portada y orden editorial;
- relaciones con equipo, jugador, partido y categoría;
- consentimiento explícito y revocable;
- reporte privado y retiro temporal;
- lectura autenticada para participantes relacionados;
- archivo o revocación sin borrado silencioso;
- una superficie organizativa y una galería responsive para el Participant Hub.

No incorpora bucket productivo, subida directa desde el navegador, CDN pública,
reconocimiento facial, publicación anónima, push, email ni automatización de
moderación.

## Modelo

| Tabla | Responsabilidad |
|---|---|
| `tournament_media_galleries` | Raíz editorial, alcance, visibilidad, estado y portada |
| `tournament_media_assets` | Metadatos del original, workflow, checksum y retención |
| `tournament_media_gallery_items` | Inclusión y orden estable dentro de una galería |
| `tournament_media_relations` | Tags tipados a partido, categoría, equipo o jugador |
| `tournament_media_variants` | Original y variantes procesadas, sin URLs públicas |
| `tournament_media_upload_sessions` | Token hasheado, expiración, límites y uso único |
| `tournament_media_moderation_actions` | Historial append-only de transiciones |
| `tournament_media_consents` | Decisión explícita y revocable por sujeto |
| `tournament_media_reports` | Reporte privado, estado y resolución |
| `tournament_media_assignments` | Fotógrafo asignado por torneo y vigencia |

Los assets nunca guardan una URL pública. `bucket_id` y `object_path` son
metadatos internos; el path se deriva en servidor del tenant, torneo, sesión y
asset. Las respuestas para participantes omiten bucket, path, checksum, tokens,
notas internas y auditoría.

## Workflow

```text
local selection
    → upload session requested
    → pending_upload
    → uploaded
    → processing
    → pending_review
    → approved ──→ published
         │
         └──────→ rejected

published ──→ hidden ──→ approved
```

La galería sigue `draft → review → published → archived|revoked`. Publicar
exige al menos un asset aprobado, portada válida y capability
`media.publish`. Ocultar un asset publicado lo retira de la proyección de
participantes. Archivar o revocar preserva historia; no elimina el objeto.

`complete_tournament_media_upload()` es un contrato confiable exclusivo para
`service_role`: verifica el hash del token, expiración, uso único, límites,
MIME, tamaño y path esperado antes de registrar original y variantes. El
frontend no puede autodeclarar una carga como completada.

## Storage y URLs

El bucket deberá ser privado. La migración no crea ni toca buckets: sólo agrega
políticas estáticas si `storage.objects` existe. Insert, lectura, update y
delete quedan limitados a `service_role`; no se concede acceso a `anon` ni
`authenticated`.

El adaptador confiable de staging debe:

1. consumir una sesión emitida por la RPC;
2. validar el archivo real antes de persistirlo;
3. escribir únicamente en el path derivado;
4. producir thumbnail, medium y large;
5. invocar la finalización una sola vez;
6. emitir URLs firmadas por lote, cortas y sólo para variantes autorizadas.

Hasta que ese adaptador y el bucket estén certificados, el contexto devuelve
`uploadReady: false`. La interfaz permite seleccionar y validar archivos, pero
explica el bloqueo y no simula progreso, éxito ni publicación de binarios.

## Autorización

Owner y admin poseen gestión completa. Collaborator tiene lectura
organizacional. Un fotógrafo necesita asignación vigente y las RPCs vuelven a
validar organización y torneo. Capitán/delegado y jugador sólo leen galerías
publicadas cuando una relación autoritativa de inscripción/roster los conecta
con su audiencia.

Capacidades:

`media.read`, `media.create_gallery`, `media.update_gallery`, `media.upload`,
`media.review`, `media.publish`, `media.archive`, `media.revoke`, `media.set_cover`,
`media.tag_team`, `media.tag_player`, `media.manage_consent` y
`media.handle_reports`.

RLS está habilitado en todas las tablas y se revocó el acceso directo. Las
mutaciones son RPC-only, resuelven el actor con `auth.uid()`, usan
`SECURITY DEFINER`, `search_path` vacío, grants mínimos y errores que no
confirman UUIDs de otro tenant.

## Consentimiento, menores y reportes

Un tag no equivale a consentimiento. La publicación individual exige una
decisión vigente cuando la política del torneo la requiere. Una revocación
impide nuevas lecturas y conserva la evidencia mínima necesaria para auditoría.
El flujo legal para menores, tutores y plazos de retención debe aprobarse antes
del lanzamiento; no se infiere consentimiento por integrar un roster.

El reporte del participante es privado. Puede solicitar retiro temporal; la
solicitud queda priorizada y sólo roles con `media.handle_reports` ven el motivo
y deciden ocultar o resolver. No se permite que un reporte aislado retire
globalmente contenido sin revisión, ni se muestra la identidad del denunciante
en la galería. La resolución conserva actor, timestamps y estado anterior/nuevo.

## UX implementada

La administración vive en `/torneos/o/:organizationSlug/multimedia` y ofrece
filtros, creación contextual, lote con errores por archivo, cola, moderación,
portada, orden, publicación, archivo y reportes. Las acciones no autorizadas se
muestran read-only.

Participantes acceden a `/torneos/torneo/:tournamentId/fotos`, al resumen del
torneo y al detalle de partido. La grilla usa miniaturas lazy, placeholder
protegido cuando falta URL, lightbox con foco contenido, Escape, flechas,
contador, cierre visible y reporte. No existe descarga del original.

Ambas superficies mantienen targets de 44 px, foco visible, una sola columna
en móvil, ausencia de scroll horizontal y `prefers-reduced-motion`.

## Contratos RPC

- administración: `get_tournament_media_admin_context`;
- lectura participante: `get_published_tournament_media`;
- creación/edición: `create_tournament_media_gallery`,
  `update_tournament_media_gallery`;
- sesión/finalización: `request_tournament_media_upload_session`,
  `complete_tournament_media_upload`;
- workflow: `transition_tournament_media_asset`,
  `change_tournament_media_gallery_state`,
  `publish_tournament_media_gallery`;
- composición: `set_tournament_media_cover`,
  `reorder_tournament_media_item`,
  `tag_tournament_media_asset`;
- gobierno: `manage_tournament_media_consent`,
  `assign_tournament_media_photographer`,
  `report_tournament_media_asset`,
  `handle_tournament_media_report`.

## Verificación y gates pendientes

La prueba focal PostgreSQL cubre tenants cruzados, capabilities, relaciones,
tokens, expiración, reuso, límites, MIME, workflow, portada, publicación,
consentimiento, reporte, retiro y minimización. Jest cubre validación parcial,
sesión segura, ausencia de progreso falso, doble click, read-only, late
responses, lightbox y responsive.

La certificación local de esta rama completó 57/57 verificaciones multimedia,
755/755 verificaciones PostgreSQL/RLS de Torneos y 245 suites Jest con 1.798
tests. El benchmark unitario pagina metadata allowlistada para 20, 100 y 1.000
assets sin originales. La inspección real en 320 × 700, 390 × 844, 768 × 1024
y 1440 × 900 no mostró overflow horizontal; todos los controles visibles
quedaron en al menos 44 × 44 px. ESLint, migration guard, `git diff --check` y
los builds con Torneos activo/producción apagada también finalizaron en verde.

Antes de llevar esta fase a `main` faltan:

- bucket privado y signer batch en staging aislado;
- antivirus y pipeline real de variantes;
- expiración, retry, cancelación y cleanup con objetos reales;
- auditoría de URLs/red con sesiones owner, fotógrafo, capitán y jugador;
- política legal aprobada para imagen, menores, retención y borrado;
- carga sintética 20/100/1000 con tiempos y costes reales;
- QA manual en 320 × 700, 390 × 844, 768 × 1024 y 1440 × 900;
- observabilidad, alertas y runbook de incidentes;
- revisión independiente de RLS, RPC y Storage.
