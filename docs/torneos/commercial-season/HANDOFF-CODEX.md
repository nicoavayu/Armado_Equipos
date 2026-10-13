# Handoff a Codex: temporada comercial, galería y Mercado Pago

**Actualizado:** 2026-10-13 · rama `claude/torneos-season-commercial-gallery` · head del commit que trae este archivo (ver `git log -1`).
**No hay notificación directa a Codex:** este archivo y la sesión de Claude «Arma2 Torneos como producto conectado» son el canal.
## Estado al 2026-10-13 (tarde)

**P10 contra el sandbox real de Mercado Pago: `P10_PASS`** sobre 45ea110a (ver «P10: resultado»).
- La publicación y la recuperación están preparadas en **`PUBLICACION.md`**.
- Nada se aplicó ni se publicó en Producción.
- Siguen apagados el checkout (0013 no está), la purga (el runner ni siquiera está) y el billing de la web. El cron de Core está intacto.

**Candidato y CI.** El código candidato es **f9d07306**.
- GitHub Prelaunch Quality Gate, run 38439053631: **success**.
- Los commits posteriores sólo tocan docs; el run de cada uno figura en los checks del PR.

**#203:** COMPLETO.
- Gateway `00027-huz`; web `54036f59` / `main.f17ee18f.js`; función `1290d3c3`.
- Son los puntos de vuelta de #204.

**Stores (consolas, 2026-10-13):**
- iOS y Android publicados en 1.1.21 (41), sin Torneos.
- Android 1.1.22 (43) sólo en prueba interna; no se promueve.

**Próximo GO exacto:** GO 1, merge + código de #204 (web → función → gateway), en `PUBLICACION.md` «GO concreto para #204».
- No incluye migraciones, cobros ni purga.

**Cambio después de P10.** Revisando la compatibilidad de la publicación, encontré que la web de #204 sobre una base sin 0018 no podía completar temporadas: PGRST202 por `p_confirm_media_deletion`.
- `updateSeason` ahora reintenta una vez sin el parámetro, y sólo ante PGRST202.
- `torneosSeasonCompleteCompat.test.js` 4/4; Jest 3726/3726; foundation 109/109; B04 regenerado.
- Ese cambio es sólo de la web y no toca nada de lo que P10 ejercitó.

## Seguimiento de la revisión de Codex (b8c1f0f7)

| # | Hallazgo | Corrección | Prueba (Postgres real salvo aclaración) |
|---|---|---|---|
| P1-a | Subida contra cierre: se chequeaba que la temporada estuviera abierta sin tomar lock, y el cierre tomaba `FOR UPDATE` | `enforce_tournament_media_gallery_limit` toma la temporada con `FOR SHARE` antes del chequeo. Orden de locks: temporada → advisory. | `season-lifecycle-db` F1, dos conexiones con barreras en los dos órdenes. **Corregido y probado** (65c4ec6c). |
| P1-b | Temporadas que ya estaban cerradas al migrar: se iban a borrar enseguida | `media_deadline_at` pasa a ser **el momento del borrado**. Las cerradas antes de 0018 reciben 6 meses: siguen cerradas a subidas, legibles y descargables hasta la fecha, y reciben los avisos. El marcado depende sólo de la fecha. | P1: el primer job después de migrar no las toca; archivarlas tampoco; a la fecha se borran; los logos quedan. **Corregido y probado** (65c4ec6c). |
| P2-a | La purga en `store.ts` borraba sólo los nombres válidos de una foto y la confirmaba entera | Todo o nada por foto: un nombre fuera de patrón rechaza la foto completa. La respuesta incluye `errors: [{assetId, code}]` (`INVALID_NAME` / `UNAVAILABLE`). | `media-store` (stubs): variante fuera de patrón, y caída del proveedor seguida de reintento. **Corregido y probado** (65c4ec6c). |
| P2-b | La prueba `requestUpload(...).sessionId \|\| true` pasaba siempre | Verifica que el id sea un uuid y que la fila exista en estado `issued`. | **Corregido** (65c4ec6c). |

## Lo que encontraron los ensayos (no estaba en la lectura)

| Hallazgo | Corrección | Prueba |
|---|---|---|
| La política de estado de 0013 devolvía `approved` sin `requiresManualRefund` para un pago tardío | 0019 fija y reemplaza `unordered_production_tournament_payment_status` → `approved_season_closed`, `requiresManualRefund: true`. | `commerce-production-db` |
| La política de reversión de 0013 ignoraba la devolución de un pago tardío: nunca quedaba `refunded` y Mi plan no la mostraba | 0019 reemplaza `unordered_production_tournament_payment_reversal`: la devolución lo cierra como `refunded` una sola vez; un contracargo no cambia el estado y pide revisión manual. | ídem |
| **Una oferta comprada no se puede modificar** (`protect_referenced_tournament_offer`). Cerrar la v1 al aplicar, o la v2 al deshacer, abortaba 0019 o su vuelta atrás en cualquier base con compras. | 0019 **inserta** una versión nueva de 20000 que gana por ser la más reciente; la vuelta atrás inserta otra con 49900/39900. Ninguna oferta se modifica. Las condiciones validan la oferta vigente. | `commerce-production-db` dos veces seguidas sobre el mismo laboratorio, la segunda con compras |
| El runner firmaba el texto `json` (`{"limit" : 7}`), pero pg_net envía el texto `jsonb` (`{"limit": 7}`) | Ahora se firma el texto `jsonb`. | `season-cron`: el request real de pg_net, aceptado por el handler real |

## Pedidos especiales de Codex

- **Runner real.** `backend/torneos/season-lifecycle/scheduler/season-lifecycle-cron.sql`, con su propio GO, aplicado después de 0018, y su vuelta atrás.
  - Usa pg_cron y pg_net con secretos en Vault.
  - Corre en minutos desplazados (3-59/15 y 8-59/15): es aislamiento, **no** una causa demostrada de los 503 de Core. El cron de Core no se toca.
  - Probado con las extensiones reales de la imagen, que son las del alojado: pg_cron 1.6.4, pg_net 0.20.3 y supabase_vault 0.3.1.
- **Cierre concurrente con checkout y aprobación** (`commerce-production-db`, barreras):
  - un cierre con lock hace esperar a la aprobación, que termina en `approved_season_closed` sin Premium;
  - una aprobación con lock hace esperar al cierre: el pago se otorga y después la temporada se completa;
  - un cierre con lock hace esperar al checkout, que termina en `TORNEOS_SEASON_NOT_PURCHASABLE`.
- **Devoluciones, contracargos y pagos dobles.**
  - Las pruebas de 0013 siguen pasando sobre 0019: devolución, contracargo en sus tres resultados, pago doble, otro pago, aprobación tardía después de cerrar la compra y conciliación con lease y throttle.
  - Se suman: pago tardío → devolución → `refunded` idempotente; contracargo sobre un pago tardío → revisión manual.
- **Vuelta atrás segura.**
  - Orden: 0019 → 0013 → 0018.
  - Para deshacer 0013 primero hay que quitar el login de pagos (`db-0013.mjs drop-login`).
  - El driver de 0013 aplica sólo desde `PRE_0013`, así que nunca reaplica sobre 0019.
  - La vuelta atrás de 0018 no recupera fotos ya purgadas, y lo dice.
- **Firma del webhook.** `webhook-signature-sdk.test.mjs` compara nuestra validación contra el algoritmo del SDK oficial que indicaste.
  - Mismo veredicto en notificaciones de pago y nunca más laxa.
  - Más estricta a propósito, en cuatro casos documentados: `data.id` no numérico (no es un pago), sin `x-request-id`, `ts` duplicado y `ts` que no tiene 10 ni 13 dígitos.
  - Alcance: sólo el tópico payment.

## CI de GitHub: pg_net en Linux (run 38344642171)

- **Síntoma:** `season-cron.test.mjs:65`, «pg_net delivered exactly one request», con 0 requests en 10 s. En la Mac pasaba.
- **Causa observada, no supuesta:**
  - En un motor Docker de Linux, `host.docker.internal` no existe; Docker Desktop lo resuelve por su cuenta.
  - pg_net registra entonces `error_msg = "Couldn't resolve host name"` en `net._http_response`. Lo reproduje en el laboratorio con un nombre que no resuelve.
- **Corrección:** `pg-lab.mjs` crea el contenedor de la base con `--add-host host.docker.internal:host-gateway`, que es lo mismo que Docker Desktop hace solo.
- **Diagnóstico observable en la prueba:**
  - Antes de enviar, verifica que el nombre resuelva dentro del contenedor (`getent hosts`).
  - Espera la fila de `net._http_response` y pone en el mensaje de falla `status_code`, `timed_out` y `error_msg`.
  - La aserción no se relajó: sigue exigiendo exactamente un request, y ahora además el 204 que registró pg_net.
- **Evidencia local:** `season-all-add-host-20261013T0434Z.txt` (25/25, con `HostConfig.ExtraHosts = [host.docker.internal:host-gateway]`).
- **Otro diagnóstico local, de paso.**
  - `docker network create` fallaba en silencio, y después aparecía como «network … not found». En esta Mac el motivo era «all predefined address pools have been fully subnetted»: hay 33 redes de otros laboratorios.
  - pg-lab ahora corta con ese mensaje exacto.
  - Liberé sólo laboratorios desechables míos (sufijo `ac9f037b`). No toqué los de otras sesiones.
- **GitHub (Prelaunch Quality Gate, job quality):**
  - run 38347155143 sobre 500bb4c8 (el arreglo): **success**; en Linux, `ok 7 - the purge request pg_net sends is accepted…`;
  - run 38347786097 sobre 6539b2be (+ P10 offline): **success**;
  - run 38348305188 sobre cf2250fd (+ diagnóstico de red): **success**.
  - Este commit sólo toca docs; su run es el del head final.

## Evidencia (archivos `.txt` en `docs/torneos/commercial-season/evidence/`; `*.log` está en .gitignore, por eso antes no estaban en la rama)

| Suite | Resultado | Laboratorio |
|---|---|---|
| `test:torneos:season` (lifecycle 16 + orden de Producción 1 + runner 3 + driver 5 + P10 offline 6) | **31/31** local | `arma2-season-lab-db-*` (0000→0017, con 0018 y 0019 aplicados y revertidos por las pruebas) |
| `test:torneos:commerce-production` (incluye DB, gateway, driver y vuelta atrás de 0013, orden de migraciones, privilegios y vectores del SDK) | **95/95** local, con `--add-host` | `arma2-commerce-season-db-*` (0000→0019) |
| `media-store` / `media` / `branding` | 21/21 · 36/36 · 18/18 | sin base |
| Jest / frontend-foundation | 3722/3722 · 109/109 | — |

## Hecho después de la revisión

- **Driver de operador** `backend/torneos/season-lifecycle/remote/db-season.mjs`.
  - Modos:
    - observe;
    - apply/rollback de 0018, 0019 y el runner;
    - `enable-purge`/`disable-purge`, el interruptor del borrado real (ver la revisión de operadores abajo);
    - `budget` (A3).
  - Cada escritura exige frase, sha256, estado por eje y orden entre ejes, y que nada fuera de lo suyo se mueva.
  - Ensayado en el laboratorio a través del mismo `run()`. `test:torneos:season` **32/32**.
- **PR borrador** [#204](https://github.com/nicoavayu/Armado_Equipos/pull/204), con CI en GitHub.

## P10: resultado (sandbox real, 2026-10-13 16:49–17:17Z, autorizado por Nico)

**Veredicto:** `P10_PASS`, `certifies: true`, 18/18 chequeos. Corrieron A, B, C y D, sin pendientes ni pasos no realizados.
- Lab 0000→0019 (20 migraciones).
- Oferta en vigor: 20.000 / 20.000, «Precio de lanzamiento».

**Por caso:**
- **A:** temporada abierta, APRO → `approved` + `verified`, Premium sólo en esa temporada, un grant.
- **B:** OTHE → la compra sigue abierta y en FREE. CONT sobre el mismo link → `pending`, sigue FREE (2 pagos).
- **C:** temporada cerrada antes de pagar, APRO → `approved` + `season_closed`, `requires_manual_refund`, FREE y sin grant.
  - La devolución en el panel del vendedor de prueba llegó como **`refunded`**.
  - Un evento de pago tardío y uno de devolución.
- **D:** MP **permitió** un segundo pago sobre la Preference de A. La búsqueda lo vio y quedó en `requires_manual_refund`, con un solo grant y Premium.

**Hechos que sólo MP real podía mostrar (`realProviderFacts`):**
- MP aceptó las tres Preferences con 201.
- Guardó las back_urls en `https://torneos-payments-test.nicoavayu.deno.net` y la `notification_url` de laboratorio (`payments.unit.invalid`), con `auto_return: approved`. No hizo falta el reenvío al sink.
- La atestación del vendedor de prueba (`test_user`, MLA, dueño del token) pasó una vez.
- El fetcher hizo sólo lecturas y 3 POST de Preference; ninguna devolución por API.

**Evidencia** (copiada desde `~/Arma2Backups/p10-evidence/`; revisada: sin token, mails ni datos personales, sólo ids de cuentas, Preferences y pagos de prueba):
- `evidence/p10-sandbox-20261013T164947Z.txt` (sha256 `fa4d5003…`);
- `evidence/p10-20261013T164940Z-transcript.txt` (`452b6d29…`).

## P10: preparación (referencia)

**Piezas:**
- **Guía para Nico:** `P10-GUIA.md`, en esta carpeta.
- **Launcher:** `~/Arma2Backups/p10-run.sh`, fuera del repo.
- **Wrapper:** `backend/torneos/season-lifecycle/p10/p10-sandbox.mjs`.

### Launcher

- Corre desde un checkout propio y limpio, `~/Downloads/arma2/arma2-p10`, fijado al head exacto que figura en el script. No usa el checkout raíz de Nico (está en release 1.1.13 con cambios).
- **Antes de pedir nada, comprueba:**
  - el head y que no haya cambios locales;
  - Node 20 o más;
  - que `node_modules` corresponda al `package-lock` de ese head (marca `node_modules/.p10-lock-sha256`, escrita al instalar);
  - que Docker responda;
  - que haya lugar para la red del laboratorio. Crea y borra una red de prueba propia, y **no toca laboratorios ajenos**: si no hay lugar, para y lo dice;
  - que `api.mercadopago.com` responda: sin token contesta 401, o 403 de su PolicyAgent (lo observado hoy);
  - que el host de vuelta conteste 404.
- `p10-run.sh check` hace sólo esas comprobaciones.
- **`p10-run.sh ensayo`** recorre en la terminal el mismo flujo de Nico contra el emulador: sin token ni MP. Termina en `ENSAYO_OK`, y la evidencia dice `certifies: false`.
  - Lo corrí bajo una pseudo-terminal (Enter en cada paso, salida por `tee` como en el launcher).
  - Así apareció un defecto que ya está corregido: con un stream de `/dev/tty` por pregunta, la lectura pendiente del stream cerrado se tragaba la línea siguiente. Ahora hay un único `tty.ReadStream` para toda la corrida.
- **Reserva de red:** la red del laboratorio P10 (`arma2-season-p10-db-514d86ac-net`) quedó creada para que Docker no se quede sin lugar antes de mañana. El launcher la reconoce y no crea otra.
- **El token:** se lee sin eco desde `/dev/tty` y se limpia el pegado con corchetes, como en la sesión TEST certificada. Va por stdin, nunca por argv, env ni archivo.
- **Antes de crear el laboratorio:**
  - el wrapper exige que la cuenta tenga el tag `test_user`, que sea de MLA y que su id coincida con el último segmento del token;
  - muestra nombre e id del vendedor de prueba para que Nico lo compare con la ventana del vendedor, y espera su Enter.
- **Evidencia:** queda en `~/Arma2Backups/p10-evidence/` (JSON y transcript, sin token), así el checkout sigue limpio. Después se copia a la rama.

### Qué corre y dónde

- **Base:** laboratorio local nuevo con 0000→0019.
- **Runtime:** el handler real `torneos-payments-production`.
- **Proveedor:** la API real de MP con las «Credenciales de prueba» de la app, que pertenecen al vendedor de prueba creado automáticamente (igual que en la certificación TEST del 2026-09-26).
- **Estado:** entra por la ruta de refresco del comprador (`purchase-reconcile` → `/v1/payments/search`).
- **Fetcher:** sólo `https://api.mercadopago.com`, y sólo las llamadas del runtime: GET y el POST de la Preference. No crea devoluciones ni pagos.

### URLs de la Preference (evaluadas a pedido de Codex)

**back_urls.**
- El runtime, en forma de laboratorio, exige hosts `*.invalid` (`config.ts`, «lab shape»): así nunca manda un comprador a un lugar real.
- Para el comprador, la Preference que recibe MP lleva **las mismas rutas** sobre `https://torneos-payments-test.nicoavayu.deno.net`. Es el host TEST ya certificado y ya usado como base de back_urls el 2026-09-26 (`APP_PUBLIC_URL` del contrato TEST).
- Su router responde 404 a cualquier ruta que no sea una de sus dos (lo verifiqué en el código y con un GET). Por eso no hay frontend, ni lectura de base, ni nada de Producción.
- **Se descartaron dos alternativas:**
  - `www.arma2.com.ar`: redirige `/torneos/*` a `torneos.arma2.com.ar`, la web de Producción;
  - `app.arma2.com.ar`: es la web de Producción.
- El armado de la ruta lo fijan las pruebas unitarias del runtime.

**notification_url.** No es necesaria para P10, porque el estado entra por la conciliación.
- Queda el valor de laboratorio del runtime (`*.invalid`): no genera tráfico a ningún lado y es coherente con la forma de laboratorio.
- **Nunca se omite.** Sin ese campo, MP podría usar el webhook configurado en la app, que es la app TEST certificada, conectada a la base de Producción.
- Sólo si MP rechaza la Preference **por ese campo**, se reenvía una vez con `…deno.net/p10/notification-sink`. Es una ruta 404 del mismo host, donde nada escucha. Va con otra clave de idempotencia y la evidencia lo registra (`notificationUrl: "sink"`, `refusedFirst`).

**Riesgo residual (documentado, sin evidencia de que ocurra).** Si MP mandara además la notificación al webhook de la app, la app TEST leería el pago y buscaría `get_provider_tournament_purchase` con una referencia de laboratorio que no existe en Producción. Termina en 404 `purchase_not_found`: una lectura, sin escritura.

### Qué está validado offline y qué sólo con MP real

**Validado offline:** `p10-sandbox.test.mjs` **6/6** (más el ensayo bajo una pseudo-terminal), el mismo `runP10()` con el emulador en la forma del sandbox.
- Los cuatro casos de punta a punta sobre 0000→0019 y el runtime real.
- Un vendedor real, o un token de otra cuenta, se rechaza antes de crear el laboratorio.
- El fetcher bloquea devoluciones, pagos y otros orígenes.
- Las back_urls salen hacia el host TEST con las rutas del runtime.
- El reenvío por `notification_url` funciona como se describió.
- Un caso fallido no frena a los demás.
- Un paso que MP no permitió deja el caso pendiente, no aprobado.

**Sólo con MP real** (la evidencia lo marca: `realProviderFacts`; en una corrida con emulador dice «not established»):
- que MP **acepte la Preference** con esas back_urls y esa `notification_url`. Queda registrado por Preference: estado HTTP, si se aceptó, y lo que MP guardó (`stored`);
- los nombres reales de estado para OTHE y CONT;
- que la búsqueda refleje cada pago, y con qué demora;
- que se pueda pagar dos veces la misma Preference (caso D);
- que la devolución del panel llegue como `refunded`;
- que `live_mode` siga siendo `true` en el sandbox.

### Veredicto

- `P10_PASS` **sólo** si corrieron y pasaron A, B, C y D.
- Una corrida de un subconjunto, o con un caso que MP no permitió, es `P10_PARTIAL` y nombra los pendientes. **No certifica P10.**
- Cualquier chequeo fallido es `P10_FAIL`.

### Casos

- **A.** Temporada abierta, APRO.
  - Monto 20.000 tomado de la oferta vigente.
  - `approved` + `verified`; Premium sólo en esa temporada; un único grant.
- **B.** OTHE y después CONT, sobre el mismo link.
  - La compra sigue abierta y en FREE; el pendiente no otorga nada.
- **C.** Temporada cerrada antes de pagar, APRO.
  - `approved` + `season_closed`, `requires_manual_refund`, FREE y sin grant.
  - Después Nico devuelve en el panel: `refunded` una sola vez, sigue FREE; un evento de pago tardío y uno de devolución.
- **D.** Segundo APRO sobre el link de A.
  - `requires_manual_refund`; sigue habiendo un solo grant y Premium.

### Paso humano (Nico; nada por chat)

`P10-GUIA.md`: unos 20 minutos.
- Preparar tres ventanas: el panel de su app, el comprador de prueba en Chrome privado y el vendedor de prueba en Safari privado.
- Pegar el token en la terminal.
- Hacer cinco pagos de prueba con la tarjeta y los titulares de la tabla.
- Hacer una devolución en el panel.

**Recuperación:** el laboratorio es desechable y se recrea en cada corrida. Ctrl+C no deja nada en Producción. Los pagos de prueba quedan sólo en las cuentas de prueba, sin dinero real.

## Revisión de operadores y vueltas atrás (2026-10-13)

| # | Hallazgo | Cambio | Prueba |
|---|---|---|---|
| O1 | **El runner dejaba la purga activa.** El borrado real dependía sólo, y de forma implícita, de que existieran los secretos en Vault. | El runner crea el job de purga **inactivo**. El borrado real es un paso aparte con GO propio: `enable-purge` (frase `ENABLE TORNEOS PURGE …`), con precondición de los dos secretos en Vault. El catálogo lee **sólo los nombres**, y si no tiene permiso queda `null`, lo que también rechaza. Se apaga con `disable-purge`, que deja el job de ciclo de vida intacto. | `season-cron`: activo/inactivo, sin Vault se rechaza, dos veces se rechaza, on → off. `db-season` en el laboratorio: rechazo sin Vault → on → off. |
| O2 | **0019 cambia el precio vigente**: 20.000, y 39.900 al volver atrás. Aplicarlo o revertirlo con el checkout abierto cambia el precio a mitad de una compra. | `apply-0019` y `rollback-0019` exigen `checkout_scope = 'off'` (el interruptor de 0013), leído en el catálogo antes de escribir. | Fake y laboratorio: con `open` se rechaza sin escribir, con `off` pasa. |
| O3 | Se podía sacar el runner con la purga encendida. | `rollback-runner` sólo parte de `RUNNER_ON`; desde `RUNNER_PURGE_ON` se rechaza. `rollback-0018` exige el runner apagado del todo. | Fake y laboratorio. |
| O4 | **Volver a aplicar 0018 después de deshacerlo reinicia el reloj.** Las temporadas existentes reciben de nuevo «6 meses desde la migración», así que el plazo se alarga, nunca se acorta, y los avisos 7d/1d se mandan para la nueva fecha. | Sin cambio de código: queda como regla de operación. Un rollback seguido de reaplicación es una decisión de producto, no un paso técnico neutro. | — |
| O5 | La vuelta atrás de 0018 no recupera fotos ya purgadas. | Ya estaba dicho en el archivo. Con O1, mientras no haya `enable-purge` no hay nada purgado. | — |

**Pins nuevos** (`node db-season.mjs pins`):
- apply-runner `c41e5a87…`;
- enable-purge `cc1385d6…`;
- disable-purge `b5d026c0…`;
- los demás no cambian.

## Después de P10

**GO final sobre la evidencia**, por pasos. Cada uno con su frase y su propio GO:
1. `apply-0018`.
2. `apply-runner`: ciclo de vida activo, purga **inactiva**. Antes, habilitar pg_cron y pg_net en el proyecto (las crea el archivo).
3. 0013 (su driver `db-0013.mjs`).
4. `apply-0019`, con el checkout en `off`.
5. Función, gateway y web.
6. **Pagos:** el interruptor de checkout de 0013, con su propio GO.
7. **Borrado real:** con su propio GO.
   - Secretos en Vault, cargados desde la TTY por el operador.
   - `torneos-media-store` con `TORNEOS_MEDIA_PURGE_SECRET`.
   - Después `enable-purge`.

## #203 (aparte)

Mergeado (54036f59). La publicación sigue esperando el token temporal de Supabase de Nico: `~/Arma2Backups/stab-203-run.sh function`. Esta rama no lo frena.
