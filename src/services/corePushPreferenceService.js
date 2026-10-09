import { supabase } from './api/supabase';

// The account's preference for Arma2's external notices (push to the account's phones). A Core preference
// (usuarios.push_enabled) applied by the server where every push is queued (20261008120000_core_push_preference_v1):
// turning it off stops every Arma2 push for the account, including what was already waiting, and never touches
// in-app notices, Torneos' own inbox, device registration or the account itself.
// While Core's migration is not applied yet (a frontend deployed first) the RPC does not exist, and after Core's safe
// rollback (supabase/rollbacks/20261008120000_core_push_preference_v1.safe.sql) clients may no longer execute it: in
// both cases the preference is reported as unavailable and the screen hides the control instead of showing an error.
const RPC_NOT_FOUND = 'PGRST202';
const RPC_NOT_GRANTED = '42501'; // the function's own 42501 (AUTH_REQUIRED, no session) stays an error

export async function loadMyCorePushPreference() {
  const { data, error } = await supabase.rpc('get_my_push_preference');
  const revoked = error?.code === RPC_NOT_GRANTED && error?.message !== 'AUTH_REQUIRED';
  if (error?.code === RPC_NOT_FOUND || revoked) return { available: false, pushEnabled: true };
  if (error) throw error;
  return { available: true, pushEnabled: data?.pushEnabled !== false };
}

export async function saveMyCorePushPreference(enabled) {
  if (typeof enabled !== 'boolean') throw new Error('PUSH_PREFERENCE_REQUIRED');
  const { data, error } = await supabase.rpc('set_my_push_preference', { p_enabled: enabled });
  if (error) throw error;
  return { pushEnabled: data?.pushEnabled !== false };
}
