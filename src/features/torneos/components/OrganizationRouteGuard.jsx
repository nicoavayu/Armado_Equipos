import React, { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { TorneosCompetitionProvider } from '../context/TorneosCompetitionContext';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import { WorkspaceError, WorkspaceLoading } from './WorkspaceState';

export default function OrganizationRouteGuard() {
  const { organizationId } = useParams();
  const location = useLocation();
  const [activationState, setActivationState] = useState('idle');
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
  if (!organization || activationState === 'forbidden') {
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

  return (
    <TorneosCompetitionProvider organizationId={organization.id} service={service}>
      <Outlet context={{ organization }} />
    </TorneosCompetitionProvider>
  );
}
