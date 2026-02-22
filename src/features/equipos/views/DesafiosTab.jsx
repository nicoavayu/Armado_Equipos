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
import { Flag } from 'lucide-react';

const compactActionClass = 'w-auto px-3 h-9 rounded-xl text-xs font-oswald tracking-wide !normal-case';

const DesafiosTab = ({ userId, prefilledTeamId = null, onChallengePublished }) => {
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [openChallenges, setOpenChallenges] = useState([]);
  const [myTeams, setMyTeams] = useState([]);
  const [filters, setFilters] = useState({ format: '', zone: '', skillLevel: '' });
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

  const getAvailableTeamsForChallenge = (challenge) => myTeams.filter((team) => (
    team.format === challenge.format &&
    team.id !== challenge.challenger_team_id &&
    team.is_active
  ));

  return (
    <div className="w-full max-w-[560px] flex flex-col gap-3">
      <div className="rounded-2xl border border-white/15 bg-white/5 p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-white font-oswald text-lg">Marketplace de desafios</h3>
          <Button
            type="button"
            onClick={() => setShowPublishModal(true)}
            className={compactActionClass}
          >
            + Publicar desafio
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <select
            value={filters.format}
            onChange={(event) => setFilters((prev) => ({ ...prev, format: event.target.value }))}
            className="rounded-lg bg-slate-900/80 border border-white/15 px-2 py-2 text-xs text-white"
          >
            <option value="">Formato</option>
            {TEAM_FORMAT_OPTIONS.map((value) => <option key={value} value={value}>F{value}</option>)}
          </select>

          <select
            value={filters.skillLevel}
            onChange={(event) => setFilters((prev) => ({ ...prev, skillLevel: event.target.value }))}
            className="rounded-lg bg-slate-900/80 border border-white/15 px-2 py-2 text-xs text-white"
          >
            <option value="">Todos</option>
            {TEAM_SKILL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>

          <NeighborhoodAutocomplete
            value={filters.zone}
            onChange={(nextZone) => setFilters((prev) => ({ ...prev, zone: nextZone }))}
            placeholder="Barrio"
            inputClassName="rounded-lg bg-slate-900/80 border border-white/15 px-2 py-2 text-xs text-white w-full outline-none focus:border-[#128BE9] disabled:opacity-60 disabled:cursor-not-allowed"
          />
        </div>
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
            onPrimaryAction={async () => {
              if (challenge.status !== 'open') return;

              const available = getAvailableTeamsForChallenge(challenge);
              if (available.length === 0) {
                notifyBlockingError('No tenes equipos compatibles para aceptar este desafio');
                return;
              }

              setAcceptingChallenge(challenge);
              setSelectedAcceptTeamId(available[0].id);
            }}
            onCancel={async () => {
              if (!isOwnChallenge) return;
              try {
                setIsSubmitting(true);
                await cancelChallenge(challenge.id);
                await loadOpenChallenges();
              } catch (error) {
                notifyBlockingError(error.message || 'No se pudo cancelar el desafio');
              } finally {
                setIsSubmitting(false);
              }
            }}
            canCancel={isOwnChallenge && ['open', 'accepted', 'confirmed'].includes(challenge.status)}
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
            await acceptChallenge(acceptingChallenge.id, selectedAcceptTeamId);
            setAcceptingChallenge(null);
            await loadOpenChallenges();
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
