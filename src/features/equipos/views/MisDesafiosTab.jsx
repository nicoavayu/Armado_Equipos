import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ChallengeCard from '../components/ChallengeCard';
import CompleteChallengeModal from '../components/CompleteChallengeModal';
import {
  cancelChallenge,
  completeChallenge,
  getTeamMatchByChallengeId,
  listMyChallenges,
} from '../../../services/db/teamChallenges';
import { notifyBlockingError } from '../../../utils/notifyBlockingError';
import EmptyStateCard from '../../../components/EmptyStateCard';
import { Flag } from 'lucide-react';

const STATE_TABS = [
  { key: 'open', label: 'Abiertos' },
  { key: 'accepted', label: 'Aceptados' },
  { key: 'confirmed', label: 'Confirmados' },
  { key: 'completed', label: 'Finalizados' },
  { key: 'canceled', label: 'Cancelados' },
];

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

const MisDesafiosTab = ({
  userId,
  initialStatusTab = null,
  onInitialStatusApplied,
}) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusTab, setStatusTab] = useState('open');
  const [myChallenges, setMyChallenges] = useState([]);
  const [completeTarget, setCompleteTarget] = useState(null);

  const loadData = async () => {
    if (!userId) return;

    try {
      setLoading(true);
      const rows = await listMyChallenges(userId);
      setMyChallenges(rows);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudieron cargar tus desafios');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (!initialStatusTab) return;
    if (!STATE_TABS.some((tab) => tab.key === initialStatusTab)) return;
    setStatusTab(initialStatusTab);
    onInitialStatusApplied?.();
  }, [initialStatusTab, onInitialStatusApplied]);

  const filtered = useMemo(
    () => myChallenges.filter((challenge) => challenge.status === statusTab),
    [myChallenges, statusTab],
  );

  useEffect(() => {
    if (myChallenges.length === 0) return;
    if (myChallenges.some((challenge) => challenge.status === statusTab)) return;

    const fallbackOrder = ['accepted', 'confirmed', 'open', 'completed', 'canceled'];
    const nextTab = fallbackOrder.find((candidateStatus) => (
      myChallenges.some((challenge) => challenge.status === candidateStatus)
    ));
    if (nextTab) {
      setStatusTab(nextTab);
    }
  }, [myChallenges, statusTab]);

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
      <div className="rounded-2xl border border-white/15 bg-white/5 p-3">
        <h3 className="text-white font-oswald text-lg">Mis desafios</h3>
        <div className="mt-2 grid grid-cols-2 lg:grid-cols-4 gap-2">
          {STATE_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatusTab(tab.key)}
              className={`w-full rounded-lg border px-2 py-2 text-xs font-semibold normal-case tracking-normal leading-tight ${statusTab === tab.key
                ? 'bg-white/15 border-white/30 text-white'
                : 'bg-transparent border-white/15 text-white/60'
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-white/15 bg-white/5 p-4 text-center text-white/70">
          Cargando desafios...
        </div>
      ) : null}

      {!loading && filtered.length === 0 ? (
        <EmptyStateCard
          icon={Flag}
          title="Sin desafíos"
          description="No hay desafíos en este estado."
          className="my-0 p-5"
        />
      ) : null}

      {!loading ? filtered.map((challenge) => {
        const allowManage = canManage(challenge);

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
            primaryLabel={primaryLabel}
            onPrimaryAction={primaryAction}
            onCancel={async () => {
              if (!allowManage) return;

              try {
                setIsSubmitting(true);
                await cancelChallenge(challenge.id);
                await loadData();
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
      }) : null}

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
            await loadData();
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

export default MisDesafiosTab;
