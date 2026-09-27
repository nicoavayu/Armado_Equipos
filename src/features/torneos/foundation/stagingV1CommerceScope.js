// MP-A5 commerce scope of the hybrid composition, a snapshot of the MP-A4 gateway contract
// (torneos-gateway/commerce.ts + commerce-test-rpc-allowlist.json); guards verify equality.
//
//   • two reads through the generic RPC route, on top of the 43 staging-v1 RPCs
//   • one write, never an RPC: the fixed checkout route of the gateway
//
// Like the staging-v1 scope this only restricts the client; the gateway allowlist, the DB ACL
// and the commerce mode of the gateway decide what is actually served.
export const STAGING_V1_COMMERCE_READS = Object.freeze([
  'get_effective_tournament_season_entitlements',
  'get_tournament_purchase',
]);

export const SEASON_CHECKOUT_PATH = '/commerce/v1/season-checkout';

const permitted = new Set(STAGING_V1_COMMERCE_READS);
export const isStagingV1CommerceRead = (name) => typeof name === 'string' && permitted.has(name);
