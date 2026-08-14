import React, { useMemo, useRef, useState } from 'react';
import { Building2, LoaderCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  normalizeOrganizationSlug,
  validateOrganizationInput,
} from '../domain/organizationValidation';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import styles from './TorneosShell.module.css';

export default function CreateOrganizationPage() {
  const navigate = useNavigate();
  const { createOrganization, service } = useTorneosWorkspace();
  const idempotencyKeyRef = useRef(service.createIdempotencyKey());
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [slugAvailability, setSlugAvailability] = useState('idle');
  const errors = useMemo(
    () => validateOrganizationInput({ name, slug }),
    [name, slug],
  );

  const updateName = (event) => {
    const value = event.target.value;
    setName(value);
    if (!slugTouched) {
      setSlug(normalizeOrganizationSlug(value));
      setSlugAvailability('idle');
    }
  };

  const updateSlug = (event) => {
    setSlugTouched(true);
    setSlug(normalizeOrganizationSlug(event.target.value));
    setSlugAvailability('idle');
  };

  const checkSlug = async () => {
    if (errors.slug) return false;
    setSlugAvailability('checking');
    try {
      const available = await service.checkSlugAvailability(slug);
      setSlugAvailability(available ? 'available' : 'unavailable');
      return available;
    } catch {
      setSlugAvailability('error');
      return null;
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setSubmitted(true);
    setError('');
    if (errors.name || errors.slug || status === 'loading') return;

    setStatus('loading');
    try {
      const slugIsAvailable = await checkSlug();
      if (slugIsAvailable === false) {
        setStatus('error');
        setError('Ese identificador ya está en uso. Probá con otro.');
        return;
      }
      if (slugIsAvailable === null) {
        setStatus('error');
        setError('No pudimos comprobar el identificador. Volvé a intentarlo.');
        return;
      }
      const organization = await createOrganization({
        name: name.trim(),
        slug,
        idempotencyKey: idempotencyKeyRef.current,
      });
      setStatus('success');
      navigate(`/torneos/organizacion/${organization.id}/inicio`, { replace: true });
    } catch (submitError) {
      setStatus('error');
      setError(submitError?.message || 'No pudimos crear la organización.');
    }
  };

  return (
    <div className={styles.formPage}>
      <div className={styles.formLayout}>
        <section className={styles.formIntro}>
          <div className={styles.formIntroHeader}>
            <span className={styles.organizationMonogram}><Building2 size={25} /></span>
            <div>
              <span className={styles.eyebrow}>Nuevo workspace</span>
              <h1>Creá tu organización</h1>
            </div>
          </div>
          <p>
            Vas a quedar como Propietario automáticamente. Nombre, membresía y espacio
            activo se guardan juntos en una única operación.
          </p>
        </section>

        <form className={styles.organizationForm} onSubmit={submit} noValidate>
          <div className={styles.field}>
            <label htmlFor="organization-name">Nombre de la organización</label>
            <input
              id="organization-name"
              value={name}
              onChange={updateName}
              autoComplete="organization"
              maxLength="80"
              placeholder="Ej. Liga Devoto"
              aria-invalid={submitted && Boolean(errors.name)}
              aria-describedby={submitted && errors.name ? 'organization-name-error' : undefined}
            />
            {submitted && errors.name && (
              <span id="organization-name-error" className={styles.fieldError}>
                {errors.name}
              </span>
            )}
          </div>

          <div className={styles.field}>
            <label htmlFor="organization-slug">Identificador</label>
            <div className={styles.slugInput}>
              <span>torneos/</span>
              <input
                id="organization-slug"
                value={slug}
                onChange={updateSlug}
                onBlur={() => {
                  if (!errors.slug) checkSlug();
                }}
                maxLength="48"
                spellCheck="false"
                autoCapitalize="none"
                placeholder="liga-devoto"
                aria-invalid={submitted && Boolean(errors.slug)}
                aria-describedby={submitted && errors.slug ? 'organization-slug-error' : 'slug-help'}
              />
            </div>
            {submitted && errors.slug ? (
              <span id="organization-slug-error" className={styles.fieldError}>
                {errors.slug}
              </span>
            ) : (
              <span id="slug-help" className={styles.fieldHint}>
                {slugAvailability === 'checking' && 'Comprobando disponibilidad…'}
                {slugAvailability === 'available' && 'Identificador disponible.'}
                {slugAvailability === 'unavailable' && 'Ese identificador ya está en uso.'}
                {slugAvailability === 'error' && 'No pudimos comprobarlo todavía.'}
                {slugAvailability === 'idle'
                  && 'Se usa como referencia legible. La autorización no depende del slug.'}
              </span>
            )}
          </div>

          {error && <div className={styles.formError} role="alert">{error}</div>}

          <button
            className={styles.primaryButton}
            type="submit"
            disabled={status === 'loading'}
          >
            {status === 'loading'
              ? <LoaderCircle className={styles.spinner} size={18} />
              : <Building2 size={18} />}
            {status === 'loading' ? 'Creando de forma segura…' : 'Crear organización'}
          </button>
        </form>
      </div>
    </div>
  );
}
