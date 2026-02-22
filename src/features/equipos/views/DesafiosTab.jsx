import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ChallengeCard from '../components/ChallengeCard';
import PublishChallengeModal from '../components/PublishChallengeModal';
import AcceptChallengeModal from '../components/AcceptChallengeModal';
import CompleteChallengeModal from '../components/CompleteChallengeModal';
import NeighborhoodAutocomplete from '../components/NeighborhoodAutocomplete';
import { TEAM_FORMAT_OPTIONS, TEAM_SKILL_OPTIONS, normalizeTeamSkillLevel } from '../config';
import {
  acceptChallenge,
  cancelChallenge,
  completeChallenge,
  createChallenge,
  getTeamMatchByChallengeId,
  listMyChallenges,
  listMyTeams,
  listOpenChallenges,
} from '../../../services/db/teamChallenges';
import { notifyBlockingError } from '../../../utils/notifyBlockingError';
import EmptyStateCard from '../../../components/EmptyStateCard';
import Button from '../../../components/Button';
import { Flag, Search } from 'lucide-react';

const publishActionClass = 'h-12 rounded-xl text-[18px] font-oswald font-semibold tracking-[0.01em] !normal-case';
const filterFieldClass = 'h-12 rounded-lg bg-slate-900/85 border border-white/20 px-3 text-base text-white outline-none focus:border-[#128BE9]';

const formatMoneyAr = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
};

const buildShareText = (challenge) => {
  const teamA = challenge?.challenger_team?.name || 'Equipo A';
  const teamB = challenge?.accepted_team?.name || 'Busco rival';
  const when = challenge?.scheduled_at ? new Date(challenge.scheduled_at).toLocaleString('es-AR') : 'A coordinar';
  const where = challenge?.location || challenge?.location_name || 'A coordinar';
  const fieldPrice = formatMoneyAr(challenge?.cancha_cost ?? challenge?.field_price);
  const canchaText = fieldPrice ? `Cancha ${fieldPrice}` : 'Cancha: a coordinar';

  return [teamA + ' vs ' + teamB, `F${challenge?.format || '-'}`, when, where, canchaText]
    .filter(Boolean)
    .join(' | ');
};

const challengeMatchesFilters = (challenge, filters) => {
  if (filters.format && Number(challenge?.format) !== Number(filters.format)) return false;

  if (filters.skillLevel) {
    const challengeSkill = normalizeTeamSkillLevel(challenge?.skill_level);
    const filterSkill = normalizeTeamSkillLevel(filters.skillLevel);
    if (challengeSkill !== filterSkill) return false;
  }

  const zoneFilter = String(filters.zone || '').trim().toLowerCase();
  if (!zoneFilter) return true;

  const possibleZones = [
    challenge?.challenger_team?.base_zone,
    challenge?.accepted_team?.base_zone,
    challenge?.location,
    challenge?.location_name,
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);

  return possibleZones.some((value) => value.includes(zoneFilter));
};

const DesafiosTab = ({
  userId,
  prefilledTeamId = null,
  onChallengePublished,
}) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [openChallenges, setOpenChallenges] = useState([]);
  const [myChallenges, setMyChallenges] = useState([]);
  const [myTeams, setMyTeams] = useState([]);
  const [filters, setFilters] = useState({ format: '', zone: '', skillLevel: '' });
  const [showFilters, setShowFilters] = useState(false);
  const [scope, setScope] = useState('all');
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [acceptingChallenge, setAcceptingChallenge] = useState(null);
  const [selectedAcceptTeamId, setSelectedAcceptTeamId] = useState('');
  const [completeTarget, setCompleteTarget] = useState(null);

  const loadChallenges = useCallback(async () => {
    if (!userId) return;

    try {
      setLoading(true);
      const [openRows, myRows] = await Promise.all([
        listOpenChallenges(filters),
        listMyChallenges(userId),
      ]);
      setOpenChallenges(openRows || []);
      setMyChallenges(myRows || []);
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
    loadChallenges();
  }, [loadChallenges, userId]);

  useEffect(() => {
    if (!prefilledTeamId) return;
    setShowPublishModal(true);
  }, [prefilledTeamId]);

  const visibleChallenges = useMemo(
    () => (scope === 'mine'
      ? myChallenges.filter((challenge) => challengeMatchesFilters(challenge, filters))
      : openChallenges.filter((challenge) => challenge.status === 'open')),
    [filters, myChallenges, openChallenges, scope],
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

  const handleShare = async (challenge) => {
    try {
      const text = buildShareText(challenge);

      if (navigator.share) {
        await navigator.share({
          title: 'Desafio Arma2',
          text,
        });
        return;
      }

      await navigator.clipboard.writeText(text);
      notifyBlockingError('Texto del desafio copiado al portapapeles');
    } catch (error) {
      if (error?.name === 'AbortError') return;
      notifyBlockingError('No se pudo compartir el desafio');
    }
  };

  const canManage = (challenge) => challenge.created_by_user_id === userId || challenge.accepted_by_user_id === userId;

  const openChallengeMatch = useCallback(async (challenge) => {
    if (!challenge?.id) return;

    try {
      const match = await getTeamMatchByChallengeId(challenge.id);
      if (!match?.id) {
        notifyBlockingError('Todavia no existe un partido asociado a este desafio');
        return;
      }
      navigate(`/quiero-jugar/equipos/partidos/${match.id}`);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo abrir el partido del desafio');
    }
  }, [navigate]);

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

        <div className="mt-2.5">
          <div className="inline-flex rounded-lg border border-white/15 bg-white/5 p-1">
            <button
              type="button"
              onClick={() => setScope('all')}
              className={`rounded-md px-3 py-1.5 text-[13px] font-oswald font-semibold transition-all ${scope === 'all'
                ? 'border border-white/25 bg-white/12 text-white'
                : 'border border-transparent text-white/65 hover:text-white/85'
                }`}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => setScope('mine')}
              className={`rounded-md px-3 py-1.5 text-[13px] font-oswald font-semibold transition-all ${scope === 'mine'
                ? 'border border-white/25 bg-white/12 text-white'
                : 'border border-transparent text-white/65 hover:text-white/85'
                }`}
            >
              Mios
            </button>
          </div>
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
          title={scope === 'mine' ? 'Sin desafíos tuyos' : 'Sin desafíos abiertos'}
          description={scope === 'mine'
            ? 'No encontramos desafios tuyos con esos filtros.'
            : 'No encontramos desafíos abiertos con esos filtros.'}
          className="my-0 p-5"
        />
      ) : null}

      {!loading ? visibleChallenges.map((challenge) => {
        const isOwnChallenge = challenge.created_by_user_id === userId;
        const allowManage = canManage(challenge);

        if (scope === 'mine') {
          let primaryLabel = 'Ver detalle';
          let primaryAction = () => handleShare(challenge);

          if (challenge.status === 'open') {
            primaryLabel = 'Compartir';
            primaryAction = () => handleShare(challenge);
          } else if (challenge.status === 'accepted') {
            primaryLabel = 'Ver partido';
            primaryAction = () => openChallengeMatch(challenge);
          } else if (challenge.status === 'confirmed') {
            primaryLabel = allowManage ? 'Finalizar' : 'Ver detalle';
            primaryAction = allowManage
              ? () => setCompleteTarget(challenge)
              : () => handleShare(challenge);
          } else if (challenge.status === 'completed') {
            primaryLabel = 'Compartir';
            primaryAction = () => handleShare(challenge);
          }

          return (
            <ChallengeCard
              key={challenge.id}
              challenge={challenge}
              isOwnChallenge={isOwnChallenge}
              primaryLabel={primaryLabel}
              onPrimaryAction={primaryAction}
              onCancel={async () => {
                if (!allowManage) return;

                try {
                  setIsSubmitting(true);
                  await cancelChallenge(challenge.id);
                  await loadChallenges();
                } catch (error) {
                  notifyBlockingError(error.message || 'No se pudo cancelar el desafio');
                } finally {
                  setIsSubmitting(false);
                }
              }}
              canCancel={allowManage && challenge.status === 'open'}
              disabled={isSubmitting}
            />
          );
        }

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
                  await loadChallenges();
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
            await loadChallenges();
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
            const result = await acceptChallenge(acceptingChallenge.id, selectedAcceptTeamId, {
              currentUserId: userId,
              acceptedTeamName: acceptedTeam?.name || '',
            });
            setAcceptingChallenge(null);
            await loadChallenges();
            if (result?.matchId) {
              navigate(`/quiero-jugar/equipos/partidos/${result.matchId}`);
            }
            console.info('Desafio aceptado');
          } catch (error) {
            notifyBlockingError(error.message || 'No se pudo aceptar el desafio');
          } finally {
            setIsSubmitting(false);
          }
        }}
      />

      <CompleteChallengeModal
        isOpen={Boolean(completeTarget)}
        challenge={completeTarget}
        onClose={() => setCompleteTarget(null)}
        isSubmitting={isSubmitting}
        onSubmit={async ({ challengeId, scoreA, scoreB, playedAt }) => {
          try {
            setIsSubmitting(true);
            await completeChallenge({ challengeId, scoreA, scoreB, playedAt });
            setCompleteTarget(null);
            await loadChallenges();
          } catch (error) {
            notifyBlockingError(error.message || 'No se pudo finalizar el desafio');
          } finally {
            setIsSubmitting(false);
          }
        }}
      />
    </div>
  );
};

export default DesafiosTab;
