# Renovación de la atestación del signer

**Estado: implementado, no desplegado.** El código vive en `workers/tournament-media-signer-renewer`, con `package-lock.json` propio para que `npm ci` sea reproducible. Ningún scheduler está configurado, ningún Secret fue creado, ninguna credencial fue emitida y nada se desplegó ni se probó contra Staging en este cambio.

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
| Severidad de la alerta | `warning` con margen probado, `critical` sin él | ver abajo |

El proceso **se niega a arrancar** si el peor caso (intervalo con jitter máximo + todos los intentos agotando timeout + todos los backoffs) más el margen no entra en el TTL (`RENEWER_SCHEDULE_UNSAFE`), o si la alerta caería después del vencimiento (`RENEWER_ALERT_TOO_LATE`). Una cadencia que podría perder el vencimiento es un error de arranque, no un hueco silencioso en readiness.

### Severidad inicial

La severidad sale de una única implementación del margen de TTL (`src/schedule.mjs`), compartida con el validador del manifiesto — antes había tres copias de esa aritmética y ya habían divergido: la del validador ignoraba el tope del backoff, así que una configuración que el renovador rechazaba podía pasar la validación igual.

Un proceso que **nunca tuvo un ciclo exitoso** —un contenedor recién arrancado, un `--once` con archivo de estado nuevo— no sabe cuándo vence la atestación actual. Pudo arrancar un segundo después de una renovación o un segundo antes de un vencimiento, y desde adentro del proceso las dos cosas son iguales.

Antes eso quedaba en `warning` para siempre, lo cual invierte la relación entre evidencia y severidad. Ahora: con `expiresAt` conocido (de un éxito previo o provisto por el operador) hay número real y severidad proporcional; **sin ese ancla la alerta escala a `critical`**, porque no se puede demostrar ningún margen seguro. La atestación vence sola igual; esto sólo decide con cuánta fuerza el proceso lo dice.

### Idempotencia

La atestación es una única fila con `service` como clave primaria: renovar de más sólo refresca. El guard de "en vuelo" evita apilar requests sobre un signer lento; no protege la corrección, que ya está garantizada por el upsert.

### Fail-closed

No hay ningún camino en este código que extienda, falsifique o mantenga viva una atestación. Si el renovador muere, se cuelga, pierde red o es rechazado por el secreto, la atestación **vence sola** y `uploadReady` se cierra. Ese es el resultado correcto, no una caída a rodear.

Un 200 sólo se acepta si el cuerpo es la certificación propia del signer (`service: "signer"`, `evidence.signedUploadUrls` y `evidence.signedReadUrls` en true). Un 200 con otro cuerpo es `SIGNER_HEALTH_INVALID`: el deployment que contestó no es el signer que creemos.

### Privilegio

El renovador **no tiene credencial de servicio**. Lleva dos cosas, y no son la misma cosa:

| | Qué autoriza | Dónde | Secreto |
|---|---|---|---|
| Secreto de atestación | la acción `health` del signer, adentro de la función. Es lo único que autoriza *renovar*. | header `x-media-attestation-secret` | **sí** |
| Credencial del gateway | el gateway de Functions, antes de que la función corra. No prueba nada sobre quién puede renovar. | headers `apikey` y `Authorization` | no, es pública por diseño |

Comprometer este proceso no da lectura del bucket, ni de la cola, ni del mapa de identidad. Sólo permite pedirle al signer que se vuelva a probar a sí mismo — lo mismo que haría un operador a mano.

### Credencial del gateway

**Todas las Edge Functions del manifiesto se despliegan con `verify_jwt = true`.** Eso significa que el bearer tiene que ser un JWT que el gateway pueda verificar. Una `sb_publishable_…` **no es un JWT**: mandada como bearer, el gateway devuelve 401 antes de que el signer se entere, el renovador falla todos los ciclos y la atestación vence en horario mientras la alerta culpa al gateway. Por eso el arranque falla nombrando la regla en vez de descubrirlo una hora después.

Opciones aceptadas:

| Opción | Variables | Notas |
|---|---|---|
| JWT de identidad dedicado *(preferida)* | `TOURNAMENT_MEDIA_GATEWAY_JWT` | rol `anon` o `authenticated`; se rota y se revoca sin tocar ningún cliente del browser |
| Anon key legacy | `SUPABASE_ANON_KEY` | ya es un JWT, sirve como `apikey` y como bearer |
| Publishable + JWT | `SUPABASE_PUBLISHABLE_KEY` (apikey) + `TOURNAMENT_MEDIA_GATEWAY_JWT` (bearer) | la publishable viaja sólo como `apikey`; el bearer sigue teniendo que ser JWT |

Rechazadas siempre: `sb_secret_…`, un JWT con `role: service_role`, una `sb_publishable_…` usada como bearer, y cualquier string opaco como bearer.

Validación local (`inspectGatewayJwt`): tres segmentos base64url, `alg` presente y distinto de `none`, `typ` `JWT` si está, `role` en `anon`/`authenticated`, `exp` numérico y futuro, y `ref` coincidente con el proyecto autorizado. **La firma no se verifica** — el renovador no tiene la clave, y verificarla localmente sólo probaría que sabemos hacer nuestra propia cuenta; eso lo hace el gateway. Ningún error imprime, prefija ni compara el valor: nombra la variable y la regla.

Para diagnosticar la credencial contra Staging hay un probe de una sola vez, **preparado y no ejecutado**, con autorización explícita y plan de revocación: [probe de la credencial del gateway](tournament-media-signer-gateway-probe.md).

### Modo `--once`

`--once` no tiene memoria propia, así que su contador de fallas arrancaba en cero **en cada corrida**: un scheduler externo disparándolo cada 20 minutos podía fallar una semana entera emitiendo siempre `consecutiveFailures: 1`, sin alcanzar nunca el umbral y sin emitir jamás `renewal_alert`. La señal que el catálogo de observabilidad declara requerida era estructuralmente inalcanzable justo en la forma de despliegue que este runbook recomienda.

Hay exactamente dos formas soportadas de que la alerta sea real, y una no soportada:

1. **Con archivo de estado** *(recomendada)*. `TOURNAMENT_MEDIA_RENEW_STATE_FILE` con ruta absoluta. Sobreviven el contador, el último éxito y el flag de alerta; `renewal_alert` dispara en el umbral y un éxito posterior emite `renewal_recovered` y limpia el estado.
2. **Delegando en el orquestador.** Sin archivo de estado, exit 1 es "no renovó": se configura la alerta sobre N salidas no-cero consecutivas (`OnFailure=` de systemd, historial de fallas del CronJob de Kubernetes). En ese caso el renovador **no emite** la métrica de fallas consecutivas y el catálogo tiene que tomarla del orquestador. El proceso lo avisa al arrancar con el evento `once_without_state`.
3. **No soportada:** `--once` sin archivo de estado y sin regla en el orquestador. El contador se reinicia siempre, el umbral no se alcanza nunca, y el pipeline parece tranquilo mientras la atestación vence.

El archivo de estado:

- modo **0600**, creado y verificado; un modo más ancho es rechazo, no advertencia, y no se corrige solo — corregirlo borraría la evidencia de que alguien lo ensanchó;
- escritura **atómica**: temporal hermano, `fsync`, `rename`. Un crash a mitad de escritura deja el estado anterior, nunca medio estado;
- contenido: contador, último éxito, último código de falla y flag de alerta. **Ni secretos, ni cuerpos de respuesta, ni URLs**;
- corrupción (JSON inválido, esquema desconocido, campo inesperado, contador negativo) = **fail-closed**: el proceso se niega a arrancar. Un renovador que reinicia su contador ante un archivo corrupto es un renovador cuya alerta se suprime corrompiendo un archivo.

Y un **lock exclusivo** (`<state>.lock`, creado con `O_EXCL`) impide técnicamente dos renovadores simultáneos, en ambos modos. Un lock cuyo pid ya no existe **y** que además es más viejo que 15 minutos se toma; las dos condiciones, nunca una sola.

### Apagado

El sleep del intervalo es **interrumpible**. Antes el loop dormía sobre un `setTimeout` pelado y sólo re-chequeaba la bandera de parada cuando el timer vencía, así que un apagado durante el intervalo — el momento abrumadoramente más probable, porque ahí pasa casi todo su tiempo — esperaba el intervalo completo. La paciencia de cualquier orquestador es más corta que eso.

`SIGTERM` y `SIGINT` cancelan el sleep, cortan el loop, quitan los listeners y limpian los timers. El presupuesto es **menos de 5 segundos**, verificado con una señal real contra un proceso hijo en `test/shutdown.test.mjs`. El último log (`renewer_stopped`) pasa por el mismo redactor que todos los demás.

Sigue sin haber revocación al apagar: este proceso no es el signer y no habla por él.

### Higiene de secretos

El secreto viaja en un header, nunca en la URL ni en el cuerpo, así que no puede terminar en un access log. Todo log pasa por un redactor por valor que elimina el secreto incluso cuando llega adentro del mensaje de error de otra librería, y descarta claves como `authorization`, `apikey` y `headers` completas. Los errores de configuración nombran la variable y la regla, jamás el valor.

## Variables

Nombres, sin valores. Ninguna es un Secret creado en este cambio.

```
SUPABASE_URL                                     origen https desnudo del proyecto autorizado
TOURNAMENT_MEDIA_EXPECTED_API_HOST               el mismo host, dicho por segunda vez
TOURNAMENT_MEDIA_FORBIDDEN_API_HOSTS             opcional, lista separada por comas
TOURNAMENT_MEDIA_ATTESTATION_SECRET              secreto; ≥ 32 caracteres
TOURNAMENT_MEDIA_GATEWAY_JWT                     JWT de identidad dedicado (preferido)
TOURNAMENT_MEDIA_GATEWAY_KEY                     credencial pública del gateway
  (o SUPABASE_PUBLISHABLE_KEY / SUPABASE_ANON_KEY)
TOURNAMENT_MEDIA_RENEW_STATE_FILE                ruta absoluta del estado de --once (opcional)
TOURNAMENT_MEDIA_ATTESTATION_KNOWN_EXPIRES_AT    vencimiento conocido, ISO-8601 (opcional)
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
| `startup_refused` | configuración o estado inválidos; nombra la variable y la regla, nunca el valor |
| `once_without_state` | `--once` sin archivo de estado: el conteo de fallas queda delegado al exit code |
| `state_write_failed` | el estado no se pudo persistir; el ciclo ya ocurrió, la memoria entre corridas no |

`renewal_alert` alimenta la métrica `arma2_torneos_media_signer_attestation_renewal_failures_consecutive` del [catálogo de observabilidad](tournament-media-observability.md#attestation-renewal-failures).

## Incidentes

- **`SIGNER_SECRET_REJECTED` (403):** el secreto del renovador y el de la función divergieron. No se reintenta. Comparar en el secret store — nunca imprimirlos —, rotar si hay sospecha y reiniciar el renovador. Mientras tanto la atestación vence y Multimedia se cierra: es lo esperado.
- **`SIGNER_GATEWAY_REJECTED` (401):** el gateway rechazó el bearer. Antes de rotar nada, verificar que el bearer **sea un JWT**: con `verify_jwt = true` una `sb_publishable_…` da 401 siempre. Si es un JWT, venció o cambió: reemplazarlo desde el secret store. Nunca sustituirlo por una credencial de servicio. Para distinguir 401-de-gateway de 403-de-secreto sin adivinar, está el [probe](tournament-media-signer-gateway-probe.md), que requiere autorización explícita porque escribe una atestación.
- **`RENEWER_STATE_CORRUPT` / `RENEWER_STATE_PERMISSIONS` / `RENEWER_LOCK_HELD` (arranque):** el proceso se negó a arrancar. Corrupción: mirar el archivo antes de borrarlo, porque el contador que perdió es la evidencia de cuántos ciclos venían fallando. Permisos: averiguar quién lo ensanchó. Lock: hay otra instancia; no hay que "destrabarlo", hay que encontrarla.
- **`SIGNER_UNAVAILABLE` (5xx) o `SIGNER_TIMEOUT`:** el probe del signer falla contra Storage. Ir al bucket, no al renovador: `bucket_absent`, `bucket_public`, `upload_probe_failed` o `read_probe_failed` en los logs del signer. Revisar además `residual-probe-objects`.
- **`SIGNER_HEALTH_INVALID`:** contestó algo que no es el signer, o una versión del signer que ya no certifica lo mismo. Congelar, verificar el checksum desplegado contra el manifiesto y no forzar la renovación.
- **`SIGNER_NOT_FOUND` (404):** la función no está desplegada en el proyecto al que se apunta. Verificar `SUPABASE_URL` antes que cualquier otra cosa.
- **Renovador caído sin alerta:** la métrica de expiración (`attestation-expiry`) es la red de seguridad; cae aunque el renovador no emita nada, porque la lee la base.

Nunca "recuperar servicio" alargando el TTL, deshabilitando la verificación del cuerpo o corriendo el probe con un secreto de otro ambiente.

## Despliegue posterior (no ejecutado)

1. Crear el Secret del renovador en el secret store del host del worker de Staging, con el mismo valor que ya usa la Edge Function.
2. Agregar el servicio al compose/unidad del worker con `restart: unless-stopped`, CPU y memoria mínimas, filesystem read-only y sin acceso a la red salvo el host autorizado.
3. Elegir cómo alerta `--once`: crear el archivo de estado 0600 en un volumen persistente, o configurar la regla de exit code en el orquestador. No dejar ninguna de las dos.
4. Arrancar en modo `--once` a mano una vez y verificar `renewal_succeeded` y que `signerAttestationExpiresInSeconds` sube a ~3600.
5. Habilitar el modo loop (o el timer) y observar dos renovaciones consecutivas con jitter distinto.
6. Provocar una falla (bloquear egress 5 minutos) y verificar `renewal_alert` con severidad correcta y `renewal_recovered` al restaurar.
7. Verificar el apagado: `SIGTERM` durante el intervalo debe terminar en menos de 5 s.
8. Recién entonces contar la señal como desplegada en el catálogo de observabilidad — que además exige que exista el colector `runtime`, hoy inexistente.

## Rollback

Detener el servicio. No hay estado que revertir: la atestación vence sola dentro de 3600 s y `uploadReady` se cierra. Si hace falta cerrar antes, revocar la atestación del signer por el flujo aprobado de revocación y bajar el flag Multimedia. El renovador no participa en la revocación.
