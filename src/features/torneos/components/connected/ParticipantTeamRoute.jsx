import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Info } from 'lucide-react';
import {
  Link,
  Navigate,
  Outlet,
  useLocation,
  useParams,
} from 'react-router-dom';
import { useTorneosWorkspace } from '../../context/TorneosWorkspaceContext';
import { BLOCK_REASON_COPY, registrationStage } from '../../domain/connectedProduct';
import { SESSION_CHECK_DETAIL, WorkspaceLoading } from '../WorkspaceState';
import styles from './ConnectedProduct.module.css';

// A team representative manages THEIR entry from their own space: the same registration screen the organization
// uses, without the organization's navigation, and only while the backend says they are an active captain or
// delegate of that entry (get_team_registration_context re-checks it on every load).
export default function ParticipantTeamRoute() {
  const { organizationId, teamEntryId } = useParams();
  const location = useLocation();
  const { service, status } = useTorneosWorkspace();
  const [state, setState] = useState({ status: 'loading', registration: null, tournamentName: '' });

  useEffect(() => {
    if (status !== 'ready') return undefined;
    let active = true;
    setState({ status: 'loading', registration: null, tournamentName: '' });
    Promise.all([
      service.loadTeamRegistration(organizationId, teamEntryId),
      typeof service.loadMyRegistrations === 'function'
        ? service.loadMyRegistrations({ limit: 50, offset: 0 }).catch(() => null)
        : Promise.resolve(null),
    ])
      .then(([context, registrations]) => {
        if (!active) return;
        const registration = (registrations?.items || []).find((item) => item.teamEntryId === teamEntryId) || null;
        setState({ status: 'ready', registration, tournamentName: context?.tournament?.name || 'Inscripción de equipo' });
      })
      .catch(() => { if (active) setState({ status: 'forbidden', registration: null, tournamentName: '' }); });
    return () => { active = false; };
  }, [organizationId, service, status, teamEntryId]);

  // The registration screen sends the request; the stage shown above it is re-read from the server, never assumed.
  const refreshRegistration = useCallback(async () => {
    if (typeof service?.loadMyRegistrations !== 'function') return;
    const registrations = await service.loadMyRegistrations({ limit: 50, offset: 0 }).catch(() => null);
    if (!registrations) return;
    const registration = (registrations.items || []).find((item) => item.teamEntryId === teamEntryId) || null;
    setState((current) => (current.status === 'ready' ? { ...current, registration } : current));
  }, [service, teamEntryId]);

  if (status !== 'ready' || state.status === 'loading') {
    return <WorkspaceLoading label="Confirmando tu acceso al equipo…" detail={SESSION_CHECK_DETAIL} />;
  }
  if (state.status === 'forbidden') {
    return (
      <Navigate
        to="/torneos/mis-torneos"
        replace
        state={{ safeMessage: 'Ya no tenés acceso a esa inscripción.' }}
      />
    );
  }

  const registration = state.registration;
  const stage = registration ? registrationStage(registration.status) : null;
  const organization = {
    id: organizationId,
    name: state.tournamentName,
    slug: 'acceso-equipo',
    role: 'team_manager',
    capabilities: [],
    relationalAccess: true,
    participantRoutes: true,
  };

  return (
    <div className={styles.participantTeam}>
      {/* «Solicitud creada…» only while the request is still being prepared. */}
      {location.state?.notice && (!registration || registration.status === 'in_progress') && (
        <p className={styles.successNotice} role="status">{location.state.notice}</p>
      )}
      {registration && (
        <section className={styles.stageBanner} data-tone={stage.tone} aria-label="Estado de la inscripción">
          <div>
            <strong>{stage.label}</strong>
            <span>{stage.detail}</span>
            {registration.lastReview?.reason && registration.status !== 'submitted' && (
              <blockquote>
                <Info size={14} aria-hidden="true" /> «{registration.lastReview.reason}»
              </blockquote>
            )}
            {registration.blockReason && (
              <span className={styles.warningText}>{BLOCK_REASON_COPY[registration.blockReason]}</span>
            )}
          </div>
          {registration.status === 'approved' && (
            <Link className={styles.secondaryAction} to={`/torneos/torneo/${encodeURIComponent(registration.tournamentId)}?categoria=${encodeURIComponent(registration.categoryId)}`}>
              Abrir torneo <ArrowRight size={16} aria-hidden="true" />
            </Link>
          )}
        </section>
      )}
      <Outlet context={{ organization, registration, onRegistrationChanged: refreshRegistration }} />
    </div>
  );
}
