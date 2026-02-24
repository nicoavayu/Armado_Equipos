import { supabase } from '../../lib/supabaseClient';
import { schedulePostMatchNotification } from '../notificationService';
import { incrementPartidosAbandonados } from '../matchStatsService';

const generateMatchCode = (length = 6) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

export const normalizeIdentityValue = (value) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

export const buildMatchPlayerIdentityMaps = (jugadores = []) => {
  const byUuid = new Map();
  const byUserId = new Map();
  const byNumericId = new Map();
  const stableRefByAny = new Map();

  for (const jugador of jugadores || []) {
    const uuid = normalizeIdentityValue(jugador?.uuid);
    const userId = normalizeIdentityValue(jugador?.usuario_id);
    const numericId = Number(jugador?.id);

    if (uuid) {
      byUuid.set(uuid, uuid);
    }
    if (userId && uuid) {
      byUserId.set(userId, uuid);
    }
    if (Number.isFinite(numericId) && numericId > 0 && uuid) {
      byNumericId.set(numericId, uuid);
    }

    // Canonical target to persist in votos.votado_id:
    // 1) authenticated users -> usuario_id (stable across roster row replacement)
    // 2) guests/manual players -> uuid
    const stableTargetRef = userId || uuid;
    if (stableTargetRef) {
      if (uuid) stableRefByAny.set(uuid, stableTargetRef);
      if (userId) stableRefByAny.set(userId, stableTargetRef);
      if (Number.isFinite(numericId) && numericId > 0) stableRefByAny.set(String(numericId), stableTargetRef);
    }
  }

  return {
    byUuid,
    byUserId,
    byNumericId,
    stableRefByAny,
  };
};

export const resolveTargetPlayerUuid = (row, identityMaps) => {
  const { byUuid, byUserId, byNumericId } = identityMaps;
  if (!row) return null;

  // Preferred stable references
  const refCandidates = [
    row.votado_uuid,
    row.votado_usuario_id,
    row.votado_id,
    row.jugador_uuid,
    row.player_uuid,
  ];

  for (const ref of refCandidates) {
    const normalized = normalizeIdentityValue(ref);
    if (!normalized) continue;

    if (byUuid.has(normalized)) return byUuid.get(normalized);
    if (byUserId.has(normalized)) return byUserId.get(normalized);

    const asNumber = Number(normalized);
    if (Number.isFinite(asNumber) && byNumericId.has(asNumber)) {
      return byNumericId.get(asNumber);
    }
  }

  // Legacy/public numeric references
  const numericCandidates = [row.votado_jugador_id, row.votado_player_id, row.player_id];
  for (const numericRef of numericCandidates) {
    const asNumber = Number(numericRef);
    if (Number.isFinite(asNumber) && byNumericId.has(asNumber)) {
      return byNumericId.get(asNumber);
    }
  }

  return null;
};

/**
 * Fetch ALL players for a match exactly as stored in DB.
 * Kept for backward compatibility (used by Admin/Encuesta flows).
 * @param {number} partidoId
 * @returns {Promise<Array>} jugadores rows
 */
export const getJugadoresDelPartido = async (partidoId) => {
  const pid = Number(partidoId);
  if (!pid || Number.isNaN(pid)) {
    console.warn('[getJugadoresDelPartido] Invalid ID:', partidoId);
    return [];
  }

  console.log('[getJugadoresDelPartido] Fetching for:', pid);

  const { data, error } = await supabase
    .from('jugadores')
    .select('*')
    .eq('partido_id', pid)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[getJugadoresDelPartido] Error:', error);
    throw new Error(`Error fetching match players: ${error.message}`);
  }

  console.log('[getJugadoresDelPartido] Raw data:', data?.length, data);

  return data || [];
};

/**
 * Fetch a match by numeric id.
 * Legacy export used by AdminPanel routes.
 * @param {number} partidoId
 * @returns {Promise<Object|null>}
 */
export const getPartidoPorId = async (partidoId) => {
  const pid = Number(partidoId);
  if (!pid || Number.isNaN(pid)) return null;
  const { data, error } = await supabase
    .from('partidos')
    .select('*')
    .eq('id', pid)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data || null;
};

/**
 * Fetch match by join code.
 * @param {string} codigo
 * @returns {Promise<Object|null>}
 */
export const getPartidoPorCodigo = async (codigo) => {
  const code = String(codigo || '').trim();
  if (!code) return null;
  const { data, error } = await supabase
    .from('partidos')
    .select('*')
    .eq('codigo', code)
    .maybeSingle();
  if (error) throw error;
  return data || null;
};

/**
 * Legacy alias used by old codepaths.
 * @param {number} partidoId
 * @returns {Promise<Array>}
 */
export const refreshJugadoresPartido = async (partidoId) => getJugadoresDelPartido(partidoId);

/**
 * Update match players list.
 * Legacy API: replaces jugadores rows for partido_id.
 * @param {number} partidoId
 * @param {Array<Object>} nuevosJugadores
 * @returns {Promise<Array>}
 */
export const updateJugadoresPartido = async (partidoId, nuevosJugadores) => {
  const pid = Number(partidoId);
  if (!pid || Number.isNaN(pid)) throw new Error('partidoId inválido');

  // 1. Prepare data for upsert
  const uniqueRowsMap = new Map();
  (nuevosJugadores || []).forEach((j) => {
    // We favor usuario_id or uuid for identity
    const identity = j.usuario_id || j.uuid || j.id;
    if (identity && !uniqueRowsMap.has(identity)) {
      uniqueRowsMap.set(identity, {
        id: j.id, // Preserve ID if present
        partido_id: pid,
        usuario_id: j.usuario_id || null, // Ensure NULL if not a real user
        uuid: j.uuid || null, // Preserve UUID for manual players
        nombre: j.nombre || 'Jugador',
        avatar_url: j.avatar_url || null,
        is_goalkeeper: !!j.is_goalkeeper,
        score: j.score ?? 5
      });
    }
  });
  const rows = Array.from(uniqueRowsMap.values());

  // 2. SAFEGUARD: If the list is empty, we only DELETE if we are SURE it's intentional.
  if (rows.length === 0) {
    console.warn('[UPDATE_JUGADORES] Attempted to set empty player list for match:', pid, '- Skipping for safety');
    return [];
  }

  // 3. Split into Real Users vs Manual Players
  // Real users have a valid usuario_id and subject to UNIQUE(partido_id, usuario_id)
  // Manual players do NOT have usuario_id, so we must upsert by ID or insert new.
  const realUsers = rows.filter(r => r.usuario_id);
  const manualPlayers = rows.filter(r => !r.usuario_id && r.id); // Only update manual players that have an ID

  const results = [];

  // 3a. Upsert Real Users
  if (realUsers.length > 0) {
    const { data: upsertedUsers, error: userErr } = await supabase
      .from('jugadores')
      .upsert(realUsers, { onConflict: 'partido_id, usuario_id' })
      .select('*');

    if (userErr) throw userErr;
    if (upsertedUsers) results.push(...upsertedUsers);
  }

  // 3b. Upsert Manual Players (Update by ID)
  if (manualPlayers.length > 0) {
    // We use onConflict: 'id' to update existing manual players
    const { data: upsertedManual, error: manualErr } = await supabase
      .from('jugadores')
      .upsert(manualPlayers, { onConflict: 'id' })
      .select('*');

    if (manualErr) throw manualErr;
    if (upsertedManual) results.push(...upsertedManual);
  }

  // 4. Cleanup: Remove players that are NO LONGER in the list
  // Only remove if they are NOT in the 'rows' identity list
  const activeUserIds = rows.map(r => r.usuario_id).filter(Boolean);
  if (activeUserIds.length > 0) {
    const { error: cleanErr } = await supabase
      .from('jugadores')
      .delete()
      .eq('partido_id', pid)
      .not('usuario_id', 'in', `(${activeUserIds.join(',')})`);

    if (cleanErr) {
      console.warn('[UPDATE_JUGADORES] Cleanup error (non-fatal):', cleanErr);
    }
  }

  return results || [];
};

/**
 * Create match.
 * Minimal legacy wrapper; expects payload matching partidos table.
 * @param {Object} partidoData
 * @returns {Promise<Object>}
 */
export const crearPartido = async (partidoData) => {
  let attempts = 0;
  let payload = {
    ...partidoData,
    codigo: String(partidoData?.codigo || '').trim() || generateMatchCode(),
  };

  while (attempts < 3) {
    const { data, error } = await supabase
      .from('partidos')
      .insert([payload])
      .select()
      .single();
    if (!error) return data;

    // Retry only when code collides with unique constraint.
    const errMsg = `${error?.message || ''}`.toLowerCase();
    if (error?.code === '23505' && errMsg.includes('codigo')) {
      attempts += 1;
      payload = { ...payload, codigo: generateMatchCode() };
      continue;
    }

    throw error;
  }

  throw new Error('No se pudo generar un código único para el partido');
};

// --- Guest Session Management ---

/**
 * Generate or get existing guest session ID for a specific match
 * @param {number} partidoId - Match ID
 * @returns {string} Guest session ID
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
 * @param {number} partidoId - Match ID (optional)
 * @returns {Promise<string>} User ID
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
 * @param {number} partidoId - Match ID (optional)
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

// --- API de Votos ---

/**
 * Get voter IDs for a match
 * @param {number} partidoId - Match ID
 * @returns {Promise<Array>} Array of voter IDs
 */
export const getVotantesIds = async (partidoId) => {
  if (!partidoId) {
    console.warn('getVotantesIds: No partidoId provided');
    return [];
  }

  console.log('Fetching voters for match:', partidoId);

  // 1. Fetch authenticated/legacy voters from 'votos'
  const { data: regularData, error: regularError } = await supabase
    .from('votos')
    .select('votante_id')
    .eq('partido_id', partidoId);

  if (regularError) {
    console.error('Error fetching regular voters:', regularError);
  }

  // 2. Fetch public voters from 'public_voters'
  const { data: publicData, error: publicError } = await supabase
    .from('public_voters')
    .select('id')
    .eq('partido_id', partidoId);

  if (publicError) {
    console.warn('Error fetching public voters (non-fatal):', publicError);
  }

  const regularIds = (regularData || []).map((v) => v.votante_id).filter(Boolean);
  const publicIds = (publicData || []).map((pv) => `public_${pv.id}`);

  const combinedVoters = Array.from(new Set([...regularIds, ...publicIds]));

  console.log('Voters found for match:', {
    partidoId,
    total: combinedVoters.length,
    authenticated: regularIds.length,
    public: publicIds.length,
  });

  return combinedVoters;
};

/**
 * Get voters with names for a match
 * @param {number} partidoId - Match ID
 * @returns {Promise<Array>} Array of voters with names
 */
export const getVotantesConNombres = async (partidoId) => {
  if (!partidoId) {
    console.warn('getVotantesConNombres: No partidoId provided');
    return [];
  }

  console.log('Fetching voters with names for match:', partidoId);

  // 1. Fetch authenticated/legacy voters from 'votos' table
  const { data: votosData, error: votosError } = await supabase
    .from('votos')
    .select('votante_id, jugador_nombre, jugador_avatar_url')
    .eq('partido_id', partidoId);

  if (votosError) {
    console.error('Error fetching voters with names:', votosError);
    throw new Error(`Error fetching voters: ${votosError.message}`);
  }

  // 2. Fetch public voters from 'public_voters' table
  const { data: publicVotersData, error: publicVotersError } = await supabase
    .from('public_voters')
    .select('id, nombre')
    .eq('partido_id', partidoId);

  if (publicVotersError) {
    console.warn('Error fetching public voters (non-fatal):', publicVotersError);
  }

  // Group by votante_id and get unique voters with their names
  const votantesMap = new Map();

  // Add voters from 'votos'
  (votosData || []).forEach((voto) => {
    if (voto.votante_id && !votantesMap.has(voto.votante_id)) {
      votantesMap.set(voto.votante_id, {
        nombre: voto.jugador_nombre || 'Jugador',
        avatar_url: voto.jugador_avatar_url,
      });
    }
  });

  // Add voters from 'public_voters'
  (publicVotersData || []).forEach((pv) => {
    const guestId = `public_${pv.id}`;
    if (!votantesMap.has(guestId)) {
      votantesMap.set(guestId, {
        nombre: pv.nombre || 'Invitado',
        avatar_url: null,
      });
    }
  });

  const votantes = Array.from(votantesMap.entries()).map(([id, data]) => ({
    id,
    nombre: data.nombre,
    avatar_url: data.avatar_url,
  }));

  console.log('Voters with names found (combined):', {
    total: votantes.length,
    public: (publicVotersData || []).length
  });
  return votantes;
};

/**
 * Returns true when a match already has persisted votes.
 * Used to protect roster edits that can orphan vote references.
 * @param {number} partidoId
 * @returns {Promise<boolean>}
 */
export const hasRecordedVotes = async (partidoId) => {
  const pid = Number(partidoId);
  if (!pid || Number.isNaN(pid)) return false;

  try {
    const [authRes, publicRes] = await Promise.all([
      supabase
        .from('votos')
        .select('id', { count: 'exact', head: true })
        .eq('partido_id', pid),
      supabase
        .from('votos_publicos')
        .select('id', { count: 'exact', head: true })
        .eq('partido_id', pid),
    ]);

    if (authRes.error) {
      console.warn('[hasRecordedVotes] votos count failed (non-fatal):', authRes.error);
    }
    if (publicRes.error) {
      console.warn('[hasRecordedVotes] votos_publicos count failed (non-fatal):', publicRes.error);
    }

    const authCount = Number(authRes.count || 0);
    const publicCount = Number(publicRes.count || 0);
    return authCount + publicCount > 0;
  } catch (error) {
    console.warn('[hasRecordedVotes] failed, falling back to false:', error);
    return false;
  }
};

/**
 * Check if user has already voted in a match
 * @param {string} votanteId - Voter ID
 * @param {number} partidoId - Match ID
 * @returns {Promise<boolean>} Whether user has voted
 */
export const checkIfAlreadyVoted = async (votanteId, partidoId) => {
  if (!votanteId) {
    votanteId = await getCurrentUserId(partidoId);
  }

  const pid = Number(partidoId);

  if (!votanteId || !pid || Number.isNaN(pid)) {
    console.warn('❗️ checkIfAlreadyVoted: Parámetros inválidos', { votanteId, partidoId });
    return false;
  }

  console.log('🔎 Chequeando si YA VOTÓ (Legacy + Public):', { votanteId, partidoId: pid });

  try {
    // 1. Check regular 'votos' table
    const { data: authVotes, error: authError } = await supabase
      .from('votos')
      .select('id')
      .eq('votante_id', votanteId)
      .eq('partido_id', pid);

    if (authError) throw authError;
    if (authVotes && authVotes.length > 0) return true;

    // 2. Check public votes
    // If it's a guest ID, check by public_voter_id
    if (votanteId.toString().startsWith('public_')) {
      const publicId = votanteId.replace('public_', '');
      const { data: pubVotes, error: pubError } = await supabase
        .from('votos_publicos')
        .select('id')
        .eq('public_voter_id', publicId)
        .eq('partido_id', pid);
      if (pubError) throw pubError;
      if (pubVotes && pubVotes.length > 0) return true;
    }

    // 3. Name-based check (Paranoid)
    // Try to find the name of this votanteId from jugadores or public_voters
    let voterName = null;

    // Is it a registered user?
    const { data: player } = await supabase
      .from('jugadores')
      .select('nombre')
      .eq('usuario_id', votanteId)
      .eq('partido_id', pid)
      .maybeSingle();

    if (player) voterName = player.nombre;

    if (!voterName && votanteId.toString().startsWith('public_')) {
      // Is it a guest?
      const publicId = votanteId.replace('public_', '');
      const { data: pv } = await supabase
        .from('public_voters')
        .select('nombre')
        .eq('id', publicId)
        .maybeSingle();
      if (pv) voterName = pv.nombre;
    }

    // 3. NAME-BASED CHECK (Case-insensitive)
    if (voterName) {
      const normalized = voterName.trim().toLowerCase();

      // Check in public votes by name (case-insensitive)
      const { data: pubVotes } = await supabase
        .from('votos_publicos')
        .select('id, votante_nombre')
        .eq('partido_id', pid);

      const alreadyInPubVotos = pubVotes?.some(v =>
        v.votante_nombre && v.votante_nombre.trim().toLowerCase() === normalized
      );
      if (alreadyInPubVotos) return true;

      // Check in authenticated 'votos' by name (case-insensitive)
      const { data: vbn } = await supabase
        .from('votos')
        .select('id, jugador_nombre')
        .eq('partido_id', pid);

      const alreadyInAuthVotos = vbn?.some(v =>
        v.jugador_nombre && v.jugador_nombre.trim().toLowerCase() === normalized
      );
      if (alreadyInAuthVotos) return true;
    }

    return false;
  } catch (err) {
    console.warn('⚠️ Error in deep voting check:', err);
    return false;
  }
};

/**
 * Submit votes for a match
 * @param {Object} votos - Votes object
 * @param {string} jugadorUuid - Player UUID
 * @param {number} partidoId - Match ID
 * @param {string} jugadorNombre - Player name
 * @param {string} jugadorFoto - Player photo URL
 * @returns {Promise<Array>} Inserted votes
 */
export const submitVotos = async (votos, jugadorUuid, partidoId, jugadorNombre, jugadorFoto) => {
  console.log('🚀 SUBMIT VOTOS CALLED:', { votos, jugadorUuid, partidoId, jugadorNombre });

  if (!jugadorUuid || typeof jugadorUuid !== 'string' || jugadorUuid.trim() === '') {
    throw new Error('jugadorUuid must be a valid non-empty string');
  }
  if (!partidoId || typeof partidoId !== 'number' || partidoId <= 0) {
    throw new Error('partido_id must be a valid positive number');
  }
  if (!votos || typeof votos !== 'object' || Object.keys(votos).length === 0) {
    throw new Error('votos must be a valid non-empty object');
  }

  const votanteId = await getCurrentUserId(partidoId);
  console.log('Current voter ID:', votanteId, 'Is guest:', votanteId.startsWith('guest_'));

  console.log('Checking if already voted...');
  const hasVoted = await checkIfAlreadyVoted(votanteId, partidoId);
  console.log('Has voted result:', hasVoted);

  if (hasVoted) {
    throw new Error('Ya votaste en este partido');
  }

  // Build stable target references to avoid losing votes when jugadores rows are replaced.
  let identityMaps = { stableRefByAny: new Map() };
  try {
    const { data: matchPlayers, error: rosterError } = await supabase
      .from('jugadores')
      .select('id, uuid, usuario_id')
      .eq('partido_id', partidoId);
    if (rosterError) {
      console.warn('[submitVotos] Could not fetch roster identities (non-fatal):', rosterError);
    } else {
      identityMaps = buildMatchPlayerIdentityMaps(matchPlayers || []);
    }
  } catch (rosterCatchError) {
    console.warn('[submitVotos] Roster identity lookup failed (non-fatal):', rosterCatchError);
  }

  const votosParaInsertar = Object.entries(votos)
    .filter(([, puntaje]) => puntaje !== undefined && puntaje !== null)
    .map(([votado_id, puntaje]) => {
      const normalizedTarget = normalizeIdentityValue(votado_id);
      if (!normalizedTarget) {
        return null;
      }
      const stableTarget = identityMaps.stableRefByAny.get(normalizedTarget) || normalizedTarget;
      return {
        votado_id: stableTarget,
        votante_id: votanteId,
        puntaje: Number(puntaje),
        partido_id: partidoId,
        jugador_nombre: jugadorNombre || 'Jugador',
        jugador_avatar_url: jugadorFoto || null,
      };
    })
    .filter((voto) => voto !== null);

  if (votosParaInsertar.length === 0) {
    throw new Error('No hay votos válidos para insertar');
  }

  console.log('INSERTING VOTES:', {
    count: votosParaInsertar.length,
    partidoId,
    jugadorUuid,
    votanteId,
    isGuest: votanteId.startsWith('guest_'),
    votes: votosParaInsertar,
  });

  const { data, error } = await supabase.from('votos').insert(votosParaInsertar).select();
  if (error) {
    console.error('❌ Error insertando votos:', error);
    console.error('Error details:', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });

    if (error.code === '23505') {
      throw new Error('Ya votaste en este partido');
    }
    if (error.code === '42501') {
      throw new Error('No tienes permisos para votar. Verifica las políticas de Supabase.');
    }
    throw new Error(`Error al guardar los votos: ${error.message}`);
  }

  console.log(`✅ Successfully inserted ${votosParaInsertar.length} votes for match ${partidoId}:`, data);
  return data;
};

/**
 * Close voting and calculate scores for a match
 * @param {number} partidoId - Match ID
 * @returns {Promise<Object>} Calculation results
 */
export const closeVotingAndCalculateScores = async (partidoId) => {
  console.log('📊 SUPABASE: Starting closeVotingAndCalculateScores');

  try {
    // 1. Fetch votes from regular 'votos' table (authenticated users)
    const { data: votos, error: fetchError } = await supabase
      .from('votos')
      .select('*')
      .eq('partido_id', partidoId);

    if (fetchError) {
      console.error('❌ SUPABASE: Error fetching votes:', fetchError);
      throw new Error('Error al obtener los votos: ' + fetchError.message);
    }

    // 2. Fetch votes from 'votos_publicos' table (guest users)
    const { data: publicVotes, error: publicFetchError } = await supabase
      .from('votos_publicos')
      .select('*')
      .eq('partido_id', partidoId);

    if (publicFetchError) {
      console.warn('⚠️ SUPABASE: Error fetching public votes (non-fatal):', publicFetchError);
    }

    const regularRowsCount = votos?.length || 0;
    const publicRowsCount = publicVotes?.length || 0;
    const authVotersCount = new Set((votos || []).map((v) => v.votante_id).filter(Boolean)).size;

    // Public "voters completed" count (used for debug consistency checks)
    const { count: publicVotersCount, error: publicVotersError } = await supabase
      .from('public_voters')
      .select('id', { count: 'exact', head: true })
      .eq('partido_id', partidoId);

    if (publicVotersError) {
      console.warn('⚠️ SUPABASE: Error fetching public_voters count (non-fatal):', publicVotersError);
    }

    console.log('✅ SUPABASE: All votes fetched:', {
      regularCount: votos?.length || 0,
      publicCount: publicVotes?.length || 0,
      authVotersCount,
      publicVotersCount: publicVotersCount || 0,
    });

    const { data: jugadores, error: playerError } = await supabase
      .from('jugadores')
      .select('id, uuid, usuario_id, nombre, is_goalkeeper')
      .eq('partido_id', partidoId);

    if (playerError) {
      console.error('❌ SUPABASE: Error fetching players:', playerError);
      throw new Error('Error al obtener los jugadores: ' + playerError.message);
    }

    console.log('✅ SUPABASE: Players fetched:', {
      count: jugadores?.length || 0,
      players: jugadores?.map((j) => ({ uuid: j.uuid, nombre: encodeURIComponent(j.nombre || '') })) || [],
    });

    if (!jugadores || jugadores.length === 0) {
      console.warn('⚠️ SUPABASE: No players found');
      return { message: 'No hay jugadores para actualizar.' };
    }

    const votesByPlayer = {};
    const goalkeepers = new Set();
    let totalValidVotes = 0;
    let totalInvalidVotes = 0;
    let unresolvedAuthTargets = 0;
    let unresolvedPublicTargets = 0;
    let invalidAuthScores = 0;
    let invalidPublicScores = 0;
    const identityMaps = buildMatchPlayerIdentityMaps(jugadores || []);

    // Process regular votes (uuid/user-id based)
    if (votos && votos.length > 0) {
      for (const voto of votos) {
        const targetUuid = resolveTargetPlayerUuid(voto, identityMaps);
        if (!targetUuid) {
          unresolvedAuthTargets++;
          totalInvalidVotes++;
          continue;
        }
        if (!votesByPlayer[targetUuid]) votesByPlayer[targetUuid] = [];

        if (voto.puntaje !== null && voto.puntaje !== undefined) {
          const score = Number(voto.puntaje);
          if (!isNaN(score)) {
            if (score === -2) goalkeepers.add(targetUuid);
            else votesByPlayer[targetUuid].push(score);
            totalValidVotes++;
          } else {
            invalidAuthScores++;
            totalInvalidVotes++;
          }
        } else {
          invalidAuthScores++;
          totalInvalidVotes++;
        }
      }
    }

    // Process public votes (id/uuid/user-id correlation)
    if (publicVotes && publicVotes.length > 0) {
      for (const pv of publicVotes) {
        const playerUuid = resolveTargetPlayerUuid(pv, identityMaps);
        if (!playerUuid) {
          unresolvedPublicTargets++;
          totalInvalidVotes++;
          continue;
        }

        if (!votesByPlayer[playerUuid]) votesByPlayer[playerUuid] = [];

        if (pv.no_lo_conozco) {
          // Explicit "no lo conozco" is valid and excluded from average.
          continue;
        }

        if (pv.puntaje === null || pv.puntaje === undefined) {
          invalidPublicScores++;
          totalInvalidVotes++;
          continue;
        }

        const score = Number(pv.puntaje);
        if (!isNaN(score) && score >= 1 && score <= 10) {
          votesByPlayer[playerUuid].push(score);
          totalValidVotes++;
        } else {
          invalidPublicScores++;
          totalInvalidVotes++;
        }
      }
    }

    console.log('✅ SUPABASE: Votes grouped:', {
      totalValidVotes,
      totalInvalidVotes,
      unresolvedAuthTargets,
      unresolvedPublicTargets,
      invalidAuthScores,
      invalidPublicScores,
      playersWithVotes: Object.keys(votesByPlayer).length,
      voteDistribution: Object.entries(votesByPlayer).map(([playerId, votes]) => ({
        playerId,
        voteCount: votes.length,
        votes: votes.filter((v) => v !== -1),
      })),
    });

    const unresolvedTargets = unresolvedAuthTargets + unresolvedPublicTargets;
    const corruptedVotes = invalidAuthScores + invalidPublicScores;

    // Sacred integrity guard: if any persisted vote cannot be processed, abort close.
    // This avoids silently dropping votes and falling back to default scores.
    if (unresolvedTargets > 0 || corruptedVotes > 0) {
      throw new Error(
        `Se detectaron votos no procesables. ` +
        `(unresolved_auth=${unresolvedAuthTargets}, unresolved_public=${unresolvedPublicTargets}, ` +
        `invalid_auth=${invalidAuthScores}, invalid_public=${invalidPublicScores}, ` +
        `auth_rows=${regularRowsCount}, public_rows=${publicRowsCount})`
      );
    }

    // Hard guard: never close voting with zero valid votes.
    // This prevents "all players score 5" false outcomes when persistence failed upstream.
    if (totalValidVotes <= 0) {
      throw new Error(
        `No hay votos válidos guardados para cerrar la votación. ` +
        `(auth_rows=${regularRowsCount}, public_rows=${publicRowsCount}, ` +
        `auth_voters=${authVotersCount}, public_voters=${publicVotersCount || 0})`
      );
    }

    const updates = [];
    const scoreUpdates = [];

    for (const jugador of jugadores) {
      const playerVotes = votesByPlayer[jugador.uuid] || [];
      const isGoalkeeper = goalkeepers.has(jugador.uuid);

      const numericalVotes = playerVotes
        .map((p) => Number(p))
        .filter((p) => !isNaN(p) && p !== -1 && p !== -2 && p >= 1 && p <= 10);

      let avgScore = 5;
      if (numericalVotes.length > 0) {
        const total = numericalVotes.reduce((sum, val) => sum + val, 0);
        avgScore = total / numericalVotes.length;
      }

      scoreUpdates.push({
        uuid: jugador.uuid,
        nombre: jugador.nombre,
        votes: numericalVotes,
        avgScore,
        isGoalkeeper,
      });

      const updatePromise = supabase
        .from('jugadores')
        .update({
          score: avgScore,
          is_goalkeeper: isGoalkeeper,
        })
        .eq('uuid', jugador.uuid)
        .eq('partido_id', partidoId);

      updates.push(updatePromise);
    }

    console.log('✅ SUPABASE: Score calculations:', scoreUpdates);

    console.log('📊 SUPABASE: Executing score updates');
    const updateResults = await Promise.allSettled(updates);
    const updateErrors = updateResults.filter((res) => res.status === 'rejected');
    const successfulUpdates = updateResults.filter((res) => res.status === 'fulfilled');

    if (updateErrors.length > 0) {
      console.error('❌ SUPABASE: Score update errors:', updateErrors.map((e, index) => ({
        index,
        player: scoreUpdates[index]?.nombre,
        uuid: scoreUpdates[index]?.uuid,
        reason: e.reason,
      })));

      console.warn(`⚠️ SUPABASE: ${updateErrors.length} updates failed, ${successfulUpdates.length} succeeded`);

      // Si TODAS las actualizaciones fallaron, lanzar error
      if (successfulUpdates.length === 0) {
        throw new Error('No se pudo actualizar ningún jugador. Verifica los permisos en Supabase.');
      }

      // Si solo algunas fallaron, continuar con advertencia
      console.warn(`⚠️ SUPABASE: Continuando con ${successfulUpdates.length} actualizaciones exitosas`);
    }

    console.log('✅ SUPABASE: All scores updated successfully');

    console.log('📊 SUPABASE: Step 5 - Clearing votes for match:', partidoId);

    // Clear regular votes
    const { error: deleteError, count: deletedCount } = await supabase
      .from('votos')
      .delete()
      .eq('partido_id', partidoId);

    // Clear public votes
    const { error: publicDeleteError, count: publicDeletedCount } = await supabase
      .from('votos_publicos')
      .delete()
      .eq('partido_id', partidoId);

    if (deleteError || publicDeleteError) {
      console.error('❌ SUPABASE: Error clearing votes:', { deleteError, publicDeleteError });
    }

    console.log('✅ SUPABASE: Votes cleared:', { deletedCount, publicDeletedCount });

    const result = {
      message: `Votación cerrada. Se actualizaron los puntajes de ${successfulUpdates.length}/${jugadores.length} jugadores.`,
      playersUpdated: successfulUpdates.length,
      playersTotal: jugadores.length,
      updateErrors: updateErrors.length,
      votesProcessed: totalValidVotes,
      votesCleared: deletedCount || votos?.length || 0,
    };

    console.log('🎉 SUPABASE: closeVotingAndCalculateScores completed successfully:', result);
    return result;

  } catch (error) {
    console.error('❌ SUPABASE: closeVotingAndCalculateScores failed:', error);
    console.error('❌ SUPABASE: Error stack:', error.stack);
    throw error;
  }
};

/**
 * Reset all votes for a match
 * @param {number} partidoId - Match ID
 * @returns {Promise<Object>} Reset results
 */
export const resetVotacion = async (partidoId) => {
  console.log('🔄 SUPABASE: Starting resetVotacion for match:', partidoId);

  try {
    if (!partidoId) {
      throw new Error('Match ID is required to reset votes');
    }

    // Normalizar ID para evitar mismatches (string vs number)
    const pidNumber = Number(partidoId);
    const pidTargets = Number.isFinite(pidNumber) ? [pidNumber, String(pidNumber)] : [String(partidoId)];

    // Primero, intentar vía RPC (security definer) para evitar restricciones RLS
    let deletedCount = 0;
    let rpcTried = false;

    try {
      rpcTried = true;
      const { error: rpcError } = await supabase.rpc('reset_votacion', { match_id: pidNumber });
      if (rpcError) {
        console.warn('⚠️ SUPABASE: reset_votacion RPC falló, se usará fallback:', rpcError);
      } else {
        console.log('✅ SUPABASE: reset_votacion RPC ejecutada');
      }
    } catch (rpcErr) {
      console.warn('⚠️ SUPABASE: reset_votacion RPC throw, usando fallback', rpcErr);
    }

    // Fallback o validación: borrar votos manualmente (agresivo, numérico y string)
    for (const target of pidTargets) {
      try {
        // Clear regular votes
        await supabase.from('votos').delete().eq('partido_id', target);

        // Clear public votes and voters
        await supabase.from('votos_publicos').delete().eq('partido_id', target);
        await supabase.from('public_voters').delete().eq('partido_id', target);

        deletedCount += 1; // Increment just to show activity
      } catch (fallbackErr) {
        console.warn(`⚠️ Error in fallback deletion for target ${target}:`, fallbackErr);
      }
    }

    console.log('✅ SUPABASE: All votes (regular and public) deleted/reset', { rpcTried });

    // Force match update to signal all clients via realtime
    try {
      const { error: updateErr } = await supabase
        .from('partidos')
        .update({
          estado: 'votacion',
          updated_at: new Date().toISOString()
        })
        .eq('id', pidNumber);

      if (updateErr) {
        console.warn('⚠️ SUPABASE: Update with updated_at failed, retrying simplified:', updateErr);
        await supabase
          .from('partidos')
          .update({ estado: 'votacion' })
          .eq('id', pidNumber);
      }
    } catch (err) {
      console.warn('⚠️ Error triggering match update in reset:', err);
    }


    // Reset scores for all players in the match
    const { data: jugadores, error: playerError } = await supabase
      .from('jugadores')
      .select('uuid')
      .in('partido_id', pidTargets);

    if (playerError) {
      console.error('❌ SUPABASE: Error fetching players:', playerError);
      throw new Error('Error al obtener jugadores: ' + playerError.message);
    }

    if (jugadores && jugadores.length > 0) {
      const resetPromises = jugadores.map((j) =>
        supabase
          .from('jugadores')
          .update({ score: null })
          .eq('uuid', j.uuid)
          .in('partido_id', pidTargets),
      );

      const results = await Promise.allSettled(resetPromises);
      const successCount = results.filter((r) => r.status === 'fulfilled').length;

      console.log('✅ SUPABASE: Player scores reset:', {
        total: jugadores.length,
        successful: successCount,
      });
    }

    // Reset partido estado y limpiar equipos formados
    console.log('🔄 SUPABASE: Resetting partido estado to "votacion"...');
    // Some deployments don't have equipos_json; attempt full update, then fallback to estado-only.
    let partidoError = null;
    {
      const { error } = await supabase
        .from('partidos')
        .update({ estado: 'votacion', equipos_json: null })
        .eq('id', pidNumber);
      partidoError = error;
    }

    if (partidoError) {
      console.warn('⚠️ SUPABASE: update(partidos) with equipos_json failed, retrying estado-only', partidoError);
      const { error: estadoOnlyErr } = await supabase
        .from('partidos')
        .update({ estado: 'votacion' })
        .eq('id', pidNumber);
      if (estadoOnlyErr) {
        console.error('❌ SUPABASE: Error updating partido estado:', estadoOnlyErr);
        throw new Error('Error al resetear estado del partido: ' + estadoOnlyErr.message);
      }
    }

    console.log('✅ SUPABASE: Partido estado reset to "votacion"');

    // Verificar que no queden votos colgando
    try {
      const { data: remaining, error: remainingError } = await supabase
        .from('votos')
        .select('id')
        .in('partido_id', pidTargets);

      if (remainingError) {
        console.warn('⚠️ SUPABASE: No se pudo verificar votos restantes', remainingError);
      } else if (remaining && remaining.length > 0) {
        console.warn('⚠️ SUPABASE: Quedaron votos sin borrar después de reset', remaining.length);
      }
    } catch (verifyError) {
      console.warn('⚠️ SUPABASE: Error verificando votos restantes', verifyError);
    }

    const result = {
      message: 'Votación reseteada exitosamente',
      votesDeleted: deletedCount || 0,
      playersReset: jugadores?.length || 0,
    };

    console.log('🎉 SUPABASE: resetVotacion completed successfully:', result);
    return result;

  } catch (error) {
    console.error('❌ SUPABASE: resetVotacion failed:', error);
    throw error;
  }
};

/**
 * Clear votes for a match
 * @param {number} partidoId - Match ID
 * @returns {Promise<void>}
 */
export const clearVotesForMatch = async (partidoId) => {
  // Clear regular votes
  await supabase.from('votos').delete().eq('partido_id', partidoId);

  // Clear public votes and voters
  await supabase.from('votos_publicos').delete().eq('partido_id', partidoId);
  await supabase.from('public_voters').delete().eq('partido_id', partidoId);

  console.log('✅ Votes cleared for match:', partidoId);
};

/**
 * Cleanup invalid votes
 * @returns {Promise<Object>} Cleanup results
 */
export const cleanupInvalidVotes = async () => {
  console.log('🧹 Starting cleanup of invalid votes...');

  // 1. Cleanup regular votes
  const { error: errorAuth, count: countAuth } = await supabase
    .from('votos')
    .delete()
    .or('partido_id.is.null,votante_id.is.null,votado_id.is.null');

  // 2. Cleanup public votes
  const { error: errorPub, count: countPub } = await supabase
    .from('votos_publicos')
    .delete()
    .or('partido_id.is.null,public_voter_id.is.null,votado_jugador_id.is.null');

  if (errorAuth) console.error('Error cleaning auth votes:', errorAuth);
  if (errorPub) console.error('Error cleaning public votes:', errorPub);

  const total = (countAuth || 0) + (countPub || 0);
  console.log(`✅ Cleaned up ${total} total invalid votes`);
  return { cleaned: total };
};

/**
 * Debug function to test voting
 * @param {number} partidoId - Match ID
 * @returns {Promise<Object>}
 */
export const debugTestVoting = async (partidoId) => {
  console.log('🔍 Debug Test Voting for match:', partidoId);

  try {
    // Obtener información del partido
    const { data: partido, error: partidoError } = await supabase
      .from('partidos')
      .select('id, estado, equipos_json')
      .eq('id', partidoId)
      .single();

    if (partidoError) {
      throw new Error('Error al obtener el partido: ' + partidoError.message);
    }

    console.log('Partido encontrado:', partido);

    // Si el partido ya está cerrado, no se puede votar
    if (partido.estado !== 'votacion') {
      return { message: 'El partido ya está cerrado para votación', partidoId };
    }

    // Obtener jugadores en el partido
    const { data: jugadores, error: jugadoresError } = await supabase
      .from('jugadores')
      .select('uuid, nombre')
      .eq('partido_id', partidoId);

    if (jugadoresError) {
      throw new Error('Error al obtener los jugadores: ' + jugadoresError.message);
    }

    if (!jugadores || jugadores.length === 0) {
      return { message: 'No hay jugadores disponibles para votar', partidoId };
    }

    // Asignar puntajes de ejemplo (1 a 10) a cada jugador
    const votosEjemplo = {};
    jugadores.forEach((j, index) => {
      // Puntaje aleatorio entre 1 y 10
      const puntaje = Math.floor(Math.random() * 10) + 1;
      votosEjemplo[j.uuid] = puntaje;
    });

    console.log('Votos de ejemplo generados:', votosEjemplo);

    // Enviar votos usando la función existente
    const resultadoVotos = await submitVotos(votosEjemplo, jugadores[0].uuid, partidoId, jugadores[0].nombre, null);

    return {
      message: 'Votación de prueba realizada con éxito',
      partidoId,
      votos: resultadoVotos,
    };

  } catch (error) {
    console.error('❌ Error en debugTestVoting:', error);
    return { error: error.message };
  }
};

/**
 * Cancel a match with notifications
 * Uses RPC to notify all participants before soft-deleting
 * @param {number} partidoId - Match ID
 * @param {string} reason - Cancellation reason
 * @returns {Promise<Object>} Result with notification details
 */
export const cancelPartidoWithNotification = async (partidoId, reason = 'Partido cancelado') => {
  console.log('[NOTIF_DEBUG] Cancelling match with notification:', partidoId, reason);

  const { data, error } = await supabase.rpc('cancel_partido_with_notification', {
    p_partido_id: partidoId,
    p_reason: reason
  });

  if (error) {
    console.error('[NOTIF_DEBUG] Error cancelling match:', error);
    throw error;
  }

  console.log('[NOTIF_DEBUG] Match cancelled, notification result:', data);
  return data;
};

/**
 * Delete a match with notifications
 * Sends notifications before marking as deleted
 * @param {number} partidoId - Match ID
 * @returns {Promise<Object>} Result with notification details
 */
export const deletePartidoWithNotification = async (partidoId) => {
  console.log('[NOTIF_DEBUG] Deleting match with notification:', partidoId);

  // First notify
  const { data: notifResult, error: notifError } = await supabase.rpc('enqueue_partido_notification', {
    p_partido_id: partidoId,
    p_type: 'match_deleted',
    p_title: 'Partido eliminado',
    p_message: 'El partido ha sido eliminado por el administrador',
    p_payload: { match_id: partidoId }
  });

  if (notifError) {
    console.error('[NOTIF_DEBUG] Error sending delete notification:', notifError);
    // Continue with delete even if notification fails
  } else {
    console.log('[NOTIF_DEBUG] Delete notification sent:', notifResult);
  }

  // Then soft delete
  const { error: deleteError } = await supabase
    .from('partidos')
    .update({ estado: 'deleted', deleted_at: new Date().toISOString() })
    .eq('id', partidoId);

  if (deleteError) {
    console.error('[NOTIF_DEBUG] Error deleting match:', deleteError);
    throw deleteError;
  }

  return notifResult;
};
