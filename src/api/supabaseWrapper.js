import { supabase } from '../lib/supabaseClient';

/**
 * Capa de abstracción para operaciones de Supabase
 * 
 * Proporciona métodos simplificados para operaciones CRUD comunes,
 * manejando errores de forma consistente.
 */
class SupabaseAPI {
  /**
   * Obtiene un único registro
   * 
   * @param {string} table - Nombre de la tabla
   * @param {Object} filters - Filtros a aplicar
   * @returns {Promise<Object>} Registro encontrado
   * @throws {Error} Si hay error en la consulta
   * 
   * @example
   * const user = await db.fetchOne('usuarios', { id: '123' });
   */
  async fetchOne(table, filters) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .match(filters)
      .single();
    
    if (error) throw error;
    return data;
  }

  /**
   * Obtiene múltiples registros
   * 
   * @param {string} table - Nombre de la tabla
   * @param {Object} filters - Filtros a aplicar
   * @param {Object} options - Opciones adicionales (orderBy, limit)
   * @returns {Promise<Array>} Array de registros
   * @throws {Error} Si hay error en la consulta
   * 
   * @example
   * const users = await db.fetchMany('usuarios', { activo: true }, {
   *   orderBy: { column: 'created_at', ascending: false },
   *   limit: 10
   * });
   */
  async fetchMany(table, filters = {}, options = {}) {
    let query = supabase.from(table).select('*');
    
    Object.entries(filters).forEach(([key, value]) => {
      query = query.eq(key, value);
    });
    
    if (options.orderBy) {
      query = query.order(options.orderBy.column, { 
        ascending: options.orderBy.ascending ?? true 
      });
    }
    
    if (options.limit) {
      query = query.limit(options.limit);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  /**
   * Inserta un nuevo registro
   * 
   * @param {string} table - Nombre de la tabla
   * @param {Object} data - Datos a insertar
   * @returns {Promise<Object>} Registro insertado
   * @throws {Error} Si hay error en la inserción
   * 
   * @example
   * const newUser = await db.insert('usuarios', { nombre: 'Juan', email: 'juan@example.com' });
   */
  async insert(table, data) {
    const { data: result, error } = await supabase
      .from(table)
      .insert(data)
      .select()
      .single();
    
    if (error) throw error;
    return result;
  }

  /**
   * Actualiza registros existentes
   * 
   * @param {string} table - Nombre de la tabla
   * @param {Object} filters - Filtros para identificar registros
   * @param {Object} updates - Datos a actualizar
   * @returns {Promise<Object>} Registro actualizado
   * @throws {Error} Si hay error en la actualización
   * 
   * @example
   * const updated = await db.update('usuarios', { id: '123' }, { nombre: 'Juan Actualizado' });
   */
  async update(table, filters, updates) {
    const { data, error } = await supabase
      .from(table)
      .update(updates)
      .match(filters)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  /**
   * Elimina registros
   * 
   * @param {string} table - Nombre de la tabla
   * @param {Object} filters - Filtros para identificar registros
   * @returns {Promise<void>}
   * @throws {Error} Si hay error en la eliminación
   * 
   * @example
   * await db.remove('usuarios', { id: '123' });
   */
  async remove(table, filters) {
    const { error } = await supabase
      .from(table)
      .delete()
      .match(filters);
    
    if (error) throw error;
  }
}

/**
 * Instancia singleton de la API de Supabase
 */
export const db = new SupabaseAPI();
