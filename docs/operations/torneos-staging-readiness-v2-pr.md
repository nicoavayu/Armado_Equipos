# Arma2 Torneos: certificar preparación operativa de Staging

## Estado

**Sistema de preparación completamente certificado en entorno local efímero; Staging todavía no inspeccionada ni modificada.**

Este PR draft reemplaza como candidato recomendado al PR #103, que permanece abierto, draft y sin reescritura para comparación. La rama se reconstruyó desde la epic exacta `e9a43a7bde37039f60e6b7b8e44bb84f8a118b42`; no contiene los commits históricos, el merge puente ni los scripts sintéticos ajenos de #103.

No se contactó Staging ni Production. No se aplicaron migraciones remotas, no se crearon buckets remotos, no se desplegaron Edge Functions/workers y no se habilitaron flags.

## Tamaño real

- Commits propios antes de esta certificación: **9**.
- Archivos antes de esta certificación: **34**.
- Esta certificación agrega un commit focal con la actualización documental y la corrección/regresión del catálogo QA V2→V3 que reveló la base completa actual.
- Base: `epic/arma2-torneos` en `e9a43a7bde37039f60e6b7b8e44bb84f8a118b42`.

## Qué se eliminó del alcance histórico

No se copiaron `scripts/backfill-match-location-coordinates.mjs`, `scripts/db-integration/torneos-match-operations.mjs`, staging evidence, seeds/escenarios sintéticos, el manifiesto viejo de nueve migraciones, los validadores/inspector remoto viejos, el test legacy de secretos ni `docs/arma2-torneos/21-staging-readiness.md`. `check_db.js` sigue eliminado como en la epic. La auditoría completa de los 9 commits y 44 archivos de #103 está en `docs/operations/torneos-staging-readiness-audit.md`.

## Diff v2, archivo por archivo

| Archivo | Motivo de permanencia |
|---|---|
| `config/torneos-staging.env.example` | Plantilla fail-closed para target, credenciales por nombre y flags apagadas. |
| `docs/operations/torneos-staging-readiness-audit.md` | Historia real, tres diffs y clasificación individual de los 44 archivos de #103. |
| `docs/operations/torneos-staging-readiness-runbook.md` | Secuencia operativa por etapas, pausas, approvals y recovery. |
| `docs/operations/torneos-staging-readiness-v2-pr.md` | Descripción verificable de este PR limpio. |
| `docs/operations/tournament-media-worker-runbook.md` | Provisión, salud, incidentes y apagado del worker confiable. |
| `ops/torneos-staging/fixtures/local-ready.json` | Snapshot local determinista; `remoteCalls=0`. |
| `ops/torneos-staging/manifest.json` | Allowlist versionada de migraciones, Storage, Edge, worker, flags y etapas. |
| `ops/torneos-staging/manifest.schema.json` | Validación estructural del manifiesto. |
| `ops/torneos-staging/qa-matrix.json` | Matriz QA Multimedia/Social sin identidades privadas. |
| `package.json` | Sólo comandos readiness, Storage y rollback demostrables; sin escenario sintético viejo. |
| `scripts/staging/guard.mjs` | Rechazo exacto de Production, refs/hosts/credenciales inconsistentes y flags prematuras. |
| `scripts/staging/guard.test.mjs` | Casos positivos/negativos del guard. |
| `scripts/staging/run.mjs` | Entrada compatible limitada a inspect/plan/dry-run/rollback simulado. |
| `scripts/storage/provision-tournament-media-local.mjs` | Lifecycle loopback-only de seis modos, policies exactas e idempotencia. |
| `scripts/storage/tournament-media-procedure.test.mjs` | Contratos y negativos de bucket/policies/API Storage actual. |
| `scripts/torneos-staging/readiness-lib.mjs` | Checksums, snapshot, plan, approvals, recibos y sanitización. |
| `scripts/torneos-staging/readiness.mjs` | CLI no mutante y bloqueo de etapas remotas sin autorización/estado real. |
| `scripts/torneos-staging/readiness.test.mjs` | Drift, Production, historial, Storage, Edge, worker, flags y rollback simulado. |
| `scripts/torneos-staging/rollback-contract.test.mjs` | Nombres exactos, transacción, preservación, drenaje y revocación de grants. |
| `scripts/torneos-staging/static-guard.mjs` | Escaneo de secretos y project refs desconocidos en archivos trackeados. |
| `scripts/torneos-staging/static-guard.test.mjs` | Prueba tanto ausencia real como detección de fixtures peligrosos. |
| `scripts/torneos-staging/verify-rollbacks-local.mjs` | Ejecución loopback-only de tres rollbacks y postcondiciones live. |
| `src/__tests__/torneosFeatureFlags.test.js` | Fail-closed de gates Multimedia/Social y Production. |
| `src/features/torneos/config/featureFlags.js` | Requisitos de readiness y orden de habilitación; defaults OFF. |
| `supabase/rollbacks/20260802090000_tournament_media_upload_pipeline.safe.sql` | Drena sesiones, revoca mutaciones/reatestación y preserva datos. |
| `supabase/rollbacks/20260802120000_tournament_media_trusted_processing.safe.sql` | Serializa writers, drena jobs/sesiones, revoca leases/finalización y preserva datos. |
| `supabase/rollbacks/20260803090000_tournament_social_studio.safe.sql` | Cierra las tres APIs cliente y preserva permisos/auditoría. |
| `supabase/rollbacks/README.md` | Alcance exacto y límites de cada rollback seguro. |
| `workers/tournament-media-processor/Dockerfile` | Runtime Node 22, sharp/libvips y ClamAV reproducibles. |
| `workers/tournament-media-processor/docker-compose.yml` | Recursos, health, clamd y red del worker. |
| `workers/tournament-media-processor/package-lock.json` | Árbol npm reproducible del worker. |
| `workers/tournament-media-processor/package.json` | Engines y dependencias fijadas. |
| `workers/tournament-media-processor/src/healthcheck-cli.mjs` | Health estricto; no declara capacidades no probadas. |
| `workers/tournament-media-processor/src/index.mjs` | Backoff, señales, cleanup y shutdown seguro. |
| `scripts/qa/replace-torneos-demo-v2-with-v3-direct.mjs` | Actualiza el catálogo fail-closed de FKs externas para incluir el FK de Social presente en el schema completo actual. |
| `scripts/qa/replace-torneos-demo-v2-with-v3-direct.local.test.mjs` | Regresión live local que exige las 62 FKs y la presencia explícita del FK de permisos sociales. |

## Certificación local ejecutada

- Docker Desktop `/Applications/Docker.app`, CLI `29.6.2`, contexto `desktop-linux`, Apple Silicon. El stack exclusivo `arma2-pr124-cert-20260802` usó la red `arma2_pr124_cert_20260802_net`, puertos loopback `60320–60327` y volúmenes propios; ningún recurso preexistente fue detenido.
- Supabase CLI `2.110.0` y Postgres `17.6.1.143`: dos resets desde cero, seis migraciones en orden exacto, checksums estables e idempotencia. Storage quedó privado, 12 MiB, JPEG/PNG/WebP, cuatro policies exclusivas de `service_role` y cero escritura de `PUBLIC`, `anon` o `authenticated`.
- Identity map: las seis identidades canónicas eran correctas; sólo las relaciones proyectadas V2 estaban desactualizadas. Una copia temporal `0600`, ignorada por Git, preservó UUID/email/rol/alias y reconstruyó únicamente relaciones actuales. Fingerprints: legacy V2 `77d95cb8caee567de1e8275b81c1e8c850eb59dcf6025504cab93c634ff3657c`; actual `d13bf642667c8a02c79a6f7b6db3325be3a2196c1569cfb655d67a72a3ab4cdd`.
- QA: umbrella `71/75` con cuatro skips local-only por diseño; las cuatro familias omitidas se ejecutaron en resets independientes: lifecycle V4/transición V3→V4 `9/9`, cleanup legacy V2 `13/13` y reemplazo V2→V3 `33/33`. El reemplazo reveló un catálogo heredado de 61 FKs; se actualizó de forma focal a las 62 del schema actual y se agregó regresión explícita para Social.
- ClamAV: imagen fijada `clamav/clamav:1.4.5-debian`, multiarch arm64, digest `sha256:50296b62b23764b474be18310521f64a720524d69334ea5236aab5fac44ff993`. `freshclam` y reload reales dejaron firmas `28080`, fecha `2026-08-02 06:24:19 UTC`, menores de siete días. Health `PONG`, limpio negativo y EICAR positivo. Caída de `clamd`, firmas vencidas simuladas y recuperación fueron fail-closed.
- Worker: imagen local Node `22.14.0`, sharp `0.33.5`, libvips `8.15.3`. Self-test dentro de la red real: `passed=true`; decode/transcode, stripping de metadata, checksums, variantes, ClamAV, Storage y cleanup en true. Atestación processor TTL `900s`; signer TTL `3600s`; `uploadReady` cambió `false→true` y volvió a false al revocar/rollback.
- E2E: signer/orquestador/worker locales procesaron una imagen real con orientación EXIF, GPS, ICC y metadata adicional. Se verificaron cuarentena, orientación aplicada, metadata eliminada, re-encode, antivirus, original saneado, thumbnail/grid/detail, cuatro checksums/variantes ready y purga de cuarentena. Tras publicación, las cuatro lecturas del owner fueron firmadas; el participante obtuvo `grid`, no `original`, cuarentena ni path interno.
- Negativos: EICAR, JPEG corrupto, magic bytes falsos, bomba de descompresión, metadata, SVG, APNG, WebP animado, Storage/cleanup ausente, `clamd` caído, firmas vencidas, atestaciones vencidas, policy cliente, bucket público, ref Production, credencial cruzada y flags prematuras. Los gates cerraron sin sesión/publicación parcial y con cuotas/auditoría consistentes.
- Rollbacks live: los tres scripts versionados se ejecutaron dos veces. Drenaron sesiones/jobs, revocaron atestaciones y grants mutantes, preservaron seis tablas y sus conteos, no ejecutaron `DROP`/`TRUNCATE`, mantuvieron cleanup aprobado y dejaron `uploadReady=false`.
- Suites: Storage contractual `8/8` y live `6/6`; readiness/rollback/static `42/42`; Edge `41/41`; worker `44/44`; media upload `112/112`; media fail-closed `141/141`; Social `39/39`; security patch `104/104`; Security Advisor `8/8`; grants `767/767`; Jest `254/254` suites y `1955/1955` tests; lint, migrations guard, Node checks, diff-check, secretos/project refs, flags OFF y build web optimizado: OK.
- Deno `2.1.4` verificó resolución de las 11 Edge Functions. El type-check global reporta 28 errores heredados en fuentes idénticas a la epic (principalmente genéricos de Supabase y nullability en Push); este PR no modifica Edge Functions. El runtime local Edge `1.74.2`/Deno `2.1.4`, su serve real y las suites operativas sí pasaron.

## Límites reales restantes

- Staging y Production no fueron inspeccionadas ni modificadas. No hubo migraciones, buckets, deploys, flags, seeds, replacements ni cleanup remotos.
- La certificación prueba el sistema en un stack local efímero; no sustituye una autorización futura y separada para inspeccionar Staging.
- El PR permanece abierto y draft. No se mergeó ni se marcó ready; el PR #103 sigue abierto e intacto.

## Resultado recomendado

Mantener este PR draft para auditoría final de merge. La preparación local está certificada; cualquier contacto posterior con Staging requiere autorización explícita separada.
