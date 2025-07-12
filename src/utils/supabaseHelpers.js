import { supabase } from '../supabase';
import { handleError } from './errorHandler';

export const safeInsert = async (table, data, errorMessage) => {
  try {
    const { data: result, error } = await supabase
      .from(table)
      .insert([data])
      .select()
      .single();
    
    if (error) throw error;
    return result;
  } catch (error) {
    throw handleError(error, errorMessage || `Error inserting into ${table}`);
  }
};

export const safeSelect = async (table, query = '*', filters = {}, errorMessage) => {
  try {
    let queryBuilder = supabase.from(table).select(query);
    
    Object.entries(filters).forEach(([key, value]) => {
      queryBuilder = queryBuilder.eq(key, value);
    });
    
    const { data, error } = await queryBuilder;
    if (error) throw error;
    return data || [];
  } catch (error) {
    throw handleError(error, errorMessage || `Error fetching from ${table}`);
  }
};

export const safeUpdate = async (table, id, updates, errorMessage) => {
  try {
    const { data, error } = await supabase
      .from(table)
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  } catch (error) {
    throw handleError(error, errorMessage || `Error updating ${table}`);
  }
};