# Fotos y galerías de partidos

Estado auditado: contratos, metadata y superficies del dominio privado de
Multimedia.

> **Superado en parte.** La carga binaria dejó de estar bloqueada por una
> constante. `uploadReady` ahora se deriva de capacidades verificables —bucket
> privado real, policies presentes, signer y processor atestiguados— y el
> pipeline completo está documentado en
> [21-media-upload-pipeline.md](21-media-upload-pipeline.md). Este documento
> sigue siendo la referencia del dominio (tablas, RPCs, estados, moderación,
> consentimiento); donde dice "`uploadReady: false`" hay que leer "cerrado
> mientras falte evidencia". Sigue sin crearse ningún recurso cloud remoto.
>
> Un cambio de contrato respecto de lo escrito abajo: `media.read` ya no
> alcanza para leer el **original** de un asset. Ver la sección de permisos del
> documento 21.

## Alcance y límites

Incluye galerías privadas por torneo/categoría/partido, sesiones de carga,
moderación, portada y orden, relaciones tipadas, consentimiento revocable,
reporte privado, fotógrafo upload-only y lectura autenticada por relación
vigente.

No incluye bucket provisionado, subida directa, CDN pública, reconocimiento
facial, publicación anónima, push/email, automatización de moderación ni Estudio
Social. Los scopes `social_future`, `promotion_future` y `commercial` son sólo
clasificaciones legales: ningún endpoint los consume.

## Inventario exacto de la migración

La migración
`20260727060000_tournament_media_galleries.sql` crea 11 tablas:

| Tabla | Responsabilidad |
|---|---|
| `tournament_media_galleries` | Raíz editorial, tenant, alcance, audiencia, lifecycle y portada |
| `tournament_media_assets` | Metadata allowlistada, checksum, workflow y retención lógica |
| `tournament_media_gallery_items` | Inclusión, orden estable y caption |
| `tournament_media_relations` | Tags tipados a partido, equipo o jugador |
| `tournament_media_variants` | Original saneado y variantes procesadas sin URL pública |
| `tournament_media_upload_sessions` | Token hasheado, expiración, cuota, idempotencia y single-use |
| `tournament_media_moderation_actions` | Evidencia append-only de moderación |
| `tournament_media_consents` | Snapshot vigente por sujeto y scope |
| `tournament_media_consent_events` | Historial append-only de cada cambio de consentimiento |
| `tournament_media_reports` | Reporte privado, prioridad, estado y resolución |
| `tournament_media_assignments` | Asignación revocable de fotógrafo upload-only |

Conteos exactos:

- 117 constraints PostgreSQL derivadas del DDL: 11 PK, 41 FK, 12 unique y
  53 checks;
- 19 índices explícitos;
- 4 triggers de `updated_at`;
- 25 funciones: 17 RPCs públicas controladas y 8 helpers internos/trigger;
- RLS habilitado en las 11 tablas;
- 0 policies sobre metadata pública y 0 grants directos a `anon` o
  `authenticated`;
- 4 policies condicionales sobre `storage.objects`, sólo si ese esquema existe:
  insert/read de `service_role` y update/delete expresamente cerrados.

Índices explícitos:

```text
tournament_media_galleries_admin_idx
tournament_media_galleries_participant_idx
tournament_media_galleries_match_idx
tournament_media_assets_gallery_status_idx
tournament_media_assets_checksum_active_unique
tournament_media_assets_review_idx
tournament_media_gallery_items_order_idx
tournament_media_relations_unique
tournament_media_relations_scope_idx
tournament_media_variants_asset_idx
tournament_media_upload_sessions_actor_idx
tournament_media_upload_sessions_gallery_idx
tournament_media_moderation_actions_asset_idx
tournament_media_consents_subject_unique
tournament_media_consents_asset_idx
tournament_media_consent_events_consent_idx
tournament_media_reports_review_idx
tournament_media_reports_rate_idx
tournament_media_assignments_user_idx
```

Las 74 constraints con nombre explícito (9 FK, 12 unique y 53 checks),
agrupadas por tabla:

- galleries (9): `tournament_media_galleries_tournament_fk`,
  `title_check`, `description_check`, `status_check`, `visibility_check`,
  `version_check`, `lifecycle_check`, `scope_unique`, `creation_unique`;
- assets (12): `tournament_media_assets_gallery_fk`, `provider_check`,
  `path_check`, `safe_name_check`, `mime_check`, `size_check`,
  `dimensions_check`, `checksum_check`, `status_check`, `failure_check`,
  `gallery_id_unique`, `path_unique`;
- gallery items (6): `tournament_media_gallery_items_gallery_fk`,
  `asset_fk`, `order_check`, `caption_check`, `unique`, `order_unique`;
- relations (2): `tournament_media_relations_type_check`,
  `exact_target_check`;
- variants (8): `tournament_media_variants_kind_check`, `provider_check`,
  `path_check`, `mime_check`, `payload_check`, `status_check`, `unique`,
  `path_unique`;
- upload sessions (13): `tournament_media_upload_sessions_gallery_fk`,
  `token_check`, `provider_check`, `path_check`, `safe_name_check`,
  `mime_check`, `size_check`, `status_check`, `expiry_check`,
  `consumption_check`, `quota_check`, `request_unique`, `token_unique`;
- moderation (4): `tournament_media_moderation_actions_asset_fk`,
  `action_check`, `status_check`, `reason_check`;
- consents (5): `tournament_media_consents_subject_check`, `use_check`,
  `status_check`, `legal_basis_check`, `revocation_check`;
- consent events (3): `tournament_media_consent_events_subject_check`,
  `use_check`, `status_check`;
- reports (6): `tournament_media_reports_asset_fk`, `reason_check`,
  `detail_check`, `status_check`, `resolution_check`, `request_unique`;
- assignments (5): `tournament_media_assignments_gallery_fk`, `role_check`,
  `status_check`, `revocation_check`, `unique`.

El FK `tournament_media_galleries_cover_fk` se agrega después de crear assets y
completa las 74 constraints con nombre explícito. Las otras 43 son las 11 PK y
32 FK inline cuyo nombre deriva PostgreSQL. Las PK y unique constraints crean
además sus índices implícitos; los 19 anteriores son sólo los declarados con
`CREATE INDEX`.

## Estados y enums

```text
gallery: draft | under_review | published | archived | revoked
asset: uploading | processing | pending_review | approved | published
       rejected | hidden | revoked | failed
upload session: issued | uploaded | consumed | expired | revoked | failed
moderation: approve | reject | hide | restore | revoke | request_deletion
consent: unknown | allowed | denied | revoked | not_required
use scope: view_internal | share_internal | social_future
           promotion_future | commercial
relation: match | team | player
report: open | under_review | resolved | dismissed
visibility: organization | tournament_participants | match_participants
            related_teams | administrative_private
```

Publicar exige todos los items aprobados, cuatro variantes `ready` con
`metadata_stripped`, portada aprobada y consentimiento interno efectivo para
cada relación de jugador. Una decisión `unknown`, `denied` o `revoked`
prevalece de forma fail-closed. Si se revoca una portada publicada, se elige una
portada publicada de reemplazo bajo el mismo lock o se archiva la galería.
Restaurar una foto dentro de una galería publicada vuelve a validar
consentimiento.

## Matriz RPC

Todas las RPCs fijan `search_path = ''`, usan schemas explícitos, responden
fail-closed y no conceden `EXECUTE` a `PUBLIC`/`anon`.

| RPC | Actor/capability | Estado/lock | Idempotencia y auditoría |
|---|---|---|---|
| `create_tournament_media_gallery` | owner/admin + `media.create_gallery` | fixture vigente; lock por actor+intent | replay idéntico devuelve ID; payload distinto falla; audit create |
| `update_tournament_media_gallery` | `media.update_gallery` | draft/review; org→gallery | versión y audit update/submit |
| `request_tournament_media_upload_session` | `media.upload` o assignment | draft/review; org→gallery | intent idéntico sin reexponer token; conflicto falla; audit issued |
| `complete_tournament_media_upload` | `service_role` con actor autenticado | sesión issued, no vencida; org→gallery→session | single-use; metadata allowlistada; audit system |
| `cancel_tournament_media_upload_session` | solicitante o manager | issued; org→gallery→session | revoked idempotente; audit cancel |
| `transition_tournament_media_asset` | review o revoke | transición válida; org→gallery→asset | una sola transición y moderation/audit |
| `change_tournament_media_gallery_state` | archive/revoke | estado válido; org→gallery | mismo estado idempotente; audit |
| `set_tournament_media_cover` | `media.set_cover` | draft/review; org→gallery | portada aprobada de la misma galería; audit |
| `reorder_tournament_media_item` | `media.update_gallery` | draft/review; gallery/items | renumeración atómica; audit |
| `tag_tournament_media_asset` | tag team/player | draft/review; org→gallery | scope autoritativo; unique/no-op |
| `manage_tournament_media_consent` | `media.manage_consent` | org→gallery→asset→consent | identidad canónica; replay idéntico no duplica evento; audit + event |
| `publish_tournament_media_gallery` | `media.publish` | draft/review; org→gallery | publish concurrente idempotente; audit |
| `assign_tournament_media_photographer` | `media.update_gallery` | org→gallery | assignment unique; revoke corta sesiones issued; audit |
| `get_tournament_media_admin_context` | `media.read` | sólo lectura, filtros acotados | payload allowlistado; reportes sólo con capability |
| `get_published_tournament_media` | relación participante vigente | sólo published y audiencia exacta | sin paths, checksum, actor ni original |
| `report_tournament_media_asset` | lector autorizado del asset | asset published; lock por reporter | replay idéntico; conflicto falla; rate limit; audit |
| `handle_tournament_media_report` | `media.handle_reports` | open/review; row lock | mismo estado idempotente; resolución auditada |

Helpers internos sin grant cliente:

```text
touch_tournament_media_updated_at
tournament_media_role_capabilities
has_tournament_media_capability
has_tournament_media_assignment
tournament_media_user_can_upload
current_user_has_media_team_relation
tournament_media_asset_has_internal_consent
can_current_user_read_media_gallery
```

## Default-deny y privacidad

Owner, admin, collaborator, fotógrafo, capitán, jugador, outsider y anon no
pueden consultar ninguna de las 11 tablas directamente. Los clientes sólo usan
RPCs allowlistadas. Collaborator recibe `media.read`; owner/admin reciben las
13 capabilities de gestión. El fotógrafo sólo puede solicitar carga en su
galería asignada: no publica, modera, etiqueta, ve planteles, reportes,
consentimientos ni auditoría.

Los assets nunca guardan URLs públicas. La proyección participante omite bucket,
path, checksum, token, uploader, reporter, notas y auditoría. Un jugador
removido, capitán revocado, membership suspendida o equipo retirado pierde la
relación autoritativa en la siguiente lectura.

## Sesión y contrato de archivos

La intención acepta JPEG, PNG o WebP, máximo 12 MiB, máximo 36 Mpx y hasta 40
sesiones abiertas por actor. El backend deriva:

```text
organization_id/tournament_id/gallery_id/random_uuid.ext
```

La extensión sale del MIME permitido; el cliente no elige path ni nombre final.
El token contiene 32 bytes aleatorios, sólo se persiste SHA-256, vence en diez
minutos, no aparece en logs/auditoría y nunca se devuelve en un replay. El
checksum activo tiene índice único parcial por organización para resolver
deduplicación concurrente.

`complete_tournament_media_upload` es un contrato confiable exclusivo de
`service_role`, pero requiere un actor autenticado que coincida con quien emitió
la sesión y vuelve a validar assignment/membership. Registra el original y deja
thumbnail/grid/detail en `processing`; no se puede aprobar ni publicar hasta
que las cuatro variantes estén listas y marcadas como metadata saneada.

## Storage: probado y no probado

Probado localmente:

- path, MIME, tamaño, dimensiones, token, expiración, single-use y cuotas en
  metadata;
- grants/RLS de las 11 tablas;
- definición estática de policies condicionales;
- `uploadReady: false` en RPC, servicio y UI.

No probado y deliberadamente no afirmado:

- existencia/configuración real de `storage.objects`;
- bucket privado, signer, escritura/lectura real, URLs firmadas o revocación;
- inspección real de magic bytes, antivirus, EXIF/GPS o variantes;
- cleanup de objetos, retries del worker, CDN, egress y costes.

El `service_role` de Supabase puede omitir RLS. Por eso las policies no sustituyen
el aislamiento del signer/worker: el staging debe certificar que el servicio
deriva el path, valida el objeto real y nunca expone su clave. Hasta entonces la
UI no ofrece una carga funcional, progreso ni éxito ficticio.

## UX y accesibilidad

La administración vive en `/torneos/o/:organizationSlug/multimedia`.
Participantes acceden desde torneo y partido. La grilla usa thumbnails lazy,
placeholder protegido, lightbox con foco contenido, flechas, contador, Escape,
cierre visible y reporte privado. No existe descarga del original.

QA local sintética validada en 320×700, 390×844, 768×1024 y 1440×900:

- sin overflow horizontal;
- controles visibles de al menos 44 px;
- un encabezado principal en la superficie administrativa;
- modo read-only sin acciones ni inferencia de reportes;
- estados vacío/error;
- formulario de reporte, doble Escape y restauración del foco.

La UI comunica “La carga de fotos todavía no está habilitada en este entorno”
sin mencionar bucket, Storage, signer ni staging al usuario final.

## Hallazgos de la auditoría final

| Severidad original | Hallazgo | Corrección/evidencia |
|---|---|---|
| Alta | fotógrafo podía recibir review y completar una sesión tras revoke | assignment upload-only; revoke invalida sesiones; tests actor/RPC/direct-table |
| Alta | publicación parcial o con variantes inseguras | todos los items aprobados + 4 variantes saneadas; test de publicación parcial |
| Alta | consentimientos equivalentes podían contradecirse y restore eludir revoke | identidad canónica, historial append-only, precedencia fail-closed y recheck al restore |
| Alta | portada/tag mutables en published y portada revocada podía romper invariantes | inmutabilidad editorial y reemplazo/archivo atómico |
| Alta | collaborator podía inferir reportes privados | detalle y contador condicionados a `media.handle_reports` |
| Alta | deduplicación y rate limit vulnerables a carrera | índice único parcial y locks por reporter |
| Alta | idempotency keys aceptaban payloads distintos | replay idéntico o `TORNEOS_MEDIA_IDEMPOTENCY_CONFLICT`; create concurrente serializado |
| Alta | alcance de jornada/partido no exigía fixture vigente | join a fixture published no invalidado al crear |
| Media | no existía cancelación explícita de sesión | RPC cancel + audit + test de finalización rechazada |
| Media | copy técnica exponía Storage/staging | copy de producto no técnica; test negativo |

Hallazgos críticos o altos abiertos en el alcance del PR: **0**.

## Compatibilidad Supabase revisada

Al 27-07-2026, Supabase está desplegando el cambio por el cual tablas nuevas en
`public` dejan de exponerse automáticamente a Data API/GraphQL. Esta migración
no depende del default: revoca explícitamente tablas privadas y concede sólo
RPCs concretas. Grants y RLS siguen siendo capas independientes.

Referencias:

- https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/storage/security/access-control

## Verificación local

Última ejecución de PostgreSQL/RLS:

```text
npm run test:db:torneos
879/879 verificaciones aprobadas

node scripts/db-integration/torneos-media-galleries.mjs
181/181 verificaciones multimedia aprobadas

npm run test:ci -- --runInBand
245/245 suites · 1.799/1.799 tests
```

También quedaron verdes Jest focalizado, ESLint, migration guard,
`git diff --check`, secret scan, build Torneos activo contra localhost aislado
y build de producto con flags apagados. El package lock y los proyectos nativos
no forman parte de este PR.

## Gates obligatorios antes de habilitar carga

- bucket privado y signer batch en staging aislado;
- detector real de MIME/magic bytes, antivirus y pipeline de variantes;
- stripping verificable de EXIF/GPS/device metadata;
- expiración, retry, cancelación y cleanup con objetos reales;
- QA owner/admin/fotógrafo/capitán/jugador sobre red y URLs;
- política legal aprobada para imagen, menores, retención y borrado;
- carga sintética 20/100/1000 con tiempos, egress y costes reales;
- observabilidad, alertas y runbook/rollback;
- revisión independiente de RLS, RPC, Storage y claves.

Ninguno de estos gates puede resolverse cambiando `uploadReady` sin evidencia
de staging — y desde el pipeline de carga ya no existe un `uploadReady` que se
pueda cambiar a mano. El estado de cada gate y los pendientes exactos están en
[21-media-upload-pipeline.md](21-media-upload-pipeline.md).
