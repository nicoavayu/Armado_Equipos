import { supabase } from '../../lib/supabaseClient';

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
  (players || []).forEach(player => {
    playersMap.set(player.id, {
      user_id: player.usuario_id,
      player_table_id: player.id,
      uuid: player.uuid
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
      const { error: insertError } = await supabase
        .from('player_awards')
        .upsert({
          partido_id: matchId,
          jugador_id: playerInfo.uuid,
          award_type: awardType,
          created_at: new Date().toISOString()
        }, {
          onConflict: 'partido_id,award_type'
        });

      if (insertError) {
        console.error(`Error inserting ${awardType} award:`, insertError);
        skipped.push(`${awardType} (database error)`);
        continue;
      }

      // Increment counter based on award type
      const counterField = awardType === 'mvp' ? 'mvp_badges' 
                         : awardType === 'best_gk' ? 'gk_badges'
                         : awardType === 'red_card' ? 'red_badges'
                         : null;

      if (counterField && playerInfo.user_id) {
        // Try updating in profiles table first (if it exists)
        const { error: profileUpdateError } = await supabase
          .from('profiles')
          .update({ [counterField]: supabase.raw(`COALESCE(${counterField}, 0) + 1`) })
          .eq('id', playerInfo.user_id);

        if (profileUpdateError) {
          console.warn(`Could not update ${counterField} in profiles:`, profileUpdateError);
          // Fallback to players table if profiles update fails
          const { error: playerUpdateError } = await supabase
            .from('players')
            .update({ [counterField]: supabase.raw(`COALESCE(${counterField}, 0) + 1`) })
            .eq('id', playerId);
          
          if (playerUpdateError) {
            console.error(`Error updating ${counterField} in players:`, playerUpdateError);
          }
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