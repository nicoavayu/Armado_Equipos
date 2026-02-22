import { supabase } from '../supabase';

const channels = {};

/**
 * Ensures a unique channel per key to avoid duplication.
 * @param {string} key - Unique identifier for the channel (e.g. 'notifs:123')
 * @returns {object|null} - Existing channel if present
 */
const getExistingChannel = (key) => {
  return channels[key] || null;
};

/**
 * Registers a channel and stores reference.
 * @param {string} key 
 * @param {object} channel 
 */
const registerChannel = (key, channel) => {
  if (channels[key]) {
    // If overwriting, ensure old one is cleaned? usually we check exists first.
    console.warn(`[RT] Overwriting channel key: ${key}`);
  }
  channels[key] = channel;
};

/**
 * Removes a channel from registry.
 * @param {string} key 
 */
const unregisterChannel = (key) => {
  delete channels[key];
};

/**
 * Subscribe to notifications for a user.
 * @param {string} userId 
 * @param {function} onEvent - Callback (payload) => void
 * @returns {function} unsubscribe
 */
export const subscribeToNotifications = (userId, onEvent) => {
  const key = `notifs:${userId}`;
  if (!userId) return () => { };

  if (getExistingChannel(key)) {
    console.debug(`[RT] Reusing existing notification channel for ${userId}`);
    // Limitations: reusing channel means we can't easily attach a NEW callback 
    // if the component remounted with a different closure. 
    // For simplicity in this architecture, we will assume one subscriber (Context).
    // If context remounts, it usually cleans up first.
    return () => { };
  }

  console.debug(`[RT] Subscribing to notifications for ${userId}`);
  const channel = supabase
    .channel(key)
    .on(
      'postgres_changes',
      {
        event: '*', // INSERT and UPDATE
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        onEvent(payload);
      },
    )
    .subscribe((status) => {
      console.debug(`[RT] Notifications status for ${userId}:`, status);
    });

  registerChannel(key, channel);

  return () => {
    console.debug(`[RT] Unsubscribing notifications for ${userId}`);
    supabase.removeChannel(channel);
    unregisterChannel(key);
  };
};

/**
 * Subscribe to chat messages for a match.
 * @param {string|number} matchId 
 * @param {function} onInsert - Callback (payload) => void
 * @returns {function} unsubscribe
 */
export const subscribeToMatchChat = (matchId, onInsert) => {
  const key = `chat:${matchId}`;
  if (!matchId) return () => { };

  // For chat, we might mount/unmount components often. 
  // If we already have a channel, we should ideally reuse it, 
  // BUT managing callback updates is tricky without an event emitter.
  // We'll enforce strict remove-on-unmount so we can just create new ones.
  // Ideally, cleanup is called before new subscribe.
  if (getExistingChannel(key)) {
    // Force cleanup old to ensure new callback is attached
    console.debug(`[RT] Cleaning stale chat channel ${key} before resubscribe`);
    const old = channels[key];
    supabase.removeChannel(old);
    unregisterChannel(key);
  }

  console.debug(`[RT] Subscribing to chat ${matchId}`);
  const channel = supabase
    .channel(key)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'mensajes_partido',
        filter: `partido_id=eq.${matchId}`,
      },
      (payload) => {
        onInsert(payload);
      },
    )
    .subscribe();

  registerChannel(key, channel);

  return () => {
    console.debug(`[RT] Unsubscribing chat ${matchId}`);
    supabase.removeChannel(channel);
    unregisterChannel(key);
  };
};

/**
 * Subscribe to chat messages for a team.
 * @param {string} teamId
 * @param {function} onInsert - Callback (payload) => void
 * @returns {function} unsubscribe
 */
export const subscribeToTeamChat = (teamId, onInsert) => {
  const key = `team-chat:${teamId}`;
  if (!teamId) return () => { };

  if (getExistingChannel(key)) {
    console.debug(`[RT] Cleaning stale team chat channel ${key} before resubscribe`);
    const old = channels[key];
    supabase.removeChannel(old);
    unregisterChannel(key);
  }

  console.debug(`[RT] Subscribing to team chat ${teamId}`);
  const channel = supabase
    .channel(key)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'team_chat_messages',
        filter: `team_id=eq.${teamId}`,
      },
      (payload) => {
        onInsert(payload);
      },
    )
    .subscribe();

  registerChannel(key, channel);

  return () => {
    console.debug(`[RT] Unsubscribing team chat ${teamId}`);
    supabase.removeChannel(channel);
    unregisterChannel(key);
  };
};

/**
 * Subscribe to match updates (voting status, results).
 * @param {string|number} matchId 
 * @param {function} onUpdate - Callback (payload) => void
 * @returns {function} unsubscribe
 */
export const subscribeToMatchUpdates = (matchId, onUpdate) => {
  const key = `match:${matchId}`;
  if (!matchId) return () => { };

  if (getExistingChannel(key)) {
    const old = channels[key];
    supabase.removeChannel(old);
    unregisterChannel(key);
  }

  console.debug(`[RT] Subscribing to match updates ${matchId}`);
  const channel = supabase
    .channel(key)
  // Listen for match status changes (e.g. voting_closed)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'partidos',
        filter: `id=eq.${matchId}`,
      },
      (payload) => onUpdate({ type: 'match_update', payload }),
    )
  // Listen for new votes (to update results live)
  // This receives raw vote rows. Frontend should probably just refetch results.
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'votos',
        filter: `partido_id=eq.${matchId}`,
      },
      (payload) => onUpdate({ type: 'votes_update', payload }),
    )
  // Listen for survey results calculation completion
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'survey_results',
        filter: `partido_id=eq.${matchId}`,
      },
      (payload) => onUpdate({ type: 'results_update', payload }),
    )
    .subscribe();

  registerChannel(key, channel);

  return () => {
    console.debug(`[RT] Unsubscribing match updates ${matchId}`);
    supabase.removeChannel(channel);
    unregisterChannel(key);
  };
};
