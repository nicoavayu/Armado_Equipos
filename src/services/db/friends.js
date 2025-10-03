import { supabase } from '../../lib/supabaseClient';

/**
 * Get all friends for a user with status 'accepted'
 * @param {string} userId - Current user ID (UUID)
 * @returns {Promise<Array>} Array of friend users
 */
export const getAmigos = async (userId) => {
  if (!userId) return [];
  
  console.log('[GET_AMIGOS] Fetching friends for user:', userId);
  
  try {
    // 1. Traer relaciones donde user_id = userId y status = \"accepted\"
    const { data: directFriends, error: directError } = await supabase
      .from('amigos')
      .select('friend_id')
      .eq('user_id', userId)
      .eq('status', 'accepted');
      
    if (directError) throw directError;
    
    // 2. Traer relaciones donde friend_id = userId y status = \"accepted\"
    const { data: reverseFriends, error: reverseError } = await supabase
      .from('amigos')
      .select('user_id')
      .eq('friend_id', userId)
      .eq('status', 'accepted');
      
    if (reverseError) throw reverseError;
    
    // 3. Armar array con los IDs del otro usuario en cada relación
    const friendIds = [
      ...(directFriends || []).map((f) => f.friend_id),
      ...(reverseFriends || []).map((f) => f.user_id),
    ];
    
    // Eliminar duplicados y el propio userId
    const uniqueFriendIds = [...new Set(friendIds)].filter((id) => id !== userId);
    
    console.log('[GET_AMIGOS] userId:', userId, 'allIds:', uniqueFriendIds);
    
    if (uniqueFriendIds.length === 0) {
      console.log('[GET_AMIGOS] No friends found');
      return [];
    }
    
    // 4. Hacer SELECT * FROM usuarios WHERE id IN (...) para traer datos completos
    const { data: users, error: usersError } = await supabase
      .from('usuarios')
      .select('*')
      .in('id', uniqueFriendIds);
      
    if (usersError) throw usersError;
    
    console.log('[GET_AMIGOS] userId:', userId, 'allIds:', uniqueFriendIds, 'users:', users?.length || 0);
    
    return users || [];
    
  } catch (err) {
    console.error('[GET_AMIGOS] Error fetching friends:', err);
    throw err;
  }
};

/**
 * Get relationship status between current user and another player
 * @param {string} userId - Current user ID
 * @param {string} friendId - Other player ID
 * @returns {Promise<Object|null>} Relationship status or null
 */
export const getRelationshipStatus = async (userId, friendId) => {
  if (!userId || !friendId) return null;
  
  try {
    // Check if there's a relationship where current user is user_id
    const { data, error } = await supabase
      .from('amigos')
      .select('id, status')
      .eq('user_id', userId)
      .eq('friend_id', friendId)
      .maybeSingle();
      
    if (error) throw error;
    
    if (data) return data;
    
    // Check if there's a relationship where current user is friend_id
    const { data: reverseData, error: reverseError } = await supabase
      .from('amigos')
      .select('id, status')
      .eq('user_id', friendId)
      .eq('friend_id', userId)
      .maybeSingle();
      
    if (reverseError) throw reverseError;
    
    return reverseData;
  } catch (err) {
    console.error('Error getting relationship status:', err);
    return null;
  }
};

/**
 * Send a friend request
 * @param {string} userId - Current user ID
 * @param {string} friendId - Player ID to send request to
 * @returns {Promise<Object>} Result of the operation
 */
export const sendFriendRequest = async (userId, friendId) => {
  if (!userId || !friendId) {
    return { success: false, message: 'IDs de usuario inválidos' };
  }
  
  try {
    // Check if a relationship already exists
    const existingRelation = await getRelationshipStatus(userId, friendId);
    if (existingRelation) {
      return { success: false, message: 'Ya existe una relación con este jugador' };
    }
    
    // Create new friend request
    const { data, error } = await supabase
      .from('amigos')
      .insert([{
        user_id: userId,
        friend_id: friendId,
        status: 'pending',
      }])
      .select()
      .single();
      
    if (error) throw error;
    
    return { success: true, data };
  } catch (err) {
    console.error('Error sending friend request:', err);
    return { success: false, message: err.message };
  }
};

/**
 * Accept a friend request
 * @param {string} requestId - ID of the friend request
 * @returns {Promise<Object>} Result of the operation
 */
export const acceptFriendRequest = async (requestId) => {
  try {
    const { data, error } = await supabase
      .from('amigos')
      .update({ status: 'accepted' })
      .eq('id', requestId)
      .select()
      .single();
      
    if (error) throw error;
    
    return { success: true, data };
  } catch (err) {
    console.error('Error accepting friend request:', err);
    return { success: false, message: err.message };
  }
};

/**
 * Reject a friend request
 * @param {string} requestId - ID of the friend request
 * @returns {Promise<Object>} Result of the operation
 */
export const rejectFriendRequest = async (requestId) => {
  try {
    const { data, error } = await supabase
      .from('amigos')
      .update({ status: 'rejected' })
      .eq('id', requestId)
      .select()
      .single();
      
    if (error) throw error;
    
    return { success: true, data };
  } catch (err) {
    console.error('Error rejecting friend request:', err);
    return { success: false, message: err.message };
  }
};

/**
 * Remove a friend
 * @param {string} friendshipId - ID of the friendship
 * @returns {Promise<Object>} Result of the operation
 */
export const removeFriend = async (friendshipId) => {
  try {
    const { error } = await supabase
      .from('amigos')
      .delete()
      .eq('id', friendshipId);
      
    if (error) throw error;
    
    return { success: true };
  } catch (err) {
    console.error('Error removing friend:', err);
    return { success: false, message: err.message };
  }
};

/**
 * Get pending friend requests for a user
 * @param {string} userId - Current user ID
 * @returns {Promise<Array>} List of pending friend requests
 */
export const getPendingRequests = async (userId) => {
  if (!userId) return [];
  
  try {
    const { data, error } = await supabase
      .from('amigos')
      .select(`
        id, 
        status, 
        created_at,
        user_id,
        jugadores!user_id(id, nombre, avatar_url, email, posicion, ranking, partidos_jugados, pais_codigo, numero)
      `)
      .eq('friend_id', userId)
      .eq('status', 'pending');
      
    if (error) throw error;
    
    return data.map((item) => ({
      id: item.id,
      status: item.status,
      created_at: item.created_at,
      profile: item.jugadores,
    }));
  } catch (err) {
    console.error('Error fetching pending requests:', err);
    return [];
  }
};