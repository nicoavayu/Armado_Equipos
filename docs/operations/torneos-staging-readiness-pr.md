# Arma2 Torneos: preparar despliegue seguro de Multimedia y Estudio Social en Staging

## Alcance

Este PR prepara, documenta y certifica localmente el sistema operativo para una futura inspección y habilitación controlada de Multimedia Upload y Estudio Social. No inspecciona ni modifica Staging o Production y no despliega infraestructura.

> Sistema de preparación certificado localmente; Staging todavía no inspeccionada ni modificada.

## Amenazas y modelo fail-closed

- Rechaza Production, project refs desconocidos, URLs incoherentes, credenciales de otro proyecto y service-role en variables del navegador.
- Aborta ante drift, checksum u orden de migración incompatibles, bucket público, policies inesperadas o de escritura cliente, funciones Edge inesperadas, secretos faltantes, worker incompleto y flags fuera de orden.
- Toda etapa mutante futura exige SHA y estado inspeccionado exactos, plan previo, confirmación humana, token de etapa y recibo de la etapa anterior.
- No existe un comando que ejecute todas las mutaciones sin pausas.
- Las salidas se sanitizan y rechazan tokens, claves, URLs firmadas e identity maps.

## Arquitectura y manifiesto

`ops/torneos-staging/manifest.json` versiona las 15 etapas independientes: `inspect`, `plan`, `dry-run`, `migrate`, `storage`, `secrets-check`, `edge-deploy`, `worker-check`, `attest`, `enable-multimedia`, `qa-multimedia`, `enable-social`, `qa-social`, `rollback` y `cleanup-local`.

El contrato declara el SHA de la epic, el único project ref futuro autorizado, los refs prohibidos, aprobaciones, observabilidad, rollback, QA, funciones Edge, worker, secretos sólo por nombre y flags. No supone que las tres migraciones objetivo sean las únicas pendientes del historial remoto.

## Migraciones y rollback

Orden y checksums versionados:

1. `20260802090000_tournament_media_upload_pipeline.sql`
2. `20260802120000_tournament_media_trusted_processing.sql`
3. `20260803090000_tournament_social_studio.sql`

Cada migración tiene rollback SQL seguro y revisable en `supabase/rollbacks/`. El rollback automático apaga flags, revoca atestaciones, bloquea nuevas escrituras, permite drenar trabajo, retira grants y preserva datos. No contiene `DROP`, `TRUNCATE` ni borrado directo de datos de usuario; cualquier eliminación definitiva queda fuera del flujo automático y requiere una segunda autorización.

## Storage

El procedimiento local soporta `inspect`, `plan`, `dry-run`, `apply`, `verify` y `rollback`. Exige el bucket privado `tournament-media`, límite de 12 MiB, JPEG/PNG/WebP, sin SVG, sin URL pública ni escritura directa de `anon`, `authenticated` o `PUBLIC`, y las cuatro policies de servicio exactas. `apply` es idempotente y aborta ante configuración o policies inesperadas; `rollback` sólo puede retirar un bucket local probado vacío y requiere segunda confirmación.

## Edge Functions

El plan limita el despliegue futuro a `tournament-media-signer` y luego `tournament-media-processor`, una función por vez, con checksum, health, versión, recibo y pausa entre ambas. El processor Edge es sólo el orquestador de cola. Los secretos se declaran únicamente por nombre y no se generan ni se leen en este PR.

## Worker

El contrato reproducible de `workers/tournament-media-processor` fija Node 22, sharp 0.33.5, libvips, clamd/freshclam, firmas menores de siete días, límites de CPU/memoria/píxeles, timeout, leases, retries con backoff y jitter, idempotencia, cleanup, logs estructurados, health, self-test, renovación/revocación de atestaciones y shutdown seguro. Se incluye runbook de provisión, incidentes y apagado; el worker no fue desplegado.

## Readiness y flags

El orden codificado mantiene ambos flags apagados hasta verificar migraciones, Storage, Edge, worker y atestaciones. Multimedia exige `uploadReady=true` y una prueba de revocación; Social sólo puede habilitarse después del QA de Multimedia. Production fuerza ambas funciones a `false`.

## QA

La matriz versionada cubre los roles, tenants y escenarios solicitados para Multimedia y las once piezas/dos formatos del Estudio Social. En este PR sólo se validaron contratos y fixtures locales; no se ejecutó QA contra Staging.

## Pruebas locales

- `npm ci` completado.
- Nuevo manifiesto, preflight, dry-run, guards, rollback, Storage y sanitización: 48/48.
- Contrato principal del manifiesto/readiness: 23/23.
- Edge Functions: 41/41.
- Worker: 44/44.
- PostgreSQL Multimedia Upload: 112/112.
- PostgreSQL fail-closed: 141/141.
- PostgreSQL Estudio Social: 39/39.
- Security patch embebido: 104/104; parser del Security Advisor: 8/8.
- Jest completo: 255 suites, 1.957 tests, todos aprobados.
- Lint, migrations guard, sintaxis de archivos modificados, escaneo de secretos/project refs y `git diff --check`: aprobados.
- Build web optimizado con ambos flags apagados: aprobado con endpoint loopback y clave pública ficticia.
- `inspect`, `plan`, `dry-run` y rollback simulado: locales, determinísticos y con cero llamadas remotas.

## Limitaciones

- Docker y Podman no están instalados en el host. Por eso 6 pruebas live de Storage contra Supabase local efímero fueron omitidas, y `authenticated-rpc-grants.mjs` no pudo ejecutarse; las 6 pruebas de contrato Storage sí pasaron. No se sustituyó esta ausencia por acceso remoto.
- La suite QA heredada depende del archivo local ignorado `torneos-demo-v2-identity-map.local`; 65 guards pasaron, 5 se omitieron y 5 no pudieron correr por esa ausencia. El identity map no se fabricó ni expuso.
- `scripts/cleanup.js` contiene un error de sintaxis heredado que ya está presente idéntico en el SHA base de la epic. Todos los archivos JavaScript/MJS modificados por este PR pasan `node --check`.
- `npm ci` informa vulnerabilidades existentes del árbol de dependencias; no se aplicó un `audit fix` automático fuera de alcance.

## Confirmación de no despliegue

- Staging no fue contactada, inspeccionada ni modificada.
- Production no fue contactada ni modificada.
- Cero migraciones remotas, buckets remotos, deploys Edge/worker, secretos reales, seeds/cleanup remotos, flags habilitados o builds móviles.
- `main`, `epic/arma2-torneos` y el checkout original se mantienen intactos.
