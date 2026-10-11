// MEDIA-STORE-V1 offline harness: routes the gateway's calls to the torneos-media-store function URL into the REAL
// function (store.ts, loaded from the same transpiled tree), with the hosted configuration (SUPABASE_URL, a secret key,
// a publishable key). The function's own calls — the Data API's authorize_tournament_storage_objects and Storage —
// come back through the caller's fetch emulation. Never touches a network.
import * as G from '../../infra/torneos-gateway-auth/gateway-auth-contract.mjs';

export const STORE_SECRET = 'ab'.repeat(32);
export const SECRET_KEY = 'sb_secret_test_media_store_only';
export const PUBLISHABLE_KEY = 'sb_publishable_test_media_store';
export const ORIGIN = `https://${G.TORNEOS_REF}.supabase.co`;
export const FUNCTION_URL = `${ORIGIN}/functions/v1/torneos-media-store`;

/** The hosted function's environment, as Supabase injects it (plus the shared HMAC secret). */
export const storeEnv = () => ({
  TORNEOS_MEDIA_STORE_SECRET: STORE_SECRET,
  SUPABASE_URL: ORIGIN,
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET_KEY }),
  SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLISHABLE_KEY }),
});

/** Loads the real function and returns a fetch-shaped handler for its URL (or null for any other URL). */
export async function storeRoute(tree, fetchLike) {
  const store = await tree.import('torneos-media-store/store.ts');
  const config = store.loadStoreConfig(storeEnv());
  return {
    store,
    config,
    async handle(url, init) {
      if (!String(url).startsWith(`${FUNCTION_URL}/`)) return null;
      const request = new Request(String(url).replace('/functions/v1/torneos-media-store', '/torneos-media-store'), {
        method: init.method, headers: init.headers, body: init.body,
      });
      return store.handle(request, config, { fetchImpl: (u, i) => fetchLike(u, i) });
    },
  };
}
