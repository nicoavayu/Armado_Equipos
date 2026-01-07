// DEPRECATED SHIM — reexport to new modules
export { supabase } from './lib/supabaseClient';
export * from './services/db/notifications';
export * from './services/db/surveys';
export * from './services/db/matches';
export * from './services/db/profiles';
export { removeFreePlayer } from './services/db/profiles';
export * from './services/db/friends';
export * from './services/db/frequentMatches';
export * from './services/db/realtime';

// Export default for backward compatibility
export { default } from './lib/supabaseClient';