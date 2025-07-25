/**
 * Services Index
 * 
 * This file exports all services to provide a centralized import point.
 */

// API Services
export { default as supabase, getCurrentUserId, clearGuestSession } from './api/supabase';
export { default as matchService } from './api/matchService';
export { default as playerService } from './api/playerService';
export { default as authService } from './api/authService';

// Individual exports for backward compatibility
export {
  // Match Service
  crearPartido,
  getPartidoPorCodigo,
  updateJugadoresPartido,
  updateJugadoresFrecuentes,
  crearPartidoFrecuente,
  getPartidosFrecuentes,
  updatePartidoFrecuente,
  deletePartidoFrecuente,
  crearPartidoDesdeFrec,
  clearVotesForMatch,
  deletePartido,
  getVotantesIds,
  getVotantesConNombres,
  checkIfAlreadyVoted,
  submitVotos,
  closeVotingAndCalculateScores,
  cleanupInvalidVotes,
  checkPartidoCalificado,
} from './api/matchService';

export {
  // Player Service
  getJugadores,
  addJugador,
  deleteJugador,
  uploadFoto,
  getProfile,
  updateProfile,
  createOrUpdateProfile,
  calculateProfileCompletion,
  addFreePlayer,
  removeFreePlayer,
  getFreePlayerStatus,
  getFreePlayersList,
  getAmigos,
  getRelationshipStatus,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriend,
  getPendingRequests,
} from './api/playerService';

export {
  // Auth Service
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
  signOut,
  getCurrentUser,
  getCurrentSession,
  resetPassword,
  updatePassword,
  updateEmail,
  onAuthStateChange,
} from './api/authService';