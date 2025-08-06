import { useState, useEffect, useCallback } from 'react';
import { supabase, getAmigos as getAmigosFromSupabase } from '../supabase';
import { useNotifications } from '../context/NotificationContext';

/**
 * Hook for managing friend relationships
 * @returns {Object} Friend management functions and state
 */
export const useAmigos = (currentUserId) => {
  const [amigos, setAmigos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { createNotification } = useNotifications();

  // Get all friends with status 'accepted' usando la nueva función refactorizada
  const getAmigos = useCallback(async () => {
    if (!currentUserId) {
      console.log('[HOOK_AMIGOS] No currentUserId provided');
      setAmigos([]);
      return [];
    }
    
    console.log('[HOOK_AMIGOS] Fetching friends for user:', currentUserId);
    setLoading(true);
    setError(null);
    
    try {
      // Usar la función refactorizada que devuelve usuarios directos
      const friendUsers = await getAmigosFromSupabase(currentUserId);
      
      console.log('[HOOK_AMIGOS] Friends received from supabase function:', {
        count: friendUsers?.length || 0,
        sample: friendUsers?.slice(0, 2).map((u) => ({ id: u.id, nombre: u.nombre })) || [],
      });
      
      // Convertir a formato esperado por la UI (con profile wrapper)
      const formattedAmigos = friendUsers.map((user) => ({
        id: user.id, // Usar el ID del usuario como ID de la "amistad"
        status: 'accepted',
        created_at: new Date().toISOString(),
        profile: user, // El usuario completo va en profile
      }));
      
      console.log('[HOOK_AMIGOS] Formatted friends for UI:', {
        count: formattedAmigos.length,
        sample: formattedAmigos.slice(0, 2).map((a) => ({ 
          id: a.id, 
          profileName: a.profile?.nombre,
          profileId: a.profile?.id,
        })) || [],
      });
      
      setAmigos(formattedAmigos);
      return formattedAmigos;
    } catch (err) {
      console.error('[HOOK_AMIGOS] Error fetching friends:', err);
      console.error('[HOOK_AMIGOS] Error context:', { userId: currentUserId });
      setError(err.message);
      setAmigos([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  // Get relationship status with a specific player
  const getRelationshipStatus = useCallback(async (playerId) => {
    if (!currentUserId || !playerId) {
      console.log('[AMIGOS] getRelationshipStatus: Missing parameters', { currentUserId, playerId });
      return null;
    }
    
    console.log('[AMIGOS] Checking relationship status between users:', { currentUserId, playerId });
    try {
      // Ensure we're working with UUIDs
      const userIdUuid = typeof currentUserId === 'string' ? currentUserId : String(currentUserId);
      const friendIdUuid = typeof playerId === 'string' ? playerId : String(playerId);
      
      console.log('[AMIGOS] Using UUID values:', { userIdUuid, friendIdUuid });
      
      // Check if there's a relationship where current user is user_id
      console.log('[AMIGOS] Checking if current user is the requester (user_id)');
      const { data, error } = await supabase
        .from('amigos')
        .select('id, status')
        .eq('user_id', userIdUuid)
        .eq('friend_id', friendIdUuid)
        .maybeSingle();
        
      if (error) {
        console.error('[AMIGOS] Error checking relationship as user_id:', error);
        throw error;
      }
      
      if (data) {
        console.log('[AMIGOS] Relationship found as user_id:', data);
        return data;
      }
      
      // Check if there's a relationship where current user is friend_id
      console.log('[AMIGOS] Checking if current user is the receiver (friend_id)');
      const { data: reverseData, error: reverseError } = await supabase
        .from('amigos')
        .select('id, status')
        .eq('user_id', friendIdUuid)
        .eq('friend_id', userIdUuid)
        .maybeSingle();
        
      if (reverseError) {
        console.error('[AMIGOS] Error checking relationship as friend_id:', reverseError);
        throw reverseError;
      }
      
      console.log('[AMIGOS] Relationship found as friend_id:', reverseData || 'No relationship found');
      return reverseData;
    } catch (err) {
      console.error('[AMIGOS] Error getting relationship status:', err);
      console.error('[AMIGOS] Error context:', { currentUserId, playerId });
      return null;
    }
  }, [currentUserId]);

  // Send friend request
  const sendFriendRequest = useCallback(async (friendId) => {
    if (!currentUserId || !friendId) {
      console.log('[AMIGOS] sendFriendRequest: Missing parameters', { currentUserId, friendId });
      return { success: false, message: 'Faltan parámetros necesarios' };
    }
    
    console.log('[AMIGOS] Sending friend request:', { from: currentUserId, to: friendId });
    try {
      // Ensure we're working with UUIDs
      const userIdUuid = typeof currentUserId === 'string' ? currentUserId : String(currentUserId);
      const friendIdUuid = typeof friendId === 'string' ? friendId : String(friendId);
      
      console.log('[AMIGOS] Using UUID values:', { userIdUuid, friendIdUuid });
      
      // Check if a relationship already exists
      console.log('[AMIGOS] Checking if relationship already exists');
      const existingRelation = await getRelationshipStatus(friendIdUuid);
      
      let data;
      if (existingRelation) {
        console.log('[AMIGOS] Relationship already exists:', existingRelation);
        
        if (existingRelation.status === 'rejected') {
          // Update existing rejected relationship to pending
          console.log('[AMIGOS] Updating rejected relationship to pending');
          const { data: updateData, error } = await supabase
            .from('amigos')
            .update({ 
              status: 'pending',
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingRelation.id)
            .select()
            .single();
            
          if (error) {
            console.error('[AMIGOS] Error updating friend request:', error);
            throw error;
          }
          
          data = updateData;
        } else {
          // Other statuses (pending, accepted) should not allow new requests
          return { success: false, message: 'Ya existe una relación con este jugador' };
        }
      } else {
        // Create new friend request
        console.log('[AMIGOS] Creating new friend request');
        const { data: insertData, error } = await supabase
          .from('amigos')
          .insert([{
            user_id: userIdUuid,
            friend_id: friendIdUuid,
            status: 'pending',
          }])
          .select()
          .single();
          
        if (error) {
          console.error('[AMIGOS] Error inserting friend request:', error);
          throw error;
        }
        
        data = insertData;
      }

      
      console.log('[AMIGOS] Friend request created successfully:', data);
      
      // Create notification for the friend
      try {
        // Get sender's profile to include in notification
        const { data: senderProfile } = await supabase
          .from('usuarios')
          .select('nombre')
          .eq('id', userIdUuid)
          .single();
          
        // Create notification in the database for the recipient
        const notificationResult = await supabase
          .from('notifications')
          .insert([{
            user_id: friendIdUuid,
            type: 'friend_request',
            title: 'Nueva solicitud de amistad',
            message: `${senderProfile?.nombre || 'Alguien'} te ha enviado una solicitud de amistad`,
            data: { 
              requestId: data.id, 
              senderId: userIdUuid,
              senderName: senderProfile?.nombre || 'Alguien',
            },
            read: false,
            created_at: new Date().toISOString(),
          }])
          .select()
          .single();
          
        console.log('[AMIGOS] Notification created:', notificationResult.data);
      } catch (notifError) {
        console.error('[AMIGOS] Error creating notification:', notifError);
        // Continue even if notification creation fails
      }
      
      return { success: true, data };
    } catch (err) {
      console.error('[AMIGOS] Error sending friend request:', err);
      console.error('[AMIGOS] Error context:', { currentUserId, friendId });
      return { success: false, message: err.message };
    }
  }, [currentUserId, getRelationshipStatus]);

  // Accept friend request
  const acceptFriendRequest = useCallback(async (requestId) => {
    if (!requestId) {
      console.log('[AMIGOS] acceptFriendRequest: No requestId provided');
      return { success: false, message: 'ID de solicitud no proporcionado' };
    }
    
    console.log('[AMIGOS] Accepting friend request:', requestId);
    try {
      // Ensure we're working with UUID for the request ID
      const requestIdUuid = typeof requestId === 'string' ? requestId : String(requestId);
      
      const { data, error } = await supabase
        .from('amigos')
        .update({ status: 'accepted' })
        .eq('id', requestIdUuid)
        .select()
        .single();
        
      if (error) {
        console.error('[AMIGOS] Error updating friend request status:', error);
        throw error;
      }
      
      console.log('[AMIGOS] Friend request accepted successfully:', data);
      
      // Create notification for the sender that their request was accepted
      try {
        // Get accepter's profile to include in notification
        const { data: accepterProfile } = await supabase
          .from('usuarios')
          .select('nombre')
          .eq('id', currentUserId)
          .single();
          
        // Create notification in the database for the sender
        await supabase
          .from('notifications')
          .insert([{
            user_id: data.user_id, // The original sender of the request
            type: 'friend_accepted',
            title: 'Solicitud de amistad aceptada',
            message: `${accepterProfile?.nombre || 'Alguien'} ha aceptado tu solicitud de amistad`,
            data: { friendshipId: data.id },
            read: false,
            created_at: new Date().toISOString(),
          }]);
      } catch (notifError) {
        console.error('[AMIGOS] Error creating notification:', notifError);
        // Continue even if notification creation fails
      }
      
      // Refresh friends list
      getAmigos();
      return { success: true, data };
    } catch (err) {
      console.error('[AMIGOS] Error accepting friend request:', err);
      console.error('[AMIGOS] Error context:', { requestId });
      return { success: false, message: err.message };
    }
  }, [getAmigos]);

  // Reject friend request
  const rejectFriendRequest = useCallback(async (requestId) => {
    if (!requestId) {
      console.log('[AMIGOS] rejectFriendRequest: No requestId provided');
      return { success: false, message: 'ID de solicitud no proporcionado' };
    }
    
    console.log('[AMIGOS] Rejecting friend request:', requestId);
    try {
      // Ensure we're working with UUID for the request ID
      const requestIdUuid = typeof requestId === 'string' ? requestId : String(requestId);
      
      const { data, error } = await supabase
        .from('amigos')
        .update({ status: 'rejected' })
        .eq('id', requestIdUuid)
        .select()
        .single();
        
      if (error) {
        console.error('[AMIGOS] Error updating friend request status:', error);
        throw error;
      }
      
      console.log('[AMIGOS] Friend request rejected successfully:', data);
      
      // Create notification for the sender that their request was rejected
      try {
        // Create notification in the database for the sender
        await supabase
          .from('notifications')
          .insert([{
            user_id: data.user_id, // The original sender of the request
            type: 'friend_rejected',
            title: 'Solicitud de amistad rechazada',
            message: 'Tu solicitud de amistad ha sido rechazada',
            data: { requestId: data.id },
            read: false,
            created_at: new Date().toISOString(),
          }]);
      } catch (notifError) {
        console.error('[AMIGOS] Error creating notification:', notifError);
        // Continue even if notification creation fails
      }
      
      return { success: true, data };
    } catch (err) {
      console.error('[AMIGOS] Error rejecting friend request:', err);
      console.error('[AMIGOS] Error context:', { requestId });
      return { success: false, message: err.message };
    }
  }, []);

  // Remove friend
  const removeFriend = useCallback(async (friendUserId) => {
    if (!friendUserId || !currentUserId) {
      console.log('[AMIGOS] removeFriend: Missing parameters', { friendUserId, currentUserId });
      return { success: false, message: 'Parámetros faltantes' };
    }
    
    console.log('[AMIGOS] Removing friendship with user:', friendUserId);
    try {
      // Ensure we're working with UUIDs
      const userIdUuid = typeof currentUserId === 'string' ? currentUserId : String(currentUserId);
      const friendIdUuid = typeof friendUserId === 'string' ? friendUserId : String(friendUserId);
      
      // Delete friendship where current user is user_id and friend is friend_id
      const { error: error1 } = await supabase
        .from('amigos')
        .delete()
        .eq('user_id', userIdUuid)
        .eq('friend_id', friendIdUuid);
        
      // Delete friendship where current user is friend_id and friend is user_id
      const { error: error2 } = await supabase
        .from('amigos')
        .delete()
        .eq('user_id', friendIdUuid)
        .eq('friend_id', userIdUuid);
        
      if (error1 && error2) {
        console.error('[AMIGOS] Error deleting friendship:', error1, error2);
        throw error1;
      }
      
      console.log('[AMIGOS] Friendship removed successfully');
      // Refresh friends list
      await getAmigos();
      return { success: true };
    } catch (err) {
      console.error('[AMIGOS] Error removing friend:', err);
      console.error('[AMIGOS] Error context:', { friendUserId, currentUserId });
      return { success: false, message: err.message };
    }
  }, [getAmigos, currentUserId]);

  // Get pending friend requests (received)
  const getPendingRequests = useCallback(async () => {
    if (!currentUserId) {
      console.log('[AMIGOS] getPendingRequests: No currentUserId provided');
      return [];
    }
    
    console.log('[AMIGOS] Fetching pending friend requests for user:', currentUserId);
    try {
      // Ensure we're working with UUID
      const userIdUuid = typeof currentUserId === 'string' ? currentUserId : String(currentUserId);
      
      const { data, error } = await supabase
        .from('amigos')
        .select(`
          id, 
          status, 
          created_at,
          user_id,
          usuarios!user_id(id, nombre, avatar_url, email, posicion, ranking, partidos_jugados, pais_codigo, numero)
        `)
        .eq('friend_id', userIdUuid)
        .eq('status', 'pending');
        
      if (error) {
        console.error('[AMIGOS] Error fetching pending requests:', error);
        throw error;
      }
      
      console.log('[AMIGOS] Pending requests fetched:', data?.length || 0, 'results');
      
      // Log the raw data for debugging
      if (data && data.length > 0) {
        console.log('[AMIGOS] Sample pending request data:', data[0]);
      }
      
      const formattedRequests = data.map((item) => ({
        id: item.id,
        status: item.status,
        created_at: item.created_at,
        profile: item.usuarios,
      }));
      
      console.log('[AMIGOS] Formatted pending requests:', formattedRequests.length);
      return formattedRequests;
    } catch (err) {
      console.error('[AMIGOS] Error fetching pending requests:', err);
      console.error('[AMIGOS] Error context:', { userId: encodeURIComponent(currentUserId || '') });
      return [];
    }
  }, [currentUserId]);

  // Load friends on mount if currentUserId is available
  useEffect(() => {
    if (currentUserId) {
      getAmigos();
    }
  }, [currentUserId]); // Removed getAmigos from dependencies to prevent infinite loop

  return {
    amigos,
    loading,
    error,
    getAmigos,
    getRelationshipStatus,
    sendFriendRequest,
    acceptFriendRequest,
    rejectFriendRequest,
    removeFriend,
    getPendingRequests,
  };
};