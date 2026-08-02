# Arma2 Torneos: certificar preparación operativa de Staging

## Estado

**Contratos certificados; certificación live local pendiente.**

Este PR draft reemplaza como candidato recomendado al PR #103, que permanece abierto, draft y sin reescritura para comparación. La rama se reconstruyó desde la epic exacta `e9a43a7bde37039f60e6b7b8e44bb84f8a118b42`; no contiene los commits históricos, el merge puente ni los scripts sintéticos ajenos de #103.

No se contactó Staging ni Production. No se aplicaron migraciones remotas, no se crearon buckets remotos, no se desplegaron Edge Functions/workers y no se habilitaron flags.

## Tamaño real

- Commits propios: **9**.
- Archivos: **34**.
- Inserciones: **3.321**.
- Eliminaciones: **296**.
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

## Certificación local ejecutada

- Docker Desktop encontrado en `/Applications/Docker.app`; CLI usada desde `/Applications/Docker.app/Contents/Resources/bin/docker` sin modificar el PATH global.
- Supabase efímero exclusivo: puertos `59320–59327`, project-id, red y volúmenes propios. No se detuvieron ni eliminaron recursos ajenos.
- Storage live: seis modos ejecutados; bucket privado, 12 MiB, JPEG/PNG/WebP, cuatro policies `service_role`, cero escritura directa cliente; segundo apply idempotente; policy inesperada y bucket público rechazados; cleanup local idempotente. Suite total `14/14`.
- DB: media upload `112/112`; media fail-closed `141/141`; Social `39/39`; security patch `104/104`; Security Advisor `8/8`.
- Authenticated RPC grants: `767` verificaciones, `0` fallos; catálogo `public=0`, `anon=18`, `authenticated=225`, `service_role=488`.
- Rollbacks live: `3/3`, seis tablas preservadas, APIs mutantes revocadas y `uploadReady=false`.
- Readiness/Storage/rollback/static: `59/59`; validación staging focal `42/42`; migrations guard OK; inspect, plan, dry-run y rollback simulado OK.
- Edge Functions: `41/41`; worker: `44/44`.
- QA normal sin material privado: `70/75`, con 5 suites live correctamente omitidas. QA local-only sobre el stack: `9/9`.
- Jest: `254/254` suites, `1955/1955` tests. Lint y build optimizado con todas las flags Torneos/Multimedia/Social OFF: OK.
- Node syntax: 17 archivos cambiados; TypeScript cambiado: 0; Deno no aplicable al diff y CLI no disponible en host/runtime local.
- `npm ci`, `git diff --check`, escaneo de secretos/project refs y Production fail-closed: OK.

## Pruebas omitidas o bloqueadas

1. El identity map local existente se copió temporalmente con modo `0600` y bajo `.gitignore`, sin publicar su contenido. Su guard falla porque la relación proyectada de `owner` no coincide con el contrato V3/V4 actual. No se modificó el mapa, descriptor ni fingerprint legacy. La copia se eliminó tras la prueba.
2. El self-test real del worker verifica codec/libvips, sniffing, decode/transcode, stripping, variantes y checksum, pero no atestigua antivirus ni Storage/cleanup porque el host no tiene `clamd` ni credenciales Storage del worker. La suite contractual sí pasa `44/44`.
3. No se ejecutaron pruebas remotas por prohibición expresa: Staging/Production, migraciones, buckets, Edge, worker y flags remotos permanecieron sin contacto.

Por estos dos bloqueos live locales no se afirma “certificado localmente”.

## Resultado recomendado

Mantener este PR draft y usarlo para comparar/reemplazar #103. No mergear ni marcar ready hasta resolver el identity map autorizado, provisionar el self-test completo del worker y obtener una autorización separada para cualquier inspección remota.
