import { createClient } from '@supabase/supabase-js';

// Reuses Core's singleton. No Core sign-in, sign-out, storage or refresh ownership.
export function createTorneosClient(supabaseCore, { origin, anonKey, fetchImpl = fetch, now = () => Date.now() }) {
  if (origin !== 'http://127.0.0.1:58410' || supabaseCore.supabaseUrl.replace(/\/$/, '') !== origin) {
    throw new Error('Isolated SSO requires the local Core');
  }
  let cached = null;
  let pending = null;
  let generation = 0;
  let disposed = false;
  const clear = () => { generation += 1; cached = null; pending = null; };
  const { data: { subscription } } = supabaseCore.auth.onAuthStateChange((event) => {
    // Synchronous callback: never call another Auth method under GoTrue's lock.
    if (['SIGNED_OUT', 'SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) clear();
  });
  async function accessToken() {
    if (disposed) throw new Error('Torneos client disposed');
    const { data, error } = await supabaseCore.auth.getSession();
    const session = data?.session;
    if (error || !session || session.expires_at * 1000 <= now()) {
      clear();
      throw new Error('Core authorization required');
    }
    const coreToken = session.access_token;
    if (cached?.coreToken === coreToken && cached.until > now() + 20000) return cached.token;
    if (pending?.coreToken !== coreToken) {
      clear();
      const started = generation;
      const request = (async () => {
        const response = await fetchImpl(`${origin}/exchange`, {
          method: 'POST', headers: { Authorization: `Bearer ${coreToken}` },
          credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error('Torneos authorization unavailable');
        const result = await response.json();
        if (started !== generation || disposed) throw new Error('Core session changed');
        if (typeof result.access_token !== 'string' || result.token_type !== 'Bearer'
          || result.expires_in !== 120) throw new Error('Invalid exchange response');
        cached = { token: result.access_token, coreToken, until: now() + result.expires_in * 1000 };
        return cached.token;
      })();
      pending = { coreToken, request };
      request.finally(() => { if (pending?.request === request) pending = null; }).catch(() => {});
    }
    return pending.request;
  }
  const guardedFetch = async (input, init) => {
    try {
      const response = await fetchImpl(input, init);
      if (!response.ok) clear();
      return response;
    } catch {
      clear();
      throw new Error('Torneos unavailable');
    }
  };
  const supabaseTorneos = createClient(`${origin}/torneos`, anonKey, {
    accessToken, global: { fetch: guardedFetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { supabaseTorneos, clear, dispose() { disposed = true; clear(); subscription.unsubscribe(); } };
}
