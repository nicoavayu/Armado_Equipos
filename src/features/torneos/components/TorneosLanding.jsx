import React from 'react';
import { ArrowLeft, ArrowRight, Building2, Plus, ShieldCheck } from 'lucide-react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { getRoleLabel } from '../domain/capabilities';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import { WorkspaceError, WorkspaceLoading } from './WorkspaceState';
import styles from './TorneosShell.module.css';

export default function TorneosLanding() {
  const navigate = useNavigate();
  const {
    status,
    error,
    preference,
    availableOrganizations,
    selectOrganization,
    refresh,
  } = useTorneosWorkspace();

  if (status === 'loading' || status === 'idle') return <WorkspaceLoading />;
  if (status === 'error') {
    return <WorkspaceError message={error} onRetry={() => refresh().catch(() => {})} />;
  }

  const preferred = availableOrganizations.find(
    (organization) => organization.id === preference.activeOrganizationId,
  );
  if (preferred) {
    return (
      <Navigate
        to={`/torneos/organizacion/${preferred.id}/inicio`}
        replace
      />
    );
  }

  const openOrganization = async (organization) => {
    const selected = await selectOrganization(organization.id);
    if (selected) navigate(`/torneos/organizacion/${organization.id}/inicio`);
  };

  return (
    <div className={styles.landing}>
      <section className={styles.landingHero}>
        <div className={styles.heroBadge}>
          <ShieldCheck size={17} aria-hidden="true" />
          Entorno aislado · Desarrollo
        </div>
        <h1>El centro de mando de tu <em>competencia.</em></h1>
        <p>
          Creá una organización para preparar la operación de tus torneos.
          Los módulos deportivos se habilitarán en las próximas fases.
        </p>
        <div className={styles.heroActions}>
          <Link className={styles.primaryButton} to="/torneos/nueva-organizacion">
            <Plus size={18} aria-hidden="true" />
            Crear organización
          </Link>
          <Link className={styles.secondaryButton} to="/">
            <ArrowLeft size={18} aria-hidden="true" />
            Volver a Arma2
          </Link>
        </div>
      </section>

      {availableOrganizations.length > 0 && (
        <section className={styles.organizationPicker} aria-labelledby="organizations-title">
          <div className={styles.sectionHeading}>
            <span>Workspaces disponibles</span>
            <h2 id="organizations-title">Elegí dónde trabajar</h2>
          </div>
          <div className={styles.organizationCards}>
            {availableOrganizations.map((organization) => (
              <button
                key={organization.id}
                type="button"
                onClick={() => openOrganization(organization)}
              >
                <span className={styles.organizationMonogram}>
                  <Building2 size={22} aria-hidden="true" />
                </span>
                <span>
                  <strong>{organization.name}</strong>
                  <small>{getRoleLabel(organization.role)} · {organization.status}</small>
                </span>
                <ArrowRight size={19} aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
