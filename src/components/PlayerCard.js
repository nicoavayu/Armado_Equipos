import React, { memo, useState } from 'react';
import { motion } from 'framer-motion';
import { TEAM_BALANCING } from '../appConstants';

const PlayerCard = memo(({ 
  player, 
  playerId, 
  isLocked, 
  isDragging, 
  isDragOver, 
  showAverages, 
  scoreColorClass,
  onToggleLock,
  provided,
  onDragEnter,
  onDragLeave,
  onDragOver
}) => {
  const [justToggled, setJustToggled] = useState(false);

  const handleToggleLock = () => {
    setJustToggled(true);
    onToggleLock(playerId);
    setTimeout(() => setJustToggled(false), 600);
  };

  return (
    <motion.div
      className={`player-card ${isDragOver ? 'drag-over' : ''} ${isDragging ? 'dragging' : ''} ${isLocked ? 'locked' : ''}`}
      ref={provided.innerRef}
      {...provided.draggableProps}
      {...provided.dragHandleProps}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onClick={handleToggleLock}
      role="button"
      tabIndex={0}
      aria-label={`${isLocked ? 'Desbloquear' : 'Bloquear'} jugador ${player.name || player.nombre}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleToggleLock();
        }
      }}
      animate={{
        boxShadow: justToggled 
          ? isLocked 
            ? '0 0 20px rgba(255, 215, 0, 0.6)' 
            : '0 0 20px rgba(34, 197, 94, 0.6)'
          : '0 2px 8px rgba(0,0,0,0.1)',
        x: justToggled ? [0, -2, 2, -2, 2, 0] : 0
      }}
      transition={{ 
        boxShadow: { duration: 0.6 },
        x: { duration: 0.4, times: [0, 0.2, 0.4, 0.6, 0.8, 1] }
      }}
    >
      <img 
        src={player.foto_url || 'https://api.dicebear.com/6.x/pixel-art/svg?seed=default'} 
        alt={player.name || player.nombre} 
        className="player-avatar" 
      />
      <span>{player.name || player.nombre}</span>
      {isLocked && (
        <motion.span 
          className="lock-icon"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 15 }}
        >
          🔒
        </motion.span>
      )}
      {showAverages && (
        <span className={`player-score ${scoreColorClass}`}>
          {(player.score || TEAM_BALANCING.DEFAULT_PLAYER_SCORE).toFixed(1)}
        </span>
      )}
    </motion.div>
  );
});

PlayerCard.displayName = 'PlayerCard';

export default PlayerCard;