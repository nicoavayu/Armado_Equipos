import { supabase } from '../supabase';
import { getResultsUrl } from '../utils/routes';
import { toBigIntId } from '../utils';

/**
 * Creates post-match survey notifications for all players in a match
 * @param {Object} partido - The match object
 * @returns {Promise<Array>} - Array of created notifications or empty array if error
 */
export const createPostMatchSurveyNotifications = async (partido) => {
  // DEPRECATED: Prefer DB-side fanout via fanout_survey_start_notifications() cron job.
  // To enable JS fanout for local/dev testing set USE_JS_FANOUT=1 in the environment.
  const useJsFanout = typeof process !== 'undefined' && process.env && process.env.USE_JS_FANOUT === '1';
  if (!useJsFanout) {
    console.warn('[DEPRECATED] createPostMatchSurveyNotifications is disabled in production. Use DB cron fanout_survey_start_notifications(). To enable JS fanout for dev set USE_JS_FANOUT=1');
    return [];
  }

  // --- CANONICAL MODE CHECK: prevent JS creation when DB is canonical ---
  const type = 'survey_start';
  const SURVEY_FANOUT_MODE = process.env.NEXT_PUBLIC_SURVEY_FANOUT_MODE || "db";
  if (SURVEY_FANOUT_MODE === "db" && (type === "survey_start" || type === "post_match_survey")) return;

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
      type: 'survey_start',
      title: '¡Completá la encuesta!',
      message: `Ayudanos calificando la experiencia del partido ${partido.nombre || 'reciente'}.`,
      partido_id: Number(partido.id),
      match_ref: Number(partido.id),
      data: {
        match_id: String(partido.id),
        // legacy compatibility (to be removed after full migration)
        matchId: Number(partido.id),
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
      .in('type', ['post_match_survey', 'survey_start'])
      .eq('read', false);
      
    if (error) throw error;
    
    // Check if user has already submitted a survey for these matches
    const pendingSurveys = [];
    
    for (const notification of notifications || []) {
      const notifMatchId =
        notification.match_id ??
        notification?.data?.match_id ??
        notification?.data?.matchId ??
        notification?.partidos?.id;
      if (!notifMatchId) continue;
      
      // Check if user has already submitted a survey for this match
      const { data: existingSurvey, error: surveyError } = await supabase
        .from('post_match_surveys')
        .select('id')
        .eq('partido_id', notifMatchId)
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
    const mvpVotes = {};
    const goalkeeperVotes = {};
    const fairplayNegativeVotes = {};
    const absentPlayers = new Set();
    
    // Process each survey
    surveys.forEach((survey) => {
      // Count MVP votes (single best player)
      if (survey.mejor_jugador) {
        mvpVotes[survey.mejor_jugador] = (mvpVotes[survey.mejor_jugador] || 0) + 1;
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
    
    const mvpWinner = findWinner(mvpVotes);
    const bestGoalkeeper = findWinner(goalkeeperVotes);
    
    // Find players with significant negative fair play votes (more than 25% of surveys)
    const negativeThreshold = Math.ceil(surveys.length * 0.25);
    const negativePlayersIds = Object.entries(fairplayNegativeVotes)
      .filter(([_, voteCount]) => voteCount >= negativeThreshold)
      .map(([playerId]) => playerId);
    
    // Create awards
    const awards = [];
    
    // MVP award (only one per match)
    if (mvpWinner.winnerId && mvpWinner.voteCount > 0) {
      awards.push({
        jugador_id: mvpWinner.winnerId,
        award_type: 'mvp',
        partido_id: partidoId,
      });
    }
    
    // Goalkeeper award (Guante Dorado)
    if (bestGoalkeeper.winnerId && bestGoalkeeper.voteCount > 0) {
      awards.push({
        jugador_id: bestGoalkeeper.winnerId,
        award_type: 'guante_dorado',
        partido_id: partidoId,
      });
    }
    
    // Negative fair play awards (Tarjeta Roja)
    negativePlayersIds.forEach((playerId) => {
      awards.push({
        jugador_id: playerId,
        award_type: 'tarjeta_roja',
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
    
    // Update player ratings for absent players (-0.5)
    if (absentPlayers.size > 0) {
      for (const playerId of Array.from(absentPlayers)) {
        const { data: player, error: playerError } = await supabase
          .from('usuarios')
          .select('rating')
          .eq('id', playerId)
          .single();
          
        if (playerError) continue;
        
        const currentRating = player?.rating || 5;
        const newRating = Math.max(1, currentRating - 0.5); // Decrease by 0.5, minimum 1
        
        await supabase
          .from('usuarios')
          .update({ rating: newRating })
          .eq('id', playerId);
      }
    }
    
    // === Programar notificación "resultados listos" (TEST: +1 minuto) ===
    const scheduledFor = new Date(Date.now() + 1 * 60 * 1000).toISOString(); // luego cambiar a +6h

    // Jugadores (usuarios) del partido
    const { data: jugadoresPartido, error: jugadoresErr } = await supabase
      .from('jugadores')
      .select('usuario_id')
      .eq('partido_id', partidoId)
      .not('usuario_id', 'is', null);
    if (jugadoresErr) throw jugadoresErr;

    // Evitar duplicados: borrar pendientes previas de este partido
    await supabase
      .from('notifications_ext')
      .delete()
      .eq('type', 'survey_results_ready')
      .eq('read', false)
      .eq('match_id_text', String(partidoId));

    const idNum = toBigIntId(partidoId);
    const perUserNotifs = (jugadoresPartido || []).map(j => ({
      user_id: j.usuario_id,
      type: 'survey_results_ready',
      title: 'Resultados listos',
      message: 'Ya podés ver los premios del partido.',
      partido_id: partidoId,
      data: { match_id: String(partidoId), matchId: idNum, resultsUrl: getResultsUrl(idNum), scheduled_for: scheduledFor },
      read: false,
    }));

    if (perUserNotifs.length) {
      const { error: insertNotifErr } = await supabase
        .from('notifications')
        .insert(perUserNotifs);
      if (insertNotifErr) throw insertNotifErr;
    }

    return true;
  } catch (error) {
    console.error('Error processing survey results:', error);
    return false;
  }
};