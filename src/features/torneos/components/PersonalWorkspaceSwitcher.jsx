import React, { useState } from 'react';
import {
  ArrowRight,
  CalendarRange,
  Check,
  CircleUserRound,
  LoaderCircle,
  Plus,
  RotateCcw,
  Trophy,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { torneosFeatureFlags } from '../config/featureFlags';
import {
  TorneosWorkspaceProvider,
  useTorneosWorkspace,
} from '../context/TorneosWorkspaceContext';
import { getRoleLabel } from '../domain/capabilities';
import { importantNameProps } from './importantNames';
import styles from './PersonalWorkspaceSwitcher.module.css';
import './ImportantNames.css';

export function WorkspaceList() {
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState('');
  const {
    status,
    error,
    availableOrganizations,
    selectOrganization,
    refresh,
  } = useTorneosWorkspace();

  const openOrganization = async (organization) => {
    setBusyId(organization.id);
    try {
      const selected = await selectOrganization(organization.id);
      if (selected) navigate(`/torneos/organizacion/${organization.id}/inicio`);
    } finally {
      setBusyId('');
    }
  };

  return (
    <section className={styles.card} aria-labelledby="workspace-switcher-title">
      <div className={styles.header}>
        <span><Trophy size={18} /></span>
        <div>
          <small>Espacios</small>
          <h2 id="workspace-switcher-title">Arma2 y Torneos</h2>
        </div>
      </div>

      {status === 'loading' || status === 'idle' ? (
        <div className={styles.state} role="status">
          <LoaderCircle className={styles.spinner} size={19} />
          Validando espacios…
        </div>
      ) : status === 'error' ? (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => refresh().catch(() => {})}>
            <RotateCcw size={15} />
            Reintentar
          </button>
        </div>
      ) : (
        <div className={styles.list}>
          <button type="button" className={styles.activeItem} disabled>
            <span className={styles.personalIcon}><CircleUserRound size={20} /></span>
            <span>
              <strong>Arma2</strong>
              <small>Tu espacio personal</small>
            </span>
            <Check size={17} aria-label="Espacio activo" />
          </button>

          <button
            type="button"
            className={styles.tournamentsItem}
            onClick={() => navigate('/torneos/mis-torneos')}
          >
            <span className={styles.personalIcon}><CalendarRange size={20} /></span>
            <span>
              <strong>Mis torneos</strong>
              <small>Calendario y competencia</small>
            </span>
            <ArrowRight size={17} />
          </button>

          {availableOrganizations.map((organization) => (
            <button
              type="button"
              key={organization.id}
              disabled={Boolean(busyId)}
              onClick={() => openOrganization(organization)}
            >
              <span className={styles.organizationIcon}>
                {organization.name.slice(0, 2).toUpperCase()}
              </span>
              <span>
                <strong {...importantNameProps(organization.name, 'compact')}>{organization.name}</strong>
                <small>{getRoleLabel(organization.role)}</small>
              </span>
              {busyId === organization.id
                ? <LoaderCircle className={styles.spinner} size={17} />
                : <ArrowRight size={17} />}
            </button>
          ))}

          <button
            type="button"
            className={styles.createItem}
            onClick={() => navigate('/torneos/nueva-organizacion')}
          >
            <span className={styles.personalIcon}><Plus size={20} /></span>
            <span>
              <strong>Crear organización</strong>
              <small>Nuevo workspace privado</small>
            </span>
            <ArrowRight size={17} />
          </button>
        </div>
      )}
    </section>
  );
}

export default function PersonalWorkspaceSwitcher({ service }) {
  if (
    !torneosFeatureFlags.torneosEnabled
    || !torneosFeatureFlags.workspacesEnabled
    || !torneosFeatureFlags.workspaceSwitcher
  ) {
    return null;
  }

  return (
    <TorneosWorkspaceProvider service={service}>
      <WorkspaceList />
    </TorneosWorkspaceProvider>
  );
}
