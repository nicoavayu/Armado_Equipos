import logger from '../../utils/logger';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { friendlyError } from '../../utils/friendlyError';
import { supabase } from '../../supabase';
import LoadingSpinner from '../LoadingSpinner';
import { Check, Loader2, X } from 'lucide-react';
import { PlayerCardTrigger } from '../ProfileComponents';
import { notifyBlockingError } from 'utils/notifyBlockingError';
import { notifyAdminPlayerJoined } from '../../services/matchJoinNotificationService';
import { useRefreshOnVisibility } from '../../hooks/useRefreshOnVisibility';
import { useSupabaseRealtime } from '../../hooks/useSupabaseRealtime';
import { useInterval } from '../../hooks/useInterval';
import { fetchPendingMatchJoinRequests } from '../../services/db/matchJoinRequests';
import { formatPlayerRating } from '../../utils/playerRating';
import { getDisplayPositions, getPositionColor } from '../../utils/positions';

const EmptyRequestsMailboxIcon = () => (
    <svg
        className="w-14 h-14 text-white/45"
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
    >
        <path d="M18 56V29.5C18 21.5 24.5 15 32.5 15H36.5C44.5 15 51 21.5 51 29.5V56H18Z" fill="currentColor" />
        <path d="M18 56V29.5C18 21.5 24.5 15 32.5 15H36.5C44.5 15 51 21.5 51 29.5V56H18Z" stroke="white" strokeOpacity="0.28" strokeWidth="2.5" />
        <path d="M18 56H51L46.5 60H22.5L18 56Z" fill="currentColor" fillOpacity="0.65" />
        <path d="M26 56H34V63H26V56Z" fill="currentColor" fillOpacity="0.7" />
        <path d="M35 18H44.5V31C44.5 33.2 42.7 35 40.5 35H39C36.8 35 35 33.2 35 31V18Z" fill="#EF4444" />
        <path d="M24 32H45" stroke="white" strokeOpacity="0.24" strokeWidth="2" strokeLinecap="round" />
    </svg>
);

/**
 * Join requests section component
 * @param {Object} props - Component props
 */
const SolicitudesSection = ({ partidoActual, onRequestAccepted, onRequestResolved }) => {
    const [requests, setRequests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(new Set());
    const [processingAction, setProcessingAction] = useState({});
    const matchId = Number(partidoActual?.id);
    const fetchInFlightRef = useRef(false);
    const queuedSilentRefreshRef = useRef(false);
    const { setIntervalSafe, clearIntervalSafe } = useInterval();

    const fetchRequests = useCallback(async ({ silent = false } = {}) => {
        if (!partidoActual?.id) return;
        if (fetchInFlightRef.current) {
            if (silent) {
                queuedSilentRefreshRef.current = true;
            }
            return;
        }

        try {
            fetchInFlightRef.current = true;
            if (!silent) {
                setLoading(true);
            }

            // Fetch pending requests
            const requestsData = await fetchPendingMatchJoinRequests(partidoActual.id);

            if (!requestsData || requestsData.length === 0) {
                setRequests([]);
                setLoading(false);
                return;
            }

            const userIds = requestsData.map(r => r.user_id);

            // Fetch profiles data
            const { data: profilesData, error: profilesError } = await supabase
                .from('profiles')
                .select('id, nombre, avatar_url, estadisticas')
                .in('id', userIds);

            if (profilesError) throw profilesError;

            // Fetch usuarios data as fallback
            const { data: usuariosData, error: usuariosError } = await supabase
                .from('usuarios')
                .select('id, nombre, avatar_url, posicion, posiciones, ranking, partidos_jugados, pais_codigo, numero')
                .in('id', userIds);

            if (usuariosError) throw usuariosError;

            // Merge data
            const enrichedRequests = requestsData.map(request => {
                const profile = profilesData?.find(p => p.id === request.user_id);
                const usuario = usuariosData?.find(u => u.id === request.user_id);

                return {
                    ...request,
                    profile,
                    usuario,
                };
            });

            setRequests(enrichedRequests);
        } catch (error) {
            logger.error('Error fetching requests:', error);
            if (!silent) {
                notifyBlockingError('Error al cargar solicitudes');
            }
        } finally {
            fetchInFlightRef.current = false;
            if (!silent) {
                setLoading(false);
            }
            if (queuedSilentRefreshRef.current) {
                queuedSilentRefreshRef.current = false;
                void fetchRequests({ silent: true });
            }
        }
    }, [partidoActual?.id]);

    useEffect(() => {
        fetchRequests();
    }, [fetchRequests]);

    useRefreshOnVisibility(() => {
        fetchRequests({ silent: true });
    }, {
        enabled: Boolean(matchId),
    });

    useEffect(() => {
        if (!matchId) {
            clearIntervalSafe();
            return undefined;
        }

        setIntervalSafe(() => {
            if (document.visibilityState !== 'visible') return;
            fetchRequests({ silent: true });
        }, 2500);

        return clearIntervalSafe;
    }, [clearIntervalSafe, fetchRequests, matchId, setIntervalSafe]);

    const realtimeEvents = useMemo(() => (
        matchId ? [
            {
                event: '*',
                schema: 'public',
                table: 'match_join_requests',
                filter: `match_id=eq.${matchId}`,
                handler: () => {
                    fetchRequests({ silent: true });
                },
            },
        ] : []
    ), [fetchRequests, matchId]);

    useSupabaseRealtime({
        enabled: Boolean(matchId),
        channelName: matchId ? `admin-match-requests-${matchId}` : null,
        deps: [matchId],
        events: realtimeEvents,
    });

    const handleAccept = async (request) => {
        if (processing.has(request.id)) return;

        setProcessing(prev => new Set(prev).add(request.id));
        setProcessingAction(prev => ({ ...prev, [request.id]: 'accept' }));

        try {
            const userName = request.profile?.nombre || request.usuario?.nombre || 'Jugador';

            const { data: approvalData, error: approvalError } = await supabase.functions.invoke('approve-join-request', {
                body: {
                    request_id: request.id,
                },
            });

            if (approvalError) {
                logger.error('[ACCEPT] approve-join-request error:', approvalError);
                notifyBlockingError(friendlyError(approvalError, 'No se pudo aprobar la solicitud. Intentá de nuevo.'));
                throw approvalError;
            }

            if (!approvalData?.ok) {
                const message = approvalData?.message || 'No se pudo aprobar la solicitud';
                notifyBlockingError(`Error al aceptar: ${message}`);
                throw new Error(message);
            }

            if (approvalData?.status !== 'already_in_match') {
                await notifyAdminPlayerJoined({
                    matchId: request.match_id,
                    playerName: userName,
                    playerUserId: request.user_id,
                    joinedVia: 'admin_approval',
                });
            }

            // Refetch requests list immediately
            await fetchRequests();

            // Notify parent to refresh players and other data
            if (onRequestAccepted) {
                onRequestAccepted();
            }
            if (onRequestResolved) {
                onRequestResolved();
            }
        } catch (error) {
            logger.error('[ACCEPT_REQUEST_RPC_ERROR]', {
                code: error.code,
                message: error.message,
                details: error.details,
                hint: error.hint,
            });

            notifyBlockingError('Error al aceptar la solicitud');
        } finally {
            setProcessing(prev => {
                const newSet = new Set(prev);
                newSet.delete(request.id);
                return newSet;
            });
            setProcessingAction(prev => {
                const next = { ...prev };
                delete next[request.id];
                return next;
            });
        }
    };

    const handleReject = async (request) => {
        if (processing.has(request.id)) return;

        setProcessing(prev => new Set(prev).add(request.id));
        setProcessingAction(prev => ({ ...prev, [request.id]: 'reject' }));

        try {
            const { error } = await supabase
                .from('match_join_requests')
                .update({ status: 'rejected' })
                .eq('id', request.id);

            if (error) throw error;

            const userName = request.profile?.nombre || request.usuario?.nombre || 'Jugador';

            // Remove from list
            setRequests(prev => prev.filter(r => r.id !== request.id));

            if (onRequestResolved) {
                onRequestResolved();
            }
        } catch (error) {
            logger.error('Error rejecting request:', error);
            notifyBlockingError('Error al rechazar solicitud');
        } finally {
            setProcessing(prev => {
                const newSet = new Set(prev);
                newSet.delete(request.id);
                return newSet;
            });
            setProcessingAction(prev => {
                const next = { ...prev };
                delete next[request.id];
                return next;
            });
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center py-12">
                <LoadingSpinner size="medium" fullScreen />
            </div>
        );
    }

    if (requests.length === 0) {
        return (
            <div className="surface-card rounded-card p-8 w-full max-w-full mx-auto">
                <div className="flex flex-col items-center justify-center text-center">
                    <div className="mb-4">
                        <EmptyRequestsMailboxIcon />
                    </div>
                    <p className="text-white font-oswald text-base font-semibold mb-2">
                        No hay solicitudes pendientes
                    </p>
                    <p className="text-white/60 text-sm max-w-[280px]">
                        Cuando alguien pida unirse al partido, va a aparecer acá.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full max-w-full mx-auto">
            <div className="flex flex-col gap-3">
                {requests.map((request) => {
                    const userName = request.profile?.nombre || request.usuario?.nombre || 'Un jugador';
                    const avatarUrl = request.profile?.avatar_url || request.usuario?.avatar_url || null;
                    const hasLinkedAccount = Boolean(request.user_id);
                    const profileForCard = {
                        ...request.usuario,
                        ...request.profile,
                        id: request.user_id || request.profile?.id || request.usuario?.id || null,
                        user_id: request.user_id || request.profile?.id || request.usuario?.id || null,
                        usuario_id: request.user_id || request.profile?.id || request.usuario?.id || null,
                        nombre: userName,
                        avatar_url: avatarUrl || null,
                    };

                    // Extract rating and PJ from estadisticas (JSONB)
                    const estadisticas = request.profile?.estadisticas || {};
                    const rating = estadisticas.rating || null;
                    const pj = estadisticas.pj || request.usuario?.partidos_jugados || null;
                    const requestPositions = getDisplayPositions(request.usuario || {});
                    const joiningAsGoalkeeper = request.role === 'goalkeeper';

                    const isProcessing = processing.has(request.id);
                    const isAccepting = isProcessing && processingAction[request.id] === 'accept';
                    const isRejecting = isProcessing && processingAction[request.id] === 'reject';

                    const cardContent = (
                        <div
                            className={`bg-[linear-gradient(165deg,rgba(48,38,98,0.68),rgba(20,16,41,0.92))] border border-[rgba(148,134,255,0.18)] rounded-card shadow-elev-1 p-3.5 flex items-center gap-3 ${hasLinkedAccount ? 'hover:brightness-[1.06] hover:border-[rgba(148,134,255,0.45)] transition-all' : ''}`}
                        >
                            {/* Avatar */}
                            <div className="flex-shrink-0">
                                {avatarUrl ? (
                                    <img
                                        src={avatarUrl}
                                        alt={userName}
                                        className="w-12 h-12 rounded-full object-cover border-2 border-[rgba(148,134,255,0.35)]"
                                    />
                                ) : (
                                    <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center text-white text-lg font-bold">
                                        {userName.charAt(0).toUpperCase()}
                                    </div>
                                )}
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                                <div className="font-oswald text-white font-semibold text-base truncate">
                                    {userName}
                                </div>
                                <div className="flex items-center gap-1.5 flex-wrap mt-1">
                                    {requestPositions.map((pos) => (
                                        <span
                                            key={pos}
                                            className="inline-flex items-center justify-center px-1.5 py-[2px] rounded-full text-[9px] font-bold text-white uppercase tracking-[0.04em]"
                                            style={{ backgroundColor: getPositionColor(pos) }}
                                        >
                                            {pos}
                                        </span>
                                    ))}
                                    {rating && (
                                        <span className="flex items-center gap-1 text-xs text-white/60">
                                            ⭐ {formatPlayerRating(rating)}
                                        </span>
                                    )}
                                    {pj && (
                                        <span className="text-xs text-white/60">{pj} PJ</span>
                                    )}
                                </div>
                                {joiningAsGoalkeeper && (
                                    <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.04em] text-[#ffd88a]">
                                        <span className="w-1.5 h-1.5 rounded-full bg-[#FDB022]" aria-hidden="true" />
                                        Se suma como arquero
                                    </div>
                                )}
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-2 flex-shrink-0">
                                <button
                                    className="h-11 w-11 rounded-full border border-[#7d5aff] bg-cta-gradient text-white shadow-[0_4px_14px_rgba(106,67,255,0.4)] transition-all hover:brightness-110 hover:-translate-y-[1px] active:translate-y-0 active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleAccept(request);
                                    }}
                                    disabled={isProcessing}
                                    aria-label={isAccepting ? 'Aceptando solicitud' : 'Aceptar solicitud'}
                                    title={isAccepting ? 'Aceptando solicitud...' : 'Aceptar solicitud'}
                                >
                                    {isAccepting ? (
                                        <Loader2 size={18} className="animate-spin" />
                                    ) : (
                                        <Check size={19} strokeWidth={3} />
                                    )}
                                </button>
                                <button
                                    className="h-11 w-11 rounded-full border border-[rgba(148,134,255,0.28)] bg-white/[0.05] text-white/85 transition-all hover:bg-white/[0.1] hover:-translate-y-[1px] active:translate-y-0 active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleReject(request);
                                    }}
                                    disabled={isProcessing}
                                    aria-label={isRejecting ? 'Rechazando solicitud' : 'Rechazar solicitud'}
                                    title={isRejecting ? 'Rechazando solicitud...' : 'Rechazar solicitud'}
                                >
                                    {isRejecting ? (
                                        <Loader2 size={18} className="animate-spin" />
                                    ) : (
                                        <X size={19} strokeWidth={3} />
                                    )}
                                </button>
                            </div>
                        </div>
                    );

                    if (!hasLinkedAccount) {
                        return (
                            <div key={request.id}>
                                {cardContent}
                            </div>
                        );
                    }

                    return (
                        <PlayerCardTrigger
                            key={request.id}
                            profile={profileForCard}
                            partidoActual={partidoActual}
                        >
                            {cardContent}
                        </PlayerCardTrigger>
                    );
                })}
            </div>
        </div>
    );
};

export default SolicitudesSection;
