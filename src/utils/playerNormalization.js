// Utility to normalize player object properties for consistency
export const normalizePlayer = (player) => {
  if (!player) return null;
  
  return {
    ...player,
    name: player.name || player.nombre,
    nickname: player.nickname || player.apodo,
    // Keep original fields for backward compatibility
    nombre: player.name || player.nombre,
    apodo: player.nickname || player.apodo
  };
};

export const normalizePlayers = (players) => {
  if (!Array.isArray(players)) return [];
  return players.map(normalizePlayer);
};

// For database queries - use consistent field names
export const getPlayerFields = () => ({
  name: 'name',
  nickname: 'nickname', 
  score: 'score',
  photo: 'foto_url',
  id: 'uuid'
});