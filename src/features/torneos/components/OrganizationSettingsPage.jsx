import React, { useEffect, useMemo, useState } from 'react';
import { Archive, Check, LoaderCircle, LockKeyhole, Save } from 'lucide-react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import {
  hasCapability,
  TOURNAMENT_CAPABILITIES,
} from '../domain/capabilities';
import {
  normalizeOrganizationSlug,
  validateOrganizationInput,
} from '../domain/organizationValidation';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import styles from './TorneosShell.module.css';

export default function OrganizationSettingsPage() {
  const navigate = useNavigate();
  const { organization } = useOutletContext();
  const { updateOrganization } = useTorneosWorkspace();
  const canUpdate = hasCapability(
    organization,
    TOURNAMENT_CAPABILITIES.ORGANIZATION_UPDATE,
  );
  const canArchive = hasCapability(
    organization,
    TOURNAMENT_CAPABILITIES.ORGANIZATION_ARCHIVE,
  );
  const [name, setName] = useState(organization.name);
  const [slug, setSlug] = useState(organization.slug);
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [confirmArchive, setConfirmArchive] = useState(false);
  const errors = useMemo(
    () => validateOrganizationInput({ name, slug }),
    [name, slug],
  );

  useEffect(() => {
    setName(organization.name);
    setSlug(organization.slug);
  }, [organization.name, organization.slug]);

  const save = async (event) => {
    event.preventDefault();
    setMessage('');
    if (!canUpdate || errors.name || errors.slug) return;
    setStatus('loading');
    try {
      await updateOrganization({
        organizationId: organization.id,
        name: name.trim(),
        slug,
      });
      setStatus('success');
      setMessage('Los cambios se guardaron.');
    } catch (error) {
      setStatus('error');
      setMessage(error?.message || 'No pudimos guardar los cambios.');
    }
  };

  const archive = async () => {
    if (!canArchive || !confirmArchive || status === 'loading') return;
    setStatus('loading');
    setMessage('');
    try {
      await updateOrganization({
        organizationId: organization.id,
        status: 'archived',
      });
      navigate('/torneos', { replace: true });
    } catch (error) {
      setStatus('error');
      setMessage(error?.message || 'No pudimos archivar la organización.');
    }
  };

  return (
    <div className={styles.settingsPage}>
      <header className={styles.pageHeader}>
        <span className={styles.eyebrow}>Organización</span>
        <h1>Configuración</h1>
        <p>
          {canUpdate
            ? 'Actualizá la identidad institucional del workspace.'
            : 'Tenés acceso de lectura a la configuración.'}
        </p>
      </header>

      <form className={styles.settingsCard} onSubmit={save}>
        {!canUpdate && (
          <div className={styles.readOnlyBanner}>
            <LockKeyhole size={18} />
            Modo lectura · Tu rol no permite editar la organización.
          </div>
        )}
        <div className={styles.field}>
          <label htmlFor="settings-name">Nombre</label>
          <input
            id="settings-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={!canUpdate}
            maxLength="80"
          />
          {errors.name && <span className={styles.fieldError}>{errors.name}</span>}
        </div>
        <div className={styles.field}>
          <label htmlFor="settings-slug">Identificador</label>
          <div className={styles.slugInput}>
            <span>torneos/</span>
            <input
              id="settings-slug"
              value={slug}
              onChange={(event) => setSlug(normalizeOrganizationSlug(event.target.value))}
              disabled={!canUpdate}
              maxLength="48"
            />
          </div>
          {errors.slug && <span className={styles.fieldError}>{errors.slug}</span>}
        </div>

        {message && (
          <div
            className={status === 'error' ? styles.formError : styles.formSuccess}
            role={status === 'error' ? 'alert' : 'status'}
          >
            {status === 'success' && <Check size={17} />}
            {message}
          </div>
        )}

        {canUpdate && (
          <button
            className={styles.primaryButton}
            type="submit"
            disabled={status === 'loading' || Boolean(errors.name || errors.slug)}
          >
            {status === 'loading'
              ? <LoaderCircle className={styles.spinner} size={18} />
              : <Save size={18} />}
            Guardar cambios
          </button>
        )}
      </form>

      {canArchive && (
        <section className={styles.dangerCard}>
          <div>
            <span className={styles.eyebrow}>Zona sensible</span>
            <h2>Archivar organización</h2>
            <p>
              Sale de todos los selectores y devuelve a los miembros a Arma2 personal.
              No se elimina información físicamente.
            </p>
          </div>
          <label className={styles.confirmCheck}>
            <input
              type="checkbox"
              checked={confirmArchive}
              onChange={(event) => setConfirmArchive(event.target.checked)}
            />
            Confirmo que quiero archivar este workspace
          </label>
          <button
            type="button"
            className={styles.dangerButton}
            disabled={!confirmArchive || status === 'loading'}
            onClick={archive}
          >
            <Archive size={17} />
            Archivar
          </button>
        </section>
      )}
    </div>
  );
}
