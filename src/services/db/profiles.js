import { supabase } from '../../lib/supabaseClient';
import logger from '../../utils/logger';

/**
 * Compress image to reduce file size
 * @param {File} file - Image file
 * @param {number} _maxSizeMB
 * @param {number} quality - Compression quality
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
 * @returns {Promise<string>} Photo URL
 */
export const uploadFoto = async (file, jugador) => {
  // Compress image if it's larger than 1.5MB
  let fileToUpload = file;
  if (file.size > 1.5 * 1024 * 1024) {
    logger.log('Compressing image:', file.size, 'bytes');
    fileToUpload = await compressImage(file);
    logger.log('Compressed to:', fileToUpload.size, 'bytes');
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
  logger.log('uploadFoto updating:', { jugador: jugador.uuid, fotoUrl: encodeURIComponent(fotoUrl || '') });

  // Add cache buster so clients always receive the newest image
  const cacheBusted = `${fotoUrl}${fotoUrl.includes('?') ? '&' : '?'}cb=${Date.now()}`;

  // Update usuarios table with avatar_url
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
    .update({ avatar_url: cacheBusted })
    .eq('usuario_id', jugador.uuid);

  if (updateJugadorError) {
    console.error('uploadFoto update jugador error:', updateJugadorError);
    // No lanzamos el error, solo lo logueamos
  }

  // NOTE: Do NOT update auth user metadata from here to avoid duplicate updates.
  // auth metadata update is handled by the client (ProfileMenu) which calls supabase.auth.updateUser after upload.
  logger.log('Skipping auth metadata update in uploadFoto; handled by client ProfileMenu');

  logger.log('uploadFoto success:', encodeURIComponent(cacheBusted || ''));
  return cacheBusted;
};

/**
 * Get user profile
 * @param {string} userId - User ID
 * @returns {Promise<Object>} User profile
 */
export const getProfile = async (userId) => {
  logger.log('getProfile called for userId:', userId);
  // Use a simple, safe select of all columns from usuarios filtered by id.
  // Do NOT mix explicit columns with '*' and do NOT request non-existent columns.
  const { data, error } = await supabase
    .from('usuarios')
    .select('*')
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

        data.mvps = badgeCounts.mvps;
        data.guantes_dorados = badgeCounts.guantes_dorados;
        data.tarjetas_rojas = badgeCounts.tarjetas_rojas;

        logger.log('[GET_PROFILE] Badge counts added:', badgeCounts);
      }
    } catch (badgeError) {
      console.error('[GET_PROFILE] Error fetching badges:', badgeError);
      // Continue without badges if there's an error
    }
  }

  // Recalculate partidos_jugados from real activity:
  // - Traditional matches: user is in jugadores + partido estado=finalizado
  // - Manual matches: partidos_manuales for this user
  if (data) {
    try {
      let realMatchesCount = 0;
      let manualMatchesCount = 0;

      const { data: jugadorRows, error: jugadorRowsError } = await supabase
        .from('jugadores')
        .select('partido_id')
        .eq('usuario_id', userId);
      if (jugadorRowsError) throw jugadorRowsError;

      const partidoIds = [...new Set((jugadorRows || []).map((r) => r?.partido_id).filter(Boolean))];
      if (partidoIds.length > 0) {
        const { data: finishedMatches, error: finishedError } = await supabase
          .from('partidos')
          .select('id')
          .in('id', partidoIds)
          .eq('estado', 'finalizado');
        if (finishedError) throw finishedError;
        realMatchesCount = (finishedMatches || []).length;
      }

      const { count: manualCount, error: manualCountError } = await supabase
        .from('partidos_manuales')
        .select('id', { count: 'exact', head: true })
        .eq('usuario_id', userId);
      if (manualCountError) {
        // keep compatibility with environments where table might not be available
        const tableMissing = String(manualCountError?.message || '').toLowerCase().includes('partidos_manuales');
        if (!tableMissing) throw manualCountError;
      } else {
        manualMatchesCount = Number(manualCount || 0);
      }

      data.partidos_jugados = realMatchesCount + manualMatchesCount;
      logger.log('[GET_PROFILE] partidos_jugados recalculated:', {
        realMatchesCount,
        manualMatchesCount,
        total: data.partidos_jugados,
      });
    } catch (matchesError) {
      console.error('[GET_PROFILE] Error recalculating partidos_jugados:', matchesError);
      // keep existing field value if recalculation fails
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
    if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateValue)) {
      data.fecha_nacimiento = dateValue.substring(0, 10); // Take only first 10 chars (YYYY-MM-DD)
    }

    // Update the actual data field
    data.fecha_nacimiento = dateValue;

    logger.log('[GET_PROFILE] Date conversion:', {
      original: data.fecha_nacimiento,
      converted: dateValue,
    });
  }

  logger.log('getProfile result:', {
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
  logger.log('[UPDATE_PROFILE] Input fields:', Object.keys(profileData));
  logger.log('[UPDATE_PROFILE] Input data:', profileData);

  const completion = calculateProfileCompletion(profileData);

  // Valid columns in usuarios table
  const validColumns = [
    'nombre', 'email', 'avatar_url', 'red_social', 'localidad', 'ranking',
    'partidos_jugados', 'posicion', 'acepta_invitaciones', 'bio',
    'perfil_completo', 'profile_completion', 'pais_codigo', 'nacionalidad',
    'latitud', 'longitud', 'fecha_nacimiento', 'partidos_abandonados',
    'numero', 'telefono', 'mvps', 'tarjetas_rojas', 'rating', 'updated_at',
    'lesion_activa', 'card_frame_color', 'pierna_habil', 'nivel',
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
            logger.warn('[UPDATE_PROFILE] Invalid date format:', value);
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

  logger.log('[UPDATE_PROFILE] Mapped fields:', Object.keys(finalData));
  logger.log('[UPDATE_PROFILE] Final data:', finalData);

  const { data, error } = await supabase
    .from('usuarios')
    .update(finalData)
    .eq('id', userId)
    .select()
    .single();

  if (error) throw error;

  // Actualizar el nombre en todos los partidos donde el usuario es jugador
  if (cleanProfileData && cleanProfileData.nombre) {
    try {
      await supabase
        .from('jugadores')
        .update({ nombre: cleanProfileData.nombre })
        .eq('usuario_id', userId);
      logger.log('[UPDATE_PROFILE] Updated player name in all matches');
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
  logger.log('[PROFILE_BOOTSTRAP] Starting profile creation/update for user:', user.id);

  // Avatar from social provider (if any)
  const avatarUrl =
    user.user_metadata?.picture ||
    user.user_metadata?.avatar_url ||
    null;

  // Check if the usuarios row already exists WITHOUT throwing when not found
  const { data: existingUser, error: existingCheckError } = await supabase
    .from('usuarios')
    .select('avatar_url')
    .eq('id', user.id)
    .maybeSingle();

  if (existingCheckError) {
    console.error('[PROFILE_BOOTSTRAP] Error checking existing user:', existingCheckError);
    throw existingCheckError;
  }

  // Decide avatar value:
  // - If usuarios already has an avatar_url, KEEP IT (never overwrite).
  // - If user row does not exist or avatar is null, use social avatar only for initial creation.
  const avatarForProfile = existingUser && existingUser.avatar_url
    ? existingUser.avatar_url
    : (avatarUrl || null);

  // Default nationality from environment or fallback
  const defaultNationality = process.env.REACT_APP_DEFAULT_NATIONALITY || 'argentina';
  if (!process.env.REACT_APP_DEFAULT_NATIONALITY && process.env.NODE_ENV === 'development') {
    logger.warn('⚠️ Missing REACT_APP_DEFAULT_NATIONALITY in environment variables, using default: argentina');
  }

  // Determine nombre for profile
  const nombre = user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split('@')[0] ||
    'Jugador';

  // ONLY fields that exist in usuarios
  const profileData = {
    id: user.id,
    nombre,
    email: user.email,
    avatar_url: avatarForProfile,
    red_social: null,                 // or map if you have it
    localidad: null,                  // editable later
    ranking: 0,
    partidos_jugados: 0,
    posicion: null,                   // editable later
    acepta_invitaciones: true,
    bio: null,                        // editable later
    fecha_alta: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    perfil_completo: false,
    profile_completion: 0,
    pais_codigo: null,                // editable later
    nacionalidad: defaultNationality,
    latitud: null,
    longitud: null,
    fecha_nacimiento: null,
    partidos_abandonados: 0,
    numero: null,
  };

  // IMPORTANT: Do NOT update Supabase Auth user metadata here.
  // Auth metadata updates should only happen when the user explicitly uploads/changes avatar.

  // Insert or update (upsert) into usuarios table
  const { data, error } = await supabase
    .from('usuarios')
    .upsert(profileData, { onConflict: 'id' })
    .select()
    .single();

  if (error) {
    console.error('[PROFILE_BOOTSTRAP] Error upserting user profile to usuarios:', error);
    throw error;
  }

  logger.log('[PROFILE_BOOTSTRAP] Successfully upserted to usuarios table:', {
    id: data.id,
    nombre: data.nombre,
    avatar_url: data.avatar_url
  });

  // ALSO ensure a row exists in public.profiles table
  // This is critical for approve_join_request RPC to find user data
  try {
    const profilesData = {
      id: user.id,
      nombre,
      avatar_url: avatarForProfile,
      estadisticas: {
        pj: 0,
        rating: null
      }
    };

    const { error: profilesError } = await supabase
      .from('profiles')
      .upsert(profilesData, { onConflict: 'id' });

    if (profilesError) {
      console.error('[PROFILE_BOOTSTRAP] Error upserting to profiles table:', {
        code: profilesError.code,
        message: profilesError.message,
        details: profilesError.details,
        hint: profilesError.hint
      });
      // Don't throw - profiles table might not exist or have different schema
      // The main usuarios upsert already succeeded
    } else {
      logger.log('[PROFILE_BOOTSTRAP] Successfully upserted to profiles table:', {
        id: user.id,
        nombre
      });
    }
  } catch (profilesError) {
    console.error('[PROFILE_BOOTSTRAP] Unexpected error upserting to profiles:', profilesError);
    // Don't throw - continue with usuarios data
  }

  logger.log('[PROFILE_BOOTSTRAP] Profile bootstrap completed for user:', user.id);
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

    logger.log('Adding free player for user:', user.id);

    // Get user profile
    const profile = await getProfile(user.id);
    logger.log('User profile:', profile);

    if (!profile) {
      logger.warn('Profile not found, creating minimal profile');
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
        logger.log('User already registered as free player');
        throw new Error('Ya estás anotado como disponible');
      }

      // Add to free players with minimal profile
      logger.log('Inserting free player with minimal profile:', minimalProfile);
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
      logger.log('User already registered as free player');
      throw new Error('Ya estás anotado como disponible');
    }

    // Add to free players
    logger.log('Inserting free player with profile:', {
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
    console.error('Error registering free player:', error);
    throw error;
  }
};
