// MP-A5 commerce scope of the hybrid composition, a snapshot of the MP-A4 gateway contract
// (torneos-gateway/commerce.ts + commerce-test-rpc-allowlist.json); guards verify equality.
//
//   • three reads through the generic RPC route, on top of the 43 staging-v1 RPCs
//   • the fixed checkout route of the gateway (a write, never an RPC) and, in production, the purchase refresh route
//
// Like the staging-v1 scope this only restricts the client; the gateway allowlist, the DB ACL
// and the commerce mode of the gateway decide what is actually served.
export const STAGING_V1_COMMERCE_READS = Object.freeze([
  'get_effective_tournament_season_entitlements',
  'get_tournament_purchase',
  'get_tournament_season_purchases',
]);

export const SEASON_CHECKOUT_PATH = '/commerce/v1/season-checkout';
// COMMERCE-PRODUCTION: "I already paid" — the gateway re-reads the purchase from Mercado Pago (production only; the
// TEST gateway answers 404 and the page keeps its plain read).
export const PURCHASE_REFRESH_PATH = '/commerce/v1/purchase-refresh';
export const COMMERCE_PATHS = Object.freeze([SEASON_CHECKOUT_PATH, PURCHASE_REFRESH_PATH]);

const permitted = new Set(STAGING_V1_COMMERCE_READS);
export const isStagingV1CommerceRead = (name) => typeof name === 'string' && permitted.has(name);
