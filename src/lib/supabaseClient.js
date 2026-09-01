import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

const apiKeyOnlyFetch = async (input, init = {}) => {
  const headers = new Headers(init.headers);
  const authorization = headers.get('Authorization');
  const bearerMatch = authorization?.match(/^Bearer\s+(.+)$/i);

  if (bearerMatch?.[1] === supabaseAnonKey) {
    headers.delete('Authorization');
  }
  headers.set('apikey', supabaseAnonKey);

  return fetch(input, { ...init, headers });
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: apiKeyOnlyFetch },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

export default supabase;
