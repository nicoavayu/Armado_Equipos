import React from 'react';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';

const TEAM_A_ID = 'equipoA';
const TEAM_B_ID = 'equipoB';

const reorder = (list, startIndex, endIndex) => {
  const next = Array.from(list || []);
  const [removed] = next.splice(startIndex, 1);
  next.splice(endIndex, 0, removed);
  return next;
};

const move = (source, destination, sourceIndex, destinationIndex) => {
  const sourceClone = Array.from(source || []);
  const destinationClone = Array.from(destination || []);
  const [removed] = sourceClone.splice(sourceIndex, 1);
  destinationClone.splice(destinationIndex, 0, removed);
  return [sourceClone, destinationClone];
};

const resolveName = (player) => player?.nombre || player?.name || 'Jugador';
const resolveAvatar = (player) => player?.avatar_url || player?.foto_url || null;

const PlayerChip = ({ player, provided, snapshot }) => {
  const avatar = resolveAvatar(player);
  return (
    <div
      ref={provided.innerRef}
      {...provided.draggableProps}
      {...provided.dragHandleProps}
      className={`group flex items-center gap-2 rounded-xl border border-white/20 bg-white/[0.10] px-2.5 py-2 text-left transition-all duration-150 ease-out
        ${snapshot.isDragging ? 'scale-[1.02] border-[#128BE9]/65 bg-[#128BE9]/18 shadow-[0_8px_24px_rgba(18,139,233,0.35)]' : 'hover:bg-white/[0.14]'}`}
    >
      <div className="h-8 w-8 shrink-0 overflow-hidden rounded-lg border border-white/20 bg-black/20">
        {avatar ? (
          <img src={avatar} alt={resolveName(player)} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-white/70">
            {resolveName(player).charAt(0)}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 text-sm font-oswald text-white/90">
        <div className="truncate">{resolveName(player)}</div>
      </div>
    </div>
  );
};

const TeamColumn = ({ title, droppableId, playerKeys, playersByKey = {} }) => {
  return (
    <div className="flex min-h-[220px] flex-col rounded-2xl border border-white/15 bg-white/[0.06] p-3 backdrop-blur-md">
      <div className="mb-2 text-center font-bebas text-[20px] tracking-wide text-white/90">{title}</div>
      <Droppable droppableId={droppableId}>
        {(dropProvided, dropSnapshot) => (
          <div
            ref={dropProvided.innerRef}
            {...dropProvided.droppableProps}
            className={`flex min-h-[160px] flex-1 flex-col gap-2 rounded-xl border border-transparent p-1.5 transition-all duration-150 ease-out
              ${dropSnapshot.isDraggingOver ? 'border-[#128BE9]/55 bg-[#128BE9]/14' : ''}`}
          >
            {playerKeys.map((key, index) => {
              const player = playersByKey[key] || { nombre: 'Jugador' };
              const draggableId = `${droppableId}::${key}`;
              return (
                <Draggable key={draggableId} draggableId={draggableId} index={index}>
                  {(dragProvided, dragSnapshot) => (
                    <PlayerChip player={player} provided={dragProvided} snapshot={dragSnapshot} />
                  )}
                </Draggable>
              );
            })}
            {dropProvided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
};

export default function TeamsDnDEditor({ teamA = [], teamB = [], playersByKey = {}, onChange, disabled = false }) {
  const handleDragEnd = (result) => {
    if (disabled) return;
    const { source, destination } = result || {};
    if (!source || !destination) return;

    const sourceId = source.droppableId;
    const destinationId = destination.droppableId;
    const sourceList = sourceId === TEAM_A_ID ? teamA : teamB;
    const destinationList = destinationId === TEAM_A_ID ? teamA : teamB;

    if (!Array.isArray(sourceList) || !Array.isArray(destinationList)) return;

    if (sourceId === destinationId) {
      const reordered = reorder(sourceList, source.index, destination.index);
      if (sourceId === TEAM_A_ID) onChange?.({ teamA: reordered, teamB: Array.from(teamB) });
      else onChange?.({ teamA: Array.from(teamA), teamB: reordered });
      return;
    }

    const [nextSource, nextDestination] = move(sourceList, destinationList, source.index, destination.index);
    const hasDuplicates = new Set([...nextSource, ...nextDestination]).size !== nextSource.length + nextDestination.length;
    if (hasDuplicates) return;

    if (sourceId === TEAM_A_ID) {
      onChange?.({ teamA: nextSource, teamB: nextDestination });
    } else {
      onChange?.({ teamA: nextDestination, teamB: nextSource });
    }
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TeamColumn title="Equipo A" droppableId={TEAM_A_ID} playerKeys={teamA} playersByKey={playersByKey} />
        <TeamColumn title="Equipo B" droppableId={TEAM_B_ID} playerKeys={teamB} playersByKey={playersByKey} />
      </div>
    </DragDropContext>
  );
}
