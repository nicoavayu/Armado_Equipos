import { supabase } from './api/supabase';

// The account's preference for Arma2's external notices (push to the account's phones). A Core preference
// (usuarios.push_enabled) applied by the server where every push is queued (20261008120000_core_push_preference_v1):
// turning it off stops every Arma2 push for the account, including what was already waiting, and never touches
// in-app notices, Torneos' own inbox, device registration or the account itself.
// While Core's migration is not applied yet (a frontend deployed first) the RPC does not exist: the preference is
// reported as unavailable and the screen hides the control instead of showing an error.
const RPC_NOT_FOUND = 'PGRST202';

export async function loadMyCorePushPreference() {
  const { data, error } = await supabase.rpc('get_my_push_preference');
  if (error?.code === RPC_NOT_FOUND) return { available: false, pushEnabled: true };
  if (error) throw error;
  return { available: true, pushEnabled: data?.pushEnabled !== false };
}

export async function saveMyCorePushPreference(enabled) {
  if (typeof enabled !== 'boolean') throw new Error('PUSH_PREFERENCE_REQUIRED');
  const { data, error } = await supabase.rpc('set_my_push_preference', { p_enabled: enabled });
  if (error) throw error;
  return { pushEnabled: data?.pushEnabled !== false };
}
