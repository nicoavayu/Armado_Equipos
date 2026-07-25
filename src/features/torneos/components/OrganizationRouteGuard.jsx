import React, { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { TorneosCompetitionProvider } from '../context/TorneosCompetitionContext';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import { WorkspaceError, WorkspaceLoading } from './WorkspaceState';

export default function OrganizationRouteGuard() {
  const { organizationId } = useParams();
  const location = useLocation();
  const [activationState, setActivationState] = useState('idle');
  const [relationalOrganization, setRelationalOrganization] = useState(null);
  const {
    status,
    error,
    preference,
    availableOrganizations,
    selectOrganization,
    refresh,
    service,
  } = useTorneosWorkspace();
  const organization = availableOrganizations.find(
    (candidate) => candidate.id === organizationId,
  );
  const relationalMatch = location.pathname.match(/\/equipos\/([0-9a-f-]{36})(?:\/|$)/i);
  const relationalTeamEntryId = relationalMatch?.[1] || null;

  useEffect(() => {
    if (status !== 'ready' || organization || !relationalTeamEntryId
      || typeof service?.loadTeamRegistration !== 'function') return undefined;
    let active = true;
    setActivationState('loading');
    setRelationalOrganization(null);
    service.loadTeamRegistration(organizationId, relationalTeamEntryId)
      .then((payload) => {
        if (!active) return;
        setRelationalOrganization({
          id: organizationId,
          name: payload?.tournament?.name || 'Inscripción de equipo',
          slug: 'acceso-equipo',
          role: 'team_manager',
          capabilities: [],
          relationalAccess: true,
        });
        setActivationState('ready');
      })
      .catch(() => {
        if (active) setActivationState('forbidden');
      });
    return () => { active = false; };
  }, [
    organization,
    organizationId,
    relationalTeamEntryId,
    service,
    status,
  ]);

  useEffect(() => {
    if (status !== 'ready' || !organization) return;
    if (preference.activeOrganizationId === organization.id) {
      setActivationState('ready');
      return;
    }
    let active = true;
    setActivationState('loading');
    selectOrganization(organization.id)
      .then((selected) => {
        if (active) setActivationState(selected ? 'ready' : 'forbidden');
      })
      .catch(() => {
        if (active) setActivationState('forbidden');
      });
    return () => {
      active = false;
    };
  }, [
    organization,
    preference.activeOrganizationId,
    selectOrganization,
    status,
  ]);

  if (status === 'loading' || status === 'idle') return <WorkspaceLoading />;
  if (status === 'error') {
    return <WorkspaceError message={error} onRetry={() => refresh().catch(() => {})} />;
  }
  if (!organization && !relationalOrganization && relationalTeamEntryId
    && activationState !== 'forbidden') {
    return <WorkspaceLoading label="Confirmando acceso al equipo…" />;
  }
  if ((!organization && !relationalOrganization) || activationState === 'forbidden') {
    return (
      <Navigate
        to="/torneos"
        replace
        state={{
          safeMessage: 'No encontramos un espacio activo al que tengas acceso.',
          from: location.pathname,
        }}
      />
    );
  }
  if (activationState !== 'ready') {
    return <WorkspaceLoading label="Confirmando acceso a la organización…" />;
  }

  if (relationalOrganization) {
    return <Outlet context={{ organization: relationalOrganization }} />;
  }

  return (
    <TorneosCompetitionProvider
      organizationId={(organization || relationalOrganization).id}
      service={service}
    >
      <Outlet context={{ organization: organization || relationalOrganization }} />
    </TorneosCompetitionProvider>
  );
}
