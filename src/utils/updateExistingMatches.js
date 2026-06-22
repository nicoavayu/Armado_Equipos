import logger from './logger';
import { supabase } from '../supabase';

export const updateExistingMatches = async () => {
  try {
    // Obtener todos los partidos que no tienen partido_frecuente_id o es null
    const { data: partidos, error: fetchError } = await supabase
      .from('partidos')
      .select('id')
      .or('partido_frecuente_id.is.null,es_frecuente.is.null');

    if (fetchError) {
      logger.error('Error al obtener partidos:', fetchError);
      return { success: false, error: fetchError };
    }

    logger.log(`Encontrados ${partidos?.length || 0} partidos para actualizar`);

    if (!partidos || partidos.length === 0) {
      return { success: true, message: 'No hay partidos para actualizar', updated: 0 };
    }

    // Actualizar cada partido
    const updates = partidos.map((partido) =>
      supabase
        .from('partidos')
        .update({
          partido_frecuente_id: partido.id,
          es_frecuente: true,
        })
        .eq('id', partido.id),
    );

    // Ejecutar todas las actualizaciones
    const results = await Promise.all(updates);
    const errors = results.filter((res) => res.error);

    if (errors.length > 0) {
      logger.error(`Errores al actualizar ${errors.length} partidos:`, errors);
      return {
        success: false,
        message: `Se actualizaron ${partidos.length - errors.length} partidos, pero hubo ${errors.length} errores`,
        updated: partidos.length - errors.length,
        errors,
      };
    }

    return {
      success: true,
      message: `Se actualizaron ${partidos.length} partidos correctamente`,
      updated: partidos.length,
    };
  } catch (error) {
    logger.error('Error al actualizar partidos existentes:', error);
    return { success: false, error };
  }
};

// Función para ejecutar la actualización desde la consola del navegador
export const runUpdateFromConsole = () => {
  logger.log('Iniciando actualización de partidos existentes...');
  updateExistingMatches()
    .then((result) => {
      logger.log('Resultado de la actualización:', result);
      if (result.success) {
        logger.log(`✅ ${result.message}`);
      } else {
        logger.error(`❌ Error: ${result.message}`);
      }
    })
    .catch((err) => {
      logger.error('Error al ejecutar la actualización:', err);
    });
};