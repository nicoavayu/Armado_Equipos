import { supabase } from '../supabase';
import { db } from '../api/supabaseWrapper';
import { handleError } from '../lib/errorHandler';
import { incrementMatchesPlayed } from '../utils/matchStatsManager';

/**
 * Servicio para programar y ejecutar acciones automáticas de partidos
 */
class MatchScheduler {
  constructor() {
    this.scheduledMatches = new Map();
    this.checkInterval = null;
    this.isRunning = false;
  }

  /**
   * Inicia el scheduler
   */
  start() {
    if (this.isRunning) return;
    
    console.log('[MATCH_SCHEDULER] Starting match scheduler');
    this.isRunning = true;
    
    // Verificar cada minuto
    this.checkInterval = setInterval(() => {
      this.checkScheduledMatches();
    }, 60000);
    
    // Verificar inmediatamente al iniciar
    this.checkScheduledMatches();
  }

  /**
   * Detiene el scheduler
   */
  stop() {
    if (!this.isRunning) return;
    
    console.log('[MATCH_SCHEDULER] Stopping match scheduler');
    this.isRunning = false;
    
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    
    this.scheduledMatches.clear();
  }

  /**
   * Programa un partido para incrementar partidos jugados
   */
  scheduleMatch(partidoId, fecha, hora) {
    try {
      const matchDateTime = new Date(`${fecha}T${hora}`);
      const now = new Date();
      
      // Solo programar si el partido es en el futuro
      if (matchDateTime > now) {
        this.scheduledMatches.set(partidoId, {
          partidoId,
          matchDateTime,
          processed: false,
        });
        
        console.log('[MATCH_SCHEDULER] Scheduled match:', {
          partidoId,
          matchDateTime: matchDateTime.toISOString(),
          timeUntilMatch: Math.round((matchDateTime - now) / (1000 * 60)) + ' minutes',
        });
      }
    } catch (error) {
      handleError(error, { showToast: false });
    }
  }

  /**
   * Verifica partidos programados y ejecuta acciones
   */
  async checkScheduledMatches() {
    const now = new Date();
    
    for (const [partidoId, matchInfo] of this.scheduledMatches.entries()) {
      if (matchInfo.processed) continue;
      
      // Si ya pasó la hora del partido
      if (now >= matchInfo.matchDateTime) {
        console.log('[MATCH_SCHEDULER] Processing match start:', partidoId);
        
        try {
          await this.processMatchStart(partidoId);
          matchInfo.processed = true;
          
          // Remover después de 1 hora para limpiar memoria
          setTimeout(() => {
            this.scheduledMatches.delete(partidoId);
          }, 3600000);
          
        } catch (error) {
          handleError(error, { showToast: false });
          // Marcar como procesado para evitar reintentos infinitos
          matchInfo.processed = true;
        }
      }
    }
  }

  /**
   * Procesa el inicio de un partido
   */
  async processMatchStart(partidoId) {
    try {
      console.log('[MATCH_SCHEDULER] Match started, incrementing played matches for:', partidoId);
      
      // Verificar que el partido existe y obtener jugadores
      let partido;
      try {
        partido = await db.fetchOne('partidos', { id: partidoId });
      } catch (partidoError) {
        console.error('[MATCH_SCHEDULER] Error getting match:', partidoError);
        return;
      }
      
      if (!partido || !partido.jugadores) {
        console.log('[MATCH_SCHEDULER] No players found for match:', partidoId);
        return;
      }
      
      // Incrementar partidos_jugados para todos los jugadores
      await incrementMatchesPlayed(partidoId);
      
      console.log('[MATCH_SCHEDULER] Successfully processed match start for:', partidoId);
      
    } catch (error) {
      handleError(error, { showToast: false });
      throw error;
    }
  }

  /**
   * Obtiene partidos activos y los programa
   */
  async loadActiveMatches() {
    try {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      // Obtener partidos de hoy y mañana que no han empezado
      const { data: partidos, error } = await supabase
        .from('partidos')
        .select('id, fecha, hora')
        .gte('fecha', now.toISOString().split('T')[0])
        .lte('fecha', tomorrow.toISOString().split('T')[0])
        .not('hora', 'is', null);
      
      if (error) {
        console.error('[MATCH_SCHEDULER] Error loading active matches:', error);
        return;
      }
      
      if (partidos && partidos.length > 0) {
        console.log('[MATCH_SCHEDULER] Loading', partidos.length, 'active matches');
        
        partidos.forEach((partido) => {
          this.scheduleMatch(partido.id, partido.fecha, partido.hora);
        });
      }
      
    } catch (error) {
      console.error('[MATCH_SCHEDULER] Error in loadActiveMatches:', error);
    }
  }
}

// Instancia singleton
const matchScheduler = new MatchScheduler();

export default matchScheduler;