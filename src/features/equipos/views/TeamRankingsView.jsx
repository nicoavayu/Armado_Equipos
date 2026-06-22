import logger from '../../../utils/logger';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, SlidersHorizontal, Trophy, Users } from 'lucide-react';
import Button from '../../../components/Button';
import EmptyStateCard from '../../../components/EmptyStateCard';
import NeighborhoodAutocomplete from '../components/NeighborhoodAutocomplete';
import TeamRankingTable from '../components/TeamRankingTable';
import ChallengeableTeamCard from '../components/ChallengeableTeamCard';
import ChallengeTeamModal from '../components/ChallengeTeamModal';
import { TEAM_FORMAT_OPTIONS } from '../config';
import {
  listCountriesFromRows,
  matchesCountry,
  nextSort,
  sortDirectoryRows,
  sortRankingRows,
} from '../utils/teamRanking';
import {
  getTeamChallengeRankings,
  searchChallengeableTeams,
  TEAM_DIRECTORY_PAGE_SIZE,
  TEAM_RANKING_LIMIT,
} from '../../../services/db/teamRankings';
import {
  createDirectedChallenge,
  listMyPendingChallengedTeamIds,
} from '../../../services/db/teamChallenges';
import { notifyBlockingError } from '../../../utils/notifyBlockingError';

const filterFieldClass = 'h-[44px] w-full rounded-xl bg-[rgba(20,16,41,0.8)] border border-[rgba(148,134,255,0.2)] px-3 text-[15px] text-white outline-none focus:border-[#6a43ff] focus:ring-1 focus:ring-[#6a43ff]/45';

const segmentBase = 'flex-1 min-w-0 rounded-full border border-transparent px-2 py-0 font-bebas text-[0.92rem] tracking-[0.03em] transition-[background-color,color] duration-150';
const segmentActive = 'z-[2] bg-cta-gradient text-white shadow-[0_4px_14px_rgba(106,67,255,0.4),inset_0_1px_0_rgba(255,255,255,0.2)]';
const segmentIdle = 'z-[1] bg-transparent text-white/60 hover:text-white/90 hover:bg-white/[0.06]';

const togglePillBase = 'flex-1 min-w-0 rounded-lg px-3 py-2 font-oswald text-[13px] font-semibold tracking-wide transition-all duration-150 border';
const togglePillActive = 'border-[#7d5aff] bg-[rgba(106,67,255,0.22)] text-white';
const togglePillIdle = 'border-[rgba(148,134,255,0.2)] bg-[rgba(20,16,41,0.8)] text-white/65 hover:text-white';

const DEFAULT_RANKING_SORT = { key: 'played', dir: 'desc' };
const TEAM_DIRECTORY_MAX_FETCH = 100;

const normalizeDirectoryTeam = (team) => ({
  team_id: team?.team_id || team?.id || null,
  team_name: team?.team_name || team?.name || 'Equipo',
  avatar_url: team?.avatar_url || team?.crest_url || null,
  format: team?.format ?? null,
  zone: team?.zone || team?.base_zone || null,
  country_code: team?.country_code || null,
  skill_level: team?.skill_level || null,
  color_primary: team?.color_primary || null,
  color_secondary: team?.color_secondary || null,
  color_accent: team?.color_accent || null,
  played_count: Number(team?.played_count) || 0,
  wins: Number(team?.wins) || 0,
  draws: Number(team?.draws) || 0,
  losses: Number(team?.losses) || 0,
  win_rate: Number(team?.win_rate) || 0,
  last_played_at: team?.last_played_at || null,
});

const matchesDirectoryRpcFilters = (team, { query, format, zone }) => {
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase('es');
  const normalizedFormat = String(format || '').replace(/\D/g, '');
  const normalizedZone = String(zone || '').trim().toLocaleLowerCase('es');
  const teamName = String(team?.team_name || '').toLocaleLowerCase('es');
  const teamFormat = String(team?.format || '').replace(/\D/g, '');
  const teamZone = String(team?.zone || '').toLocaleLowerCase('es');

  return (!normalizedQuery || teamName.includes(normalizedQuery))
    && (!normalizedFormat || teamFormat === normalizedFormat)
    && (!normalizedZone || teamZone.includes(normalizedZone));
};

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

// País se filtra client-side (igual que el sort), sobre las filas que ya trajo
// el RPC. Las opciones se arman con los países REALMENTE presentes en los datos.
const CountrySelect = ({ value, onChange, countries }) => (
  <select value={value} onChange={(event) => onChange(event.target.value)} className={filterFieldClass}>
    <option value="">Todos los países</option>
    {countries.map((country) => (
      <option key={country.code} value={country.code}>
        {`${country.flag ? `${country.flag} ` : ''}${country.name}`}
      </option>
    ))}
  </select>
);

const TeamRankingsView = ({
  userId,
  ownTeamIds = null,
  myTeams = [],
}) => {
  const [activeTab, setActiveTab] = useState('ranking');

  // Ranking tab state
  const [rankingSort, setRankingSort] = useState(DEFAULT_RANKING_SORT);
  const [rankingPeriod, setRankingPeriod] = useState('all');
  const [rankingFormat, setRankingFormat] = useState('');
  const [rankingZone, setRankingZone] = useState('');
  const [rankingCountry, setRankingCountry] = useState('');
  const [rankingRows, setRankingRows] = useState([]);
  const [rankingLoading, setRankingLoading] = useState(true);
  const [rankingFiltersOpen, setRankingFiltersOpen] = useState(false);
  const rankingActiveFilters = (rankingZone ? 1 : 0)
    + (rankingPeriod !== 'all' ? 1 : 0)
    + (rankingCountry ? 1 : 0);

  // Equipos (directory) tab state
  const [dirQuery, setDirQuery] = useState('');
  const [dirFormat, setDirFormat] = useState('');
  const [dirZone, setDirZone] = useState('');
  const [dirCountry, setDirCountry] = useState('');
  const [dirRows, setDirRows] = useState([]);
  const [dirLoading, setDirLoading] = useState(true);
  const [dirLoadingMore, setDirLoadingMore] = useState(false);
  const [dirPage, setDirPage] = useState(1);

  // Directed challenge state
  const [challengeTarget, setChallengeTarget] = useState(null);
  const [challengeSubmitting, setChallengeSubmitting] = useState(false);
  const [challengeError, setChallengeError] = useState('');
  const [pendingChallengedTeamIds, setPendingChallengedTeamIds] = useState(() => new Set());
  const [successMessage, setSuccessMessage] = useState('');

  const ownIdSet = useMemo(() => {
    const ids = ownTeamIds instanceof Set ? Array.from(ownTeamIds) : (ownTeamIds || []);
    return new Set([
      ...ids,
      ...(myTeams || []).map((team) => team?.id || team?.team_id),
    ].map((id) => String(id)).filter(Boolean));
  }, [myTeams, ownTeamIds]);

  const isOwnTeam = useCallback(
    (team) => ownIdSet.has(String(team?.team_id || '')),
    [ownIdSet],
  );

  // Puedo desafiar si manejo al menos un equipo (capitán/owner). El modal filtra
  // por formato y avisa si no tengo ninguno del formato del rival.
  const canChallenge = (myTeams || []).length > 0;

  const handleSort = useCallback((key) => {
    setRankingSort((current) => nextSort(current, key));
  }, []);

  const refreshPending = useCallback(async () => {
    if (!userId) return;
    try {
      const ids = await listMyPendingChallengedTeamIds(userId);
      setPendingChallengedTeamIds(new Set((ids || []).map((id) => String(id))));
    } catch (error) {
      logger.warn('[RANKING] No se pudieron cargar desafíos pendientes', error);
    }
  }, [userId]);

  useEffect(() => {
    refreshPending();
  }, [refreshPending]);

  const sortedRankingRows = useMemo(
    () => sortRankingRows(rankingRows, rankingSort.key, rankingSort.dir).slice(0, TEAM_RANKING_LIMIT),
    [rankingRows, rankingSort],
  );

  const rankingCountries = useMemo(() => listCountriesFromRows(rankingRows), [rankingRows]);

  const normalizedMyTeams = useMemo(
    () => (myTeams || []).map(normalizeDirectoryTeam).filter((team) => team.team_id),
    [myTeams],
  );

  const dirCountries = useMemo(
    () => listCountriesFromRows([...dirRows, ...normalizedMyTeams]),
    [dirRows, normalizedMyTeams],
  );

  const visibleRankingRows = useMemo(
    () => sortedRankingRows.filter((row) => matchesCountry(row, rankingCountry)),
    [sortedRankingRows, rankingCountry],
  );

  const directoryGeneralLimit = dirPage * TEAM_DIRECTORY_PAGE_SIZE;

  // MIS equipos siempre se construyen desde myTeams y se enriquecen con la fila
  // del directorio cuando está disponible. El Map evita duplicarlos en la lista
  // general. La búsqueda/formato/zona conservan exactamente la semántica del RPC;
  // país sigue siendo el mismo filtro client-side que ya existía.
  const directoryData = useMemo(() => {
    const ownById = new Map();
    normalizedMyTeams.forEach((team) => ownById.set(String(team.team_id), team));
    dirRows.forEach((team) => {
      if (isOwnTeam(team)) ownById.set(String(team.team_id), team);
    });

    const ownRows = sortDirectoryRows(
      Array.from(ownById.values()).filter((team) => (
        matchesDirectoryRpcFilters(team, { query: dirQuery, format: dirFormat, zone: dirZone })
        && matchesCountry(team, dirCountry)
      )),
      isOwnTeam,
    );

    const allGeneralRows = dirRows.filter((team) => !isOwnTeam(team));
    const visibleGeneralRows = sortDirectoryRows(
      allGeneralRows.filter((team) => matchesCountry(team, dirCountry)),
      isOwnTeam,
    ).slice(0, directoryGeneralLimit);

    return {
      rows: [...ownRows, ...visibleGeneralRows],
      hasMore: allGeneralRows.length > directoryGeneralLimit,
    };
  }, [
    dirCountry,
    dirFormat,
    directoryGeneralLimit,
    dirQuery,
    dirRows,
    dirZone,
    isOwnTeam,
    normalizedMyTeams,
  ]);

  const visibleDirRows = directoryData.rows;
  const dirHasMore = directoryData.hasMore;

  const loadRanking = useCallback(async () => {
    if (!userId) return;
    try {
      setRankingLoading(true);
      const rows = await getTeamChallengeRankings({
        format: rankingFormat,
        zone: rankingZone,
        period: rankingPeriod,
        limit: TEAM_RANKING_LIMIT,
      });
      setRankingRows(rows || []);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo cargar el ranking');
    } finally {
      setRankingLoading(false);
    }
  }, [rankingFormat, rankingZone, rankingPeriod, userId]);

  const loadDirectory = useCallback(async () => {
    if (!userId) return;
    const loadingMore = dirPage > 1;
    try {
      if (loadingMore) setDirLoadingMore(true);
      else setDirLoading(true);
      const requestedLimit = Math.min(
        (dirPage * TEAM_DIRECTORY_PAGE_SIZE) + ownIdSet.size + 1,
        TEAM_DIRECTORY_MAX_FETCH,
      );
      const rows = await searchChallengeableTeams({
        query: dirQuery,
        format: dirFormat,
        zone: dirZone,
        limit: requestedLimit,
      });
      setDirRows(rows || []);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo cargar el directorio');
    } finally {
      if (loadingMore) setDirLoadingMore(false);
      else setDirLoading(false);
    }
  }, [dirFormat, dirPage, dirQuery, dirZone, ownIdSet.size, userId]);

  const resetDirectoryPage = useCallback(() => {
    setDirPage(1);
    setDirLoadingMore(false);
  }, []);

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

  // Reset the country filter if the selected country is no longer present.
  useEffect(() => {
    if (rankingCountry && !rankingCountries.some((c) => c.code === rankingCountry)) {
      setRankingCountry('');
    }
  }, [rankingCountries, rankingCountry]);

  useEffect(() => {
    if (dirCountry && !dirCountries.some((c) => c.code === dirCountry)) {
      setDirCountry('');
    }
  }, [dirCountries, dirCountry]);

  useEffect(() => {
    if (!successMessage) return undefined;
    const timeoutId = window.setTimeout(() => setSuccessMessage(''), 3600);
    return () => window.clearTimeout(timeoutId);
  }, [successMessage]);

  const openChallengeModal = useCallback((team) => {
    setChallengeError('');
    setChallengeTarget(team);
  }, []);

  const closeChallengeModal = useCallback(() => {
    if (challengeSubmitting) return;
    setChallengeTarget(null);
    setChallengeError('');
  }, [challengeSubmitting]);

  const handleChallengeSubmit = useCallback(async (payload) => {
    setChallengeSubmitting(true);
    setChallengeError('');
    try {
      await createDirectedChallenge(payload);
      const rivalName = challengeTarget?.team_name || 'el equipo rival';
      if (payload?.challengedTeamId) {
        setPendingChallengedTeamIds((prev) => {
          const next = new Set(prev);
          next.add(String(payload.challengedTeamId));
          return next;
        });
      }
      setChallengeTarget(null);
      setSuccessMessage(`Desafío enviado a ${rivalName}.`);
      refreshPending();
    } catch (error) {
      setChallengeError(error.message || 'No se pudo enviar el desafío');
    } finally {
      setChallengeSubmitting(false);
    }
  }, [challengeTarget, refreshPending]);

  return (
    <div className="w-full max-w-[560px] flex flex-col gap-3">
      <SegmentedTabs
        tabs={[{ key: 'ranking', label: 'RANKING' }, { key: 'equipos', label: 'EQUIPOS' }]}
        value={activeTab}
        onChange={setActiveTab}
      />

      {successMessage ? (
        <div className="flex items-center gap-2 rounded-xl border border-[#5cf2a6]/35 bg-[#5cf2a6]/10 px-3 py-2.5 font-oswald text-[13px] text-[#baf7d8]">
          <Check size={15} className="shrink-0" />
          <span>{successMessage}</span>
        </div>
      ) : null}

      {activeTab === 'ranking' ? (
        <>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <FormatSelect value={rankingFormat} onChange={setRankingFormat} />
            </div>
            <button
              type="button"
              onClick={() => setRankingFiltersOpen((open) => !open)}
              aria-expanded={rankingFiltersOpen}
              className={`relative h-[44px] shrink-0 inline-flex items-center gap-1.5 rounded-xl border px-3.5 font-oswald text-[14px] font-semibold tracking-wide transition-all duration-150 ${
                rankingFiltersOpen || rankingActiveFilters > 0
                  ? 'border-[#7d5aff] bg-[rgba(106,67,255,0.22)] text-white'
                  : 'border-[rgba(148,134,255,0.2)] bg-[rgba(20,16,41,0.8)] text-white/65 hover:text-white'
              }`}
            >
              <SlidersHorizontal size={15} />
              Filtros
              {rankingActiveFilters > 0 ? (
                <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#ec007d] px-1 text-[10px] font-bold text-white shadow-[0_0_10px_rgba(236,0,125,0.45)]">
                  {rankingActiveFilters}
                </span>
              ) : null}
            </button>
          </div>

          {rankingFiltersOpen ? (
            <div className="flex flex-col gap-2.5 rounded-xl border border-[rgba(148,134,255,0.2)] bg-[rgba(20,16,41,0.6)] p-3">
              <div className="flex flex-col gap-1.5">
                <span className="font-oswald text-[11px] uppercase tracking-wider text-white/45">País</span>
                <CountrySelect value={rankingCountry} onChange={setRankingCountry} countries={rankingCountries} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="font-oswald text-[11px] uppercase tracking-wider text-white/45">Zona / barrio</span>
                <ZoneFilter value={rankingZone} onChange={setRankingZone} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="font-oswald text-[11px] uppercase tracking-wider text-white/45">Período</span>
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
              </div>
            </div>
          ) : null}

          {rankingLoading ? (
            <div className="rounded-2xl border border-white/15 bg-white/5 p-4 text-center text-white/70 font-oswald">
              Cargando ranking...
            </div>
          ) : visibleRankingRows.length === 0 ? (
            <EmptyStateCard
              icon={Trophy}
              title="No hay partidos confirmados todavía"
              description="Cuando los equipos jueguen desafíos, van a aparecer acá."
              className="my-0 p-5"
            />
          ) : (
            // Edge-to-edge only for the ranking table: pull it out of the page's
            // px-4 gutter on phones (leaving a hair of safe margin), then snap
            // back to the centered max-w container at >=560px so it never
            // overflows on tablets/desktop.
            <div className="-mx-3 min-[560px]:mx-0">
              <TeamRankingTable
                rows={visibleRankingRows}
                sort={rankingSort}
                onSort={handleSort}
                isOwnTeam={isOwnTeam}
              />
            </div>
          )}
        </>
      ) : (
        <>
          <input
            type="text"
            value={dirQuery}
            onChange={(event) => {
              resetDirectoryPage();
              setDirQuery(event.target.value);
            }}
            placeholder="Buscar equipo por nombre"
            className={filterFieldClass}
          />

          <div className="grid grid-cols-2 gap-2">
            <FormatSelect
              value={dirFormat}
              onChange={(value) => {
                resetDirectoryPage();
                setDirFormat(value);
              }}
            />
            <ZoneFilter
              value={dirZone}
              onChange={(value) => {
                resetDirectoryPage();
                setDirZone(value);
              }}
            />
          </div>
          <CountrySelect
            value={dirCountry}
            onChange={(value) => {
              resetDirectoryPage();
              setDirCountry(value);
            }}
            countries={dirCountries}
          />

          {dirLoading ? (
            <div className="rounded-2xl border border-white/15 bg-white/5 p-4 text-center text-white/70 font-oswald">
              Cargando equipos...
            </div>
          ) : visibleDirRows.length === 0 ? (
            <EmptyStateCard
              icon={Users}
              title="No encontramos equipos"
              description="Probá con otro nombre, formato, zona o país."
              className="my-0 p-5"
            />
          ) : (
            <>
              {visibleDirRows.map((team, index) => {
                const own = isOwnTeam(team);
                return (
                  <ChallengeableTeamCard
                    key={team.team_id || index}
                    team={team}
                    isOwnTeam={own}
                    isPendingChallenge={!own && pendingChallengedTeamIds.has(String(team.team_id))}
                    canChallenge={canChallenge}
                    onChallenge={openChallengeModal}
                  />
                );
              })}
              {dirHasMore || dirLoadingMore ? (
                <Button
                  type="button"
                  variant="secondary"
                  loading={dirLoadingMore}
                  loadingText="Cargando..."
                  onClick={() => {
                    setDirLoadingMore(true);
                    setDirPage((page) => page + 1);
                  }}
                >
                  Cargar más
                </Button>
              ) : null}
            </>
          )}
        </>
      )}

      <ChallengeTeamModal
        isOpen={Boolean(challengeTarget)}
        challengedTeam={challengeTarget}
        myTeams={myTeams}
        isSubmitting={challengeSubmitting}
        errorMessage={challengeError}
        onClose={closeChallengeModal}
        onSubmit={handleChallengeSubmit}
      />
    </div>
  );
};

export default TeamRankingsView;
