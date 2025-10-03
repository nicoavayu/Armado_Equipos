import { supabase } from '../../lib/supabaseClient';

/**
 * Subscribe to real-time changes
 * @param {Function} callback - Callback function for changes
 * @returns {Object} Subscription object
 */
export const subscribeToChanges = (callback) => {
  const subscription = supabase
    .channel('public-changes')
    .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
      console.log('Change received!', payload);
      callback(payload);
    })
    .subscribe();
  return subscription;
};

/**
 * Remove a subscription
 * @param {Object} subscription - Subscription to remove
 */
export const removeSubscription = (subscription) => {
  supabase.removeChannel(subscription);
};