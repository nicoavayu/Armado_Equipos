import { VALIDATION_RULES } from '../constants';

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