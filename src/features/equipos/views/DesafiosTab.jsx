import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ChallengeCard from '../components/ChallengeCard';
import PublishChallengeModal from '../components/PublishChallengeModal';
import AcceptChallengeModal from '../components/AcceptChallengeModal';
import CompleteChallengeModal from '../components/CompleteChallengeModal';
import NeighborhoodAutocomplete from '../components/NeighborhoodAutocomplete';
import Modal from '../../../components/Modal';
import InlineNotice from '../../../components/ui/InlineNotice';
import { TEAM_FORMAT_OPTIONS, TEAM_SKILL_OPTIONS } from '../config';
import {
  acceptChallenge,
  cancelChallenge,
  completeChallenge,
  createChallenge,
  listMyManageableTeams,
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

const DesafiosTab = ({
  userId,
  prefilledTeamId = null,
  onChallengePublished,
}) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [openChallenges, setOpenChallenges] = useState([]);
  const [myTeams, setMyTeams] = useState([]);
  const [manageableTeams, setManageableTeams] = useState([]);
  const [filters, setFilters] = useState({ format: '', zone: '', skillLevel: '' });
  const [showFilters, setShowFilters] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [acceptingChallenge, setAcceptingChallenge] = useState(null);
  const [selectedAcceptTeamId, setSelectedAcceptTeamId] = useState('');
  const [formatMismatchConfirm, setFormatMismatchConfirm] = useState(null);
  const [completeTarget, setCompleteTarget] = useState(null);
  const [inlineNotice, setInlineNotice] = useState({ type: '', message: '' });

  const loadChallenges = useCallback(async () => {
    if (!userId) return;

    try {
      setLoading(true);
      const openRows = await listOpenChallenges(filters);
      setOpenChallenges(openRows || []);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudieron cargar los desafios');
    } finally {
      setLoading(false);
    }
  }, [filters, userId]);

  const loadMyTeamsData = useCallback(async () => {
    if (!userId) return;

    try {
      const [ownedTeams, manageable] = await Promise.all([
        listMyTeams(userId),
        listMyManageableTeams(userId),
      ]);
      setMyTeams(ownedTeams || []);
      setManageableTeams(manageable || []);
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
    () => openChallenges.filter((challenge) => challenge.status === 'open'),
    [openChallenges],
  );

  const activeFiltersCount = useMemo(() => (
    [filters.format, filters.skillLevel, filters.zone]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .length
  ), [filters]);

  const getAvailableTeamsForChallenge = (challenge) => manageableTeams.filter((team) => (
    team.id !== challenge.challenger_team_id &&
    team.is_active
  ));

  const closeAcceptChallengeModal = useCallback(() => {
    setAcceptingChallenge(null);
    setSelectedAcceptTeamId('');
    setFormatMismatchConfirm(null);
  }, []);

  const notifyAcceptedChallengeSuccess = useCallback(() => {
    setInlineNotice({
      type: 'success',
      message: 'Desafio aceptado. Ya podes verlo en Mis partidos.',
    });
  }, []);

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

  return (
    <div className="w-full max-w-[560px] flex flex-col gap-3">
      <InlineNotice
        type={inlineNotice.type}
        message={inlineNotice.message}
        autoHideMs={3200}
        onClose={() => setInlineNotice({ type: '', message: '' })}
      />

      <div className="rounded-2xl border border-[#2f73b8]/35 bg-[#08162f]/80 p-2.5">
        <div className="w-full flex items-center gap-3">
          <Button
            type="button"
            onClick={() => setShowPublishModal(true)}
            className="flex-1 !h-14 !rounded-xl !bg-[#128BE9] !text-white !font-oswald !text-[18px] !font-semibold !tracking-[0.01em] !normal-case !whitespace-nowrap shadow-[0_4px_14px_rgba(18,139,233,0.3)] hover:brightness-110 active:scale-95 transition-all"
          >
            Publicar desafio
          </Button>

          <button
            type="button"
            onClick={() => setShowFilters((prev) => !prev)}
            className={`flex-1 h-14 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-800 font-oswald text-[18px] font-semibold tracking-[0.01em] border transition-all active:scale-95 ${showFilters
              ? 'text-white border-[#2f73b8] shadow-[0_0_0_1px_rgba(47,115,184,0.45)]'
              : 'text-[#9fd7ff] border-[#2f73b8]/70 hover:bg-slate-700'
              }`}
          >
            <Search size={20} />
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
                notifyBlockingError('No tenes equipos gestionables (owner/admin) para aceptar este desafio');
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
        onClose={closeAcceptChallengeModal}
        isSubmitting={isSubmitting}
        onConfirm={async () => {
          if (!acceptingChallenge || !selectedAcceptTeamId) return;

          const acceptedTeam = manageableTeams.find((team) => team.id === selectedAcceptTeamId) || null;
          const challengeFormat = Number(acceptingChallenge?.format);
          const acceptedTeamFormat = Number(acceptedTeam?.format);
          const hasFormatMismatch = Number.isFinite(challengeFormat)
            && Number.isFinite(acceptedTeamFormat)
            && challengeFormat !== acceptedTeamFormat;

          if (hasFormatMismatch) {
            setFormatMismatchConfirm({
              challengeId: acceptingChallenge.id,
              challengeFormat,
              acceptedTeamId: selectedAcceptTeamId,
              acceptedTeamName: acceptedTeam?.name || 'Equipo rival',
              acceptedTeamFormat,
            });
            return;
          }

          try {
            setIsSubmitting(true);
            const result = await acceptChallenge(acceptingChallenge.id, selectedAcceptTeamId, {
              currentUserId: userId,
              acceptedTeamName: acceptedTeam?.name || '',
            });
            closeAcceptChallengeModal();
            await loadChallenges();
            if (result?.matchId) {
              navigate(`/quiero-jugar/equipos/partidos/${result.matchId}`);
            }
            notifyAcceptedChallengeSuccess();
          } catch (error) {
            notifyBlockingError(error.message || 'No se pudo aceptar el desafio');
          } finally {
            setIsSubmitting(false);
          }
        }}
      />

      <Modal
        isOpen={Boolean(formatMismatchConfirm)}
        onClose={() => setFormatMismatchConfirm(null)}
        title="Formato combinado"
        className="w-full max-w-[520px]"
        classNameContent="p-4 sm:p-5"
        footer={(
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="secondary"
              className={publishActionClass}
              onClick={() => setFormatMismatchConfirm(null)}
              disabled={isSubmitting}
            >
              Volver
            </Button>
            <Button
              type="button"
              className={publishActionClass}
              loading={isSubmitting}
              loadingText="Aceptando..."
              onClick={async () => {
                if (!formatMismatchConfirm) return;
                try {
                  setIsSubmitting(true);
                  const acceptedTeam = manageableTeams.find(
                    (team) => team.id === formatMismatchConfirm.acceptedTeamId,
                  ) || null;

                  const result = await acceptChallenge(
                    formatMismatchConfirm.challengeId,
                    formatMismatchConfirm.acceptedTeamId,
                    {
                      currentUserId: userId,
                      acceptedTeamName: acceptedTeam?.name || formatMismatchConfirm.acceptedTeamName,
                    },
                  );

                  setFormatMismatchConfirm(null);
                  closeAcceptChallengeModal();
                  await loadChallenges();
                  if (result?.matchId) {
                    navigate(`/quiero-jugar/equipos/partidos/${result.matchId}`);
                  }
                  notifyAcceptedChallengeSuccess();
                } catch (error) {
                  notifyBlockingError(error.message || 'No se pudo aceptar el desafio');
                } finally {
                  setIsSubmitting(false);
                }
              }}
            >
              Si, aceptar
            </Button>
          </div>
        )}
      >
        <p className="text-sm text-white/75">
          Este desafio es F{formatMismatchConfirm?.challengeFormat ?? '-'} y el equipo{' '}
          <strong>{formatMismatchConfirm?.acceptedTeamName || 'seleccionado'}</strong> es F
          {formatMismatchConfirm?.acceptedTeamFormat ?? '-'}.
        </p>
        <p className="mt-2 text-sm text-white/75">
          Si continuas, se creara un partido con <strong>formato combinado</strong>.
        </p>
      </Modal>

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
