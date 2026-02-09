import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabase';
import { toast } from 'react-toastify';
import LoadingSpinner from '../LoadingSpinner';

/**
 * Join requests section component
 * @param {Object} props - Component props
 */
const SolicitudesSection = ({ partidoActual, onRequestAccepted }) => {
    const [requests, setRequests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(new Set());

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
                .select('id, nombre, partidos_jugados')
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
        }
    };

    const handleReject = async (request) => {
        if (processing.has(request.id)) return;

        setProcessing(prev => new Set(prev).add(request.id));

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
        } catch (error) {
            console.error('Error rejecting request:', error);
            toast.error('Error al rechazar solicitud');
        } finally {
            setProcessing(prev => {
                const newSet = new Set(prev);
                newSet.delete(request.id);
                return newSet;
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
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 w-[90vw] max-w-[90vw] mx-auto">
                <div className="flex flex-col items-center justify-center text-center">
                    <div className="text-5xl mb-4 opacity-40">📬</div>
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
        <div className="w-[90vw] max-w-[90vw] mx-auto">
            <div className="flex flex-col gap-3">
                {requests.map((request) => {
                    const userName = request.profile?.nombre || request.usuario?.nombre || 'Un jugador';
                    const avatarUrl = request.profile?.avatar_url;

                    // Extract rating and PJ from estadisticas (JSONB)
                    const estadisticas = request.profile?.estadisticas || {};
                    const rating = estadisticas.rating || null;
                    const pj = estadisticas.pj || request.usuario?.partidos_jugados || null;

                    const isProcessing = processing.has(request.id);

                    return (
                        <div
                            key={request.id}
                            className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-3"
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
                            <div className="flex flex-col gap-2 flex-shrink-0">
                                <button
                                    className="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-bebas tracking-wider rounded-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed min-w-[80px]"
                                    onClick={() => handleAccept(request)}
                                    disabled={isProcessing}
                                >
                                    {isProcessing ? 'ACEPTANDO...' : 'ACEPTAR'}
                                </button>
                                <button
                                    className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-white/80 text-xs font-bebas tracking-wider rounded-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed min-w-[80px]"
                                    onClick={() => handleReject(request)}
                                    disabled={isProcessing}
                                >
                                    {isProcessing ? 'RECHAZANDO...' : 'RECHAZAR'}
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default SolicitudesSection;
