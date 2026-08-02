# Auditoría previa: Multimedia Upload y Estudio Social

Estado al iniciar: `epic/arma2-torneos` en `e9a43a7bde37039f60e6b7b8e44bb84f8a118b42`; `main` en `9650f908f8427c0f51a5fee5defc42570ef9bcab`. Los PR #122 y #123 están integrados y el merge de #123 es el HEAD de la epic. No hay PR posterior a #123 contra esa base. Esta auditoría no inspeccionó ni modificó Staging o Production.

## Mapa encontrado

- `scripts/staging/guard.mjs` valida ambiente, ref, URL, fingerprint de Production, link local y flags apagadas. No fija por sí mismo la ref autorizada de Staging ni valida que una credencial pertenezca a ella.
- `scripts/staging/run.mjs` mezcla operaciones read-only (`guard`, `db-dry-run`, `verify`) con mutaciones (`link`, `db-push`, `functions-deploy`, `unlink`). No tiene aprobaciones por etapa ni recibos reanudables.
- El runner exige que `supabase/migrations` contenga exactamente tres migraciones canónicas. La epic contiene ahora seis; por diseño aborta y tampoco distingue el subconjunto aprobado del historial remoto completo.
- Su allowlist de Edge no incluye `tournament-media-signer` ni `tournament-media-processor`.
- `scripts/torneos-staging/*` aporta fixtures sintéticos, validación de checksums y un verificador PostgreSQL read-only, pero su manifiesto termina en `20260727060000_tournament_media_galleries.sql` y no cubre las tres migraciones nuevas.
- `scripts/storage/provision-tournament-media-local.mjs` protege loopback y crea/verifica el bucket local, pero no expone todavía el contrato completo inspect/plan/dry-run/apply/verify/rollback ni aborta por policies inesperadas.
- Las migraciones de Multimedia contienen el contrato de bucket/policies, atestaciones, quarantine, cola, leases, cleanup y readiness. Estudio Social agrega permisos y RPCs. No existían rollbacks SQL conservadores versionados para ninguna de las tres.
- Las Edge Functions están versionadas y `verify_jwt=true`; `tournament-media-processor` Edge es el orquestador, no el worker de imágenes.
- `workers/tournament-media-processor` contiene sharp/libvips, ClamAV, self-test, leases, idempotencia y límites. Faltaban lockfile propio, Node 22 estricto, plantilla de entorno y runbooks de provisión/apagado/incidentes.
- Las flags frontend cierran Multimedia por gates operativos y cierran Production. Falta codificar como contrato de despliegue el orden de atestación, prueba de revocación, QA Multimedia y posterior habilitación Social.
- No existe una fase remota read-only claramente separada y persistida antes de las mutaciones. Tampoco existe un plan determinista firmado por SHA que permita reanudar sin aceptar drift.

## Riesgos que gobiernan la implementación

1. `db push` podría aplicar migraciones ajenas si el historial remoto no se compara antes por versión, orden y checksum.
2. Reconciliar bucket o policies silenciosamente podría ampliar permisos o destruir configuración existente.
3. Desplegar ambas Edge Functions juntas elimina el punto de pausa y rollback entre signer y orquestador.
4. Una atestación sin self-test real permitiría `uploadReady=true` con ClamAV, libvips o cleanup ausentes.
5. Activar Social antes de certificar los datos publicados, permisos y aislamiento multi-tenant expondría información no publicada.
6. Logs o planes sin sanitización podrían filtrar tokens, claves, URLs firmadas o identity maps.
7. Un rollback que haga `DROP` de tablas o borre objetos perdería evidencia y contenido de usuario.

## Decisión

Se conserva el tooling anterior como evidencia y se agrega un manifiesto operativo específico, un preflight fail-closed y una CLI por etapas. Los rollbacks automáticos revocan acceso, bloquean nuevas escrituras y preservan datos; cualquier eliminación definitiva queda fuera del flujo automático y exige segunda autorización.

> Sistema de preparación certificado localmente; Staging todavía no inspeccionada ni modificada.
