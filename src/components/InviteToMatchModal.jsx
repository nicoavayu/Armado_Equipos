import logger from '../utils/logger';
import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { formatLocalDateShort } from '../utils/dateLocal';
import Modal from './Modal';
import LoadingSpinner from './LoadingSpinner';
import MatchSelectionCard from './MatchSelectionCard';
import { CalendarDays } from 'lucide-react';
import { notifyBlockingError } from 'utils/notifyBlockingError';
import { showGlobalNotice } from '../utils/globalNoticeModal';
import { requestImmediatePushDispatchSafe } from '../services/pushDispatchService';
import { track } from '../utils/monitoring/analytics';
import { QUIERO_JUGAR_OPEN_MATCHES_VIEW } from '../services/db/openMatches';
import {
    buildInviteStateByMatch,
    EMPTY_MATCH_INVITE_STATE,
    normalizeSendMatchInviteResult,
    resolveNotificationMatchIdText,
} from '../utils/matchInviteState';

const SECTION_TITLE_CLASS = 'font-oswald text-[clamp(16px,4.4vw,20px)] font-semibold leading-tight tracking-[0.01em] text-white';
const PRIMARY_ACTION_BUTTON_CLASS = 'w-full min-h-[44px] px-4 py-2.5 rounded-none border border-[#7d5aff] bg-[#6a43ff] text-white font-bebas text-base tracking-[0.01em] transition-all inline-flex items-center justify-center gap-2 hover:bg-[#7550ff] active:opacity-95 shadow-[0_0_14px_rgba(106,67,255,0.3)] disabled:bg-[rgba(106,67,255,0.55)] disabled:border-[rgba(125,90,255,0.5)] disabled:text-white/40 disabled:shadow-none disabled:cursor-not-allowed';
const SECONDARY_ACTION_BUTTON_CLASS = 'w-full min-h-[44px] px-4 py-2.5 rounded-none border border-[rgba(148,134,255,0.28)] bg-white/[0.05] text-white/92 font-bebas text-base tracking-[0.01em] transition-all inline-flex items-center justify-center gap-2 hover:bg-white/[0.1] active:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed';
const showInviteNotice = ({ title, message, confirmText = 'Entendido', danger = false }) => showGlobalNotice({
    title,
    message,
    confirmText,
    danger,
});

const showMatchAvailabilityNotice = (match, targetName) => {
    if (match?.inviteStatus === 'already_pending') {
        showInviteNotice({
            title: 'Invitación pendiente',
            message: `Este jugador ya tiene una invitación pendiente para "${match?.nombre || 'este partido'}".`,
        });
        return;
    }

    if (match?.inviteStatus === 'roster_full') {
        showInviteNotice({
            title: 'Partido sin cupos',
            message: `Ya no hay cupos disponibles en "${match?.nombre || 'este partido'}".`,
        });
        return;
    }

    showInviteNotice({
        title: 'Jugador ya en el partido',
        message: `${targetName} ya forma parte de "${match?.nombre || 'este partido'}".`,
    });
};

const showInviteResultNotice = ({ status, targetName, matchName }) => {
    const safeMatchName = matchName || 'este partido';

    if (status === 'reinvited') {
        showInviteNotice({
            title: 'Reinvitación enviada',
            message: `La reinvitación para ${targetName} a "${safeMatchName}" se envió correctamente.`,
        });
        return;
    }

    if (status === 'already_pending') {
        showInviteNotice({
            title: 'Invitación pendiente',
            message: `Este jugador ya tiene una invitación pendiente para "${safeMatchName}".`,
        });
        return;
    }

    if (status === 'already_in_match') {
        showInviteNotice({
            title: 'Jugador ya en el partido',
            message: `${targetName} ya forma parte de "${safeMatchName}".`,
        });
        return;
    }

    if (status === 'recipient_unavailable') {
        showInviteNotice({
            title: 'Invitaciones desactivadas',
            message: `${targetName} no está recibiendo invitaciones en este momento.`,
        });
        return;
    }

    showInviteNotice({
        title: 'Invitación enviada',
        message: `La invitación para ${targetName} a "${safeMatchName}" se envió correctamente.`,
    });
};

const handleInviteRpcError = (error) => {
    const rawMessage = String(error?.message || '').toLowerCase();
    if (rawMessage.includes('invitations_closed')) {
        notifyBlockingError('El partido no está abierto para invitaciones en este momento.');
        return;
    }
    if (rawMessage.includes('guest_direct_invite_forbidden')) {
        notifyBlockingError('Solo el organizador puede enviar esta invitación directa.');
        return;
    }
    if (rawMessage.includes('actor_not_in_match')) {
        notifyBlockingError('Debes formar parte del partido para invitar a este jugador.');
        return;
    }
    if (rawMessage.includes('recipient_not_found')) {
        notifyBlockingError('No se encontró al jugador que querés invitar.');
        return;
    }
    notifyBlockingError('Error al procesar la invitación');
};

const InviteToMatchModal = ({ isOpen, onClose, friend, currentUserId }) => {
    const [matches, setMatches] = useState([]);
    const [loading, setLoading] = useState(false);
    const [inviting, setInviting] = useState(false);
    const [selectedMatchId, setSelectedMatchId] = useState(null);
    const targetProfile = friend?.profile || friend || null;
    const targetUserId = targetProfile?.id || targetProfile?.user_id || targetProfile?.uuid || null;
    const targetName = targetProfile?.nombre || friend?.nombre || 'jugador';
    const subtitleText = 'Elegí el partido al que querés invitar al jugador.';

    useEffect(() => {
        if (isOpen && currentUserId) {
            fetchUserMatches();
        }
        // eslint-disable-next-line
    }, [isOpen, currentUserId]);

    const fetchUserMatches = async () => {
        setLoading(true);
        setSelectedMatchId(null);
        try {
            if (!targetUserId) {
                setMatches([]);
                return;
            }

            const { data: myPlayerRows, error: myPlayerRowsError } = await supabase
                .from('jugadores')
                .select('partido_id')
                .eq('usuario_id', currentUserId);

            if (myPlayerRowsError) throw myPlayerRowsError;

            const { data: myAdminRows, error: myAdminRowsError } = await supabase
                .from('partidos')
                .select('id')
                .eq('creado_por', currentUserId);

            if (myAdminRowsError) throw myAdminRowsError;

            const myMatchIds = Array.from(new Set([
                ...(myPlayerRows || []).map((r) => r.partido_id),
                ...(myAdminRows || []).map((r) => r.id),
            ].filter(Boolean)));

            if (myMatchIds.length === 0) {
                setMatches([]);
                return;
            }

            const { data: clearedRows } = await supabase
                .from('cleared_matches')
                .select('partido_id')
                .eq('user_id', currentUserId);
            const clearedIds = new Set((clearedRows || []).map((r) => String(r.partido_id)));

            const { data: partidosData, error: partidosError } = await supabase
                .from(QUIERO_JUGAR_OPEN_MATCHES_VIEW)
                .select('id, nombre, fecha, hora, sede, modalidad, cupo_jugadores, tipo_partido, creado_por, codigo')
                .in('id', myMatchIds)
                .order('kickoff_at', { ascending: true });

            if (partidosError) throw partidosError;

            const dedupedMatchesMap = new Map();
            (partidosData || []).forEach((match) => {
                if (match?.id != null && !dedupedMatchesMap.has(String(match.id))) {
                    dedupedMatchesMap.set(String(match.id), match);
                }
            });
            const dedupedMatches = Array.from(dedupedMatchesMap.values());

            if (dedupedMatches.length === 0) {
                setMatches([]);
                return;
            }

            const dedupedMatchIds = dedupedMatches.map((m) => m.id);
            const dedupedMatchIdTexts = new Set(dedupedMatchIds.map((id) => String(id)));
            const { data: jugadoresData, error: jugadoresError } = await supabase
                .from('jugadores')
                .select('id, partido_id, usuario_id')
                .in('partido_id', dedupedMatchIds);

            if (jugadoresError) throw jugadoresError;

            const { data: extInviteRows, error: extInviteError } = await supabase
                .from('notifications_ext')
                .select('type, match_id_text, data, send_at, created_at')
                .eq('user_id', targetUserId)
                .in('type', ['match_invite', 'match_kicked'])
                .in('match_id_text', Array.from(dedupedMatchIdTexts));

            if (extInviteError && extInviteError.code !== '42P01') throw extInviteError;

            let inviteRows = extInviteRows || [];
            if (extInviteError && extInviteError.code === '42P01') {
                const { data: fallbackInviteRows, error: fallbackInviteError } = await supabase
                    .from('notifications')
                    .select('type, partido_id, match_ref, data, send_at, created_at')
                    .eq('user_id', targetUserId)
                    .in('type', ['match_invite', 'match_kicked']);
                if (fallbackInviteError) throw fallbackInviteError;
                inviteRows = fallbackInviteRows || [];
            }

            const inviteStatesByMatch = buildInviteStateByMatch(
                inviteRows.filter((row) => dedupedMatchIdTexts.has(resolveNotificationMatchIdText(row) || '')),
            );
            const matchesWithStatus = dedupedMatches
                .filter((match) => {
                    if (!match?.id) return false;
                    if (clearedIds.has(String(match.id))) return false;
                    return true;
                })
                .map((match) => {
                    const playersInMatch = (jugadoresData || []).filter((j) => j.partido_id === match.id);
                    const isParticipating = playersInMatch.some((j) => j.usuario_id === targetUserId);
                    if (isParticipating) return null;

                    const inviteState = inviteStatesByMatch.get(String(match.id)) || EMPTY_MATCH_INVITE_STATE;
                    const starterCapacity = Number(match.cupo_jugadores || 20);
                    const maxRosterSlots = starterCapacity > 0 ? starterCapacity + 4 : 0;
                    const isRosterFull = maxRosterSlots > 0 && playersInMatch.length >= maxRosterSlots;
                    let inviteStatus = 'available';
                    if (inviteState.hasPendingInvite) inviteStatus = 'already_pending';
                    else if (isRosterFull) inviteStatus = 'roster_full';

                    return {
                        ...match,
                        jugadores_count: playersInMatch.length,
                        inviteState,
                        isRosterFull,
                        inviteStatus,
                        canInvite: inviteStatus === 'available',
                        fecha_display: formatLocalDateShort(match.fecha),
                    };
                })
                .filter(Boolean)
                .sort((left, right) => {
                    if (left.canInvite === right.canInvite) return 0;
                    return left.canInvite ? -1 : 1;
                });

            setMatches(matchesWithStatus);

            // Auto-select if there is only 1 match
            const availableMatches = matchesWithStatus.filter((match) => match.canInvite);
            if (availableMatches.length === 1) {
                setSelectedMatchId(availableMatches[0].id);
            }
        } catch (error) {
            logger.error('[INVITE_MODAL] Error fetching matches:', error);
            notifyBlockingError('Error al cargar los partidos');
        } finally {
            setLoading(false);
        }
    };

    const handleInvite = async () => {
        const match = matches.find((m) => m.id === selectedMatchId);
        if (!match) return;
        if (!targetUserId) {
            notifyBlockingError('No se pudo identificar al jugador para invitar');
            return;
        }
        if (!match.canInvite) {
            showMatchAvailabilityNotice(match, targetName);
            await fetchUserMatches();
            return;
        }

        setInviting(true);
        try {
            const starterCapacity = Number(match.cupo_jugadores || 20);
            const maxRosterSlots = starterCapacity > 0 ? starterCapacity + 4 : 0;
            if (maxRosterSlots > 0) {
                const { count: currentPlayersCount, error: countError } = await supabase
                    .from('jugadores')
                    .select('id', { count: 'exact', head: true })
                    .eq('partido_id', match.id);
                if (countError) throw countError;
                if ((currentPlayersCount || 0) >= maxRosterSlots) {
                    showInviteNotice({
                        title: 'Partido sin cupos',
                        message: `Ya no hay cupos disponibles en "${match?.nombre || 'este partido'}".`,
                    });
                    await fetchUserMatches();
                    return;
                }
            }

            const { data: currentUser } = await supabase
                .from('usuarios')
                .select('nombre')
                .eq('id', currentUserId)
                .maybeSingle();

            const { data, error } = await supabase.rpc('send_match_invite', {
                p_user_id: targetUserId,
                p_partido_id: Number(match.id),
                p_title: 'Invitación a partido',
                p_message: `${currentUser?.nombre || 'Alguien'} te invitó a jugar el ${match.fecha_display} a las ${match.hora}`,
                p_invite_mode: 'direct',
            });

            if (error) throw error;

            const inviteResult = normalizeSendMatchInviteResult(data);
            if (inviteResult === 'sent' || inviteResult === 'reinvited') {
                requestImmediatePushDispatchSafe({
                    eventType: 'match_invite',
                    matchId: Number(match.id),
                    recipientUserId: targetUserId,
                    limit: 20,
                });
                track('match_invite_sent', {
                    match_id: Number(match.id),
                    recipient_user_id: String(targetUserId || '').trim() || undefined,
                    source: 'invite_to_match_modal',
                    invite_result: inviteResult,
                });
                showInviteResultNotice({
                    status: inviteResult,
                    targetName,
                    matchName: match?.nombre,
                });
                onClose();
                return;
            }

            showInviteResultNotice({
                status: inviteResult,
                targetName,
                matchName: match?.nombre,
            });
            await fetchUserMatches();
        } catch (error) {
            logger.error('[INVITE_MODAL] Error sending invitation:', error);
            handleInviteRpcError(error);
        } finally {
            setInviting(false);
        }
    };

    const selectedMatch = matches.find(m => m.id === selectedMatchId);
    const canSubmit = Boolean(selectedMatchId) && Boolean(selectedMatch?.canInvite) && !inviting;


    const footerContent = (
        <div className="w-full">
            <div className="w-full flex flex-col items-center gap-2">
                <button
                    className={PRIMARY_ACTION_BUTTON_CLASS}
                    onClick={handleInvite}
                    disabled={!canSubmit}
                >
                    {inviting ? <LoadingSpinner size="small" /> : null}
                    <span>{inviting ? 'Enviando...' : 'Invitar al partido'}</span>
                </button>

                <button
                    className={SECONDARY_ACTION_BUTTON_CLASS}
                    onClick={onClose}
                    disabled={inviting}
                >
                    <span>Cancelar</span>
                </button>
            </div>
        </div>
    );

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title=""
            footer={footerContent}
            className="w-full max-w-[460px] !bg-[#101a35] border border-[rgba(148,134,255,0.28)]"
            classNameContent="p-4 overflow-x-hidden"
        >
            <div className="mb-3 px-1">
                <div className="flex items-center gap-2 mb-1">
                    <CalendarDays size={16} className="text-[#1fa0ff]" />
                    <h3 className={`${SECTION_TITLE_CLASS} m-0`}>
                        Invitar a jugador
                    </h3>
                </div>
                <p className="text-white/60 text-[11px] font-oswald tracking-[0.01em] truncate">
                    {subtitleText}
                </p>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-4 bg-white/[0.05] rounded-none border border-[rgba(148,134,255,0.28)]">
                    <LoadingSpinner size="lg" />
                    <p className="text-white/40 text-[11px] font-oswald tracking-[0.01em] animate-pulse">
                        Buscando tus partidos...
                    </p>
                </div>
            ) : matches.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 px-6 text-center bg-white/[0.05] rounded-none border border-[rgba(148,134,255,0.28)] border-dashed">
                    <p className="text-white/50 text-sm leading-relaxed mb-1">
                        No tenés partidos abiertos disponibles para invitar.
                    </p>
                    <p className="text-white/35 text-xs">No se muestran partidos vencidos ni partidos donde este jugador ya forma parte de la nómina.</p>
                </div>
            ) : (
                <div className="flex flex-col gap-2.5">
                    {matches.map((match) => {
                        const isSelected = selectedMatchId === match.id;
                        return (
                            <MatchSelectionCard
                                key={match.id}
                                match={match}
                                isSelected={isSelected}
                                onSelect={() => {
                                    if (inviting) return;
                                    if (match.canInvite) {
                                        setSelectedMatchId(match.id);
                                        return;
                                    }
                                    showMatchAvailabilityNotice(match, targetName);
                                }}
                                inviteStatus={match.inviteStatus}
                            />
                        );
                    })}
                </div>
            )}
        </Modal>
    );
};

export default InviteToMatchModal;
