import logger from '../utils/logger';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

// Diagnostic logging
if (process.env.NODE_ENV === 'development') {
  logger.debug('[SB_URL]', supabaseUrl);
  logger.debug('[SB_KEY_LEN]', supabaseAnonKey?.length);
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

export default supabase;
