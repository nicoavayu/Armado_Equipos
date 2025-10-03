// Utilidad para detectar y limpiar jugadores duplicados automáticamente
import { supabase } from '../supabase';
import { logger } from '../lib/logger';

/**
 * Detecta jugadores duplicados en un partido
 * @param {number} partidoId - ID del partido
 * @returns {Object} Información sobre duplicados encontrados
 */
export const detectDuplicates = async (partidoId) => {
  if (!partidoId) return { hasDuplicates: false, duplicates: [] };
  
  try {
    const { data: jugadores, error } = await supabase
      .from('jugadores')
      .select('id, nombre, created_at')
      .eq('partido_id', partidoId)
      .order('created_at', { ascending: true });
      
    if (error) throw error;
    
    const nameCount = {};
    const duplicates = [];
    
    jugadores.forEach((jugador) => {
      const normalizedName = jugador.nombre.toLowerCase().trim();
      
      if (nameCount[normalizedName]) {
        nameCount[normalizedName].push(jugador);
        duplicates.push(jugador);
      } else {
        nameCount[normalizedName] = [jugador];
      }
    });
    
    return {
      hasDuplicates: duplicates.length > 0,
      duplicates,
      totalPlayers: jugadores.length,
      uniqueNames: Object.keys(nameCount).length,
    };
    
  } catch (error) {
    logger.error('Error detecting duplicates:', error);
    return { hasDuplicates: false, duplicates: [], error };
  }
};

/**
 * Limpia automáticamente jugadores duplicados manteniendo el más antiguo
 * @param {number} partidoId - ID del partido
 * @returns {Object} Resultado de la limpieza
 */
export const autoCleanupDuplicates = async (partidoId) => {
  if (!partidoId) return { cleaned: 0, kept: 0 };
  
  try {
    const detection = await detectDuplicates(partidoId);
    
    if (!detection.hasDuplicates) {
      return { cleaned: 0, kept: detection.totalPlayers };
    }
    
    logger.log('[AUTO_CLEANUP] Found duplicates:', detection.duplicates.length);
    
    // Eliminar duplicados (mantener solo el primero de cada nombre)
    const duplicateIds = detection.duplicates.map((d) => d.id);
    
    const { error: deleteError } = await supabase
      .from('jugadores')
      .delete()
      .in('id', duplicateIds);
      
    if (deleteError) throw deleteError;
    
    const result = {
      cleaned: duplicateIds.length,
      kept: detection.totalPlayers - duplicateIds.length,
    };
    
    logger.log('[AUTO_CLEANUP] Cleanup completed:', result);
    return result;
    
  } catch (error) {
    logger.error('[AUTO_CLEANUP] Error:', error);
    throw error;
  }
};

/**
 * Middleware para limpiar duplicados después de agregar jugadores
 * @param {number} partidoId - ID del partido
 */
export const cleanupAfterPlayerAdd = async (partidoId) => {
  try {
    // Esperar un poco para que se complete la inserción
    setTimeout(async () => {
      const result = await autoCleanupDuplicates(partidoId);
      if (result.cleaned > 0) {
        logger.log(`[AUTO_CLEANUP] Removed ${result.cleaned} duplicates after player add`);
      }
    }, 1000);
  } catch (error) {
    logger.error('[AUTO_CLEANUP] Error in cleanup after add:', error);
  }
};