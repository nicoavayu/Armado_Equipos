import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { toBigIntId } from '../utils';
import { formatLocalDateShort } from '../utils/dateLocal';
import { toast } from 'react-toastify';
import Modal from './Modal';
import LoadingSpinner from './LoadingSpinner';
import MatchSelectionCard from './MatchSelectionCard';
import { CalendarDays, UserPlus, X } from 'lucide-react';

const InviteToMatchModal = ({ isOpen, onClose, friend, currentUserId }) => {
    const [matches, setMatches] = useState([]);
    const [loading, setLoading] = useState(false);
    const [inviting, setInviting] = useState(false);
    const [selectedMatchId, setSelectedMatchId] = useState(null);
    const targetProfile = friend?.profile || friend || null;
    const targetUserId = targetProfile?.id || targetProfile?.user_id || targetProfile?.uuid || null;
    const targetName = targetProfile?.nombre || friend?.nombre || 'jugador';

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
            // Fetch upcoming matches where the user is a participant or creator
            const { data: partidosData, error: partidosError } = await supabase
                .from('partidos_view')
                .select(`
          id, nombre, fecha, hora, sede, modalidad, cupo_jugadores, 
          tipo_partido, creado_por, precio_cancha_por_persona
        `)
                .gte('fecha', new Date().toISOString().split('T')[0])
                .order('fecha', { ascending: true })
                .order('hora', { ascending: true });

            if (partidosError) throw partidosError;

            if (partidosData.length === 0) {
                setMatches([]);
                return;
            }

            const partidoIds = partidosData.map((p) => p.id);
            const { data: jugadoresData, error: jugadoresError } = await supabase
                .from('jugadores')
                .select('id, partido_id, usuario_id')
                .in('partido_id', partidoIds);

            if (jugadoresError) throw jugadoresError;

            const userMatches = partidosData.filter((partido) => {
                const isCreator = partido.creado_por === currentUserId;
                const isPlayer = jugadoresData.some(
                    (j) => j.partido_id === partido.id && j.usuario_id === currentUserId
                );
                return isCreator || isPlayer;
            });

            const matchesWithStatus = await Promise.all(
                userMatches.map(async (match) => {
                    const playersInMatch = jugadoresData.filter((j) => j.partido_id === match.id);
                    const isParticipating = playersInMatch.some(
                        (j) => j.usuario_id === targetUserId
                    );

                    let hasInvitation = false;
                    if (match.id) {
                        const pid = Number(match.id);
                        const { data: notifications } = await supabase
                            .from('notifications')
                            .select('id')
                            .eq('user_id', targetUserId)
                            .eq('type', 'match_invite')
                            .or(`match_ref.eq.${pid},data->>matchId.eq.${pid}`);

                        hasInvitation = notifications && notifications.length > 0;
                    }

                    return {
                        ...match,
                        jugadores_count: playersInMatch.length,
                        isParticipating,
                        hasInvitation,
                        canInvite: !isParticipating && !hasInvitation,
                        fecha_display: formatLocalDateShort(match.fecha)
                    };
                })
            );

            setMatches(matchesWithStatus);

            // Auto-select if there is only 1 match
            if (matchesWithStatus.length === 1 && matchesWithStatus[0].canInvite) {
                setSelectedMatchId(matchesWithStatus[0].id);
            }
        } catch (error) {
            console.error('[INVITE_MODAL] Error fetching matches:', error);
            toast.error('Error al cargar los partidos');
        } finally {
            setLoading(false);
        }
    };

    const handleInvite = async () => {
        const match = matches.find((m) => m.id === selectedMatchId);
        if (!match) return;
        if (!targetUserId) {
            toast.error('No se pudo identificar al jugador para invitar');
            return;
        }

        // Logging before post
        console.log('[INVITE_DEBUG] Attempting invite:', {
            inviteStatus,
            selectedMatchId: match.id,
            friendId: friend.profile?.id
        });

        if (inviteStatus !== 'available') {
            console.warn('[INVITE_DEBUG] Invite not allowed, status is not available:', inviteStatus);
            return;
        }

        setInviting(true);
        try {
            const { data: targetUserRow, error: targetUserError } = await supabase
                .from('usuarios')
                .select('acepta_invitaciones')
                .eq('id', targetUserId)
                .maybeSingle();

            if (targetUserError) throw targetUserError;
            if (targetUserRow?.acepta_invitaciones === false) {
                toast.info(`${targetName} está en no disponible y no recibe invitaciones.`);
                return;
            }

            const { data: currentUser } = await supabase
                .from('usuarios')
                .select('nombre')
                .eq('id', currentUserId)
                .single();

            const notificationData = {
                user_id: targetUserId,
                type: 'match_invite',
                partido_id: Number(match.id),
                title: 'Invitación a partido',
                message: `${currentUser?.nombre || 'Alguien'} te invitó a jugar el ${match.fecha_display} a las ${match.hora}`,
                data: {
                    matchId: toBigIntId(match.id),
                    matchName: match.nombre,
                    matchDate: match.fecha,
                    matchTime: match.hora,
                    matchLocation: match.sede,
                    inviterId: currentUserId,
                    inviterName: currentUser?.nombre || 'Alguien',
                },
                read: false,
            };

            const { error } = await supabase.from('notifications').insert([notificationData]);

            if (error) {
                if (error.code === '23505') {
                    console.log('[INVITE_DEBUG] 409 Conflict (Duplicate):', error.message);
                    // Update local state to prevent further attempts
                    setMatches(prev => prev.map(m =>
                        m.id === selectedMatchId ? { ...m, hasInvitation: true, canInvite: false } : m
                    ));
                    toast.info('La invitación ya había sido enviada');
                    return;
                }
                throw error;
            }

            toast.success(`Invitación enviada a ${targetName}`);
            onClose();
        } catch (error) {
            console.error('[INVITE_MODAL] Error sending invitation:', error);
            toast.error('Error al enviar la invitación');
        } finally {
            setInviting(false);
        }
    };

    const selectedMatch = matches.find(m => m.id === selectedMatchId);
    const inviteStatus = selectedMatch ? (
        selectedMatch.isParticipating ? 'member' : (
            selectedMatch.hasInvitation ? 'invited_pending' : 'available'
        )
    ) : 'none';

    const canSubmit = inviteStatus === 'available' && !inviting;


    const getButtonLabel = () => {
        if (inviting) return <><LoadingSpinner size="sm" /> ENVIANDO...</>;
        if (inviteStatus === 'member') return 'YA FORMA PARTE';
        if (inviteStatus === 'invited_pending') return 'YA INVITADO';
        return 'INVITAR AL PARTIDO';
    };

    const footerContent = (
        <div className="h-[106px] flex flex-col justify-center items-center">
            {/* Status Message: Always present in DOM, visibility-controlled */}
            <div className={`min-h-[20px] mb-2 px-2 transition-opacity duration-300 ${inviteStatus === 'member' || inviteStatus === 'invited_pending' ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                <p className={`text-[11px] font-medium text-center leading-tight ${inviteStatus === 'member' ? 'text-emerald-500/80' : 'text-blue-400/80'
                    }`}>
                    {inviteStatus === 'member' ? 'Ya forma parte de este partido.' : 'Invitación enviada. Esperando confirmación.'}
                </p>
            </div>

            <div className="w-full flex flex-col items-center gap-2">
                <button
                    className={`w-full h-11 px-6 rounded-xl font-oswald text-sm font-bold uppercase tracking-wide transition-all duration-200 flex items-center justify-center gap-2 ${canSubmit
                        ? 'bg-[#128BE9] text-white shadow-lg shadow-[#128BE9]/25 hover:brightness-110 hover:-translate-y-px active:scale-[0.98]'
                        : 'bg-white/5 text-white/25 cursor-not-allowed border border-white/10'
                        }`}
                    onClick={handleInvite}
                    disabled={!canSubmit}
                >
                    {!inviting && <UserPlus size={16} />}
                    {getButtonLabel()}
                </button>

                <button
                    className="text-[10px] font-semibold text-white/45 hover:text-white/70 transition-colors uppercase tracking-widest inline-flex items-center gap-1"
                    onClick={onClose}
                    disabled={inviting}
                >
                    <X size={12} />
                    Cancelar
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
            className="w-full max-w-[460px] !bg-[#101a35] border border-white/15 rounded-3xl"
            classNameContent="p-4 overflow-x-hidden"
        >
            <div className="mb-3 px-1">
                <div className="flex items-center gap-2 mb-1">
                    <CalendarDays size={16} className="text-[#1fa0ff]" />
                    <h3 className="font-oswald text-[24px] leading-none tracking-wide text-white m-0 uppercase whitespace-nowrap">
                        Invitar a jugador
                    </h3>
                </div>
                <p className="text-white/60 text-[11px] font-oswald uppercase tracking-wider truncate">
                    Elegí uno de tus partidos para invitar a {targetName}
                </p>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-4 bg-white/5 rounded-2xl border border-white/10">
                    <LoadingSpinner size="lg" />
                    <p className="text-white/40 text-[11px] font-oswald uppercase tracking-widest animate-pulse">
                        Buscando tus partidos...
                    </p>
                </div>
            ) : matches.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 px-6 text-center bg-white/5 rounded-2xl border border-white/10 border-dashed">
                    <p className="text-white/50 text-sm leading-relaxed mb-1">
                        No tenés partidos próximos creados o donde seas admin.
                    </p>
                    <p className="text-white/35 text-xs">Creá uno nuevo y volvé a intentar.</p>
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
                                onSelect={() => !inviting && setSelectedMatchId(match.id)}
                                inviteStatus={match.isParticipating ? 'member' : (match.hasInvitation ? 'invited_pending' : 'available')}
                            />
                        );
                    })}
                </div>
            )}
        </Modal>
    );
};

export default InviteToMatchModal;
