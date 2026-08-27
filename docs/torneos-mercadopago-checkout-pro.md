# Arma2 Torneos · Mercado Pago Checkout Pro (TEST)

## Alcance

Esta etapa integra Checkout Pro mediante Preferences API exclusivamente con credenciales de prueba. El modelo sigue siendo `one_time`, producto `torneos_premium`, scope `tournament`, moneda `ARS` y precio resuelto por el catálogo comercial del servidor.

Producción no está habilitada: no existe un environment productivo en el constraint, no existe fallback de configuración y este runbook no autoriza deploy remoto.

Referencias oficiales consultadas:

- [Crear una preferencia de Checkout Pro](https://www.mercadopago.com.ar/developers/en/docs/checkout-pro/create-payment-preference)
- [Credenciales de prueba de Checkout Pro](https://www.mercadopago.com.ar/developers/en/docs/checkout-pro/additional-content/credentials)
- [Webhooks y validación de `x-signature`](https://www.mercadopago.com.ar/developers/en/docs/your-integrations/notifications/webhooks)
- [Notificaciones de contracargos de Checkout Pro](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/chargebacks/notifications)
- [Consulta y estados de contracargos de Checkout Pro](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/chargebacks/manage)
- [Pruebas de integración de Checkout Pro](https://www.mercadopago.com.ar/developers/en/docs/checkout-pro/integration-test)
- [Secretos de Edge Functions](https://supabase.com/docs/guides/functions/secrets)

## Arquitectura

El dominio comercial y Mercado Pago están separados:

1. `tournament-checkout` revalida la sesión y selecciona un provider explícito.
2. `create_tournament_purchase` verifica `billing.manage`, ownership organizacional, torneo, producto, oferta, precio, Premium vigente, idempotencia y purchase abierta.
3. El adapter `mercadoPagoPaymentProvider.ts` crea o recupera la Preference usando sólo el snapshot de la purchase.
4. `record_tournament_purchase_preference` persiste el ID y completa `created → preference_created` como operación service-only.
5. El browser navega al `init_point` validado de Mercado Pago. Las back URLs son UX solamente.
6. `tournament-mercadopago-webhook` valida firma y modo TEST. Para pagos consulta Payment y Merchant Order; para contracargos consulta primero Chargeback y deriva de esa respuesta el Payment que luego vuelve a validar con Merchant Order. Recién entonces invoca la transición comercial service-only.
7. El dominio comercial crea, suspende, restaura o revoca el grant append-only. El adapter nunca concede Premium.

El contrato `TournamentPaymentProvider.createPreference` es asíncrono y devuelve una Promise. FAKE implementa el mismo contrato y conserva su doble opt-in local/QA.

## Provider y environments canónicos

| Provider | Environment permitido | Uso |
| --- | --- | --- |
| `FAKE` | `local`, `qa` | Simulación existente con doble opt-in |
| `MERCADO_PAGO` | `test` | Checkout Pro con credenciales TEST |

La documentación actual de Mercado Pago separa credenciales de prueba y producción en **Tus integraciones**. El prefijo del token no es una prueba confiable del ambiente; por eso el runtime usa nombres `*_TEST_*`, exige `MERCADO_PAGO_ENVIRONMENT=test` y compara `collector_id` contra el seller TEST configurado. La DB tampoco admite `MERCADO_PAGO/production`.

## Variables de runtime

Definir fuera del repo, sin mostrar ni copiar valores a tickets, chat, logs o commits:

```text
TOURNAMENT_PAYMENT_PROVIDER
MERCADO_PAGO_ENVIRONMENT
MERCADO_PAGO_TEST_ACCESS_TOKEN
MERCADO_PAGO_TEST_WEBHOOK_SECRET
MERCADO_PAGO_TEST_SELLER_ID
APP_PUBLIC_URL
```

Para Mercado Pago TEST:

- `TOURNAMENT_PAYMENT_PROVIDER` debe seleccionar `MERCADO_PAGO`.
- `MERCADO_PAGO_ENVIRONMENT` debe ser exactamente `test`.
- `APP_PUBLIC_URL` debe ser HTTPS público; localhost, `127.0.0.1` y loopback IPv6 se rechazan.
- `SUPABASE_URL` y la credencial secreta de Supabase son las variables administradas por el runtime de Edge Functions. El webhook se deriva como `${SUPABASE_URL}/functions/v1/tournament-mercadopago-webhook`.

Para FAKE se mantienen `TOURNAMENT_PAYMENT_PROVIDER=FAKE`, `FAKE_PAYMENT_ENABLED=true` y `FAKE_PROVIDER_ENVIRONMENT=local|qa`. La ausencia de configuración nunca selecciona FAKE automáticamente.

## Preference flow

La Preference contiene solamente:

- un item `torneos_premium`, título público, `quantity=1`, `currency_id=ARS` y `unit_price=amount_snapshot`;
- `external_reference=arma2:tournament:purchase:<purchase UUID>`;
- back URLs `exito`, `pendiente` y `fallo` sobre la ruta canónica de Purchase Status;
- `notification_url` del webhook TEST;
- metadata mínima: `purchase_id`;
- vigencia tomada del snapshot temporal de la purchase.

El monto, producto, offer/version, organización y torneo nunca se aceptan desde el browser. El POST a Preferences usa el ID de purchase como idempotency key. Si la purchase ya tiene `provider_preference_id`, el adapter recupera esa Preference en lugar de crear otra.

La respuesta debe pertenecer al seller TEST configurado y su `init_point` debe ser HTTPS bajo un dominio de Mercado Pago. La UI vuelve a validar ese allowlist antes de redirigir.

## Webhook flow y `x-signature`

El endpoint acepta sólo POST y no habilita CORS. Antes de procesar exige:

- payload acotado;
- `type=payment`, `live_mode=false` y `user_id` igual al seller TEST;
- coincidencia entre `data.id` del query y del body;
- `x-request-id` presente;
- `x-signature` con `ts` y `v1` válidos.

El manifest oficial es:

```text
id:<data.id>;request-id:<x-request-id>;ts:<ts>;
```

Se calcula HMAC-SHA256 con el secret TEST y se compara en tiempo constante. No se agrega una caducidad propia al `ts`: el contrato oficial no la exige y Mercado Pago puede reintentar entregas. Los duplicados válidamente firmados quedan contenidos por la idempotencia de las transiciones y eventos comerciales.

Una firma válida no concede acceso. El handler obtiene `/v1/payments/{id}` y `/merchant_orders/{id}` server-side. Para `topic_chargebacks_wh`, primero obtiene `/v1/chargebacks/{id}`, exige `live_mode=false` y un único Payment asociado, y recién entonces realiza las mismas consultas y validaciones del pago.

- payment ID notificado;
- `live_mode=false` en la notificación, Payment y Chargeback cuando corresponda; Merchant Order no expone ese campo en el contrato oficial;
- seller/collector TEST en ambos recursos;
- `external_reference` en ambos recursos;
- `metadata.purchase_id`;
- moneda y monto exactos contra el snapshot;
- `preference_id` contra la purchase;
- que Merchant Order incluya el payment.

Sólo después aplica un RPC service-only. No se guardan Authorization headers ni respuestas completas del provider en logs o metadata.

## Mapping de estados

| Mercado Pago | Dominio | Efecto |
| --- | --- | --- |
| `approved` | `approved` | Grant Premium permanente para la edición |
| `pending`, `in_process`, `authorized` | `pending` | Sin grant |
| `rejected` | `rejected` | Sin grant; permite nueva purchase |
| `cancelled` / `canceled` | `cancelled` | Sin grant |
| cancelled con detail `expired` | `expired` | Sin grant |
| `refunded` | `refunded` | Revoca el grant |
| `charged_back` / `in_mediation`, detail abierto | `charged_back` | Suspende el grant |
| `charged_back`, detail `reimbursed` | `approved` | Restaura el grant |
| `charged_back`, detail `settled` | `charged_back` | Revoca el grant |

Un estado futuro desconocido se acepta sin transición y sin grant. No se inventan estados DB.

## Idempotencia y orden

- `(buyer_user_id,idempotency_key)` evita doble click/retry del cliente.
- El advisory lock y el índice parcial permiten una sola purchase abierta por organización, torneo y producto.
- El índice de preference es único por provider/environment.
- El payment aprobado es único por provider/environment.
- La Preference usa el purchase UUID como idempotency key HTTP.
- Persistir la misma preference es replay; una preference distinta para la misma purchase es conflicto.
- Repetir el mismo estado no agrega eventos equivalentes.
- Pending/rejected tardío no degrada una purchase aprobada o revertida.
- Activación repetida conserva un grant único y un único evento aprobado.
- Refund/chargeback repetidos reutilizan la semántica append-only certificada.

## Seguridad

- **Webhook spoofing/replay:** HMAC oficial, timestamp, TEST seller y reconsulta API.
- **Amount/currency/reference/preference tampering:** comparación exacta contra snapshots y Merchant Order.
- **Cross tenant:** creation requiere `billing.manage`; status exige buyer o capability; búsqueda del webhook es service-only y provider-scoped.
- **Open redirect:** `APP_PUBLIC_URL` HTTPS público y checkout URL limitada a dominios Mercado Pago.
- **SSRF:** el adapter llama sólo a constantes bajo `https://api.mercadopago.com`; IDs aceptan sólo dígitos.
- **CORS:** el webhook no emite CORS. Checkout y status siguen requiriendo JWT verificado en gateway y GoTrue/RPC.
- **service role:** no recibe DML sobre tablas comerciales; sólo ejecuta funciones verificadas y lecturas privadas existentes.
- **Errores/logs:** payloads sanitizados; no se devuelven cuerpos del provider, tokens, secrets ni headers.

## Inventario de grants

El harness `scripts/db-integration/torneos-commercial-checkout.mjs` levanta PostgreSQL embebido real, aplica la foundation más esta migration y consulta el catálogo/ACL efectivo para cada RPC comercial. Para las diez funciones creadas o reemplazadas por el flujo se exige `SECURITY DEFINER`, `search_path=''`, ausencia de `PUBLIC EXECUTE` y la matriz exacta siguiente:

| Rol | Superficie comercial ejecutable |
| --- | --- |
| `anon` | Ninguna de estas diez funciones. Sólo conserva el catálogo público ya certificado fuera de este delta. |
| `authenticated` | `create_tournament_purchase` y el wrapper FAKE preexistente `create_fake_tournament_purchase`; ambos vuelven a autorizar actor/capability dentro de la función. |
| `service_role` | Proyección privada, persistencia de Preference, lookup provider-scoped y transiciones verificadas; también conserva los wrappers FAKE existentes. |
| `PUBLIC` | Ninguna. |

El mismo harness demuestra que `service_role` no tiene DML sobre las tablas comerciales ni puede insertar grants directamente. El inventario global `authenticated-rpc-grants.mjs` sigue siendo más amplio: compara todo el catálogo canónico de Supabase, ejecuta llamadas negativas/positivas por rol y requiere una instancia Supabase local completa. En hosts sin Docker/Podman no existe en el repo un replay global equivalente; allí debe reportarse **BLOCKED por infraestructura local**, nunca PASS. El Quality Gate de GitHub lo ejecuta sobre `npx supabase start`.

## Preparar la primera compra manual TEST

No ejecutar estos pasos con credenciales productivas:

1. Crear o seleccionar una aplicación Checkout Pro en **Tus integraciones**.
2. Activar las credenciales de prueba y usar el Access Token de prueba sólo como secret de runtime.
3. Identificar el seller TEST esperado y cargar su ID fuera del repo.
4. Crear/usar el buyer TEST de Argentina.
5. Disponer de una preview HTTPS pública para `APP_PUBLIC_URL` y del endpoint HTTPS público de Edge Functions.
6. En Webhooks de la aplicación, configurar la URL de **prueba** `.../tournament-mercadopago-webhook`, habilitar eventos de Payments y Contracargos, y cargar el secret generado sólo en runtime.
7. Seleccionar explícitamente provider/environment TEST y ejecutar Plan → Comprar Premium en una ventana incógnita autenticada con el buyer TEST.
8. Confirmar que el retorno sólo muestra Pending hasta que el webhook verificado cambie la proyección server-side.

No pegar ninguna credencial en chat. Esta rama no ejecuta esa compra ni configura infraestructura remota.

## Producción futura (fuera de alcance)

Antes de agregar producción se requiere una etapa y revisión separadas:

- nuevo modelo explícito de environment y credenciales productivas;
- URL y secret de webhook productivos separados;
- rotación, monitoreo, alertas, rate limiting y runbook de incidentes;
- reconciliación de pagos y política de estados parciales;
- validación legal/fiscal, quality integration y rollback probado;
- migración aditiva revisada; nunca relajar el constraint TEST de esta etapa en caliente.

## Disable y rollback

El kill switch primario es quitar o cambiar `TOURNAMENT_PAYMENT_PROVIDER`: el checkout falla cerrado con `payment_provider_disabled`; nunca cae a FAKE. También puede retirarse únicamente la configuración `MERCADO_PAGO_ENVIRONMENT=test`.

No borrar purchases, eventos ni grants históricos. Si el código debe revertirse, deshabilitar primero el provider, conservar webhook/status mientras haya pagos TEST abiertos y revertir la aplicación sin eliminar la migration aditiva. Las reversals verificadas continúan procesándose mediante el dominio comercial para no dejar grants incorrectos.
