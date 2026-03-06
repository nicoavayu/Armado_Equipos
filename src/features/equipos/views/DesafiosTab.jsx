import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ChallengeCard from '../components/ChallengeCard';
import PublishChallengeModal from '../components/PublishChallengeModal';
import AcceptChallengeModal from '../components/AcceptChallengeModal';
import CompleteChallengeModal from '../components/CompleteChallengeModal';
import NeighborhoodAutocomplete from '../components/NeighborhoodAutocomplete';
import Modal from '../../../components/Modal';
import ConfirmModal from '../../../components/ConfirmModal';
import InlineNotice from '../../../components/ui/InlineNotice';
import { TEAM_FORMAT_OPTIONS, TEAM_SKILL_OPTIONS } from '../config';
import {
  acceptChallenge,
  cancelChallenge,
  completeChallenge,
  createChallenge,
  getTeamMatchByChallengeId,
  listMyManageableTeams,
  listOpenChallenges,
  updateChallenge,
} from '../../../services/db/teamChallenges';
import { notifyBlockingError } from '../../../utils/notifyBlockingError';
import EmptyStateCard from '../../../components/EmptyStateCard';
import Button from '../../../components/Button';
import { Flag, Search } from 'lucide-react';

const publishActionBaseClass = '!w-full !h-auto !min-h-[44px] !px-4 !py-2.5 !rounded-none !font-bebas !text-base !tracking-[0.01em] !normal-case sm:!text-[13px] sm:!px-3 sm:!py-2 sm:!min-h-[36px]';
const publishActionPrimaryClass = `${publishActionBaseClass} !border !border-[#7d5aff] !bg-[#6a43ff] !text-white !shadow-[0_0_14px_rgba(106,67,255,0.3)] hover:!bg-[#7550ff]`;
const challengeConfirmModalClass = 'w-full max-w-[520px] !rounded-none !border !border-[rgba(88,107,170,0.52)] !bg-[rgba(8,18,44,0.96)] !shadow-[0_26px_58px_rgba(0,0,0,0.62)]';
const challengeConfirmModalContentClass = 'p-4 sm:p-5 !font-oswald';
const primaryCtaClass = 'flex-1 min-h-[44px] px-4 py-2.5 rounded-none border border-[#7d5aff] bg-[#6a43ff] text-white font-bebas text-base tracking-[0.01em] flex items-center justify-center text-center gap-2 transition-all hover:bg-[#7550ff] active:opacity-95 shadow-[0_0_14px_rgba(106,67,255,0.3)] sm:text-[13px] sm:px-3 sm:py-2 sm:min-h-[36px]';
const secondaryCtaClass = 'flex-1 min-h-[44px] px-4 py-2.5 rounded-none border font-bebas text-base tracking-[0.01em] flex items-center justify-center text-center gap-2 transition-all active:opacity-95 sm:text-[13px] sm:px-3 sm:py-2 sm:min-h-[36px]';
const filterFieldClass = 'h-[44px] rounded-none bg-[rgba(15,24,56,0.72)] border border-[rgba(88,107,170,0.46)] px-3 text-[15px] text-white outline-none focus:border-[#6a43ff] focus:ring-1 focus:ring-[#6a43ff]/45';

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

  return [teamA + ' vs ' + teamB, `F${challenge?.format || '-'}`, when, where, fieldPrice ? `Cancha ${fieldPrice}` : null]
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
  const [manageableTeams, setManageableTeams] = useState([]);
  const [filters, setFilters] = useState({ format: '', zone: '', skillLevel: '' });
  const [showFilters, setShowFilters] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [editingChallenge, setEditingChallenge] = useState(null);
  const [acceptingChallenge, setAcceptingChallenge] = useState(null);
  const [selectedAcceptTeamId, setSelectedAcceptTeamId] = useState('');
  const [cancelConfirmChallenge, setCancelConfirmChallenge] = useState(null);
  const [completeTarget, setCompleteTarget] = useState(null);
  const [inlineNotice, setInlineNotice] = useState({ type: '', message: '' });
  const [acceptBlockedMessage, setAcceptBlockedMessage] = useState('');

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
      const manageable = await listMyManageableTeams(userId);
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
    () => openChallenges.filter((challenge) => {
      const status = String(challenge?.status || '').toLowerCase();
      return status === 'open' || status === 'accepted';
    }),
    [openChallenges],
  );

  const activeFiltersCount = useMemo(() => (
    [filters.format, filters.skillLevel, filters.zone]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .length
  ), [filters]);

  const manageableTeamIds = useMemo(
    () => new Set((manageableTeams || []).map((team) => team.id).filter(Boolean)),
    [manageableTeams],
  );

  const getAvailableTeamsForChallenge = (challenge) => manageableTeams.filter((team) => (
    team.id !== challenge.challenger_team_id &&
    team.is_active
  ));

  const closeAcceptChallengeModal = useCallback(() => {
    setAcceptingChallenge(null);
    setSelectedAcceptTeamId('');
  }, []);

  const notifyAcceptedChallengeSuccess = useCallback(() => {
    setInlineNotice({
      type: 'success',
      message: 'Desafio aceptado. Ya podes verlo en Mis partidos.',
    });
  }, []);

  const openChallengeMatch = useCallback(async (challenge) => {
    if (!challenge?.id) return;
    try {
      const match = await getTeamMatchByChallengeId(challenge.id);
      if (!match?.id) {
        notifyBlockingError('Todavía no existe un partido asociado a este desafío.');
        return;
      }
      navigate(`/desafios/equipos/partidos/${match.id}`);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo abrir el partido del desafío.');
    }
  }, [navigate]);

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

      <div className="w-full flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowPublishModal(true)}
          className={primaryCtaClass}
        >
          Publicar desafio
        </button>

        <button
          type="button"
          onClick={() => setShowFilters((prev) => !prev)}
          className={`${secondaryCtaClass} ${showFilters
            ? 'border-[#7d5aff] bg-[rgba(106,67,255,0.22)] text-white'
            : 'border-[rgba(88,107,170,0.46)] bg-[rgba(15,24,56,0.72)] text-white/78 hover:border-[#4a7ed6] hover:text-white'
            }`}
        >
          <Search size={18} />
          <span>Buscar</span>
          {activeFiltersCount > 0 ? (
            <span className="inline-flex h-5 min-w-[18px] items-center justify-center rounded-none bg-[#6a43ff] px-1 text-[11px] leading-none text-white border border-[#7d5aff]">
              {activeFiltersCount}
            </span>
          ) : null}
        </button>
      </div>

      {showFilters ? (
        <div className="mt-2.5 border border-[rgba(88,107,170,0.46)] bg-[rgba(15,24,56,0.72)] p-3">
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

      <div className="mt-1 mb-0.5 flex items-center gap-2.5 px-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
          Desafíos públicos
        </span>
        <span className="h-px flex-1 bg-[rgba(88,107,170,0.46)]" />
      </div>

      {loading ? (
        <div className="rounded-2xl border border-white/15 bg-white/5 p-4 text-center text-white/70">
          Cargando desafios...
        </div>
      ) : null}

      {!loading && visibleChallenges.length === 0 ? (
        <EmptyStateCard
          icon={Flag}
          title="Sin desafíos"
          description="No encontramos desafíos para esos filtros."
          className="my-0 p-5"
        />
      ) : null}

      {!loading ? visibleChallenges.map((challenge) => {
        const isOwnChallenge = manageableTeamIds.has(challenge.challenger_team_id)
          || challenge.created_by_user_id === userId;
        const isParticipantChallenge = isOwnChallenge
          || manageableTeamIds.has(challenge.accepted_team_id)
          || challenge.accepted_by_user_id === userId;
        const canEditChallenge = challenge.status === 'open'
          && manageableTeamIds.has(challenge.challenger_team_id);
        const status = String(challenge?.status || '').toLowerCase();

        let primaryLabel = 'Ver detalle';
        let primaryDisabled = false;
        let primaryAction = async () => {};

        if (status === 'open') {
          primaryLabel = isOwnChallenge ? 'Cancelar desafio' : 'Aceptar';
          primaryAction = async () => {
            if (isOwnChallenge) {
              setCancelConfirmChallenge(challenge);
              return;
            }

            const available = getAvailableTeamsForChallenge(challenge);
            if (available.length === 0) {
              setAcceptBlockedMessage('No tenés equipos donde seas capitán para aceptar este desafío');
              return;
            }

            setAcceptingChallenge(challenge);
            setSelectedAcceptTeamId(available[0].id);
          };
        } else if (status === 'accepted') {
          if (isOwnChallenge) {
            primaryLabel = 'Cancelar desafio';
            primaryAction = async () => setCancelConfirmChallenge(challenge);
          } else if (isParticipantChallenge) {
            primaryLabel = 'Ver partido';
            primaryAction = async () => openChallengeMatch(challenge);
          } else {
            primaryLabel = 'Ya aceptado';
            primaryDisabled = true;
          }
        }

        return (
          <ChallengeCard
            key={challenge.id}
            challenge={challenge}
            isOwnChallenge={isOwnChallenge}
            canEdit={canEditChallenge}
            onEdit={(targetChallenge) => setEditingChallenge(targetChallenge)}
            primaryLabel={primaryLabel}
            onPrimaryAction={primaryAction}
            canCancel={false}
            disabled={isSubmitting || primaryDisabled}
          />
        );
      }) : null}

      <PublishChallengeModal
        isOpen={showPublishModal}
        teams={manageableTeams}
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

      <PublishChallengeModal
        isOpen={Boolean(editingChallenge)}
        teams={manageableTeams}
        initialChallenge={editingChallenge}
        submitLabel="Guardar"
        submitLoadingText="Guardando..."
        isSubmitting={isSubmitting}
        onClose={() => setEditingChallenge(null)}
        onSubmit={async (payload) => {
          if (!editingChallenge?.id) return;

          try {
            setIsSubmitting(true);
            await updateChallenge(userId, editingChallenge.id, payload);
            setEditingChallenge(null);
            await loadChallenges();
            setInlineNotice({
              type: 'success',
              message: 'Desafio actualizado correctamente.',
            });
          } catch (error) {
            notifyBlockingError(error.message || 'No se pudo editar el desafio');
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

          try {
            setIsSubmitting(true);
            const result = await acceptChallenge(acceptingChallenge.id, selectedAcceptTeamId, {
              currentUserId: userId,
              acceptedTeamName: acceptedTeam?.name || '',
            });
            closeAcceptChallengeModal();
            await loadChallenges();
            if (result?.matchId) {
              navigate(`/desafios/equipos/partidos/${result.matchId}`);
            }
            notifyAcceptedChallengeSuccess();
          } catch (error) {
            notifyBlockingError(error.message || 'No se pudo aceptar el desafio');
          } finally {
            setIsSubmitting(false);
          }
        }}
      />

      <ConfirmModal
        isOpen={Boolean(cancelConfirmChallenge)}
        title="Cancelar desafío"
        message={(
          <>
            Este desafío se cancelará definitivamente.<br />
            Esta acción no se puede deshacer.
          </>
        )}
        onConfirm={async () => {
          if (!cancelConfirmChallenge?.id) return;
          try {
            setIsSubmitting(true);
            await cancelChallenge(cancelConfirmChallenge.id);
            setCancelConfirmChallenge(null);
            await loadChallenges();
          } catch (error) {
            notifyBlockingError(error.message || 'No se pudo cancelar el desafío');
          } finally {
            setIsSubmitting(false);
          }
        }}
        onCancel={() => setCancelConfirmChallenge(null)}
        isDeleting={isSubmitting}
        confirmText="Cancelar desafío"
        cancelText="Volver"
        danger
      />

      <Modal
        isOpen={Boolean(acceptBlockedMessage)}
        onClose={() => setAcceptBlockedMessage('')}
        title="Atención"
        className={challengeConfirmModalClass}
        classNameContent={challengeConfirmModalContentClass}
        footer={(
          <div className="grid grid-cols-1">
            <Button
              type="button"
              className={publishActionPrimaryClass}
              onClick={() => setAcceptBlockedMessage('')}
              data-preserve-button-case="true"
            >
              Aceptar
            </Button>
          </div>
        )}
      >
        <p className="text-[15px] leading-relaxed text-white/82">
          {acceptBlockedMessage}
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
