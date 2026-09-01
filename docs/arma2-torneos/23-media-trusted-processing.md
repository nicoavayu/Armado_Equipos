# Multimedia · procesamiento confiable y contrato fail-closed

Este documento **reemplaza** las secciones de arquitectura, readiness y
saneamiento de [21-media-upload-pipeline.md](21-media-upload-pipeline.md).
Aquel describe la revisión anterior del pipeline; ésta es la vigente.

Estado: **`uploadReady` es false en todos los entornos**, incluido local,
mientras no exista un worker externo certificado. No hay ninguna vía para
abrirlo con una atestación estructural.

## Qué estaba mal

Tres agujeros, confirmados contra el harness embebido antes de tocar una línea:

1. **`uploadReady` podía ser true sin decode ni antivirus.**
   La readiness exigía `structuralDecode` —un recorrido de contenedores— y no
   exigía `pixelTranscode` ni `antivirusScanning`. Peor: `antivirusScanning`
   era la constante `false` dentro de la propia proyección. Con el bucket
   privado y las dos atestaciones puestas, la salida era
   `uploadReady:true, pixelTranscode:false, antivirusScanning:false, blockers:[]`.

2. **La atestación aceptaba cualquier cosa.**
   `attest_tournament_media_service` sólo pedía que `capabilities` fuera un
   objeto jsonb de menos de 4 KB. Una única llamada manual con
   `{"pixelTranscode": true, "totallyMadeUpCapability": "sí"}` se persistía tal
   cual y la proyección la reflejaba.

3. **Las sesiones ignoraban su propia readiness.**
   `request_tournament_media_upload_session` calculaba `v_upload_ready` y
   después no lo usaba. Con `uploadReady:false` insertaba la fila, reservaba
   cuota, derivaba el path, emitía un token de 64 hex y escribía la auditoría
   `media.upload_session.issued`, devolviendo `uploadReady:false` en el mismo
   objeto.

Y una consecuencia de diseño: el objeto publicado como `original` era una copia
byte a byte de lo subido, y las tres renditions publicadas eran las que había
producido el navegador. Un cliente modificado podía subir cualquier cosa
estructuralmente válida por la signed upload URL.

## Arquitectura vigente

```text
navegador            signer            orquestador          worker            base
                     (Edge)              (Edge)          (contenedor)
 1 preflight canvas
   (preview + tamaño)
 2 request_..._session ─────────────────────────────────────────────────────▶ intent
     ↑ rechaza con TORNEOS_MEDIA_PIPELINE_NOT_READY si uploadReady = false
 3 upload-intent ──▶ authorize_upload_target ───────────────────────────────▶ path
 4 PUT bytes ─────▶ (signed upload URL) ──▶ objeto en CUARENTENA
 5 queue ────────────────────────────▶ enqueue_..._processing_job ─────────▶ job
 6                                                    lease_..._jobs ◀──────
 7                                          descarga la cuarentena
                                            decode real (libvips)
                                            orientación a los píxeles
                                            metadata eliminada
                                            RE-ENCODE del original
                                            variantes desde esos píxeles
                                            checksums de los objetos finales
                                            ClamAV sobre cada objeto final
                                            escribe los 4 objetos
                                            complete_..._for_job ──────────▶ asset
                                            finalize_..._variants ─────────▶ ready
                                            complete_..._job ──────────────▶ done
                                            purga la cuarentena
 8 read-urls ─────▶ authorize_read ─────────────────────────────────────────▶ path
```

Tres componentes, tres confianzas distintas:

| componente | corre en | puede atestiguar | puede publicar |
| --- | --- | --- | --- |
| signer | Edge | `signer` (firma uploads y lecturas) | no |
| orquestador | Edge | **nada** | no |
| worker | contenedor propio | `processor` (los nueve tiers) | sí |

El orquestador es la Edge Function `tournament-media-processor`. Conserva el
nombre para no romper el despliegue existente, pero ya no procesa: encola. Su
health probe **revoca** cualquier atestación de `processor` que encuentre.

### El navegador ya no produce contenido publicable

`mediaImageClient` sigue existiendo y sigue re-encodeando en canvas, pero eso es
ahora exclusivamente **preflight**: una vista previa para la cola y una medición
del tamaño que se va a reservar. Las tres renditions que produce no se envían a
ningún lado. Todo lo publicable sale del worker.

Un cliente modificado que se saltee `mediaImageClient` y suba bytes propios por
la signed upload URL no gana nada: el worker descarga esos bytes, los decodifica
con libvips y publica su propia salida. La prueba está en
`workers/tournament-media-processor/test/pipeline.test.mjs`
(«un cliente que se saltea mediaImageClient igual queda saneado»).

### Cuarentena y objetos finales

* El objeto que sube el navegador vive en
  `organization_id/tournament_id/gallery_id/uuid.ext` — la **zona de
  cuarentena**.
* Los objetos publicables son `…-original.ext`, `…-thumbnail.ext`,
  `…-grid.ext`, `…-detail.ext`.
* `tournament_media_variants_path_check` exige el sufijo `-<kind>`, así que una
  fila de variante **no puede** apuntar al objeto en cuarentena. Es una
  restricción de esquema, no una convención.
* `authorize_tournament_media_read` sólo devuelve nombres de variantes en
  estado `ready`. Un participante no tiene forma de nombrar la cuarentena.
* El `-original` **no es** una copia de lo subido: es la salida re-encodeada y
  saneada del worker.
* Terminado el trabajo, el worker purga la cuarentena; si falla, la sesión vence
  y `cleanup_tournament_media_upload_sessions` /
  `cleanup_tournament_media_processing_jobs` entregan el nombre al barrido.

## Las diez compuertas de `uploadReady`

`tournament_media_pipeline_readiness()` devuelve cada una por separado:

| clave | qué exige |
| --- | --- |
| `storageReady` | bucket presente, privado, sin URL pública, con las 4 policies de servicio y **sin** ninguna policy de escritura para roles cliente |
| `signerReady` | atestación viva del signer con `signedUploadUrls`, `signedReadUrls`, `derivesPathServerSide` |
| `processorReady` | atestación viva del worker con `contentSniffing`, `checksumVerification`, `variantGeneration`, `storageReadWrite` y un `workerType` de la allowlist |
| `pixelDecodeReady` | `pixelDecode` |
| `pixelTranscodeReady` | `pixelTranscode` |
| `metadataSanitizationReady` | `metadataStrippingApplied` |
| `antivirusReady` | `antivirusScanning` |
| `cleanupReady` | `cleanup` **y** que existan las dos funciones de barrido en esta base |
| `uploadReady` | la conjunción de las ocho anteriores |
| `blockers` | los nombres exactos de lo que falta |

Bloqueos posibles:

```
storage.bucket_absent            storage.bucket_public
storage.service_policies_absent  storage.client_write_open
service.signer_unattested        service.processor_unattested
processor.pixel_decode_absent    processor.pixel_transcode_absent
processor.metadata_sanitization_absent
processor.antivirus_absent       cleanup.unavailable
```

`certified` en `get_tournament_media_admin_context` es exactamente
`uploadReady`, así que no puede ser true con una compuerta abajo.

## Atestaciones: allowlist, schema y evidencia

`attest_tournament_media_service` valida server-side antes de escribir. El
envelope es exactamente dos claves:

```jsonc
{
  "capabilities": {                    // sólo nombres de la allowlist, sólo booleanos
    "pixelDecode": true, "pixelTranscode": true, …
  },
  "evidence": {
    "selfTest":   { "passed": true, "checks": { "pixelDecode": true, … } },
    "backendFingerprint": "<64 hex>",  // debe igualar el de ESTE backend
    "probedAt":   "<timestamptz>",     // ventana de 10 minutos
    "workerType": "external_image_worker",
    "codec":      { "name": "libvips", "version": "8.15.3" },
    "antivirus":  { "name": "clamav", "version": "1.3.1", "signaturesAt": "<≤7 días>" }
  }
}
```

Reglas, todas verificadas por `tournament_media_attestation_rejection`:

* Una clave de nivel superior que no sea `capabilities` o `evidence` → rechazo.
* Un nombre de capacidad fuera de la allowlist → rechazo. **`structuralDecode`
  ya no es un nombre válido**, así que no puede sustituir a `pixelDecode`.
* Un valor de capacidad que no sea booleano → rechazo.
* **Toda capacidad declarada `true` debe tener un check homónimo `true` en el
  self-test, y el self-test entero debe haber pasado.** Una llamada manual con
  `pixelTranscode: true` no alcanza.
* El fingerprint debe ser el de esta base. Una atestación de otro proyecto no se
  replica acá.
* `probedAt` fuera de la ventana → rechazo.
* `pixelDecode` o `pixelTranscode` sin codec nombrado y versionado → rechazo.
* `antivirusScanning` sin scanner nombrado, versionado y con firmas de menos de
  7 días → rechazo.
* `workerType` fuera de la allowlist → rechazo. El Edge runtime **no está** en
  la allowlist, porque no puede hostear libvips ni ClamAV.
* TTL máximo: 3600 s para el signer, **900 s para el processor**.

El fingerprint es un SHA-256 de identificadores del catálogo local. No publica
nombres, credenciales ni el project ref.

### Quién renueva cada atestación

Las dos expiran solas, pero no se renuevan igual:

| Atestación | TTL | Quién la renueva | Cadencia |
| --- | ---: | --- | --- |
| `processor` | 900 s | el propio loop del worker (`workers/tournament-media-processor/src/index.mjs`) | a un tercio del TTL |
| `signer` | 3600 s | **un scheduler externo** (`workers/tournament-media-signer-renewer`) | cada 1200 s con jitter ±10 % |

El signer no puede renovarse solo: es una Edge Function y sólo atestigua
mientras responde su propio `health`, que está autorizado por
`TOURNAMENT_MEDIA_ATTESTATION_SECRET`. Sin scheduler, alguien tenía que
ejecutar el probe a mano cada hora o `uploadReady` se cerraba solo.

El renovador **no tiene credencial de servicio**: lleva el secreto de
atestación y una credencial pública del gateway, y no hay en él ningún camino
que extienda, falsifique o preserve una atestación. Si muere, la atestación
vence y las cargas se cierran; eso es el comportamiento correcto. Detalle,
alternativas descartadas y responsables en
[docs/operations/tournament-media-signer-attestation-renewal.md](../operations/tournament-media-signer-attestation-renewal.md).

## Fail-closed en cada escritura

`tournament_media_require_pipeline_ready()` levanta un único error estable,
`TORNEOS_MEDIA_PIPELINE_NOT_READY` (errcode `55000`), sin nombrar bucket,
servicio, capacidad ni entorno. Se ejecuta **antes de cualquier escritura** en:

* `request_tournament_media_upload_session` — primera línea del cuerpo, después
  del chequeo de sesión. Cero filas, cero cuota, cero token, cero path, cero
  auditoría.
* `authorize_tournament_media_upload_target` — corta firmas nuevas.
* `enqueue_tournament_media_processing_job` — delega en la anterior.
* `complete_tournament_media_upload_for_actor` / `..._for_job`.
* `complete_tournament_media_processing_job`.
* `finalize_tournament_media_variants`.

Las **lecturas no** están gated: si el worker deja de atestiguar, lo publicado
sigue visible; lo que se cierra es la entrada.

Si la readiness cae después de emitir una sesión: el signer rechaza, el worker
no puede completar, la sesión vence en ≤10 minutos y el barrido entrega su
objeto. Nunca se publica el asset.

## Evidencia por objeto en `finalize_tournament_media_variants`

Cada variante ahora debe declarar, además de la geometría y el checksum:

```json
{ "metadataStripped": true, "pixelTranscoded": true, "antivirusClean": true }
```

Un payload sin las dos últimas es, por construcción, una rendition de navegador
—y las renditions de navegador dejaron de ser publicables—.

## La cola de trabajos

`tournament_media_processing_jobs`, RLS activo, sin un solo grant para cliente.

| RPC | quién | qué hace |
| --- | --- | --- |
| `enqueue_tournament_media_processing_job` | orquestador | idempotente por sesión; delega la autorización completa |
| `lease_tournament_media_processing_jobs` | worker | `FOR UPDATE SKIP LOCKED`, incrementa intentos, mintea lease token |
| `complete_tournament_media_upload_for_job` | worker | ver abajo |
| `complete_tournament_media_processing_job` | worker | exige las 4 variantes `ready` antes de cerrar |
| `fail_tournament_media_processing_job` | worker | reencola hasta `max_attempts`, después abandona y cierra la sesión |
| `cleanup_tournament_media_processing_jobs` | worker | reencola leases vencidos, entrega objetos purgables |

### Por qué el worker no recibe el token de sesión

`complete_tournament_media_upload` verifica el hash del token de la sesión. Dar
ese token al worker significaría guardarlo en claro en la cola. En vez de eso,
`complete_tournament_media_upload_for_job` valida el **lease**, mintea un token
nuevo dentro de la misma transacción, re-keyea la sesión y llama a la función
auditada con él. Dos consecuencias, las dos buscadas:

* la validación auditada corre íntegra, sobre un token que verifica normalmente;
* **el token del navegador deja de funcionar** apenas el worker toma el trabajo,
  así que una carga en proceso no se puede re-firmar ni reproducir.

## El worker

`workers/tournament-media-processor/`. No se despliega desde este repositorio.

```
src/contract.mjs    cuarta copia de la geometría, pinneada por test
src/codec.mjs       libvips: decode, orientación, strip, re-encode, variantes
src/antivirus.mjs   clamd por INSTREAM. Sin fallback, sin heurística
src/pipeline.mjs    un job de punta a punta, con rollback
src/selfTest.mjs    prueba cada capacidad antes de declararla
src/supabase.mjs    bucket privado + RPCs de servicio
src/index.mjs       loop: atestiguar → barrer → tomar → procesar
Dockerfile          node 22 + sharp pinneado + clamav con freshclam
docker-compose.yml  clamd + worker, con techos de memoria/CPU/PIDs
```

Límites: `limitInputPixels` (bomba de descompresión), `failOn: 'warning'`
(archivo estructuralmente válido pero semánticamente roto), `.timeout()`,
`MEDIA_MAX_EDGE`, `mem_limit`, `pids_limit`, `read_only`, `cap_drop: ALL`.

El self-test es la **única** vía a `uploadReady: true`. Exige, con bytes reales:
decode correcto, rechazo de un JPEG truncado, rechazo de una bomba, transcode
que cambia los bytes, strip que deja cero portadores sobre una muestra que
realmente venía sucia, geometría exacta de las tres variantes, checksum estable,
**EICAR detectado** (un scanner que dice OK a todo falla el check), y
lectura/escritura/borrado reales contra el bucket.

### Estado local de certificación

| capacidad | en este repo hoy |
| --- | --- |
| codec real | ✅ libvips 8.18.3 vía `sharp@0.35.3`, con 12 pruebas sobre píxeles reales |
| antivirus real | ❌ no hay ClamAV ni Docker en el entorno de desarrollo usado |
| Storage real | ❌ requiere `supabase start` local |

Por lo tanto el self-test **no pasa** acá, el worker **no atestigua**, y
`uploadReady` queda en false. Es el resultado correcto, no una limitación.

`npm run test:worker:media:selftest` imprime el veredicto real de la máquina
donde corre.

## Servicio externo pendiente

Para abrir la carga hace falta, fuera de este repositorio:

1. Un runtime de contenedores donde correr `docker compose up` (o el equivalente
   gestionado) con red hacia el proyecto Supabase de destino.
2. ClamAV con `freshclam` al día. Sin firmas de menos de 7 días la atestación se
   rechaza.
3. El bucket privado `tournament-media` con las cuatro policies de servicio y
   ninguna de escritura para `anon`/`authenticated`
   (`npm run storage:tournament-media:local` lo hace en local).
4. `SUPABASE_URL` + credencial de servicio en el entorno del worker. El alcance
   real de esa credencial y la alternativa de menor privilegio están revisados
   en [docs/operations/tournament-media-service-role-review.md](../operations/tournament-media-service-role-review.md).
5. Deploy de las dos Edge Functions y `TOURNAMENT_MEDIA_ATTESTATION_SECRET`.
6. El renovador de la atestación del signer corriendo junto al worker, con el
   mismo secret store y sin credencial de servicio.
7. Las señales de observabilidad desplegadas y validadas contra Staging. Hasta
   entonces `REACT_APP_TORNEOS_MEDIA_OBSERVABILITY_READY` queda en false y
   Multimedia no puede habilitarse.

Nada de eso ocurre desde CI ni desde este PR.

## Cómo correr las pruebas

```bash
npm run test:db:torneos:media-upload        # pipeline completo
npm run test:db:torneos:media-failclosed    # el contrato fail-closed
npm run test:worker:media                   # codec real + clamd + rollback
npm run test:worker:media:selftest          # veredicto de esta máquina
npm run test:worker:signer-renewer          # renovación, jitter, backoff, redacción
npm run test:torneos:observability          # catálogo, umbrales y compuerta
npm run test:edge-functions
npm run test:storage:local
```
