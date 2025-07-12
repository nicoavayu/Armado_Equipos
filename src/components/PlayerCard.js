import React, { memo } from 'react';
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
  return (
    <div
      className={`player-card ${isDragOver ? 'drag-over' : ''} ${isDragging ? 'dragging' : ''} ${isLocked ? 'locked' : ''}`}
      ref={provided.innerRef}
      {...provided.draggableProps}
      {...provided.dragHandleProps}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onClick={() => onToggleLock(playerId)}
      role="button"
      tabIndex={0}
      aria-label={`${isLocked ? 'Desbloquear' : 'Bloquear'} jugador ${player.nombre}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggleLock(playerId);
        }
      }}
    >
      <img 
        src={player.foto_url || 'https://api.dicebear.com/6.x/pixel-art/svg?seed=default'} 
        alt={player.nombre} 
        className="player-avatar" 
      />
      <span>{player.nombre}</span>
      {isLocked && (
        <span className="lock-icon">🔒</span>
      )}
      {showAverages && (
        <span className={`player-score ${scoreColorClass}`}>
          {(player.score || TEAM_BALANCING.DEFAULT_PLAYER_SCORE).toFixed(1)}
        </span>
      )}
    </div>
  );
});

PlayerCard.displayName = 'PlayerCard';

export default PlayerCard;