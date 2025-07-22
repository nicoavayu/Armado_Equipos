import { supabase } from '../supabase';

export const updateExistingMatches = async () => {
  try {
    // Obtener todos los partidos que no tienen partido_frecuente_id o es null
    const { data: partidos, error: fetchError } = await supabase
      .from('partidos')
      .select('id')
      .or('partido_frecuente_id.is.null,es_frecuente.is.null');
    
    if (fetchError) {
      console.error('Error al obtener partidos:', fetchError);
      return { success: false, error: fetchError };
    }
    
    console.log(`Encontrados ${partidos?.length || 0} partidos para actualizar`);
    
    if (!partidos || partidos.length === 0) {
      return { success: true, message: 'No hay partidos para actualizar', updated: 0 };
    }
    
    // Actualizar cada partido
    const updates = partidos.map(partido => 
      supabase
        .from('partidos')
        .update({
          partido_frecuente_id: partido.id,
          es_frecuente: true
        })
        .eq('id', partido.id)
    );
    
    // Ejecutar todas las actualizaciones
    const results = await Promise.all(updates);
    const errors = results.filter(res => res.error);
    
    if (errors.length > 0) {
      console.error(`Errores al actualizar ${errors.length} partidos:`, errors);
      return { 
        success: false, 
        message: `Se actualizaron ${partidos.length - errors.length} partidos, pero hubo ${errors.length} errores`, 
        updated: partidos.length - errors.length,
        errors
      };
    }
    
    return { 
      success: true, 
      message: `Se actualizaron ${partidos.length} partidos correctamente`, 
      updated: partidos.length 
    };
  } catch (error) {
    console.error('Error al actualizar partidos existentes:', error);
    return { success: false, error };
  }
};

// Función para ejecutar la actualización desde la consola del navegador
export const runUpdateFromConsole = () => {
  console.log('Iniciando actualización de partidos existentes...');
  updateExistingMatches()
    .then(result => {
      console.log('Resultado de la actualización:', result);
      if (result.success) {
        console.log(`✅ ${result.message}`);
      } else {
        console.error(`❌ Error: ${result.message}`);
      }
    })
    .catch(err => {
      console.error('Error al ejecutar la actualización:', err);
    });
};

// Ejecutar automáticamente al cargar la aplicación
setTimeout(() => {
  runUpdateFromConsole();
}, 5000); // Esperar 5 segundos después de cargar para no interferir con la inicialización