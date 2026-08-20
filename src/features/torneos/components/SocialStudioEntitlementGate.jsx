import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  hasEffectiveTournamentEntitlement,
  normalizeTournamentEntitlements,
  TOURNAMENT_ENTITLEMENTS,
} from '../domain/entitlements';
import { canonicalRoutes } from '../routing/canonicalRoutes';
import { WorkspaceError, WorkspaceLoading } from './WorkspaceState';

export function useSocialStudioEntitlement({
  organizationId,
  service,
  enabled,
}) {
  const [state, setState] = useState({
    status: enabled && organizationId ? 'loading' : 'disabled',
    allowed: false,
    error: '',
  });

  useEffect(() => {
    if (!enabled || !organizationId) {
      setState({ status: 'disabled', allowed: false, error: '' });
      return undefined;
    }
    if (typeof service?.loadEntitlements !== 'function') {
      setState({
        status: 'error',
        allowed: false,
        error: 'No pudimos validar las funcionalidades disponibles.',
      });
      return undefined;
    }

    let active = true;
    setState({ status: 'loading', allowed: false, error: '' });
    service.loadEntitlements({ organizationId, tournamentId: null })
      .then((payload) => {
        if (!active) return;
        const entitlements = normalizeTournamentEntitlements(payload);
        setState({
          status: 'ready',
          allowed: hasEffectiveTournamentEntitlement(
            entitlements,
            TOURNAMENT_ENTITLEMENTS.SOCIAL_STUDIO_BASIC,
          ),
          error: '',
        });
      })
      .catch(() => {
        if (!active) return;
        setState({
          status: 'error',
          allowed: false,
          error: 'No pudimos validar las funcionalidades disponibles.',
        });
      });
    return () => { active = false; };
  }, [enabled, organizationId, service]);

  return state;
}

export default function SocialStudioEntitlementGate({
  access,
  organizationId,
  children,
}) {
  if (access.status === 'loading') {
    return <WorkspaceLoading label="Validando Estudio Social…" />;
  }
  if (access.status === 'error') {
    return <WorkspaceError message={access.error} />;
  }
  if (!access.allowed) {
    return (
      <Navigate
        to={canonicalRoutes.organizationHome(organizationId)}
        replace
        state={{ safeMessage: 'Estudio Social no está disponible para este espacio.' }}
      />
    );
  }
  return children;
}
