import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  CalendarCheck,
  CheckCircle2,
  Save,
} from 'lucide-react';
import { Link, Navigate, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { useTorneosCompetition } from '../context/TorneosCompetitionContext';
import {
  normalizeCompetitionSlug,
  SEASON_STATUS_LABELS,
  validateSeasonDraft,
} from '../domain/competitionCatalog';
import {
  hasCapability,
  TOURNAMENT_CAPABILITIES,
} from '../domain/capabilities';
import { WorkspaceError, WorkspaceLoading } from './WorkspaceState';
import { importantNameProps } from './importantNames';
import styles from './CompetitionCore.module.css';

export default function SeasonFormPage() {
  const { organization } = useOutletContext();
  const organizationPath = `/torneos/organizacion/${organization.id}`;
  const { seasonId } = useParams();
  const navigate = useNavigate();
  const {
    status,
    error: loadError,
    seasons,
    createSeason,
    createIdempotencyKey,
    updateSeason,
    refresh,
  } = useTorneosCompetition();
  const season = useMemo(
    () => seasons.find((candidate) => candidate.id === seasonId) || null,
    [seasonId, seasons],
  );
  const isNew = !seasonId;
  const canCreate = hasCapability(
    organization,
    TOURNAMENT_CAPABILITIES.SEASONS_CREATE,
  );
  const canUpdate = hasCapability(
    organization,
    TOURNAMENT_CAPABILITIES.SEASONS_UPDATE,
  );
  const canArchive = hasCapability(
    organization,
    TOURNAMENT_CAPABILITIES.SEASONS_ARCHIVE,
  );
  const editable = isNew ? canCreate : canUpdate;
  const [values, setValues] = useState({
    name: '',
    slug: '',
    startDate: '',
    endDate: '',
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState('');
  const creationKeyRef = React.useRef(null);

  useEffect(() => {
    if (!season) return;
    setValues({
      name: season.name,
      slug: season.slug,
      startDate: season.startDate || '',
      endDate: season.endDate || '',
    });
    setSlugTouched(true);
  }, [season]);

  if (status === 'loading') return <WorkspaceLoading label="Validando temporada…" />;
  if (status === 'error') {
    return <WorkspaceError message={loadError} onRetry={() => refresh().catch(() => {})} />;
  }
  if (!isNew && !season) return <Navigate to={`${organizationPath}/torneos`} replace />;
  if (isNew && !canCreate) return <Navigate to={`${organizationPath}/torneos`} replace />;

  const change = (field, value) => {
    setValues((current) => {
      const next = { ...current, [field]: value };
      if (field === 'name' && !slugTouched) {
        next.slug = normalizeCompetitionSlug(value);
      }
      return next;
    });
    setErrors((current) => ({ ...current, [field]: '' }));
  };

  const submit = async (event) => {
    event.preventDefault();
    const validation = validateSeasonDraft(values);
    setErrors(validation);
    if (Object.keys(validation).length) return;
    setBusy('save');
    setFormError('');
    try {
      if (isNew) {
        creationKeyRef.current ||= createIdempotencyKey();
        const created = await createSeason({
          ...values,
          slug: normalizeCompetitionSlug(values.slug || values.name),
          idempotencyKey: creationKeyRef.current,
        });
        creationKeyRef.current = null;
        navigate(`${organizationPath}/temporadas/${created.id}`, { replace: true });
      } else {
        await updateSeason({
          seasonId: season.id,
          ...values,
          slug: normalizeCompetitionSlug(values.slug || values.name),
        });
      }
    } catch (error) {
      setFormError(error?.message || 'No pudimos guardar la temporada.');
    } finally {
      setBusy('');
    }
  };

  const changeStatus = async (nextStatus) => {
    setBusy(nextStatus);
    setFormError('');
    try {
      await updateSeason({ seasonId: season.id, status: nextStatus });
      if (nextStatus === 'archived') {
        navigate(`${organizationPath}/torneos`, { replace: true });
      }
    } catch (error) {
      setFormError(error?.message || 'No pudimos cambiar el estado.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className={styles.formPage}>
      <Link className={styles.backLink} to={`${organizationPath}/torneos`}>
        <ArrowLeft size={16} />
        Volver a torneos
      </Link>

      <header className={styles.formHeader}>
        <div>
          <span className={styles.kicker}>
            {isNew ? 'Nueva temporada' : SEASON_STATUS_LABELS[season.status]}
          </span>
          <h1 {...importantNameProps(isNew ? 'Abrí un nuevo ciclo' : season.name, 'hero')}>{isNew ? 'Abrí un nuevo ciclo' : season.name}</h1>
          <p>
            La temporada ordena competencias y calendario. Podés mantener más de
            una activa; el selector define cuál estás administrando.
          </p>
        </div>
        {!isNew && (
          <span className={styles.largeStatus} data-status={season.status} data-torneos-chip>
            {SEASON_STATUS_LABELS[season.status]}
          </span>
        )}
      </header>

      {!editable && (
        <div className={styles.readOnlyNotice}>
          <CheckCircle2 size={18} />
          Tu rol permite consultar esta temporada, sin editarla.
        </div>
      )}

      <form className={styles.seasonForm} onSubmit={submit}>
        <div className={styles.fieldWide}>
          <label htmlFor="season-name">Nombre</label>
          <input
            id="season-name"
            value={values.name}
            onChange={(event) => change('name', event.target.value)}
            placeholder="Apertura 2027"
            maxLength={80}
            disabled={!editable || Boolean(busy)}
          />
          {errors.name && <span className={styles.fieldError}>{errors.name}</span>}
        </div>
        <div className={styles.fieldWide}>
          <label htmlFor="season-slug">Identificador</label>
          <div className={styles.prefixedInput}>
            <span>/</span>
            <input
              id="season-slug"
              value={values.slug}
              onChange={(event) => {
                setSlugTouched(true);
                change('slug', normalizeCompetitionSlug(event.target.value));
              }}
              placeholder="apertura-2027"
              maxLength={48}
              disabled={!editable || Boolean(busy)}
            />
          </div>
          {errors.slug && <span className={styles.fieldError}>{errors.slug}</span>}
        </div>
        <div>
          <label htmlFor="season-start">Fecha inicial</label>
          <input
            id="season-start"
            type="date"
            value={values.startDate}
            onChange={(event) => change('startDate', event.target.value)}
            disabled={!editable || Boolean(busy)}
          />
        </div>
        <div>
          <label htmlFor="season-end">Fecha final</label>
          <input
            id="season-end"
            type="date"
            value={values.endDate}
            onChange={(event) => change('endDate', event.target.value)}
            disabled={!editable || Boolean(busy)}
          />
          {errors.endDate && <span className={styles.fieldError}>{errors.endDate}</span>}
        </div>

        {formError && <div className={styles.formAlert} role="alert">{formError}</div>}

        {editable && (
          <div className={styles.formFooter}>
            <button className={styles.primaryAction} type="submit" disabled={Boolean(busy)}>
              <Save size={17} />
              {busy === 'save' ? 'Guardando…' : 'Guardar temporada'}
            </button>
          </div>
        )}
      </form>

      {!isNew && editable && (
        <section className={styles.lifecyclePanel}>
          <div>
            <span className={styles.kicker}>Ciclo de vida</span>
            <h2>Estado de la temporada</h2>
            <p>Las transiciones se validan en el backend y no son cambios libres.</p>
          </div>
          <div>
            {season.status === 'draft' && (
              <button
                type="button"
                className={styles.secondaryAction}
                onClick={() => changeStatus('active')}
                disabled={Boolean(busy)}
              >
                <CalendarCheck size={17} />
                Activar temporada
              </button>
            )}
            {season.status === 'active' && (
              <button
                type="button"
                className={styles.secondaryAction}
                onClick={() => changeStatus('completed')}
                disabled={Boolean(busy)}
              >
                <CheckCircle2 size={17} />
                Marcar completada
              </button>
            )}
            {canArchive && ['draft', 'completed'].includes(season.status) && (
              <button
                type="button"
                className={styles.dangerAction}
                onClick={() => changeStatus('archived')}
                disabled={Boolean(busy)}
              >
                <Archive size={17} />
                Archivar
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
