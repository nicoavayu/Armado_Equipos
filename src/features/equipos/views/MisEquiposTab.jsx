import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, ChevronDown, Crown, MoreVertical, Pencil, Trash2, UserPlus, Users } from 'lucide-react';
import TeamCard from '../components/TeamCard';
import TeamFormModal from '../components/TeamFormModal';
import Modal from '../../../components/Modal';
import PlayerMiniCard from '../../../components/PlayerMiniCard';
import {
  acceptTeamInvitation,
  addTeamMember,
  createTeam,
  ensureLocalTeamPlayerByName,
  listAccessibleTeams,
  listIncomingTeamInvitations,
  listTeamPendingInvitations,
  listTeamHistoryByRival,
  listTeamMembers,
  removeTeamMember,
  revokeTeamInvitation,
  rejectTeamInvitation,
  sendTeamInvitation,
  softDeleteTeam,
  updateTeam,
  updateTeamMember,
} from '../../../services/db/teamChallenges';
import { getAmigos } from '../../../services/db/friends';
import { uploadTeamCrest, uploadTeamMemberPhoto } from '../../../services/storage/teamCrests';
import { notifyBlockingError } from '../../../utils/notifyBlockingError';
import EmptyStateCard from '../../../components/EmptyStateCard';
import Button from '../../../components/Button';
import { formatSkillLevelLabel, getTeamAccent, getTeamGradientStyle } from '../utils/teamColors';

const createTeamButtonClass = 'w-full h-12 rounded-xl text-[18px] font-oswald font-semibold tracking-[0.01em] !normal-case';
const modalActionButtonClass = 'h-12 rounded-xl text-[18px] font-oswald font-semibold tracking-[0.01em] !normal-case';
const optionCardClass = 'w-full rounded-xl border border-white/15 bg-white/5 p-3 text-left transition-all hover:bg-white/10';

const EMPTY_NEW_MEMBER = {
  jugadorId: '',
  permissionsRole: 'member',
  role: 'player',
  isCaptain: false,
  shirtNumber: '',
};

const ROLE_OPTIONS = [
  { value: 'player', label: 'Sin definir', short: 'SD' },
  { value: 'gk', label: 'Arquero', short: 'AR' },
  { value: 'rb', label: 'Lateral derecho', short: 'LD' },
  { value: 'cb', label: 'Zaguero central', short: 'ZC' },
  { value: 'lb', label: 'Lateral izquierdo', short: 'LI' },
  { value: 'dm', label: 'Volante defensivo', short: 'VD' },
  { value: 'cm', label: 'Mediocampista', short: 'MC' },
  { value: 'am', label: 'Enganche', short: 'EN' },
  { value: 'rw', label: 'Extremo derecho', short: 'ED' },
  { value: 'lw', label: 'Extremo izquierdo', short: 'EI' },
  { value: 'st', label: 'Delantero centro', short: 'DC' },
];

const LEGACY_ROLE_TO_FORM_ROLE = {
  captain: 'player',
  defender: 'cb',
  mid: 'cm',
  forward: 'st',
};

const ROLE_TO_POSITION = {
  gk: 'ARQ',
  rb: 'DEF',
  cb: 'DEF',
  lb: 'DEF',
  defender: 'DEF',
  dm: 'MED',
  cm: 'MED',
  am: 'MED',
  mid: 'MED',
  rw: 'DEL',
  lw: 'DEL',
  st: 'DEL',
  forward: 'DEL',
  player: 'DEF',
  captain: 'DEF',
};

const toStringId = (value) => (value == null ? '' : String(value));
const normalizeSearchValue = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const getRoleOption = (roleValue) => (
  ROLE_OPTIONS.find((option) => option.value === roleValue)
  || ROLE_OPTIONS.find((option) => option.value === LEGACY_ROLE_TO_FORM_ROLE[roleValue])
  || ROLE_OPTIONS[0]
);

const normalizeRoleForForm = (roleValue) => {
  if (!roleValue) return 'player';
  if (ROLE_OPTIONS.some((option) => option.value === roleValue)) return roleValue;
  return LEGACY_ROLE_TO_FORM_ROLE[roleValue] || 'player';
};

const summarizeTeamFromHistory = (historyByRival) => {
  return (historyByRival || []).reduce((acc, entry) => {
    acc.played += Number(entry?.summary?.played || 0);
    acc.won += Number(entry?.summary?.won || 0);
    acc.draw += Number(entry?.summary?.draw || 0);
    acc.lost += Number(entry?.summary?.lost || 0);
    return acc;
  }, { played: 0, won: 0, draw: 0, lost: 0 });
};

const getRoleLabel = (roleValue) => getRoleOption(roleValue).label;

const getMemberAvatar = (member) => member?.photo_url || member?.jugador?.avatar_url || null;

const getMemberProfilePosition = (member) => ROLE_TO_POSITION[member?.role] || 'DEF';

const MisEquiposTab = ({ userId, onOpenDesafiosWithTeam }) => {
  const memberPhotoInputRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [teams, setTeams] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [members, setMembers] = useState([]);
  const [historyByRival, setHistoryByRival] = useState([]);
  const [teamPendingInvitations, setTeamPendingInvitations] = useState([]);
  const [incomingInvitations, setIncomingInvitations] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [friendsLoading, setFriendsLoading] = useState(false);

  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailActionsMenuOpen, setDetailActionsMenuOpen] = useState(false);
  const [addMemberChoiceOpen, setAddMemberChoiceOpen] = useState(false);
  const [inviteMemberModalOpen, setInviteMemberModalOpen] = useState(false);
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [memberModalMode, setMemberModalMode] = useState('create');
  const [memberEditing, setMemberEditing] = useState(null);

  const [teamFormOpen, setTeamFormOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState(null);
  const [openTeamMenuId, setOpenTeamMenuId] = useState(null);

  const [newMember, setNewMember] = useState(EMPTY_NEW_MEMBER);
  const [memberNameInput, setMemberNameInput] = useState('');
  const [friendSearchInput, setFriendSearchInput] = useState('');
  const [availableFriends, setAvailableFriends] = useState([]);
  const [selectedFriendUserId, setSelectedFriendUserId] = useState('');
  const [memberPhotoFile, setMemberPhotoFile] = useState(null);
  const [memberPhotoPreview, setMemberPhotoPreview] = useState(null);
  const [removeMemberPhoto, setRemoveMemberPhoto] = useState(false);

  useEffect(() => {
    return () => {
      if (memberPhotoPreview && memberPhotoPreview.startsWith('blob:')) {
        URL.revokeObjectURL(memberPhotoPreview);
      }
    };
  }, [memberPhotoPreview]);

  const loadTeams = async () => {
    if (!userId) return;

    try {
      setLoading(true);
      const rows = await listAccessibleTeams(userId);
      setTeams(rows);
      setOpenTeamMenuId((prev) => (rows.some((team) => team.id === prev) ? prev : null));
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudieron cargar tus equipos');
    } finally {
      setLoading(false);
    }
  };

  const loadIncomingInvitations = useCallback(async () => {
    if (!userId) return;

    try {
      const rows = await listIncomingTeamInvitations(userId);
      setIncomingInvitations(rows || []);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudieron cargar tus invitaciones de equipo');
    }
  }, [userId]);

  const loadTeamDetail = useCallback(async (team) => {
    if (!team?.id) return;

    try {
      setDetailLoading(true);
      const [teamMembers, history, pendingInvitations] = await Promise.all([
        listTeamMembers(team.id),
        listTeamHistoryByRival(team.id),
        listTeamPendingInvitations(team.id),
      ]);

      setMembers(teamMembers);
      setHistoryByRival(history);
      setTeamPendingInvitations(pendingInvitations);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo cargar el detalle del equipo');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTeams();
    loadIncomingInvitations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (!openTeamMenuId) return undefined;

    const closeMenu = () => setOpenTeamMenuId(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [openTeamMenuId]);

  useEffect(() => {
    if (!detailActionsMenuOpen) return undefined;

    const closeMenu = () => setDetailActionsMenuOpen(false);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [detailActionsMenuOpen]);

  useEffect(() => {
    if (!roleMenuOpen) return undefined;

    const closeRoleMenu = () => setRoleMenuOpen(false);
    window.addEventListener('click', closeRoleMenu);
    return () => window.removeEventListener('click', closeRoleMenu);
  }, [roleMenuOpen]);

  const occupiedUserIds = useMemo(
    () => new Set(
      members
        .map((member) => toStringId(member?.jugador?.usuario_id))
        .filter(Boolean),
    ),
    [members],
  );
  const pendingInviteUserIds = useMemo(
    () => new Set(
      (teamPendingInvitations || [])
        .map((invitation) => toStringId(invitation?.invited_user_id))
        .filter(Boolean),
    ),
    [teamPendingInvitations],
  );
  const isSelectedTeamOwner = selectedTeam?.owner_user_id === userId;
  const selectedTeamCurrentUserMember = useMemo(
    () => members.find((member) => toStringId(member?.user_id || member?.jugador?.usuario_id) === toStringId(userId)) || null,
    [members, userId],
  );
  const isSelectedTeamAdmin = ['admin', 'owner'].includes(selectedTeamCurrentUserMember?.permissions_role);
  const isSelectedTeamManager = Boolean(isSelectedTeamOwner || isSelectedTeamAdmin);

  const selectedRoleOption = useMemo(() => getRoleOption(newMember.role), [newMember.role]);

  const filteredFriends = useMemo(() => {
    const query = normalizeSearchValue(friendSearchInput);
    return (availableFriends || [])
      .filter((friend) => {
        const friendId = toStringId(friend?.id);
        if (!friendId) return false;
        if (friendId === toStringId(userId)) return false;
        if (occupiedUserIds.has(friendId)) return false;
        if (pendingInviteUserIds.has(friendId)) return false;
        if (!query) return true;
        return normalizeSearchValue(friend?.nombre).includes(query);
      });
  }, [availableFriends, friendSearchInput, occupiedUserIds, pendingInviteUserIds, userId]);

  const selectedFriend = useMemo(
    () => filteredFriends.find((friend) => toStringId(friend?.id) === toStringId(selectedFriendUserId)) || null,
    [filteredFriends, selectedFriendUserId],
  );

  const summaryStats = useMemo(() => summarizeTeamFromHistory(historyByRival), [historyByRival]);

  const selectedTeamGradientStyle = useMemo(
    () => (selectedTeam ? getTeamGradientStyle(selectedTeam) : undefined),
    [selectedTeam],
  );

  const selectedTeamAccent = useMemo(
    () => (selectedTeam ? getTeamAccent(selectedTeam) : '#128BE9'),
    [selectedTeam],
  );

  const resetMemberModalState = useCallback(() => {
    setNewMember(EMPTY_NEW_MEMBER);
    setMemberNameInput('');
    setRoleMenuOpen(false);
    setMemberEditing(null);
    setMemberPhotoFile(null);
    setRemoveMemberPhoto(false);

    if (memberPhotoInputRef.current) {
      memberPhotoInputRef.current.value = '';
    }

    setMemberPhotoPreview((prev) => {
      if (prev && prev.startsWith('blob:')) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });
  }, []);

  const closeMemberModal = useCallback(() => {
    setMemberModalOpen(false);
    resetMemberModalState();
  }, [resetMemberModalState]);

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

  const handleDeleteTeam = async (team) => {
    if (!team?.id) return;

    const confirmed = window.confirm(`Borrar el equipo "${team.name || 'Sin nombre'}"?`);
    if (!confirmed) return;

    try {
      setIsSaving(true);
      await softDeleteTeam(team.id);
      setOpenTeamMenuId(null);

      if (selectedTeam?.id === team.id) {
        setDetailModalOpen(false);
        setSelectedTeam(null);
        setMembers([]);
        setHistoryByRival([]);
        setTeamPendingInvitations([]);
        closeMemberModal();
      }

      await loadTeams();
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo borrar el equipo');
    } finally {
      setIsSaving(false);
    }
  };

  const closeDetailModal = () => {
    setDetailModalOpen(false);
    setDetailActionsMenuOpen(false);
    setAddMemberChoiceOpen(false);
    setInviteMemberModalOpen(false);
    setSelectedTeam(null);
    setMembers([]);
    setHistoryByRival([]);
    setTeamPendingInvitations([]);
    closeMemberModal();
  };

  const handleSelectTeam = useCallback(async (team) => {
    if (!team?.id) return;
    setOpenTeamMenuId(null);
    setDetailActionsMenuOpen(false);
    setSelectedTeam(team);
    setDetailModalOpen(true);
    await loadTeamDetail(team);
  }, [loadTeamDetail]);

  const openCreateMemberModal = () => {
    setMemberModalMode('create');
    setMemberEditing(null);
    setNewMember(EMPTY_NEW_MEMBER);
    setMemberNameInput('');
    setRoleMenuOpen(false);
    setMemberPhotoFile(null);
    setRemoveMemberPhoto(false);
    setMemberPhotoPreview(null);
    setMemberModalOpen(true);
  };

  const openAddMemberChoiceModal = () => {
    if (!isSelectedTeamManager) {
      notifyBlockingError('Solo owner/admin puede agregar jugadores');
      return;
    }
    setAddMemberChoiceOpen(true);
  };

  const closeInviteMemberModal = () => {
    setInviteMemberModalOpen(false);
    setFriendSearchInput('');
    setSelectedFriendUserId('');
  };

  const openInviteMemberModal = async () => {
    if (!isSelectedTeamManager) {
      notifyBlockingError('Solo owner/admin puede invitar jugadores');
      return;
    }
    if (!userId) return;

    try {
      setFriendsLoading(true);
      const friends = await getAmigos(userId);
      setAvailableFriends(friends || []);
      setInviteMemberModalOpen(true);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudieron cargar tus amigos');
    } finally {
      setFriendsLoading(false);
    }
  };

  const openEditMemberModal = (member) => {
    setMemberModalMode('edit');
    setMemberEditing(member);
    setNewMember({
      jugadorId: toStringId(member?.jugador_id),
      permissionsRole: member?.permissions_role || 'member',
      role: normalizeRoleForForm(member?.role),
      isCaptain: Boolean(member?.is_captain),
      shirtNumber: member?.shirt_number ?? '',
    });
    setMemberNameInput(member?.jugador?.nombre || '');
    setRoleMenuOpen(false);
    setMemberPhotoFile(null);
    setRemoveMemberPhoto(false);
    setMemberPhotoPreview(member?.photo_url || null);
    setMemberModalOpen(true);
  };

  const handleSelectMemberPhoto = (file) => {
    if (!file) return;

    setMemberPhotoFile(file);
    setRemoveMemberPhoto(false);
    setMemberPhotoPreview((prev) => {
      if (prev && prev.startsWith('blob:')) {
        URL.revokeObjectURL(prev);
      }
      return URL.createObjectURL(file);
    });
  };

  const handleClearMemberPhoto = () => {
    setMemberPhotoFile(null);
    setRemoveMemberPhoto(true);

    if (memberPhotoInputRef.current) {
      memberPhotoInputRef.current.value = '';
    }

    setMemberPhotoPreview((prev) => {
      if (prev && prev.startsWith('blob:')) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });
  };

  const handleSaveMember = async (event) => {
    event.preventDefault();
    if (!selectedTeam?.id) return;
    if (!isSelectedTeamManager) {
      notifyBlockingError('Solo owner/admin puede editar la plantilla');
      return;
    }

    const normalizedName = memberNameInput.trim();
    if (memberModalMode === 'create' && normalizedName.length === 0) {
      notifyBlockingError('Escribi el nombre del jugador para continuar');
      return;
    }

    try {
      setIsSaving(true);
      let selectedJugadorId = null;

      if (memberModalMode === 'create') {
        const duplicatedByName = members.some((member) => (
          normalizeSearchValue(member?.jugador?.nombre) === normalizeSearchValue(normalizedName)
        ));
        if (duplicatedByName) {
          throw new Error('Ese jugador ya esta en la plantilla');
        }

        const createdLocal = await ensureLocalTeamPlayerByName({
          teamId: selectedTeam.id,
          displayName: normalizedName,
        });
        selectedJugadorId = toStringId(createdLocal.jugador_id);
      }

      if (memberModalMode === 'create' && !selectedJugadorId) {
        throw new Error('No se pudo resolver el jugador para la plantilla');
      }

      if (newMember.isCaptain) {
        const existingCaptain = members.find((member) => member.is_captain && member.id !== memberEditing?.id);
        if (existingCaptain) {
          await updateTeamMember(existingCaptain.id, { is_captain: false });
        }
      }

      let photoUrl = memberModalMode === 'edit' ? (memberEditing?.photo_url || null) : null;

      if (memberModalMode === 'edit' && removeMemberPhoto) {
        photoUrl = null;
      }

      if (memberPhotoFile) {
        photoUrl = await uploadTeamMemberPhoto({
          file: memberPhotoFile,
          userId,
          teamId: selectedTeam.id,
          memberId: memberModalMode === 'edit' ? memberEditing?.id : 'draft',
        });
      }

      if (memberModalMode === 'create') {
        await addTeamMember({
          teamId: selectedTeam.id,
          jugadorId: selectedJugadorId,
          userId: null,
          permissionsRole: 'member',
          role: newMember.role,
          isCaptain: newMember.isCaptain,
          shirtNumber: newMember.shirtNumber === '' ? null : Number(newMember.shirtNumber),
          photoUrl,
        });
      } else {
        const updates = {
          role: newMember.role,
          is_captain: newMember.isCaptain,
          shirt_number: newMember.shirtNumber === '' ? null : Number(newMember.shirtNumber),
          photo_url: photoUrl,
        };

        if (isSelectedTeamOwner && (memberEditing?.user_id || memberEditing?.jugador?.usuario_id)) {
          updates.permissions_role = newMember.permissionsRole || 'member';
        }

        await updateTeamMember(memberEditing.id, {
          ...updates,
        });
      }

      await refreshSelectedTeam();
      closeMemberModal();
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo guardar el jugador en la plantilla');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendTeamInvitation = async () => {
    if (!selectedTeam?.id) return;
    if (!isSelectedTeamManager) {
      notifyBlockingError('Solo owner/admin puede invitar jugadores');
      return;
    }
    if (!selectedFriend?.id) {
      notifyBlockingError('Selecciona un amigo para invitar');
      return;
    }

    try {
      setIsSaving(true);
      await sendTeamInvitation({
        teamId: selectedTeam.id,
        invitedUserId: selectedFriend.id,
      });
      await refreshSelectedTeam();
      closeInviteMemberModal();
      console.info('Invitacion enviada');
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo enviar la invitacion');
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

  const handleRevokeTeamInvitation = async (invitationId) => {
    if (!isSelectedTeamManager) {
      notifyBlockingError('Solo owner/admin puede revocar invitaciones');
      return;
    }

    try {
      setIsSaving(true);
      await revokeTeamInvitation(invitationId);
      await refreshSelectedTeam();
      console.info('Invitacion revocada');
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo revocar la invitacion');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveMember = async (memberId) => {
    if (!isSelectedTeamManager) {
      notifyBlockingError('Solo owner/admin puede quitar jugadores');
      return;
    }

    try {
      setIsSaving(true);
      await removeTeamMember(memberId);
      await refreshSelectedTeam();
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo quitar el jugador');
    } finally {
      setIsSaving(false);
    }
  };

  const memberPhotoDisplay = memberPhotoPreview
    || (memberModalMode === 'edit' ? memberEditing?.jugador?.avatar_url : null)
    || null;

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
                  onClick={handleSelectTeam}
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
                            handleDeleteTeam(team);
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

      <Modal
        isOpen={detailModalOpen && Boolean(selectedTeam)}
        onClose={closeDetailModal}
        title="Editar equipo"
        className="w-full max-w-[640px]"
        classNameContent="p-4 sm:p-5"
      >
        {selectedTeam ? (
          <div className="space-y-4">
            <div className="relative rounded-2xl border border-white/15 bg-[#0f172acc] p-4 shadow-[0_8px_24px_rgba(0,0,0,0.35)]" style={selectedTeamGradientStyle}>
              <span className="absolute left-4 right-4 top-0 h-[2px] rounded-full opacity-80" style={{ backgroundColor: selectedTeamAccent }} />
              <div className="flex items-start gap-3">
                <div className="h-14 w-14 rounded-xl overflow-hidden border border-white/20 bg-black/20 flex items-center justify-center shrink-0">
                  {selectedTeam.crest_url ? (
                    <img src={selectedTeam.crest_url} alt={`Escudo ${selectedTeam.name || 'equipo'}`} className="h-full w-full object-cover" />
                  ) : (
                    <Users size={22} className="text-white/65" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="text-white font-oswald text-xl leading-tight truncate">{selectedTeam.name}</h4>
                  <p className="text-xs text-white/70 mt-1">
                    F{selectedTeam.format} · {formatSkillLevelLabel(selectedTeam.skill_level)} · {selectedTeam.base_zone || 'sin zona'}
                  </p>
                </div>
                {isSelectedTeamManager ? (
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 bg-slate-900/80 text-slate-200 transition-all hover:border-slate-500 hover:bg-slate-800 hover:text-white"
                    onClick={(event) => {
                      event.stopPropagation();
                      setDetailActionsMenuOpen((prev) => !prev);
                    }}
                    aria-label="Acciones del equipo"
                    title="Acciones del equipo"
                  >
                    <MoreVertical size={16} />
                  </button>
                ) : null}

                {detailActionsMenuOpen ? (
                  <div
                    className="absolute right-0 top-10 z-20 w-48 rounded-xl border border-slate-700 bg-slate-900 shadow-lg"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setDetailActionsMenuOpen(false);
                        setEditingTeam(selectedTeam);
                        setTeamFormOpen(true);
                      }}
                      className="w-full inline-flex items-center gap-2 px-3 py-2 text-left text-sm text-slate-100 transition-all hover:bg-slate-800"
                    >
                      <Pencil size={15} />
                      Editar equipo
                    </button>
                    {isSelectedTeamOwner ? (
                      <button
                        type="button"
                        onClick={() => {
                          setDetailActionsMenuOpen(false);
                          onOpenDesafiosWithTeam?.(selectedTeam.id);
                        }}
                        className="w-full inline-flex items-center gap-2 px-3 py-2 text-left text-sm text-slate-100 transition-all hover:bg-slate-800"
                      >
                        <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 15l-3.5 2 1-4-3-2.7 4-.3L12 6l1.5 4 4 .3-3 2.7 1 4z" />
                        </svg>
                        Publicar desafio
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border border-white/15 bg-[#0f172acc] p-4">
              <div className="flex items-center justify-between gap-2">
                <h5 className="text-white font-oswald text-xl">Plantilla</h5>
                <span className="text-xs text-white/60">
                  {members.length} jugadores{teamPendingInvitations.length > 0 ? ` · ${teamPendingInvitations.length} pendientes` : ''}
                </span>
              </div>

              {isSelectedTeamManager ? (
                <button
                  type="button"
                  onClick={openAddMemberChoiceModal}
                  className="mt-3 w-full rounded-xl border border-[#128BE9]/35 bg-[linear-gradient(135deg,rgba(18,139,233,0.18),rgba(14,165,233,0.08))] px-3 py-3 text-left hover:brightness-110"
                >
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[#9ED3FF]/40 bg-[#128BE9]/20 text-[#9ED3FF] shrink-0">
                      <UserPlus size={20} />
                    </span>
                    <p className="text-white font-oswald text-lg tracking-wide">
                      Agregar jugador
                    </p>
                  </div>
                </button>
              ) : null}

              {detailLoading ? (
                <p className="text-sm text-white/65 mt-3">Cargando plantilla...</p>
              ) : null}

              {!detailLoading && members.length === 0 && teamPendingInvitations.length === 0 ? (
                <p className="text-sm text-white/65 mt-3">Aun no hay jugadores en este equipo.</p>
              ) : null}

              {!detailLoading && (members.length > 0 || teamPendingInvitations.length > 0) ? (
                <div className="mt-3 space-y-2">
                  {members.map((member) => {
                    const memberUserId = toStringId(member?.user_id || member?.jugador?.usuario_id);
                    const memberIsOwner = member.permissions_role === 'owner'
                      || (memberUserId && memberUserId === toStringId(selectedTeam?.owner_user_id));
                    const memberIsAdmin = !memberIsOwner && member.permissions_role === 'admin';

                    return (
                      <PlayerMiniCard
                        key={member.id}
                        variant="friend"
                        profile={{
                          nombre: member?.jugador?.nombre || 'Jugador',
                          avatar_url: getMemberAvatar(member),
                          posicion: getMemberProfilePosition(member),
                          ranking: member?.jugador?.score ?? null,
                        }}
                        metaBadge={(
                          <div className="inline-flex items-center gap-1">
                            <span className="inline-flex items-center rounded-md border border-white/25 bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                              #{member.shirt_number ?? '-'}
                            </span>
                            {member.is_captain ? (
                              <span className="inline-flex items-center gap-1 rounded-md border border-amber-300/35 bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-100">
                                <Crown size={11} /> CAP
                              </span>
                            ) : null}
                            {memberIsOwner ? (
                              <span className="inline-flex items-center rounded-md border border-sky-300/35 bg-sky-500/18 px-1.5 py-0.5 text-[10px] font-semibold text-sky-100">
                                Owner
                              </span>
                            ) : null}
                            {memberIsAdmin ? (
                              <span className="inline-flex items-center rounded-md border border-sky-300/35 bg-sky-500/18 px-1.5 py-0.5 text-[10px] font-semibold text-sky-100">
                                Admin
                              </span>
                            ) : null}
                          </div>
                        )}
                        rightSlot={isSelectedTeamManager ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEditMemberModal(member)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/20 bg-white/8 text-white/80 hover:bg-white/15"
                              title="Editar jugador"
                              aria-label="Editar jugador"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveMember(member.id)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-300/35 bg-red-500/10 text-red-200 hover:bg-red-500/20"
                              title="Quitar jugador"
                              aria-label="Quitar jugador"
                              disabled={isSaving}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ) : null}
                      />
                    );
                  })}
                  {teamPendingInvitations.map((invitation) => (
                    <PlayerMiniCard
                      key={`pending-${invitation.id}`}
                      variant="friend"
                      profile={{
                        nombre: invitation?.invited_user?.nombre || 'Jugador',
                        avatar_url: invitation?.invited_user?.avatar_url || null,
                        posicion: 'DEF',
                        ranking: 5,
                      }}
                      metaBadge={(
                        <span className="inline-flex items-center rounded-md border border-amber-300/35 bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-100">
                          Pendiente
                        </span>
                      )}
                      rightSlot={isSelectedTeamManager ? (
                        <button
                          type="button"
                          onClick={() => handleRevokeTeamInvitation(invitation.id)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-300/35 bg-red-500/10 text-red-200 hover:bg-red-500/20"
                          title="Revocar invitacion"
                          aria-label="Revocar invitacion"
                          disabled={isSaving}
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : null}
                    />
                  ))}
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-white/15 bg-[#0f172acc] p-4">
              <h5 className="text-white font-oswald text-xl">Historial vs rivales</h5>
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
      </Modal>

      <Modal
        isOpen={addMemberChoiceOpen}
        onClose={() => setAddMemberChoiceOpen(false)}
        title="Agregar jugador"
        className="w-full max-w-[520px]"
        classNameContent="p-4 sm:p-5"
      >
        <div className="space-y-2">
          <button
            type="button"
            className={optionCardClass}
            onClick={() => {
              setAddMemberChoiceOpen(false);
              openCreateMemberModal();
            }}
          >
            <p className="text-white font-oswald text-[18px]">Crear jugador nuevo</p>
            <p className="mt-1 text-xs text-white/65">Jugador local solo para este equipo.</p>
          </button>

          <button
            type="button"
            className={optionCardClass}
            onClick={async () => {
              setAddMemberChoiceOpen(false);
              await openInviteMemberModal();
            }}
          >
            <p className="text-white font-oswald text-[18px]">Invitar amigo</p>
            <p className="mt-1 text-xs text-white/65">Enviar invitacion a un usuario registrado.</p>
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={inviteMemberModalOpen}
        onClose={closeInviteMemberModal}
        title="Invitar amigo"
        className="w-full max-w-[560px]"
        classNameContent="p-4 sm:p-5"
        footer={(
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              onClick={closeInviteMemberModal}
              variant="secondary"
              className={modalActionButtonClass}
              disabled={isSaving}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className={modalActionButtonClass}
              onClick={handleSendTeamInvitation}
              loading={isSaving}
              loadingText="Enviando..."
              disabled={isSaving || !selectedFriend}
            >
              Enviar invitacion
            </Button>
          </div>
        )}
      >
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-white/80 uppercase tracking-wide">Buscar amigo</span>
            <input
              type="text"
              autoComplete="off"
              value={friendSearchInput}
              onChange={(event) => setFriendSearchInput(event.target.value)}
              placeholder="Nombre de amigo"
              className="mt-1 w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white outline-none focus:border-[#128BE9]"
            />
          </label>

          {friendsLoading ? (
            <p className="text-sm text-white/65">Cargando amigos...</p>
          ) : null}

          {!friendsLoading && filteredFriends.length === 0 ? (
            <p className="text-sm text-white/65">No hay amigos disponibles para invitar.</p>
          ) : null}

          {!friendsLoading && filteredFriends.length > 0 ? (
            <div className="max-h-[340px] overflow-y-auto space-y-2 pr-1">
              {filteredFriends.map((friend) => {
                const friendId = toStringId(friend?.id);
                const isSelected = friendId === toStringId(selectedFriendUserId);
                return (
                  <button
                    key={friendId}
                    type="button"
                    onClick={() => setSelectedFriendUserId(friendId)}
                    className={`w-full rounded-xl border p-2 transition-all text-left ${isSelected
                      ? 'border-[#9ED3FF]/50 bg-[#128BE9]/15'
                      : 'border-white/15 bg-white/5 hover:bg-white/10'
                      }`}
                  >
                    <PlayerMiniCard
                      profile={{
                        nombre: friend?.nombre || 'Jugador',
                        avatar_url: friend?.avatar_url || null,
                        posicion: friend?.posicion || 'DEF',
                        ranking: friend?.ranking ?? 5,
                      }}
                      variant="friend"
                      metaBadge={isSelected ? (
                        <span className="inline-flex items-center rounded-md border border-[#9ED3FF]/45 bg-[#128BE9]/22 px-1.5 py-0.5 text-[10px] font-semibold text-[#D4EBFF]">
                          Seleccionado
                        </span>
                      ) : null}
                    />
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        isOpen={memberModalOpen}
        onClose={closeMemberModal}
        title={memberModalMode === 'create' ? 'Agregar jugador' : 'Editar jugador'}
        className="w-full max-w-[560px]"
        classNameContent="p-4 sm:p-5"
        footer={(
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              onClick={closeMemberModal}
              variant="secondary"
              className={modalActionButtonClass}
              disabled={isSaving}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              form="team-member-form"
              className={modalActionButtonClass}
              loading={isSaving}
              loadingText={memberModalMode === 'create' ? 'Agregando...' : 'Guardando...'}
              disabled={isSaving || (memberModalMode === 'create' && memberNameInput.trim().length === 0)}
            >
              {memberModalMode === 'create' ? 'Agregar' : 'Guardar cambios'}
            </Button>
          </div>
        )}
      >
        <form id="team-member-form" className="space-y-3" onSubmit={handleSaveMember}>
          <label className="block">
            <span className="text-xs text-white/80 uppercase tracking-wide">Nombre</span>
            {memberModalMode === 'create' ? (
              <div className="mt-1">
                <input
                  type="text"
                  autoComplete="off"
                  value={memberNameInput}
                  onChange={(event) => setMemberNameInput(event.target.value)}
                  placeholder="Nombre del jugador"
                  className="w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white outline-none focus:border-[#128BE9]"
                />
              </div>
            ) : (
              <input
                type="text"
                readOnly
                value={memberEditing?.jugador?.nombre || 'Jugador'}
                className="mt-1 w-full rounded-xl bg-slate-800/70 border border-white/15 px-3 py-2 text-white/85"
              />
            )}
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-white/80 uppercase tracking-wide">Posicion</span>
              <div className="relative mt-1">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setRoleMenuOpen((prev) => !prev);
                  }}
                  className="w-full inline-flex items-center justify-between rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white transition-all hover:border-[#9ED3FF]/50"
                  aria-label="Seleccionar posicion"
                >
                  <span className="font-semibold tracking-wide">{selectedRoleOption.short}</span>
                  <ChevronDown size={15} className={`transition-transform ${roleMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {roleMenuOpen ? (
                  <div
                    className="absolute z-30 mt-1 w-full max-h-60 overflow-y-auto rounded-xl border border-white/15 bg-[#0f172a] p-1 shadow-[0_10px_26px_rgba(0,0,0,0.45)]"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {ROLE_OPTIONS.map((option) => {
                      const isSelected = option.value === selectedRoleOption.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            setNewMember((prev) => ({ ...prev, role: option.value }));
                            setRoleMenuOpen(false);
                          }}
                          className={`w-full rounded-lg px-3 py-2 text-left transition-all ${isSelected
                            ? 'bg-[#128BE9]/25 text-white'
                            : 'text-white/85 hover:bg-white/8'
                            }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate">{option.label}</span>
                            <span className="text-xs font-semibold text-[#9ED3FF]">{option.short}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </label>

            <label className="block">
              <span className="text-xs text-white/80 uppercase tracking-wide">Numero</span>
              <input
                type="number"
                min={0}
                max={99}
                value={newMember.shirtNumber}
                onChange={(event) => setNewMember((prev) => ({ ...prev, shirtNumber: event.target.value }))}
                placeholder="Ej: 4"
                className="mt-1 w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white"
              />
            </label>
          </div>

          {memberModalMode === 'edit' && isSelectedTeamOwner && (memberEditing?.user_id || memberEditing?.jugador?.usuario_id) ? (
            <label className="block">
              <span className="text-xs text-white/80 uppercase tracking-wide">Permisos</span>
              <select
                value={newMember.permissionsRole || 'member'}
                onChange={(event) => setNewMember((prev) => ({ ...prev, permissionsRole: event.target.value }))}
                className="mt-1 w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white outline-none focus:border-[#128BE9]"
              >
                <option value="member">Miembro</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          ) : null}

          <label className="inline-flex items-center gap-2.5 text-white/90 font-oswald text-[15px] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={newMember.isCaptain}
              onChange={(event) => setNewMember((prev) => ({ ...prev, isCaptain: event.target.checked }))}
              className="sr-only"
            />
            <span
              className={`inline-flex h-5 w-5 items-center justify-center rounded-md border transition-all ${newMember.isCaptain
                ? 'border-[#93C5FD] bg-[#2563EB] text-white shadow-[0_0_0_3px_rgba(37,99,235,0.22)]'
                : 'border-white/30 bg-slate-900/70 text-transparent'
                }`}
            >
              <Check size={13} strokeWidth={3} />
            </span>
            <span>Marcar como capitan</span>
          </label>

          <div className="rounded-xl border border-white/15 bg-white/5 p-3">
            <span className="text-xs text-white/80 uppercase tracking-wide">Foto (opcional)</span>
            <div className="mt-2 flex items-center gap-3">
              <div className="h-12 w-12 rounded-full overflow-hidden border border-white/20 bg-black/20 flex items-center justify-center shrink-0">
                {memberPhotoDisplay ? (
                  <img src={memberPhotoDisplay} alt="Preview jugador" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-white/40">
                    <Camera size={16} />
                  </span>
                )}
              </div>

              <div className="flex-1 min-w-0 rounded-xl border border-dashed border-white/20 bg-slate-900/45 px-3 py-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!memberPhotoInputRef.current) return;
                    memberPhotoInputRef.current.value = '';
                    memberPhotoInputRef.current.click();
                  }}
                  className="w-full inline-flex items-center gap-2 text-left text-sm text-white/90 hover:text-white"
                >
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[#9ED3FF]/40 bg-[#128BE9]/15 text-[#9ED3FF] shrink-0">
                    <Camera size={14} />
                  </span>
                  <span className="font-semibold">{memberPhotoFile ? 'Cambiar foto' : 'Subir foto'}</span>
                </button>

                <p className="mt-1 text-xs text-white/60 truncate">
                  {memberPhotoDisplay ? 'Foto lista' : 'PNG, JPG, WEBP o SVG'}
                </p>

                <input
                  ref={memberPhotoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) handleSelectMemberPhoto(file);
                  }}
                  className="hidden"
                />
              </div>

              {memberPhotoDisplay ? (
                <button
                  type="button"
                  onClick={handleClearMemberPhoto}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-red-300/35 bg-red-500/10 text-red-200 transition-all hover:bg-red-500/20"
                  title="Quitar foto"
                  aria-label="Quitar foto"
                >
                  <Trash2 size={14} />
                </button>
              ) : null}
            </div>
          </div>

          {memberModalMode === 'edit' ? (
            <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/65">
              <p>Rol actual: {getRoleLabel(memberEditing?.role)}</p>
              {(memberEditing?.user_id || memberEditing?.jugador?.usuario_id) ? (
                <p className="mt-1">Permiso actual: {memberEditing?.permissions_role || 'member'}</p>
              ) : null}
              <p className="mt-1">Numero actual: {memberEditing?.shirt_number ?? '-'}</p>
            </div>
          ) : null}
        </form>
      </Modal>

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
    </>
  );
};

export default MisEquiposTab;
