# Observabilidad del pipeline Multimedia

Definición operativa de las señales que el manifiesto declara obligatorias. La fuente de verdad legible por máquina es `ops/torneos-staging/observability/catalog.json`; este documento explica cada señal, qué hacer cuando dispara y qué nunca puede aparecer en un log.

**Estado: definido, no desplegado.** Ninguna de estas señales está instrumentada todavía en Staging. `catalog.json` declara `signalsDeployedInStaging: false` y `validatedInStaging: false`, y mientras cualquiera de los dos sea false el flag `REACT_APP_TORNEOS_MEDIA_OBSERVABILITY_READY` permanece en false y `mediaUploadEnabled` no puede abrirse (`src/features/torneos/config/featureFlags.js`).

## Colectores

| Colector | Qué corre | Intervalo | Credencial |
|---|---|---:|---|
| `database` | `ops/torneos-staging/observability/media-pipeline-signals.sql`, un único SELECT de sólo lectura | 60 s | credencial de servicio del host colector; nunca el browser, nunca CI |
| `storage` | listado de los prefijos `_probe/` y `_selftest/` | 300 s | misma credencial de servicio, sólo lectura y borrado del residuo |
| `readiness` | `npm run torneos:staging:inspect:remote:readonly` | 900 s | credencial read-only de inspección |
| `runtime` | agregación de los logs estructurados del signer, del orquestador, del worker y del renovador | 60 s | ninguna: sólo lee logs ya emitidos |

El SQL devuelve una sola fila JSON con conteos, edades y ratios. No devuelve nombres de objeto, paths, ids de organización/torneo/galería, ids de usuario, tokens ni texto de error. `uploadReady` sale de `tournament_media_pipeline_readiness()`: el colector nunca lo recalcula.

## Evaluación y compuerta

`scripts/torneos-staging/observability-lib.mjs` evalúa un snapshot contra el catálogo:

```bash
node scripts/torneos-staging/observability.mjs evaluate --json
```

Dos reglas gobiernan el resultado:

- **Ausencia = fail-closed.** Una métrica requerida sin valor queda en `unknown`, `observable` pasa a false y la observabilidad no se considera validada. Un pipeline ciego no es un pipeline sano.
- **Nada identificante atraviesa el colector.** El snapshot se valida antes de evaluarse: cualquier clave que parezca identificador o path, y cualquier valor con forma de UUID, JWT, URL firmada o nombre de archivo, aborta la evaluación.

El comando sale con código 1 si hay una severidad crítica o si falta alguna métrica requerida, de modo que una corrida programada del propio evaluador es también una compuerta.

## Señales

Umbrales, severidad y recuperación exactos están en el catálogo. Aquí van la lectura operativa y el procedimiento.

### quarantine-depth

`arma2_torneos_media_quarantine_depth` — objetos subidos que todavía no terminaron de procesarse. Se cuenta desde la cola, no desde un listado del bucket: la cola es lo único que sabe que un objeto existe antes de que exista el asset.

Warning ≥ 50 sostenido 10 min, crítico ≥ 200. Recupera bajo 25 sostenido 15 min.

Procedimiento: cerrar flags, detener nuevas sesiones, medir `queue-depth` y `job-age` para distinguir "el worker está lento" de "el worker está muerto". **No borrar la cuarentena** hasta correlacionar con auditoría: los objetos en cuarentena son la evidencia de un incidente de malware.

### queue-depth

`arma2_torneos_media_queue_depth` — jobs en `queued` esperando lease. Warning ≥ 25 sostenido 10 min, crítico ≥ 100.

Si crece con `job-age` estable, faltan workers. Si crece con `job-age` creciendo, el worker no está tomando trabajo: revisar atestación del processor (`processor-attestation-expiry`) antes que la capacidad.

### job-age

`arma2_torneos_media_oldest_job_age_seconds` — edad del job no terminal más viejo. Es el mejor proxy de "el worker se detuvo". Warning ≥ 900 s, crítico ≥ 3600 s.

### expired-leases

`arma2_torneos_media_expired_leases` y `arma2_torneos_media_stuck_lease_age_seconds` — leases vencidos que siguen marcados `leased`, y cuánto hace que vencieron.

Un valor distinto de cero que persiste significa que `cleanup_tournament_media_processing_jobs` no está corriendo: el barrido vive en el loop del worker, así que un lease atascado suele ser un worker caído, no una falla de la base. Warning ≥ 1 sostenido 10 min; crítico ≥ 5, o edad de atasco ≥ 900 s.

Procedimiento: dejar expirar, ejecutar el sweeper, revisar idempotencia y reintentos antes de reemplazar el worker. Un job que agota `max_attempts` pasa a `abandoned` y su objeto queda listado como purgable, nunca borrado automáticamente.

### attestation-expiry

`arma2_torneos_media_signer_attestation_expires_in_seconds` y `..._processor_...`.

El signer tiene TTL 3600 s y se renueva cada 1200 s desde `workers/tournament-media-signer-renewer`; por debajo de 1200 s ya se perdió al menos una renovación (warning), por debajo de 600 s es crítico. El processor tiene TTL 900 s y se re-atestigua a un tercio del TTL desde su propio loop; por debajo de 300 s es warning y de 120 s crítico.

Una fila ausente reporta −1, no null: ausente se trata como vencida, nunca como desconocida.

Ver [renovación de la atestación del signer](tournament-media-signer-attestation-renewal.md) y el [runbook del worker](tournament-media-worker-runbook.md).

### attestation-renewal-failures

`arma2_torneos_media_signer_attestation_renewal_failures_consecutive` — ciclos de renovación fallidos consecutivos, emitidos por el renovador. Warning a 1, crítico a 2, que con la cadencia por defecto ocurre unos 16 minutos antes de que la atestación pueda vencer.

### clamav-signature-age

`arma2_torneos_media_clamav_signature_age_seconds` — edad del set de firmas que el processor atestiguó. Warning a 5 días, crítico a 7. A los 7 días el self-test del worker falla por contrato, se revoca la atestación y `uploadReady` se cierra solo: la alerta a 5 días existe para actuar antes de esa caída, no para reemplazarla.

Evidencia ausente reporta 604800 s (el umbral de falla), nunca cero.

### selftest-failures

`arma2_torneos_media_selftest_failures_total` — fallas de self-test del worker y del probe del signer en ventana de 15 min. Warning ≥ 1, crítico ≥ 3.

Cualquier falla ya cerró una compuerta de readiness: la alerta informa, no habilita. Procedimiento: leer qué check falló en el log estructurado (`checks`), restaurar el componente y repetir el self-test real. Nunca relajar el umbral para recuperar servicio.

### cleanup-failures

`arma2_torneos_media_cleanup_failures_total` — fallas de los contratos de barrido (`cleanup_tournament_media_upload_sessions`, `cleanup_tournament_media_processing_jobs`) y de los borrados de Storage que los siguen. Ventana 30 min, warning ≥ 1, crítico ≥ 3.

`cleanup` es además una capability atestiguada: si el worker deja de poder borrar, su atestación pierde la capability y `uploadReady` se cierra. La métrica adelanta ese cierre.

### residual-objects

`arma2_torneos_media_residual_probe_objects` y `arma2_torneos_media_residual_selftest_objects` — objetos bajo `_probe/` y `_selftest/` más viejos que 5 minutos.

El probe del signer borra su objeto en un `finally`, y el self-test del worker prueba `cleanup` borrando el suyo y verificando que desapareció. Un residuo contradice una atestación que afirma `cleanup`: es señal de que el borrado falla en silencio o de que hay un proceso escribiendo esos prefijos fuera del contrato.

Warning ≥ 1 sostenido 15 min, crítico ≥ 10. El colector cuenta objetos; **no emite sus nombres**.

### latency-and-errors

`arma2_torneos_media_signer_latency_p95_ms`, `..._signer_error_ratio`, `..._processor_latency_p95_ms`, `..._processor_error_ratio`, `arma2_torneos_media_upload_failure_ratio`.

Los 401/403 del signer son rechazos de autorización, no errores: se cuentan aparte y no entran en el ratio. Un pico de 403 sobre `health` es intento de acceso al probe con secreto inválido y se escala como incidente de seguridad, no de disponibilidad.

Latencia warning ≥ 1500 ms sostenido 10 min, crítico ≥ 3000 ms sostenido 5 min. Ratio de error warning ≥ 2 %, crítico ≥ 10 %.

### upload-ready

`arma2_torneos_media_upload_ready` — el veredicto `uploadReady` de la base exportado como 1/0. Warning si está en 0 más de 5 min, crítico si más de 30 min.

Es una señal derivada: cuando cae, la causa está en alguna de las anteriores. Nunca se "arregla" tocando esta métrica.

### migration-drift

`arma2_torneos_media_migration_drift` — migraciones aplicadas cuyo checksum remoto difiere del manifiesto, o que el manifiesto no declara. Crítico a partir de 1, sin ventana: cualquier drift invalida el contrato de ejecución.

## Prohibido en logs y métricas

Nunca, en ninguna serie, label, alerta ni log estructurado:

- nombres de objeto y paths internos del bucket;
- URLs firmadas y cualquier query string con `token`/`signature`;
- tokens de sesión de upload y lease tokens;
- API keys, credenciales de servicio y el secreto de atestación;
- JWTs y headers `Authorization`;
- ids de usuario, emails, nombres visibles y mapas de identidad;
- direcciones IP de quien sube;
- payloads EXIF y cualquier byte de imagen;
- texto crudo de error de los RPC de media.

Labels permitidos: `environment`, `service`, `release`, `severity`. Labels prohibidos: `organization_id`, `tournament_id`, `gallery_id`, `user_id`, `object_name`, `job_id` — un label por tenant reconstruiría el mapa de identidad dentro del backend de métricas, que es justo lo que el contrato del pipeline prohíbe.

## Retención mínima recomendada

| Serie | Retención | Razón |
|---|---:|---|
| Métricas | 30 días | cubre un ciclo completo de QA en Staging más una ventana de regresión |
| Eventos de alerta | 90 días | es el rastro de incidentes al que apela el contrato de rollback |
| Logs estructurados | 14 días | piso con el cual un incidente de cuarentena todavía se puede correlacionar |

Por debajo de 14 días de logs, un incidente de malware detectado tarde ya no es reconstruible: 14 días es el mínimo, no el objetivo.

## Antes de marcar la observabilidad como validada

1. Desplegar los cuatro colectores contra Staging y confirmar que cada métrica requerida reporta valor.
2. Correr `node scripts/torneos-staging/observability.mjs evaluate --snapshot=<snapshot real>` y obtener `observable: true`.
3. Provocar deliberadamente al menos una alerta por familia (cola, lease, atestación, firmas AV, residuo) y verificar que dispara, que enruta al runbook correcto y que se recupera sola cuando la condición cede.
4. Verificar en el backend de métricas que ningún campo prohibido llegó a persistirse.
5. Recién entonces cambiar `signalsDeployedInStaging` y `validatedInStaging` a true en el catálogo, y `REACT_APP_TORNEOS_MEDIA_OBSERVABILITY_READY` a true en el entorno de Staging. Los tres cambios son revisables y ninguno es automático.
