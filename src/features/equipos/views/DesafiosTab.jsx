import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ChallengeCard from '../components/ChallengeCard';
import PublishChallengeModal from '../components/PublishChallengeModal';
import AcceptChallengeModal from '../components/AcceptChallengeModal';
import NeighborhoodAutocomplete from '../components/NeighborhoodAutocomplete';
import { TEAM_FORMAT_OPTIONS, TEAM_SKILL_OPTIONS } from '../config';
import {
  acceptChallenge,
  cancelChallenge,
  createChallenge,
  listMyTeams,
  listOpenChallenges,
} from '../../../services/db/teamChallenges';
import { notifyBlockingError } from '../../../utils/notifyBlockingError';
import EmptyStateCard from '../../../components/EmptyStateCard';
import Button from '../../../components/Button';
import { Flag, Search } from 'lucide-react';

const publishActionClass = 'h-12 rounded-xl text-[18px] font-oswald font-semibold tracking-[0.01em] !normal-case';
const filterFieldClass = 'h-12 rounded-lg bg-slate-900/85 border border-white/20 px-3 text-base text-white outline-none focus:border-[#128BE9]';

const DesafiosTab = ({
  userId,
  prefilledTeamId = null,
  onChallengePublished,
  onChallengeAccepted,
}) => {
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [openChallenges, setOpenChallenges] = useState([]);
  const [myTeams, setMyTeams] = useState([]);
  const [filters, setFilters] = useState({ format: '', zone: '', skillLevel: '' });
  const [showFilters, setShowFilters] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [acceptingChallenge, setAcceptingChallenge] = useState(null);
  const [selectedAcceptTeamId, setSelectedAcceptTeamId] = useState('');

  const loadOpenChallenges = useCallback(async () => {
    if (!userId) return;

    try {
      setLoading(true);
      const challenges = await listOpenChallenges(filters);
      setOpenChallenges(challenges);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudieron cargar los desafios');
    } finally {
      setLoading(false);
    }
  }, [filters, userId]);

  const loadMyTeamsData = useCallback(async () => {
    if (!userId) return;

    try {
      const teams = await listMyTeams(userId);
      setMyTeams(teams);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudieron cargar tus equipos');
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    loadMyTeamsData();
  }, [loadMyTeamsData, userId]);

  useEffect(() => {
    if (!userId) return;
    loadOpenChallenges();
  }, [loadOpenChallenges, userId]);

  useEffect(() => {
    if (!prefilledTeamId) return;
    setShowPublishModal(true);
  }, [prefilledTeamId]);

  const visibleChallenges = useMemo(
    () => openChallenges.filter((challenge) => challenge.status === 'open'),
    [openChallenges],
  );

  const activeFiltersCount = useMemo(() => (
    [filters.format, filters.skillLevel, filters.zone]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .length
  ), [filters]);

  const getAvailableTeamsForChallenge = (challenge) => myTeams.filter((team) => (
    team.format === challenge.format &&
    team.id !== challenge.challenger_team_id &&
    team.is_active
  ));

  return (
    <div className="w-full max-w-[560px] flex flex-col gap-3">
      <div className="rounded-2xl border border-white/15 bg-[linear-gradient(135deg,rgba(47,58,113,0.5),rgba(31,40,84,0.42))] p-3">
        <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
          <Button
            type="button"
            onClick={() => setShowPublishModal(true)}
            className={publishActionClass}
          >
            Publicar desafio
          </Button>

          <button
            type="button"
            onClick={() => setShowFilters((prev) => !prev)}
            className="inline-flex h-12 items-center gap-1.5 rounded-xl border border-[#9ED3FF]/35 bg-[#128BE9]/12 px-3 text-[16px] font-oswald text-[#D4EBFF] transition-all hover:bg-[#128BE9]/22"
          >
            <Search size={16} />
            <span>Buscar</span>
            {activeFiltersCount > 0 ? (
              <span className="inline-flex h-5 min-w-[18px] items-center justify-center rounded-full bg-[#128BE9] px-1 text-[11px] leading-none text-white">
                {activeFiltersCount}
              </span>
            ) : null}
          </button>
        </div>

        {showFilters ? (
          <div className="mt-2.5 rounded-xl border border-white/12 bg-[#0f172a8f] p-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <select
                value={filters.format}
                onChange={(event) => setFilters((prev) => ({ ...prev, format: event.target.value }))}
                className={filterFieldClass}
              >
                <option value="">Formato</option>
                {TEAM_FORMAT_OPTIONS.map((value) => <option key={value} value={value}>F{value}</option>)}
              </select>

              <select
                value={filters.skillLevel}
                onChange={(event) => setFilters((prev) => ({ ...prev, skillLevel: event.target.value }))}
                className={filterFieldClass}
              >
                <option value="">Todos los niveles</option>
                {TEAM_SKILL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>

              <NeighborhoodAutocomplete
                value={filters.zone}
                onChange={(nextZone) => setFilters((prev) => ({ ...prev, zone: nextZone }))}
                placeholder="Barrio"
                inputClassName={`${filterFieldClass} w-full disabled:opacity-60 disabled:cursor-not-allowed`}
              />
            </div>

            <div className="mt-2.5 flex justify-end">
              <button
                type="button"
                onClick={() => setFilters({ format: '', zone: '', skillLevel: '' })}
                className="text-[13px] font-oswald text-white/70 transition-all hover:text-white"
                disabled={activeFiltersCount === 0}
              >
                Limpiar filtros
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="rounded-2xl border border-white/15 bg-white/5 p-4 text-center text-white/70">
          Cargando desafios...
        </div>
      ) : null}

      {!loading && visibleChallenges.length === 0 ? (
        <EmptyStateCard
          icon={Flag}
          title="Sin desafíos abiertos"
          description="No encontramos desafíos abiertos con esos filtros."
          className="my-0 p-5"
        />
      ) : null}

      {!loading ? visibleChallenges.map((challenge) => {
        const isOwnChallenge = challenge.created_by_user_id === userId;

        return (
          <ChallengeCard
            key={challenge.id}
            challenge={challenge}
            isOwnChallenge={isOwnChallenge}
            primaryLabel={isOwnChallenge ? 'Cancelar desafio' : 'Aceptar'}
            onPrimaryAction={async () => {
              if (challenge.status !== 'open') return;

              if (isOwnChallenge) {
                const confirmed = window.confirm('Cancelar este desafio?');
                if (!confirmed) return;

                try {
                  setIsSubmitting(true);
                  await cancelChallenge(challenge.id);
                  await loadOpenChallenges();
                } catch (error) {
                  notifyBlockingError(error.message || 'No se pudo cancelar el desafio');
                } finally {
                  setIsSubmitting(false);
                }
                return;
              }

              const available = getAvailableTeamsForChallenge(challenge);
              if (available.length === 0) {
                notifyBlockingError('No tenes equipos compatibles para aceptar este desafio');
                return;
              }

              setAcceptingChallenge(challenge);
              setSelectedAcceptTeamId(available[0].id);
            }}
            canCancel={false}
            disabled={isSubmitting}
          />
        );
      }) : null}

      <PublishChallengeModal
        isOpen={showPublishModal}
        teams={myTeams}
        prefilledTeamId={prefilledTeamId}
        isSubmitting={isSubmitting}
        onClose={() => setShowPublishModal(false)}
        onSubmit={async (payload) => {
          try {
            setIsSubmitting(true);
            await createChallenge(userId, payload);
            setShowPublishModal(false);
            await loadOpenChallenges();
            onChallengePublished?.();
          } catch (error) {
            notifyBlockingError(error.message || 'No se pudo publicar el desafio');
          } finally {
            setIsSubmitting(false);
          }
        }}
      />

      <AcceptChallengeModal
        isOpen={Boolean(acceptingChallenge)}
        challenge={acceptingChallenge}
        availableTeams={acceptingChallenge ? getAvailableTeamsForChallenge(acceptingChallenge) : []}
        selectedTeamId={selectedAcceptTeamId}
        onChangeTeam={setSelectedAcceptTeamId}
        onClose={() => setAcceptingChallenge(null)}
        isSubmitting={isSubmitting}
        onConfirm={async () => {
          if (!acceptingChallenge || !selectedAcceptTeamId) return;

          try {
            setIsSubmitting(true);
            const acceptedTeam = myTeams.find((team) => team.id === selectedAcceptTeamId) || null;
            await acceptChallenge(acceptingChallenge.id, selectedAcceptTeamId, {
              currentUserId: userId,
              acceptedTeamName: acceptedTeam?.name || '',
            });
            setAcceptingChallenge(null);
            await loadOpenChallenges();
            onChallengeAccepted?.();
            console.info('Desafio aceptado. Lo vas a encontrar en Mis desafios.');
          } catch (error) {
            notifyBlockingError(error.message || 'No se pudo aceptar el desafio');
          } finally {
            setIsSubmitting(false);
          }
        }}
      />
    </div>
  );
};

export default DesafiosTab;
