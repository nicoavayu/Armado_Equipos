# Handoff a Codex: temporada comercial, galería y Mercado Pago

**Actualizado:** 2026-10-13 · rama `claude/torneos-season-commercial-gallery` · head del commit que trae este archivo (ver `git log -1`).
**No hay notificación directa a Codex:** este archivo y la sesión de Claude «Arma2 Torneos como producto conectado» son el canal.
**No está listo para GO.** Falta correr P10 contra el sandbox actual de Mercado Pago.
- El wrapper y su launcher están listos y probados offline.
- Lo que sólo Mercado Pago real puede mostrar sigue **sin validar**, empezando por que acepte la Preference con estas URLs (ver «P10» abajo).

Nada se aplicó en Producción. Premium, pagos y borrado real siguen apagados.

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
  - Modos: observe, apply/rollback de 0018, 0019 y el runner, y `budget` (A3).
  - Cada escritura exige frase, sha256, estado por eje y orden entre ejes, y que nada fuera de lo suyo se mueva.
  - Ensayado en el laboratorio a través del mismo `run()`. `test:torneos:season` **25/25**.
- **PR borrador** [#204](https://github.com/nicoavayu/Armado_Equipos/pull/204), con CI en GitHub.

## P10: sandbox actual de Mercado Pago (lo único que falta antes del GO)

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
  - que `api.mercadopago.com` responda (401 sin token);
  - que el host de vuelta conteste 404.
- `p10-run.sh check` hace sólo esas comprobaciones.
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

**Validado offline:** `p10-sandbox.test.mjs` **6/6**, el mismo `runP10()` con el emulador en la forma del sandbox.
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

## Después de P10

**GO final sobre la evidencia**, por pasos:
- 0018 → runner → 0013 → 0019 → función, gateway y web.
- Pagos y borrado real, cada uno con su propio GO.

## #203 (aparte)

Mergeado (54036f59). La publicación sigue esperando el token temporal de Supabase de Nico: `~/Arma2Backups/stab-203-run.sh function`. Esta rama no lo frena.
