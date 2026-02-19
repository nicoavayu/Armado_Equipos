import { supabase } from '../../lib/supabaseClient';

const AWARD_WON_NOTIFICATION_TYPE = 'award_won';

const resolveMatchName = async (matchId) => {
  try {
    const { data, error } = await supabase
      .from('partidos')
      .select('nombre')
      .eq('id', matchId)
      .maybeSingle();

    if (error) throw error;

    const parsed = String(data?.nombre || '').trim();
    if (parsed) return parsed;
  } catch (_error) {
    // Fallback to generic label when metadata fetch fails.
  }

  return `partido ${matchId}`;
};

const awardLabelByType = (awardType) => {
  if (awardType === 'mvp') return 'MVP';
  if (awardType === 'best_gk') return 'Mejor Arquero';
  if (awardType === 'red_card') return 'Jugador más sucio';
  return 'Premio';
};

const insertAwardWonNotification = async ({
  userId,
  matchId,
  matchName,
  awardType,
}) => {
  if (!userId || !matchId || !awardType) return;

  // Avoid duplicates per user + partido + award_type
  const { data: existingRows, error: existingErr } = await supabase
    .from('notifications')
    .select('id, data')
    .eq('user_id', userId)
    .eq('partido_id', Number(matchId))
    .eq('type', AWARD_WON_NOTIFICATION_TYPE);

  if (existingErr) throw existingErr;

  const alreadyExists = (existingRows || []).some((row) => row?.data?.award_type === awardType);
  if (alreadyExists) return;

  const awardLabel = awardLabelByType(awardType);
  const resultsUrl = `/resultados-encuesta/${matchId}?showAwards=1`;

  const { error } = await supabase
    .from('notifications')
    .insert([{
      user_id: userId,
      partido_id: Number(matchId),
      type: AWARD_WON_NOTIFICATION_TYPE,
      title: `Ganaste un premio: ${awardLabel}`,
      message: `Ganaste "${awardLabel}" en el partido "${matchName}".`,
      data: {
        match_id: String(matchId),
        match_name: matchName,
        award_type: awardType,
        award_label: awardLabel,
        link: resultsUrl,
        resultsUrl,
      },
      read: false,
      created_at: new Date().toISOString(),
    }]);

  if (error) throw error;
};

const incrementUsuarioCounter = async (userId, column) => {
  try {
    const { error: rpcError } = await supabase.rpc('inc_numeric', {
      p_table: 'usuarios',
      p_column: column,
      p_id: userId,
      p_amount: 1,
    });
    if (rpcError) throw rpcError;
    return;
  } catch (_rpcError) {
    // Fallback for environments without helper RPC.
  }

  const { data: row, error: readErr } = await supabase
    .from('usuarios')
    .select(column)
    .eq('id', userId)
    .single();

  if (readErr) throw readErr;

  const nextValue = Number(row?.[column] || 0) + 1;
  const { error: updateErr } = await supabase
    .from('usuarios')
    .update({ [column]: nextValue })
    .eq('id', userId);

  if (updateErr) throw updateErr;
};

/**
 * Get match players with user registration info
 * @param {number} matchId - Match ID
 * @returns {Promise<Map>} Map of player_id -> {user_id, player_table_id}
 */
async function getMatchPlayersMap(matchId) {
  const { data: players, error } = await supabase
    .from('jugadores')
    .select('id, uuid, usuario_id')
    .eq('partido_id', matchId);

  if (error) throw error;

  const playersMap = new Map();
  (players || []).forEach((player) => {
    playersMap.set(player.id, {
      user_id: player.usuario_id,
      player_table_id: player.id,
      uuid: player.uuid,
    });
  });

  return playersMap;
}

/**
 * Grant awards for a match (only to registered players)
 * @param {number} matchId - Match ID
 * @param {Object} awards - Awards object with mvp, best_gk, red_card
 * @returns {Promise<Object>} Result with granted and skipped awards
 */
export async function grantAwardsForMatch(matchId, awards) {
  if (!awards || typeof awards !== 'object') {
    return { granted: [], skipped: [], error: 'No awards provided' };
  }

  try {
    const idNum = Number(matchId);
    const matchName = await resolveMatchName(idNum);
    const playersMap = await getMatchPlayersMap(matchId);
    const granted = [];
    const skipped = [];

    // Process each award type
    for (const [awardType, awardData] of Object.entries(awards)) {
      if (!awardData || !awardData.player_id) continue;

      const playerId = awardData.player_id;
      const playerInfo = playersMap.get(playerId);

      if (!playerInfo || !playerInfo.user_id) {
        skipped.push(`${awardType} (guest player)`);
        continue;
      }

      // Insert award record
      // Check for existing award (manual dedupe to avoid missing unique constraint error)
      const { data: existingAward } = await supabase
        .from('player_awards')
        .select('id')
        .eq('partido_id', matchId)
        .eq('award_type', awardType)
        .maybeSingle();

      if (existingAward) {
        skipped.push(`${awardType} (already granted)`);
        continue;
      }

      // Insert award record (using insert instead of upsert)
      const { error: insertError } = await supabase
        .from('player_awards')
        .insert({
          partido_id: matchId,
          jugador_id: playerInfo.uuid,
          award_type: awardType,
          created_at: new Date().toISOString(),
        });

      if (insertError) {
        console.error(`Error inserting ${awardType} award:`, insertError);
        skipped.push(`${awardType} (database error)`);
        continue;
      }

      // Increment canonical counters on usuarios.
      const counterField = awardType === 'mvp' ? 'mvps'
        : awardType === 'best_gk' ? 'guantes_dorados'
          : awardType === 'red_card' ? 'tarjetas_rojas'
            : null;

      if (counterField && playerInfo.user_id) {
        try {
          await incrementUsuarioCounter(playerInfo.user_id, counterField);
        } catch (counterError) {
          console.error(`Error updating ${counterField} in usuarios:`, counterError);
        }
      }

      if (playerInfo.user_id) {
        try {
          await insertAwardWonNotification({
            userId: playerInfo.user_id,
            matchId: idNum,
            matchName,
            awardType,
          });
        } catch (notificationError) {
          console.error(`[AWARDS] Error creating private award notification for ${awardType}:`, notificationError);
        }
      }

      granted.push(awardType);
    }

    return { granted, skipped, error: null };
  } catch (error) {
    console.error('Error granting awards:', error);
    return { granted: [], skipped: [], error: error.message };
  }
}
