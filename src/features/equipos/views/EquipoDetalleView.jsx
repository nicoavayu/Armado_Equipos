import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ChevronDown, Crown, Eye, MoreVertical, Pencil, Trash2, UserPlus, Users } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Modal from '../../../components/Modal';
import ConfirmModal from '../../../components/ConfirmModal';
import ProfileCardModal from '../../../components/ProfileCardModal';
import TeamFormModal from '../components/TeamFormModal';
import PlayerMiniCard from '../../../components/PlayerMiniCard';
import Button from '../../../components/Button';
import {
  addCurrentUserAsTeamMember,
  addTeamMember,
  ensureLocalTeamPlayerByName,
  listAccessibleTeams,
  listTeamMatchHistory,
  listTeamMembers,
  listTeamPendingInvitations,
  removeTeamMember,
  revokeTeamInvitation,
  sendTeamInvitation,
  transferTeamCaptaincy,
  updateTeam,
  updateTeamMember,
} from '../../../services/db/teamChallenges';
import { getAmigos } from '../../../services/db/friends';
import { uploadTeamCrest, uploadTeamMemberPhoto } from '../../../services/storage/teamCrests';
import { notifyBlockingError } from '../../../utils/notifyBlockingError';
import { formatSkillLevelLabel, getTeamAccent, getTeamGradientStyle } from '../utils/teamColors';
import { QUIERO_JUGAR_EQUIPOS_SUBTAB_STORAGE_KEY, QUIERO_JUGAR_TOP_TAB_STORAGE_KEY } from '../config';

const modalActionButtonClass = 'h-12 rounded-xl text-[18px] font-oswald font-semibold tracking-[0.01em] !normal-case';
const optionCardClass = 'w-full rounded-xl border border-white/15 bg-white/5 p-3 text-left transition-all hover:bg-white/10';
const disabledOptionCardClass = `${optionCardClass} disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none disabled:hover:bg-white/5`;

const EMPTY_NEW_MEMBER = {
  jugadorId: '',
  role: 'player',
  shirtNumber: '',
};

const DETAIL_TABS = [
  { key: 'plantilla', label: 'Plantilla' },
  { key: 'history', label: 'Historial vs rivales' },
];

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

const PROFILE_POSITION_CODE_TO_LABEL = {
  ARQ: 'Arquero',
  DEF: 'Defensor',
  MED: 'Mediocampista',
  DEL: 'Delantero',
  SD: 'Sin definir',
};

const PROFILE_POSITION_ALIAS = {
  arq: 'ARQ',
  arquero: 'ARQ',
  gk: 'ARQ',
  def: 'DEF',
  defensor: 'DEF',
  defender: 'DEF',
  med: 'MED',
  mediocampista: 'MED',
  mid: 'MED',
  del: 'DEL',
  delantero: 'DEL',
  forward: 'DEL',
};

const toStringId = (value) => (value == null ? '' : String(value));
const normalizeSearchValue = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();
const parseShirtNumber = (value) => {
  if (value === '' || value == null) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return Number.NaN;
  return parsed;
};

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

const getRoleLabel = (roleValue) => getRoleOption(roleValue).label;
const getMemberAvatar = (member) => member?.photo_url || member?.jugador?.avatar_url || null;
const getMemberProfilePosition = (member) => ROLE_TO_POSITION[member?.role] || 'DEF';
const normalizeDetailTab = (value) => (String(value || '').toLowerCase() === 'history' ? 'history' : 'plantilla');

const normalizeProfilePositionCode = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return 'SD';

  const upperRaw = raw.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(PROFILE_POSITION_CODE_TO_LABEL, upperRaw)) {
    return upperRaw;
  }

  const aliasMatch = PROFILE_POSITION_ALIAS[raw.toLowerCase()];
  if (aliasMatch) return aliasMatch;
  return 'SD';
};

const getMemberProfilePositionFromProfile = (member) => normalizeProfilePositionCode(
  member?.jugador?.posicion || member?.jugador?.posicion_favorita || member?.jugador?.rol_favorito || '',
);

const getMemberPositionForCard = (member) => {
  const profilePosition = getMemberProfilePositionFromProfile(member);
  if (profilePosition !== 'SD') return profilePosition;
  return getMemberProfilePosition(member);
};

const formatPlayedDate = (playedAt) => {
  if (!playedAt) return 'Sin fecha';
  const date = new Date(playedAt);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return date.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

const getMatchResultBadgeClass = (result) => {
  if (result === 'W') return 'border-emerald-300/35 bg-emerald-500/20 text-emerald-100';
  if (result === 'L') return 'border-rose-300/35 bg-rose-500/20 text-rose-100';
  return 'border-white/30 bg-white/10 text-white';
};

const summarizeTeamFromMatches = (matches = []) => matches.reduce((acc, match) => {
  acc.played += 1;
  if (match.result === 'W') acc.won += 1;
  if (match.result === 'D') acc.draw += 1;
  if (match.result === 'L') acc.lost += 1;
  return acc;
}, { played: 0, won: 0, draw: 0, lost: 0 });

const EquipoDetalleView = ({ teamId, userId }) => {
  const navigate = useNavigate();
  const memberPhotoInputRef = useRef(null);
  const roleMenuContainerRef = useRef(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = normalizeDetailTab(searchParams.get('tab'));
  const selectedTabLabel = activeTab === 'history' ? 'history' : 'plantilla';

  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [friendsLoading, setFriendsLoading] = useState(false);

  const [selectedTeam, setSelectedTeam] = useState(null);
  const [members, setMembers] = useState([]);
  const [teamMatchHistory, setTeamMatchHistory] = useState([]);
  const [teamPendingInvitations, setTeamPendingInvitations] = useState([]);

  const [detailActionsMenuOpen, setDetailActionsMenuOpen] = useState(false);
  const [teamFormOpen, setTeamFormOpen] = useState(false);
  const [addMemberChoiceOpen, setAddMemberChoiceOpen] = useState(false);
  const [inviteMemberModalOpen, setInviteMemberModalOpen] = useState(false);
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [memberModalMode, setMemberModalMode] = useState('create');
  const [memberEditing, setMemberEditing] = useState(null);
  const [openMemberMenuId, setOpenMemberMenuId] = useState(null);
  const [memberConfirmAction, setMemberConfirmAction] = useState(null);
  const [memberSelfEditMode, setMemberSelfEditMode] = useState(false);
  const [profileModalPlayer, setProfileModalPlayer] = useState(null);

  const [newMember, setNewMember] = useState(EMPTY_NEW_MEMBER);
  const [memberNameInput, setMemberNameInput] = useState('');
  const [friendSearchInput, setFriendSearchInput] = useState('');
  const [availableFriends, setAvailableFriends] = useState([]);
  const [selectedFriendUserId, setSelectedFriendUserId] = useState('');
  const [memberPhotoFile, setMemberPhotoFile] = useState(null);
  const [memberPhotoPreview, setMemberPhotoPreview] = useState(null);
  const [removeMemberPhoto, setRemoveMemberPhoto] = useState(false);
  const [showProfilePositionHint, setShowProfilePositionHint] = useState(false);

  useEffect(() => {
    return () => {
      if (memberPhotoPreview && memberPhotoPreview.startsWith('blob:')) {
        URL.revokeObjectURL(memberPhotoPreview);
      }
    };
  }, [memberPhotoPreview]);

  useEffect(() => {
    if (!detailActionsMenuOpen) return undefined;
    const closeMenu = () => setDetailActionsMenuOpen(false);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [detailActionsMenuOpen]);

  useEffect(() => {
    if (!openMemberMenuId) return undefined;
    const closeMenu = () => {
      setOpenMemberMenuId(null);
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') closeMenu();
    };
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [openMemberMenuId]);

  useEffect(() => {
    if (!roleMenuOpen) return undefined;
    const handlePointerDownCapture = (event) => {
      if (!roleMenuContainerRef.current) return;
      if (roleMenuContainerRef.current.contains(event.target)) return;
      setRoleMenuOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDownCapture, true);
    return () => document.removeEventListener('pointerdown', handlePointerDownCapture, true);
  }, [roleMenuOpen]);

  const loadTeamDetail = useCallback(async (team) => {
    if (!team?.id) return;

    try {
      setDetailLoading(true);
      const [teamMembers, history, pendingInvitations] = await Promise.all([
        listTeamMembers(team.id),
        listTeamMatchHistory(team.id),
        listTeamPendingInvitations(team.id),
      ]);
      setMembers(teamMembers || []);
      setTeamMatchHistory(history || []);
      setTeamPendingInvitations(pendingInvitations || []);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo cargar el detalle del equipo');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const loadSelectedTeam = useCallback(async () => {
    if (!userId || !teamId) return;

    try {
      setLoading(true);
      const teams = await listAccessibleTeams(userId);
      const found = (teams || []).find((team) => toStringId(team?.id) === toStringId(teamId));

      if (!found) {
        setSelectedTeam(null);
        setMembers([]);
        setTeamMatchHistory([]);
        setTeamPendingInvitations([]);
        return;
      }

      setSelectedTeam(found);
      await loadTeamDetail(found);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo cargar el equipo');
      setSelectedTeam(null);
    } finally {
      setLoading(false);
    }
  }, [loadTeamDetail, teamId, userId]);

  useEffect(() => {
    loadSelectedTeam();
  }, [loadSelectedTeam]);

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

  const selectedTeamCurrentUserMember = useMemo(
    () => members.find((member) => toStringId(member?.user_id || member?.jugador?.usuario_id) === toStringId(userId)) || null,
    [members, userId],
  );
  const selectedTeamCaptainMember = useMemo(
    () => members.find((member) => Boolean(member?.is_captain)) || null,
    [members],
  );
  const isCurrentUserInTeam = Boolean(selectedTeamCurrentUserMember);
  const isSelectedTeamCaptain = Boolean(selectedTeamCurrentUserMember?.is_captain);
  const isSelectedTeamLegacyAdmin = ['admin', 'owner'].includes(selectedTeamCurrentUserMember?.permissions_role)
    || selectedTeam?.owner_user_id === userId;
  const isSelectedTeamManager = selectedTeamCaptainMember
    ? isSelectedTeamCaptain
    : Boolean(isSelectedTeamCaptain || isSelectedTeamLegacyAdmin);

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

  const summaryStats = useMemo(() => summarizeTeamFromMatches(teamMatchHistory), [teamMatchHistory]);
  const selectedRoleOption = useMemo(() => getRoleOption(newMember.role), [newMember.role]);
  const isEditingRegisteredMember = useMemo(
    () => memberModalMode === 'edit' && Boolean(memberEditing?.user_id || memberEditing?.jugador?.usuario_id),
    [memberEditing, memberModalMode],
  );
  const selectedProfilePositionCode = useMemo(
    () => getMemberProfilePositionFromProfile(memberEditing),
    [memberEditing],
  );

  const selectedTeamGradientStyle = useMemo(
    () => (selectedTeam ? getTeamGradientStyle(selectedTeam) : undefined),
    [selectedTeam],
  );

  const selectedTeamAccent = useMemo(
    () => (selectedTeam ? getTeamAccent(selectedTeam) : '#128BE9'),
    [selectedTeam],
  );

  const refreshSelectedTeam = async () => {
    if (!selectedTeam?.id) return;
    await loadTeamDetail(selectedTeam);
  };

  const resetMemberModalState = useCallback(() => {
    setNewMember(EMPTY_NEW_MEMBER);
    setMemberNameInput('');
    setRoleMenuOpen(false);
    setMemberEditing(null);
    setMemberSelfEditMode(false);
    setMemberPhotoFile(null);
    setRemoveMemberPhoto(false);
    setShowProfilePositionHint(false);

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

  const handleSelectDetailTab = (tabKey) => {
    const normalizedTab = normalizeDetailTab(tabKey);
    const nextSearch = new URLSearchParams(searchParams);
    if (normalizedTab === 'history') {
      nextSearch.set('tab', 'history');
    } else {
      nextSearch.delete('tab');
    }
    setSearchParams(nextSearch, { replace: true });
  };

  const openCreateMemberModal = () => {
    setMemberModalMode('create');
    setMemberSelfEditMode(false);
    setMemberEditing(null);
    setNewMember(EMPTY_NEW_MEMBER);
    setMemberNameInput('');
    setRoleMenuOpen(false);
    setMemberPhotoFile(null);
    setRemoveMemberPhoto(false);
    setMemberPhotoPreview(null);
    setShowProfilePositionHint(false);
    setMemberModalOpen(true);
  };

  const openAddMemberChoiceModal = () => {
    if (!isSelectedTeamManager) {
      notifyBlockingError('Solo el capitán puede agregar jugadores');
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
      notifyBlockingError('Solo el capitán puede invitar jugadores');
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

  const openEditMemberModal = (member, options = {}) => {
    const selfEdit = Boolean(options?.selfEdit);
    setMemberModalMode('edit');
    setMemberSelfEditMode(selfEdit);
    setMemberEditing(member);
    setNewMember({
      jugadorId: toStringId(member?.jugador_id),
      role: normalizeRoleForForm(member?.role),
      shirtNumber: member?.shirt_number ?? '',
    });
    setMemberNameInput(member?.jugador?.nombre || '');
    setRoleMenuOpen(false);
    setMemberPhotoFile(null);
    setRemoveMemberPhoto(false);
    setMemberPhotoPreview(member?.photo_url || null);
    setShowProfilePositionHint(false);
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
    const isEditingOwnMember = memberModalMode === 'edit'
      && toStringId(memberEditing?.id) === toStringId(selectedTeamCurrentUserMember?.id);
    const canSelfEditFromRoster = Boolean(memberSelfEditMode && isEditingOwnMember);
    if (!isSelectedTeamManager && !canSelfEditFromRoster) {
      notifyBlockingError('Solo el capitán puede editar la plantilla');
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
      const shirtNumber = parseShirtNumber(newMember.shirtNumber);

      if (Number.isNaN(shirtNumber) || (shirtNumber != null && (shirtNumber < 1 || shirtNumber > 99))) {
        throw new Error('El numero debe ser un entero entre 1 y 99');
      }

      const currentShirtNumber = memberModalMode === 'edit'
        ? parseShirtNumber(memberEditing?.shirt_number)
        : null;
      const shouldValidateDuplicatedShirtNumber = shirtNumber != null
        && (memberModalMode === 'create' || shirtNumber !== currentShirtNumber);

      if (shouldValidateDuplicatedShirtNumber) {
        const duplicatedByShirtNumber = members.some((member) => {
          if (member?.id === memberEditing?.id) return false;
          const existingShirtNumber = parseShirtNumber(member?.shirt_number);
          return existingShirtNumber != null && existingShirtNumber === shirtNumber;
        });
        if (duplicatedByShirtNumber) {
          throw new Error(`El numero #${shirtNumber} ya esta en uso en la plantilla`);
        }
      }

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

      let photoUrl = memberModalMode === 'edit' ? (memberEditing?.photo_url || null) : null;
      if (!memberSelfEditMode) {
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
      }

      if (memberModalMode === 'create') {
        await addTeamMember({
          teamId: selectedTeam.id,
          jugadorId: selectedJugadorId,
          userId: null,
          permissionsRole: 'member',
          role: newMember.role,
          isCaptain: false,
          shirtNumber,
          photoUrl,
        });
      } else {
        const updates = (memberSelfEditMode || isEditingRegisteredMember)
          ? {
            shirt_number: shirtNumber,
          }
          : {
            role: newMember.role,
            shirt_number: shirtNumber,
            photo_url: photoUrl,
          };

        await updateTeamMember(memberEditing.id, { ...updates });
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
      notifyBlockingError('Solo el capitán puede invitar jugadores');
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

  const handleAddCurrentUserAsMember = async () => {
    if (!selectedTeam?.id) return;
    if (!isSelectedTeamManager) {
      notifyBlockingError('Solo el capitán puede agregar jugadores');
      return;
    }
    if (isCurrentUserInTeam) {
      notifyBlockingError('Ya sos jugador de este equipo');
      return;
    }

    try {
      setIsSaving(true);
      await addCurrentUserAsTeamMember({
        teamId: selectedTeam.id,
        userId,
        permissionsRole: 'member',
        role: 'player',
      });
      await refreshSelectedTeam();
      setAddMemberChoiceOpen(false);
      console.info('Te agregaste al equipo');
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo agregarte al equipo');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTransferCaptain = async (member) => {
    if (!selectedTeam?.id || !member?.id) return;
    if (!isSelectedTeamManager) {
      notifyBlockingError('Solo el capitán puede transferir la capitanía');
      return;
    }

    const memberUserId = toStringId(member?.user_id || member?.jugador?.usuario_id);
    if (member?.is_captain) {
      notifyBlockingError('Ese jugador ya es capitán');
      return;
    }

    if (!memberUserId) {
      notifyBlockingError('Solo jugadores registrados pueden ser capitán');
      return;
    }

    try {
      setIsSaving(true);
      await transferTeamCaptaincy({
        teamId: selectedTeam.id,
        newCaptainMemberId: member.id,
      });

      setOpenMemberMenuId(null);
      await refreshSelectedTeam();
      console.info('Capitanía transferida');
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo transferir la capitanía');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRevokeTeamInvitation = async (invitationId) => {
    if (!isSelectedTeamManager) {
      notifyBlockingError('Solo el capitán puede revocar invitaciones');
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

  const handleRemoveMember = async (memberId, { skipRefresh = false } = {}) => {
    const canRemoveAsManager = isSelectedTeamManager;
    const canLeaveOwnTeam = toStringId(memberId) === toStringId(selectedTeamCurrentUserMember?.id);
    if (!canRemoveAsManager && !canLeaveOwnTeam) {
      notifyBlockingError('Solo el capitán puede quitar jugadores');
      return false;
    }

    try {
      setIsSaving(true);
      await removeTeamMember(memberId);
      if (!skipRefresh) {
        await refreshSelectedTeam();
      }
      return true;
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo quitar el jugador');
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const askRemoveMemberConfirmation = (member) => {
    if (!member?.id) return;

    const isCaptainCard = Boolean(member?.is_captain);
    const hasOtherMembers = (members || []).some((candidate) => candidate?.id && candidate.id !== member.id);
    if (isCaptainCard && hasOtherMembers) {
      notifyBlockingError('Transferí la capitanía antes de quitar al capitán del equipo');
      return;
    }

    const memberUserId = toStringId(member?.user_id || member?.jugador?.usuario_id);
    const isCurrentUserCard = Boolean(memberUserId && memberUserId === toStringId(userId));

    setOpenMemberMenuId(null);
    setMemberConfirmAction({
      type: isCurrentUserCard ? 'leave' : 'remove',
      memberId: member.id,
      memberName: member?.jugador?.nombre || 'Jugador',
      isCurrentUserCard,
    });
  };

  const closeMemberConfirmModal = () => {
    if (isSaving) return;
    setMemberConfirmAction(null);
  };

  const confirmRemoveMemberAction = async () => {
    if (!memberConfirmAction?.memberId) return;
    const isLeavingOwnTeam = Boolean(memberConfirmAction.isCurrentUserCard);
    const removed = await handleRemoveMember(
      memberConfirmAction.memberId,
      { skipRefresh: isLeavingOwnTeam },
    );
    if (!removed) return;

    setMemberConfirmAction(null);

    if (isLeavingOwnTeam) {
      sessionStorage.setItem(QUIERO_JUGAR_TOP_TAB_STORAGE_KEY, 'equipos');
      sessionStorage.setItem(QUIERO_JUGAR_EQUIPOS_SUBTAB_STORAGE_KEY, 'mis-equipos');
      navigate('/quiero-jugar', {
        state: {
          equiposSubtab: 'mis-equipos',
        },
      });
    }
  };

  const handleUpdateTeamDetails = async (payload, crestFile) => {
    if (!selectedTeam?.id) return;
    if (!isSelectedTeamManager) {
      notifyBlockingError('Solo el capitán puede editar este equipo');
      return;
    }

    try {
      setIsSaving(true);

      let persistedTeam = await updateTeam(selectedTeam.id, payload);

      if (crestFile) {
        const crestUrl = await uploadTeamCrest({
          file: crestFile,
          userId,
          teamId: selectedTeam.id,
        });

        persistedTeam = await updateTeam(selectedTeam.id, {
          ...persistedTeam,
          ...payload,
          crest_url: crestUrl,
        });
      }

      setTeamFormOpen(false);
      await loadSelectedTeam();
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo actualizar el equipo');
    } finally {
      setIsSaving(false);
    }
  };

  const memberPhotoDisplay = memberPhotoPreview
    || (memberModalMode === 'edit' ? memberEditing?.jugador?.avatar_url : null)
    || null;

  if (loading) {
    return (
      <div className="w-full flex justify-center px-4 pt-[116px] pb-6">
        <div className="w-full max-w-[560px] rounded-2xl border border-white/15 bg-white/5 p-4 text-center text-white/70">
          Cargando equipo...
        </div>
      </div>
    );
  }

  if (!selectedTeam) {
    return (
      <div className="w-full flex justify-center px-4 pt-[116px] pb-6">
        <div className="w-full max-w-[560px] rounded-2xl border border-white/15 bg-white/5 p-4 text-center text-white/70">
          No encontramos ese equipo o ya no tenes acceso.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="w-full flex justify-center px-4 pt-[116px] pb-6">
        <div className="w-full max-w-[560px] space-y-3">
          <div
            className="relative rounded-2xl border border-white/15 bg-[#0f172acc] p-4 shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
            style={selectedTeamGradientStyle}
          >
            <span
              className="absolute left-4 right-4 top-0 h-[2px] rounded-full opacity-80"
              style={{ backgroundColor: selectedTeamAccent }}
            />
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
                      setTeamFormOpen(true);
                    }}
                    className="w-full inline-flex items-center gap-2 px-3 py-2 text-left text-sm text-slate-100 transition-all hover:bg-slate-800"
                  >
                    <Pencil size={15} />
                    Editar equipo
                  </button>
                  {isSelectedTeamManager ? (
                    <button
                      type="button"
                      onClick={() => {
                        setDetailActionsMenuOpen(false);
                        sessionStorage.setItem(QUIERO_JUGAR_TOP_TAB_STORAGE_KEY, 'equipos');
                        sessionStorage.setItem(QUIERO_JUGAR_EQUIPOS_SUBTAB_STORAGE_KEY, 'desafios');
                        navigate('/quiero-jugar', {
                          state: {
                            equiposSubtab: 'desafios',
                            prefilledTeamId: selectedTeam.id,
                          },
                        });
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

          <div className="rounded-xl border border-white/15 bg-[linear-gradient(135deg,rgba(61,74,130,0.42),rgba(31,43,96,0.4))] p-1.5 grid grid-cols-2 gap-1.5">
            {DETAIL_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleSelectDetailTab(tab.key)}
                className={`min-w-0 rounded-lg px-1 py-2.5 text-[17px] font-oswald font-semibold normal-case tracking-[0.01em] transition-all ${selectedTabLabel === tab.key
                  ? 'border border-[#A5B8FF]/45 bg-[linear-gradient(135deg,rgba(133,121,236,0.58),rgba(113,108,217,0.56))] text-white shadow-[0_8px_22px_rgba(121,111,231,0.34)]'
                  : 'border border-transparent bg-transparent text-white/60 hover:text-white/80'
                  }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {selectedTabLabel === 'plantilla' ? (
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
                <div className="mt-4 mb-2 flex items-center gap-3 px-1">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                    Jugadores
                  </span>
                  <span className="h-px flex-1 bg-white/10" />
                </div>
              ) : null}

              {!detailLoading && (members.length > 0 || teamPendingInvitations.length > 0) ? (
                <div className="space-y-2">
                  {members.map((member) => {
                    const memberUserId = toStringId(member?.user_id || member?.jugador?.usuario_id);
                    const memberHasUserAccount = Boolean(memberUserId);
                    const memberIsCaptain = Boolean(member?.is_captain);
                    const isCurrentUserCard = Boolean(memberUserId && memberUserId === toStringId(userId));
                    const canOpenMemberMenu = Boolean(isCurrentUserCard || isSelectedTeamManager);
                    const canTransferCaptain = isSelectedTeamManager
                      && !memberIsCaptain
                      && memberHasUserAccount
                      && !isCurrentUserCard;
                    const canRemoveOrLeave = Boolean(isCurrentUserCard || isSelectedTeamManager);

                    return (
                      <PlayerMiniCard
                        key={member.id}
                        variant="friend"
                        isSelf={isCurrentUserCard}
                        showRating={false}
                        profile={{
                          nombre: member?.jugador?.nombre || 'Jugador',
                          avatar_url: getMemberAvatar(member),
                          posicion: getMemberPositionForCard(member),
                          ranking: member?.jugador?.score ?? null,
                        }}
                        detailBadges={(
                          <div className="inline-flex items-center gap-1.5">
                            <span className="inline-flex h-[20px] w-[40px] items-center justify-center rounded border border-white/22 bg-[#16356b]/55 px-1 text-[10px] font-oswald font-bold leading-none text-[#e6f0ff]">
                              #{member.shirt_number ?? '-'}
                            </span>
                            {member.is_captain ? (
                              <span className="inline-flex h-[20px] w-[40px] items-center justify-center rounded border border-[#f6d06b]/65 bg-[linear-gradient(135deg,rgba(191,149,48,0.85),rgba(138,104,27,0.9))] px-1 text-[10px] font-oswald font-bold leading-none text-[#fff1c8]">
                                CAP
                              </span>
                            ) : null}
                          </div>
                        )}
                        rightSlot={canOpenMemberMenu ? (
                          <div className="relative" onClick={(event) => event.stopPropagation()}>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setOpenMemberMenuId((prev) => (prev === member.id ? null : member.id));
                              }}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/20 bg-white/8 text-white/80 hover:bg-white/15"
                              title="Acciones del jugador"
                              aria-label="Acciones del jugador"
                              disabled={isSaving}
                            >
                              <MoreVertical size={14} />
                            </button>

                            {openMemberMenuId === member.id ? (
                              <div
                                className="absolute right-10 top-1/2 z-30 w-44 -translate-y-1/2 rounded-xl border border-slate-700 bg-slate-900 shadow-lg overflow-hidden"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenMemberMenuId(null);
                                    if (isCurrentUserCard) {
                                      openEditMemberModal(member, { selfEdit: true });
                                      return;
                                    }

                                    if (memberHasUserAccount) {
                                      setProfileModalPlayer({
                                        id: memberUserId,
                                        user_id: memberUserId,
                                        usuario_id: memberUserId,
                                        uuid: memberUserId,
                                        nombre: member?.jugador?.nombre || 'Jugador',
                                        avatar_url: getMemberAvatar(member),
                                        posicion: getMemberPositionForCard(member),
                                        ranking: member?.jugador?.score ?? null,
                                        score: member?.jugador?.score ?? null,
                                      });
                                      return;
                                    }

                                    openEditMemberModal(member);
                                  }}
                                  className="w-full inline-flex items-center gap-2 px-3 py-2 text-left text-sm text-slate-100 transition-all hover:bg-slate-800"
                                >
                                  {isCurrentUserCard || !memberHasUserAccount ? <Pencil size={14} /> : <Eye size={14} />}
                                  {isCurrentUserCard
                                    ? 'Editar perfil'
                                    : (memberHasUserAccount ? 'Ver perfil' : 'Editar jugador')}
                                </button>

                                {canRemoveOrLeave ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      askRemoveMemberConfirmation(member);
                                    }}
                                    className="w-full inline-flex items-center gap-2 px-3 py-2 text-left text-sm text-red-200 transition-all hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed"
                                    disabled={isSaving}
                                  >
                                    <Trash2 size={14} />
                                    {isCurrentUserCard ? 'Abandonar equipo' : 'Borrar jugador'}
                                  </button>
                                ) : null}

                                {canTransferCaptain ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenMemberMenuId(null);
                                      handleTransferCaptain(member);
                                    }}
                                    className="w-full inline-flex items-center gap-2 px-3 py-2 text-left text-sm text-sky-100 transition-all hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed"
                                    disabled={isSaving}
                                  >
                                    <Crown size={14} />
                                    Transferir capitanía
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      />
                    );
                  })}
                  {teamPendingInvitations.map((invitation) => (
                    <PlayerMiniCard
                      key={`pending-${invitation.id}`}
                      variant="friend"
                      showRating={false}
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
          ) : null}

          {selectedTabLabel === 'history' ? (
            <div className="rounded-2xl border border-white/15 bg-[#0f172acc] p-4">
              <h5 className="text-white font-oswald text-xl">Historial vs rivales</h5>
              <div className="mt-2 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/80">
                PJ {summaryStats.played} · PG {summaryStats.won} · PE {summaryStats.draw} · PP {summaryStats.lost}
              </div>

              {detailLoading ? (
                <p className="text-sm text-white/65 mt-3">Cargando historial...</p>
              ) : null}

              {!detailLoading && teamMatchHistory.length === 0 ? (
                <p className="text-sm text-white/65 mt-3">Todavia no hay partidos registrados para este equipo.</p>
              ) : null}

              {!detailLoading && teamMatchHistory.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {teamMatchHistory.map((match) => (
                    <button
                      key={match.id}
                      type="button"
                      onClick={() => console.info('Detalle de partido pendiente', match.id)}
                      className="w-full rounded-xl border border-white/10 bg-white/5 p-3 text-left transition-all hover:bg-white/10"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-11 w-11 rounded-lg overflow-hidden border border-white/20 bg-black/20 flex items-center justify-center shrink-0">
                          {match?.opponentTeam?.crest_url ? (
                            <img src={match.opponentTeam.crest_url} alt={`Escudo ${match?.opponentTeam?.name || 'rival'}`} className="h-full w-full object-cover" />
                          ) : (
                            <Users size={16} className="text-white/60" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-white font-oswald text-[17px] truncate">{match?.opponentTeam?.name || 'Rival'}</p>
                          <p className="text-[12px] text-white/65">
                            {formatPlayedDate(match.playedAt)}
                            {match.locationName ? ` · ${match.locationName}` : ''}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-white font-oswald text-[18px] leading-none">{match.scoreFor} - {match.scoreAgainst}</p>
                          <span className={`mt-1 inline-flex min-w-[36px] items-center justify-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${getMatchResultBadgeClass(match.result)}`}>
                            {match.result}
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <TeamFormModal
        isOpen={teamFormOpen}
        initialTeam={selectedTeam}
        onClose={() => setTeamFormOpen(false)}
        onSubmit={handleUpdateTeamDetails}
        isSubmitting={isSaving}
      />

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
            className={disabledOptionCardClass}
            disabled={isSaving || isCurrentUserInTeam}
            onClick={handleAddCurrentUserAsMember}
          >
            <p className="text-white font-oswald text-[18px]">Agregarme a mí</p>
            <p className="mt-1 text-xs text-white/65">Usar mi perfil como jugador de este equipo.</p>
            {isCurrentUserInTeam ? (
              <p className="mt-1 text-[11px] text-white/60">Ya sos jugador de este equipo</p>
            ) : null}
          </button>

          <button
            type="button"
            className={disabledOptionCardClass}
            disabled={isSaving}
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
            className={disabledOptionCardClass}
            disabled={isSaving}
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
              Aceptar
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
              {memberModalMode === 'create' ? 'Agregar' : 'Guardar'}
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
                className="mt-1 w-full rounded-xl bg-slate-900/45 border border-white/10 px-3 py-2 text-white/55 cursor-not-allowed"
              />
            )}
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div className="block">
              <span className="text-xs text-white/80 uppercase tracking-wide">Posicion</span>
              {isEditingRegisteredMember ? (
                <>
                  <button
                    type="button"
                    onClick={() => setShowProfilePositionHint(true)}
                    className="mt-1 w-full inline-flex items-center justify-start rounded-xl bg-slate-900/45 border border-white/10 px-3 py-2 text-white/55 cursor-help"
                    aria-label="Posicion configurada desde perfil"
                  >
                    <span className="font-semibold tracking-wide">{selectedProfilePositionCode}</span>
                  </button>
                  {showProfilePositionHint ? (
                    <p className="mt-1 text-[11px] text-white/60">Podes cambiar tu posicion desde la ventana de perfil</p>
                  ) : null}
                </>
              ) : (
                <div ref={roleMenuContainerRef} className="relative mt-1">
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
              )}
            </div>

            <label className="block">
              <span className="text-xs text-white/80 uppercase tracking-wide">Numero</span>
              <input
                type="number"
                min={1}
                max={99}
                step={1}
                value={newMember.shirtNumber}
                onChange={(event) => {
                  const digitsOnly = String(event.target.value || '').replace(/\D/g, '');
                  if (!digitsOnly) {
                    setNewMember((prev) => ({ ...prev, shirtNumber: '' }));
                    return;
                  }
                  const parsed = Number(digitsOnly);
                  const clamped = Math.min(99, Math.max(1, parsed));
                  setNewMember((prev) => ({ ...prev, shirtNumber: String(clamped) }));
                }}
                placeholder="Ej: 4"
                className="mt-1 w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white"
              />
            </label>
          </div>

          {!memberSelfEditMode ? (
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
          ) : null}

        </form>
      </Modal>

      <ConfirmModal
        isOpen={Boolean(memberConfirmAction)}
        title={memberConfirmAction?.type === 'leave' ? 'Abandonar equipo' : 'Borrar jugador'}
        message={memberConfirmAction?.type === 'leave'
          ? `¿Seguro que querés abandonar "${selectedTeam?.name || 'este equipo'}"?`
          : `¿Seguro que querés borrar a ${memberConfirmAction?.memberName || 'este jugador'} del equipo?`}
        onConfirm={confirmRemoveMemberAction}
        onCancel={closeMemberConfirmModal}
        confirmText={memberConfirmAction?.type === 'leave' ? 'ABANDONAR' : 'BORRAR'}
        cancelText="CANCELAR"
        isDeleting={isSaving}
        danger
      />

      <ProfileCardModal
        isOpen={Boolean(profileModalPlayer)}
        onClose={() => setProfileModalPlayer(null)}
        profile={profileModalPlayer}
      />

    </>
  );
};

export default EquipoDetalleView;
