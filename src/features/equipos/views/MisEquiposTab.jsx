import React, { useCallback, useEffect, useMemo, useState } from 'react';
import TeamCard from '../components/TeamCard';
import TeamFormModal from '../components/TeamFormModal';
import {
  addTeamMember,
  createTeam,
  listMyTeams,
  listRosterCandidates,
  listTeamHistoryByRival,
  listTeamMembers,
  removeTeamMember,
  softDeleteTeam,
  updateTeam,
  updateTeamMember,
} from '../../../services/db/teamChallenges';
import { uploadTeamCrest } from '../../../services/storage/teamCrests';
import { notifyBlockingError } from '../../../utils/notifyBlockingError';
import EmptyStateCard from '../../../components/EmptyStateCard';
import Button from '../../../components/Button';
import { Users } from 'lucide-react';

const compactActionClass = 'w-auto px-3 h-9 rounded-xl text-xs font-oswald tracking-wide';

const EMPTY_NEW_MEMBER = {
  jugadorId: '',
  role: 'player',
  isCaptain: false,
  shirtNumber: '',
};

const toStringId = (value) => (value == null ? '' : String(value));

const summarizeTeamFromHistory = (historyByRival) => {
  return (historyByRival || []).reduce((acc, entry) => {
    acc.played += Number(entry?.summary?.played || 0);
    acc.won += Number(entry?.summary?.won || 0);
    acc.draw += Number(entry?.summary?.draw || 0);
    acc.lost += Number(entry?.summary?.lost || 0);
    return acc;
  }, { played: 0, won: 0, draw: 0, lost: 0 });
};

const roleOptions = [
  { value: 'captain', label: 'Capitan' },
  { value: 'gk', label: 'Arquero' },
  { value: 'defender', label: 'Defensor' },
  { value: 'mid', label: 'Mediocampo' },
  { value: 'forward', label: 'Delantero' },
  { value: 'player', label: 'Jugador' },
];

const MisEquiposTab = ({ userId, onOpenDesafiosWithTeam }) => {
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [teams, setTeams] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [members, setMembers] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [historyByRival, setHistoryByRival] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [teamFormOpen, setTeamFormOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState(null);
  const [newMember, setNewMember] = useState(EMPTY_NEW_MEMBER);

  const loadTeams = async () => {
    if (!userId) return;

    try {
      setLoading(true);
      const rows = await listMyTeams(userId);
      setTeams(rows);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudieron cargar tus equipos');
    } finally {
      setLoading(false);
    }
  };

  const loadTeamDetail = useCallback(async (team) => {
    if (!team?.id) return;

    try {
      setDetailLoading(true);
      const [teamMembers, allCandidates, history] = await Promise.all([
        listTeamMembers(team.id),
        listRosterCandidates(),
        listTeamHistoryByRival(team.id),
      ]);

      setMembers(teamMembers);
      setCandidates(allCandidates);
      setHistoryByRival(history);
      setNewMember(EMPTY_NEW_MEMBER);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo cargar el detalle del equipo');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTeams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const occupiedJugadorIds = useMemo(() => new Set(members.map((member) => toStringId(member.jugador_id))), [members]);

  const availableCandidates = useMemo(
    () => candidates.filter((candidate) => !occupiedJugadorIds.has(toStringId(candidate.jugador_id))),
    [candidates, occupiedJugadorIds],
  );

  const summaryStats = useMemo(() => summarizeTeamFromHistory(historyByRival), [historyByRival]);

  const handleCreateOrUpdateTeam = async (payload, crestFile) => {
    if (!userId) return;

    try {
      setIsSaving(true);

      let persistedTeam;
      if (editingTeam?.id) {
        persistedTeam = await updateTeam(editingTeam.id, payload);
      } else {
        persistedTeam = await createTeam(userId, payload);
      }

      if (crestFile) {
        const crestUrl = await uploadTeamCrest({
          file: crestFile,
          userId,
          teamId: persistedTeam.id,
        });

        persistedTeam = await updateTeam(persistedTeam.id, {
          ...persistedTeam,
          ...payload,
          crest_url: crestUrl,
        });
      }

      await loadTeams();
      setTeamFormOpen(false);
      setEditingTeam(null);

      if (selectedTeam?.id && selectedTeam.id === persistedTeam.id) {
        setSelectedTeam(persistedTeam);
        await loadTeamDetail(persistedTeam);
      }
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo guardar el equipo');
    } finally {
      setIsSaving(false);
    }
  };

  const refreshSelectedTeam = async () => {
    if (!selectedTeam?.id) return;
    await loadTeamDetail(selectedTeam);
  };

  const handleSelectTeam = useCallback(async (team) => {
    if (!team?.id) return;
    setSelectedTeam(team);
    await loadTeamDetail(team);
  }, [loadTeamDetail]);

  return (
    <div className="w-full max-w-[560px] flex flex-col gap-3">
      <div className="rounded-2xl border border-white/15 bg-white/5 p-3 flex items-center justify-between gap-2">
        <h3 className="text-white font-oswald text-lg">Mis equipos</h3>
        <Button
          type="button"
          onClick={() => {
            setEditingTeam(null);
            setTeamFormOpen(true);
          }}
          className={compactActionClass}
        >
          + Crear equipo
        </Button>
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
          description="Todavía no creaste equipos para jugar desafíos."
          className="my-0 p-5"
        />
      ) : null}

      {!loading && teams.length > 0 ? (
        <div className="grid gap-2">
          {teams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              onClick={handleSelectTeam}
            />
          ))}
        </div>
      ) : null}

      {selectedTeam ? (
        <div className="rounded-2xl border border-white/15 bg-[#0f172acc] p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h4 className="text-white font-oswald text-xl">{selectedTeam.name}</h4>
              <p className="text-xs text-white/70 uppercase tracking-wide">
                F{selectedTeam.format} · {selectedTeam.skill_level} · {selectedTeam.base_zone || 'sin zona'}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditingTeam(selectedTeam);
                  setTeamFormOpen(true);
                }}
                className="rounded-lg border border-white/20 bg-white/5 text-white text-xs font-semibold px-3 py-1.5"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    setIsSaving(true);
                    await softDeleteTeam(selectedTeam.id);
                    setSelectedTeam(null);
                    await loadTeams();
                  } catch (error) {
                    notifyBlockingError(error.message || 'No se pudo desactivar el equipo');
                  } finally {
                    setIsSaving(false);
                  }
                }}
                className="rounded-lg border border-red-300/45 bg-red-500/10 text-red-200 text-xs font-semibold px-3 py-1.5"
              >
                Desactivar
              </button>
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3 flex flex-wrap items-center gap-2 justify-between">
            <p className="text-sm text-white/80">Plantilla fija y historial oficial del equipo.</p>
            <button
              type="button"
              onClick={() => onOpenDesafiosWithTeam?.(selectedTeam.id)}
              className="rounded-lg bg-[#128BE9] text-white text-xs font-semibold px-3 py-2 hover:brightness-110"
            >
              Publicar desafio
            </button>
          </div>

          <div className="mt-4">
            <h5 className="text-white font-semibold">Plantilla</h5>
            {detailLoading ? (
              <p className="text-sm text-white/65 mt-2">Cargando plantilla...</p>
            ) : null}

            {!detailLoading ? (
              <div className="mt-2 space-y-2">
                {members.length === 0 ? (
                  <p className="text-sm text-white/65">Aun no hay jugadores en este equipo.</p>
                ) : members.map((member) => (
                  <div key={member.id} className="rounded-xl border border-white/10 bg-white/5 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-white text-sm font-semibold truncate">{member.jugador?.nombre || 'Jugador'}</p>
                        <p className="text-[11px] text-white/60">ID jugador: {member.jugador_id}</p>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            setIsSaving(true);
                            await removeTeamMember(member.id);
                            await refreshSelectedTeam();
                          } catch (error) {
                            notifyBlockingError(error.message || 'No se pudo remover el jugador');
                          } finally {
                            setIsSaving(false);
                          }
                        }}
                        className="text-xs text-red-300"
                        disabled={isSaving}
                      >
                        Quitar
                      </button>
                    </div>

                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <select
                        value={member.role}
                        onChange={(event) => {
                          const role = event.target.value;
                          setMembers((prev) => prev.map((item) => (item.id === member.id ? { ...item, role } : item)));
                        }}
                        className="rounded-lg bg-slate-900/80 border border-white/20 px-2 py-2 text-xs text-white"
                      >
                        {roleOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>

                      <label className="flex items-center gap-2 rounded-lg border border-white/20 bg-slate-900/70 px-2 py-2 text-xs text-white">
                        <input
                          type="checkbox"
                          checked={Boolean(member.is_captain)}
                          onChange={(event) => {
                            const isCaptain = event.target.checked;
                            setMembers((prev) => prev.map((item) => {
                              if (item.id === member.id) return { ...item, is_captain: isCaptain };
                              return isCaptain ? { ...item, is_captain: false } : item;
                            }));
                          }}
                        />
                        Capitan
                      </label>

                      <input
                        type="number"
                        min={0}
                        max={99}
                        value={member.shirt_number ?? ''}
                        onChange={(event) => {
                          const parsed = event.target.value === '' ? null : Number(event.target.value);
                          setMembers((prev) => prev.map((item) => (item.id === member.id ? { ...item, shirt_number: parsed } : item)));
                        }}
                        placeholder="Nro"
                        className="rounded-lg bg-slate-900/80 border border-white/20 px-2 py-2 text-xs text-white"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          setIsSaving(true);
                          await updateTeamMember(member.id, {
                            role: member.role,
                            is_captain: member.is_captain,
                            shirt_number: member.shirt_number,
                          });
                          await refreshSelectedTeam();
                        } catch (error) {
                          notifyBlockingError(error.message || 'No se pudo actualizar el jugador del equipo');
                        } finally {
                          setIsSaving(false);
                        }
                      }}
                      className="mt-2 rounded-lg bg-[#128BE9] text-white text-xs font-semibold px-3 py-1.5"
                      disabled={isSaving}
                    >
                      Guardar rol
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <h6 className="text-white text-sm font-semibold">Agregar jugador</h6>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-4 gap-2">
                <select
                  value={newMember.jugadorId}
                  onChange={(event) => setNewMember((prev) => ({ ...prev, jugadorId: event.target.value }))}
                  className="sm:col-span-2 rounded-lg bg-slate-900/80 border border-white/20 px-2 py-2 text-xs text-white"
                >
                  <option value="">Seleccionar</option>
                  {availableCandidates.map((candidate) => (
                    <option key={candidate.jugador_id} value={candidate.jugador_id}>
                      {candidate.nombre}
                    </option>
                  ))}
                </select>

                <select
                  value={newMember.role}
                  onChange={(event) => setNewMember((prev) => ({ ...prev, role: event.target.value }))}
                  className="rounded-lg bg-slate-900/80 border border-white/20 px-2 py-2 text-xs text-white"
                >
                  {roleOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>

                <input
                  type="number"
                  min={0}
                  max={99}
                  value={newMember.shirtNumber}
                  onChange={(event) => setNewMember((prev) => ({ ...prev, shirtNumber: event.target.value }))}
                  placeholder="Nro"
                  className="rounded-lg bg-slate-900/80 border border-white/20 px-2 py-2 text-xs text-white"
                />
              </div>

              <label className="mt-2 inline-flex items-center gap-2 text-xs text-white/80">
                <input
                  type="checkbox"
                  checked={newMember.isCaptain}
                  onChange={(event) => setNewMember((prev) => ({ ...prev, isCaptain: event.target.checked }))}
                />
                Marcar como capitan
              </label>

              <button
                type="button"
                onClick={async () => {
                  if (!newMember.jugadorId) {
                    notifyBlockingError('Selecciona un jugador para agregar');
                    return;
                  }

                  try {
                    setIsSaving(true);
                    await addTeamMember({
                      teamId: selectedTeam.id,
                      jugadorId: newMember.jugadorId,
                      role: newMember.role,
                      isCaptain: newMember.isCaptain,
                      shirtNumber: newMember.shirtNumber ? Number(newMember.shirtNumber) : null,
                    });
                    await refreshSelectedTeam();
                    setNewMember(EMPTY_NEW_MEMBER);
                  } catch (error) {
                    notifyBlockingError(error.message || 'No se pudo agregar el jugador');
                  } finally {
                    setIsSaving(false);
                  }
                }}
                className="mt-2 rounded-lg bg-[#128BE9] text-white text-xs font-semibold px-3 py-2"
                disabled={isSaving}
              >
                Agregar a plantilla
              </button>
            </div>
          </div>

          <div className="mt-4">
            <h5 className="text-white font-semibold">Historial vs rivales</h5>
            <div className="mt-2 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/80">
              PJ {summaryStats.played} · PG {summaryStats.won} · PE {summaryStats.draw} · PP {summaryStats.lost}
            </div>

            <div className="mt-2 space-y-2">
              {historyByRival.length === 0 ? (
                <p className="text-sm text-white/65">Todavia no hay partidos registrados para este equipo.</p>
              ) : historyByRival.map((entry) => (
                <div key={entry.rivalId} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <p className="text-white font-semibold">{entry.rivalTeam?.name || 'Rival'}</p>
                  <p className="text-xs text-white/70">
                    PJ {entry.summary.played} · PG {entry.summary.won} · PE {entry.summary.draw} · PP {entry.summary.lost}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

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
    </div>
  );
};

export default MisEquiposTab;
