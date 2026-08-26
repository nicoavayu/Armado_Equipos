# Arma2 Torneos · checkout comercial antes de Mercado Pago

Esta tranche agrega el dominio comercial y un provider `FAKE` para local/QA. No contiene credenciales, llamadas ni integración con Mercado Pago y no modifica `/pagos/:partidoId`.

## Fuentes de verdad

- `tournament_commercial_products` y `tournament_commercial_offers` resuelven el catálogo vigente. Las ofertas se versionan y una versión referenciada por una compra queda inmutable.
- `tournament_purchases` registra el workflow de pago y conserva snapshots de importe. No concede acceso.
- `tournament_purchase_events` conserva la historia append-only del workflow.
- `tournament_plan_grants` más `tournament_plan_grant_events` determinan el entitlement efectivo. Refunds y chargebacks agregan eventos; nunca borran grants.
- Una edición sin `first_free`, `legacy_grant` o purchase grant efectivo resuelve `PREMIUM_REQUIRED`. Puede configurarse en `draft`, pero no abrir inscripción, publicar ni operar la competencia.

## Superficies

- Catálogo público: `GET /functions/v1/public-tournament-commercial-catalog?v=1`.
- Crear compra FAKE: `POST /functions/v1/tournament-checkout` con sesión de owner/admin.
- Consultar estado: `GET /functions/v1/tournament-purchase-status?purchaseId=<uuid>` o RPC privada `get_tournament_purchase`.
- Crear o simular con el provider FAKE sólo cuando el runtime define simultáneamente `FAKE_PAYMENT_ENABLED=true` y `FAKE_PROVIDER_ENVIRONMENT=local|qa`. La pantalla de estado no llama la simulación.

El runtime FAKE exige un entorno explícito `local` o `qa`; cualquier valor ausente o distinto lo mantiene deshabilitado. No requiere una credencial de proveedor. La Edge Function usa las credenciales normales del runtime Supabase para invocar operaciones service-only.

## Verificación local

```bash
npm run test:db:torneos:commercial
npm run test:edge-functions
CI=true npm test -- --watchAll=false --runInBand \
  src/__tests__/torneosPlanExperience.test.jsx \
  src/__tests__/torneosPurchaseStatus.test.jsx \
  src/__tests__/torneosCommercialRoutes.test.js
npm run migrations:guard
```

La suite PostgreSQL usa una instancia embebida y no se conecta a proyectos remotos.
