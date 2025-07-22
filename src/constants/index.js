/**
 * Constants Index
 * 
 * This file exports all constants to provide a centralized import point.
 */

// Import all constants
import * as appModes from './appModes';
import * as dateTime from './dateTime';
import * as ui from './ui';
import * as validation from './validation';

// Re-export for backward compatibility
export const {
  MODES,
  STEPS,
  ADMIN_STEPS,
  RATING_BUTTONS
} = appModes;

export const {
  DIAS_SEMANA,
  DIAS_SEMANA_CORTO,
  DATE_FORMATS,
  TIME_FORMATS
} = dateTime;

export const {
  UI_MESSAGES,
  LOADING_STATES,
  ANIMATION_DURATIONS,
  UI_SIZES,
  BREAKPOINTS
} = ui;

export const {
  VALIDATION_RULES,
  TEAM_BALANCING,
  VALIDATION_PATTERNS
} = validation;

// Export all constants as namespaces
export default {
  appModes,
  dateTime,
  ui,
  validation
};