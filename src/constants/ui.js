/**
 * UI Constants
 * 
 * This file defines constants related to the user interface.
 */

// UI messages for feedback and notifications
export const UI_MESSAGES = {
  LOADING: 'Cargando...',
  ERROR_GENERIC: 'Ha ocurrido un error',
  SUCCESS_MATCH_CREATED: 'Partido creado correctamente',
  SUCCESS_FREQUENT_SAVED: 'Partido frecuente guardado',
  ERROR_EVEN_PLAYERS: '¡La cantidad de jugadores debe ser PAR!',
  CONFIRM_CLOSE_VOTING: '¿Cerrar votación y armar equipos?'
};

// Loading states for buttons and UI elements
export const LOADING_STATES = {
  ADDING_PLAYER: "AGREGANDO...",
  REMOVING_PLAYER: "ELIMINANDO...",
  CLOSING_VOTING: "CERRANDO VOTACIÓN...",
  CREATING_MATCH: "CREANDO...",
  SAVING: "GUARDANDO...",
  LOADING: "CARGANDO...",
  PROCESSING: "PROCESANDO..."
};

// Animation durations in milliseconds
export const ANIMATION_DURATIONS = {
  CONFETTI_DISPLAY: 3000,
  TOAST_DISPLAY: 1700,
  PERFECT_MATCH_CELEBRATION: 3000,
  BUTTON_TRANSITION: 200,
  HOVER_TRANSITION: 150
};

// UI element sizes in pixels
export const UI_SIZES = {
  WHATSAPP_ICON_SIZE: 20,
  PLAYER_AVATAR_MOBILE: 24,
  PLAYER_AVATAR_DEFAULT: 28,
  PLAYER_AVATAR_DESKTOP: 40,
  LOCK_ICON_MOBILE: 14,
  LOCK_ICON_DEFAULT: 16,
  LOCK_ICON_DESKTOP: 18
};

// Responsive breakpoints in pixels
export const BREAKPOINTS = {
  MOBILE_MAX: 480,
  TABLET_MIN: 600,
  DESKTOP_MIN: 768,
  LARGE_DESKTOP_MIN: 1024
};

// Export all constants
export default {
  UI_MESSAGES,
  LOADING_STATES,
  ANIMATION_DURATIONS,
  UI_SIZES,
  BREAKPOINTS
};