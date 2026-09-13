import { createClient } from '@supabase/supabase-js';
import { createTorneosClient } from '../../src/features/torneos/isolated/createTorneosClient.js';
export function createSsoClients(config, existingCore) {
  if (config.coreUrl !== 'http://127.0.0.1:58410') throw new Error('local only');
  const supabaseCore = existingCore ?? createClient(config.coreUrl, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
  });
  const adapter = createTorneosClient(supabaseCore, { origin: config.coreUrl, anonKey: config.anonKey });
  return { ...adapter, supabaseCore, dispose() {
    adapter.dispose();
    if (!existingCore) supabaseCore.auth.stopAutoRefresh();
  } };
}
