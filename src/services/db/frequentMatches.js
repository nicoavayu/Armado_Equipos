import { supabase } from '../../lib/supabaseClient';
import { weekdayFromYMD } from '../../utils/dateLocal';
import { findDuplicateTemplateMatch } from './matchScheduling';

/**
 * Creates a new frequent match template
 * @param {Object} matchData - Frequent match data
 * @returns {Promise<Object>} Created frequent match record
 */
export const crearPartidoFrecuente = async ({ nombre, sede, hora, jugadores_frecuentes, dia_semana, habilitado, imagen_url, tipo_partido }) => {
  // Get current authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('User must be authenticated to create frequent matches');
  }

  // Validate required fields
  if (!nombre || !sede || !hora || dia_semana === undefined) {
    const missingFields = [];
    if (!nombre) missingFields.push('nombre');
    if (!sede) missingFields.push('sede');
    if (!hora) missingFields.push('hora');
    if (dia_semana === undefined) missingFields.push('dia_semana');

    throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
  }

  const insertData = {
    nombre: nombre.trim(),
    sede: sede.trim(),
    hora: hora.trim(),
    jugadores_frecuentes: jugadores_frecuentes || [],
    creado_por: user.id, // Automatically set to current user's UID
    creado_en: new Date().toISOString(),
    habilitado: habilitado !== undefined ? habilitado : true,
    dia_semana: parseInt(dia_semana),
    imagen_url: imagen_url || null,
    tipo_partido: tipo_partido || 'Masculino',
  };

  const { data, error } = await supabase
    .from('partidos_frecuentes')
    .insert([insertData])
    .select()
    .single();

  if (error) {
    throw new Error(`Error creating frequent match: ${error.message}`);
  }

  if (!data) {
    throw new Error('No data returned from frequent match creation');
  }

  return data;
};

/**
 * Get all enabled frequent matches
 * @returns {Promise<Array>} Array of frequent matches
 */
export const getPartidosFrecuentes = async () => {
  console.log('Fetching frequent matches...');

  try {
    // First, let's get ALL records to see what's in the table
    const { data: allData, error: allError } = await supabase
      .from('partidos_frecuentes')
      .select('*');

    console.log('All frequent matches in table:', allData);
    console.log('Count of all records:', allData?.length || 0);

    if (allError) {
      console.error('Error fetching all frequent matches:', allError);
    }

    // Now get only enabled ones
    const { data, error } = await supabase
      .from('partidos_frecuentes')
      .select('*')
      .eq('habilitado', true)
      .order('creado_en', { ascending: false });

    if (error) {
      console.error('Error fetching enabled frequent matches:', error);
      console.error('Error details:', {
        code: error.code,
        message: error.message,
        details: error.details,
      });
      throw new Error(`Error fetching frequent matches: ${error.message}`);
    }

    console.log('Enabled frequent matches fetched:', data);
    console.log('Count of enabled records:', data?.length || 0);

    if (data && data.length > 0) {
      console.log('Sample record structure:', data[0]);
    }

    return data || [];

  } catch (err) {
    console.error('Exception in getPartidosFrecuentes:', err);
    throw err;
  }
};

/**
 * Update a frequent match
 * @param {string} id - Frequent match ID (UUID)
 * @param {Object} updates - Updates to apply
 * @returns {Promise<Object>} Updated frequent match
 */
export const updatePartidoFrecuente = async (id, updates) => {
  // Only update the provided fields, don't touch jugadores_frecuentes unless explicitly provided
  const updateData = { ...updates };

  // Only clean jugadores_frecuentes if it's being updated
  if (updates.jugadores_frecuentes) {
    updateData.jugadores_frecuentes = updates.jugadores_frecuentes.map((j) => ({
      nombre: j.nombre,
      avatar_url: j.avatar_url || null, // Use only avatar_url
      uuid: j.uuid || `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    }));
  }

  const { data, error } = await supabase
    .from('partidos_frecuentes')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(`Error updating frequent match: ${error.message}`);
  return data;
};

/**
 * Delete (disable) a frequent match
 * @param {string} id - Frequent match ID (UUID)
 * @returns {Promise<void>}
 */
export const deletePartidoFrecuente = async (id) => {
  const { error } = await supabase
    .from('partidos_frecuentes')
    .update({ habilitado: false })
    .eq('id', id);
  if (error) throw new Error(`Error deleting frequent match: ${error.message}`);
};

/**
 * Create a match from a frequent match template
 * @param {Object} partidoFrecuente - Frequent match data
 * @param {string} fecha - Match date
 * @param {string} modalidad - Match modality
 * @param {number} cupo - Player capacity
 * @returns {Promise<Object>} Created match
 */
const inferCupoFromModalidad = (modalidad = '') => {
  const m = String(modalidad || '').toUpperCase().trim();
  if (m === 'F5') return 10;
  if (m === 'F6') return 12;
  if (m === 'F7') return 14;
  if (m === 'F8') return 16;
  if (m === 'F9') return 18;
  if (m === 'F11') return 22;
  return 10;
};

export const crearPartidoDesdeFrec = async (partidoFrecuente, fecha, modalidad = 'F5', cupo = null) => {
  console.log('Creating/finding match from frequent match:', partidoFrecuente, 'for date:', fecha);

  const normalizedDate = typeof fecha === 'string' ? fecha.split('T')[0] : fecha;
  const { data: { user } } = await supabase.auth.getUser();

  const duplicate = await findDuplicateTemplateMatch({
    templateId: partidoFrecuente?.id,
    fecha: normalizedDate,
    hora: partidoFrecuente?.hora,
    sede: partidoFrecuente?.sede,
  });
  if (duplicate) {
    const dupError = new Error('Ya existe un partido creado con las mismas características.');
    dupError.code = 'DUPLICATE_TEMPLATE_MATCH';
    dupError.duplicateMatch = duplicate;
    throw dupError;
  }

  const { crearPartido, updateJugadoresPartido } = await import('./matches');

  const finalModalidad = partidoFrecuente.modalidad || modalidad;
  const finalCupo = Number(cupo) || Number(partidoFrecuente?.cupo_jugadores || partidoFrecuente?.cupo || 0) || inferCupoFromModalidad(finalModalidad);
  const precioRaw = partidoFrecuente?.precio_cancha ?? partidoFrecuente?.precio_cancha_por_persona ?? partidoFrecuente?.precio;
  const precioNum = precioRaw === undefined || precioRaw === null || String(precioRaw).trim() === ''
    ? null
    : Number(String(precioRaw).replace(/[^0-9.,-]/g, '').replace(',', '.'));
  const { v4: uuidv4 } = await import('uuid');

  const basePayload = {
    match_ref: uuidv4(),
    nombre: partidoFrecuente.nombre,
    fecha: normalizedDate,
    hora: partidoFrecuente.hora,
    sede: partidoFrecuente.sede,
    sedeMaps: { place_id: '' },
    modalidad: finalModalidad,
    cupo_jugadores: finalCupo,
    falta_jugadores: false,
    tipo_partido: partidoFrecuente.tipo_partido || 'Masculino',
    creado_por: user?.id || null,
    ...(Number.isFinite(precioNum) ? { precio_cancha_por_persona: precioNum } : {}),
  };

  let partido = null;
  const payloadVariants = [
    { ...basePayload },
    (() => { const p = { ...basePayload }; delete p.precio_cancha_por_persona; return p; })(),
    (() => { const p = { ...basePayload }; delete p.precio_cancha_por_persona; delete p.sedeMaps; return p; })(),
    (() => { const p = { ...basePayload }; delete p.precio_cancha_por_persona; delete p.sedeMaps; delete p.falta_jugadores; return p; })(),
    (() => { const p = { ...basePayload }; delete p.precio_cancha_por_persona; delete p.sedeMaps; delete p.falta_jugadores; delete p.creado_por; return p; })(),
  ];

  const seen = new Set();
  const uniqueVariants = payloadVariants.filter((v) => {
    const key = JSON.stringify(v, Object.keys(v).sort());
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let lastCreateError = null;
  for (let i = 0; i < uniqueVariants.length; i++) {
    const payload = uniqueVariants[i];
    try {
      partido = await crearPartido(payload);
      break;
    } catch (err) {
      lastCreateError = err;
      console.warn('[crearPartidoDesdeFrec] create attempt failed', {
        variant: i + 1,
        message: err?.message,
        details: err?.details,
        hint: err?.hint,
        code: err?.code,
      });
    }
  }

  if (!partido) throw lastCreateError || new Error('No se pudo crear el partido desde plantilla');

  // Best effort: link template columns if the schema has them.
  try {
    const partidoId = Number(partido.id);
    if (Number.isFinite(partidoId)) {
      let res = await supabase
        .from('partidos')
        .update({
          template_id: partidoFrecuente?.id || null,
          frequent_match_name: partidoFrecuente?.nombre || null,
        })
        .eq('id', partidoId);

      if (res?.error && /template_id/i.test(String(res.error.message || ''))) {
        res = await supabase
          .from('partidos')
          .update({
            from_frequent_match_id: partidoFrecuente?.id || null,
            frequent_match_name: partidoFrecuente?.nombre || null,
          })
          .eq('id', partidoId);
      }

      if (res?.error && /from_frequent_match_id/i.test(String(res.error.message || ''))) {
        res = await supabase
          .from('partidos')
          .update({ frequent_match_name: partidoFrecuente?.nombre || null })
          .eq('id', partidoId);
      }

      if (res?.error) {
        console.warn('[crearPartidoDesdeFrec] could not link template columns (non-fatal)', res.error);
      }
    }
  } catch (linkErr) {
    console.warn('[crearPartidoDesdeFrec] could not link template columns (non-fatal)', linkErr);
  }

  partido.frequent_match_name = partidoFrecuente.nombre;
  partido.template_id = partidoFrecuente.id;
  partido.tipo_partido = partidoFrecuente.tipo_partido || 'Masculino';

  const jugadoresFrecuentes = partidoFrecuente.jugadores_frecuentes || [];
  if (jugadoresFrecuentes.length > 0) {
    const jugadoresLimpios = jugadoresFrecuentes.map((j) => ({
      nombre: j.nombre,
      avatar_url: j.avatar_url || null,
      uuid: j.uuid || `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      score: j.score || 5,
    }));
    await updateJugadoresPartido(partido.id, jugadoresLimpios);
    partido.jugadores = jugadoresLimpios;
  } else {
    partido.jugadores = [];
  }

  try {
    if (user?.id && partido?.id) {
      const { data: existingCreator } = await supabase
        .from('jugadores')
        .select('id')
        .eq('partido_id', partido.id)
        .eq('usuario_id', user.id)
        .maybeSingle();

      if (!existingCreator) {
        const { data: usuarioData } = await supabase
          .from('usuarios')
          .select('nombre, avatar_url')
          .eq('id', user.id)
          .maybeSingle();

        const creatorNombre = usuarioData?.nombre || user?.email?.split('@')[0] || 'Creador';
        const creatorAvatar = usuarioData?.avatar_url || null;

        const { error: creatorInsertError } = await supabase
          .from('jugadores')
          .insert([{
            partido_id: partido.id,
            match_ref: partido.match_ref,
            usuario_id: user.id,
            nombre: creatorNombre,
            avatar_url: creatorAvatar,
            is_goalkeeper: false,
            score: 5,
          }]);

        if (creatorInsertError) {
          console.warn('[crearPartidoDesdeFrec] could not auto-add creator', creatorInsertError);
        }
      }
    }
  } catch (creatorErr) {
    console.warn('[crearPartidoDesdeFrec] creator auto-add failed (non-fatal)', creatorErr);
  }

  return partido;
};

/**
 * Update frequent match players specifically
 * @param {string} partidoFrecuenteId - Frequent match ID (UUID)
 * @param {Array} nuevosJugadores - New players array
 * @returns {Promise<Object>} Updated frequent match
 */
export const updateJugadoresFrecuentes = async (partidoFrecuenteId, nuevosJugadores) => {
  console.log('Updating frequent match players:', { partidoFrecuenteId, count: nuevosJugadores.length });
  return updatePartidoFrecuente(partidoFrecuenteId, {
    jugadores_frecuentes: nuevosJugadores,
  });
};

/**
 * Debug function to check table schema
 * @returns {Promise<Object>} Schema check results
 */
export const checkPartidosFrecuentesSchema = async () => {
  console.log('Checking partidos_frecuentes table schema...');

  try {
    // Try to insert a test record to see what fields are expected
    const testData = {
      nombre: 'TEST_SCHEMA_CHECK',
      sede: 'TEST',
      hora: '12:00',
      jugadores_frecuentes: [],
      creado_por: 'test',
      dia_semana: 1,
      habilitado: true,
      creado_en: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('partidos_frecuentes')
      .insert([testData])
      .select()
      .single();

    if (error) {
      console.error('Schema check failed:', error);
      return { success: false, error };
    }

    // Clean up test record
    if (data?.id) {
      await supabase
        .from('partidos_frecuentes')
        .delete()
        .eq('id', data.id);
    }

    console.log('Schema check passed:', data);
    return { success: true, data };

  } catch (err) {
    console.error('Exception during schema check:', err);
    return { success: false, error: err };
  }
};

/**
 * Get active matches for the current user
 * @returns {Promise<Array>} Array of active matches
 */
export const getPartidosActivosUsuario = async () => {
  console.log('[getPartidosActivosUsuario] Fetching active matches for current user');
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.warn('[getPartidosActivosUsuario] No authenticated user found');
      return [];
    }

    // Fetch matches with likely "active" states. Adjust states if your app uses different ones.
    const activeStates = ['equipos_formados', 'activo', 'en_juego', 'en_curso'];

    const { data: partidos, error } = await supabase
      .from('partidos_view')
      .select('*')
      .in('estado', activeStates)
      .order('fecha', { ascending: true });

    if (error) {
      console.error('[getPartidosActivosUsuario] Error fetching partidas:', error);
      return [];
    }

    console.log('[getPartidosActivosUsuario] Total active matches fetched:', partidos?.length || 0);

    // Filter client-side to include only matches where the current user is among the jugadores
    const uid = user.id;
    const partidasDelUsuario = (partidos || []).filter((partido) => {
      if (!partido.jugadores || !Array.isArray(partido.jugadores)) return false;

      // jugador objects may contain usuario_id, uuid or id depending on how they were stored
      return partido.jugadores.some((j) => {
        try {
          if (!j) return false;
          if (j.usuario_id && String(j.usuario_id) === String(uid)) return true;
          if (j.uuid && String(j.uuid) === String(uid)) return true;
          if (j.id && String(j.id) === String(uid)) return true;
          // Also support when jugadores is an array of simple ids
          if (typeof j === 'string' || typeof j === 'number') {
            return String(j) === String(uid);
          }
        } catch (err) {
          return false;
        }
        return false;
      });
    });

    console.log('[getPartidosActivosUsuario] Matches where user participates:', partidasDelUsuario.length);
    if (partidasDelUsuario.length > 0) console.log('[getPartidosActivosUsuario] Sample match:', partidasDelUsuario[0]);

    return partidasDelUsuario;
  } catch (err) {
    console.error('[getPartidosActivosUsuario] Exception:', err);
    return [];
  }
};

/**
 * Helper to create a realtime subscription to partidos changes and call a callback
 * @param {Function} callback - Callback function to call on changes
 * @returns {Object|null} Supabase channel object or null if failed
 */
export const subscribeToPartidosChanges = (callback) => {
  try {
    const channel = supabase.channel('public:partidos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'partidos' }, (payload) => {
        console.log('[subscribeToPartidosChanges] Realtime payload received:', payload);
        if (typeof callback === 'function') callback(payload);
      })
      .subscribe();

    return channel;
  } catch (err) {
    console.error('[subscribeToPartidosChanges] Failed to create subscription:', err);
    return null;
  }
};

/**
 * Create a partidos_frecuentes record from an existing partido row
 * @param {string} partidoId
 * @returns {Promise<Object>} Created frequent match
 */
export const insertPartidoFrecuenteFromPartido = async (partidoRef) => {
  if (!partidoRef) throw new Error('partidoRef required');

  const baseSelect = '*';
  const refAsString = String(partidoRef);
  const refAsNumber = Number(partidoRef);
  const isUuidRef = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(refAsString);

  let partido = null;

  // 1) If reference is numeric, lookup by id first.
  if (Number.isFinite(refAsNumber)) {
    const { data, error } = await supabase
      .from('partidos')
      .select(baseSelect)
      .eq('id', refAsNumber)
      .maybeSingle();

    if (error) throw new Error(`Error fetching partido by id ${refAsNumber}: ${error.message}`);
    if (data) partido = data;
  }

  // 2) Lookup by match_ref only for UUID-like refs (avoid invalid uuid errors)
  if (!partido && isUuidRef) {
    const { data, error } = await supabase
      .from('partidos')
      .select(baseSelect)
      .eq('match_ref', refAsString)
      .maybeSingle();

    if (!error && data) {
      partido = data;
    } else if (error) {
      const msg = String(error.message || '').toLowerCase();
      const missingMatchRef = msg.includes('match_ref') && msg.includes('does not exist');
      if (!missingMatchRef) {
        throw new Error(`Error fetching partido by match_ref ${refAsString}: ${error.message}`);
      }
    }
  }

  if (!partido) throw new Error(`Partido ${partidoRef} not found`);

  // Get current authenticated user (templates are per-user)
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user?.id) throw new Error('User must be authenticated to save templates');

  // Build "jugadores sugeridos" from jugadores table (more robust across schema variants)
  let jugadores_frecuentes = [];
  try {
    const { data: jugadoresRows, error: jugadoresError } = await supabase
      .from('jugadores')
      .select('*')
      .eq('partido_id', partido.id);
    if (jugadoresError) {
      console.warn('[TEMPLATE_UPSERT] Could not load jugadores for template suggestion (non-fatal)', jugadoresError);
    } else {
      jugadores_frecuentes = (jugadoresRows || [])
        .map((j) => ({
          nombre: j?.nombre || j?.displayName || null,
          avatar_url: j?.avatar_url || j?.foto_url || null,
          uuid: j?.usuario_id || j?.uuid || j?.id || null,
        }))
        .filter((j) => j.nombre);
    }
  } catch (playersErr) {
    console.warn('[TEMPLATE_UPSERT] Unexpected error loading jugadores (non-fatal)', playersErr);
  }

  const templateKey = {
    creado_por: user.id,
    nombre: String(partido.nombre || partido.lugar || 'Partido frecuente').trim(),
    sede: String(partido.sede || partido.lugar || '').trim(),
    modalidad: String(partido.modalidad || 'F5').trim(),
    tipo_partido: String(partido.tipo_partido || 'Masculino').trim(),
  };

  // Best-effort "upsert": find most recent matching template for the user and update it; otherwise insert.
  const { data: existing, error: findErr } = await supabase
    .from('partidos_frecuentes')
    .select('id')
    .eq('creado_por', templateKey.creado_por)
    .ilike('nombre', templateKey.nombre)
    .ilike('sede', templateKey.sede)
    .eq('modalidad', templateKey.modalidad)
    .eq('tipo_partido', templateKey.tipo_partido)
    .order('creado_en', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findErr) {
    console.warn('[TEMPLATE_UPSERT] lookup failed, will insert new template', findErr);
  }

  let templateRow = null;

  if (existing?.id) {
    const updates = {
      hora: partido.hora || null,
      habilitado: true,
      fecha: partido.fecha || null,
      dia_semana: partido.fecha ? weekdayFromYMD(partido.fecha) : null,
      imagen_url: partido.imagen_url || null,
      cupo_jugadores: partido.cupo_jugadores ?? null,
      jugadores_frecuentes,
    };
    try {
      templateRow = await updatePartidoFrecuente(existing.id, updates);
    } catch (e) {
      console.warn('[TEMPLATE_UPSERT] update failed, will insert new template', e?.message || e);
      templateRow = null;
    }
  }

  if (!templateRow) {
    const insertPayload = {
      nombre: templateKey.nombre,
      sede: templateKey.sede,
      hora: partido.hora || null,
      jugadores_frecuentes,
      fecha: partido.fecha || null,
      dia_semana: partido.fecha ? weekdayFromYMD(partido.fecha) : null,
      habilitado: true,
      imagen_url: partido.imagen_url || null,
      tipo_partido: templateKey.tipo_partido,
      // Optional fields when present
      ...(partido.modalidad ? { modalidad: partido.modalidad } : {}),
      ...(partido.cupo_jugadores ? { cupo_jugadores: partido.cupo_jugadores } : {}),
    };
    templateRow = await crearPartidoFrecuente(insertPayload);
  }

  // Link the partido to the template (template_id + legacy from_frequent_match_id).
  // Best effort: failure to link shouldn't invalidate the template creation.
  try {
    if (partido?.id && templateRow?.id) {
      const partidoId = Number(partido.id);
      let res = await supabase
        .from('partidos')
        .update({
          template_id: templateRow.id,
          frequent_match_name: templateRow.nombre,
        })
        .eq('id', partidoId);

      if (res?.error && /template_id/i.test(String(res.error.message || ''))) {
        res = await supabase
          .from('partidos')
          .update({
            from_frequent_match_id: templateRow.id,
            frequent_match_name: templateRow.nombre,
          })
          .eq('id', partidoId);
      }

      if (res?.error && /from_frequent_match_id/i.test(String(res.error.message || ''))) {
        res = await supabase
          .from('partidos')
          .update({ frequent_match_name: templateRow.nombre })
          .eq('id', partidoId);
      }

      if (res?.error) {
        console.warn('[TEMPLATE_UPSERT] could not link partido -> template (non-fatal)', res.error);
      }
    }
  } catch (linkErr) {
    console.warn('[TEMPLATE_UPSERT] could not link partido -> template', linkErr);
  }

  return templateRow;
};

/**
 * Subscribe to changes on partidos_frecuentes table
 * @param {Function} callback
 * @returns {Object|null} Supabase channel
 */
export const subscribeToPartidosFrecuentesChanges = (callback) => {
  try {
    const channel = supabase.channel('public:partidos_frecuentes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'partidos_frecuentes' }, (payload) => {
        if (typeof callback === 'function') callback(payload);
      })
      .subscribe();

    return channel;
  } catch (err) {
    console.error('[subscribeToPartidosFrecuentesChanges] Failed to create subscription:', err);
    return null;
  }
};
