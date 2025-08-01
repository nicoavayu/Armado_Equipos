import { supabase } from '../supabase';

/**
 * Procesa los resultados de las encuestas 6 horas después del cierre
 */
export const processSurveyResults = async (partidoId) => {
  try {
    console.log('[SURVEY_RESULTS] Processing results for partido:', partidoId);
    
    // Obtener datos del partido
    const { data: partido, error: partidoError } = await supabase
      .from('partidos')
      .select('*')
      .eq('id', partidoId)
      .single();
    
    if (partidoError || !partido) {
      console.error('[SURVEY_RESULTS] Error getting partido:', partidoError);
      return;
    }
    
    // Obtener todas las encuestas del partido
    const { data: surveys, error: surveysError } = await supabase
      .from('post_match_surveys')
      .select('*')
      .eq('partido_id', partidoId);
    
    if (surveysError) {
      console.error('[SURVEY_RESULTS] Error getting surveys:', surveysError);
      return;
    }
    
    if (!surveys || surveys.length === 0) {
      console.log('[SURVEY_RESULTS] No surveys found for partido:', partidoId);
      return;
    }
    
    console.log('[SURVEY_RESULTS] Found', surveys.length, 'surveys');
    
    // Procesar MVP (por cantidad de votos)
    const mvpVotes = {};
    surveys.forEach((survey) => {
      if (survey.se_jugo && survey.mvp_id) {
        mvpVotes[survey.mvp_id] = (mvpVotes[survey.mvp_id] || 0) + 1;
      }
    });
    
    // Procesar Arquero (por cantidad de votos)
    const arqueroVotes = {};
    surveys.forEach((survey) => {
      if (survey.se_jugo && survey.arquero_id) {
        arqueroVotes[survey.arquero_id] = (arqueroVotes[survey.arquero_id] || 0) + 1;
      }
    });
    
    // Procesar jugadores ausentes (no acumulativo - con 1 voto ya se aplica)
    const ausentesSet = new Set();
    surveys.forEach((survey) => {
      if (survey.jugadores_ausentes && Array.isArray(survey.jugadores_ausentes)) {
        survey.jugadores_ausentes.forEach((jugadorId) => ausentesSet.add(jugadorId));
      }
    });
    
    // Procesar jugadores violentos (no acumulativo - con 1 voto ya se aplica)
    const violentosSet = new Set();
    surveys.forEach((survey) => {
      if (survey.jugadores_violentos && Array.isArray(survey.jugadores_violentos)) {
        survey.jugadores_violentos.forEach((jugadorId) => violentosSet.add(jugadorId));
      }
    });
    
    // Determinar ganadores
    const mvpWinner = Object.keys(mvpVotes).reduce((a, b) => mvpVotes[a] > mvpVotes[b] ? a : b, null);
    const arqueroWinner = Object.keys(arqueroVotes).reduce((a, b) => arqueroVotes[a] > arqueroVotes[b] ? a : b, null);
    
    // Crear resultados finales
    const results = {
      partido_id: partidoId,
      mvp_id: mvpWinner,
      mvp_votes: mvpWinner ? mvpVotes[mvpWinner] : 0,
      arquero_id: arqueroWinner,
      arquero_votes: arqueroWinner ? arqueroVotes[arqueroWinner] : 0,
      jugadores_ausentes: Array.from(ausentesSet),
      jugadores_violentos: Array.from(violentosSet),
      total_surveys: surveys.length,
      processed_at: new Date().toISOString(),
    };
    
    // Guardar resultados
    const { error: resultsError } = await supabase
      .from('survey_results')
      .upsert([results]);
    
    if (resultsError) {
      console.error('[SURVEY_RESULTS] Error saving results:', resultsError);
      return;
    }
    
    // Notificar a todos los jugadores del partido
    await notifyPlayersOfResults(partido, results);
    
    console.log('[SURVEY_RESULTS] Results processed successfully:', results);
    
  } catch (error) {
    console.error('[SURVEY_RESULTS] Error processing survey results:', error);
  }
};

/**
 * Notifica a todos los jugadores del partido sobre los resultados
 */
const notifyPlayersOfResults = async (partido, results) => {
  try {
    if (!partido.jugadores || !Array.isArray(partido.jugadores)) {
      return;
    }
    
    const formatFecha = (fechaStr) => {
      try {
        const fecha = new Date(fechaStr);
        return fecha.toLocaleDateString('es-ES', { 
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
      } catch (e) {
        return fechaStr;
      }
    };
    
    const notifications = partido.jugadores.map((jugador) => ({
      usuario_id: jugador.usuario_id || jugador.id,
      tipo: 'survey_results',
      titulo: `Resultados de ${partido.nombre || 'Partido'}`,
      mensaje: `Resultados del partido del ${formatFecha(partido.fecha)}`,
      data: {
        partido_id: partido.id,
        results: results,
      },
      created_at: new Date().toISOString(),
    }));
    
    const { error } = await supabase
      .from('notificaciones')
      .insert(notifications);
    
    if (error) {
      console.error('[SURVEY_RESULTS] Error creating notifications:', error);
    } else {
      console.log('[SURVEY_RESULTS] Notifications sent to', notifications.length, 'players');
    }
    
  } catch (error) {
    console.error('[SURVEY_RESULTS] Error notifying players:', error);
  }
};

/**
 * Programa el procesamiento de resultados para 6 horas después del cierre de encuestas
 */
export const scheduleSurveyResultsProcessing = (partidoId, partidoFecha, partidoHora) => {
  try {
    // Calcular cuando cerrar encuestas (1 hora después del inicio + 6 horas de encuesta)
    const matchDateTime = new Date(`${partidoFecha}T${partidoHora}`);
    const surveyCloseTime = new Date(matchDateTime.getTime() + (7 * 60 * 60 * 1000)); // +7 horas total
    const now = new Date();
    
    const timeUntilProcessing = surveyCloseTime.getTime() - now.getTime();
    
    if (timeUntilProcessing > 0) {
      setTimeout(() => {
        processSurveyResults(partidoId);
      }, timeUntilProcessing);
      
      console.log('[SURVEY_RESULTS] Scheduled processing for partido', partidoId, 'in', Math.round(timeUntilProcessing / 1000 / 60), 'minutes');
    } else {
      // Si ya pasó el tiempo, procesar inmediatamente
      processSurveyResults(partidoId);
    }
    
  } catch (error) {
    console.error('[SURVEY_RESULTS] Error scheduling processing:', error);
  }
};