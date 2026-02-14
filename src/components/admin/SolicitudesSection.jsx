import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabase';
import { toast } from 'react-toastify';
import LoadingSpinner from '../LoadingSpinner';
import { Check, Loader2, X } from 'lucide-react';
import { PlayerCardTrigger } from '../ProfileComponents';

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

    useEffect(() => {
        fetchRequests();
    }, [partidoActual?.id]);

    const fetchRequests = async () => {
        if (!partidoActual?.id) return;

        try {
            setLoading(true);

            // Fetch pending requests
            const { data: requestsData, error: requestsError } = await supabase
                .from('match_join_requests')
                .select('id, match_id, user_id, status, created_at')
                .eq('match_id', partidoActual.id)
                .eq('status', 'pending')
                .order('created_at', { ascending: false });

            if (requestsError) throw requestsError;

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
                .select('id, nombre, avatar_url, posicion, ranking, partidos_jugados, pais_codigo, numero')
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
            console.error('Error fetching requests:', error);
            toast.error('Error al cargar solicitudes');
        } finally {
            setLoading(false);
        }
    };

    const handleAccept = async (request) => {
        if (processing.has(request.id)) return;

        setProcessing(prev => new Set(prev).add(request.id));
        setProcessingAction(prev => ({ ...prev, [request.id]: 'accept' }));

        try {
            const userName = request.profile?.nombre || request.usuario?.nombre || 'Jugador';

            console.log('[ACCEPT] Calling RPC approve_join_request:', {
                requestId: request.id,
                matchId: request.match_id,
                userId: request.user_id,
                userName,
            });

            // Call atomic RPC
            const { error: rpcError } = await supabase.rpc('approve_join_request', {
                p_request_id: request.id,
            });

            if (rpcError) {
                console.error('[ACCEPT] RPC Error:', rpcError);
                // Handle case where player is already in the match (Duplicate key)
                if (rpcError.code === '23505' || rpcError.message?.includes('unique constraint')) {
                    console.log('[ACCEPT] User already in match, treating as success');
                    toast.success('El jugador ya forma parte del partido');
                    // Continue to success UI logic
                } else {
                    toast.error(`Error al aceptar: ${rpcError.message}`);
                    throw rpcError;
                }
            }

            console.log('[ACCEPT] RPC approve_join_request completed successfully for request:', request.id);

            try {
                await supabase.from('notifications').insert([{
                    user_id: request.user_id,
                    type: 'match_join_approved',
                    title: 'Solicitud aprobada',
                    message: `Tu solicitud para unirte al partido fue aprobada`,
                    partido_id: request.match_id,
                    data: {
                        match_id: request.match_id,
                        matchId: request.match_id,
                        link: `/partido-publico/${request.match_id}`,
                    },
                    read: false,
                }]);
            } catch (notifError) {
                console.error('[ACCEPT] Could not send approval notification:', notifError);
            }

            // Refetch requests list immediately
            await fetchRequests();

            toast.success(`${userName} fue aceptado en el partido`);

            // Notify parent to refresh players and other data
            if (onRequestAccepted) {
                onRequestAccepted();
            }
            if (onRequestResolved) {
                onRequestResolved();
            }
        } catch (error) {
            console.error('[ACCEPT_REQUEST_RPC_ERROR]', {
                code: error.code,
                message: error.message,
                details: error.details,
                hint: error.hint,
            });

            toast.error('Error al aceptar la solicitud');
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

            toast.success(`Solicitud de ${userName} rechazada`);

            // Remove from list
            setRequests(prev => prev.filter(r => r.id !== request.id));

            if (onRequestResolved) {
                onRequestResolved();
            }
        } catch (error) {
            console.error('Error rejecting request:', error);
            toast.error('Error al rechazar solicitud');
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
                <LoadingSpinner size="medium" />
            </div>
        );
    }

    if (requests.length === 0) {
        return (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 w-full max-w-full mx-auto">
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

                    const isProcessing = processing.has(request.id);
                    const isAccepting = isProcessing && processingAction[request.id] === 'accept';
                    const isRejecting = isProcessing && processingAction[request.id] === 'reject';

                    const cardContent = (
                        <div
                            className={`bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-3 ${hasLinkedAccount ? 'hover:bg-slate-800/80 hover:border-slate-700 transition-all' : ''}`}
                        >
                            {/* Avatar */}
                            <div className="flex-shrink-0">
                                {avatarUrl ? (
                                    <img
                                        src={avatarUrl}
                                        alt={userName}
                                        className="w-12 h-12 rounded-full object-cover border-2 border-slate-700"
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
                                {(rating || pj) && (
                                    <div className="flex items-center gap-3 text-xs text-white/60 mt-0.5">
                                        {rating && (
                                            <span className="flex items-center gap-1">
                                                ⭐ {typeof rating === 'number' ? rating.toFixed(1) : rating}
                                            </span>
                                        )}
                                        {pj && (
                                            <span>
                                                {pj} PJ
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-2 flex-shrink-0">
                                <button
                                    className="h-11 w-11 rounded-xl border border-white/20 bg-[var(--btn-success)] text-white shadow-[0_8px_20px_rgba(39,174,96,0.35)] transition-all hover:brightness-110 hover:-translate-y-[1px] active:translate-y-0 active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
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
                                    className="h-11 w-11 rounded-xl border border-white/20 bg-[var(--btn-danger)] text-white shadow-[0_8px_20px_rgba(231,76,60,0.3)] transition-all hover:brightness-110 hover:-translate-y-[1px] active:translate-y-0 active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
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
