import React, { useCallback, useEffect, useState } from 'react';
import { MoreVertical, Trash2, Users } from 'lucide-react';
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

const createTeamButtonClass = 'w-full h-12 rounded-xl text-[18px] font-oswald font-semibold tracking-[0.01em] !normal-case';

const MisEquiposTab = ({ userId }) => {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [teams, setTeams] = useState([]);
  const [incomingInvitations, setIncomingInvitations] = useState([]);

  const [teamFormOpen, setTeamFormOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState(null);
  const [openTeamMenuId, setOpenTeamMenuId] = useState(null);
  const [teamDeleteTarget, setTeamDeleteTarget] = useState(null);

  const loadTeams = useCallback(async () => {
    if (!userId) return;

    try {
      setLoading(true);
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
      notifyBlockingError(error.message || 'No se pudieron cargar tus equipos');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const loadIncomingInvitations = useCallback(async () => {
    if (!userId) return;

    try {
      const rows = await listIncomingTeamInvitations(userId);
      setIncomingInvitations(rows || []);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudieron cargar tus invitaciones de equipo');
    }
  }, [userId]);

  useEffect(() => {
    loadTeams();
    loadIncomingInvitations();
  }, [loadIncomingInvitations, loadTeams]);

  useEffect(() => {
    if (!openTeamMenuId) return undefined;

    const closeMenu = () => setOpenTeamMenuId(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [openTeamMenuId]);

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

      await loadTeams();
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
      await softDeleteTeam(teamDeleteTarget.id);
      setOpenTeamMenuId(null);
      setTeamDeleteTarget(null);
      await loadTeams();
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
      await Promise.all([loadTeams(), loadIncomingInvitations()]);
      console.info('Te uniste al equipo');
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
      await loadIncomingInvitations();
      console.info('Invitacion rechazada');
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo rechazar la invitacion');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div className="w-full max-w-[560px] flex flex-col gap-3">
        <div className="rounded-2xl border border-white/15 bg-[linear-gradient(135deg,rgba(49,57,108,0.52),rgba(34,43,88,0.46))] p-3">
          <Button
            type="button"
            onClick={() => {
              setEditingTeam(null);
              setTeamFormOpen(true);
            }}
            className={createTeamButtonClass}
          >
            Crear equipo
          </Button>
        </div>

        {incomingInvitations.length > 0 ? (
          <div className="rounded-2xl border border-white/15 bg-[#0f172acc] p-3">
            <h5 className="text-white font-oswald text-lg">Invitaciones de equipo</h5>
            <div className="mt-2 space-y-2">
              {incomingInvitations.map((invitation) => (
                <div key={invitation.id} className="rounded-xl border border-white/15 bg-white/5 p-3">
                  <div className="flex items-center gap-2">
                    <div className="h-10 w-10 rounded-lg overflow-hidden border border-white/20 bg-black/20 flex items-center justify-center shrink-0">
                      {invitation?.team?.crest_url ? (
                        <img src={invitation.team.crest_url} alt={`Escudo ${invitation?.team?.name || 'equipo'}`} className="h-full w-full object-cover" />
                      ) : (
                        <Users size={16} className="text-white/60" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-white font-oswald text-[16px] truncate">{invitation?.team?.name || 'Equipo'}</p>
                      <p className="text-[11px] text-white/65 truncate">
                        Invita {invitation?.invited_by_user?.nombre || 'un capitan'}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      onClick={() => handleAcceptIncomingInvitation(invitation.id)}
                      className="!h-10 !text-[15px]"
                      loading={isSaving}
                      disabled={isSaving}
                    >
                      Aceptar
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="!h-10 !text-[15px]"
                      onClick={() => handleRejectIncomingInvitation(invitation.id)}
                      disabled={isSaving}
                    >
                      Rechazar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

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
                  onClick={() => navigate(`/quiero-jugar/equipos/${team.id}`)}
                  className="pr-14"
                />

                {team.owner_user_id === userId ? (
                  <div className="absolute right-3 top-3 z-20" onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-700 bg-slate-900/80 text-slate-200 transition-all hover:border-slate-500 hover:bg-slate-800 hover:text-white"
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
        isOpen={Boolean(teamDeleteTarget)}
        title="Borrar equipo"
        message={`¿Querés borrar el equipo "${teamDeleteTarget?.name || 'Sin nombre'}"?`}
        confirmText="Borrar"
        cancelText="Cancelar"
        danger
        isDeleting={isSaving}
        onConfirm={handleDeleteTeam}
        onCancel={() => {
          if (isSaving) return;
          setTeamDeleteTarget(null);
        }}
      />
    </>
  );
};

export default MisEquiposTab;
