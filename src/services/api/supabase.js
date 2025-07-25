/**
 * Supabase API Client
 * 
 * This file provides the base Supabase client instance and common utility functions.
 * It centralizes the Supabase connection to ensure consistent usage across the app.
 */

import { createClient } from '@supabase/supabase-js';

// Get environment variables
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

// Create and export the Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Generate a unique guest session ID for a specific match
 * @param {number|string} partidoId - Match ID
 * @returns {string} Unique guest session ID
 */
export const getGuestSessionId = (partidoId) => {
  const storageKey = `guest_session_${partidoId}`;
  let guestId = localStorage.getItem(storageKey);
  if (!guestId) {
    guestId = `guest_${partidoId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem(storageKey, guestId);
  }
  return guestId;
};

/**
 * Get current user ID (authenticated user or guest session)
 * @param {number|string|null} partidoId - Match ID (optional)
 * @returns {Promise<string>} User ID or guest session ID
 */
export const getCurrentUserId = async (partidoId = null) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.id) {
    return user.id;
  }
  // For guests, we need a match-specific ID
  if (partidoId) {
    return getGuestSessionId(partidoId);
  }
  // Fallback for general guest ID
  let guestId = localStorage.getItem('guest_session_id');
  if (!guestId) {
    guestId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('guest_session_id', guestId);
  }
  return guestId;
};

/**
 * Clear guest session for a specific match (useful for testing)
 * @param {number|string|null} partidoId - Match ID (optional)
 */
export const clearGuestSession = (partidoId) => {
  if (partidoId) {
    localStorage.removeItem(`guest_session_${partidoId}`);
    console.log(`Cleared guest session for match ${partidoId}`);
  } else {
    // Clear all guest sessions
    const keys = Object.keys(localStorage).filter((key) => key.startsWith('guest_session'));
    keys.forEach((key) => localStorage.removeItem(key));
    console.log(`Cleared ${keys.length} guest sessions`);
  }
};

/**
 * Subscribe to real-time changes in Supabase
 * @param {Function} callback - Function to call when changes occur
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
 * Remove a Supabase subscription
 * @param {Object} subscription - Subscription to remove
 */
export const removeSubscription = (subscription) => {
  supabase.removeChannel(subscription);
};

/**
 * Generate a random code for a match
 * @param {number} length - Length of the code (default: 6)
 * @returns {string} Random alphanumeric code
 */
export const generarCodigoPartido = (length = 6) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++)
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
};

// Export default for convenience
export default supabase;