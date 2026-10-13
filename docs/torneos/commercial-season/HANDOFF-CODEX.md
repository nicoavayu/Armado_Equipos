# Handoff a Codex: temporada comercial, galería y Mercado Pago

**Actualizado:** 2026-10-13 · rama `claude/torneos-season-commercial-gallery` · head del commit que trae este archivo (ver `git log -1`).
**No hay notificación directa a Codex:** este archivo y la sesión de Claude «Arma2 Torneos como producto conectado» son el canal.
**No está listo para GO.** Falta:
- la prueba de punta a punta en el sandbox actual de Mercado Pago (P10);
- los drivers de operador para 0018, 0019 y el runner.

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

## Evidencia (logs en `docs/torneos/commercial-season/evidence/`)

| Suite | Resultado | Laboratorio |
|---|---|---|
| `test:torneos:season` (lifecycle 16 + orden de Producción 1 + runner 3) | **20/20** | `arma2-season-lab-db-*` (0000→0017, con 0018 y 0019 aplicados y revertidos por las pruebas) |
| `test:torneos:commerce-production` (incluye DB, gateway, driver y vuelta atrás de 0013, orden de migraciones, privilegios y vectores del SDK) | **95/95** | `arma2-commerce-season-db-*` (0000→0019) |
| `media-store` / `media` / `branding` | 21/21 · 36/36 · 18/18 | sin base |
| Jest / frontend-foundation | 3722/3722 · 109/109 | — |

## Hecho después de la revisión

- **Driver de operador** `backend/torneos/season-lifecycle/remote/db-season.mjs`.
  - Modos: observe, apply/rollback de 0018, 0019 y el runner, y `budget` (A3).
  - Cada escritura exige frase, sha256, estado por eje y orden entre ejes, y que nada fuera de lo suyo se mueva.
  - Ensayado en el laboratorio a través del mismo `run()`. `test:torneos:season` **25/25**.
- **PR borrador** [#204](https://github.com/nicoavayu/Armado_Equipos/pull/204), con CI en GitHub.

## P10: sandbox actual de Mercado Pago (lo único que falta antes del GO)

**Por qué no se usa la cadena alojada.** La cadena TEST certificada (Deno `torneos-payments-test` sobre la base de Producción) usa las reglas actuales. Probar 0018 y 0019 ahí exigiría aplicarlas en Producción, cosa que no se hace antes del GO.

**Plan, en laboratorio aislado:**
- Postgres local con 0000→0019.
- El runtime real `torneos-payments-production`, cargado en Node con el árbol del gateway y apuntado a esa base.
- La API real de MP en **modo prueba**: vendedor y comprador de prueba.
- El estado entra por la consulta autoritativa (`/v1/payments/search` por `external_reference`) y por la conciliación. MP no puede llegar a localhost para mandar el webhook: la firma la cubren los vectores del SDK y la certificación TEST del 2026-09-26.
- Casos a recorrer:
  - aprobado con la temporada abierta → Premium;
  - aprobado con la temporada cerrada → `approved_season_closed` y devolución manual en el panel de prueba → `refunded`;
  - rechazado y pendiente;
  - pago doble.

**Lo que necesita a Nico (pantalla de MP; nada por chat):**
1. El Access Token de prueba del vendedor de prueba de la app de MP. Lo carga en un campo oculto del wrapper.
2. Hacer él el pago en el checkout del sandbox con el comprador de prueba. No puedo iniciar sesión ni ingresar tarjetas.
3. La devolución en el panel del vendedor de prueba.

## Después de P10

**GO final sobre la evidencia**, por pasos:
- 0018 → runner → 0013 → 0019 → función, gateway y web.
- Pagos y borrado real, cada uno con su propio GO.

## #203 (aparte)

Mergeado (54036f59). La publicación sigue esperando el token temporal de Supabase de Nico: `~/Arma2Backups/stab-203-run.sh function`. Esta rama no lo frena.
