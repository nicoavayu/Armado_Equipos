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

const resolveName = (player) => player?.nombre || player?.name || 'Jugador';
const resolveAvatar = (player) => player?.avatar_url || player?.foto_url || null;

const PlayerChip = ({ player, provided, snapshot, isReplacementTarget = false }) => {
  const avatar = resolveAvatar(player);
  return (
    <div
      ref={provided.innerRef}
      {...provided.draggableProps}
      {...provided.dragHandleProps}
      className={`group flex items-center gap-2 rounded-xl border border-white/20 bg-white/[0.10] px-2.5 py-2 text-left transition-all duration-150 ease-out
        ${snapshot.isDragging ? 'scale-[1.02] border-[#128BE9]/65 bg-[#128BE9]/18 shadow-[0_8px_24px_rgba(18,139,233,0.35)]' : 'hover:bg-white/[0.14]'}
        ${isReplacementTarget ? 'ring-2 ring-[#0EA9C6]/80 border-[#0EA9C6]/70 bg-[#0EA9C6]/15' : ''}`}
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

const TeamColumn = ({
  title,
  droppableId,
  playerKeys,
  playersByKey = {},
  selected = false,
  onSelect,
  isDragging = false,
  dragTarget = null,
  sourceTeamId = null,
}) => {
  return (
    <button
      type="button"
      onClick={() => {
        if (!isDragging) onSelect?.();
      }}
      className={`min-w-0 rounded-2xl border p-2.5 text-left backdrop-blur-md transition-all duration-150 ease-out ${
        selected
          ? 'border-[#73bcff]/70 bg-[#128BE9]/18 shadow-[0_0_0_1px_rgba(115,188,255,0.35),0_12px_26px_rgba(18,139,233,0.28)]'
          : 'border-white/15 bg-white/[0.06]'
      }`}
    >
      <div className="mb-2 px-0.5">
        <div className="font-bebas text-[22px] leading-none tracking-wide text-white/95">{title}</div>
        <div className="mt-1 text-[12px] font-oswald text-white/70">{playerKeys.length} jugadores</div>
      </div>
      <Droppable droppableId={droppableId}>
        {(dropProvided, dropSnapshot) => (
          <div
            ref={dropProvided.innerRef}
            {...dropProvided.droppableProps}
            className={`flex max-h-[40dvh] min-h-[180px] flex-col gap-2 overflow-y-auto rounded-xl border border-transparent p-1.5 transition-all duration-150 ease-out
              ${dropSnapshot.isDraggingOver ? 'border-[#128BE9]/55 bg-[#128BE9]/14' : ''}`}
          >
            {playerKeys.map((key, index) => {
              const player = playersByKey[key] || { nombre: 'Jugador' };
              const draggableId = `${droppableId}::${key}`;
              const isReplacementTarget = Boolean(dragTarget) &&
                sourceTeamId !== droppableId &&
                dragTarget.teamId === droppableId &&
                dragTarget.index === index;
              return (
                <Draggable key={draggableId} draggableId={draggableId} index={index}>
                  {(dragProvided, dragSnapshot) => (
                    <PlayerChip
                      player={player}
                      provided={dragProvided}
                      snapshot={dragSnapshot}
                      isReplacementTarget={isReplacementTarget}
                    />
                  )}
                </Draggable>
              );
            })}
            {dropProvided.placeholder}
          </div>
        )}
      </Droppable>
    </button>
  );
};

export default function TeamsDnDEditor({
  teamA = [],
  teamB = [],
  playersByKey = {},
  onChange,
  disabled = false,
  selectedWinner = '',
  onWinnerChange,
}) {
  const suppressSelectRef = React.useRef(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const [dragTarget, setDragTarget] = React.useState(null);

  const parseDraggableId = (draggableId) => {
    const [teamId, ...rest] = String(draggableId || '').split('::');
    return {
      teamId,
      playerKey: rest.join('::'),
    };
  };

  const getTeamPlayers = (teamId) => (teamId === TEAM_A_ID ? Array.from(teamA || []) : Array.from(teamB || []));

  const handleDragUpdate = (update) => {
    if (disabled) return;
    const { source, destination, combine } = update || {};
    if (!source) {
      setDragTarget(null);
      return;
    }

    if (combine?.draggableId) {
      const parsed = parseDraggableId(combine.draggableId);
      const players = getTeamPlayers(parsed.teamId);
      const index = players.findIndex((key) => key === parsed.playerKey);
      if (index !== -1) {
        setDragTarget({
          teamId: parsed.teamId,
          index,
          sourceTeamId: source.droppableId,
        });
        return;
      }
    }

    if (destination) {
      setDragTarget({
        teamId: destination.droppableId,
        index: destination.index,
        sourceTeamId: source.droppableId,
      });
      return;
    }

    setDragTarget(null);
  };

  const handleDragEnd = (result) => {
    setIsDragging(false);
    setDragTarget(null);
    window.setTimeout(() => {
      suppressSelectRef.current = false;
    }, 150);
    if (disabled) return;
    const { source, destination, combine } = result || {};
    if (!source) return;
    if (!destination && !combine) return;

    let sourceId = source.droppableId;
    let destinationId = destination?.droppableId || null;
    let destinationIndex = destination?.index ?? null;

    if (combine?.draggableId) {
      const parsed = parseDraggableId(combine.draggableId);
      destinationId = parsed.teamId;
      const parsedPlayers = getTeamPlayers(destinationId);
      destinationIndex = parsedPlayers.findIndex((key) => key === parsed.playerKey);
    }

    if (!destinationId || destinationIndex == null || destinationIndex < 0) return;

    const sourceList = sourceId === TEAM_A_ID ? teamA : teamB;
    const destinationList = destinationId === TEAM_A_ID ? teamA : teamB;

    if (!Array.isArray(sourceList) || !Array.isArray(destinationList)) return;

    if (sourceId === destinationId) {
      const reordered = reorder(sourceList, source.index, destinationIndex);
      if (sourceId === TEAM_A_ID) onChange?.({ teamA: reordered, teamB: Array.from(teamB) });
      else onChange?.({ teamA: Array.from(teamA), teamB: reordered });
      return;
    }

    const sourcePlayer = sourceList[source.index];
    const targetPlayer = destinationList[destinationIndex];
    if (!sourcePlayer || !targetPlayer) return;

    const nextSource = Array.from(sourceList);
    const nextDestination = Array.from(destinationList);
    [nextSource[source.index], nextDestination[destinationIndex]] = [nextDestination[destinationIndex], nextSource[source.index]];

    if (sourceId === TEAM_A_ID) {
      onChange?.({ teamA: nextSource, teamB: nextDestination });
    } else {
      onChange?.({ teamA: nextDestination, teamB: nextSource });
    }
  };

  return (
    <DragDropContext
      onDragStart={() => {
        suppressSelectRef.current = true;
        setIsDragging(true);
      }}
      onDragUpdate={handleDragUpdate}
      onDragEnd={handleDragEnd}
    >
      <div className="grid grid-cols-2 gap-2.5">
        <TeamColumn
          title="Equipo A"
          droppableId={TEAM_A_ID}
          playerKeys={teamA}
          playersByKey={playersByKey}
          selected={selectedWinner === 'equipo_a'}
          isDragging={isDragging}
          dragTarget={dragTarget}
          sourceTeamId={dragTarget?.sourceTeamId || null}
          onSelect={() => {
            if (suppressSelectRef.current) return;
            onWinnerChange?.('equipo_a');
          }}
        />
        <TeamColumn
          title="Equipo B"
          droppableId={TEAM_B_ID}
          playerKeys={teamB}
          playersByKey={playersByKey}
          selected={selectedWinner === 'equipo_b'}
          isDragging={isDragging}
          dragTarget={dragTarget}
          sourceTeamId={dragTarget?.sourceTeamId || null}
          onSelect={() => {
            if (suppressSelectRef.current) return;
            onWinnerChange?.('equipo_b');
          }}
        />
      </div>
    </DragDropContext>
  );
}
