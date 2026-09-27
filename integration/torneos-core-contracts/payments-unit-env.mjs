// MP-A3 — offline fixture configuration of torneos-payments for the T3/T5 unit parts. Fixture values
// only (no lab secret, no real credential); hosts are .invalid so nothing can ever resolve.
export const UNIT_SECRET_HEX = 'a1b2'.repeat(16);
export const UNIT_ENV = Object.freeze({
  TORNEOS_PAYMENT_PROVIDER: 'MERCADO_PAGO', MERCADO_PAGO_ENVIRONMENT: 'test',
  MERCADO_PAGO_TEST_ACCESS_TOKEN: 'TEST-unit-access-token-fixture', MERCADO_PAGO_TEST_WEBHOOK_SECRET: 'unit-webhook-secret-fixture-000000',
  MERCADO_PAGO_TEST_SELLER_ID: '123456789', APP_PUBLIC_URL: 'https://app.unit.invalid',
  TORNEOS_PAYMENTS_NOTIFICATION_URL: 'https://fn.unit.invalid/functions/v1/torneos-payments/webhooks/mercadopago/v1',
  TORNEOS_PAYMENTS_INTERNAL_SECRET: UNIT_SECRET_HEX, TORNEOS_PAYMENTS_DB_URL: 'postgres://payments_login:pw-fixture@db.unit.invalid:5432/postgres',
});
