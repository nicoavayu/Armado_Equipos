# Renovación de la atestación del signer

**Estado: implementado, no desplegado.** El código vive en `workers/tournament-media-signer-renewer`. Ningún scheduler está configurado, ningún Secret fue creado y nada se desplegó en este cambio.

## El problema

`tournament_media_pipeline_readiness()` exige atestaciones frescas de los dos servicios. El processor renueva la suya desde su propio loop: TTL 900 s, re-atestación a un tercio del TTL (`workers/tournament-media-processor/src/index.mjs`). El signer no puede hacer lo mismo: es una Edge Function, sólo atestigua mientras responde una llamada `health`, y esa llamada está autorizada por `TOURNAMENT_MEDIA_ATTESTATION_SECRET`.

Su atestación dura 3600 s. Sin un scheduler, alguien tenía que ejecutar el probe a mano cada hora o `uploadReady` se cerraba solo. Eso no es operable.

## Arquitectura elegida

Un proceso propio, **sidecar del worker Multimedia**, en la misma zona de confianza privada y con el mismo secret store.

```
secret store ──► renovador (sin credencial de servicio)
                    │  POST /functions/v1/tournament-media-signer  {"action":"health"}
                    │  header x-media-attestation-secret
                    ▼
              signer Edge Function
                    │  prueba real: firma upload, escribe, firma lectura, lee, borra
                    ▼
              attest_tournament_media_service('signer', ttl 3600)
```

Dos formas de ejecución, mismo comportamiento:

- `node src/cli.mjs --once` — un ciclo, para un scheduler externo (systemd timer, CronJob de Kubernetes, el orquestador que ya corre el worker). Exit 0 renovó, exit 1 no renovó.
- `node src/cli.mjs` — loop de larga vida que se auto-espacia, para un contenedor junto al worker.

### Por qué no las alternativas

| Alternativa | Por qué no |
|---|---|
| `pg_cron` + `pg_net` desde la base | Obliga a guardar el secreto de atestación dentro de la base, legible por cualquiera con acceso al proyecto. Es exactamente la exposición que el contrato prohíbe. |
| GitHub Actions con cron | El secreto pasa a vivir en CI, que es una superficie más grande y con más gente adentro que el host del worker; además la granularidad del cron y sus demoras no son compatibles con una ventana de 3600 s. |
| Endpoint público de renovación | Cualquier renovación disparable sin secreto convierte la atestación en un sello automático, que es lo contrario de una prueba. |
| Extender el TTL a 24 h | Baja la frecuencia del problema y sube el daño: una atestación de un día sobrevive a un signer roto casi un día entero. |
| Que el worker renueve también el signer | Le daría al worker el secreto de atestación del signer y borraría la separación entre los dos tiers. |

### Quién lo ejecuta

- **Staging:** el mismo host/orquestador que corre `workers/tournament-media-processor`, como servicio adicional del compose del worker. Responsable: quien opere el worker Multimedia de Staging. El secreto sale del secret store del host, nunca de la imagen ni del compose versionado.
- **Producción:** no aplica todavía. Multimedia está forzado a false en producción (`flags.productionForcedFalse`). Cuando exista, el dueño es el mismo equipo que opere el worker productivo, con el mismo patrón de sidecar y un secreto distinto del de Staging.

Una sola instancia por ambiente es suficiente. Dos no rompen nada — la atestación es una fila por servicio y la renovación es un upsert — pero duplican el probe de Storage sin beneficio.

## Contrato

| Propiedad | Valor por defecto | Regla |
|---|---:|---|
| TTL de la atestación | 3600 s | lo escribe el signer; el renovador no puede cambiarlo |
| Intervalo de renovación | 1200 s | un tercio del TTL |
| Jitter | ±10 % | 1080–1320 s, simétrico: la cadencia promedio sigue siendo la configurada |
| Timeout por intento | 10 000 ms | explícito, con `AbortController` |
| Intentos | 3 | backoff exponencial acotado 2 s → 4 s, tope 30 s, con jitter |
| Margen de seguridad | 900 s | el peor caso completo debe terminar con al menos este margen de TTL sin usar |
| Alerta | 2 fallas consecutivas | ~16 min antes de que la atestación pueda vencer |

El proceso **se niega a arrancar** si el peor caso (intervalo con jitter máximo + todos los intentos agotando timeout + todos los backoffs) más el margen no entra en el TTL (`RENEWER_SCHEDULE_UNSAFE`), o si la alerta caería después del vencimiento (`RENEWER_ALERT_TOO_LATE`). Una cadencia que podría perder el vencimiento es un error de arranque, no un hueco silencioso en readiness.

### Idempotencia

La atestación es una única fila con `service` como clave primaria: renovar de más sólo refresca. El guard de "en vuelo" evita apilar requests sobre un signer lento; no protege la corrección, que ya está garantizada por el upsert.

### Fail-closed

No hay ningún camino en este código que extienda, falsifique o mantenga viva una atestación. Si el renovador muere, se cuelga, pierde red o es rechazado por el secreto, la atestación **vence sola** y `uploadReady` se cierra. Ese es el resultado correcto, no una caída a rodear.

Un 200 sólo se acepta si el cuerpo es la certificación propia del signer (`service: "signer"`, `evidence.signedUploadUrls` y `evidence.signedReadUrls` en true). Un 200 con otro cuerpo es `SIGNER_HEALTH_INVALID`: el deployment que contestó no es el signer que creemos.

### Privilegio

El renovador **no tiene credencial de servicio**. Lleva dos cosas:

- el secreto de atestación, que es lo único que el `health` del signer realmente autoriza;
- una credencial pública del gateway de Functions (publishable/anon), porque el signer corre con `verify_jwt = true`. El arranque falla si esa credencial parece de servicio (`RENEWER_GATEWAY_KEY_PRIVILEGED`).

Comprometer este proceso no da lectura del bucket, ni de la cola, ni del mapa de identidad. Sólo permite pedirle al signer que se vuelva a probar a sí mismo — lo mismo que haría un operador a mano.

### Higiene de secretos

El secreto viaja en un header, nunca en la URL ni en el cuerpo, así que no puede terminar en un access log. Todo log pasa por un redactor por valor que elimina el secreto incluso cuando llega adentro del mensaje de error de otra librería, y descarta claves como `authorization`, `apikey` y `headers` completas. Los errores de configuración nombran la variable y la regla, jamás el valor.

## Variables

Nombres, sin valores. Ninguna es un Secret creado en este cambio.

```
SUPABASE_URL                                     origen https desnudo del proyecto autorizado
TOURNAMENT_MEDIA_EXPECTED_API_HOST               el mismo host, dicho por segunda vez
TOURNAMENT_MEDIA_FORBIDDEN_API_HOSTS             opcional, lista separada por comas
TOURNAMENT_MEDIA_ATTESTATION_SECRET              secreto; ≥ 32 caracteres
TOURNAMENT_MEDIA_GATEWAY_KEY                     credencial pública del gateway
  (o SUPABASE_PUBLISHABLE_KEY / SUPABASE_ANON_KEY)
TOURNAMENT_MEDIA_SIGNER_FUNCTION                 default tournament-media-signer
TOURNAMENT_MEDIA_SIGNER_ATTEST_TTL_SECONDS       default 3600
TOURNAMENT_MEDIA_RENEW_INTERVAL_SECONDS          default 1200
TOURNAMENT_MEDIA_RENEW_JITTER_RATIO              default 0.1
TOURNAMENT_MEDIA_RENEW_TIMEOUT_MS                default 10000
TOURNAMENT_MEDIA_RENEW_MAX_ATTEMPTS              default 3
TOURNAMENT_MEDIA_RENEW_BACKOFF_MS                default 2000
TOURNAMENT_MEDIA_RENEW_BACKOFF_MAX_MS            default 30000
TOURNAMENT_MEDIA_RENEW_ALERT_AFTER_FAILURES      default 2
TOURNAMENT_MEDIA_RENEW_SAFETY_MARGIN_SECONDS     default TTL/4
TOURNAMENT_MEDIA_RENEWER_ID                      identificador de instancia para los logs
```

El host se declara dos veces a propósito: una URL de producción pegada por error falla en el arranque (`RENEWER_HOST_MISMATCH`) en lugar de renovar contra el proyecto equivocado.

## Eventos

Todos JSON, con `component: "signer-attestation-renewer"`.

| Evento | Significado |
|---|---|
| `renewer_started` | arranque, con la cadencia y el peor caso calculados |
| `renewal_succeeded` | el signer se probó y escribió su atestación; incluye `attestationExpiresAt` derivado del TTL |
| `renewal_attempt_failed` | un intento falló; dice si era reintentable |
| `renewal_failed` | el ciclo completo falló; incluye `attestationExpiresInSeconds` |
| `renewal_alert` | fallas consecutivas ≥ umbral; `severity` pasa a `critical` si el vencimiento ya entró en el margen |
| `renewal_recovered` | un ciclo exitoso después de una alerta |
| `renewal_skipped` | ya había un ciclo en vuelo |
| `startup_refused` | configuración inválida; nombra la variable, nunca el valor |

`renewal_alert` alimenta la métrica `arma2_torneos_media_signer_attestation_renewal_failures_consecutive` del [catálogo de observabilidad](tournament-media-observability.md#attestation-renewal-failures).

## Incidentes

- **`SIGNER_SECRET_REJECTED` (403):** el secreto del renovador y el de la función divergieron. No se reintenta. Comparar en el secret store — nunca imprimirlos —, rotar si hay sospecha y reiniciar el renovador. Mientras tanto la atestación vence y Multimedia se cierra: es lo esperado.
- **`SIGNER_GATEWAY_REJECTED` (401):** la credencial pública del gateway venció o cambió. Reemplazarla desde el secret store. Nunca sustituirla por una credencial de servicio.
- **`SIGNER_UNAVAILABLE` (5xx) o `SIGNER_TIMEOUT`:** el probe del signer falla contra Storage. Ir al bucket, no al renovador: `bucket_absent`, `bucket_public`, `upload_probe_failed` o `read_probe_failed` en los logs del signer. Revisar además `residual-probe-objects`.
- **`SIGNER_HEALTH_INVALID`:** contestó algo que no es el signer, o una versión del signer que ya no certifica lo mismo. Congelar, verificar el checksum desplegado contra el manifiesto y no forzar la renovación.
- **`SIGNER_NOT_FOUND` (404):** la función no está desplegada en el proyecto al que se apunta. Verificar `SUPABASE_URL` antes que cualquier otra cosa.
- **Renovador caído sin alerta:** la métrica de expiración (`attestation-expiry`) es la red de seguridad; cae aunque el renovador no emita nada, porque la lee la base.

Nunca "recuperar servicio" alargando el TTL, deshabilitando la verificación del cuerpo o corriendo el probe con un secreto de otro ambiente.

## Despliegue posterior (no ejecutado)

1. Crear el Secret del renovador en el secret store del host del worker de Staging, con el mismo valor que ya usa la Edge Function.
2. Agregar el servicio al compose/unidad del worker con `restart: unless-stopped`, CPU y memoria mínimas, filesystem read-only y sin acceso a la red salvo el host autorizado.
3. Arrancar en modo `--once` a mano una vez y verificar `renewal_succeeded` y que `signerAttestationExpiresInSeconds` sube a ~3600.
4. Habilitar el modo loop (o el timer) y observar dos renovaciones consecutivas con jitter distinto.
5. Provocar una falla (bloquear egress 5 minutos) y verificar `renewal_alert` con severidad correcta y `renewal_recovered` al restaurar.
6. Recién entonces contar la señal como desplegada en el catálogo de observabilidad.

## Rollback

Detener el servicio. No hay estado que revertir: la atestación vence sola dentro de 3600 s y `uploadReady` se cierra. Si hace falta cerrar antes, revocar la atestación del signer por el flujo aprobado de revocación y bajar el flag Multimedia. El renovador no participa en la revocación.
