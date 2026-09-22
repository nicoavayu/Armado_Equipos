// The only contact between the staging-v1 composition and the Core singleton:
// read the current access token and hear session changes. No sign-in, sign-out,
// refresh ownership, setSession or storage — the singleton keeps all of that.
import { coreSupabase } from '../../../lib/coreSupabaseClient';
import { CORE_AUTH_EVENTS_THAT_CLEAR } from '../foundation/torneosTransport';

export function createCoreSessionBridge(client = coreSupabase, { now = () => Date.now() } = {}) {
  return Object.freeze({
    async getCoreAccessToken() {
      const { data, error } = await client.auth.getSession();
      const session = data?.session;
      if (error || !session || typeof session.access_token !== 'string') return null;
      if (Number.isFinite(session.expires_at) && session.expires_at * 1000 <= now()) return null;
      return session.access_token;
    },
    onCoreAuthChange(listener) {
      const { data } = client.auth.onAuthStateChange((event) => {
        // Synchronous: the transport only drops its cache here.
        if (CORE_AUTH_EVENTS_THAT_CLEAR.includes(event)) listener(event);
      });
      return () => data?.subscription?.unsubscribe?.();
    },
  });
}
