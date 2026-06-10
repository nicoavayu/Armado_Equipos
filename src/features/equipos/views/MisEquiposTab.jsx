import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, MoreVertical, Shield, Trash2, Users, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import TeamCard from '../components/TeamCard';
import TeamFormModal from '../components/TeamFormModal';
import Button from '../../../components/Button';
import ConfirmModal from '../../../components/ConfirmModal';
import EmptyStateCard from '../../../components/EmptyStateCard';
import {
  acceptTeamInvitation,
  addCurrentUserAsTeamMember,
  createTeam,
  listAccessibleTeams,
  listIncomingTeamInvitations,
  listTeamMemberCountsByTeamIds,
  rejectTeamInvitation,
  softDeleteTeam,
  updateTeam,
} from '../../../services/db/teamChallenges';
import { uploadTeamCrest } from '../../../services/storage/teamCrests';
import { notifyBlockingError } from '../../../utils/notifyBlockingError';
import { useRefreshOnVisibility } from '../../../hooks/useRefreshOnVisibility';
import { useSupabaseRealtime } from '../../../hooks/useSupabaseRealtime';
import { useNotifications } from '../../../context/NotificationContext';

const createTeamButtonClass = '!w-full !h-auto !min-h-[44px] !px-4 !py-2.5 !rounded-none !border !border-[#7d5aff] !bg-[#6a43ff] !text-white !font-bebas !text-base !tracking-[0.01em] !normal-case !shadow-[0_0_14px_rgba(106,67,255,0.3)] hover:!bg-[#7550ff] sm:!text-[13px] sm:!px-3 sm:!py-2 sm:!min-h-[36px]';
const invitationAcceptIconButtonClass = 'h-11 w-11 rounded-none border border-[#7d5aff] bg-[#6a43ff] text-white shadow-[0_0_14px_rgba(106,67,255,0.3)] transition-all hover:bg-[#7550ff] hover:-translate-y-[1px] active:translate-y-0 active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center';
const invitationRejectIconButtonClass = 'h-11 w-11 rounded-none border border-[rgba(148,134,255,0.2)] bg-[rgba(23,35,74,0.72)] text-[rgba(242,246,255,0.9)] transition-all hover:bg-[rgba(31,45,91,0.82)] hover:-translate-y-[1px] active:translate-y-0 active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center';

const MisEquiposTab = ({ userId }) => {
  const navigate = useNavigate();
  const notificationsCtx = useNotifications() || {};
  const markTeamInvitationAsHandled = notificationsCtx.markTeamInvitationAsHandled;
  const realtimeRefreshTimeoutRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [teams, setTeams] = useState([]);
  const [incomingInvitations, setIncomingInvitations] = useState([]);

  const [teamFormOpen, setTeamFormOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState(null);
  const [openTeamMenuId, setOpenTeamMenuId] = useState(null);
  const [teamDeleteTarget, setTeamDeleteTarget] = useState(null);
  const [teamDeleteCascadeConfirmOpen, setTeamDeleteCascadeConfirmOpen] = useState(false);
  const [teamDeleteSuccess, setTeamDeleteSuccess] = useState(null);

  const loadTeams = useCallback(async ({
    withLoading = true,
    silent = false,
  } = {}) => {
    if (!userId) return;

    try {
      if (withLoading) setLoading(true);
      const rows = await listAccessibleTeams(userId);
      let enrichedRows = rows || [];

      try {
        const countsByTeamId = await listTeamMemberCountsByTeamIds(enrichedRows.map((team) => team?.id));
        enrichedRows = enrichedRows.map((team) => {
          const teamId = String(team?.id || '');
          return {
            ...team,
            member_count: countsByTeamId[teamId] ?? 0,
          };
        });
      } catch (countError) {
        console.warn('[MIS_EQUIPOS] No se pudo cargar la cantidad de jugadores por equipo:', countError);
      }

      setTeams(enrichedRows);
      setOpenTeamMenuId((prev) => (enrichedRows.some((team) => team.id === prev) ? prev : null));
    } catch (error) {
      if (!silent) {
        notifyBlockingError(error.message || 'No se pudieron cargar tus equipos');
      } else {
        console.warn('[MIS_EQUIPOS] refresh de equipos fallido', error);
      }
    } finally {
      if (withLoading) setLoading(false);
    }
  }, [userId]);

  const loadIncomingInvitations = useCallback(async ({
    silent = false,
  } = {}) => {
    if (!userId) return;

    try {
      const rows = await listIncomingTeamInvitations(userId);
      setIncomingInvitations(rows || []);
    } catch (error) {
      if (!silent) {
        notifyBlockingError(error.message || 'No se pudieron cargar tus invitaciones de equipo');
      } else {
        console.warn('[MIS_EQUIPOS] refresh de invitaciones fallido', error);
      }
    }
  }, [userId]);

  const refreshTeamDashboard = useCallback(async ({
    withLoading = false,
    silent = false,
  } = {}) => {
    await Promise.all([
      loadTeams({ withLoading, silent }),
      loadIncomingInvitations({ silent }),
    ]);
  }, [loadIncomingInvitations, loadTeams]);

  useEffect(() => {
    refreshTeamDashboard({ withLoading: true });
  }, [refreshTeamDashboard]);

  useEffect(() => {
    if (!openTeamMenuId) return undefined;

    const closeMenu = () => setOpenTeamMenuId(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [openTeamMenuId]);

  const scheduleRealtimeRefresh = useCallback(() => {
    window.clearTimeout(realtimeRefreshTimeoutRef.current);
    realtimeRefreshTimeoutRef.current = window.setTimeout(() => {
      refreshTeamDashboard({ withLoading: false, silent: true });
    }, 140);
  }, [refreshTeamDashboard]);

  useEffect(() => (
    () => {
      window.clearTimeout(realtimeRefreshTimeoutRef.current);
    }
  ), []);

  useRefreshOnVisibility(
    () => {
      refreshTeamDashboard({ withLoading: false, silent: true });
    },
    {
      enabled: Boolean(userId),
    },
  );

  useSupabaseRealtime({
    enabled: Boolean(userId),
    channelName: `mis-equipos-${userId}`,
    deps: [userId, scheduleRealtimeRefresh],
    events: [
      {
        event: '*',
        schema: 'public',
        table: 'team_invitations',
        filter: `invited_user_id=eq.${userId}`,
        handler: () => {
          scheduleRealtimeRefresh();
        },
      },
      {
        event: '*',
        schema: 'public',
        table: 'team_members',
        filter: `user_id=eq.${userId}`,
        handler: () => {
          scheduleRealtimeRefresh();
        },
      },
      {
        event: '*',
        schema: 'public',
        table: 'teams',
        filter: `owner_user_id=eq.${userId}`,
        handler: () => {
          scheduleRealtimeRefresh();
        },
      },
    ],
  });

  const handleCreateOrUpdateTeam = async (payload, crestFile, options = {}) => {
    if (!userId) return;

    try {
      setIsSaving(true);

      let persistedTeam;
      const shouldAutoAddCurrentUser = !editingTeam?.id && Boolean(options?.addCurrentUserAsPlayer);
      if (editingTeam?.id) {
        persistedTeam = await updateTeam(editingTeam.id, payload);
      } else {
        persistedTeam = await createTeam(userId, payload);

        if (shouldAutoAddCurrentUser) {
          try {
            await addCurrentUserAsTeamMember({
              teamId: persistedTeam.id,
              userId,
              permissionsRole: 'member',
              role: 'player',
              isCaptain: true,
            });
          } catch (autoAddError) {
            console.warn('[MIS_EQUIPOS] Equipo creado, pero no se pudo auto-agregar al usuario:', autoAddError);
            notifyBlockingError('Equipo creado, pero no pudimos agregarte automaticamente a la plantilla');
          }
        }
      }

      if (crestFile) {
        const crestUrl = await uploadTeamCrest({
          file: crestFile,
          userId,
          teamId: persistedTeam.id,
        });

        await updateTeam(persistedTeam.id, {
          ...persistedTeam,
          ...payload,
          crest_url: crestUrl,
        });
      }

      await loadTeams({ withLoading: false });
      setTeamFormOpen(false);
      setEditingTeam(null);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo guardar el equipo');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteTeam = async () => {
    if (!teamDeleteTarget?.id) return;
    try {
      setIsSaving(true);
      const deleteResult = await softDeleteTeam(teamDeleteTarget.id);
      const canceledChallenges = Number(deleteResult?.canceledChallenges || 0);
      const canceledTeamMatches = Number(deleteResult?.canceledTeamMatches || 0);
      const effectiveCanceledPending = canceledChallenges > 0 ? canceledChallenges : canceledTeamMatches;

      setOpenTeamMenuId(null);
      setTeamDeleteTarget(null);
      setTeamDeleteCascadeConfirmOpen(false);
      await loadTeams({ withLoading: false });
      setTeamDeleteSuccess({
        canceledPending: effectiveCanceledPending,
      });
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo borrar el equipo');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAcceptIncomingInvitation = async (invitationId) => {
    try {
      setIsSaving(true);
      await acceptTeamInvitation(invitationId);
      setIncomingInvitations((prev) => prev.filter((invitation) => invitation.id !== invitationId));
      await Promise.all([
        Promise.resolve(markTeamInvitationAsHandled?.(invitationId)),
        loadTeams({ withLoading: false }),
        loadIncomingInvitations(),
      ]);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo aceptar la invitacion');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRejectIncomingInvitation = async (invitationId) => {
    try {
      setIsSaving(true);
      await rejectTeamInvitation(invitationId);
      setIncomingInvitations((prev) => prev.filter((invitation) => invitation.id !== invitationId));
      await Promise.all([
        Promise.resolve(markTeamInvitationAsHandled?.(invitationId)),
        loadIncomingInvitations(),
      ]);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo rechazar la invitacion');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div className="w-full max-w-[560px] flex flex-col gap-3">
        <Button
          type="button"
          onClick={() => {
            setEditingTeam(null);
            setTeamFormOpen(true);
          }}
          className={createTeamButtonClass}
        >
          Crear nuevo equipo
        </Button>

        {incomingInvitations.length > 0 ? (
          <>
            <h5 className="text-white font-oswald text-lg">Invitaciones de equipo</h5>
            <div className="space-y-2">
              {incomingInvitations.map((invitation) => {
                const teamName = invitation?.team?.name || invitation?.team_name || invitation?.teamName || 'Equipo';
                const teamCrestUrl = invitation?.team?.crest_url || invitation?.team_crest_url || invitation?.teamCrestUrl || null;
                const inviterName = invitation?.invited_by_user?.nombre || invitation?.invited_by_name || invitation?.invitedByName || 'Un usuario';

                return (
                  <div
                    key={invitation.id}
                    className="flex items-center gap-3 p-4 rounded-none bg-[rgba(4,31,89,0.95)] border border-[#12b5ff]/80 mb-3 w-full box-border min-h-[64px] transition-all duration-200 shadow-[0_0_0_1px_rgba(52,167,255,0.16),0_10px_22px_rgba(2,10,34,0.45)] hover:border-[#56d1ff] sm:p-3"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-11 h-11 rounded-none overflow-hidden border border-white/20 bg-black/20 flex items-center justify-center shrink-0 sm:w-10 sm:h-10">
                        {teamCrestUrl ? (
                          <img src={teamCrestUrl} alt={`Escudo ${teamName}`} className="h-full w-full object-cover" />
                        ) : (
                          <Shield size={16} className="text-white/60" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-white font-oswald text-[16px] truncate sm:text-base">{teamName}</p>
                        <p className="text-[11px] text-white/65 truncate">
                          {`${inviterName} te invito a formar parte del equipo`}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleAcceptIncomingInvitation(invitation.id)}
                        className={invitationAcceptIconButtonClass}
                        disabled={isSaving}
                        aria-label={isSaving ? 'Aceptando invitacion' : 'Aceptar invitacion'}
                        title={isSaving ? 'Aceptando invitacion...' : 'Aceptar invitacion'}
                      >
                        {isSaving ? (
                          <Loader2 size={18} className="animate-spin" />
                        ) : (
                          <Check size={19} strokeWidth={3} />
                        )}
                      </button>
                      <button
                        type="button"
                        className={invitationRejectIconButtonClass}
                        onClick={() => handleRejectIncomingInvitation(invitation.id)}
                        disabled={isSaving}
                        aria-label={isSaving ? 'Rechazando invitacion' : 'Rechazar invitacion'}
                        title={isSaving ? 'Rechazando invitacion...' : 'Rechazar invitacion'}
                      >
                        {isSaving ? (
                          <Loader2 size={18} className="animate-spin" />
                        ) : (
                          <X size={19} strokeWidth={3} />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : null}

        <div className="mt-1 mb-0.5 flex items-center gap-2.5 px-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
            Equipos creados
          </span>
          <span className="h-px flex-1 bg-[rgba(148,134,255,0.2)]" />
        </div>

        {loading ? (
          <div className="rounded-2xl border border-white/15 bg-white/5 p-4 text-center text-white/70">
            Cargando equipos...
          </div>
        ) : null}

        {!loading && teams.length === 0 ? (
          <EmptyStateCard
            icon={Users}
            title="Sin equipos"
            description="Todavia no creaste equipos para jugar desafios."
            className="my-0 p-5"
          />
        ) : null}

        {!loading && teams.length > 0 ? (
          <div className="grid gap-2">
            {teams.map((team) => (
              <div key={team.id} className="relative">
                <TeamCard
                  team={team}
                  onClick={() => navigate(`/desafios/equipos/${team.id}`, {
                    state: {
                      equiposSubtab: 'mis-equipos',
                      backTo: '/desafios',
                      backToState: {
                        equiposSubtab: 'mis-equipos',
                      },
                    },
                  })}
                  className="pr-14"
                />

                {team.owner_user_id === userId ? (
                  <div className="absolute right-3 top-3 z-20" onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 items-center justify-center border-0 bg-transparent p-0 text-[#1ec8ff] transition-colors hover:text-[#6ddcff]"
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpenTeamMenuId((prev) => (prev === team.id ? null : team.id));
                      }}
                      aria-label="Abrir menu del equipo"
                      title="Mas acciones"
                    >
                      <MoreVertical size={15} />
                    </button>

                    {openTeamMenuId === team.id ? (
                      <div className="absolute right-0 mt-2 w-44 rounded-xl border border-slate-700 bg-slate-900 shadow-lg">
                        <button
                          type="button"
                          className="w-full inline-flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-200 transition-all hover:bg-slate-800"
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpenTeamMenuId(null);
                            setTeamDeleteTarget(team);
                            setTeamDeleteCascadeConfirmOpen(false);
                          }}
                          disabled={isSaving}
                        >
                          <Trash2 size={14} />
                          Borrar equipo
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <TeamFormModal
        isOpen={teamFormOpen}
        initialTeam={editingTeam}
        onClose={() => {
          setTeamFormOpen(false);
          setEditingTeam(null);
        }}
        onSubmit={handleCreateOrUpdateTeam}
        isSubmitting={isSaving}
      />

      <ConfirmModal
        isOpen={Boolean(teamDeleteTarget) && !teamDeleteCascadeConfirmOpen}
        title="Borrar equipo"
        message={`¿Querés borrar el equipo "${teamDeleteTarget?.name || 'Sin nombre'}"?`}
        confirmText="Aceptar"
        cancelText="Cancelar"
        danger
        isDeleting={isSaving}
        onConfirm={() => {
          if (isSaving) return;
          setTeamDeleteCascadeConfirmOpen(true);
        }}
        onCancel={() => {
          if (isSaving) return;
          setTeamDeleteTarget(null);
          setTeamDeleteCascadeConfirmOpen(false);
        }}
      />

      <ConfirmModal
        isOpen={Boolean(teamDeleteTarget) && teamDeleteCascadeConfirmOpen}
        title="Desafíos pendientes"
        message="Al borrar el equipo se borrarán todos los desafíos pendientes que tenga vinculados. ¿Querés continuar?"
        confirmText="Aceptar"
        cancelText="Cancelar"
        danger
        isDeleting={isSaving}
        onConfirm={handleDeleteTeam}
        onCancel={() => {
          if (isSaving) return;
          setTeamDeleteTarget(null);
          setTeamDeleteCascadeConfirmOpen(false);
        }}
      />

      <ConfirmModal
        isOpen={Boolean(teamDeleteSuccess)}
        title="Equipo borrado"
        message={`Equipo borrado. Se cancelaron ${teamDeleteSuccess?.canceledPending || 0} desafío${Number(teamDeleteSuccess?.canceledPending || 0) === 1 ? '' : 's'} pendiente${Number(teamDeleteSuccess?.canceledPending || 0) === 1 ? '' : 's'}.`}
        confirmText="Aceptar"
        singleButton
        onConfirm={() => setTeamDeleteSuccess(null)}
        onCancel={() => setTeamDeleteSuccess(null)}
      />
    </>
  );
};

export default MisEquiposTab;
