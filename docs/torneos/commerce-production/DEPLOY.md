# Premium de Torneos con cobro real (Mercado Pago Checkout Pro PRODUCCIÓN)

**Estado: preparado y probado en laboratorio. No se ejecutó nada en Production.** Cada paso con efecto real necesita un GO
explícito de Nico. Mergear no activa nada: la base de datos instala el interruptor en `off`, el gateway sin
`TORNEOS_COMMERCE_MODE` no expone rutas de compra y el frontend sin `REACT_APP_TORNEOS_BILLING_MODE` no muestra precio
ni botón.

Producto sin cambios: **Premium por temporada, pago único**, producto `torneos_premium`, oferta vigente del catálogo
(`launch` v1: lista ARS 49.900, lanzamiento ARS 39.900). No hay suscripciones ni precios nuevos: el precio sale siempre
de `tournament_commercial_offers` y lo fija la base de datos.

## 1. Qué había y qué agrega esta rama

**Ya estaba (TEST, certificado):** Checkout Pro TEST en el backend híbrido. `torneos-payments`, ruta
`/commerce/v1/season-checkout` del gateway, migraciones `0002`/`0003`. Certificación remota
`PAYMENTS_REMOTE_TEST_CERTIFIED` (2026-09-26, `backend/torneos/mp-b/evidence/payments-test/remote/REPORT.md`):

- Preference, pagos rechazado y aprobado y webhooks firmados reales del sandbox.
- Devolución → webhook firmado → revocación del grant.
- **Limitación declarada:** la devolución se inició **a mano en el panel** del Seller Test. Iniciar devoluciones por API
  **no está certificado** (el sandbox respondió `401 Unauthorized use of live credentials`).
- Disputas, restituciones y respuestas falsificadas del proveedor quedaron cubiertas por harness, no por eventos reales.

Nada de eso se modificó: los archivos de `torneos-payments/`, `_shared/` y las migraciones `0000`–`0011` siguen byte a
byte, y `0013` fija por md5 los cuerpos de la cadena TEST antes y después de aplicarse.

**Agrega (producción, separado de TEST):**

| Pieza | Dónde | Qué hace |
| --- | --- | --- |
| Migración `00000000000013` | Torneos DB | `MERCADO_PAGO/production`; rol `torneos_payment_production_service` (7 RPC, ninguna tabla); trigger de aislamiento por login; interruptor `off`/`allowlist`/`open`; wrapper de compra productivo; RPC de compras de la temporada (con `checkoutAvailable`); RPC de servicio ordenados (watermark de MP-B1.2); reconciliación y throttle por compra |
| `torneos-payments-production` | Deno Deploy, app `torneos-payments` | Preference, webhook (secreto productivo, `live_mode` true), reconciliación a pedido y cron cada 15 min; atestación `/users/me` (seller productivo, nunca `test_user`) |
| Gateway, modo `production` | Cloud Run `torneos-gateway` | `season-checkout` al wrapper productivo, `purchase-refresh` (“ya pagué”), 3 lecturas |
| Frontend, billing `production` | Vercel | Panel de compra en Mi plan, página de estado con reconciliación; sólo en `app.arma2.com.ar`, build de producción, PLAN READ y gateway https |
| Operación | `backend/torneos/commerce-production/remote/`, `backend/torneos/infra/torneos-payments-production/` | Driver de DB con frases, login productivo por Keychain + SCRAM, despliegue Deno con frases, monitoreo SELECT-only, rollback |

## 2. Recorrido y garantías

```
Mi plan (FREE/PREMIUM, precio, alcance, pago único)
  → “Pagar con Mercado Pago” (sólo si el servidor dice checkoutAvailable)
  → gateway POST /commerce/v1/season-checkout {organizationId, seasonId, idempotencyKey}
  → DB create_tournament_season_production_checkout_purchase (como el usuario: billing.manage, temporada, interruptor,
     Premium vigente, compra abierta única, idempotencia, precio de la oferta)
  → torneos-payments-production (HMAC) → Preference (X-Idempotency-Key = id de compra) → init_point validado
  → Mercado Pago → back_url (sólo muestra; nunca concede)
  → página de estado: purchase-refresh → reconcilia con MP por external_reference → lectura de la DB
  → webhook firmado → re-lectura de pago, orden y Preference → política de binding → RPC ordenado → grant de temporada
  → cron cada 15 min: compras abiertas, aprobadas recientes (devoluciones/contracargos) y cerradas recientes (aprobación tardía)
```

| Requisito | Cómo se cumple | Prueba |
| --- | --- | --- |
| Precio, moneda, producto, organización, temporada por servidor | El navegador manda 3 UUID; el wrapper toma la oferta; el gateway rechaza otros campos; el pago se compara contra el snapshot | `commerce-production-db` (snapshot), `gateway-commerce-production` (cuerpo con `amount` → 400) |
| Autorización | `billing.manage` + acceso a la temporada (owner o admin asignado); refresh con el bearer del usuario | DB: colaborador, admin sin temporada, ajeno, otra org → `TORNEOS_BILLING_FORBIDDEN`; refresh de ajeno → 403 |
| Doble toque, reintento, respuesta perdida | Clave de idempotencia por intento; lock advisory; una compra abierta por temporada; Preference idempotente por id de compra | DB (3 toques concurrentes → 1 compra), payments (2 pedidos de Preference → 1), gateway (doble toque → misma compra y Preference) |
| El retorno no concede | La back_url sólo abre la página; sólo el webhook o la reconciliación verificados aplican | Jest: `/exito` con `collection_status=approved` muestra pendiente |
| Activación sólo verificada | Firma + re-lectura de pago, merchant order y Preference + binding (seller, app, referencia, metadata, Preference, orden, moneda, monto, ítem, `live_mode`) | payments: 8 falsificaciones (monto, moneda, metadata, seller, Preference, `live_mode`, fuera de la orden, otra app) → 422, sigue FREE |
| Cierre del navegador / webhook tardío | Reconciliación al volver y cron cada 15 min | payments: “retorno antes del webhook”, “cron reconcilia una compra sin webhook” |
| Pendientes | `pending` nunca vence; cron lo revisa cada 10 min | DB y payments (efectivo → aprobado) |
| Rechazo, cancelación | Intento cerrado; la compra sigue abierta para otra tarjeta | DB y payments |
| Devolución | Revoca el grant (nunca borra); la temporada puede volver a comprar | DB, payments (panel → webhook), gateway |
| Contracargo | Disputa suspende, a favor restaura, en contra revoca; un evento viejo no deshace uno nuevo | DB y payments (`topic_chargebacks_wh`) |
| Duplicados y desorden | Watermark por pago (`date_last_updated`), eventos únicos por estado | DB y payments (`provider_snapshot_duplicate`, `stale_ignored`) |
| Aislamiento TEST/producción | Rol, login, RPC, app, secretos y config separados; trigger por login | DB: el login TEST no puede mover una compra productiva (ni por la función genérica), y viceversa |
| Aislamiento entre temporadas | Grant por temporada | DB y payments: otra temporada sigue FREE |

## 3. Interruptores (todos apagados al mergear)

| Interruptor | Dónde | Apagado | Efecto encendido |
| --- | --- | --- | --- |
| `checkout_scope` | Torneos DB (`db-0013.mjs scope`) | `off` | `allowlist`: sólo organizaciones listadas; `open`: todas |
| `TORNEOS_COMMERCE_MODE` | Gateway Cloud Run | ausente | `production`: rutas de compra y refresh |
| `REACT_APP_TORNEOS_BILLING_MODE` | Vercel Production | ausente | `production`: panel de compra (sólo `app.arma2.com.ar`) |
| App `torneos-payments` | Deno Deploy | no existe | Preference, webhook y cron |
| Webhooks “Modo productivo” | Panel de Mercado Pago | sin URL | Notificaciones firmadas a la app |

Los pagos ya iniciados nunca dependen del interruptor: cerrarlo no deja dinero sin procesar.

## 4. Activación (cada paso con GO de Nico)

Requisito previo: #182 y la Galería (#189) promovidos según su propio plan, y las decisiones de §8.

**P1 — Merge.** El código queda inerte (sin env, sin app, interruptor `off`).

**P2 — Backup y migración.** Backups manuales del plan Free (`docs/ops/free-plan`, G0a: Torneos). Luego:

```
node backend/torneos/commerce-production/remote/db-0013.mjs observe
node backend/torneos/commerce-production/remote/db-0013.mjs apply-0013 APPLY TORNEOS 0013 onzpwnqxnvlgsevivngf <sha12>
```

Verificar `POST_0013`, `outsideUnchanged: true`, `scope: off`. Rollback: `rollback-0013` (sólo sin compras productivas).

**P3 — Login productivo.**

```
node backend/torneos/commerce-production/remote/db-0013.mjs login CREATE TORNEOS PAYMENTS PRODUCTION LOGIN torneos_payments_prod onzpwnqxnvlgsevivngf
```

La contraseña se genera en el Keychain (`arma2-torneos-payments-production`); a la DB sólo llega el verificador SCRAM.

**P4 — Mercado Pago (Nico, en el panel).** En la aplicación de Arma2:

1. Activar las credenciales de producción (industria, sitio `https://app.arma2.com.ar`, aceptar términos).
2. Webhooks → **Modo productivo** → URL
   `https://torneos-payments.nicoavayu.deno.net/functions/v1/torneos-payments-production/webhooks/mercadopago/v1`,
   eventos **Pagos** y **Contracargos**. Guardar y dejar a mano la **clave secreta**.
3. Revisar en “Costos y plazos” el plazo de acreditación elegido (define la comisión; ver §7).

No pegar ninguna credencial en el chat.

**P5 — App Deno productiva.**

```
bash backend/torneos/infra/torneos-payments-production/run-production-deploy.sh plan
bash backend/torneos/infra/torneos-payments-production/run-production-deploy.sh preflight
bash backend/torneos/infra/torneos-payments-production/run-production-deploy.sh create CREATE TORNEOS PAYMENTS PRODUCTION APP torneos-payments <digest12>
```

El wrapper pide, sin eco: token de organización de Deno, seller id, access token productivo y clave secreta del webhook.
`preflight` exige que `/users/me` sea ese seller, MLA y **no** `test_user`, y valida el env con el `config.ts` real.
Verificar `status`. En los logs de la app debe verse `reconcile_summary` cada 15 minutos, sin `provider_not_production`.

**P6 — Gateway.** Revisión nueva de Cloud Run al 0 % con tag, misma env que la vigente más:

| Variable | Valor |
| --- | --- |
| `TORNEOS_COMMERCE_MODE` | `production` |
| `TORNEOS_COMMERCE_PRODUCTION_PAYMENTS_HOST` | `torneos-payments.nicoavayu.deno.net` |
| `TORNEOS_PAYMENTS_INTERNAL_URL` | `https://torneos-payments.nicoavayu.deno.net/functions/v1/torneos-payments-production` |
| `TORNEOS_PAYMENTS_INTERNAL_SECRET` | Secret Manager: el mismo valor que el Keychain `arma2-torneos-payments-production / internal-hmac-key` |

Con el interruptor en `off`, un checkout por la URL del tag responde `409 TORNEOS_BILLING_DISABLED`, lo que prueba el
cableado sin crear compras. Recién después, 100 % y quitar el tag. Rollback: tráfico a la revisión anterior.

**P7 — Frontend.** Vercel Production: `REACT_APP_TORNEOS_BILLING_MODE=production` y redeploy. Con el interruptor en
`off`, Mi plan muestra precio y beneficios con “La compra de Premium todavía no está disponible para esta organización”
(lo decide `checkoutAvailable`), sin botón. Rollback: quitar la variable y redeploy.

**P8 — Primer cobro real (allowlist).** Ver §6. Al terminar, el interruptor vuelve a `off` hasta revisar la evidencia.

**P9 — Apertura.** `db-0013.mjs scope open`. Monitoreo diario (§5).

## 5. Monitoreo y reconciliación

- **Automática:** el cron de la app revisa cada 15 minutos:
  - compras abiertas (después de 2 minutos, como máximo cada 10);
  - aprobadas o en disputa de los últimos 200 días, cada 6 horas;
  - cerradas de los últimos 7 días, cada hora, para detectar una aprobación tardía.
  Deja una línea `reconcile_summary` en los logs de Deno.
- **A pedido:** “Consultar de nuevo” en la página de estado (con throttle de 15 s por compra en la base).
- **Diario (sin servicios pagos de alertas):** `backend/torneos/commerce-production/remote/monitoring.sql` en el editor
  SQL de Supabase (sólo SELECT). `alerts` debe estar vacío. Además, revisar en el panel de Mercado Pago la actividad y
  los reclamos o contracargos.
- **`requiresManualRefund`:** se marca ante una aprobación después del cierre o un segundo pago. Nunca concede Premium.
  La devolución se hace a mano desde el panel de Mercado Pago (la API de devolución no está certificada) y su webhook
  queda registrado.

## 6. Primer cobro real: procedimiento y evidencia

1. `db-0013.mjs allow <org de Nico>` y `scope allowlist`.
2. En `app.arma2.com.ar`, desktop y teléfono: Mi plan de una temporada FREE de esa organización → precio ARS 39.900 →
   “Pagar con Mercado Pago” → pagar con un medio real.
3. Verificar: la página de estado pasa a “Premium ya está activo”, Mi plan dice PREMIUM, y otra temporada de la misma
   organización sigue FREE.
4. Devolución total desde el panel de Mercado Pago → la temporada vuelve a FREE y nada se borra.
5. `scope off`.

**Evidencia a guardar** (sin datos del pagador ni credenciales):

| # | Evidencia | Fuente |
| --- | --- | --- |
| E1 | `db-0013.mjs observe` antes y después de cada paso | JSON del driver |
| E2 | `preflight`, `create` y `status` de la app | `backend/torneos/commerce-production/evidence/pp-*.json` |
| E3 | Revisión de Cloud Run con env (valores secretos como referencia) | `cloudrun-readonly.mjs --expect-env TORNEOS_COMMERCE_MODE=production` |
| E4 | Id de compra, de Preference y de pago; estado `approved`; grant `granted` | `monitoring.sql` y `get_tournament_season_purchases` |
| E5 | Webhook firmado `200 approved` o reconciliación `verified` | logs de Deno (`route`, `code`, `purchaseId`) |
| E6 | Capturas de Mi plan, la página de estado y el retorno, en desktop y teléfono | navegador |
| E7 | Devolución: `refunded`, grant `revoked`, webhook `reversal_applied`, réplica tardía `duplicate` | logs y `monitoring.sql` |
| E8 | Otra temporada FREE durante todo el proceso | `get_effective_tournament_season_entitlements` |
| E9 | `alerts` vacío al final | `monitoring.sql` |

Iniciar la devolución por API sigue fuera del alcance certificado (igual que en TEST).

## 7. Costos

**Infraestructura (planes gratuitos actuales, sin contratar nada):**

| Servicio | Uso | Límite Free relevante |
| --- | --- | --- |
| Deno Deploy (app nueva `torneos-payments`) | Webhooks, Preferences y cron (96 corridas por día) | 1M requests/mes, 10 h de CPU activa, 20 GiB de egreso, hasta 10 crons por revisión ([pricing](https://deno.com/deploy/pricing), [cron](https://docs.deno.com/deploy/reference/cron/)) |
| Supabase Torneos (Free) | 3 tablas pequeñas y RPC | 500 MB de base, 1 GB de storage, 5 GB de egreso, pausa tras 1 semana de inactividad ([pricing](https://supabase.com/pricing)). El cron consulta la base cada 15 minutos |
| Cloud Run (gateway) | 2 rutas nuevas | Sin cambios de servicio |
| Vercel (frontend) | Panel de compra | **Ver la decisión D1**: el plan Hobby es sólo para uso personal y no comercial |

**Comisiones de Mercado Pago (no son costo de infraestructura y no son cero).** Checkout Pro, según la página oficial
consultada el 2026-10-07 ([mercadopago.com.ar/herramientas-para-vender/check-out](https://www.mercadopago.com.ar/herramientas-para-vender/check-out)):

| Plazo | Comisión |
| --- | --- |
| Al instante | 6,29 % + IVA |
| 10 días | 4,39 % + IVA |
| 18 días | 3,39 % + IVA |
| 35 días | 1,49 % + IVA |

La misma página aclara que los costos varían por impuestos provinciales. Además pueden aplicar retenciones o
percepciones según la situación fiscal, y el costo real lo muestra la cuenta (“Costos y plazos”). Como referencia, sobre
ARS 39.900, al instante: 6,29 % = ARS 2.509,71 más IVA 21 % (ARS 527,04), es decir ARS 3.036,75 antes de impuestos
provinciales. No se asumió que la comisión se devuelva con una devolución.

## 8. Decisiones y pasos que sólo puede dar Nico

| # | Tema | Por qué | Propuesta |
| --- | --- | --- | --- |
| D1 | **Vercel Hobby no admite uso comercial** | Las [Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines) incluyen como uso comercial “any method of requesting or processing payment from visitors of the site”. Pro cuesta USD 20/mes ([pricing](https://vercel.com/pricing)) | Decidir antes de P7: contratar Pro, o mover el frontend a un hosting gratuito que admita uso comercial. No lo resolví por mi cuenta (la consigna prohíbe servicios pagos nuevos) |
| D2 | Deno Deploy Free | El pricing lo describe “for personal use and smaller projects” sin prohibir uso comercial | Confirmar los términos antes de P5 |
| D3 | Requisitos legales y fiscales del cobro | Términos de venta y política de devolución publicados, botón de arrepentimiento (Res. SCI 424/2020) y facturación | Definirlos y publicarlos. Esta rama no inventa condiciones ni textos legales |
| D4 | Storage Free (1 GB de la organización, 5 GB de egreso/mes) | Premium sube la galería a 1.000 fotos por temporada (lo eleva la sesión #182/Galería) | Tope o alarma antes de vender Premium a escala |
| D5 | Plazo de acreditación en Mercado Pago | Define la comisión (§7) | Elegirlo en el panel antes de P8 |

**Acciones exactas de Nico (con GO):** P2 y P3 (contraseña del instalador en el Keychain, ya custodiada), P4 (panel de
Mercado Pago), P5 (token de Deno y credenciales productivas en la TTY), P6 (Cloud Run y Secret Manager), P7 (Vercel) y P8
(pago y devolución).

## 9. Desactivación y rollback (preservando compras e historial)

En orden de menor a mayor impacto:

1. **Cerrar ventas:** `db-0013.mjs scope off`. Es inmediato y no toca pagos en curso. Mi plan deja de mostrar el botón.
2. **Ocultar la compra:** quitar `REACT_APP_TORNEOS_BILLING_MODE` en Vercel y redeploy. Mi plan queda informativo.
3. **Gateway sin commerce:** volver a la revisión anterior. Sin `get_tournament_purchase` en la allowlist, la página de
   estado deja de leerse. Por eso **sólo** se hace cuando no queden compras abiertas.
4. **App de pagos:** mantenerla mientras haya aprobaciones de los últimos 200 días, para recibir devoluciones y
   contracargos. Si se detiene, Mercado Pago reintenta hasta 96 h; la reconciliación se recupera al volver a desplegarla.
5. **Base:** `rollback-0013` **sólo** si nunca hubo una compra productiva y no queda el login. Con compras, nunca se
   borran compras, eventos ni grants: se usan los pasos 1 a 3.

Volver atrás a mitad de un pago no pierde dinero ni Premium: el pago queda en Mercado Pago y, al reactivarse la app, el
cron lo aplica.

## 10. Probarlo

- **Suites (Docker):**
  - `npm run test:torneos:commerce-production`: 71 casos con PostgreSQL real (0000 → 0012 → 0013), login real, emulador
    de Mercado Pago y el handler y el gateway reales;
  - `npm run test:torneos:frontend-foundation`;
  - Jest `torneosMpA5HybridCommerce`.
- **Pantallas sin backend:** `node scripts/qa/plan-ux/build.cjs`, servir `artifacts/plan-ux/site` y abrir
  `?billing=production&purchase=none|open|pending|approved|refunded|charged_back&available=yes|no&role=owner|collaborator`.
  Para la página de estado, agregar `&path=temporada/<id>/plan/compra/<id>/pendiente`.
- **Preview integrada (fase B, laboratorio):** compra clickeable sobre el lab compartido `arma2-promo-rehearsal`, sin Mercado
  Pago real, sin servicios hosteados y sin credenciales reales. La herramienta es
  `backend/torneos/commerce-production/lab/phase-b/overlay.mjs`:
  1. `node backend/torneos/commerce-production/lab/phase-b/overlay.mjs prepare --app-origin http://localhost:3121` escribe
     en `lab/phase-b/.runtime/` (0600, ignorado por git) los secretos efímeros del laboratorio y estos archivos:
     - `torneos-functions-production.env`, para el contenedor `torneos-functions`. Lleva los valores con prefijo
       `PRODUCTION_PAYMENTS__`; el router del lab se los entrega sólo a `torneos-payments-production`;
     - `edge-gateway-commerce.env` (gateway Edge: modo y montaje). El router fija `local-lab` y la clave HMAC del
       trabajador productivo;
     - `gateway-commerce.env` (gateway Node: los 4 valores);
     - `lab-login.sql` (login del laboratorio, sólo el verificador SCRAM), `scope-open.sql` y `scope-off.sql`.
  2. El dueño del lab aplica `lab-login.sql` y `scope-open.sql` como superusuario y suma los archivos env a sus gateways.
  3. `… overlay.mjs stub-up --network arma2-promo-rehearsal_isolated` levanta el Mercado Pago de laboratorio (alias
     `mp-stub`, consola en `127.0.0.1:58461`; `… overlay.mjs status` muestra la URL).
  4. En la preview: Mi plan → “Pagar con Mercado Pago” abre mercadopago.com.ar con una Preference del emulador, que
     Mercado Pago no reconoce. El pago se hace en la consola: aprobar, rechazar, pendiente, acreditar, devolver,
     contracargo ganado o perdido. Cada acción manda el aviso firmado; “volver a la app” abre la página de estado de la
     compra.
  5. Al terminar: `scope-off.sql`, `… overlay.mjs stub-down`, quitar los env y `DROP` del login (`lab-login-drop.sql`).

  En localhost el frontend usa `REACT_APP_TORNEOS_BILLING_MODE=test`, porque el modo `production` sólo vale en
  `app.arma2.com.ar`. Los componentes son los mismos; el gateway y el servicio ejercitados son los de producción.
  `… overlay.mjs selftest` prueba todo esto en una réplica privada (18 controles).
