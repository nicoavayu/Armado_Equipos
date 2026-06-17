import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Trophy, Users } from 'lucide-react';
import EmptyStateCard from '../../../components/EmptyStateCard';
import NeighborhoodAutocomplete from '../components/NeighborhoodAutocomplete';
import TeamRankingCard from '../components/TeamRankingCard';
import ChallengeableTeamCard from '../components/ChallengeableTeamCard';
import { TEAM_FORMAT_OPTIONS } from '../config';
import { getTeamChallengeRankings, searchChallengeableTeams } from '../../../services/db/teamRankings';
import { notifyBlockingError } from '../../../utils/notifyBlockingError';

const filterFieldClass = 'h-[44px] w-full rounded-xl bg-[rgba(20,16,41,0.8)] border border-[rgba(148,134,255,0.2)] px-3 text-[15px] text-white outline-none focus:border-[#6a43ff] focus:ring-1 focus:ring-[#6a43ff]/45';

const segmentBase = 'flex-1 min-w-0 rounded-full border border-transparent px-2 py-0 font-bebas text-[0.92rem] tracking-[0.03em] transition-[background-color,color] duration-150';
const segmentActive = 'z-[2] bg-cta-gradient text-white shadow-[0_4px_14px_rgba(106,67,255,0.4),inset_0_1px_0_rgba(255,255,255,0.2)]';
const segmentIdle = 'z-[1] bg-transparent text-white/60 hover:text-white/90 hover:bg-white/[0.06]';

const togglePillBase = 'flex-1 min-w-0 rounded-lg px-3 py-2 font-oswald text-[13px] font-semibold tracking-wide transition-all duration-150 border';
const togglePillActive = 'border-[#7d5aff] bg-[rgba(106,67,255,0.22)] text-white';
const togglePillIdle = 'border-[rgba(148,134,255,0.2)] bg-[rgba(20,16,41,0.8)] text-white/65 hover:text-white';

const SegmentedTabs = ({ tabs, value, onChange }) => (
  <div className="flex h-[42px] w-full gap-1 p-1 overflow-hidden rounded-full border border-[rgba(148,134,255,0.22)] bg-[rgba(20,16,41,0.85)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_6px_16px_rgba(5,3,16,0.35)]">
    {tabs.map((tab) => (
      <button
        key={tab.key}
        type="button"
        onClick={() => onChange(tab.key)}
        className={`${segmentBase} ${value === tab.key ? segmentActive : segmentIdle}`}
      >
        {tab.label}
      </button>
    ))}
  </div>
);

const FormatSelect = ({ value, onChange }) => (
  <select value={value} onChange={(event) => onChange(event.target.value)} className={filterFieldClass}>
    <option value="">Todos los formatos</option>
    {TEAM_FORMAT_OPTIONS.map((option) => (
      <option key={option} value={String(option)}>{`F${option}`}</option>
    ))}
  </select>
);

const ZoneFilter = ({ value, onChange }) => (
  <NeighborhoodAutocomplete
    value={value}
    onChange={onChange}
    placeholder="Zona / barrio"
    inputClassName={`${filterFieldClass} disabled:opacity-60 disabled:cursor-not-allowed`}
  />
);

const TeamRankingsView = ({
  userId,
  ownTeamIds = null,
  onPublishChallenge,
  ctaDisabled = false,
}) => {
  const [activeTab, setActiveTab] = useState('ranking');

  // Ranking tab state
  const [rankingSort, setRankingSort] = useState('played');
  const [rankingPeriod, setRankingPeriod] = useState('all');
  const [rankingFormat, setRankingFormat] = useState('');
  const [rankingZone, setRankingZone] = useState('');
  const [rankingRows, setRankingRows] = useState([]);
  const [rankingLoading, setRankingLoading] = useState(true);

  // Equipos (directory) tab state
  const [dirQuery, setDirQuery] = useState('');
  const [dirFormat, setDirFormat] = useState('');
  const [dirZone, setDirZone] = useState('');
  const [dirRows, setDirRows] = useState([]);
  const [dirLoading, setDirLoading] = useState(true);

  const ownIdSet = useMemo(() => {
    if (ownTeamIds instanceof Set) return ownTeamIds;
    return new Set((ownTeamIds || []).map((id) => String(id)).filter(Boolean));
  }, [ownTeamIds]);

  const isOwnTeam = useCallback(
    (team) => ownIdSet.has(String(team?.team_id || '')),
    [ownIdSet],
  );

  const loadRanking = useCallback(async () => {
    if (!userId) return;
    try {
      setRankingLoading(true);
      const rows = await getTeamChallengeRankings({
        format: rankingFormat,
        zone: rankingZone,
        sort: rankingSort,
        period: rankingPeriod,
        limit: 50,
      });
      setRankingRows(rows || []);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo cargar el ranking');
    } finally {
      setRankingLoading(false);
    }
  }, [rankingFormat, rankingZone, rankingSort, rankingPeriod, userId]);

  const loadDirectory = useCallback(async () => {
    if (!userId) return;
    try {
      setDirLoading(true);
      const rows = await searchChallengeableTeams({
        query: dirQuery,
        format: dirFormat,
        zone: dirZone,
        limit: 50,
      });
      setDirRows(rows || []);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo cargar el directorio');
    } finally {
      setDirLoading(false);
    }
  }, [dirQuery, dirFormat, dirZone, userId]);

  useEffect(() => {
    if (activeTab !== 'ranking') return;
    loadRanking();
  }, [activeTab, loadRanking]);

  // Debounce the directory load so the name search doesn't fire a request per keystroke.
  useEffect(() => {
    if (activeTab !== 'equipos') return undefined;
    const timeoutId = window.setTimeout(() => {
      loadDirectory();
    }, 280);
    return () => window.clearTimeout(timeoutId);
  }, [activeTab, loadDirectory]);

  return (
    <div className="w-full max-w-[560px] flex flex-col gap-3">
      <div className="rounded-card border border-[rgba(148,134,255,0.18)] bg-[linear-gradient(165deg,rgba(48,38,98,0.45),rgba(20,16,41,0.85))] px-4 py-3 shadow-elev-1">
        <h2 className="font-bebas text-[20px] tracking-[0.03em] text-white leading-none">Ranking de equipos</h2>
        <p className="mt-1 text-[12px] text-white/55 font-oswald">Los equipos más activos y ganadores</p>
      </div>

      <SegmentedTabs
        tabs={[{ key: 'ranking', label: 'RANKING' }, { key: 'equipos', label: 'EQUIPOS' }]}
        value={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === 'ranking' ? (
        <>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setRankingSort('played')}
              className={`${togglePillBase} ${rankingSort === 'played' ? togglePillActive : togglePillIdle}`}
            >
              Más jugaron
            </button>
            <button
              type="button"
              onClick={() => setRankingSort('wins')}
              className={`${togglePillBase} ${rankingSort === 'wins' ? togglePillActive : togglePillIdle}`}
            >
              Más ganaron
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <FormatSelect value={rankingFormat} onChange={setRankingFormat} />
            <ZoneFilter value={rankingZone} onChange={setRankingZone} />
          </div>

          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setRankingPeriod('all')}
              className={`${togglePillBase} ${rankingPeriod === 'all' ? togglePillActive : togglePillIdle}`}
            >
              Todo el tiempo
            </button>
            <button
              type="button"
              onClick={() => setRankingPeriod('90d')}
              className={`${togglePillBase} ${rankingPeriod === '90d' ? togglePillActive : togglePillIdle}`}
            >
              Últimos 90 días
            </button>
          </div>

          {rankingLoading ? (
            <div className="rounded-2xl border border-white/15 bg-white/5 p-4 text-center text-white/70 font-oswald">
              Cargando ranking...
            </div>
          ) : rankingRows.length === 0 ? (
            <EmptyStateCard
              icon={Trophy}
              title="No hay partidos confirmados todavía"
              description="Cuando los equipos jueguen desafíos, van a aparecer acá."
              className="my-0 p-5"
            />
          ) : (
            rankingRows.map((team, index) => (
              <TeamRankingCard
                key={team.team_id || index}
                team={team}
                position={index + 1}
                isOwnTeam={isOwnTeam(team)}
                onPublishChallenge={onPublishChallenge}
                disabled={ctaDisabled}
              />
            ))
          )}
        </>
      ) : (
        <>
          <input
            type="text"
            value={dirQuery}
            onChange={(event) => setDirQuery(event.target.value)}
            placeholder="Buscar equipo por nombre"
            className={filterFieldClass}
          />

          <div className="grid grid-cols-2 gap-2">
            <FormatSelect value={dirFormat} onChange={setDirFormat} />
            <ZoneFilter value={dirZone} onChange={setDirZone} />
          </div>

          {dirLoading ? (
            <div className="rounded-2xl border border-white/15 bg-white/5 p-4 text-center text-white/70 font-oswald">
              Cargando equipos...
            </div>
          ) : dirRows.length === 0 ? (
            <EmptyStateCard
              icon={Users}
              title="No encontramos equipos"
              description="Probá con otro nombre, formato o zona."
              className="my-0 p-5"
            />
          ) : (
            dirRows.map((team, index) => (
              <ChallengeableTeamCard
                key={team.team_id || index}
                team={team}
                isOwnTeam={isOwnTeam(team)}
                onPublishChallenge={onPublishChallenge}
                disabled={ctaDisabled}
              />
            ))
          )}
        </>
      )}
    </div>
  );
};

export default TeamRankingsView;
