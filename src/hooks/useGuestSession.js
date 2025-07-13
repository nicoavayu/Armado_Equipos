import { useEffect } from 'react';
import { getCurrentUserId } from '../supabase';

// Hook to ensure guest session is initialized for URL-based access
export const useGuestSession = (partidoId) => {
  useEffect(() => {
    if (partidoId) {
      // Initialize guest session for this match
      getCurrentUserId(partidoId).then(userId => {
        console.log('Guest session initialized:', { partidoId, userId, isGuest: userId.startsWith('guest_') });
      }).catch(error => {
        console.error('Error initializing guest session:', error);
      });
    }
  }, [partidoId]);
};