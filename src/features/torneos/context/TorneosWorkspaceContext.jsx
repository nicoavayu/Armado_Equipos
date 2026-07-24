import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export const TORNEOS_WORKSPACE_STORAGE_KEY = 'arma2:torneos:last-workspace:v1';

export const PREVIEW_WORKSPACES = [
  {
    id: 'preview-liga-devoto',
    name: 'Liga Devoto',
    slug: 'liga-devoto',
    initials: 'LD',
    role: 'Owner',
    season: { id: 'preview-season-2027', name: 'Apertura 2027' },
    tournament: { id: 'preview-tournament-first', name: 'Primera' },
  },
  {
    id: 'preview-copa-potrero',
    name: 'Copa El Potrero',
    slug: 'copa-el-potrero',
    initials: 'CP',
    role: 'Tournament manager',
    season: { id: 'preview-summer-2027', name: 'Copa de verano' },
    tournament: { id: 'preview-tournament-open', name: 'Categoría abierta' },
  },
];

const TorneosWorkspaceContext = createContext(null);

function getBrowserStorage() {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

function getInitialWorkspaceId(workspaces, storage) {
  if (!workspaces.length) return null;

  try {
    const persistedId = storage?.getItem(TORNEOS_WORKSPACE_STORAGE_KEY);
    if (workspaces.some((workspace) => workspace.id === persistedId)) {
      return persistedId;
    }
  } catch {
    // Storage is a convenience only. A denied/unavailable storage API must not block the shell.
  }

  return workspaces[0].id;
}

export function TorneosWorkspaceProvider({
  children,
  workspaces = PREVIEW_WORKSPACES,
  storage = getBrowserStorage(),
}) {
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(
    () => getInitialWorkspaceId(workspaces, storage),
  );

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) || workspaces[0] || null,
    [activeWorkspaceId, workspaces],
  );

  useEffect(() => {
    if (!activeWorkspace?.id) return;

    try {
      storage?.setItem(TORNEOS_WORKSPACE_STORAGE_KEY, activeWorkspace.id);
    } catch {
      // Persistence failure is non-fatal; server-side authorization will be authoritative later.
    }
  }, [activeWorkspace?.id, storage]);

  const selectWorkspace = useCallback((workspaceId) => {
    const isKnownPreviewWorkspace = workspaces.some((workspace) => workspace.id === workspaceId);
    if (!isKnownPreviewWorkspace) return false;
    setActiveWorkspaceId(workspaceId);
    return true;
  }, [workspaces]);

  const value = useMemo(() => ({
    activeWorkspace,
    availableWorkspaces: workspaces,
    selectedSeason: activeWorkspace?.season || null,
    selectedTournament: activeWorkspace?.tournament || null,
    selectWorkspace,
    isAuthoritative: false,
  }), [activeWorkspace, selectWorkspace, workspaces]);

  return (
    <TorneosWorkspaceContext.Provider value={value}>
      {children}
    </TorneosWorkspaceContext.Provider>
  );
}

export function useTorneosWorkspace() {
  const context = useContext(TorneosWorkspaceContext);
  if (!context) {
    throw new Error('useTorneosWorkspace must be used inside TorneosWorkspaceProvider');
  }
  return context;
}
