// Phase 1.5 is executable only on this loopback laboratory, never a deployed host.
export function resolveIsolatedSso(env, location) {
  return env.REACT_APP_TORNEOS_ISOLATED_SSO === 'true'
    && env.REACT_APP_DEPLOY_ENV === 'test'
    && env.REACT_APP_LOCAL_EDIT_MODE === 'false'
    && env.REACT_APP_SUPABASE_URL === 'http://127.0.0.1:58410'
    && location?.origin === 'http://127.0.0.1:58410';
}
export const isolatedSsoEnabled = resolveIsolatedSso(process.env,
  typeof window === 'undefined' ? null : window.location);
export const isolatedOrigin = 'http://127.0.0.1:58410';
