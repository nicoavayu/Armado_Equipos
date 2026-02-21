// DEPRECATED SHIM — reexport to new modules
export { supabase } from './lib/supabaseClient';
export * from './services/db/notifications';
export * from './services/db/surveys';
export * from './services/db/matches';
export * from './services/db/profiles';
export { addFreePlayer, removeFreePlayer, getFreePlayerStatus } from './services/api/playerService';
export * from './services/db/friends';
export * from './services/db/frequentMatches';
export * from './services/db/realtime';
export * from './services/db/teams';
export * from './services/db/teamChallenges';

// Export default for backward compatibility
export { default } from './lib/supabaseClient';
