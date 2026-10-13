# Handoff a Codex: temporada comercial, galería y Mercado Pago

**Actualizado:** 2026-10-13 · rama `claude/torneos-season-commercial-gallery` · head del commit que trae este archivo (ver `git log -1`).
**No hay notificación directa a Codex:** este archivo y la sesión de Claude «Arma2 Torneos como producto conectado» son el canal.
**No está listo para GO.** Falta una sola cosa: correr P10 contra el sandbox actual de Mercado Pago. El wrapper está listo y probado offline; sólo espera el paso humano de Nico (ver «P10» abajo).

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
| `test:torneos:season` (lifecycle 16 + orden de Producción 1 + runner 3 + driver 5 + P10 offline 3) | **28/28** local | `arma2-season-lab-db-*` (0000→0017, con 0018 y 0019 aplicados y revertidos por las pruebas) |
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

**Wrapper:** `backend/torneos/season-lifecycle/p10/p10-sandbox.mjs`.

**Por qué no se usa la cadena alojada.** La cadena TEST certificada (Deno `torneos-payments-test` sobre la base de Producción) usa las reglas actuales. Probar 0018 y 0019 ahí exigiría aplicarlas en Producción.

**Qué corre y dónde:**
- **Base:** laboratorio local nuevo, contenedor `arma2-season-p10-db`, con 0000→0019 de esta rama.
- **Runtime:** el handler real `torneos-payments-production`: las mismas sentencias de `rpc.ts`, el login de producción y `SET LOCAL ROLE`.
- **Proveedor:** la API real de MP con el Access Token del **vendedor de prueba**.
  - El token se pide en un prompt oculto y queda sólo en memoria: nunca se loguea ni se escribe.
  - El fetcher sólo habla con `https://api.mercadopago.com` y sólo hace las llamadas del runtime (GET y el POST de la Preference). Ni devoluciones ni pagos.
- **Estado:** entra por la ruta de refresco del comprador (`purchase-reconcile` → `/v1/payments/search`). MP no puede llegar a localhost para el webhook; su firma la cubren `webhook-signature-sdk` y la certificación TEST del 2026-09-26.

**Único ajuste de laboratorio, y por qué.**
- El runtime de producción atestigua al vendedor y rechaza un usuario de prueba (tag `test_user` en `/users/me`).
- El wrapper **exige** primero ese tag: un vendedor real se rechaza antes de crear el laboratorio.
- Después le pasa al runtime la misma respuesta sin ese único tag.
- No hace falta tocar `live_mode`: el sandbox ya contesta `true` (observado el 2026-09-26).

**Casos, y lo que se verifica:**
- **A.** Temporada abierta, tarjeta APRO.
  - Monto 20.000 tomado de la oferta vigente.
  - `approved` + `verified`; Premium sólo en esa temporada; un único grant.
- **B.** Tarjeta OTHE, después CONT, sobre el mismo link.
  - La compra sigue abierta y en FREE; el pendiente no otorga nada.
- **C.** Temporada cerrada antes de pagar, tarjeta APRO.
  - `approved` + `season_closed`, `requires_manual_refund`, FREE y sin grant.
  - Después Nico devuelve en el panel: `refunded` una sola vez, sigue FREE; un evento de pago tardío y uno de devolución.
- **D.** Segundo APRO sobre el link de A.
  - `requires_manual_refund`; sigue habiendo un solo grant y Premium.
- Si un caso falla (timeout, Preference rechazada), queda registrado como FAIL con su motivo y los siguientes corren igual.

**Evidencia:** se escribe en `evidence/p10-sandbox-<ts>Z.txt`. Veredicto `P10_PASS` o `P10_FAIL`; contiene ids de laboratorio y de pagos de prueba, nunca el token.

**Probado offline:** `p10-sandbox.test.mjs` 3/3. Corre el mismo `runP10()` con el emulador en la forma del sandbox, más tres pruebas:
- un vendedor real se rechaza antes del laboratorio;
- el fetcher bloquea devoluciones y otros orígenes;
- un caso fallido no frena a los demás.

**Riesgo sin probar hasta la corrida real.** La Preference usa back URLs y `notification_url` de laboratorio (`*.unit.invalid`). Si MP las rechaza, el caso queda en `P10_PREFERENCE_FAILED` con la respuesta de MP, y se cambia por un host válido sin tocar nada más.

### El único paso humano (Nico, mañana; nada por chat)

En su terminal, desde la raíz del repo en esta rama:

```bash
node backend/torneos/season-lifecycle/p10/p10-sandbox.mjs
```

1. Pega el **Access Token del vendedor de prueba** de la app Arma2 (Tus integraciones → la app → Cuentas de prueba → vendedor → Credenciales de producción, `APP_USR-…`) en el prompt oculto.
2. Para cada link que imprime: abre una ventana privada, entra como **comprador de prueba** y paga con una tarjeta de prueba. El titular indica el resultado:
   - **A:** APRO;
   - **B:** OTHE y después CONT, sobre el mismo link;
   - **C:** APRO;
   - **D:** APRO otra vez sobre el link de A.

   Después aprieta Enter. La página de vuelta no carga porque apunta a un host de laboratorio, y eso es lo esperado.
3. Cuando lo pide (caso C): en el panel del **vendedor de prueba**, devuelve el pago indicado completo y aprieta Enter.

Dura unos 15 minutos. Si sólo hay tiempo para lo esencial: `--cases A,C`.

**Recuperación:** el laboratorio es desechable y se recrea en cada corrida. Si algo se corta, se vuelve a correr y no deja nada en Producción ni en MP más allá de los pagos de prueba.

## Después de P10

**GO final sobre la evidencia**, por pasos:
- 0018 → runner → 0013 → 0019 → función, gateway y web.
- Pagos y borrado real, cada uno con su propio GO.

## #203 (aparte)

Mergeado (54036f59). La publicación sigue esperando el token temporal de Supabase de Nico: `~/Arma2Backups/stab-203-run.sh function`. Esta rama no lo frena.
