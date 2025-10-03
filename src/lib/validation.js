/**
 * Unified Validation Library
 * Consolidates all validation constants and functions
 */

// Validation rules for players and teams
export const VALIDATION_RULES = {
  MIN_PLAYERS_FOR_TEAMS: 2,
  REQUIRED_EVEN_PLAYERS: true,
  MAX_PLAYER_NAME_LENGTH: 40,
  RATING_MIN: 1,
  RATING_MAX: 10,
};

// Team balancing configuration
export const TEAM_BALANCING = {
  MAX_SCORE_DIFFERENCE: 5,
  MAX_SHUFFLE_ATTEMPTS: 500,
  MAX_LOCKED_PLAYERS_PER_TEAM: 3,
  DEFAULT_PLAYER_SCORE: 5,
  PERFECT_MATCH_SCORE_DIFF: 0,
};

// Form validation patterns
export const VALIDATION_PATTERNS = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  PHONE: /^[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}$/,
  URL: /^(https?:\/\/)?([da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/,
};

// Validation functions
export const validatePlayerCount = (players) => {
  if (!players || players.length < VALIDATION_RULES.MIN_PLAYERS_FOR_TEAMS) {
    return { valid: false, message: 'Se necesitan al menos 2 jugadores' };
  }
  
  if (VALIDATION_RULES.REQUIRED_EVEN_PLAYERS && players.length % 2 !== 0) {
    return { valid: false, message: 'La cantidad de jugadores debe ser PAR' };
  }
  
  return { valid: true };
};

export const validatePlayerName = (name) => {
  if (!name || !name.trim()) {
    return { valid: false, message: 'El nombre es requerido' };
  }
  
  if (name.length > VALIDATION_RULES.MAX_PLAYER_NAME_LENGTH) {
    return { valid: false, message: `Máximo ${VALIDATION_RULES.MAX_PLAYER_NAME_LENGTH} caracteres` };
  }
  
  return { valid: true };
};

export const validateFrequentMatch = (data) => {
  const required = ['nombre', 'sede', 'hora'];
  const missing = required.filter((field) => !data[field]?.trim());
  
  if (missing.length > 0) {
    return { valid: false, message: `Campos requeridos: ${missing.join(', ')}` };
  }
  
  return { valid: true };
};

// Default export for backward compatibility
export default {
  VALIDATION_RULES,
  TEAM_BALANCING,
  VALIDATION_PATTERNS,
  validatePlayerCount,
  validatePlayerName,
  validateFrequentMatch,
};