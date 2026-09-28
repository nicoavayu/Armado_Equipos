// The only contact between the staging-v1 composition and the Core singleton:
// read the current access token and hear session changes. No sign-in, sign-out,
// refresh ownership, setSession or storage — the singleton keeps all of that.
import { coreSupabase } from '../../../lib/coreSupabaseClient';
import { CORE_AUTH_EVENTS_THAT_CLEAR, CORE_AUTH_RENEWAL_EVENTS } from '../foundation/torneosTransport';

// auth-js may hand a session whose user is a throwing proxy (userStorage without a stored user):
// such a session has no readable identity.
function userIdOf(session) {
  try {
    const id = session?.user?.id;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

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
      // The identity this subscription last saw (INITIAL_SESSION included). A TOKEN_REFRESHED or
      // SIGNED_IN for that same user is a renewal (auth-js re-announces the session on refresh and on
      // every hidden→visible tab transition); anything unattributable is not.
      let knownUserId = null;
      const { data } = client.auth.onAuthStateChange((event, session) => {
        const userId = userIdOf(session);
        const sameIdentity = CORE_AUTH_RENEWAL_EVENTS.includes(event) && userId !== null && userId === knownUserId;
        knownUserId = event === 'SIGNED_OUT' ? null : userId;
        // Synchronous: the transport only drops its cache here.
        if (CORE_AUTH_EVENTS_THAT_CLEAR.includes(event)) listener(event, { sameIdentity });
      });
      return () => data?.subscription?.unsubscribe?.();
    },
  });
}
