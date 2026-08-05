# Observabilidad del pipeline Multimedia

Definición operativa de las señales que el manifiesto declara obligatorias. La fuente de verdad legible por máquina es `ops/torneos-staging/observability/catalog.json`; este documento explica cada señal, qué hacer cuando dispara y qué nunca puede aparecer en un log.

**Estado: definido, sin colectores implementados, no desplegado.** Ninguna de estas señales está instrumentada todavía en Staging, y **ninguno de los cuatro colectores existe como proceso ejecutable en este repositorio**. `catalog.json` declara `signalsDeployedInStaging: false`, `validatedInStaging: false` e `implemented: false` en los cuatro colectores; mientras cualquiera de esos sea false el flag `REACT_APP_TORNEOS_MEDIA_OBSERVABILITY_READY` permanece en false y `mediaUploadEnabled` no puede abrirse (`src/features/torneos/config/featureFlags.js`).

La distinción importa: una señal *apagada* se enciende esperando; una señal *sin colector* no se enciende nunca por más que se espere. `observabilityReadiness()` las separa con blockers propios (`collectors.not_implemented:<nombre>`), y el manifiesto tiene que listar exactamente los mismos en `observability.collectorsNotImplemented` — así ninguno de los dos archivos puede abrir la compuerta solo.

## Colectores

| Colector | Qué corre | Intervalo | Credencial | Implementado |
|---|---|---:|---|---|
| `database` | `ops/torneos-staging/observability/media-pipeline-signals.sql`, un único SELECT de sólo lectura | 60 s | rol colector descrito abajo; nunca el browser, nunca CI | **no** — existe el SQL, falta el proceso que lo corra, derive la ventana y publique |
| `storage` | listado de los prefijos `_probe/` y `_selftest/` | 300 s | credencial de servicio de Storage, sólo lectura | **no** — nada en el repo lista los prefijos |
| `readiness` | `npm run torneos:staging:inspect:remote:readonly` | 900 s | credencial read-only de inspección | **no** — existen el inspector y `computeMigrationDrift()`, falta el proceso que los una |
| `runtime` | agregación de los logs estructurados del signer, del orquestador, del worker y del renovador | 60 s | ninguna: sólo lee logs ya emitidos | **no** — falta el agregador y el pipeline de logs |

Cada colector declara en el catálogo qué le falta (`blocker`) y de dónde saldría el número (`plannedSource`). Un colector sin ambas cosas es rechazado por `validateCatalog`, para que "no implementado" no pueda degradarse a "ya veremos".

El SQL devuelve una sola fila JSON con conteos, edades y ratios. No devuelve nombres de objeto, paths, ids de organización/torneo/galería, ids de usuario, tokens ni texto de error. `uploadReady` sale de `tournament_media_pipeline_readiness()`: el colector nunca lo recalcula.

### Contrato del rol colector

RLS convierte a `count(*)` en una mentira por omisión: un rol que no ve ninguna fila de `tournament_media_processing_jobs` obtiene exactamente la misma respuesta que un rol mirando una cola realmente vacía — cero. Publicar ese cero como `queueDepth` sería convertir un colector ciego en un tablero verde.

Por eso la consulta **prueba su propia visibilidad antes de contar**, en la misma sentencia. El rol tiene que cumplir todo esto, y la consulta verifica cada punto en vez de asumirlo:

1. `SELECT` sobre `public.tournament_media_processing_jobs` y `public.tournament_media_service_attestations`;
2. `EXECUTE` sobre `public.tournament_media_pipeline_readiness()`;
3. exención de RLS en ambas tablas, por exactamente una de: `rolbypassrls` (la forma prevista), `rolsuper`, o ser dueño de la tabla mientras la tabla no tenga `FORCE ROW LEVEL SECURITY`.

**Ser miembro del rol destino de una policy NO alcanza.** Una policy filtra, y un conteo filtrado no se distingue de uno chico. Visibilidad parcial se rechaza igual que visibilidad nula.

Cuando la prueba falla, el SQL emite `NULL` en **todas** las métricas — nunca 0 — y `visibility.observable: false` con los blockers exactos. El evaluador rechaza ese snapshot con `COLLECTOR_VISIBILITY_UNPROVEN` en vez de evaluarlo, y sin bloque de visibilidad rechaza con `COLLECTOR_VISIBILITY_MISSING`. Fail-closed de punta a punta.

**Este cambio no crea ningún rol ni otorga ningún permiso.** Los `GRANT` correspondientes son su propio cambio revisado, con la advertencia obvia: `rolbypassrls` es un privilegio serio y el rol que lo tenga no debe poder hacer nada más que estos `SELECT`.

### Ventana de sostenimiento (dwell)

El SQL devuelve valores instantáneos y **no emite ningún campo `*SustainedSeconds`**: una sola lectura no puede saber cuánto hace que un valor está donde está. La ventana la deriva el colector entre lecturas consecutivas, con `deriveSustainedSeconds()` de `scripts/torneos-staging/observability-lib.mjs`, que guarda por métrica la banda de severidad y desde cuándo está en ella.

Banda y no valor: un gauge que oscila entre 61 y 64 no salió de su banda de warning, y reiniciar el reloj en cada oscilación haría que una condición persistente nunca madure a alerta.

Si un umbral con ventana se cumple y el colector no informó dwell, la métrica queda en **`unknown`** — no en `ok` y no en alerta. Antes se asumía `Infinity`, que afirmaba en silencio "esto viene pasando desde siempre" y convertía cualquier umbral con ventana en una alerta instantánea sobre un snapshot que nunca midió nada. Las dos direcciones de esa suposición son incorrectas; la respuesta honesta es que no sabemos.

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

`arma2_torneos_media_migration_drift` — desacuerdos entre el objetivo de migraciones del manifiesto y el historial remoto, contados **por presencia y orden de versiones**. Crítico a partir de 1, sin ventana: cualquier drift invalida el contrato de ejecución.

No es una comparación de checksums, y no puede serlo: el historial remoto expone `version` y `name` y nada más. El inspector read-only registra `checksum: null` y lo dice en su propia lista de limitaciones. Una métrica definida sobre un campo inexistente no es una métrica apagada — es una que no puede reportar nunca, mientras figura en la lista de requeridas pareciendo lo primero.

Lo que sí es observable, y es lo que cuenta `computeMigrationDrift()` en `readiness-lib.mjs`:

- versiones remotas sin archivo de migración local que las explique;
- migraciones del objetivo aplicadas fuera del orden declarado;
- versiones remotas duplicadas.

La verificación de checksum no desaparece: sigue ocurriendo localmente, contra los archivos de migración, en `validateManifest`. Simplemente deja de disfrazarse de observación remota.

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

0. **Implementar los cuatro colectores.** Ninguno existe todavía; hasta que existan, la compuerta está cerrada por `collectors.not_implemented:*` y ningún tiempo de espera la abre.
1. Crear el rol colector con el contrato de arriba (cambio propio, revisado), desplegar los cuatro colectores contra Staging y confirmar que cada métrica requerida reporta valor.
2. Correr `node scripts/torneos-staging/observability.mjs evaluate --snapshot=<snapshot real>` y obtener `observable: true`.
3. Provocar deliberadamente al menos una alerta por familia (cola, lease, atestación, firmas AV, residuo) y verificar que dispara, que enruta al runbook correcto y que se recupera sola cuando la condición cede.
4. Verificar en el backend de métricas que ningún campo prohibido llegó a persistirse.
5. Recién entonces cambiar `signalsDeployedInStaging` y `validatedInStaging` a true en el catálogo, y `REACT_APP_TORNEOS_MEDIA_OBSERVABILITY_READY` a true en el entorno de Staging. Los tres cambios son revisables y ninguno es automático.
