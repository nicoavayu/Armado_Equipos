# Runbook operativo: Multimedia Upload y Estudio Social

Estado auditado: **contratos certificados; certificación live local pendiente**. Storage, grants y rollbacks se probaron contra un Supabase local efímero, pero el identity map legacy no satisface el contrato V3/V4 actual y el self-test real del worker no puede atestiguar antivirus/Storage sin `clamd` y credenciales locales del worker. No se modifican identidades, descriptor ni fingerprint para ocultar esos bloqueos.

Este runbook separa inspección, planificación, mutaciones, QA y rollback. Ningún comando único aplica todo. Cada etapa mutante se autoriza por separado y se detiene ante SHA, ref, historial, checksum, configuración o recibo divergente.

## Límites de automatización

Puede automatizarse: validación del manifiesto, checksums, guard de Production, comparación determinista de snapshots, plan/dry-run, tests locales, creación idempotente del bucket cuando está ausente, despliegue individual de una Edge Function y verificación de contratos.

Necesita autorización humana: cada mutación, cada función Edge, atestación, cambio de flag, rollback, cleanup local material y cualquier costo. El operador debe conservar plan, aprobación y recibo.

Nunca se automatiza: `apply-all`, uso de Production, reemplazo silencioso de policies, lectura o impresión de secretos, borrado de contenido del bucket, `DROP`/`TRUNCATE` de datos de usuario, promoción de flags sin QA, deploy del worker desde CI o merge del PR operativo.

## Detección de Production y aborto

El target permitido está versionado en `ops/torneos-staging/manifest.json`. Se exige coincidencia exacta entre environment, project ref, host API, ref de la credencial y link Supabase. El ref y host de Production están en la denylist. URLs con credenciales, paths, puertos, queries, fragments o sufijos parecidos abortan.

Ante un error:

1. No reintentar una mutación.
2. Guardar sólo código de error, plan id y recibo sanitizado.
3. Apagar ambas flags si alguna estuviera activa.
4. Revocar atestaciones si el incidente toca Multimedia.
5. Comparar nuevamente desde `inspect`; nunca editar el snapshot para hacerlo pasar.

## Artefactos y evidencia

- Manifiesto: `ops/torneos-staging/manifest.json`.
- Fixture local: `ops/torneos-staging/fixtures/local-ready.json`.
- QA: `ops/torneos-staging/qa-matrix.json`.
- Rollbacks: `supabase/rollbacks/*.safe.sql`.
- Auditoría previa: `docs/operations/torneos-staging-readiness-audit.md`.
- Worker: `docs/operations/tournament-media-worker-runbook.md`.

El plan liga el SHA exacto del HEAD, SHA de epic, digest del manifiesto y digest del snapshot. La salida no incluye tokens, claves, URLs firmadas o identity maps.

## 1. Preflight local

Desde el worktree aislado y limpio:

```bash
npm ci
npm run test:staging:guard
npm run torneos:staging:inspect
npm run torneos:staging:plan
npm run torneos:staging:dry-run -- --include-sql
```

`inspect`, `plan` y `dry-run` usan fixture en esta entrega y reportan `remoteCalls=0`. Un futuro inspector read-only deberá producir un snapshot con el mismo schema después de comparar historial remoto completo, migraciones locales, checksums, orden, faltantes e inesperadas. Hasta entonces las etapas remotas permanecen bloqueadas.

Preflight fail-closed obligatorio:

- branch exacta y worktree limpio;
- SHA de epic ancestro del HEAD y SHA exacto ligado al plan;
- checksums de migraciones, Edge y rollbacks válidos;
- ningún secreto versionado;
- ref/host/credencial/link exactos;
- historial remoto compatible y sin drift;
- bucket/policies sin configuración inesperada;
- secretos requeridos presentes sólo por nombre;
- worker y flags en estado requerido.

## 2. Inspect remoto futuro — read-only

Esta es una tarea futura con autorización específica. Debe abrir transacción `READ ONLY`, timeouts cortos y un usuario sin capacidad DDL. Consultar:

- `supabase_migrations.schema_migrations` completo y checksums/evidencia disponible;
- archivos locales completos, no sólo las tres migraciones objetivo;
- `storage.buckets`, `pg_policies` de `storage.objects`, grants directos;
- versiones/checksums/health de Edge;
- nombres de secretos, nunca valores;
- worker health/self-test, versión Node/sharp/libvips/ClamAV y fecha de firmas;
- atestaciones, `uploadReady` y flags actuales.

Abortar si aparece una migración remota que no existe localmente, un target aplicado fuera de orden, checksum desconocido o cualquier objeto inesperado. No asumir que las tres migraciones son las únicas pendientes.

## 3. Plan y dry-run

El dry-run humano muestra migraciones, SQL exacto con `--include-sql`, objetos afectados, locks previstos, riesgos, rollback, bucket/policies, funciones, secretos faltantes por nombre, worker, flags, bloqueos, pasos manuales y aprobaciones. `--json` produce salida determinista exportable.

No aprobar si:

- el plan cambia al repetirlo sobre el mismo snapshot;
- falta rollback;
- faltan precondiciones de drenaje;
- el SQL contiene una migración fuera de allowlist;
- el output contiene material sensible.

## 4. Migraciones

Orden único:

1. `20260802090000_tournament_media_upload_pipeline.sql`.
2. `20260802120000_tournament_media_trusted_processing.sql`.
3. `20260803090000_tournament_social_studio.sql`.

Antes de `migrate`: flags falsas, plan/recibo `dry-run`, aprobación de etapa, mismo HEAD y nuevo inspect sin drift. El futuro executor puede usar `supabase db push --dry-run --linked` sólo si enumera exactamente este subconjunto pendiente. El `db push --linked --yes` se ejecuta una vez y luego se vuelve a inspeccionar el historial; si el dry-run menciona otra migración, no se aplica nada.

No ejecutar DDL con sesiones activas no evaluadas. Considerar locks de catálogo y `ACCESS EXCLUSIVE` sobre relaciones nuevas/reemplazadas. Ante timeout o estado ambiguo, inspeccionar primero; nunca reintentar a ciegas.

## 5. Storage

Contrato: bucket `tournament-media`, privado, 12 MiB, JPEG/PNG/WebP, SVG prohibido, sin URL pública y sin escritura directa para `anon`, `authenticated` o `PUBLIC`.

Policies exactas:

- `tournament_media_service_read`;
- `tournament_media_service_insert`;
- `tournament_media_service_update`;
- `tournament_media_service_delete`.

Local:

```bash
node scripts/storage/provision-tournament-media-local.mjs --mode=inspect
node scripts/storage/provision-tournament-media-local.mjs --mode=plan
node scripts/storage/provision-tournament-media-local.mjs --mode=dry-run
node scripts/storage/provision-tournament-media-local.mjs --mode=apply
node scripts/storage/provision-tournament-media-local.mjs --mode=verify
```

El script rechaza cualquier host no-loopback. `apply` es idempotente sólo cuando todo coincide; una diferencia aborta y nunca se reconcilia. El rollback local sólo elimina un bucket vacío con segunda confirmación. El rollback remoto preserva bucket y objetos, revoca entradas y marca la etapa contenida.

## 6. Secretos

Aceptar por nombre:

- `SUPABASE_SECRET_KEYS` o `SUPABASE_SERVICE_ROLE_KEY`;
- `SUPABASE_PUBLISHABLE_KEYS` o `SUPABASE_ANON_KEY`;
- `TOURNAMENT_MEDIA_ATTESTATION_SECRET`;
- variable no secreta `SUPABASE_URL`.

No imprimir, copiar desde Production, generar dentro del runbook ni ubicar claves privilegiadas en `REACT_APP_*`. Un secreto faltante aborta antes de Edge.

## 7. Edge Functions

Desplegar una por vez y registrar release/checksum/health:

1. `tournament-media-signer`.
2. Pausa humana, health y rollback comprobados.
3. `tournament-media-processor` Edge, que sólo orquesta la cola.

El worker confiable de imágenes no es la Edge Function. No usar `supabase functions deploy` sin nombre. Un futuro executor autorizado usa el nombre exacto, project ref exacto y `--use-api`; después inspecciona la versión desplegada y prueba health sin activar flags.

Rollback Edge: revocar atestación primero; restaurar el release anterior registrado. Si no hay release anterior, mantener flag false. Undeploy requiere una autorización destructiva separada.

## 8. Worker y atestaciones

Seguir `tournament-media-worker-runbook.md`. El worker debe pasar Node 22, sharp 0.33.5/libvips, clamd/freshclam, firmas menores a siete días, límites, Storage R/W/delete de self-test, cleanup y shutdown seguro.

Atestiguar signer y processor por separado con TTL corto. Probar revocación y confirmar que `uploadReady` vuelve a false antes de re-atestiguar. No atestiguar a partir de un reporte editado o self-test parcial.

## 9. Readiness y flags

Orden obligatorio:

1. Multimedia/Social false.
2. Migraciones verificadas.
3. Bucket/policies verificados.
4. Edge saludables.
5. Worker y self-test verdes.
6. Signer atestiguado.
7. Processor atestiguado.
8. `uploadReady=true` leído del backend.
9. Revocación probada y retorno a false; luego re-atestiguar.
10. Multimedia true sólo en Staging.
11. QA Multimedia.
12. Social true sólo en Staging.
13. QA Social.

Social no se activa sin recibo de QA Multimedia. Multimedia no se activa con `uploadReady=false`. Production siempre fuerza false.

## 10. QA

La matriz versionada contiene los doce roles, 23 casos Multimedia y 18 casos Social. Cada caso registra plan id, actor sintético, tenant, resultado, evidencia sanitizada y rollback. No registrar emails reales, paths internos, hashes de contenido o identity maps.

Después de QA, volver flags a false salvo autorización explícita de permanencia en Staging. Una falla de aislamiento, revocación, consentimiento, antivirus o datos no publicados es bloqueante.

## 11. Rollback y revocación inmediata

Orden de contención:

1. Social false; Multimedia false.
2. Revocar atestaciones signer/processor.
3. Impedir nuevas sesiones y leases.
4. Drenar jobs activos o dejar que expiren; no robar leases.
5. Ejecutar rollbacks SQL en orden inverso sólo con precondiciones verdes.
6. Restaurar releases Edge/worker anteriores.
7. Verificar `uploadReady=false`, RPCs cerradas y datos presentes.

Los `.safe.sql` abortan si hay sesiones o jobs activos y preservan tablas/filas. Cualquier eliminación definitiva queda fuera y necesita segunda autorización, backup confirmado y un plan nuevo.

## 12. Reanudación

Para reanudar después de una falla:

1. Ejecutar inspect desde cero.
2. Comparar con el último recibo.
3. Si cambió estado o HEAD, invalidar el plan y generar otro.
4. Reanudar únicamente desde la siguiente etapa cuyo requisito tenga recibo válido.
5. Si no puede probarse el estado anterior, volver a fail-closed: flags false, atestaciones revocadas, sin nuevas escrituras.

## 13. Cleanup y auditoría posterior

Cleanup local puede retirar artefactos temporales explícitos; no borra worktrees, ramas, snapshots aprobados ni evidencia. Cleanup remoto de objetos no es automático.

La auditoría posterior verifica historial, checksums, grants, RLS, policies, versiones Edge/worker, atestaciones, flags, alertas, jobs/quarantine y ausencia de secretos en logs. El cierre debe afirmar el estado real; hasta completar una inspección y QA remotos, no usar la frase “Staging certificada”.
