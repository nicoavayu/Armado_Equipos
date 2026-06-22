import logger from '../../utils/logger';
import { supabase } from '../../lib/supabaseClient';
import {
  getAwardCounterField,
  normalizeAwardType,
  resolveRegisteredUserIdFromPlayerRef,
  resolveStablePlayerRef,
} from './userIdentity';
import {
  SURVEY_CHALLENGE_DISABLED_REASON,
  isChallengeLikeTeamMatchRow,
} from '../../utils/surveyChallengePolicy';

const AWARD_WON_NOTIFICATION_TYPE = 'award_won';

const isChallengeSurveyDisabledMatch = async (matchId) => {
  try {
    const { data, error } = await supabase
      .from('team_matches')
      .select('id, origin_type, challenge_id')
      .eq('partido_id', Number(matchId))
      .maybeSingle();
    if (error) return false;
    return isChallengeLikeTeamMatchRow(data || null);
  } catch (_error) {
    return false;
  }
};

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

const resolveAwardWinnerUserId = async ({
  playerRef,
  playersMap,
}) => {
  const numericPlayerId = Number(playerRef);
  if (Number.isFinite(numericPlayerId) && numericPlayerId > 0) {
    const mappedUserId = String(playersMap?.get(numericPlayerId)?.user_id || '').trim();
    if (mappedUserId) return mappedUserId;
  }

  return resolveRegisteredUserIdFromPlayerRef(playerRef, supabase);
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
    return {
      granted: [],
      skipped: [],
      error: 'No awards provided',
      expectedRegisteredAwards: 0,
      persistedRegisteredAwards: 0,
    };
  }

  try {
    const playersMap = await getMatchPlayersMap(matchId);
    const granted = [];
    const skipped = [];
    let expectedRegisteredAwards = 0;
    let persistedRegisteredAwards = 0;

    // Process each award type
    for (const [awardType, awardData] of Object.entries(awards)) {
      if (!awardData || !awardData.player_id) continue;

      const playerId = awardData.player_id;
      const playerInfo = playersMap.get(playerId);

      if (!playerInfo || !playerInfo.user_id) {
        skipped.push(`${awardType} (guest player)`);
        continue;
      }
      expectedRegisteredAwards += 1;

      // Atomic insert: relies on UNIQUE(partido_id, award_type) and ON CONFLICT DO NOTHING.
      const canonicalAwardType = awardType;
      const stableAwardRef = resolveStablePlayerRef({
        usuario_id: playerInfo.user_id,
        uuid: playerInfo.uuid,
        id: playerInfo.player_table_id,
      });

      const { data: insertedAwards, error: insertError } = await supabase
        .from('player_awards')
        .upsert([{
          partido_id: matchId,
          jugador_id: stableAwardRef,
          award_type: canonicalAwardType,
          created_at: new Date().toISOString(),
        }], {
          onConflict: 'partido_id,award_type',
          ignoreDuplicates: true,
        })
        .select('id');

      if (insertError) {
        logger.error(`Error inserting ${awardType} award (ON CONFLICT):`, insertError);
        skipped.push(`${awardType} (database error)`);
        continue;
      }

      if (!Array.isArray(insertedAwards) || insertedAwards.length === 0) {
        skipped.push(`${awardType} (already granted)`);
        persistedRegisteredAwards += 1;
        continue;
      }

      // Increment canonical counters on usuarios.
      const counterField = getAwardCounterField(canonicalAwardType);

      if (counterField && playerInfo.user_id) {
        try {
          await incrementUsuarioCounter(playerInfo.user_id, counterField);
        } catch (counterError) {
          logger.error(`Error updating ${counterField} in usuarios:`, counterError);
        }
      }

      granted.push(awardType);
      persistedRegisteredAwards += 1;
    }

    return { granted, skipped, error: null, expectedRegisteredAwards, persistedRegisteredAwards };
  } catch (error) {
    logger.error('Error granting awards:', error);
    return {
      granted: [],
      skipped: [],
      error: error.message,
      expectedRegisteredAwards: 0,
      persistedRegisteredAwards: 0,
    };
  }
}

export async function notifyAwardWinnersForMatch(matchId, awards) {
  if (!awards || typeof awards !== 'object') {
    return { notified: [], skipped: [], error: 'No awards provided' };
  }

  try {
    const idNum = Number(matchId);
    if (!Number.isFinite(idNum) || idNum <= 0) {
      return { notified: [], skipped: [], error: 'Invalid match ID' };
    }

    if (await isChallengeSurveyDisabledMatch(idNum)) {
      return {
        notified: [],
        skipped: [],
        error: null,
        disabledForChallenge: true,
        reason: SURVEY_CHALLENGE_DISABLED_REASON,
      };
    }

    const matchName = await resolveMatchName(idNum);
    const playersMap = await getMatchPlayersMap(idNum);
    const notified = [];
    const skipped = [];

    for (const [rawAwardType, awardData] of Object.entries(awards)) {
      const awardType = normalizeAwardType(rawAwardType);
      const playerRef = awardData?.player_id ?? awardData?.jugador_id ?? null;

      if (!awardType || !playerRef) continue;

      let userId = null;
      try {
        userId = await resolveAwardWinnerUserId({
          playerRef,
          playersMap,
        });
      } catch (resolveError) {
        logger.error('[AWARDS] Error resolving award winner user:', {
          matchId: idNum,
          awardType,
          playerRef,
          resolveError,
        });
      }

      if (!userId) {
        skipped.push(`${awardType} (unresolved user)`);
        continue;
      }

      try {
        await insertAwardWonNotification({
          userId,
          matchId: idNum,
          matchName,
          awardType,
        });
        notified.push(awardType);
      } catch (notificationError) {
        logger.error(`[AWARDS] Error creating private award notification for ${awardType}:`, notificationError);
        skipped.push(`${awardType} (notification error)`);
      }
    }

    return { notified, skipped, error: null };
  } catch (error) {
    logger.error('[AWARDS] Error notifying award winners:', error);
    return { notified: [], skipped: [], error: error.message };
  }
}
