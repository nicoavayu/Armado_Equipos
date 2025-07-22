/**
 * Validation Constants
 * 
 * This file defines constants related to data validation.
 */

// Validation rules for players and teams
export const VALIDATION_RULES = {
  MIN_PLAYERS_FOR_TEAMS: 2,
  REQUIRED_EVEN_PLAYERS: true,
  MAX_PLAYER_NAME_LENGTH: 40,
  RATING_MIN: 1,
  RATING_MAX: 10
};

// Team balancing configuration
export const TEAM_BALANCING = {
  MAX_SCORE_DIFFERENCE: 5,
  MAX_SHUFFLE_ATTEMPTS: 500,
  MAX_LOCKED_PLAYERS_PER_TEAM: 3,
  DEFAULT_PLAYER_SCORE: 5,
  PERFECT_MATCH_SCORE_DIFF: 0
};

// Form validation patterns
export const VALIDATION_PATTERNS = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  PHONE: /^[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}$/,
  URL: /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/
};

// Export all constants
export default {
  VALIDATION_RULES,
  TEAM_BALANCING,
  VALIDATION_PATTERNS
};