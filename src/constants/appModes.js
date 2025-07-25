/**
 * Application Modes and Steps
 * 
 * This file defines the different modes and steps used throughout the application.
 */

// Main application modes
export const MODES = {
  HOME: 'home',
  ADMIN: 'admin',
  SIMPLE: 'simple', 
  VOTING: 'votacion',
  PLAYER: 'jugador',
};

// Steps for the voting flow
export const STEPS = {
  IDENTIFY: 0,
  PHOTO: 1,
  VOTE: 2,
  CONFIRM: 3,
};

// Steps for the admin panel
export const ADMIN_STEPS = {
  SELECT_TYPE: 0,
  CREATE_MATCH: 1,
  SELECT_FREQUENT: 2,
  EDIT_FREQUENT: 3,
  MANAGE: 4,
  MODO_RAPIDO: 5,
};

// Rating buttons for voting
export const RATING_BUTTONS = Array.from({ length: 10 }, (_, i) => i + 1);

// Export all constants
export default {
  MODES,
  STEPS,
  ADMIN_STEPS,
  RATING_BUTTONS,
};