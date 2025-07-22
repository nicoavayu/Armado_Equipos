/**
 * Date and Time Constants
 * 
 * This file defines constants related to dates, times, and calendar information.
 */

// Days of the week (full names)
export const DIAS_SEMANA = {
  0: 'Domingo',
  1: 'Lunes', 
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado'
};

// Days of the week (short names)
export const DIAS_SEMANA_CORTO = {
  0: 'Dom',
  1: 'Lun',
  2: 'Mar', 
  3: 'Mié',
  4: 'Jue',
  5: 'Vie',
  6: 'Sáb'
};

// Date format options
export const DATE_FORMATS = {
  SHORT: { day: '2-digit', month: '2-digit', year: 'numeric' },
  MEDIUM: { day: '2-digit', month: 'long', year: 'numeric' },
  LONG: { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }
};

// Time format options
export const TIME_FORMATS = {
  SHORT: { hour: '2-digit', minute: '2-digit' },
  WITH_SECONDS: { hour: '2-digit', minute: '2-digit', second: '2-digit' }
};

// Export all constants
export default {
  DIAS_SEMANA,
  DIAS_SEMANA_CORTO,
  DATE_FORMATS,
  TIME_FORMATS
};