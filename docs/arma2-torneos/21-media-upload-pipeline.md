# Multimedia Upload · pipeline de carga real

> **SUPERSEDIDO EN PARTE.** Este documento describe la primera revisión del
> pipeline. Una auditoría posterior encontró tres agujeros en ella:
> `uploadReady` podía ser true con `pixelTranscode:false` y
> `antivirusScanning:false`; la atestación aceptaba cualquier objeto jsonb; y
> `request_tournament_media_upload_session` emitía sesión, token, path, cuota y
> auditoría con `uploadReady:false`. Además el `original` publicado era una
> copia de lo subido y las renditions publicadas eran las del navegador.
>
> La arquitectura, la readiness, el saneamiento y el modelo de amenazas
> vigentes están en
> **[23-media-trusted-processing.md](23-media-trusted-processing.md)**.
> Lo que sigue se conserva como registro de qué se cambió y por qué.

Estado: implementado y certificable **localmente**. `uploadReady` dejó de ser
una constante y pasó a derivarse de capacidades verificables. En cualquier
entorno sin bucket privado, sin signer atestiguado o sin processor atestiguado
—incluida Production, que además fuerza las flags a false— la carga sigue
cerrada sin necesidad de un deploy.

Este documento describe **exactamente** qué se verifica y qué no. Lo segundo es
tan importante como lo primero: la atestación del processor declara
`pixelTranscode: false` y `antivirusScanning: false`, y la readiness los expone
tal cual.

## Qué se reutiliza sin cambios

Todo el contrato auditado en [20-media-galleries.md](20-media-galleries.md):
las 11 tablas, las 17 RPCs cliente, los estados, las cuotas, el path
`organization_id/tournament_id/gallery_id/uuid.ext`, el `safe_name`
`foto-<12hex>.ext`, la taxonomía de variantes
`thumbnail | grid | detail | original` y las invariantes de publicación
(cuatro variantes `ready` con `metadata_stripped`, portada aprobada,
consentimiento interno efectivo).

No se creó una segunda taxonomía, ni una segunda tabla de sesiones, ni una RPC
paralela de completado.

## Arquitectura

```text
navegador                     signer                processor            base
   │                         (Edge)                  (Edge)
   │ 1 decode + orientación
   │   + re-encode canvas
   │ 2 request_..._upload_session ─────────────────────────────────────▶ intent
   │ 3 upload-intent ──────▶ authorize_upload_target ──────────────────▶ path
   │ 4 PUT bytes ─────────▶ (signed upload URL) ──▶ bucket privado
   │ 5 finalize (3 renditions) ─────────────▶ descarga el objeto real
   │                                          verifica y sanea
   │                                          escribe -original y variantes
   │                                          complete_..._for_actor ──▶ asset
   │                                          finalize_..._variants ──▶ ready
   │ 6 read-urls ──────────▶ authorize_read ──────────────────────────▶ path
   │                         signed URL 300 s
```

### Por qué el navegador re-encodea

Es el único componente del stack con un codec real. El re-encode en canvas hace
tres cosas que el servidor no puede hacer sin un codec: aplica la orientación
EXIF a los píxeles, elimina toda la metadata, y produce las tres renditions.

Eso **no** es una decisión de confianza. El processor vuelve a derivar de los
bytes que él mismo descarga del bucket: contenedor real, MIME real, dimensiones
reales, tamaño real y SHA-256 real. La geometría de cada rendition se recalcula
con la fórmula compartida a partir de las dimensiones que midió el processor, y
cualquier diferencia rechaza la carga entera.

### Saneamiento: exigido, no aplicado

El processor no re-encodea. Por lo tanto no puede "arreglar" un archivo con
metadata: si al quitar los portadores de metadata el resultado difiere aunque
sea en un byte, la carga se rechaza (`MEDIA_METADATA_PRESENT`). Lo mismo con la
orientación: un `Orientation` distinto de 1 se rechaza
(`MEDIA_ORIENTATION_NOT_NORMALIZED`).

La consecuencia deseada es que el checksum y el `byte_size` registrados en la
base describen **el objeto exacto** que quedó en el bucket. No hay una versión
"antes" y otra "después".

## Qué verifica realmente el processor

`supabase/functions/_shared/tournamentMediaImage.ts`, sin dependencias, sin red:

| Verificación | JPEG | PNG | WebP |
|---|---|---|---|
| Magic bytes | ✅ | ✅ | ✅ |
| Recorrido estructural completo hasta el terminador | ✅ segmentos + scan entropy-coded | ✅ chunks | ✅ chunks RIFF |
| Integridad criptográfica por chunk | — | ✅ CRC32 de cada chunk | — |
| Dimensiones reales del bitstream | ✅ SOFn | ✅ IHDR | ✅ VP8 / VP8L / VP8X |
| Rechazo de truncado | ✅ | ✅ | ✅ |
| Rechazo de bytes después del terminador | ✅ | ✅ | ✅ |
| Rechazo de animación | n/a | ✅ APNG | ✅ ANIM/ANMF |
| Rechazo de chunk crítico desconocido | n/a | ✅ | n/a |
| Eliminación de metadata | APP1–APP13, APP15, COM | tEXt, zTXt, iTXt, eXIf, iCCP, tIME, sPLT | EXIF, XMP, ICCP + flags VP8X |
| Lectura de orientación EXIF | ✅ | n/a | n/a |
| SVG y otro markup | ✅ rechazado | ✅ rechazado | ✅ rechazado |

### Lo que NO hace, declarado como tal

- **No decodifica píxeles.** Un archivo estructuralmente válido cuyo payload
  entropy-coded esté semánticamente roto se acepta y simplemente se ve mal.
  Detectarlo requiere un codec real.
- **No re-encodea.** `pixelTranscode: false`.
- **No es un antivirus.** `antivirusScanning: false`. No hay ClamAV ni escáner
  equivalente reproducible dentro del Edge Runtime de Deno, y simular una
  certificación antivirus sería peor que no tenerla.

Ninguna de estas tres cosas se puede activar cambiando un booleano: la
atestación las reporta y la readiness las expone al cliente.

## Cómo se deriva `uploadReady`

`public.tournament_media_pipeline_readiness()` es la conjunción de:

1. `storage.buckets` tiene `tournament-media` y `public = false`;
2. existen las cuatro policies `tournament_media_service_*`;
3. ninguna policy de escritura sobre `storage.objects` menciona el bucket para
   `anon`, `authenticated` o `public`;
4. el **signer** tiene una atestación vigente con `signedUploadUrls`,
   `signedReadUrls` y `derivesPathServerSide`;
5. el **processor** tiene una atestación vigente con `contentSniffing`,
   `structuralDecode`, `metadataStripping`, `checksumVerification` y
   `variantGeneration`.

Las atestaciones vencen solas (tope duro de 24 h, 1 h en la práctica). Si un
servicio deja de responder, la carga se cierra sin intervención. Cada bloqueo se
reporta con nombre propio en `blockers`.

Las atestaciones son **evidencia, no declaración**:

- el signer escribe un PNG de 1×1 por una signed upload URL, firma una lectura,
  la descarga y la borra antes de atestiguar;
- el processor corre un self-test contra fixtures de encoders reales compilados
  en el bundle y sólo atestigua si pasa; si falla, revoca su propia atestación.

## Bucket: operativo, no migratorio

El bucket **no se crea en una migración**. Una migración que lo creara
provisionaría storage en la nube en cada `db push`, incluidos Staging y
Production. En su lugar:

- la base trae un **verificador fail-closed**
  (`tournament_media_storage_contract_status`) que lee el estado real;
- el aprovisionamiento local es un script que **rechaza cualquier host que no
  sea loopback**, sin flag de override:

```bash
npm run storage:tournament-media:local
```

En Staging el bucket lo crea un operador, con `public = false`, límite de 12 MiB
y allowlist `image/jpeg, image/png, image/webp`.

## Superficie de permisos

Ninguna función nueva se concede a `anon` ni a `authenticated`. El navegador
llega al pipeline exclusivamente por las dos Edge Functions.

| Contrato | Rol |
|---|---|
| `authorize_tournament_media_upload_target` | `service_role` |
| `complete_tournament_media_upload_for_actor` | `service_role` |
| `finalize_tournament_media_variants` | `service_role` |
| `authorize_tournament_media_read` | `service_role` |
| `fail_tournament_media_upload_session` | `service_role` |
| `cleanup_tournament_media_upload_sessions` | `service_role` |
| `attest_tournament_media_service` | `service_role` |

### Lectura de originales

Cambió respecto de la fase anterior. `media.read` (collaborator) da acceso a las
variantes derivadas de cualquier asset de la organización, pero **no** al
original. El original requiere `media.review` (owner/admin) o ser el fotógrafo
asignado que lo subió. Revocar la asignación corta la lectura del original de
inmediato, no sólo las cargas nuevas.

## Cleanup

`cleanup_tournament_media_upload_sessions(limit)` vence las sesiones `issued`
pasadas de hora y devuelve los nombres de objeto purgables. Nunca devuelve el
objeto de una sesión `consumed`: esos bytes pertenecen a un asset.
`tournament_media_known_object_names(organization_id)` da el conjunto
autoritativo para barridos de huérfanos.

## Modelo de amenazas cubierto

| Amenaza | Mitigación | Test |
|---|---|---|
| MIME falso / extensión falsa | magic bytes + recorrido estructural | `tournament-media-image.test.mjs` |
| SVG o polyglot con contenido activo | markup detectado + bytes después del terminador rechazados | idem |
| Archivo corrupto o truncado | recorrido hasta EOI/IEND + CRC32 en PNG | idem |
| Metadata/EXIF/GPS filtrada | stripper + rechazo si no era limpio | idem |
| Animación disfrazada de foto | APNG/ANIM rechazados | idem |
| Path traversal | el cliente nunca envía path; la base lo deriva y hay CHECK con regex | `torneos-media-upload-pipeline.mjs` |
| Overwrite / replay de sesión | single-use + signed upload URL sin upsert + asset existente bloquea la firma | idem + `tournament-media-storage-local.test.mjs` |
| Retarget de una firma a otro objeto | la firma está atada al nombre | storage local |
| Cross-tenant | capability por organización + segundo tenant probado | pipeline |
| Publicación incompleta | 4 variantes `ready` + `metadata_stripped` | pipeline |
| Lectura anónima o directa del bucket | sin policies para `anon`/`authenticated`; bucket privado | storage local |
| Signed URL vencida o manipulada | probado contra el servicio real | storage local |
| Consentimiento revocado | fail-closed en lectura y publicación | pipeline |
| Fotógrafo revocado | corta cargas y lectura del original | pipeline |
| Servicio caído o degradado | atestación vencida cierra la carga sola | pipeline |

## Cómo correrlo local

```bash
npx supabase start
npm run storage:tournament-media:local
npx supabase functions serve
```

Secretos locales necesarios para el health/atestación:

```bash
TOURNAMENT_MEDIA_ATTESTATION_SECRET=<cualquier valor local>
```

```bash
npm run test:db:torneos:media-upload
npm run test:edge-functions
TOURNAMENT_MEDIA_LOCAL_TEST=true npm run test:storage:local
```

## Pendientes exactos para certificar en Staging

Ninguno de estos se resuelve cambiando un booleano.

1. Crear el bucket privado en el proyecto de Staging autorizado (operativo).
2. Desplegar `tournament-media-signer` y `tournament-media-processor` y cargar
   `TOURNAMENT_MEDIA_ATTESTATION_SECRET`.
3. Correr el health de ambos y verificar que `uploadReady` pase a `true` **por
   evidencia**, con `blockers` vacío.
4. QA multirol real sobre red: owner, admin, collaborator, fotógrafo asignado,
   fotógrafo revocado, capitán, jugador, outsider, segundo tenant.
5. Carga sintética 20 / 100 / 1000 con tiempos, egress y costo medidos.
6. Programar el cleanup y verificar el barrido de huérfanos contra el bucket.
7. Decidir e implementar el tier `pixelTranscode` (worker externo) antes de
   abrir la carga a actores menos confiables que el staff de la organización.
8. Decidir el escáner antivirus y su ubicación.
9. Política legal aprobada de imagen, menores, retención y borrado.
10. Observabilidad, alertas y runbook de rollback.

## Costos operativos estimados

Con el contrato actual, por foto se almacenan cuatro objetos: original saneado
(≤ 12 MiB, típicamente 1–3 MB), detail (~200–500 KB), grid (~60–150 KB) y
thumbnail (~10–30 KB). Una jornada de 200 fotos ronda **0,4–0,8 GB**
almacenados. El egress lo domina `grid` en la grilla de participantes y
`detail` en el lightbox; con URLs firmadas de 300 s no hay caché de CDN
reutilizable entre usuarios, así que el egress escala con vistas, no con fotos.
Las cuotas vigentes (5 GiB por organización, 2 GiB por torneo, 512 MiB por
galería) acotan el peor caso por tenant. Números reales sólo salen de la carga
sintética en Staging.
