import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { tournamentWorkspaceService } from '../api/tournamentWorkspaceService';

export const TORNEOS_WORKSPACE_STORAGE_KEY = 'arma2:torneos:last-workspace:v2';

const PERSONAL_PREFERENCE = Object.freeze({
  workspaceType: 'personal',
  activeOrganizationId: null,
});

const TorneosWorkspaceContext = createContext(null);

function persistValidatedHint(preference) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      TORNEOS_WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        workspaceType: preference.workspaceType,
        activeOrganizationId: preference.activeOrganizationId || null,
      }),
    );
  } catch {
    // This is a non-authoritative loading hint only.
  }
}

function normalizeContext(payload) {
  const organizations = Array.isArray(payload?.organizations)
    ? payload.organizations
    : [];
  const requestedPreference = payload?.preference || PERSONAL_PREFERENCE;
  const activeOrganizationId = organizations.some(
    (organization) => organization.id === requestedPreference.activeOrganizationId,
  )
    ? requestedPreference.activeOrganizationId
    : null;

  return {
    organizations,
    preference: activeOrganizationId
      ? {
        workspaceType: 'tournament_organization',
        activeOrganizationId,
        updatedAt: requestedPreference.updatedAt || null,
      }
      : { ...PERSONAL_PREFERENCE, updatedAt: requestedPreference.updatedAt || null },
  };
}

export function TorneosWorkspaceProvider({
  children,
  service = tournamentWorkspaceService,
  autoLoad = true,
}) {
  const mountedRef = useRef(true);
  const [state, setState] = useState({
    status: autoLoad ? 'loading' : 'idle',
    organizations: [],
    preference: PERSONAL_PREFERENCE,
    error: '',
    notice: '',
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async ({ preserveNotice = false } = {}) => {
    setState((current) => ({
      ...current,
      status: 'loading',
      error: '',
      notice: preserveNotice ? current.notice : '',
    }));
    try {
      const normalized = normalizeContext(await service.loadContext());
      if (!mountedRef.current) return normalized;
      persistValidatedHint(normalized.preference);
      setState((current) => ({
        ...current,
        ...normalized,
        status: 'ready',
        error: '',
      }));
      return normalized;
    } catch (error) {
      if (!mountedRef.current) throw error;
      setState((current) => ({
        ...current,
        status: 'error',
        error: error?.message || 'No pudimos cargar tus espacios.',
      }));
      throw error;
    }
  }, [service]);

  useEffect(() => {
    if (!autoLoad) return;
    refresh().catch(() => {});
  }, [autoLoad, refresh]);

  const selectOrganization = useCallback(async (organizationId) => {
    const organization = state.organizations.find(
      (candidate) => candidate.id === organizationId,
    );
    if (!organization) {
      setState((current) => ({
        ...current,
        notice: 'Ya no tenés acceso a ese espacio.',
      }));
      return null;
    }

    const preference = await service.setPreference(
      'tournament_organization',
      organizationId,
    );
    const nextPreference = {
      workspaceType: 'tournament_organization',
      activeOrganizationId: preference?.activeOrganizationId || organizationId,
    };
    persistValidatedHint(nextPreference);
    setState((current) => ({
      ...current,
      preference: nextPreference,
      notice: '',
      error: '',
    }));
    return organization;
  }, [service, state.organizations]);

  const selectPersonal = useCallback(async () => {
    await service.setPreference('personal', null);
    persistValidatedHint(PERSONAL_PREFERENCE);
    setState((current) => ({
      ...current,
      preference: PERSONAL_PREFERENCE,
      notice: '',
      error: '',
    }));
    return true;
  }, [service]);

  const createOrganization = useCallback(async (input) => {
    const result = await service.createOrganization(input);
    const organization = {
      ...result.organization,
      role: result.membership?.role || 'owner',
      membershipStatus: result.membership?.status || 'active',
      joinedAt: result.membership?.joinedAt || result.organization?.createdAt,
      capabilities: result.membership?.capabilities || [],
    };
    const preference = result.preference || {
      workspaceType: 'tournament_organization',
      activeOrganizationId: organization.id,
    };
    persistValidatedHint(preference);
    setState((current) => ({
      ...current,
      status: 'ready',
      organizations: [
        ...current.organizations.filter((item) => item.id !== organization.id),
        organization,
      ].sort((left, right) => left.name.localeCompare(right.name)),
      preference,
      notice: 'Organización creada. Ya estás en su workspace.',
      error: '',
    }));
    return organization;
  }, [service]);

  const updateOrganization = useCallback(async (input) => {
    const updated = await service.updateOrganization(input);
    setState((current) => ({
      ...current,
      organizations: updated.status === 'active'
        ? current.organizations.map((organization) => (
          organization.id === updated.id ? { ...organization, ...updated } : organization
        ))
        : current.organizations.filter((organization) => organization.id !== updated.id),
      preference: updated.status === 'archived'
        ? PERSONAL_PREFERENCE
        : current.preference,
      notice: updated.status === 'archived'
        ? 'La organización fue archivada. Volvimos a tu espacio personal.'
        : 'Los cambios se guardaron.',
      error: '',
    }));
    return updated;
  }, [service]);

  const clearNotice = useCallback(() => {
    setState((current) => ({ ...current, notice: '' }));
  }, []);

  const activeOrganization = state.organizations.find(
    (organization) => organization.id === state.preference.activeOrganizationId,
  ) || null;

  const value = useMemo(() => ({
    ...state,
    availableOrganizations: state.organizations,
    activeOrganization,
    activeWorkspace: activeOrganization,
    isAuthoritative: state.status === 'ready',
    refresh,
    selectOrganization,
    selectWorkspace: selectOrganization,
    selectPersonal,
    createOrganization,
    updateOrganization,
    clearNotice,
    service,
  }), [
    activeOrganization,
    clearNotice,
    createOrganization,
    refresh,
    selectOrganization,
    selectPersonal,
    service,
    state,
    updateOrganization,
  ]);

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
