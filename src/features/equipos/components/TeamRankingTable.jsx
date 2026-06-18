import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import TeamRankingCard from './TeamRankingCard';

// Premium compact "tabla de posiciones". The column headers ARE the sort
// controls (no big "Más jugaron / Más ganaron" buttons): tapping a stat header
// sorts by it, tapping again flips asc <-> desc. The grid template is shared
// with every row so columns stay aligned. PJ is intentionally NOT shown (G/E/P
// already convey it); dropping it gives the team-name column more room. G/E/P
// share one width so the numeric block scans cleanly; F (F11) and % (100) get a
// touch more room.
export const RANKING_GRID_TEMPLATE = '20px minmax(0,1fr) 32px 26px 26px 26px 40px';

const STAT_COLUMNS = [
  { key: 'format', label: 'F', aria: 'Formato' },
  { key: 'wins', label: 'G', aria: 'Ganados' },
  { key: 'draws', label: 'E', aria: 'Empatados' },
  { key: 'losses', label: 'P', aria: 'Perdidos' },
  { key: 'winRate', label: '%', aria: 'Porcentaje de victorias' },
];

const SortableHeader = ({ column, sort, onSort, align = 'center', className = '' }) => {
  const active = sort?.key === column.key;
  const dir = active ? sort.dir : null;
  const justify = align === 'left' ? 'justify-start' : 'justify-center';

  // The sort caret is absolutely anchored to the RIGHT of the label so the label
  // itself stays perfectly centered over the (text-center) numeric values — the
  // active column no longer drifts left of its column.
  const caret = active
    ? (dir === 'asc'
      ? <ChevronUp size={11} strokeWidth={2.5} aria-hidden="true" />
      : <ChevronDown size={11} strokeWidth={2.5} aria-hidden="true" />)
    : null;

  return (
    <button
      type="button"
      role="columnheader"
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      title={`Ordenar por ${column.aria}`}
      onClick={() => onSort(column.key)}
      className={`flex items-center ${justify} font-oswald text-[10.5px] font-bold uppercase tracking-wider transition-colors duration-150 ${
        active ? 'text-[#b9a8ff]' : 'text-white/45 hover:text-white/75'
      } ${className}`}
    >
      <span className="relative">
        {column.label}
        {caret ? (
          <span className="absolute left-full top-1/2 ml-px -translate-y-1/2">{caret}</span>
        ) : null}
      </span>
    </button>
  );
};

const TeamRankingTable = ({ rows, sort, onSort, isOwnTeam }) => (
  <div
    role="table"
    aria-label="Ranking de equipos"
    className="w-full overflow-hidden rounded-card border border-[rgba(148,134,255,0.18)] bg-[linear-gradient(165deg,rgba(48,38,98,0.45),rgba(20,16,41,0.92))] shadow-elev-1"
  >
    <div
      role="row"
      className="grid items-center border-b border-[rgba(148,134,255,0.18)] bg-black/25 px-2.5 py-2"
      style={{ gridTemplateColumns: RANKING_GRID_TEMPLATE, columnGap: 4 }}
    >
      <div role="columnheader" className="text-center font-oswald text-[10.5px] font-bold uppercase tracking-wider text-white/35">
        #
      </div>
      <SortableHeader
        column={{ key: 'name', label: 'Equipo', aria: 'nombre de equipo' }}
        sort={sort}
        onSort={onSort}
        align="left"
      />
      {STAT_COLUMNS.map((column) => (
        <SortableHeader key={column.key} column={column} sort={sort} onSort={onSort} />
      ))}
    </div>

    <div role="rowgroup">
      {rows.map((team, index) => (
        <TeamRankingCard
          key={team.team_id || index}
          team={team}
          position={index + 1}
          isOwnTeam={isOwnTeam(team)}
          gridTemplate={RANKING_GRID_TEMPLATE}
        />
      ))}
    </div>
  </div>
);

export default TeamRankingTable;
