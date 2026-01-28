/**
 * Player Service
 * 
 * This service handles all player-related API operations including:
 * - Player management (CRUD operations)
 * - Profile management
 * - Friend system
 * - Free players system
 */

import { supabase } from './supabase';

/**
 * Get all players
 * @returns {Promise<Array>} List of players
 */
export const getJugadores = async () => {
  console.log('📊 SUPABASE: Fetching all players with scores');
  
  try {
    const { data, error } = await supabase
      .from('jugadores')
      .select('id, uuid, nombre, foto_url, score, is_goalkeeper')
      .order('nombre', { ascending: true });
      
    if (error) {
      console.error('❌ SUPABASE: Error fetching players:', error);
      throw new Error(`Error fetching players: ${error.message}`);
    }
    
    console.log('✅ SUPABASE: Players fetched successfully:', {
      count: data?.length || 0,
      playersWithScores: data?.filter((p) => p.score !== null && p.score !== undefined).length || 0,
      sample: data?.slice(0, 3).map((p) => ({ 
        nombre: p.nombre, 
        uuid: p.uuid, 
        score: p.score, 
      })) || [],
    });
    
    return data || [];
    
  } catch (error) {
    console.error('❌ SUPABASE: getJugadores failed:', error);
    throw error;
  }
};

/**
 * Add a new player
 * @param {string} nombre - Player name
 * @returns {Promise<Object>} Created player
 */
export const addJugador = async (nombre) => {
  const { data, error } = await supabase
    .from('jugadores')
    .insert([{ nombre, score: 5, is_goalkeeper: false }])
    .select()
    .single();
  if (error) throw error;
  return data;
};

/**
 * Delete a player
 * @param {string} uuid - Player UUID
 * @returns {Promise<void>}
 */
export const deleteJugador = async (uuid) => {
  await supabase.from('jugadores').delete().eq('uuid', uuid);
  await supabase.from('votos').delete().eq('votante_id', uuid);
  await supabase.from('votos').delete().eq('votado_id', uuid);
};

/**
 * Compress image to reduce file size
 * @param {File} file - Image file
 * @param {number} _maxSizeMB - Maximum size in MB
 * @param {number} quality - Compression quality (0-1)
 * @returns {Promise<File>} Compressed file
 */
const compressImage = (file, _maxSizeMB = 1.5, quality = 0.8) => {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = () => {
      // Calculate new dimensions (max 800px width/height)
      const maxDimension = 800;
      let { width, height } = img;
      
      if (width > height && width > maxDimension) {
        height = (height * maxDimension) / width;
        width = maxDimension;
      } else if (height > maxDimension) {
        width = (width * maxDimension) / height;
        height = maxDimension;
      }
      
      canvas.width = width;
      canvas.height = height;
      
      // Draw and compress
      ctx.drawImage(img, 0, 0, width, height);
      
      canvas.toBlob(
        (blob) => {
          resolve(new File([blob], file.name, { type: 'image/jpeg' }));
        },
        'image/jpeg',
        quality,
      );
    };
    
    img.src = URL.createObjectURL(file);
  });
};

/**
 * Upload player photo
 * @param {File} file - Image file
 * @param {Object} jugador - Player object
 * @returns {Promise<string>} Public URL of the uploaded photo
 */
export const uploadFoto = async (file, jugador) => {
  // Compress image if it's larger than 1.5MB
  let fileToUpload = file;
  if (file.size > 1.5 * 1024 * 1024) {
    console.log('Compressing image:', file.size, 'bytes');
    fileToUpload = await compressImage(file);
    console.log('Compressed to:', fileToUpload.size, 'bytes');
  }
  
  const fileExt = file.name.split('.').pop() || 'jpg';
  const fileName = `${jugador.uuid}_${Date.now()}.${fileExt}`;
  const { error: uploadError } = await supabase.storage
    .from('jugadores-fotos')
    .upload(fileName, fileToUpload, { upsert: true });
  if (uploadError) throw uploadError;
  
  const { data } = supabase.storage
    .from('jugadores-fotos')
    .getPublicUrl(fileName);
  
  const fotoUrl = data?.publicUrl;
  if (!fotoUrl) throw new Error('No se pudo obtener la URL pública de la foto.');
  console.log('uploadFoto updating:', { jugador: jugador.uuid, fotoUrl });
  
  // Add cache buster so clients always receive the newest image
  const cacheBusted = `${fotoUrl}${fotoUrl.includes('?') ? '&' : '?'}cb=${Date.now()}`;

  // Update usuarios table with cache-busted avatar_url
  const { error: updateError } = await supabase
    .from('usuarios')
    .update({ avatar_url: cacheBusted })
    .eq('id', jugador.uuid);

  if (updateError) {
    console.error('uploadFoto update error:', updateError);
    throw updateError;
  }

  // Ahora ACTUALIZÁ la foto en la tabla jugadores
  const { error: updateJugadorError } = await supabase
    .from('jugadores')
    .update({ foto_url: cacheBusted })
    .eq('uuid', jugador.uuid);

  if (updateJugadorError) {
    console.error('uploadFoto update jugador error:', updateJugadorError);
    // No lanzamos el error, solo lo logueamos
  }
  
  // Also update user metadata to ensure consistency
  try {
    await supabase.auth.updateUser({
      data: { avatar_url: cacheBusted },
    });
    console.log('Updated user metadata with avatar_url:', cacheBusted);
  } catch (error) {
    console.error('Error updating user metadata:', error);
    // Continue even if this fails
  }
  
  console.log('uploadFoto success:', cacheBusted);
  return cacheBusted;
};

/**
 * Get user profile
 * @param {string} userId - User ID
 * @returns {Promise<Object>} User profile
 */
export const getProfile = async (userId) => {
  console.log('getProfile called for userId:', userId);
  const { data, error } = await supabase
    .from('usuarios')
    .select('*')
    .eq('id', userId)
    .single();
  
  if (error) {
    console.error('getProfile error:', error);
    throw error;
  }
  
  console.log('getProfile result:', {
    data: data,
    avatar_url: data?.avatar_url,
    foto_url: data?.foto_url,
    all_fields: Object.keys(data || {}),
  });
  
  return data;
};

/**
 * Update user profile
 * @param {string} userId - User ID
 * @param {Object} profileData - Profile data to update
 * @returns {Promise<Object>} Updated profile
 */
export const updateProfile = async (userId, profileData) => {
  const completion = calculateProfileCompletion(profileData);
  
  const { data, error } = await supabase
    .from('usuarios')
    .update({ ...profileData, profile_completion: completion })
    .eq('id', userId)
    .select()
    .single();
  
  if (error) throw error;
  return data;
};

/**
 * Create or update user profile
 * @param {Object} user - User object from Supabase auth
 * @returns {Promise<Object>} Created or updated profile
 */
export const createOrUpdateProfile = async (user) => {
  // Avatar de Google o proveedor social
  const avatarUrl =
    user.user_metadata?.picture ||
    user.user_metadata?.avatar_url ||
    null;

  // Buscá si ya existe el usuario
  const { data: existingUser } = await supabase
    .from('usuarios')
    .select('avatar_url')
    .eq('id', user.id)
    .single();

  // SOLO campos que EXISTEN en la tabla usuarios
  const profileData = {
    id: user.id,
    nombre: user.user_metadata?.full_name || user.email?.split('@')[0] || '',
    email: user.email,
    avatar_url: avatarUrl || existingUser?.avatar_url || null,
    red_social: null,                 // o traelo si lo tenés
    localidad: null,                  // editable luego
    ranking: 0,
    partidos_jugados: 0,
    posicion: null,                   // editable luego
    acepta_invitaciones: true,
    bio: null,                        // editable luego
    fecha_alta: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    perfil_completo: false,
    profile_completion: 0,
    pais_codigo: null,                // editable luego
    nacionalidad: 'argentina',
    latitud: null,
    longitud: null,
    fecha_nacimiento: null,
    partidos_abandonados: 0,
    numero: null,
  };

  // Actualizar metadata en Supabase Auth
  if (avatarUrl) {
    try {
      await supabase.auth.updateUser({
        data: { avatar_url: avatarUrl },
      });
      console.log('Updated user metadata with avatar_url:', avatarUrl);
    } catch (error) {
      console.error('Error updating user metadata:', error);
    }
  }

  // Insertar o actualizar (upsert)
  const { data, error } = await supabase
    .from('usuarios')
    .upsert(profileData, { onConflict: 'id' })
    .select()
    .single();

  if (error) {
    console.error('Error upserting user profile:', error);
    throw error;
  }

  console.log('createOrUpdateProfile OK:', data);
  return data;
};

/**
 * Calculate profile completion percentage
 * @param {Object} profile - User profile
 * @returns {number} Completion percentage (0-100)
 */
export const calculateProfileCompletion = (profile) => {
  if (!profile) return 0;
  
  const fields = [
    'nombre',
    'avatar_url',
    'email',
    'numero_jugador',
    'nacionalidad',
    'telefono', 
    'localidad', 
    'fecha_nacimiento',
    'posicion_favorita',
    'bio',
  ];
  
  const filledFields = fields.filter((field) => {
    const value = profile[field];
    return value && value.toString().trim() !== '';
  });
  
  return Math.round((filledFields.length / fields.length) * 100);
};

/**
 * Add current user as a free player
 * @returns {Promise<void>}
 */
export const addFreePlayer = async () => {
  try {
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      throw new Error('User must be authenticated');
    }

    console.log('Adding free player for user:', user.id);

    // Get user profile
    const profile = await getProfile(user.id);
    console.log('User profile:', profile);
    
    if (!profile) {
      console.warn('Profile not found, creating minimal profile');
      // Create a minimal profile if none exists
      const minimalProfile = {
        nombre: user.email?.split('@')[0] || 'Usuario',
        localidad: 'Sin especificar',
      };
      
      // Check if already registered
      const { data: existing, error: checkError } = await supabase
        .from('jugadores_sin_partido')
        .select('id')
        .eq('user_id', user.id)
        .eq('disponible', true);
      
      if (checkError) {
        console.error('Error checking existing free player:', checkError);
        throw checkError;
      }

      if (existing && existing.length > 0) {
        console.log('User already registered as free player');
        throw new Error('Ya estás anotado como disponible');
      }

      // Add to free players with minimal profile
      console.log('Inserting free player with minimal profile:', minimalProfile);
      const { error: insertError } = await supabase
        .from('jugadores_sin_partido')
        .insert([{
          user_id: user.id,
          nombre: minimalProfile.nombre,
          localidad: minimalProfile.localidad,
        }]);

      if (insertError) {
        console.error('Error inserting free player:', insertError);
        throw insertError;
      }
      
      return;
    }

    // Check if already registered
    const { data: existing, error: checkError } = await supabase
      .from('jugadores_sin_partido')
      .select('id')
      .eq('user_id', user.id)
      .eq('disponible', true);
    
    if (checkError) {
      console.error('Error checking existing free player:', checkError);
      throw checkError;
    }

    if (existing && existing.length > 0) {
      console.log('User already registered as free player');
      throw new Error('Ya estás anotado como disponible');
    }

    // Add to free players
    console.log('Inserting free player with profile:', {
      nombre: profile.nombre,
      localidad: profile.localidad,
    });
    
    const { error: insertError } = await supabase
      .from('jugadores_sin_partido')
      .insert([{
        user_id: user.id,
        nombre: profile.nombre || 'Usuario',
        localidad: profile.localidad || 'Sin especificar',
      }]);

    if (insertError) {
      console.error('Error inserting free player:', insertError);
      throw insertError;
    }
  } catch (error) {
    console.error('addFreePlayer failed:', error);
    throw error;
  }
};

/**
 * Remove current user from free players
 * @returns {Promise<void>}
 */
export const removeFreePlayer = async () => {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error('User must be authenticated');
  }

  const { error } = await supabase
    .from('jugadores_sin_partido')
    .update({ disponible: false })
    .eq('user_id', user.id);

  if (error) throw error;
};

/**
 * Check if current user is registered as a free player
 * @returns {Promise<boolean>} True if registered, false otherwise
 */
export const getFreePlayerStatus = async () => {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return false;

  const { data } = await supabase
    .from('jugadores_sin_partido')
    .select('id')
    .eq('user_id', user.id)
    .eq('disponible', true)
    .single();

  return !!data;
};

/**
 * Get list of all available free players
 * @returns {Promise<Array>} List of free players
 */
export const getFreePlayersList = async () => {
  const { data, error } = await supabase
    .from('jugadores_sin_partido')
    .select('*')
    .eq('disponible', true)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
};

/**
 * Get all friends for a user with status 'accepted'
 * @param {string} userId - Current user ID
 * @returns {Promise<Array>} List of accepted friends
 */
export const getAmigos = async (userId) => {
  if (!userId) return [];
  
  try {
    // Get friends where current user is user_id
    const { data, error } = await supabase
      .from('amigos')
      .select(`
        id, 
        status, 
        created_at,
        friend_id,
        jugadores!friend_id(id, nombre, avatar_url, email, posicion, ranking, partidos_jugados, pais_codigo, numero, telefono, localidad)
      `)
      .eq('user_id', userId)
      .eq('status', 'accepted');
      
    if (error) throw error;
    
    // Also get friends where current user is friend_id
    const { data: reverseData, error: reverseError } = await supabase
      .from('amigos')
      .select(`
        id, 
        status, 
        created_at,
        user_id,
        jugadores!user_id(id, nombre, avatar_url, email, posicion, ranking, partidos_jugados, pais_codigo, numero, telefono, localidad)
      `)
      .eq('friend_id', userId)
      .eq('status', 'accepted');
      
    if (reverseError) throw reverseError;
    
    // Combine and format both sets of friends
    const formattedAmigos = [
      ...data.map((item) => ({
        id: item.id,
        status: 'accepted',
        created_at: item.created_at,
        profile: item.jugadores,
      })),
      ...reverseData.map((item) => ({
        id: item.id,
        status: 'accepted',
        created_at: item.created_at,
        profile: item.jugadores,
      })),
    ];
    
    return formattedAmigos;
  } catch (err) {
    console.error('Error fetching friends:', err);
    throw err;
  }
};

/**
 * Get relationship status between current user and another player
 * @param {string} userId - Current user ID
 * @param {string} friendId - Other player ID
 * @returns {Promise<Object|null>} Relationship status or null if no relationship exists
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

// Export all functions
export default {
  getJugadores,
  addJugador,
  deleteJugador,
  uploadFoto,
  getProfile,
  updateProfile,
  createOrUpdateProfile,
  calculateProfileCompletion,
  addFreePlayer,
  removeFreePlayer,
  getFreePlayerStatus,
  getFreePlayersList,
  getAmigos,
  getRelationshipStatus,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriend,
  getPendingRequests,
};