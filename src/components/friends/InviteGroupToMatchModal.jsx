import logger from '../../utils/logger';
import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import Modal from '../Modal';
import LoadingSpinner from '../LoadingSpinner';
import MatchSelectionCard from '../MatchSelectionCard';
import { supabase } from '../../supabase';
import { formatLocalDateShort } from '../../utils/dateLocal';
import { resolveInviteRecipientsFromGroups } from '../../services/db/privateFriendGroups';
import { normalizeSendMatchInviteResult } from '../../utils/matchInviteState';
import { notifyBlockingError } from 'utils/notifyBlockingError';
import { showGlobalNotice } from '../../utils/globalNoticeModal';
import { requestImmediatePushDispatchSafe } from '../../services/pushDispatchService';
import { track } from '../../utils/monitoring/analytics';
import {
  readCachedInvitedGroupIds,
  rememberCachedInvitedGroupIds,
} from '../../utils/groupInviteCache';
import { resolvePlayerInvitePermission } from '../../utils/matchInvitePermissions';
import { isMatchUpcoming, resolveMatchStartAt } from '../../utils/matchEligibility';

const PRIMARY_ACTION_BUTTON_CLASS = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-none border border-[#7d5aff] bg-[#6a43ff] px-4 py-2.5 font-bebas text-base tracking-[0.01em] text-white shadow-[0_0_14px_rgba(106,67,255,0.3)] transition-all hover:bg-[#7550ff] active:opacity-95 disabled:cursor-not-allowed disabled:border-[rgba(125,90,255,0.45)] disabled:bg-[rgba(106,67,255,0.55)] disabled:text-white/45 disabled:shadow-none';
const SECONDARY_ACTION_BUTTON_CLASS = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-none border border-[rgba(148,134,255,0.28)] bg-white/[0.05] px-4 py-2.5 font-bebas text-base tracking-[0.01em] text-white/92 transition-all hover:bg-white/[0.1] active:opacity-95 disabled:cursor-not-allowed disabled:opacity-50';
const SECTION_TITLE_CLASS = 'font-oswald text-[clamp(16px,4.4vw,20px)] font-semibold leading-tight tracking-[0.01em] text-white';

const normalizeUniqueCount = (values = []) => new Set(
  (Array.isArray(values) ? values : [values])
    .map((value) => String(value || '').trim())
    .filter(Boolean),
).size;

const showInviteNotice = (payload) => showGlobalNotice({
  confirmText: 'Entendido',
  ...payload,
});

const showGroupInviteSummaryNotice = ({
  sentCount = 0,
  reinvitedCount = 0,
  alreadyInvitedCount = 0,
  unavailableCount = 0,
  alreadyInMatchCount = 0,
  duplicateCount = 0,
  ineligibleCount = 0,
}) => {
  const lines = [];
  const deliveredCount = sentCount + reinvitedCount;

  if (deliveredCount > 0) {
    lines.push(
      deliveredCount === 1
        ? 'Se envió 1 invitación.'
        : `Se enviaron ${deliveredCount} invitaciones.`,
    );
  }
  if (duplicateCount > 0) {
    lines.push(
      duplicateCount === 1
        ? 'Se unificó 1 contacto repetido dentro del grupo.'
        : `Se unificaron ${duplicateCount} contactos repetidos dentro del grupo.`,
    );
  }
  if (alreadyInvitedCount > 0) {
    lines.push(`${alreadyInvitedCount} jugador${alreadyInvitedCount === 1 ? '' : 'es'} ya tenía${alreadyInvitedCount === 1 ? '' : 'n'} una invitación pendiente.`);
  }
  if (alreadyInMatchCount > 0) {
    lines.push(`${alreadyInMatchCount} jugador${alreadyInMatchCount === 1 ? '' : 'es'} ya forma${alreadyInMatchCount === 1 ? '' : 'n'} parte del partido.`);
  }
  if (unavailableCount > 0) {
    lines.push(`${unavailableCount} jugador${unavailableCount === 1 ? '' : 'es'} tiene${unavailableCount === 1 ? '' : 'n'} las invitaciones desactivadas.`);
  }
  if (ineligibleCount > 0) {
    lines.push(`${ineligibleCount} contacto${ineligibleCount === 1 ? '' : 's'} no pudo${ineligibleCount === 1 ? '' : 'ieron'} invitarse desde este grupo.`);
  }

  if (lines.length === 0) return;

  showInviteNotice({
    title: 'Resultado de invitaciones',
    message: lines.join(' '),
  });
};

const handleInviteRpcError = (error) => {
  const rawMessage = String(error?.message || '').toLowerCase();
  if (rawMessage.includes('invitations_closed')) {
    notifyBlockingError('El partido no está abierto para invitaciones en este momento.');
    return;
  }
  if (rawMessage.includes('player_invites_disabled')) {
    notifyBlockingError('El organizador no habilitó invitaciones de jugadores.');
    return;
  }
  if (rawMessage.includes('match_not_open_for_invites')) {
    notifyBlockingError('Este partido ya no recibe invitaciones.');
    return;
  }
  if (rawMessage.includes('guest_direct_invite_forbidden')) {
    notifyBlockingError('Solo el organizador puede enviar esta invitación directa.');
    return;
  }
  if (rawMessage.includes('actor_not_in_match')) {
    notifyBlockingError('Debés formar parte del partido para invitar jugadores.');
    return;
  }
  if (rawMessage.includes('recipient_not_found')) {
    notifyBlockingError('No se encontró a uno de los jugadores seleccionados.');
    return;
  }
  notifyBlockingError('Error al procesar la invitación.');
};

const showGroupAlreadyInvitedNotice = (matchName) => {
  showInviteNotice({
    title: 'Grupo ya invitado',
    message: `Este grupo ya fue invitado a "${matchName || 'este partido'}".`,
  });
};

const showMatchUnavailableNotice = (match) => {
  if (match?.inviteStatus === 'player_invites_disabled') {
    showInviteNotice({
      title: 'Sólo el organizador puede invitar',
      message: 'El organizador no habilitó invitaciones de jugadores para este partido.',
    });
    return;
  }

  if (match?.inviteStatus === 'group_already_invited') {
    showGroupAlreadyInvitedNotice(match?.nombre);
    return;
  }

  if (match?.inviteStatus === 'match_closed') {
    showInviteNotice({
      title: 'Partido cerrado',
      message: `"${match?.nombre || 'Este partido'}" ya no recibe invitaciones.`,
    });
    return;
  }

  showInviteNotice({
    title: 'Partido sin cupos',
    message: `Ya no hay cupos disponibles en "${match?.nombre || 'este partido'}".`,
  });
};

const buildInviteMessage = ({ senderName, match }) => {
  const dateLabel = match?.fecha_display || (match?.fecha ? formatLocalDateShort(match.fecha) : '');
  const timeLabel = match?.hora || '';
  const suffix = [dateLabel, timeLabel ? `a las ${timeLabel}` : null].filter(Boolean).join(' ');

  return suffix
    ? `${senderName} te invitó a jugar ${suffix}`
    : `${senderName} te invitó a jugar un partido.`;
};

const InviteGroupToMatchModal = ({
  isOpen,
  group,
  currentUserId,
  onClose,
}) => {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  const [inviting, setInviting] = useState(false);

  const selectedMatch = useMemo(
    () => matches.find((match) => String(match?.id) === String(selectedMatchId)) || null,
    [matches, selectedMatchId],
  );

  useEffect(() => {
    if (!isOpen || !currentUserId) return undefined;

    let cancelled = false;

    const fetchMatches = async () => {
      setLoading(true);
      setLoadError(null);
      setSelectedMatchId(null);

      try {
        const { data: myPlayerRows, error: myPlayerRowsError } = await supabase
          .from('jugadores')
          .select('partido_id, usuario_id')
          .eq('usuario_id', currentUserId);

        if (myPlayerRowsError) throw myPlayerRowsError;

        const { data: myAdminRows, error: myAdminRowsError } = await supabase
          .from('partidos')
          .select('id')
          .eq('creado_por', currentUserId);

        if (myAdminRowsError) throw myAdminRowsError;

        const myMatchIds = Array.from(new Set([
          ...(myPlayerRows || []).map((row) => row.partido_id),
          ...(myAdminRows || []).map((row) => row.id),
        ].filter(Boolean)));

        if (myMatchIds.length === 0) {
          if (cancelled) return;
          setMatches([]);
          return;
        }

        const { data: userMatches, error: matchesError } = await supabase
          .from('partidos')
          .select('id, nombre, fecha, hora, sede, modalidad, cupo_jugadores, tipo_partido, creado_por, estado, deleted_at, survey_status, result_status, finished_at, player_invites_enabled')
          .in('id', myMatchIds)
          .order('fecha', { ascending: true })
          .order('hora', { ascending: true });

        if (matchesError) throw matchesError;

        const matchIds = (userMatches || []).map((match) => match?.id).filter(Boolean);
        let playerRows = [];
        if (matchIds.length > 0) {
          const { data, error } = await supabase
            .from('jugadores')
            .select('partido_id, usuario_id')
            .in('partido_id', matchIds);
          if (error) throw error;
          playerRows = data || [];
        }

        const now = new Date();
        const nextMatches = (userMatches || [])
          .map((match) => {
            // Only currently-valid matches: real date+time still in the future
            // (excludes past/started/invalid). Finished/cancelled/deleted are still
            // handled by the permission check below.
            if (!isMatchUpcoming(match, { now })) return null;
            const permission = resolvePlayerInvitePermission({
              match,
              currentUserId,
              membershipRows: myPlayerRows || [],
            });
            if (permission.inviteStatus === 'match_closed') return null;

            const playersInMatch = playerRows.filter((row) => row?.partido_id === match.id);
            const starterCapacity = Number(match?.cupo_jugadores || 20);
            const maxRosterSlots = starterCapacity > 0 ? starterCapacity + 4 : 0;
            const isRosterFull = maxRosterSlots > 0 && playersInMatch.length >= maxRosterSlots;
            const isGroupAlreadyInvited = readCachedInvitedGroupIds(match.id).has(String(group?.id || '').trim());
            let inviteStatus = 'available';
            if (!permission.canInvite) inviteStatus = permission.inviteStatus;
            else if (isGroupAlreadyInvited) inviteStatus = 'group_already_invited';
            else if (isRosterFull) inviteStatus = 'roster_full';

            return {
              ...match,
              jugadores_count: playersInMatch.length,
              invitePermission: permission,
              inviteStatus,
              canInvite: permission.canInvite && inviteStatus === 'available',
              fecha_display: match?.fecha ? formatLocalDateShort(match.fecha) : '',
            };
          })
          .filter(Boolean)
          .sort((left, right) => {
            if (left.canInvite !== right.canInvite) return left.canInvite ? -1 : 1;
            // Soonest kickoff first, then the rest chronologically.
            const leftAt = resolveMatchStartAt(left);
            const rightAt = resolveMatchStartAt(right);
            const leftMs = leftAt ? leftAt.getTime() : Number.POSITIVE_INFINITY;
            const rightMs = rightAt ? rightAt.getTime() : Number.POSITIVE_INFINITY;
            return leftMs - rightMs;
          });

        if (cancelled) return;
        setMatches(nextMatches);

        const firstAvailable = nextMatches.find((match) => match?.canInvite);
        if (firstAvailable) {
          setSelectedMatchId(firstAvailable.id);
        }
      } catch (error) {
        logger.error('[PRIVATE_GROUPS] Error loading admin matches:', error);
        if (cancelled) return;
        setLoadError(error?.message || 'No se pudieron cargar tus partidos.');
        setMatches([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchMatches();

    return () => {
      cancelled = true;
    };
  }, [currentUserId, group?.id, isOpen]);

  const handleInviteGroup = async () => {
    if (!selectedMatch?.id) {
      notifyBlockingError('Seleccioná un partido.');
      return;
    }

    if (!group?.id) {
      notifyBlockingError('No se pudo identificar el grupo.');
      return;
    }

    if (!selectedMatch?.canInvite) {
      showMatchUnavailableNotice(selectedMatch);
      return;
    }

    setInviting(true);
    try {
      const resolution = await resolveInviteRecipientsFromGroups({
        matchId: selectedMatch.id,
        ownerUserId: currentUserId,
        selectedGroupIds: [group.id],
      });

      const recipients = resolution?.recipients || [];
      const skipped = resolution?.skipped || {};
      const sentIds = [];
      const reinvitedIds = [];
      const alreadyPendingIds = (skipped?.already_invited || []).map((entry) => entry?.user_id || entry?.id);
      const ineligibleIds = (skipped?.ineligible || []).map((entry) => entry?.user_id || entry?.id);
      const unavailableIds = [];
      const alreadyInMatchIds = (skipped?.already_in_match || []).map((entry) => entry?.user_id || entry?.id);
      const duplicateCount = Array.isArray(skipped?.duplicate) ? skipped.duplicate.length : 0;
      const shouldBlockGroupForMatch = (
        recipients.length > 0
        || alreadyPendingIds.length > 0
        || unavailableIds.length > 0
        || alreadyInMatchIds.length > 0
        || ineligibleIds.length > 0
        || duplicateCount > 0
      );

      if (recipients.length === 0) {
        if (
          normalizeUniqueCount(alreadyPendingIds) === 0
          && normalizeUniqueCount(unavailableIds) === 0
          && normalizeUniqueCount(alreadyInMatchIds) === 0
          && normalizeUniqueCount(ineligibleIds) === 0
          && duplicateCount === 0
        ) {
          showInviteNotice({
            title: 'Sin destinatarios',
            message: 'Este grupo no tiene amigos disponibles para invitar a ese partido.',
          });
        } else {
          showGroupInviteSummaryNotice({
            alreadyInvitedCount: normalizeUniqueCount(alreadyPendingIds),
            unavailableCount: normalizeUniqueCount(unavailableIds),
            alreadyInMatchCount: normalizeUniqueCount(alreadyInMatchIds),
            duplicateCount,
            ineligibleCount: normalizeUniqueCount(ineligibleIds),
          });
        }
        return;
      }

      const { data: currentUser, error: userError } = await supabase
        .from('usuarios')
        .select('nombre')
        .eq('id', currentUserId)
        .maybeSingle();

      if (userError) throw userError;

      const inviteMessage = buildInviteMessage({
        senderName: currentUser?.nombre || 'Alguien',
        match: selectedMatch,
      });

      for (const recipient of recipients) {
        const recipientUserId = String(recipient?.user_id || recipient?.id || '').trim();
        if (!recipientUserId) continue;

        const { data, error } = await supabase.rpc('send_match_invite', {
          p_user_id: recipientUserId,
          p_partido_id: Number(selectedMatch.id),
          p_title: 'Invitación a partido',
          p_message: inviteMessage,
          p_invite_mode: 'direct',
        });

        if (error) throw error;

        const resultStatus = String(normalizeSendMatchInviteResult(data) || '').trim().toLowerCase() || 'sent';
        if (resultStatus === 'sent') {
          sentIds.push(recipientUserId);
        } else if (resultStatus === 'reinvited') {
          reinvitedIds.push(recipientUserId);
        } else if (resultStatus === 'already_pending') {
          alreadyPendingIds.push(recipientUserId);
        } else if (resultStatus === 'recipient_unavailable') {
          unavailableIds.push(recipientUserId);
        } else if (resultStatus === 'already_in_match') {
          alreadyInMatchIds.push(recipientUserId);
        }
      }

      [...sentIds, ...reinvitedIds].forEach((recipientUserId) => {
        track('match_invite_sent', {
          match_id: Number(selectedMatch.id),
          recipient_user_id: recipientUserId,
          source: 'private_group_detail_modal',
        });
      });

      if (sentIds.length > 0 || reinvitedIds.length > 0) {
        requestImmediatePushDispatchSafe({
          eventType: 'match_invite',
          matchId: Number(selectedMatch.id),
          limit: Math.max(20, Math.min(80, (sentIds.length + reinvitedIds.length) * 10)),
        });
      }

      showGroupInviteSummaryNotice({
        sentCount: sentIds.length,
        reinvitedCount: reinvitedIds.length,
        alreadyInvitedCount: normalizeUniqueCount(alreadyPendingIds),
        unavailableCount: normalizeUniqueCount(unavailableIds),
        alreadyInMatchCount: normalizeUniqueCount(alreadyInMatchIds),
        duplicateCount,
        ineligibleCount: normalizeUniqueCount(ineligibleIds),
      });

      if (shouldBlockGroupForMatch) {
        rememberCachedInvitedGroupIds(selectedMatch.id, [group.id]);
        setMatches((prev) => prev.map((match) => (
          String(match?.id) === String(selectedMatch.id)
            ? {
              ...match,
              inviteStatus: 'group_already_invited',
              canInvite: false,
            }
            : match
        )));
      }

      if (sentIds.length > 0 || reinvitedIds.length > 0) {
        onClose?.();
      }
    } catch (error) {
      logger.error('[PRIVATE_GROUPS] Error inviting group to match:', error);
      handleInviteRpcError(error);
    } finally {
      setInviting(false);
    }
  };

  const footer = (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        className={`${SECONDARY_ACTION_BUTTON_CLASS} w-full min-w-0`}
        onClick={onClose}
        disabled={inviting}
        data-preserve-button-case="true"
      >
        Cancelar
      </button>
      <button
        type="button"
        className={`${PRIMARY_ACTION_BUTTON_CLASS} w-full min-w-0`}
        onClick={handleInviteGroup}
        disabled={inviting || !selectedMatch?.id || !selectedMatch?.canInvite}
        data-preserve-button-case="true"
      >
        {inviting ? <Loader2 size={16} className="animate-spin" /> : null}
        {inviting ? 'Enviando...' : 'Invitar grupo'}
      </button>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Invitar grupo${group?.name ? ` · ${group.name}` : ''}`}
      footer={footer}
      className="w-full max-w-[720px] !bg-[#101a35] border border-[rgba(148,134,255,0.28)]"
      classNameContent="p-5"
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-none border border-[rgba(148,134,255,0.2)] bg-[rgba(18,28,62,0.78)] p-4">
          <div className="text-white">
            <div className={SECTION_TITLE_CLASS}>Elegí el partido</div>
          </div>
          <p className="mt-2 text-sm text-white/60">
            Seleccioná uno de tus partidos para invitar automáticamente a los integrantes de este grupo.
          </p>
        </div>

        {loading ? (
          <div className="flex min-h-[220px] items-center justify-center">
            <LoadingSpinner size="medium" />
          </div>
        ) : loadError ? (
          <div className="rounded-none border border-[rgba(177,72,72,0.45)] bg-[rgba(73,20,20,0.4)] px-4 py-5 text-sm text-red-200">
            {loadError}
          </div>
        ) : matches.length === 0 ? (
          <div className="rounded-none border border-dashed border-white/15 px-4 py-8 text-center text-sm text-white/55">
            No tenés partidos abiertos disponibles para invitar a este grupo.
          </div>
        ) : (
          <div className="flex max-h-[420px] flex-col gap-3 overflow-y-auto pr-1">
            {matches.map((match) => (
              <MatchSelectionCard
                key={match.id}
                match={match}
                isSelected={String(selectedMatchId) === String(match.id)}
                onSelect={() => {
                  if (inviting) return;
                  if (match.canInvite) {
                    setSelectedMatchId(match.id);
                    return;
                  }
                  showMatchUnavailableNotice(match);
                }}
                inviteStatus={match?.inviteStatus}
              />
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
};

export default InviteGroupToMatchModal;
