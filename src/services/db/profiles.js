import { supabase } from '../../lib/supabaseClient';

/**
 * Compress image to reduce file size
 * @param {File} file - Image file
 * @param {number} maxSizeMB - Max size in MB
 * @param {number} quality - Compression quality
 * @returns {Promise<File>} Compressed file
 */
const compressImage = (file, maxSizeMB = 1.5, quality = 0.8) => {
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
 * @returns {Promise<string>} Photo URL
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
  console.log('uploadFoto updating:', { jugador: jugador.uuid, fotoUrl: encodeURIComponent(fotoUrl || '') });
  
  // Update usuarios table with avatar_url
  const { error: updateError } = await supabase
    .from('usuarios')
    .update({ avatar_url: fotoUrl })
    .eq('id', jugador.uuid);

  if (updateError) {
    console.error('uploadFoto update error:', updateError);
    throw updateError;
  }

  // Ahora ACTUALIZÁ la foto en la tabla jugadores
  const { error: updateJugadorError } = await supabase
    .from('jugadores')
    .update({ foto_url: fotoUrl })
    .eq('uuid', jugador.uuid);

  if (updateJugadorError) {
    console.error('uploadFoto update jugador error:', updateJugadorError);
  // No lanzamos el error, solo lo logueamos
  }
  
  // Also update user metadata to ensure consistency
  try {
    await supabase.auth.updateUser({
      data: { avatar_url: fotoUrl },
    });
    console.log('Updated user metadata with avatar_url:', fotoUrl);
  } catch (error) {
    console.error('Error updating user metadata:', error);
    // Continue even if this fails
  }
  
  console.log('uploadFoto success:', encodeURIComponent(fotoUrl || ''));
  return fotoUrl;
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
    .select('id, usuario_id, nombre, avatar_url, ranking, mvp_badges, gk_badges, red_badges, *, lesion_activa')
    .eq('id', userId)
    .single();
  
  if (error) {
    console.error('getProfile error:', error);
    throw error;
  }
  
  // Get badge counts from player_awards table
  if (data) {
    try {
      const { data: badges, error: badgesError } = await supabase
        .from('player_awards')
        .select('award_type')
        .eq('jugador_id', userId);
      
      if (!badgesError && badges) {
        // Count badges by type
        const badgeCounts = {
          mvps: 0,
          guantes_dorados: 0,
          tarjetas_rojas: 0,
        };
        
        badges.forEach((badge) => {
          if (badge.award_type === 'mvp') badgeCounts.mvps++;
          if (badge.award_type === 'best_gk') badgeCounts.guantes_dorados++;
          if (badge.award_type === 'red_card') badgeCounts.tarjetas_rojas++;
        });
        
        // Add badge counts to profile data
        data.mvps = badgeCounts.mvps;
        data.guantes_dorados = badgeCounts.guantes_dorados;
        data.tarjetas_rojas = badgeCounts.tarjetas_rojas;
        
        console.log('[GET_PROFILE] Badge counts added:', badgeCounts);
      }
    } catch (badgeError) {
      console.error('[GET_PROFILE] Error fetching badges:', badgeError);
      // Continue without badges if there's an error
    }
  }
  
  // Convert date format for frontend - FORCE conversion
  if (data && data.fecha_nacimiento) {
    let dateValue = data.fecha_nacimiento;
    
    if (typeof dateValue === 'string') {
      // Handle ISO string format
      if (dateValue.includes('T')) {
        dateValue = dateValue.split('T')[0];
      }
      // Handle other date formats
      else if (dateValue.includes(' ')) {
        dateValue = dateValue.split(' ')[0];
      }
    } else if (dateValue instanceof Date) {
      // Convert Date object to YYYY-MM-DD format
      dateValue = dateValue.toISOString().split('T')[0];
    }
    
    // Ensure final format is YYYY-MM-DD
    if (typeof dateValue === 'string' && /^\\d{4}-\\d{2}-\\d{2}/.test(dateValue)) {
      data.fecha_nacimiento = dateValue.substring(0, 10); // Take only first 10 chars (YYYY-MM-DD)
    }
    
    // Update the actual data field
    data.fecha_nacimiento = dateValue;
    
    console.log('[GET_PROFILE] Date conversion:', {
      original: data.fecha_nacimiento,
      converted: dateValue,
    });
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
 * Calculate profile completion percentage
 * @param {Object} profile - Profile data
 * @returns {number} Completion percentage
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
 * Update user profile
 * @param {string} userId - User ID
 * @param {Object} profileData - Profile data to update
 * @returns {Promise<Object>} Updated profile
 */
export const updateProfile = async (userId, profileData) => {
  console.log('[UPDATE_PROFILE] Input fields:', Object.keys(profileData));
  console.log('[UPDATE_PROFILE] Input data:', profileData);
  
  const completion = calculateProfileCompletion(profileData);
  
  // Valid columns in usuarios table
  const validColumns = [
    'nombre', 'email', 'avatar_url', 'red_social', 'localidad', 'ranking',
    'partidos_jugados', 'posicion', 'acepta_invitaciones', 'bio',
    'perfil_completo', 'profile_completion', 'pais_codigo', 'nacionalidad',
    'latitud', 'longitud', 'fecha_nacimiento', 'partidos_abandonados',
    'numero', 'telefono', 'mvps', 'tarjetas_rojas', 'rating', 'updated_at',
    'lesion_activa',
  ];
  
  // Field mapping for frontend to database
  const fieldMapping = {
    'social': 'red_social',
    'socialHandle': 'red_social',
    'social_handle': 'red_social',
    'ciudad': 'localidad',
    'city': 'localidad',
    'birthDate': 'fecha_nacimiento',
    'dateOfBirth': 'fecha_nacimiento',
    'birth_date': 'fecha_nacimiento',
    'phone': 'telefono',
    'position': 'posicion',
    'country': 'pais_codigo',
    'nationality': 'nacionalidad',
    'number': 'numero',
    'playerNumber': 'numero',
    'player_number': 'numero',
  };
  
  // Filter and map fields
  const cleanProfileData = {};
  Object.keys(profileData).forEach((key) => {
    const dbKey = fieldMapping[key] || key;
    if (validColumns.includes(dbKey)) {
      let value = profileData[key];
      
      // Convert date format for fecha_nacimiento
      if (dbKey === 'fecha_nacimiento' && value) {
        if (typeof value === 'string') {
          // Convert from \"2025-07-10T00:00:00\" to \"2025-07-10\"
          if (value.includes('T')) {
            value = value.split('T')[0];
          }
          // Ensure it's a valid date format (YYYY-MM-DD)
          if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) {
            console.warn('[UPDATE_PROFILE] Invalid date format:', value);
            value = null;
          }
        } else if (value instanceof Date) {
          // Convert Date object to YYYY-MM-DD format
          value = value.toISOString().split('T')[0];
        }
      }
      
      if (value === null || value === undefined || 
          typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        cleanProfileData[dbKey] = value;
      }
    }
  });
  
  const finalData = { ...cleanProfileData, profile_completion: completion, updated_at: new Date().toISOString() };
  
  console.log('[UPDATE_PROFILE] Mapped fields:', Object.keys(finalData));
  console.log('[UPDATE_PROFILE] Final data:', finalData);
  
  const { data, error } = await supabase
    .from('usuarios')
    .update(finalData)
    .eq('id', userId)
    .select()
    .single();
  
  if (error) throw error;
  
  // Actualizar el nombre en todos los partidos donde el usuario es jugador
  if (finalData.nombre) {
    try {
      await supabase
        .from('jugadores')
        .update({ nombre: finalData.nombre })
        .eq('usuario_id', userId);
      console.log('[UPDATE_PROFILE] Updated player name in all matches');
    } catch (updateError) {
      console.error('[UPDATE_PROFILE] Error updating player names:', updateError);
      // No lanzar error, solo loguearlo
    }
  }
  
  return data;
};

/**
 * Create or update user profile
 * @param {Object} user - User object from auth
 * @returns {Promise<Object>} Created/updated profile
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

  // Default nationality from environment or fallback
  const defaultNationality = process.env.REACT_APP_DEFAULT_NATIONALITY || 'argentina';
  if (!process.env.REACT_APP_DEFAULT_NATIONALITY && process.env.NODE_ENV === 'development') {
    console.warn('⚠️ Missing REACT_APP_DEFAULT_NATIONALITY in environment variables, using default: argentina');
  }

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
    nacionalidad: defaultNationality,
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
 * Add user as free player
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
 * Remove user from free players
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
 * Get free player status for current user
 * @returns {Promise<boolean>} Whether user is registered as free player
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
 * Get list of free players
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