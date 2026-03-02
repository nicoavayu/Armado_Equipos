import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { toBigIntId } from '../utils';
import { formatLocalDateShort, parseLocalDateTime } from '../utils/dateLocal';
import Modal from './Modal';
import LoadingSpinner from './LoadingSpinner';
import MatchSelectionCard from './MatchSelectionCard';
import { CalendarDays, UserPlus, X } from 'lucide-react';
import { notifyBlockingError } from 'utils/notifyBlockingError';

const PRIMARY_ACTION_BUTTON_CLASS = 'w-full min-h-[44px] px-4 py-2.5 rounded-none border border-[#7d5aff] bg-[#6a43ff] text-white font-bebas text-base tracking-[0.01em] transition-all inline-flex items-center justify-center gap-2 hover:bg-[#7550ff] active:opacity-95 shadow-[0_0_14px_rgba(106,67,255,0.3)] disabled:bg-[rgba(106,67,255,0.55)] disabled:border-[rgba(125,90,255,0.5)] disabled:text-white/40 disabled:shadow-none disabled:cursor-not-allowed';
const SECONDARY_ACTION_BUTTON_CLASS = 'w-full min-h-[44px] px-4 py-2.5 rounded-none border border-[rgba(98,117,184,0.58)] bg-[rgba(20,31,70,0.82)] text-white/92 font-bebas text-base tracking-[0.01em] transition-all inline-flex items-center justify-center gap-2 hover:bg-[rgba(30,45,94,0.95)] active:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed';

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
                .from('partidos')
                .select('id, nombre, fecha, hora, sede, modalidad, cupo_jugadores, tipo_partido, creado_por, precio_cancha_por_persona, estado, deleted_at')
                .in('id', myMatchIds)
                .order('fecha', { ascending: true })
                .order('hora', { ascending: true });

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
            const { data: jugadoresData, error: jugadoresError } = await supabase
                .from('jugadores')
                .select('id, partido_id, usuario_id')
                .in('partido_id', dedupedMatchIds);

            if (jugadoresError) throw jugadoresError;

            const { data: pendingInviteRows, error: pendingInviteRowsError } = await supabase
                .from('notifications')
                .select('match_ref, data')
                .eq('user_id', targetUserId)
                .eq('type', 'match_invite')
                .eq('read', false);

            if (pendingInviteRowsError) throw pendingInviteRowsError;

            const pendingInviteMatchIds = new Set(
                (pendingInviteRows || [])
                    .map((row) => {
                        const fromRef = row?.match_ref;
                        const fromData = row?.data?.matchId;
                        return String(fromRef ?? fromData ?? '').trim();
                    })
                    .filter(Boolean)
            );

            const now = new Date();
            const matchesWithStatus = dedupedMatches
                .filter((match) => {
                    if (!match?.id) return false;
                    if (clearedIds.has(String(match.id))) return false;

                    const estado = String(match.estado || '').toLowerCase();
                    if (['cancelado', 'cancelled', 'deleted'].includes(estado) || match.deleted_at) {
                        return false;
                    }

                    if (!match.fecha || !match.hora) return true;

                    const matchDateTime = parseLocalDateTime(match.fecha, match.hora);
                    if (!matchDateTime) return true;

                    const oneHourAfter = new Date(matchDateTime.getTime() + 60 * 60 * 1000);
                    return now <= oneHourAfter;
                })
                .map((match) => {
                    const playersInMatch = (jugadoresData || []).filter((j) => j.partido_id === match.id);
                    const isParticipating = playersInMatch.some((j) => j.usuario_id === targetUserId);
                    const hasInvitation = pendingInviteMatchIds.has(String(match.id));
                    const starterCapacity = Number(match.cupo_jugadores || 20);
                    const maxRosterSlots = starterCapacity > 0 ? starterCapacity + 4 : 0;
                    const isRosterFull = maxRosterSlots > 0 && playersInMatch.length >= maxRosterSlots;

                    return {
                        ...match,
                        jugadores_count: playersInMatch.length,
                        isParticipating,
                        hasInvitation,
                        isRosterFull,
                        canInvite: !isParticipating && !hasInvitation && !isRosterFull,
                        fecha_display: formatLocalDateShort(match.fecha),
                    };
                })
                .filter((match) => match.canInvite);

            setMatches(matchesWithStatus);

            // Auto-select if there is only 1 match
            if (matchesWithStatus.length === 1 && matchesWithStatus[0].canInvite) {
                setSelectedMatchId(matchesWithStatus[0].id);
            }
        } catch (error) {
            console.error('[INVITE_MODAL] Error fetching matches:', error);
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
            console.info('Ese partido ya no tiene cupos disponibles.');
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
                    console.info('El partido ya está completo (titulares y suplentes).');
                    await fetchUserMatches();
                    return;
                }
            }

            const { data: targetUserRow, error: targetUserError } = await supabase
                .from('usuarios')
                .select('acepta_invitaciones')
                .eq('id', targetUserId)
                .maybeSingle();

            if (targetUserError) throw targetUserError;
            if (targetUserRow?.acepta_invitaciones === false) {
                console.info(`${targetName} está en no disponible y no recibe invitaciones.`);
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
                    console.info('La invitación ya había sido enviada');
                    return;
                }
                throw error;
            }

            console.info(`Invitación enviada a ${targetName}`);
            onClose();
        } catch (error) {
            console.error('[INVITE_MODAL] Error sending invitation:', error);
            notifyBlockingError('Error al enviar la invitación');
        } finally {
            setInviting(false);
        }
    };

    const selectedMatch = matches.find(m => m.id === selectedMatchId);
    const canSubmit = Boolean(selectedMatchId) && !inviting;


    const footerContent = (
        <div className="w-full">
            <div className="w-full flex flex-col items-center gap-2">
                <button
                    className={PRIMARY_ACTION_BUTTON_CLASS}
                    onClick={handleInvite}
                    disabled={!canSubmit}
                >
                    {inviting ? <LoadingSpinner size="small" /> : <UserPlus size={16} />}
                    <span>{inviting ? 'Enviando...' : 'Invitar al partido'}</span>
                </button>

                <button
                    className={SECONDARY_ACTION_BUTTON_CLASS}
                    onClick={onClose}
                    disabled={inviting}
                >
                    <X size={13} />
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
            className="w-full max-w-[460px] !bg-[#101a35] border border-[rgba(98,117,184,0.58)]"
            classNameContent="p-4 overflow-x-hidden"
        >
            <div className="mb-3 px-1">
                <div className="flex items-center gap-2 mb-1">
                    <CalendarDays size={16} className="text-[#1fa0ff]" />
                    <h3 className="font-oswald text-[24px] leading-none tracking-[0.01em] text-white m-0 whitespace-nowrap">
                        Invitar a jugador
                    </h3>
                </div>
                <p className="text-white/60 text-[11px] font-oswald tracking-[0.01em] truncate">
                    Elegí uno de tus partidos para invitar a {targetName}
                </p>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-4 bg-[rgba(20,31,70,0.82)] rounded-none border border-[rgba(98,117,184,0.58)]">
                    <LoadingSpinner size="lg" />
                    <p className="text-white/40 text-[11px] font-oswald tracking-[0.01em] animate-pulse">
                        Buscando tus partidos...
                    </p>
                </div>
            ) : matches.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 px-6 text-center bg-[rgba(20,31,70,0.82)] rounded-none border border-[rgba(98,117,184,0.58)] border-dashed">
                    <p className="text-white/50 text-sm leading-relaxed mb-1">
                        No tenés partidos activos disponibles para invitar.
                    </p>
                    <p className="text-white/35 text-xs">Solo se muestran tus partidos vigentes donde se puede invitar.</p>
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
                                inviteStatus="available"
                            />
                        );
                    })}
                </div>
            )}
        </Modal>
    );
};

export default InviteToMatchModal;
