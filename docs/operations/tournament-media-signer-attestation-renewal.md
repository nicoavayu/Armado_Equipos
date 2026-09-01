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

### Destino: sin redirects, revalidado en cada request

`fetch` sigue redirects por default, y en un 307/308 reenvía método, cuerpo **y headers**. Un host del signer que contestara `301 Location: https://evil/` se habría llevado el secreto de atestación, y nada en el código anterior lo habría notado: el renovador sólo habría registrado un status confuso.

La corrección es estructural, no vigilante (`src/target.mjs`):

- **`redirect: 'error'`**, puesto después del spread para que ningún llamador pueda pisarlo. El runtime rechaza el redirect **antes de abrir conexión** con el segundo host, así que el secreto nunca se serializa hacia él. `test/redirect.test.mjs` lo prueba con dos servidores HTTP reales: el servidor destino está vivo, dispuesto y registra todo lo que recibe — y recibe **nada**. Cubre 301, 302, 307 y 308, y también una cadena de redirects (no se sigue ni el primer salto).
- **`response.redirected === true` y cualquier status 3xx resuelto** también se rechazan, porque un llamador puede inyectar `fetchImpl` y esa implementación podría seguir el redirect por su cuenta.
- **La URL se revalida contra un descriptor congelado inmediatamente antes de cada request**: protocolo, host, origen (que atrapa un puerto cambiado), path exacto de la función, ausencia de userinfo/query/fragment, y project ref. Validar sólo al arrancar no alcanza: la URL es un string, los strings se concatenan, y el chequeo que importa es el que corre en el momento de la llamada.
- **Producción sigue bloqueada** por ref y por host, en el descriptor y otra vez en cada request. El bloqueo ya no depende del entorno: vive compilado en `src/forbidden-targets.mjs` (ver abajo), y tanto el renovador como el probe lo consumen desde ahí.
- Un redirect es `SIGNER_REDIRECTED` y **no se reintenta**: es configuración o compromiso, nunca algo transitorio, y reintentar sólo volvería a ofrecer las credenciales.

`https` es obligatorio, con una única excepción: un literal de loopback (`127.0.0.1`, `::1`), que es lo que permite que los tests de redirect corran contra servidores reales sin que un paquete salga de la máquina. No es un flag ni una rama de test: un literal de loopback no puede alcanzar Producción ni exfiltrar a ningún lado. `config.mjs` exige `https` para el destino real de todos modos.

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

Códigos de salida:

| Salida | Significado |
|---:|---|
| 0 | renovó |
| 1 | no renovó (falla real del signer, del gateway o de la configuración) |
| 0 | **apagado pedido** (`SIGTERM`/`SIGINT`) antes de completar el ciclo |

El tercer caso es deliberado y es nuevo. Un apagado no es evidencia sobre el signer: si saliera 1, cada rolling restart contaría como falla en la regla del orquestador (opción 2) y fabricaría exactamente la alerta que el contador existe para hacer confiable. Tampoco cuenta como éxito — `consecutiveFailures` queda intacto y `lastSuccessAt` no se toca — así que no enmascara nada: la atestación sigue venciendo sola, que es el camino fail-closed de siempre. El evento `renewal_interrupted` lo deja registrado.

El detalle del archivo de estado y del lock está más abajo, en sus propias secciones.

### Archivo de estado

El archivo es una frontera de confianza, no un scratch file. `src/state-store.mjs`:

- **Nunca sigue un symlink.** Todo `open` lleva `O_NOFOLLOW` y todo chequeo es un `fstat` del descriptor efectivamente abierto, no un `stat` de una ruta que podría cambiarse entre el chequeo y la lectura. `nlink` tiene que ser exactamente 1, para que un hard link no le dé un segundo nombre al archivo recién validado.
- **El archivo y su directorio tienen que ser de este usuario**, y el directorio no puede ser escribible por grupo ni por otros: si lo fuera, cualquiera puede renombrar un archivo propio encima del estado, y ningún permiso sobre el archivo original lo impediría.
- **Tope de tamaño antes de leer**, así un archivo que se convirtió en otra cosa se rechaza en vez de parsearse.
- **Escrituras atómicas**: temporal con nombre aleatorio criptográfico (`crypto.randomBytes(12)`, no el pid, que es predecible), `fsync`, `rename`, y después **`fsync` del directorio** para que el rename también sobreviva a un corte. El temporal se borra en **todos** los caminos de error.
- **Tipos exactos en los dos sentidos.** `writeState` valida cada campo *antes* de tocar el disco, así un valor inválido no puede llegar a ser un archivo corrupto que la corrida siguiente tenga que rechazar. El modo 0600 se confirma **después** del rename, sobre el descriptor.
- **No persiste secretos, headers ni cuerpos HTTP**: la lista de campos permitidos es cerrada y se aplica en las dos direcciones.

### Lock

Un **lock exclusivo** (`<state>.lock`) impide dos renovadores simultáneos, en ambos modos. Dos correcciones sobre el diseño anterior:

- **Un pid no es una identidad.** Los pids se reusan, y después de un reboot se reusan desde el principio. El registro lleva además `host`, `bootEpochSeconds`, `startedAtEpochMs` y un `nonce` aleatorio. Un lock de otro boot es stale aunque su pid esté vivo ahora (no puede ser el mismo proceso); un lock de otro host **nunca** se toma, porque desde acá no se puede preguntar si ese pid vive.
- **`rm` seguido de `create` no es un takeover.** Dos procesos que veían el mismo lock stale podían intercalarse como `A: rm → A: create (A lo tiene) → B: rm (borra el lock VIVO de A) → B: create`, y los dos seguían. Ahora el takeover es: escribir un temporal con nuestra identidad, `rename()` atómico encima del lock, esperar una ventana de asentamiento y **releer el nonce**. Como el rename es atómico sobrevive el contenido de exactamente un competidor; el resto lee un nonce ajeno y se niega. Un solo ganador, determinista — verificado con **dos `child_process` reales** compitiendo en `test/lock-concurrency.test.mjs`.

Un lock cuyo pid sigue vivo no se desplaza jamás, por viejo que sea — lo que incluye a un proceso **pausado** (`SIGSTOP`), que responde igual que uno vivo porque lo está: se va a despertar creyendo que todavía es el dueño. Hay un test con un hijo real detenido con `SIGSTOP`.

Un reloj que retrocede tampoco vuelve inseguro al lock: un lock con fecha futura se lee como "no puedo saber" y se rechaza, nunca como "viejísimo". Y `release()` sólo borra un lock que **todavía lleva nuestro nonce**.

### Apagado

Un renovador puede estar bloqueado en exactamente cuatro lugares: un request en vuelo, el timeout de ese request, un backoff entre reintentos, o el sleep largo entre ciclos. Antes cada uno tenía un mecanismo distinto de cancelación y **sólo el último funcionaba**: un `SIGTERM` durante un request colgado esperaba el timeout completo, y uno durante un backoff esperaba el backoff y después arrancaba el intento siguiente.

Ahora hay un solo `createShutdown()` que alcanza los cuatro: cancela el sleep compartido (intervalo y backoff usan el mismo) y aborta el `AbortSignal` compartido (el fetch y su timeout se combinan sobre él con `AbortSignal.any`). Además:

- **`--once` también instala los handlers.** Antes no instalaba ninguno, así que un `SIGTERM` durante su único ciclo mataba el proceso con el estado sin escribir y el lock en disco — y la corrida siguiente se negaba a arrancar citando un lock de un pid inexistente. Un ciclo corto no es un ciclo ininterrumpible.
- **No se arranca ningún intento nuevo** una vez pedido el apagado.
- **El estado se persiste y el lock se libera** en todos los caminos, incluido el interrumpido.
- **Timeout y apagado se mantienen distinguibles**: `SIGNER_TIMEOUT` es una falla que se reintenta y cuenta para la alerta; `SIGNER_SHUTDOWN` no es ninguna de las dos cosas y no toca el contador de fallas consecutivas — si no, un rolling restart fabricaría la alerta que el contador existe para hacer confiable.

El presupuesto es **menos de 5 segundos**, verificado enviando `SIGTERM`/`SIGINT` reales al `src/cli.mjs` real — no a una copia inline del loop — bloqueado en cada uno de los cuatro puntos y también en medio del `rename` del archivo de estado (`test/shutdown-process.test.mjs`). El último log (`renewer_stopped`, con `stoppedBy`) pasa por el mismo redactor que todos los demás.

Sigue sin haber revocación al apagar: este proceso no es el signer y no habla por él.

### Runtime de Node

`engines` declara `>=20.6.0 <27`, y `package-lock.json` lo repite para que `npm ci` no pueda discrepar. Pero `engines` es **advisory**: npm avisa e instala igual, y nadie lo consulta cuando el contenedor simplemente corre `node src/cli.mjs`. Por eso el arranque verifica las capacidades **por nombre** (`AbortSignal.any`, `AbortSignal.timeout`, `fetch`, `crypto.randomUUID`, `performance.timeOrigin`) y se niega con `RENEWER_RUNTIME_UNSUPPORTED` nombrando la que falta.

Comportamiento fuera del rango declarado:

| Versión | Qué pasa |
|---|---|
| < 20.6 | rechazo en el arranque, nombrando la capacidad faltante. Sin ella el fallo sería silencioso y tardío: la config validaría, el loop arrancaría, y el **primer apagado** sería lo que no funciona |
| 20.6 – 26.x | soportado |
| ≥ 27 | no verificado. `engines` lo deja fuera de rango para que el package manager avise; nada impide que corra y lo más probable es que ande, pero ninguna suite de este repositorio se corrió contra esa versión |

### Higiene de secretos

El secreto viaja en un header, nunca en la URL ni en el cuerpo, así que no puede terminar en un access log. Todo log pasa por un redactor por valor que elimina el secreto incluso cuando llega adentro del mensaje de error de otra librería, y descarta claves como `authorization`, `apikey` y `headers` completas. Los errores de configuración nombran la variable y la regla, jamás el valor.

## Variables

Nombres, sin valores. Ninguna es un Secret creado en este cambio.

```
SUPABASE_URL                                     origen https desnudo del proyecto autorizado
TOURNAMENT_MEDIA_EXPECTED_API_HOST               el mismo host, dicho por segunda vez
TOURNAMENT_MEDIA_FORBIDDEN_API_HOSTS             opcional, lista separada por comas; SÓLO AGREGA
TOURNAMENT_MEDIA_FORBIDDEN_PROJECT_REFS          opcional, lista separada por comas; SÓLO AGREGA
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

### El bloqueo de Producción no es configuración

Declarar el host dos veces atrapa el error de tipeo, pero **coincidir no es autorizar**: dos copias del mismo host equivocado siguen nombrando Producción. Antes, el bloqueo vivía entero en dos variables de entorno, así que un despliegue que simplemente nunca las exportó aceptaba una URL de Producción sin objetar nada.

Ahora la política es **código compilado**, en `workers/tournament-media-signer-renewer/src/forbidden-targets.mjs`:

```
PRODUCTION_PROJECT_REF   rcyuuoaqfwcembdajcss
PRODUCTION_API_HOST      rcyuuoaqfwcembdajcss.supabase.co
```

Las reglas:

- **El entorno sólo puede agregar.** `resolveForbiddenApiHosts` y `resolveForbiddenProjectRefs` devuelven siempre las entradas compiladas más lo que aporte el entorno. No existe entrada — ausente, vacía, con espacios, sólo comas, o una lista que omita Producción a propósito — que achique el resultado. *Desprohibir* no es una operación que el módulo ofrezca.
- **Una sola fuente para los dos llamadores.** `createTarget` unifica la política compilada en todo descriptor que emite, así que el renovador y el probe la heredan sin tener que acordarse de pedirla. El probe además suma los refs del manifiesto: son un agregado sobre la política, no lo que la sostiene.
- **Vive dentro del paquete del renovador.** No lee `ops/**` ni `docs/**`: una política que se degrada en silencio cuando falta un archivo no es una política. El manifiesto sigue siendo la declaración humana del mismo hecho, y un test contractual (`test/forbidden-targets.test.mjs`) rompe el Quality Gate ante cualquier divergencia entre los dos.
- **Se bloquea por ref y por host**, sobre la URL *y* sobre `TOURNAMENT_MEDIA_EXPECTED_API_HOST`, en el arranque y otra vez en cada request.
- **Dominios custom** siguen aceptándose bajo el contrato de siempre, pero nunca con el ref prohibido: ni como primera etiqueta del host (`<ref-prohibido>.dominio.custom`), ni declarado por el claim `ref` del JWT del gateway (`RENEWER_GATEWAY_JWT_PROJECT_FORBIDDEN`) — que es como un dominio custom podría estar tapando Producción sin que el host lo diga.
- **Los errores siguen saneados**: nombran la variable y la regla, nunca el valor, y no imprimen URLs completas.

Staging (`hhyvmhgpapyuzjgxfnqv`) sigue aceptándose sin ninguna variable extra.

## Quality Gate

Las suites llegan a CI por **un solo punto de entrada**, `npm run test:ci`, para que el workflow y `package.json` no puedan divergir. Agregar una suite como paso del YAML en lugar de agregarla al script es exactamente el error que dejó 104 tests del renovador pasando sin que CI los corriera nunca.

```
npm run migrations:guard    guarda del origen de las migraciones
npm run test:db             suite de integración PostgreSQL
npm run test:db:security    grants de RPC + parser del Security Advisor
npm run lint                ESLint sobre src/
npm run build               build de producción
npm run test:ci             = test:staging:guard
                            + test:worker:signer-renewer
                            + la suite Jest
```

`test:staging:guard` cubre el contrato de CI, la guarda de staging, los contratos de ejecución A1/A2, los contratos de conexión psql (TLS y loopback), el inspector read-only, readiness, observabilidad, el probe del signer gateway, el contrato de rollback, el escaneo estático de credenciales sobre todo el repositorio y el procedimiento de storage multimedia. `test:worker:signer-renewer` cubre config, la política compilada de destinos prohibidos, schedule, redirects, state store, lock, apagado y CLI. `torneos:staging:validate` queda cubierto por construcción: todos sus tests están también en `test:staging:guard`, y esa contención se afirma en el test contractual.

`scripts/ci/quality-gate-contract.test.mjs` afirma este arreglo — y corre dentro de `test:ci`, así que no se puede saltear sin saltear también todo lo que protege. Ningún paso puede ser opcional: sin `continue-on-error`, sin `|| true`, sin `if:`.

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
| `shutdown_requested` | llegó `SIGTERM`/`SIGINT`; se emite exactamente una vez |
| `renewal_interrupted` | el ciclo terminó por apagado, no por una falla del signer; **no** toca el contador de fallas |
| `renewer_stopped` | fin del loop, con `stoppedBy` (`SIGTERM`, `SIGINT` o `loop_condition`) |

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
