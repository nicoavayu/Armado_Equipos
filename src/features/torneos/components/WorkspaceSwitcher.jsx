import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  CalendarRange,
  ChevronDown,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { torneosFeatureFlags } from '../config/featureFlags';
import { getRoleLabel } from '../domain/capabilities';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import styles from './TorneosShell.module.css';
import BrandingImage from './BrandingImage';

function OrganizationAvatar({ organization }) {
  return (
    <BrandingImage
      kind="organization"
      path={organization.logoPath}
      name={organization.name}
      className={styles.workspaceAvatar}
      imageClassName={styles.brandingContain}
    />
  );
}

export default function WorkspaceSwitcher() {
  const navigate = useNavigate();
  const location = useLocation();
  const containerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState('');
  const {
    activeOrganization,
    availableOrganizations,
    selectOrganization,
    selectPersonal,
  } = useTorneosWorkspace();

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        containerRef.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  if (!torneosFeatureFlags.workspaceSwitcher) return null;

  const goOrganization = async (organization) => {
    setBusyId(organization.id);
    try {
      const selected = await selectOrganization(organization.id);
      if (selected) {
        navigate(`/torneos/organizacion/${organization.id}/inicio`);
      }
    } finally {
      setBusyId('');
    }
  };

  const goMyTournaments = async () => {
    setBusyId('my-tournaments');
    try {
      await selectPersonal();
      navigate('/torneos/mis-torneos');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className={styles.switcher} ref={containerRef}>
      <button
        className={styles.workspaceButton}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {activeOrganization
          ? <OrganizationAvatar organization={activeOrganization} />
          : (
            <span className={styles.workspaceAvatar} aria-hidden="true">
              <ShieldCheck size={20} />
            </span>
          )}
        <span className={styles.workspaceCopy}>
          <small>Workspace Torneos</small>
          <strong>{activeOrganization?.name || 'Mis torneos'}</strong>
        </span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>

      {open && (
        <div className={styles.switcherMenu} role="menu" aria-label="Cambiar workspace de Torneos">
          <span className={styles.menuLabel}>Dentro de Torneos</span>

          <button
            type="button"
            role="menuitem"
            disabled={Boolean(busyId)}
            onClick={goMyTournaments}
          >
            <span className={styles.personalAvatar}><CalendarRange size={19} /></span>
            <span>
              <strong>Mis torneos</strong>
              <small>Calendario y competencia</small>
            </span>
            {busyId === 'my-tournaments' && <span className={styles.miniSpinner} />}
          </button>

          {availableOrganizations.map((organization) => (
            <button
              type="button"
              role="menuitem"
              key={organization.id}
              disabled={Boolean(busyId)}
              onClick={() => goOrganization(organization)}
            >
              <OrganizationAvatar organization={organization} />
              <span>
                <strong>{organization.name}</strong>
                <small>{getRoleLabel(organization.role)}</small>
              </span>
              {activeOrganization?.id === organization.id && busyId !== organization.id && (
                <Check size={17} aria-label="Espacio activo" />
              )}
              {busyId === organization.id && <span className={styles.miniSpinner} />}
            </button>
          ))}

          {availableOrganizations.some(({ role }) => ['owner', 'admin'].includes(role)) && (
            <button
              type="button"
              role="menuitem"
              className={styles.createWorkspaceItem}
              onClick={() => navigate('/torneos/nueva-organizacion')}
            >
              <span className={styles.personalAvatar}><Plus size={19} /></span>
              <span>
                <strong>Crear organización</strong>
                <small>Nuevo workspace de Torneos</small>
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
