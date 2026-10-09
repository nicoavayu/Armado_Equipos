# MEDIA-V1 — galería de fotos en la composición híbrida

Recorrido: el organizador crea una galería (torneo, categoría o partido) → sube fotos → revisa (aprobar / rechazar),
elige portada y orden → publica para la audiencia de la galería → el participante la encuentra desde su torneo o su
partido y la ve → el organizador puede retirar contenido (retirar / restaurar una foto, archivar la galería, resolver
reportes privados).

## Qué se reutilizó

- Todo el dominio de galerías del baseline de Torneos (`00000000000000`): 11 tablas, estados, moderación, consentimiento
  (fail-closed en lectura y publicación), reportes, auditoría, idempotencia, límites de archivo.
- El tier `MVP_SIMPLE` tal cual: `request_tournament_media_upload_session` (rate limit, sesiones abiertas, readiness) y
  `complete_tournament_media_simple_upload` (asset `pending_review`, dedupe por SHA-256 en la organización).
- La cuota comercial vigente: `tournament_plan_catalog.gallery_asset_limit` por temporada (FREE 25 / PREMIUM 1000),
  aplicada en servidor por `enforce_tournament_media_gallery_limit` al pedir cada carga. No se agregó ningún límite
  comercial; Mi plan muestra exactamente esas cifras.
- La lectura: `authorize_tournament_media_read` decide quién ve qué (staff con `media.read` + acceso a la temporada, o
  participante de una galería publicada, asset publicado, consentimiento interno y audiencia de la galería).
- El verificador estructural del pipeline (`supabase/functions/_shared/tournamentMediaImage.ts`), copiado byte a byte en
  el gateway (el grafo de deploy nunca alcanza `_shared`; un test falla ante cualquier diferencia).
- Las pantallas existentes: Centro Multimedia (`MediaAdminPage`) y galería del participante (`ParticipantMediaGallery`)
  ya montadas en el hub del torneo, en el partido y en Mis torneos.

## Qué se completó y por qué

| Pieza | Por qué |
|---|---|
| Migración `0012` | El MVP necesitaba un signer y un processor con service role en el proyecto Core. En la composición híbrida el gateway no tiene ni debe tener service key. El escritor confiable pasa a ser el gateway, identificado por un claim que sólo él firma |
| Claim `torneos_media_upload_session` | Token puente normal (misma identidad, sesión Core, TTL 120 s) + el id de la sesión de carga. Storage sólo acepta escritura en el path exacto de esa sesión, y sólo ese claim puede completar la carga con el veredicto de sanitización. El navegador nunca lo recibe; el gateway rechaza cualquier token presentado que lo traiga |
| `POST /torneos/media/v1/upload` | Una foto normalizada (≤ 4 MiB, ≤ 1600 px / 2,56 MP) verificada ANTES de pedir sesión (un archivo inválido no gasta cuota), escrita sin upsert (inmutable) y registrada en `pending_review` |
| Reintento sin duplicar | `begin_tournament_media_gallery_upload`: la misma clave devuelve la foto ya creada (`uploaded`) si la primera respuesta se perdió; un doble toque recibe `IN_PROGRESS`. La UI reintenta siempre con la misma clave |
| `POST /torneos/media/v1/urls` | URLs firmadas de 300 s, con el token del propio usuario: storage RLS (`can_read_tournament_media_object`) vuelve a aplicar la autorización del baseline en cada firma |
| Entrega participante | `get_published_tournament_media` decía `staging_required` en `MVP_SIMPLE` (no hay signer atestiguado por diseño): ahora entrega firmado cuando el bucket privado está listo |
| Retiro de contenido | Los grants de `transition_tournament_media_asset`, `change_tournament_media_gallery_state` y `report_tournament_media_asset` estaban cerrados desde 0001. Etiquetado, consentimientos y fotógrafos siguen cerrados |
| Tope de selección 8 → 25 MiB | Lo elegido nunca sale del dispositivo; 8 MiB rechazaba fotos comunes de iPhone de 24 MP. Lo que viaja sigue en ≤ 4 MiB |
| UX organizador | cuota de la temporada en palabras («Quedan 13 de 25»), progreso real de bytes, error por archivo, reintento sin duplicar, doble toque, HEIC explicado antes de cargar, «Retirar» en vez de borrar |
| UX participante | la grilla dibujaba la proyección sin URL (bug previo: placeholders para siempre con datos reales); swipe, teclado, bloqueo de scroll, precarga de vecinas, estado de carga, renovación de un link vencido |

## Seguridad (lo que se probó)

- Escritura: sólo el gateway (claim) en el path exacto de una sesión viva `MVP_SIMPLE` del mismo actor, con permiso
  vigente para subir a esa galería; nada ocupa el path; objetos inmutables; `clientWriteBlocked` sigue verificando que
  ninguna otra policy cliente escriba en el bucket.
- Completar: sólo con el claim de ESA sesión y con el objeto presente en el bucket con el tamaño verificado.
- Lectura: nunca `anon`; cambiar ids en la URL o el body no alcanza: cada asset pasa por `authorize_tournament_media_read`
  para la identidad que llama, y storage lo vuelve a decidir al firmar.
- Retiro: ocultar / revocar / archivar corta las firmas nuevas al instante. Un link ya entregado sigue válido hasta su
  vencimiento (≤ 300 s): límite conocido de las URLs firmadas.

## Límites honestos de `MVP_SIMPLE` (no equivale a `PROCESSOR_EXTERNAL`)

Igual que `docs/arma2-torneos/24-media-free-mvp.md`: sin antivirus, sin decodificación de píxeles en servidor, sin
re-encode de servidor. La limpieza de metadatos depende del re-encode del navegador y de que el verificador del
gateway confirme que no quedó ningún portador (si queda uno, la carga se rechaza). Sólo owner/admin suben.

No incluido: galerías públicas para visitantes anónimos (el modelo no tiene esa audiencia y necesita política legal),
etiquetado de jugadores y consentimientos desde la UI, fotógrafos, borrado físico de un objeto (retirar = moderación),
miniaturas físicas (ver costos).

## Costos y límites operativos (plan Free, sin servicios pagos)

- **Almacenamiento**: una foto normalizada pesa ~0,3–0,7 MB (1600 px). Una temporada FREE completa (25) ≈ 15 MB; una
  PREMIUM completa (1000) ≈ 0,4–0,7 GB. **El proyecto Torneos Free tiene 1 GB de Storage en total**: dos o tres
  temporadas Premium llenas lo agotan. Hace falta una alarma de uso de Storage antes de vender Premium a escala.
- **Egreso**: `MVP_SIMPLE` guarda un único objeto; la grilla usa la misma imagen que el visor. Abrir una galería con
  portada + 7 miniaturas descarga ~3–5 MB. Con 5 GB de egreso mensual del plan Free son ~1.000–1.500 aperturas de
  galería por mes en todo el proyecto. Las URLs cambian en cada firma, así que el caché del navegador sólo sirve
  dentro de la misma sesión de página. **Recomendación antes del lanzamiento a escala: miniaturas reales** (una
  segunda imagen de ~480 px generada en el navegador y verificada por el gateway) — reduce ~10× el egreso de la grilla.
- **Gateway** (Cloud Run en Producción, timeout 30 s, máximo 3 instancias): cada carga atraviesa el gateway (≤ 4 MiB de
  entrada y de salida hacia Storage). La verificación es lineal en bytes (decenas de ms por foto). Una foto típica
  (0,3–0,7 MB) tarda ~3–6 s con 1 Mbps de subida; una de 4 MiB necesita ~35 s y con un uplink de 1 Mbps puede chocar
  con el timeout de 30 s: el reintento con la misma clave es seguro, pero conviene revisar el timeout antes de activar.
- **Base**: ~1–2 KB por foto (asset + item + sesión + auditoría). Despreciable frente al límite de 500 MB.
- **Huérfanos**: si una carga se corta entre la escritura y el registro, el objeto queda sin asset hasta el barrido
  (`tournament_media_known_object_names` / `cleanup_tournament_media_upload_sessions`); el reintento con la misma
  clave nunca crea una segunda foto.

## Activación y rollback

Ver [ACTIVATION.md](ACTIVATION.md). Evidencia de laboratorio: [REPORT.md](REPORT.md).
