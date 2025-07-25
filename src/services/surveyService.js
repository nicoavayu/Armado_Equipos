import { supabase } from '../supabase';

/**
 * Creates post-match survey notifications for all players in a match
 * @param {Object} partido - The match object
 * @returns {Promise<Array>} - Array of created notifications or empty array if error
 */
export const createPostMatchSurveyNotifications = async (partido) => {
  if (!partido || !partido.jugadores || !partido.jugadores.length) return [];
  
  try {
    // Get unique user IDs from the match participants (exclude guest users)
    const userIds = partido.jugadores
      .filter((jugador) => jugador.uuid && !jugador.uuid.startsWith('guest_'))
      .map((jugador) => jugador.uuid);
    
    if (userIds.length === 0) return [];
    
    // Create notifications for all players
    const notifications = userIds.map((userId) => ({
      user_id: userId,
      type: 'post_match_survey',
      title: '¡Completá la encuesta!',
      message: `Ayudanos calificando la experiencia del partido ${partido.nombre || 'reciente'}.`,
      data: {
        matchId: partido.id,
        matchCode: partido.codigo,
        matchDate: partido.fecha,
        matchTime: partido.hora,
        matchVenue: partido.sede,
      },
      read: false,
      created_at: new Date().toISOString(),
    }));
    
    // Insert notifications into the database
    const { data, error } = await supabase
      .from('notifications')
      .insert(notifications)
      .select();
      
    if (error) throw error;
    
    console.log(`Creadas ${data?.length || 0} notificaciones de encuesta post-partido`);
    return data || [];
  } catch (error) {
    console.error('Error creating post-match survey notifications:', error);
    return [];
  }
};

/**
 * Checks if a user has a pending post-match survey
 * @param {string} userId - The user ID
 * @returns {Promise<Array>} - Array of pending surveys
 */
export const checkPendingSurveys = async (userId) => {
  if (!userId) return [];
  
  try {
    // Get unread post-match survey notifications
    const { data: notifications, error } = await supabase
      .from('notifications')
      .select('*, partidos(*)')
      .eq('user_id', userId)
      .eq('type', 'post_match_survey')
      .eq('read', false);
      
    if (error) throw error;
    
    // Check if user has already submitted a survey for these matches
    const pendingSurveys = [];
    
    for (const notification of notifications || []) {
      if (!notification.match_id) continue;
      
      // Check if user has already submitted a survey for this match
      const { data: existingSurvey, error: surveyError } = await supabase
        .from('post_match_surveys')
        .select('id')
        .eq('partido_id', notification.match_id)
        .eq('votante_id', userId)
        .single();
        
      if (surveyError && surveyError.code !== 'PGRST116') {
        console.error('Error checking existing survey:', surveyError);
        continue;
      }
      
      // If no survey exists, add to pending surveys
      if (!existingSurvey) {
        pendingSurveys.push({
          notification,
          partido: notification.partidos,
        });
      } else {
        // Mark notification as read since survey was already submitted
        await supabase
          .from('notifications')
          .update({ read: true })
          .eq('id', notification.id);
      }
    }
    
    return pendingSurveys;
  } catch (error) {
    console.error('Error checking pending surveys:', error);
    return [];
  }
};

/**
 * Processes survey results and updates player awards and scores
 * @param {number} partidoId - The match ID
 */
export const processSurveyResults = async (partidoId) => {
  if (!partidoId) return;
  
  try {
    // Get all surveys for this match
    const { data: surveys, error } = await supabase
      .from('post_match_surveys')
      .select('*')
      .eq('partido_id', partidoId);
      
    if (error) throw error;
    if (!surveys || !surveys.length) return;
    
    // Count votes for each category
    const mvpVotesTeamA = {};
    const mvpVotesTeamB = {};
    const goalkeeperVotes = {};
    const fairplayNegativeVotes = {};
    const absentPlayers = new Set();
    
    // Process each survey
    surveys.forEach((survey) => {
      // Count MVP votes for team A
      if (survey.mejor_jugador_eq_a) {
        mvpVotesTeamA[survey.mejor_jugador_eq_a] = (mvpVotesTeamA[survey.mejor_jugador_eq_a] || 0) + 1;
      }
      
      // Count MVP votes for team B
      if (survey.mejor_jugador_eq_b) {
        mvpVotesTeamB[survey.mejor_jugador_eq_b] = (mvpVotesTeamB[survey.mejor_jugador_eq_b] || 0) + 1;
      }
      
      // Count goalkeeper votes
      if (survey.mejor_arquero) {
        goalkeeperVotes[survey.mejor_arquero] = (goalkeeperVotes[survey.mejor_arquero] || 0) + 1;
      }
      
      // Count negative fair play votes
      if (survey.jugadores_violentos && Array.isArray(survey.jugadores_violentos)) {
        survey.jugadores_violentos.forEach((playerId) => {
          fairplayNegativeVotes[playerId] = (fairplayNegativeVotes[playerId] || 0) + 1;
        });
      }
      
      // Track absent players
      if (!survey.asistieron_todos && survey.jugadores_ausentes && Array.isArray(survey.jugadores_ausentes)) {
        survey.jugadores_ausentes.forEach((playerId) => {
          absentPlayers.add(playerId);
        });
      }
    });
    
    // Find the winners in each category
    const findWinner = (votes) => {
      let maxVotes = 0;
      let winnerId = null;
      
      Object.entries(votes).forEach(([playerId, voteCount]) => {
        if (voteCount > maxVotes) {
          maxVotes = voteCount;
          winnerId = playerId;
        }
      });
      
      return { winnerId, voteCount: maxVotes };
    };
    
    const mvpTeamA = findWinner(mvpVotesTeamA);
    const mvpTeamB = findWinner(mvpVotesTeamB);
    const bestGoalkeeper = findWinner(goalkeeperVotes);
    
    // Find players with significant negative fair play votes (more than 25% of surveys)
    const negativeThreshold = Math.ceil(surveys.length * 0.25);
    const negativePlayersIds = Object.entries(fairplayNegativeVotes)
      .filter(([_, voteCount]) => voteCount >= negativeThreshold)
      .map(([playerId]) => playerId);
    
    // Create awards
    const awards = [];
    
    // MVP awards
    if (mvpTeamA.winnerId && mvpTeamA.voteCount > 0) {
      awards.push({
        jugador_id: mvpTeamA.winnerId,
        award_type: 'mvp',
        partido_id: partidoId,
      });
    }
    
    if (mvpTeamB.winnerId && mvpTeamB.voteCount > 0) {
      awards.push({
        jugador_id: mvpTeamB.winnerId,
        award_type: 'mvp',
        partido_id: partidoId,
      });
    }
    
    // Goalkeeper award
    if (bestGoalkeeper.winnerId && bestGoalkeeper.voteCount > 0) {
      awards.push({
        jugador_id: bestGoalkeeper.winnerId,
        award_type: 'arquero',
        partido_id: partidoId,
      });
    }
    
    // Negative fair play awards
    negativePlayersIds.forEach((playerId) => {
      awards.push({
        jugador_id: playerId,
        award_type: 'fairplay_negativo',
        partido_id: partidoId,
      });
    });
    
    // Insert awards
    if (awards.length > 0) {
      const { error: awardsError } = await supabase
        .from('player_awards')
        .insert(awards);
        
      if (awardsError) throw awardsError;
    }
    
    // Update player responsibility scores
    // Decrease score for absent players
    if (absentPlayers.size > 0) {
      for (const playerId of absentPlayers) {
        const { data: player, error: playerError } = await supabase
          .from('jugadores')
          .select('responsabilidad_score')
          .eq('uuid', playerId)
          .single();
          
        if (playerError) continue;
        
        const currentScore = player?.responsabilidad_score || 5;
        const newScore = Math.max(1, currentScore - 0.5); // Decrease by 0.5, minimum 1
        
        await supabase
          .from('jugadores')
          .update({ responsabilidad_score: newScore })
          .eq('uuid', playerId);
      }
    }
    
    // Increase score for survey participants
    for (const survey of surveys) {
      if (!survey.votante_id) continue;
      
      const { data: player, error: playerError } = await supabase
        .from('jugadores')
        .select('responsabilidad_score')
        .eq('uuid', survey.votante_id)
        .single();
        
      if (playerError) continue;
      
      const currentScore = player?.responsabilidad_score || 5;
      const newScore = Math.min(10, currentScore + 0.1); // Increase by 0.1, maximum 10
      
      await supabase
        .from('jugadores')
        .update({ responsabilidad_score: newScore })
        .eq('uuid', survey.votante_id);
    }
    
    return true;
  } catch (error) {
    console.error('Error processing survey results:', error);
    return false;
  }
};