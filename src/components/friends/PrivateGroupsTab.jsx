import logger from '../../utils/logger';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  CalendarDays,
  FolderOpen,
  Loader2,
  MoreVertical,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import Modal from '../Modal';
import ConfirmModal from '../ConfirmModal';
import EmptyStateCard from '../EmptyStateCard';
import LoadingSpinner from '../LoadingSpinner';
import InviteGroupToMatchModal from './InviteGroupToMatchModal';
import { notifyBlockingError } from 'utils/notifyBlockingError';
import {
  addFriendsToPrivateGroup,
  archivePrivateGroup,
  createPrivateGroup,
  getPrivateGroupsByOwner,
  removeFriendFromPrivateGroup,
  renamePrivateGroup,
} from '../../services/db/privateFriendGroups';

const PRIMARY_ACTION_BUTTON_CLASS = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-none border border-[#7d5aff] bg-[#6a43ff] px-4 py-2.5 font-bebas text-base tracking-[0.01em] text-white shadow-[0_0_14px_rgba(106,67,255,0.3)] transition-all hover:bg-[#7550ff] active:opacity-95 disabled:cursor-not-allowed disabled:border-[rgba(125,90,255,0.45)] disabled:bg-[rgba(106,67,255,0.55)] disabled:text-white/45 disabled:shadow-none';
const SECONDARY_ACTION_BUTTON_CLASS = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-none border border-[rgba(148,134,255,0.28)] bg-white/[0.05] px-4 py-2.5 font-bebas text-base tracking-[0.01em] text-white/92 transition-all hover:bg-white/[0.1] active:opacity-95 disabled:cursor-not-allowed disabled:opacity-50';
const INPUT_CLASS = 'h-[52px] w-full appearance-none rounded-none border border-[rgba(148,134,255,0.28)] bg-white/[0.05] px-4 text-white font-oswald text-lg outline-none transition-all duration-300 focus:border-[#8b7cff] focus:bg-[rgba(29,23,64,0.95)] focus:ring-2 focus:ring-[#6a43ff]/30 placeholder:text-white/45 backdrop-blur-md';
const GROUP_CARD_CLASS = 'w-full rounded-none border border-[rgba(148,134,255,0.2)] bg-[rgba(20,16,41,0.8)] p-4 text-left transition-all duration-200 hover:border-[rgba(148,134,255,0.45)] hover:brightness-[1.03]';
const SECTION_TITLE_CLASS = 'font-oswald text-[clamp(16px,4.4vw,20px)] font-semibold leading-tight tracking-[0.01em] text-white';
const SECTION_DIVIDER_LABEL_CLASS = 'text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45 whitespace-nowrap';

const toText = (value) => String(value || '').trim();

const sortFriendsByName = (friends = []) => [...friends].sort((left, right) => (
  String(left?.nombre || '').localeCompare(String(right?.nombre || ''), 'es', { sensitivity: 'base' })
));

const sortGroupsByUpdatedAt = (groups = []) => [...groups].sort((left, right) => {
  const leftTs = Date.parse(left?.updated_at || left?.created_at || '');
  const rightTs = Date.parse(right?.updated_at || right?.created_at || '');
  return (Number.isFinite(rightTs) ? rightTs : 0) - (Number.isFinite(leftTs) ? leftTs : 0);
});

const normalizeFriendOption = (friend) => {
  const profile = friend?.profile || friend || {};
  const id = toText(profile?.id || friend?.id);
  if (!id) return null;

  return {
    id,
    nombre: profile?.nombre || friend?.nombre || 'Usuario',
    avatar_url: profile?.avatar_url || friend?.avatar_url || null,
    email: profile?.email || friend?.email || null,
    localidad: profile?.localidad || friend?.localidad || null,
  };
};

const getSafeMenuPosition = (rect) => {
  const menuWidth = 192;
  const menuHeight = 104;
  const margin = 12;
  const rawLeft = rect.right - menuWidth;
  const safeLeft = Math.min(
    Math.max(margin, rawLeft),
    Math.max(margin, window.innerWidth - menuWidth - margin),
  );
  const safeTop = Math.min(
    rect.bottom + 8,
    Math.max(margin, window.innerHeight - menuHeight - margin),
  );

  return { top: safeTop, left: safeLeft };
};

const FriendSelectorList = ({
  friends = [],
  selectedIds,
  onToggle,
  emptyLabel,
}) => {
  if (friends.length === 0) {
    return (
      <div className="rounded-none border border-dashed border-white/15 px-4 py-5 text-sm text-white/55">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="flex max-h-[320px] flex-col gap-2 overflow-y-auto pr-1">
      {friends.map((friend) => {
        const isSelected = selectedIds.has(friend.id);
        return (
          <button
            key={friend.id}
            type="button"
            onClick={() => onToggle(friend.id)}
            data-preserve-button-case="true"
            className={`flex items-center gap-3 rounded-none border px-3 py-2 text-left transition-all ${
              isSelected
                ? 'border-[#7d5aff] bg-[rgba(66,40,168,0.36)]'
                : 'border-[rgba(148,134,255,0.2)] bg-[rgba(18,28,62,0.78)] hover:border-[rgba(148,134,255,0.45)]'
            }`}
          >
            <img
              src={friend.avatar_url || '/profile.svg'}
              alt={friend.nombre || 'Usuario'}
              className="h-10 w-10 shrink-0 rounded-full border border-white/15 object-cover"
              onError={(event) => {
                event.currentTarget.src = '/profile.svg';
              }}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate font-oswald text-sm text-white">{friend.nombre || 'Usuario'}</div>
              <div className="truncate text-xs text-white/55">
                {friend.localidad || friend.email || 'Amigo'}
              </div>
            </div>
            <div className={`h-4 w-4 shrink-0 rounded-none border ${isSelected ? 'border-[#7d5aff] bg-[#6a43ff]' : 'border-white/35 bg-transparent'}`} />
          </button>
        );
      })}
    </div>
  );
};

const GroupMembersList = ({
  members = [],
  removingMemberId,
  onRemove,
  disabled = false,
}) => {
  if (members.length === 0) {
    return (
      <div className="rounded-none border border-dashed border-white/15 px-4 py-5 text-sm text-white/55">
        Este grupo todavía no tiene integrantes.
      </div>
    );
  }

  return (
    <div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-1">
      {members.map((member) => {
        const memberId = toText(member?.friend_user_id || member?.profile?.id);
        const isRemoving = removingMemberId === memberId;
        return (
          <div
            key={member?.id || memberId}
            className="flex items-center gap-3 rounded-none border border-[rgba(148,134,255,0.2)] bg-[rgba(12,22,52,0.86)] px-3 py-2"
          >
            <img
              src={member?.profile?.avatar_url || '/profile.svg'}
              alt={member?.profile?.nombre || 'Usuario'}
              className="h-10 w-10 shrink-0 rounded-full border border-white/15 object-cover"
              onError={(event) => {
                event.currentTarget.src = '/profile.svg';
              }}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate font-oswald text-sm text-white">
                {member?.profile?.nombre || 'Usuario'}
              </div>
              <div className="truncate text-xs text-white/55">
                {member?.profile?.localidad || member?.profile?.email || 'Amigo'}
              </div>
            </div>
            <button
              type="button"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-none border border-[rgba(148,134,255,0.28)] bg-white/[0.05] text-white/88 transition-all hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => onRemove?.(member)}
              disabled={disabled || isRemoving}
              aria-label={`Quitar del grupo a ${member?.profile?.nombre || 'este amigo'}`}
              title="Quitar del grupo"
            >
              {isRemoving ? <Loader2 size={16} className="animate-spin" /> : <X size={18} />}
            </button>
          </div>
        );
      })}
    </div>
  );
};

const GroupCard = ({
  group,
  onOpen,
  onInvite,
  onEdit,
  onDelete,
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef(null);

  return (
    <div className="relative overflow-visible">
      <div className={GROUP_CARD_CLASS}>
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={() => onOpen?.(group)}
            className="min-w-0 flex-1 text-left"
          >
            <div className="font-oswald text-lg font-semibold text-white truncate">
              {group?.name || 'Grupo'}
            </div>
            <div className="mt-1 text-sm text-white/60">
              {group?.member_count || 0} integrante{group?.member_count === 1 ? '' : 's'}
            </div>
          </button>

          <button
            ref={buttonRef}
            type="button"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-none border border-[rgba(148,134,255,0.28)] bg-white/[0.05] text-white/82 transition-all hover:bg-white/[0.1]"
            onClick={(event) => {
              event.stopPropagation();
              if (buttonRef.current) {
                const rect = buttonRef.current.getBoundingClientRect();
                setMenuPosition(getSafeMenuPosition(rect));
              }
              setShowMenu((prev) => !prev);
            }}
            aria-label={`Opciones de ${group?.name || 'este grupo'}`}
          >
            <MoreVertical size={16} />
          </button>
        </div>
      </div>

      {showMenu && ReactDOM.createPortal(
        <>
          <div
            className="fixed inset-0 z-[9998] bg-transparent"
            onClick={() => setShowMenu(false)}
          />
          <div
            className="fixed z-[9999] w-48 overflow-hidden rounded-none border border-[rgba(88,107,170,0.62)] bg-[rgba(7,19,48,0.98)] shadow-lg"
            style={{
              top: `${menuPosition.top}px`,
              left: `${menuPosition.left}px`,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="py-1">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-slate-100 transition-colors hover:bg-[rgba(19,38,88,0.95)]"
                onClick={() => {
                  setShowMenu(false);
                  onInvite?.(group);
                }}
              >
                <CalendarDays size={15} />
                <span>Invitar a partido</span>
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-slate-100 transition-colors hover:bg-[rgba(19,38,88,0.95)]"
                onClick={() => {
                  setShowMenu(false);
                  onEdit?.(group);
                }}
              >
                <Pencil size={15} />
                <span>Cambiar nombre</span>
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-red-200 transition-colors hover:bg-[rgba(19,38,88,0.95)]"
                onClick={() => {
                  setShowMenu(false);
                  onDelete?.(group);
                }}
              >
                <Trash2 size={15} />
                <span>Borrar grupo</span>
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
};

const CreateGroupModal = ({
  isOpen,
  friends,
  onClose,
  onCreate,
}) => {
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [selectedFriendIds, setSelectedFriendIds] = useState(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setSearch('');
    setSelectedFriendIds(new Set());
    setSaving(false);
  }, [isOpen]);

  const filteredFriends = useMemo(() => {
    const term = toText(search).toLowerCase();
    if (!term) return friends;

    return friends.filter((friend) => (
      `${friend?.nombre || ''} ${friend?.email || ''} ${friend?.localidad || ''}`
        .toLowerCase()
        .includes(term)
    ));
  }, [friends, search]);

  const footer = (
    <div className="flex flex-wrap justify-end gap-2">
      <button
        type="button"
        className={`${SECONDARY_ACTION_BUTTON_CLASS} min-w-[140px] flex-1 sm:flex-none`}
        onClick={onClose}
        disabled={saving}
        data-preserve-button-case="true"
      >
        Cancelar
      </button>
      <button
        type="button"
        className={`${PRIMARY_ACTION_BUTTON_CLASS} min-w-[140px] flex-1 sm:flex-none`}
        disabled={saving || !toText(name)}
        onClick={async () => {
          if (saving) return;
          setSaving(true);
          try {
            await onCreate?.({
              name,
              memberUserIds: Array.from(selectedFriendIds),
            });
          } finally {
            setSaving(false);
          }
        }}
        data-preserve-button-case="true"
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : null}
        {saving ? 'Guardando...' : 'Aceptar'}
      </button>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Crear grupo"
      footer={footer}
      className="w-full max-w-[620px] !bg-[#101a35] border border-[rgba(148,134,255,0.28)]"
      classNameContent="p-5"
    >
      <div className="flex flex-col gap-5">
        <div>
          <label htmlFor="private-group-name" className="mb-2 block text-sm text-white/70">
            Nombre del grupo
          </label>
          <input
            id="private-group-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={INPUT_CLASS}
            placeholder="Ej. Fútbol 7 del martes"
            maxLength={60}
          />
        </div>

        <div className="rounded-none border border-[rgba(148,134,255,0.2)] bg-[rgba(18,28,62,0.78)] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className={SECTION_TITLE_CLASS}>Agregar amigos</div>
            <div className="text-xs text-white/55">
              {selectedFriendIds.size} seleccionado{selectedFriendIds.size === 1 ? '' : 's'}
            </div>
          </div>

          {friends.length > 0 ? (
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className={INPUT_CLASS}
              placeholder="Buscar amigos..."
            />
          ) : null}

          <div className="mt-3">
            <FriendSelectorList
              friends={filteredFriends}
              selectedIds={selectedFriendIds}
              onToggle={(friendId) => {
                setSelectedFriendIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(friendId)) next.delete(friendId);
                  else next.add(friendId);
                  return next;
                });
              }}
              emptyLabel="Todavía no tenés amigos disponibles para agregar."
            />
          </div>
        </div>
      </div>
    </Modal>
  );
};

const EditGroupModal = ({
  isOpen,
  group,
  onClose,
  onSave,
}) => {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(group?.name || '');
    setSaving(false);
  }, [group?.id, group?.name, isOpen]);

  const footer = (
    <div className="flex flex-wrap justify-end gap-2">
      <button
        type="button"
        className={`${SECONDARY_ACTION_BUTTON_CLASS} min-w-[140px] flex-1 sm:flex-none`}
        onClick={onClose}
        disabled={saving}
        data-preserve-button-case="true"
      >
        Cancelar
      </button>
      <button
        type="button"
        className={`${PRIMARY_ACTION_BUTTON_CLASS} min-w-[140px] flex-1 sm:flex-none`}
        disabled={saving || !toText(name) || toText(name) === toText(group?.name)}
        onClick={async () => {
          if (saving) return;
          setSaving(true);
          try {
            await onSave?.(group, name);
          } finally {
            setSaving(false);
          }
        }}
        data-preserve-button-case="true"
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : null}
        {saving ? 'Guardando...' : 'Aceptar'}
      </button>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Editar grupo"
      footer={footer}
      className="w-full max-w-[520px] !bg-[#101a35] border border-[rgba(148,134,255,0.28)]"
      classNameContent="p-5"
    >
      <div className="flex flex-col gap-4">
        <div>
          <label htmlFor="edit-group-name" className="mb-2 block text-sm text-white/70">
            Nombre del grupo
          </label>
          <input
            id="edit-group-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={INPUT_CLASS}
            placeholder="Nombre del grupo"
            maxLength={60}
          />
        </div>
      </div>
    </Modal>
  );
};

const AddGroupMembersModal = ({
  isOpen,
  group,
  availableFriends,
  onClose,
  onAddMembers,
}) => {
  const [search, setSearch] = useState('');
  const [selectedFriendIds, setSelectedFriendIds] = useState(new Set());
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSearch('');
    setSelectedFriendIds(new Set());
    setAdding(false);
  }, [group?.id, group?.updated_at, isOpen]);

  const memberIdSet = useMemo(() => new Set(
    (group?.members || [])
      .map((member) => toText(member?.friend_user_id || member?.profile?.id))
      .filter(Boolean),
  ), [group?.members]);

  const addableFriends = useMemo(() => sortFriendsByName(
    (availableFriends || []).filter((friend) => !memberIdSet.has(friend.id)),
  ), [availableFriends, memberIdSet]);

  const filteredAddableFriends = useMemo(() => {
    const term = toText(search).toLowerCase();
    if (!term) return addableFriends;

    return addableFriends.filter((friend) => (
      `${friend?.nombre || ''} ${friend?.email || ''} ${friend?.localidad || ''}`
        .toLowerCase()
        .includes(term)
    ));
  }, [addableFriends, search]);

  const footer = (
    <div className="flex flex-wrap justify-end gap-2">
      <button
        type="button"
        className={`${SECONDARY_ACTION_BUTTON_CLASS} min-w-[140px] flex-1 sm:flex-none`}
        onClick={onClose}
        disabled={adding}
        data-preserve-button-case="true"
      >
        Cancelar
      </button>
      <button
        type="button"
        className={`${PRIMARY_ACTION_BUTTON_CLASS} min-w-[140px] flex-1 sm:flex-none`}
        disabled={adding || selectedFriendIds.size === 0}
        onClick={async () => {
          if (adding || selectedFriendIds.size === 0) return;
          setAdding(true);
          try {
            await onAddMembers?.(group, Array.from(selectedFriendIds));
            setSelectedFriendIds(new Set());
            setSearch('');
            onClose?.();
          } finally {
            setAdding(false);
          }
        }}
        data-preserve-button-case="true"
      >
        {adding ? <Loader2 size={16} className="animate-spin" /> : null}
        {adding ? 'Agregando...' : 'Aceptar'}
      </button>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Agregar amigos${group?.name ? ` · ${group.name}` : ''}`}
      footer={footer}
      className="w-full max-w-[620px] !bg-[#101a35] border border-[rgba(148,134,255,0.28)]"
      classNameContent="p-5"
    >
      <div className="flex flex-col gap-5">
        <div className="rounded-none border border-[rgba(148,134,255,0.2)] bg-[rgba(18,28,62,0.78)] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className={SECTION_TITLE_CLASS}>Agregar amigos</div>
            <div className="text-xs text-white/55">
              {selectedFriendIds.size} seleccionado{selectedFriendIds.size === 1 ? '' : 's'}
            </div>
          </div>

          {addableFriends.length > 0 ? (
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className={INPUT_CLASS}
              placeholder="Buscar amigos..."
            />
          ) : null}

          <div className="mt-3">
            <FriendSelectorList
              friends={filteredAddableFriends}
              selectedIds={selectedFriendIds}
              onToggle={(friendId) => {
                setSelectedFriendIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(friendId)) next.delete(friendId);
                  else next.add(friendId);
                  return next;
                });
              }}
              emptyLabel="No tenés más amigos disponibles para agregar a este grupo."
            />
          </div>
        </div>
      </div>
    </Modal>
  );
};

const GroupDetailModal = ({
  isOpen,
  group,
  availableFriends,
  onClose,
  onOpenAddMembers,
  onRemoveMember,
}) => {
  const [removingMemberId, setRemovingMemberId] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setRemovingMemberId(null);
  }, [group?.id, group?.updated_at, isOpen]);

  const memberIdSet = useMemo(() => new Set(
    (group?.members || [])
      .map((member) => toText(member?.friend_user_id || member?.profile?.id))
      .filter(Boolean),
  ), [group?.members]);

  const addableFriendsCount = useMemo(
    () => (availableFriends || []).filter((friend) => !memberIdSet.has(friend.id)).length,
    [availableFriends, memberIdSet],
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={group?.name || 'Grupo'}
      className="w-full max-w-[860px] !bg-[#101a35] border border-[rgba(148,134,255,0.28)]"
      classNameContent="p-5"
    >
      <div className="flex flex-col gap-4">
        <div>
          <button
            type="button"
            className={`${PRIMARY_ACTION_BUTTON_CLASS} w-full`}
            onClick={() => onOpenAddMembers?.(group)}
            disabled={addableFriendsCount === 0}
            data-preserve-button-case="true"
          >
            Agregar amigos
          </button>
          {addableFriendsCount === 0 ? (
            <p className="mt-3 text-xs text-white/45">
              No tenés más amigos disponibles para agregar.
            </p>
          ) : null}
        </div>

        <div className="rounded-none border border-[rgba(148,134,255,0.2)] bg-[rgba(18,28,62,0.78)] p-4">
          <div className="mb-3 text-white">
            <div className={SECTION_TITLE_CLASS}>Integrantes del grupo</div>
          </div>

          <GroupMembersList
            members={group?.members || []}
            removingMemberId={removingMemberId}
            disabled={false}
            onRemove={async (member) => {
              const memberId = toText(member?.friend_user_id || member?.profile?.id);
              setRemovingMemberId(memberId);
              try {
                await onRemoveMember?.(group, member);
              } finally {
                setRemovingMemberId(null);
              }
            }}
          />
        </div>
      </div>
    </Modal>
  );
};

const PrivateGroupsTab = ({
  currentUserId,
  friends = [],
  onInlineNotice,
}) => {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [inviteGroupId, setInviteGroupId] = useState(null);
  const [showAddMembersModal, setShowAddMembersModal] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [groupToArchive, setGroupToArchive] = useState(null);
  const [archiving, setArchiving] = useState(false);

  const friendOptions = useMemo(() => {
    const seenIds = new Set();
    return sortFriendsByName(
      (friends || [])
        .map(normalizeFriendOption)
        .filter((friend) => {
          if (!friend?.id || seenIds.has(friend.id)) return false;
          seenIds.add(friend.id);
          return true;
        }),
    );
  }, [friends]);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) || null,
    [groups, selectedGroupId],
  );

  const editingGroup = useMemo(
    () => groups.find((group) => group.id === editingGroupId) || null,
    [groups, editingGroupId],
  );

  const inviteGroup = useMemo(
    () => groups.find((group) => group.id === inviteGroupId) || null,
    [groups, inviteGroupId],
  );

  useEffect(() => {
    if (!selectedGroup) {
      setShowAddMembersModal(false);
    }
  }, [selectedGroup]);

  const replaceGroupInState = useCallback((updatedGroup, options = {}) => {
    if (!updatedGroup?.id) return;
    const selectGroup = options?.select !== false;
    setGroups((prev) => sortGroupsByUpdatedAt(
      prev.some((group) => group.id === updatedGroup.id)
        ? prev.map((group) => (group.id === updatedGroup.id ? updatedGroup : group))
        : [updatedGroup, ...prev],
    ));
    if (selectGroup) {
      setSelectedGroupId(updatedGroup.id);
    }
  }, []);

  const refreshGroups = useCallback(async () => {
    if (!currentUserId) {
      setGroups([]);
      setLoadError(null);
      return;
    }

    setLoading(true);
    try {
      const nextGroups = await getPrivateGroupsByOwner(currentUserId);
      setLoadError(null);
      setGroups(sortGroupsByUpdatedAt(nextGroups || []));
    } catch (error) {
      logger.error('[PRIVATE_GROUPS] Error loading groups:', error);
      setLoadError(error?.message || 'No se pudieron cargar tus grupos.');
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    refreshGroups();
  }, [refreshGroups]);

  const showSuccessNotice = useCallback((key, message) => {
    if (typeof onInlineNotice === 'function') {
      onInlineNotice({
        key,
        type: 'success',
        message,
      });
    }
  }, [onInlineNotice]);

  const handleCreateGroup = async ({ name, memberUserIds }) => {
    try {
      const createdGroup = await createPrivateGroup({
        ownerUserId: currentUserId,
        name,
        memberUserIds,
      });

      if (createdGroup) {
        replaceGroupInState(createdGroup, { select: false });
      } else {
        await refreshGroups();
      }

      setShowCreateModal(false);
      showSuccessNotice(`private_group_created_${createdGroup?.id || toText(name)}`, 'Grupo creado correctamente.');
    } catch (error) {
      notifyBlockingError(error?.message || 'No se pudo crear el grupo.');
    }
  };

  const handleRenameGroup = async (group, nextName) => {
    try {
      const updatedGroup = await renamePrivateGroup({
        groupId: group?.id,
        ownerUserId: currentUserId,
        name: nextName,
      });

      if (updatedGroup) replaceGroupInState(updatedGroup, {
        select: selectedGroupId === group?.id,
      });
      setEditingGroupId(null);
      showSuccessNotice(`private_group_renamed_${group?.id}`, 'Nombre del grupo actualizado.');
    } catch (error) {
      notifyBlockingError(error?.message || 'No se pudo editar el grupo.');
    }
  };

  const handleAddMembers = async (group, friendUserIds) => {
    try {
      const updatedGroup = await addFriendsToPrivateGroup({
        groupId: group?.id,
        ownerUserId: currentUserId,
        friendUserIds,
      });

      if (updatedGroup) replaceGroupInState(updatedGroup);
      showSuccessNotice(`private_group_members_added_${group?.id}`, 'Amigos agregados al grupo.');
    } catch (error) {
      notifyBlockingError(error?.message || 'No se pudieron agregar amigos al grupo.');
    }
  };

  const handleRemoveMember = async (group, member) => {
    try {
      const updatedGroup = await removeFriendFromPrivateGroup({
        groupId: group?.id,
        ownerUserId: currentUserId,
        friendUserId: member?.friend_user_id || member?.profile?.id,
      });

      if (updatedGroup) replaceGroupInState(updatedGroup);
      showSuccessNotice(`private_group_member_removed_${group?.id}_${member?.friend_user_id}`, 'Jugador quitado de este grupo.');
    } catch (error) {
      notifyBlockingError(error?.message || 'No se pudo quitar a este jugador del grupo.');
    }
  };

  const handleArchiveGroup = async () => {
    if (!groupToArchive?.id) return;

    try {
      setArchiving(true);
      await archivePrivateGroup({
        groupId: groupToArchive.id,
        ownerUserId: currentUserId,
      });

      setGroups((prev) => prev.filter((group) => group.id !== groupToArchive.id));
      if (selectedGroupId === groupToArchive.id) {
        setSelectedGroupId(null);
      }
      if (editingGroupId === groupToArchive.id) {
        setEditingGroupId(null);
      }
      showSuccessNotice(`private_group_archived_${groupToArchive.id}`, 'Grupo eliminado correctamente.');
      setGroupToArchive(null);
    } catch (error) {
      notifyBlockingError(error?.message || 'No se pudo eliminar el grupo.');
    } finally {
      setArchiving(false);
    }
  };

  return (
    <div className="w-full">
      <div className="mb-4 flex flex-col gap-3">
        <button
          type="button"
          className={`${PRIMARY_ACTION_BUTTON_CLASS} w-full`}
          onClick={() => setShowCreateModal(true)}
        >
          Crear grupo
        </button>

        <div className="mt-1 mb-0.5 flex items-center gap-2.5 px-1">
          <span className={SECTION_DIVIDER_LABEL_CLASS}>
            TUS GRUPOS
          </span>
          <span className="h-px flex-1 bg-[rgba(148,134,255,0.2)]" aria-hidden="true" />
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-[180px] items-center justify-center">
          <LoadingSpinner size="medium" />
        </div>
      ) : loadError ? (
        <EmptyStateCard
          icon={FolderOpen}
          title="No pudimos cargar tus grupos"
          description={loadError}
          className="my-0 p-5"
        />
      ) : groups.length === 0 ? (
        <EmptyStateCard
          icon={FolderOpen}
          title="Todavía no creaste grupos"
          description="Creá grupos privados para organizar amigos y usarlos al invitar a un partido."
          className="my-0 p-5"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              onOpen={(nextGroup) => setSelectedGroupId(nextGroup?.id || null)}
              onInvite={(nextGroup) => setInviteGroupId(nextGroup?.id || null)}
              onEdit={(nextGroup) => setEditingGroupId(nextGroup?.id || null)}
              onDelete={(nextGroup) => setGroupToArchive(nextGroup)}
            />
          ))}
        </div>
      )}

      <CreateGroupModal
        isOpen={showCreateModal}
        friends={friendOptions}
        onClose={() => setShowCreateModal(false)}
        onCreate={handleCreateGroup}
      />

      <EditGroupModal
        isOpen={Boolean(editingGroup)}
        group={editingGroup}
        onClose={() => setEditingGroupId(null)}
        onSave={handleRenameGroup}
      />

      <GroupDetailModal
        isOpen={Boolean(selectedGroup)}
        group={selectedGroup}
        availableFriends={friendOptions}
        onClose={() => setSelectedGroupId(null)}
        onOpenAddMembers={() => setShowAddMembersModal(true)}
        onRemoveMember={handleRemoveMember}
      />

      <AddGroupMembersModal
        isOpen={Boolean(selectedGroup) && showAddMembersModal}
        group={selectedGroup}
        availableFriends={friendOptions}
        onClose={() => setShowAddMembersModal(false)}
        onAddMembers={handleAddMembers}
      />

      <InviteGroupToMatchModal
        isOpen={Boolean(inviteGroup)}
        group={inviteGroup}
        currentUserId={currentUserId}
        onClose={() => setInviteGroupId(null)}
      />

      <ConfirmModal
        isOpen={Boolean(groupToArchive)}
        onCancel={() => setGroupToArchive(null)}
        onConfirm={handleArchiveGroup}
        isDeleting={archiving}
        title="Eliminar grupo"
        message={`¿Querés eliminar "${groupToArchive?.name || 'este grupo'}"? Esto no elimina amistades ni invitaciones existentes.`}
        confirmText="Eliminar grupo"
        cancelText="Cancelar"
        danger
      />
    </div>
  );
};

export default PrivateGroupsTab;
