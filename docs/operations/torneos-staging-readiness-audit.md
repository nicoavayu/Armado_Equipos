# Auditoría histórica y de alcance del PR #103

Fecha de auditoría: 2026-08-02. Esta auditoría consultó Git/GitHub y ejecutó únicamente validaciones locales. Staging y Production no fueron contactadas.

## Estado revalidado

- PR #103 abierto, draft, base `epic/arma2-torneos`, head inicial auditado `1bb355e2c6dbf1ed5da3dff1260af442c7d7c97d`, mergeable y `CLEAN`.
- Epic intacta: `e9a43a7bde37039f60e6b7b8e44bb84f8a118b42`.
- Main intacto: `9650f908f8427c0f51a5fee5defc42570ef9bcab`.
- Checkout protegido intacto: `release/1.1.13-build-32` en `0a25998f921eb553efe4874bbab0635faa5dd836`, incluidos sus cambios locales preexistentes.

## Historia real

GitHub registra la creación de la rama `feature/torneos-staging-readiness` el 2026-07-27 a las 16:01:26Z y la creación del PR #103 a las 16:01:43Z. Su base no cambió: `epic/arma2-torneos`.

Título original: `Arma2 Torneos: preparación y certificación de staging`.

Propósito original: certificar localmente la preparación general de Arma2 Torneos, inventariar nueve migraciones anteriores, ejecutar un escenario sintético de 15 identidades/14 evidencias y preparar un verificador remoto futuro. Declaraba expresamente que no incluía Estudio Social. Su base era `95b90243ad5cb430ae8fa2b25bc849a02242deed` y su primer head era `389952181734659ee8332fd8da14be29bd295096`.

El 2026-08-02 a las 21:53:18Z se reemplazaron título y descripción por el alcance Multimedia/Estudio Social. El historial editable de GitHub conserva ambas descripciones.

## Nueve commits del PR #103

| Orden | Commit | Fecha local | Parent(s) | Archivos/propósito | Clasificación |
|---:|---|---|---|---|---|
| 1 | `38995218` | 2026-07-27 13:01:14 -03 | `95b90243` | 14 archivos; readiness general, nueve migraciones, escenario sintético y flags | Trabajo anterior |
| 2 | `c30b63ac` | 2026-07-27 13:30:39 -03 | `38995218` | 3 archivos; retiró service-role del cliente en `check_db.js`/backfill y añadió un test | Trabajo anterior |
| 3 | `ca5185e9` | 2026-08-02 18:27:49 -03 | `c30b63ac`, `e9a43a7b` | Merge de la epic en la rama vieja; 16 archivos seguían distintos de la epic | Puente histórico, no focal |
| 4 | `b2162e67` | 2026-08-02 18:45:22 -03 | `ca5185e9` | 21 archivos; manifiesto, preflight, dry-run, guards y rollbacks iniciales | Trabajo nuevo |
| 5 | `6d169de0` | 2026-08-02 18:45:26 -03 | `b2162e67` | 3 archivos; lifecycle Storage y pruebas de contrato | Trabajo nuevo |
| 6 | `40e8eead` | 2026-08-02 18:45:39 -03 | `6d169de0` | 9 archivos; contrato reproducible y runbooks del worker | Trabajo nuevo |
| 7 | `b6bfe327` | 2026-08-02 18:46:24 -03 | `40e8eead` | 1 archivo; render del inspect local | Trabajo nuevo |
| 8 | `2ac1d111` | 2026-08-02 18:49:50 -03 | `b6bfe327` | 1 archivo; adaptó el test heredado que antes dependía de `check_db.js` | Mezcla con trabajo anterior |
| 9 | `1bb355e2` | 2026-08-02 18:52:51 -03 | `2ac1d111` | 1 archivo; descripción operacional del PR | Trabajo nuevo, evidencia imprecisa |

Los dos commits ausentes del informe anterior eran `38995218` y `c30b63ac`. El merge `ca5185e9` sí fue listado entre los siete, pero arrastró sus árboles históricos.

## Comparación de árboles

- Epic actual → head auditado: 44 archivos, 4.136 inserciones y 300 eliminaciones.
- Epic actual → primer commit nuevo/merge `ca5185e9`: 16 archivos, 1.401 inserciones y 5 eliminaciones. Éste es el contenido histórico que sobrevivió al sincronizar la rama vieja.
- Contenido histórico `c30b63ac` → `ca5185e9`: 498 archivos, 108.833 inserciones y 913 eliminaciones, porque el merge incorporó toda la evolución de la epic desde la base vieja.
- Base histórica `95b90243` → `c30b63ac`: 17 archivos, 1.413 inserciones y 12 eliminaciones.

GitHub reporta 44 archivos porque compara el árbol final con la epic, no sólo los commits focales nuevos. Dieciséis archivos ya diferían de la epic en `ca5185e9`; los otros 28 provienen del trabajo posterior. El informe de 35 archivos fue un conteo manual incorrecto y no corresponde a ningún diff canónico.

## Clasificación de los 44 archivos

Categorías: A = necesario nuevo; B = heredado pero válido/necesario; C = heredado ajeno o desactualizado; D = riesgoso/impreciso; E = necesidad no demostrable en su forma actual.

| Archivo | Introducción relevante | Cat. | Relación y evidencia | ¿Ya en epic? | Decisión |
|---|---|:---:|---|:---:|---|
| `config/torneos-staging.env.example` | `38995218`, ajustado `b2162e67` | B | Plantilla fail-closed y contrato Storage/flags | No | Sí, reconstruido en v2 |
| `docs/arma2-torneos/21-staging-readiness.md` | `38995218`, ajustado `6d169de0` | C | Runbook anterior de nueve migraciones; declara que Social no está incluido | No | No |
| `docs/operations/torneos-staging-readiness-audit.md` | `b2162e67` | D | Auditoría útil, pero concluía certificación antes de las pruebas live/históricas | No | Reemplazar en v2 |
| `docs/operations/torneos-staging-readiness-pr.md` | `1bb355e2` | D | Afirmaba Docker ausente y certificación live no completada | No | No; nueva descripción v2 |
| `docs/operations/torneos-staging-readiness-runbook.md` | `40e8eead` | D | Contenido operativo válido, encabezado de certificación prematuro | No | Corregir en v2 |
| `docs/operations/tournament-media-worker-runbook.md` | `40e8eead` | A | Provisión, salud, incidentes y apagado del worker | No | Sí en v2 |
| `ops/torneos-staging/fixtures/local-ready.json` | `b2162e67` | A | Fixture determinístico para inspect/plan/dry-run | No | Sí en v2 |
| `ops/torneos-staging/manifest.json` | `b2162e67` | A | Manifiesto de 15 etapas y tres migraciones objetivo | No | Sí en v2 |
| `ops/torneos-staging/manifest.schema.json` | `b2162e67` | A | Schema del manifiesto | No | Sí en v2 |
| `ops/torneos-staging/qa-matrix.json` | `b2162e67` | A | Matriz QA Multimedia/Social | No | Sí en v2 |
| `package.json` | `38995218`, `b2162e67` | E | Mezclaba comandos históricos de seed/evidence con la nueva CLI y reemplazaba tooling anterior | Sí | Reconstruir sólo scripts demostrables |
| `scripts/backfill-match-location-coordinates.mjs` | `c30b63ac` | C | Hardening válido de service-role, pero ajeno al readiness Multimedia/Social | Sí | No |
| `scripts/db-integration/torneos-match-operations.mjs` | `38995218` | C | Export añadido sólo para el escenario sintético anterior | Sí | No |
| `scripts/db-integration/torneos-staging-evidence.mjs` | `38995218` | C | Evidencias deportivas del alcance anterior | No | No |
| `scripts/staging/guard.mjs` | `b2162e67` sobre epic | A | Ref/host/credencial/Production/flags fail-closed | Sí | Sí en v2 |
| `scripts/staging/guard.test.mjs` | `b2162e67` sobre epic | A | Negativos del guard | Sí | Sí en v2 |
| `scripts/staging/run.mjs` | `b2162e67` sobre epic | A | Entrada compatible a inspect/plan/dry-run sin apply-all | Sí | Sí en v2 |
| `scripts/storage/provision-tournament-media-local.mjs` | `6d169de0` sobre epic | A | Lifecycle loopback-only del bucket | Sí | Sí, corregido en v2 |
| `scripts/storage/tournament-media-procedure.test.mjs` | `6d169de0` | A | Modos, idempotencia y negativos Storage | No | Sí, ampliado en v2 |
| `scripts/torneos-staging/manifest.mjs` | `38995218` | C | Inventario viejo de nueve migraciones, identidades y suites | No | No |
| `scripts/torneos-staging/readiness-lib.mjs` | `b2162e67`, `40e8eead` | A | Manifiesto, preflight, plan, approvals, sanitización | No | Sí en v2 |
| `scripts/torneos-staging/readiness.mjs` | `b2162e67`, `b6bfe327` | A | CLI local por etapas | No | Sí en v2 |
| `scripts/torneos-staging/readiness.test.mjs` | `b2162e67` | A | Contratos y casos negativos | No | Sí en v2 |
| `scripts/torneos-staging/run-synthetic-scenario.mjs` | `38995218` | C | Orquesta suites deportivas anteriores, no QA Multimedia/Social | No | No |
| `scripts/torneos-staging/seed-synthetic.mjs` | `38995218` | C | Alias del escenario anterior | No | No |
| `scripts/torneos-staging/static-guard.mjs` | `b2162e67` | A | Escaneo de secretos y project refs | No | Sí en v2 |
| `scripts/torneos-staging/static-guard.test.mjs` | `b2162e67` | A | Prueba del escáner estático | No | Sí en v2 |
| `scripts/torneos-staging/validate-env.mjs` | `38995218` | C | Depende del manifiesto viejo y sus toggles | No | No |
| `scripts/torneos-staging/validate-migrations.mjs` | `38995218` | C | Valida las nueve migraciones antiguas | No | No |
| `scripts/torneos-staging/validate-synthetic-manifest.mjs` | `38995218` | C | Valida identidades/evidencias del escenario anterior | No | No |
| `scripts/torneos-staging/verify-staging.mjs` | `38995218` | C | Inspector remoto viejo; sólo conoce nueve migraciones y no sirve para el manifiesto nuevo | No | No |
| `src/__tests__/torneosFeatureFlags.test.js` | `38995218`, `b2162e67` | B | Verifica gates Multimedia y Production | Sí | Sí, reconstruido en v2 |
| `src/__tests__/torneosStagingSecretGuard.test.js` | `c30b63ac`, `2ac1d111` | C | Nació para `check_db.js`/backfill; el static guard nuevo lo reemplaza | No | No |
| `src/features/torneos/config/featureFlags.js` | `38995218`, `b2162e67` | B | Gates operativos Multimedia y aislamiento exacto | Sí | Sí, reconstruido en v2 |
| `supabase/rollbacks/20260802090000_tournament_media_upload_pipeline.safe.sql` | `b2162e67` | D | Preserva datos, pero #103 dejaba emisión/re-atestación de service-role | No | Corregir y probar en v2 |
| `supabase/rollbacks/20260802120000_tournament_media_trusted_processing.safe.sql` | `b2162e67` | D | Preserva datos, pero #103 no cerraba sesiones/re-atestación ni serializaba writers | No | Corregir y probar en v2 |
| `supabase/rollbacks/20260803090000_tournament_social_studio.safe.sql` | `b2162e67` | A | Revoca las tres APIs cliente y preserva datos/auditoría | No | Sí, probar en v2 |
| `supabase/rollbacks/README.md` | `b2162e67` | D | Documentaba como seguros rollbacks aún no probados live | No | Corregir en v2 |
| `workers/tournament-media-processor/Dockerfile` | `40e8eead` sobre epic | A | Node 22, ClamAV y `npm ci` | Sí | Sí en v2 |
| `workers/tournament-media-processor/docker-compose.yml` | `40e8eead` sobre epic | A | Recursos, health y red clamd | Sí | Sí en v2 |
| `workers/tournament-media-processor/package-lock.json` | `40e8eead` | A | Reproducibilidad/supply-chain del worker | No | Sí en v2 |
| `workers/tournament-media-processor/package.json` | `40e8eead` sobre epic | A | Node 22 y sharp 0.33.5 | Sí | Sí en v2 |
| `workers/tournament-media-processor/src/healthcheck-cli.mjs` | `40e8eead` | A | Health estricto | No | Sí en v2 |
| `workers/tournament-media-processor/src/index.mjs` | `40e8eead` sobre epic | A | Backoff, señales y shutdown seguro | Sí | Sí en v2 |

Totales: A=22, B=3, C=12, D=6, E=1.

`check_db.js` no forma parte del diff final porque la epic lo había eliminado por contener material inseguro; el merge `ca5185e9` resolvió el conflicto conservando esa eliminación. No debe recrearse.

## Decisión

El PR #103 no es un diff limpio del alcance nuevo: contiene doce archivos heredados ajenos/desactualizados, seis artefactos riesgosos o imprecisos y un `package.json` mixto. No se reescribe ni se cierra. La entrega recomendada se reconstruye desde la epic exacta en `feature/torneos-staging-readiness-v2`, sin merge histórico ni force push, y queda disponible como PR draft separado para comparación.
