// Explicit Core boundary. Re-export the SAME singleton, preserving its session,
// storage key, refresh ownership, fetch wrapper and every legacy import.
export { supabase as coreSupabase, supabase as default } from './supabaseClient';
