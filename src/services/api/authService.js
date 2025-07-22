/**
 * Auth Service
 * 
 * This service handles all authentication-related operations including:
 * - User authentication
 * - Session management
 * - Guest sessions
 */

import { supabase } from './supabase';
import { createOrUpdateProfile } from './playerService';

/**
 * Sign in with email and password
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<Object>} Auth response
 */
export const signInWithEmail = async (email, password) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  
  if (error) throw error;
  
  // Create or update profile
  if (data?.user) {
    try {
      await createOrUpdateProfile(data.user);
    } catch (profileError) {
      console.error('Error creating/updating profile:', profileError);
      // Continue even if profile update fails
    }
  }
  
  return data;
};

/**
 * Sign up with email and password
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<Object>} Auth response
 */
export const signUpWithEmail = async (email, password) => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password
  });
  
  if (error) throw error;
  
  // Create or update profile
  if (data?.user) {
    try {
      await createOrUpdateProfile(data.user);
    } catch (profileError) {
      console.error('Error creating/updating profile:', profileError);
      // Continue even if profile update fails
    }
  }
  
  return data;
};

/**
 * Sign in with Google OAuth
 * @returns {Promise<Object>} Auth response
 */
export const signInWithGoogle = async () => {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin
    }
  });
  
  if (error) throw error;
  return data;
};

/**
 * Sign out current user
 * @returns {Promise<void>}
 */
export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
};

/**
 * Get current user
 * @returns {Promise<Object|null>} Current user or null if not authenticated
 */
export const getCurrentUser = async () => {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    console.error('Error getting current user:', error);
    return null;
  }
  return data?.user || null;
};

/**
 * Get current session
 * @returns {Promise<Object|null>} Current session or null if not authenticated
 */
export const getCurrentSession = async () => {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error('Error getting current session:', error);
    return null;
  }
  return data?.session || null;
};

/**
 * Reset password
 * @param {string} email - User email
 * @returns {Promise<Object>} Reset response
 */
export const resetPassword = async (email) => {
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`
  });
  
  if (error) throw error;
  return data;
};

/**
 * Update user password
 * @param {string} password - New password
 * @returns {Promise<Object>} Update response
 */
export const updatePassword = async (password) => {
  const { data, error } = await supabase.auth.updateUser({
    password
  });
  
  if (error) throw error;
  return data;
};

/**
 * Update user email
 * @param {string} email - New email
 * @returns {Promise<Object>} Update response
 */
export const updateEmail = async (email) => {
  const { data, error } = await supabase.auth.updateUser({
    email
  });
  
  if (error) throw error;
  return data;
};

/**
 * Set up auth state change listener
 * @param {Function} callback - Function to call when auth state changes
 * @returns {Function} Unsubscribe function
 */
export const onAuthStateChange = (callback) => {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
  
  return data.subscription.unsubscribe;
};

// Export all functions
export default {
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
  signOut,
  getCurrentUser,
  getCurrentSession,
  resetPassword,
  updatePassword,
  updateEmail,
  onAuthStateChange
};