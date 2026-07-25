import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  CheckCircle2,
  Circle,
  Plus,
  RotateCcw,
  Save,
  ShieldAlert,
  Trash2,
  Trophy,
} from 'lucide-react';
import {
  Link,
  Navigate,
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { useTorneosCompetition } from '../context/TorneosCompetitionContext';
import {
  buildTournamentDraft,
  CHECKLIST_ITEMS,
  DEFAULT_TIEBREAKS,
  GENDER_OPTIONS,
  getDefaultFormatSettings,
  getGenderName,
  getOptionName,
  getTiebreakName,
  normalizeCompetitionSlug,
  TIEBREAK_OPTIONS,
  TOURNAMENT_STATUS_LABELS,
  toNullableNumber,
  validateTournamentStep,
} from '../domain/competitionCatalog';
import {
  hasCapability,
  TOURNAMENT_CAPABILITIES,
} from '../domain/capabilities';
import { WorkspaceError, WorkspaceLoading } from './WorkspaceState';
import styles from './CompetitionCore.module.css';

const STEPS = [
  'Información',
  'Modalidad',
  'Formato',
  'Reglas',
  'Categorías',
  'Revisión',
];

function draftFromTournament(tournament) {
  return {
    name: tournament.name,
    slug: tournament.slug,
    description: tournament.description || '',
    seasonId: tournament.seasonId,
    startDate: tournament.startDate || '',
    endDate: tournament.endDate || '',
    genderCategory: tournament.genderCategory,
    sportModality: tournament.sportModality,
    teamSize: tournament.teamSize,
    substitutesLimit: tournament.substitutesLimit ?? '',
    competitionFormat: tournament.competitionFormat,
    formatSettings: tournament.formatSettings || getDefaultFormatSettings(
      tournament.competitionFormat,
    ),
    registrationOpensAt: tournament.registrationOpensAt?.slice(0, 16) || '',
    registrationClosesAt: tournament.registrationClosesAt?.slice(0, 16) || '',
    scoring: {
      ...buildTournamentDraft().scoring,
      ...(tournament.scoring || {}),
      pointsWalkoverWin: tournament.scoring?.pointsWalkoverWin ?? '',
      pointsWalkoverLoss: tournament.scoring?.pointsWalkoverLoss ?? '',
    },
    tiebreaks: tournament.tiebreaks?.length
      ? [...tournament.tiebreaks]
      : [...DEFAULT_TIEBREAKS],
    discipline: {
      ...buildTournamentDraft().discipline,
      ...(tournament.discipline || {}),
      directRedSuggestedMatches:
        tournament.discipline?.directRedSuggestedMatches ?? '',
    },
  };
}

function categoryPayload(category, overrides = {}) {
  return {
    tournamentId: category.tournamentId,
    categoryId: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description || null,
    sortOrder: category.sortOrder || 0,
    minAge: category.minAge ?? null,
    maxAge: category.maxAge ?? null,
    genderCategory: category.genderCategory || null,
    sportModality: category.sportModality || null,
    teamSize: category.teamSize ?? null,
    status: category.status || 'active',
    ...overrides,
  };
}

function FormatSettings({ draft, setDraft, disabled }) {
  const settings = draft.formatSettings || {};
  const update = (key, value) => setDraft((current) => ({
    ...current,
    formatSettings: { ...current.formatSettings, [key]: value },
  }));
  const roundField = (key, label) => (
    <label>
      <span>{label}</span>
      <select
        value={settings[key] || 'single'}
        onChange={(event) => update(key, event.target.value)}
        disabled={disabled}
      >
        <option value="single">Una rueda / partido único</option>
        <option value="double">Ida y vuelta</option>
      </select>
    </label>
  );
  const numberField = (key, label, min, max) => (
    <label>
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={settings[key] ?? min}
        onChange={(event) => update(key, Number(event.target.value))}
        disabled={disabled}
      />
    </label>
  );

  return (
    <div className={styles.dependentSettings}>
      {draft.competitionFormat === 'league' && (
        <>
          {roundField('rounds', 'Rondas')}
          {numberField('qualifiers', 'Clasificados futuros', 0, 64)}
        </>
      )}
      {draft.competitionFormat === 'knockout' && (
        <>
          {roundField('legs', 'Definición de cada llave')}
          <label className={styles.toggleField}>
            <input
              type="checkbox"
              checked={Boolean(settings.thirdPlace)}
              onChange={(event) => update('thirdPlace', event.target.checked)}
              disabled={disabled}
            />
            <span>Preparar partido por el tercer puesto</span>
          </label>
        </>
      )}
      {draft.competitionFormat === 'groups' && (
        <>
          {numberField('groupCount', 'Cantidad de grupos', 2, 32)}
          {numberField('qualifiersPerGroup', 'Clasificados por grupo', 1, 16)}
          {roundField('rounds', 'Partidos del grupo')}
        </>
      )}
      {draft.competitionFormat === 'groups_and_playoffs' && (
        <>
          {numberField('groupCount', 'Cantidad de grupos', 2, 32)}
          {numberField('qualifiersPerGroup', 'Clasificados por grupo', 1, 16)}
          {roundField('groupRounds', 'Partidos del grupo')}
          {roundField('knockoutLegs', 'Llaves de playoffs')}
        </>
      )}
      {draft.competitionFormat === 'league_and_playoffs' && (
        <>
          {roundField('leagueRounds', 'Rondas de liga')}
          {numberField('qualifiers', 'Clasificados a playoffs', 2, 64)}
          {roundField('knockoutLegs', 'Llaves de playoffs')}
        </>
      )}
    </div>
  );
}

export default function TournamentWizardPage() {
  const { organization } = useOutletContext();
  const organizationPath = `/torneos/organizacion/${organization.id}`;
  const { tournamentId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    status,
    error: loadError,
    seasons,
    tournaments,
    modalities,
    formats,
    preference,
    refresh,
    createTournament,
    updateTournament,
    saveCategory,
    changeTournamentStatus,
  } = useTorneosCompetition();
  const tournament = useMemo(
    () => tournaments.find((candidate) => candidate.id === tournamentId) || null,
    [tournamentId, tournaments],
  );
  const isNew = !tournamentId;
  const canCreate = hasCapability(
    organization,
    TOURNAMENT_CAPABILITIES.TOURNAMENTS_CREATE,
  );
  const canUpdate = hasCapability(
    organization,
    TOURNAMENT_CAPABILITIES.TOURNAMENTS_UPDATE,
  );
  const canChangeStatus = hasCapability(
    organization,
    TOURNAMENT_CAPABILITIES.TOURNAMENTS_CHANGE_STATUS,
  );
  const canArchive = hasCapability(
    organization,
    TOURNAMENT_CAPABILITIES.TOURNAMENTS_ARCHIVE,
  );
  const canEditCategories = hasCapability(
    organization,
    TOURNAMENT_CAPABILITIES.CATEGORIES_UPDATE,
  );
  const editable = isNew ? canCreate : canUpdate;
  const requestedStep = Number(searchParams.get('step') || 0);
  const step = Number.isInteger(requestedStep) && requestedStep >= 0 && requestedStep < STEPS.length
    ? requestedStep
    : 0;
  const initializedTournamentRef = useRef(null);
  const [draft, setDraft] = useState(() => (
    tournament ? draftFromTournament(tournament) : buildTournamentDraft()
  ));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [categoryForm, setCategoryForm] = useState(null);

  useEffect(() => {
    const tournamentVersion = tournament
      ? `${tournament.id}:${tournament.updatedAt || ''}`
      : null;
    if (tournament && initializedTournamentRef.current !== tournamentVersion) {
      setDraft(draftFromTournament(tournament));
      setSlugTouched(true);
      initializedTournamentRef.current = tournamentVersion;
      return;
    }
    if (isNew && seasons.length && modalities.length && formats.length) {
      const seasonId = preference.activeSeasonId || seasons[0].id;
      setDraft((current) => (
        current.seasonId
          ? current
          : buildTournamentDraft({
            seasonId,
            modality: modalities[0],
            format: formats[0],
          })
      ));
    }
  }, [
    formats,
    isNew,
    modalities,
    preference.activeSeasonId,
    seasons,
    tournament,
  ]);

  if (status === 'loading') return <WorkspaceLoading label="Cargando configuración…" />;
  if (status === 'error') {
    return <WorkspaceError message={loadError} onRetry={() => refresh().catch(() => {})} />;
  }
  if (!isNew && !tournament) {
    return <Navigate to={`${organizationPath}/torneos`} replace />;
  }
  if (isNew && (!canCreate || !seasons.length)) {
    return <Navigate to={`${organizationPath}/torneos`} replace />;
  }

  const categories = tournament?.categories || [];
  const setStep = (next) => {
    setSearchParams(next ? { step: String(next) } : {}, { replace: true });
    setErrors({});
    setFormError('');
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  };
  const change = (field, value) => {
    setDraft((current) => {
      const next = { ...current, [field]: value };
      if (field === 'name' && !slugTouched) next.slug = normalizeCompetitionSlug(value);
      return next;
    });
    setErrors((current) => ({ ...current, [field]: '' }));
  };

  const patchForStep = (currentStep) => {
    if (currentStep === 0) {
      return {
        name: draft.name.trim(),
        slug: normalizeCompetitionSlug(draft.slug || draft.name),
        description: draft.description.trim(),
        genderCategory: draft.genderCategory,
        startDate: draft.startDate,
        endDate: draft.endDate,
        registrationOpensAt: draft.registrationOpensAt,
        registrationClosesAt: draft.registrationClosesAt,
      };
    }
    if (currentStep === 1) {
      return {
        sportModality: draft.sportModality,
        teamSize: Number(draft.teamSize),
        substitutesLimit: Number(draft.substitutesLimit),
      };
    }
    if (currentStep === 2) {
      return {
        competitionFormat: draft.competitionFormat,
        formatSettings: draft.formatSettings,
      };
    }
    if (currentStep === 3) {
      return {
        scoring: {
          ...draft.scoring,
          pointsWin: Number(draft.scoring.pointsWin),
          pointsDraw: Number(draft.scoring.pointsDraw),
          pointsLoss: Number(draft.scoring.pointsLoss),
          pointsWalkoverWin: toNullableNumber(draft.scoring.pointsWalkoverWin),
          pointsWalkoverLoss: toNullableNumber(draft.scoring.pointsWalkoverLoss),
        },
        tiebreaks: draft.tiebreaks,
        discipline: {
          ...draft.discipline,
          yellowsForSuspension: Number(draft.discipline.yellowsForSuspension),
          suspensionMatches: Number(draft.discipline.suspensionMatches),
          directRedSuggestedMatches: toNullableNumber(
            draft.discipline.directRedSuggestedMatches,
          ),
          yellowFairPlayPoints: Number(draft.discipline.yellowFairPlayPoints),
          redFairPlayPoints: Number(draft.discipline.redFairPlayPoints),
        },
      };
    }
    return null;
  };

  const saveCurrent = async ({ advance = false } = {}) => {
    const validation = validateTournamentStep(step, draft, categories);
    setErrors(validation);
    if (Object.keys(validation).length) return false;
    setBusy(advance ? 'continue' : 'save');
    setFormError('');
    try {
      if (isNew) {
        const created = await createTournament({
          seasonId: draft.seasonId,
          name: draft.name.trim(),
          slug: normalizeCompetitionSlug(draft.slug || draft.name),
          description: draft.description.trim(),
          sportModality: draft.sportModality,
          competitionFormat: draft.competitionFormat,
          genderCategory: draft.genderCategory,
          startDate: draft.startDate || null,
          endDate: draft.endDate || null,
        });
        navigate(`${organizationPath}/torneos/${created.id}/configuracion?step=${advance ? 1 : 0}`, {
          replace: true,
        });
        return true;
      }
      const patch = patchForStep(step);
      if (patch) {
        await updateTournament({ tournamentId: tournament.id, patch });
      }
      if (advance && step < STEPS.length - 1) setStep(step + 1);
      return true;
    } catch (error) {
      setFormError(error?.message || 'No pudimos guardar los cambios.');
      return false;
    } finally {
      setBusy('');
    }
  };

  const selectModality = (modality) => {
    setDraft((current) => ({
      ...current,
      sportModality: modality.code,
      teamSize: modality.teamSize,
      substitutesLimit: modality.recommendedSubstitutes,
    }));
  };

  const selectFormat = (format) => {
    setDraft((current) => ({
      ...current,
      competitionFormat: format.code,
      formatSettings: getDefaultFormatSettings(format.code),
    }));
  };

  const moveTiebreak = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= draft.tiebreaks.length) return;
    setDraft((current) => {
      const tiebreaks = [...current.tiebreaks];
      [tiebreaks[index], tiebreaks[target]] = [tiebreaks[target], tiebreaks[index]];
      return { ...current, tiebreaks };
    });
  };

  const openCategoryForm = (category = null) => {
    setCategoryForm(category ? {
      ...category,
      minAge: category.minAge ?? '',
      maxAge: category.maxAge ?? '',
      teamSize: category.teamSize ?? '',
    } : {
      id: null,
      name: '',
      slug: '',
      description: '',
      sortOrder: categories.length,
      minAge: '',
      maxAge: '',
      genderCategory: '',
      sportModality: '',
      teamSize: '',
    });
  };

  const submitCategory = async (event) => {
    event.preventDefault();
    if (!categoryForm.name.trim()) return;
    setBusy('category');
    setFormError('');
    try {
      await saveCategory({
        tournamentId: tournament.id,
        categoryId: categoryForm.id,
        name: categoryForm.name.trim(),
        slug: normalizeCompetitionSlug(categoryForm.slug || categoryForm.name),
        description: categoryForm.description || null,
        sortOrder: Number(categoryForm.sortOrder || 0),
        minAge: toNullableNumber(categoryForm.minAge),
        maxAge: toNullableNumber(categoryForm.maxAge),
        genderCategory: categoryForm.genderCategory || null,
        sportModality: categoryForm.sportModality || null,
        teamSize: toNullableNumber(categoryForm.teamSize),
        status: 'active',
      });
      setCategoryForm(null);
    } catch (error) {
      setFormError(error?.message || 'No pudimos guardar la categoría.');
    } finally {
      setBusy('');
    }
  };

  const archiveCategory = async (category) => {
    setBusy(`category-${category.id}`);
    try {
      await saveCategory(categoryPayload({
        ...category,
        tournamentId: tournament.id,
      }, { status: 'archived' }));
    } catch (error) {
      setFormError(error?.message || 'No pudimos archivar la categoría.');
    } finally {
      setBusy('');
    }
  };

  const reorderCategory = async (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= categories.length) return;
    setBusy('reorder');
    try {
      const first = categories[index];
      const second = categories[targetIndex];
      await saveCategory(categoryPayload(
        { ...first, tournamentId: tournament.id },
        { sortOrder: second.sortOrder },
      ));
      await saveCategory(categoryPayload(
        { ...second, tournamentId: tournament.id },
        { sortOrder: first.sortOrder },
      ));
    } catch (error) {
      setFormError(error?.message || 'No pudimos reordenar las categorías.');
    } finally {
      setBusy('');
    }
  };

  const changeStatus = async (nextStatus) => {
    setBusy(nextStatus);
    setFormError('');
    try {
      await changeTournamentStatus({
        tournamentId: tournament.id,
        status: nextStatus,
      });
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
    <div className={styles.wizardPage}>
      <Link className={styles.backLink} to={`${organizationPath}/torneos`}>
        <ArrowLeft size={16} />
        Volver a torneos
      </Link>

      <header className={styles.wizardHeader}>
        <div>
          <span className={styles.kicker}>
            {isNew ? 'Nuevo torneo' : TOURNAMENT_STATUS_LABELS[tournament.status]}
          </span>
          <h1>{isNew ? 'Diseñá la competencia' : tournament.name}</h1>
          <p>
            Configuración progresiva. Cada bloque se guarda por separado y podés
            retomarlo sin perder el contexto.
          </p>
        </div>
        {!isNew && (
          <span className={styles.largeStatus} data-status={tournament.status}>
            {TOURNAMENT_STATUS_LABELS[tournament.status]}
          </span>
        )}
      </header>

      {!editable && (
        <div className={styles.readOnlyNotice}>
          <CheckCircle2 size={18} />
          Vista de consulta. Tu rol no puede modificar la configuración.
        </div>
      )}

      <nav className={styles.stepper} aria-label="Pasos de configuración">
        {STEPS.map((label, index) => (
          <button
            key={label}
            type="button"
            className={index === step ? styles.stepActive : ''}
            onClick={() => setStep(index)}
            disabled={isNew && index > 0}
            aria-current={index === step ? 'step' : undefined}
          >
            <span>{index < step ? <Check size={14} /> : index + 1}</span>
            <em>{label}</em>
          </button>
        ))}
      </nav>

      <section className={styles.wizardCanvas}>
        <div className={styles.stepHeading}>
          <span>Paso {step + 1} de {STEPS.length}</span>
          <h2>{STEPS[step]}</h2>
        </div>

        {step === 0 && (
          <div className={styles.inputGrid}>
            <label className={styles.spanTwo}>
              <span>Nombre del torneo</span>
              <input
                value={draft.name}
                onChange={(event) => change('name', event.target.value)}
                maxLength={100}
                placeholder="Copa Apertura 2027"
                disabled={!editable || Boolean(busy)}
              />
              {errors.name && <small className={styles.fieldError}>{errors.name}</small>}
            </label>
            <label>
              <span>Temporada</span>
              <select
                value={draft.seasonId}
                onChange={(event) => change('seasonId', event.target.value)}
                disabled={!isNew || !editable || Boolean(busy)}
              >
                {seasons.map((season) => (
                  <option key={season.id} value={season.id}>{season.name}</option>
                ))}
              </select>
              {errors.seasonId && (
                <small className={styles.fieldError}>{errors.seasonId}</small>
              )}
            </label>
            <label>
              <span>Género o tipo</span>
              <select
                value={draft.genderCategory}
                onChange={(event) => change('genderCategory', event.target.value)}
                disabled={!editable || Boolean(busy)}
              >
                {GENDER_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>{option.name}</option>
                ))}
              </select>
            </label>
            <label className={styles.spanTwo}>
              <span>Identificador</span>
              <input
                value={draft.slug}
                onChange={(event) => {
                  setSlugTouched(true);
                  change('slug', normalizeCompetitionSlug(event.target.value));
                }}
                maxLength={64}
                disabled={!editable || Boolean(busy)}
              />
            </label>
            <label className={styles.spanTwo}>
              <span>Descripción <em>opcional</em></span>
              <textarea
                value={draft.description}
                onChange={(event) => change('description', event.target.value)}
                rows={4}
                maxLength={1200}
                placeholder="Objetivo, alcance y características de la competencia."
                disabled={!editable || Boolean(busy)}
              />
            </label>
            <label>
              <span>Fecha tentativa inicial</span>
              <input
                type="date"
                value={draft.startDate}
                onChange={(event) => change('startDate', event.target.value)}
                disabled={!editable || Boolean(busy)}
              />
            </label>
            <label>
              <span>Fecha tentativa final</span>
              <input
                type="date"
                value={draft.endDate}
                onChange={(event) => change('endDate', event.target.value)}
                disabled={!editable || Boolean(busy)}
              />
              {errors.endDate && (
                <small className={styles.fieldError}>{errors.endDate}</small>
              )}
            </label>
            <label>
              <span>Apertura prevista de inscripción</span>
              <input
                type="datetime-local"
                value={draft.registrationOpensAt}
                onChange={(event) => change('registrationOpensAt', event.target.value)}
                disabled={!editable || Boolean(busy)}
              />
            </label>
            <label>
              <span>Cierre previsto de inscripción</span>
              <input
                type="datetime-local"
                value={draft.registrationClosesAt}
                onChange={(event) => change('registrationClosesAt', event.target.value)}
                disabled={!editable || Boolean(busy)}
              />
            </label>
          </div>
        )}

        {step === 1 && (
          <>
            <div className={styles.optionGrid}>
              {modalities.map((modality) => (
                <button
                  key={modality.code}
                  type="button"
                  className={draft.sportModality === modality.code ? styles.optionSelected : ''}
                  onClick={() => selectModality(modality)}
                  disabled={!editable || Boolean(busy)}
                  aria-pressed={draft.sportModality === modality.code}
                >
                  <span>{modality.teamSize}</span>
                  <strong>{modality.name}</strong>
                  <small>
                    {modality.recommendedSubstitutes} suplentes recomendados ·
                    {' '}{modality.suggestedDurationMinutes} min
                  </small>
                </button>
              ))}
            </div>
            <div className={styles.inlineSettings}>
              <label>
                <span>Jugadores en cancha</span>
                <input
                  type="number"
                  min="5"
                  max="11"
                  value={draft.teamSize}
                  onChange={(event) => change('teamSize', event.target.value)}
                  disabled={!editable || Boolean(busy)}
                />
              </label>
              <label>
                <span>Límite de suplentes</span>
                <input
                  type="number"
                  min="0"
                  max="30"
                  value={draft.substitutesLimit}
                  onChange={(event) => change('substitutesLimit', event.target.value)}
                  disabled={!editable || Boolean(busy)}
                />
              </label>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className={styles.formatGrid}>
              {formats.map((format) => (
                <button
                  key={format.code}
                  type="button"
                  className={draft.competitionFormat === format.code
                    ? styles.formatSelected
                    : ''}
                  onClick={() => selectFormat(format)}
                  disabled={!editable || Boolean(busy)}
                  aria-pressed={draft.competitionFormat === format.code}
                >
                  <Trophy size={21} />
                  <strong>{format.name}</strong>
                  <span>{format.description}</span>
                </button>
              ))}
            </div>
            <FormatSettings draft={draft} setDraft={setDraft} disabled={!editable} />
          </>
        )}

        {step === 3 && (
          <div className={styles.rulesStack}>
            <section>
              <div className={styles.ruleTitle}>
                <span>01</span>
                <div>
                  <h3>Puntuación</h3>
                  <p>Se guardan las reglas; la tabla se implementará en una fase futura.</p>
                </div>
              </div>
              <div className={styles.pointsGrid}>
                {[
                  ['pointsWin', 'Victoria'],
                  ['pointsDraw', 'Empate'],
                  ['pointsLoss', 'Derrota'],
                ].map(([key, label]) => (
                  <label key={key}>
                    <span>{label}</span>
                    <input
                      type="number"
                      min="-10"
                      max="20"
                      value={draft.scoring[key]}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        scoring: { ...current.scoring, [key]: event.target.value },
                      }))}
                      disabled={!editable}
                    />
                    <small>puntos</small>
                  </label>
                ))}
              </div>
              {errors.scoring && <span className={styles.fieldError}>{errors.scoring}</span>}
            </section>

            <section>
              <div className={styles.ruleTitle}>
                <span>02</span>
                <div>
                  <h3>Desempates</h3>
                  <p>Puntos siempre ocupa el primer lugar y no se puede quitar.</p>
                </div>
              </div>
              <div className={styles.tiebreakList}>
                <div className={styles.lockedTiebreak}>
                  <span>1</span>
                  <strong>Puntos</strong>
                  <small>Criterio base</small>
                </div>
                {draft.tiebreaks.map((criterion, index) => (
                  <div key={criterion}>
                    <span>{index + 2}</span>
                    <div>
                      <strong>{getTiebreakName(criterion)}</strong>
                      <small>
                        {TIEBREAK_OPTIONS.find((option) => option.code === criterion)?.description}
                      </small>
                    </div>
                    {editable && (
                      <div>
                        <button
                          type="button"
                          onClick={() => moveTiebreak(index, -1)}
                          disabled={index === 0}
                          aria-label={`Subir ${getTiebreakName(criterion)}`}
                        >
                          <ArrowUp size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveTiebreak(index, 1)}
                          disabled={index === draft.tiebreaks.length - 1}
                          aria-label={`Bajar ${getTiebreakName(criterion)}`}
                        >
                          <ArrowDown size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDraft((current) => ({
                            ...current,
                            tiebreaks: current.tiebreaks.filter(
                              (item) => item !== criterion,
                            ),
                          }))}
                          aria-label={`Quitar ${getTiebreakName(criterion)}`}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {editable && (
                <div className={styles.ruleActions}>
                  <select
                    value=""
                    onChange={(event) => {
                      if (!event.target.value) return;
                      setDraft((current) => ({
                        ...current,
                        tiebreaks: [...current.tiebreaks, event.target.value],
                      }));
                    }}
                  >
                    <option value="">Agregar criterio…</option>
                    {TIEBREAK_OPTIONS.filter(
                      (option) => !draft.tiebreaks.includes(option.code),
                    ).map((option) => (
                      <option key={option.code} value={option.code}>{option.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setDraft((current) => ({
                      ...current,
                      tiebreaks: [...DEFAULT_TIEBREAKS],
                    }))}
                  >
                    <RotateCcw size={15} />
                    Restaurar orden
                  </button>
                </div>
              )}
              {errors.tiebreaks && (
                <span className={styles.fieldError}>{errors.tiebreaks}</span>
              )}
            </section>

            <section>
              <div className={styles.ruleTitle}>
                <span>03</span>
                <div>
                  <h3>Disciplina inicial</h3>
                  <p>Son reglas previas; todavía no crean sanciones ni expedientes.</p>
                </div>
              </div>
              <div className={styles.disciplineGrid}>
                {[
                  ['yellowsForSuspension', 'Amarillas para suspensión', 1, 20],
                  ['suspensionMatches', 'Fechas por acumulación', 1, 12],
                  ['directRedSuggestedMatches', 'Sugerencia por roja directa', 1, 12],
                  ['yellowFairPlayPoints', 'Puntos fair play por amarilla', 0, 20],
                  ['redFairPlayPoints', 'Puntos fair play por roja', 0, 40],
                ].map(([key, label, min, max]) => (
                  <label key={key}>
                    <span>{label}</span>
                    <input
                      type="number"
                      min={min}
                      max={max}
                      value={draft.discipline[key]}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        discipline: {
                          ...current.discipline,
                          [key]: event.target.value,
                        },
                      }))}
                      disabled={!editable}
                    />
                  </label>
                ))}
              </div>
              <div className={styles.toggleGrid}>
                {[
                  ['doubleYellowCountsAsRed', 'Doble amarilla cuenta como roja'],
                  ['resetYellowsEachStage', 'Reiniciar amarillas por fase'],
                  ['fairPlayEnabled', 'Usar fair play como criterio'],
                ].map(([key, label]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={Boolean(draft.discipline[key])}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        discipline: {
                          ...current.discipline,
                          [key]: event.target.checked,
                        },
                      }))}
                      disabled={!editable}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </section>
          </div>
        )}

        {step === 4 && (
          <div className={styles.categoriesLayout}>
            <div>
              <div className={styles.categoryHeader}>
                <div>
                  <h3>Categorías activas</h3>
                  <p>Heredan modalidad y género salvo que indiques un override.</p>
                </div>
                {editable && !categoryForm && (
                  <button
                    type="button"
                    className={styles.secondaryAction}
                    onClick={() => openCategoryForm()}
                  >
                    <Plus size={16} />
                    Agregar categoría
                  </button>
                )}
              </div>
              {!categories.length ? (
                <div className={styles.categoryEmpty}>
                  <Circle size={19} />
                  <span>
                    <strong>Falta una categoría</strong>
                    Es obligatoria para preparar la inscripción.
                  </span>
                </div>
              ) : (
                <div className={styles.categoryList}>
                  {categories.map((category, index) => (
                    <article key={category.id}>
                      <span className={styles.categoryOrder}>{index + 1}</span>
                      <div>
                        <strong>{category.name}</strong>
                        <small>
                          {category.genderCategory
                            ? getGenderName(category.genderCategory)
                            : `Hereda ${getGenderName(draft.genderCategory)}`}
                          {' · '}
                          {category.sportModality
                            ? getOptionName(modalities, category.sportModality)
                            : `Hereda ${getOptionName(modalities, draft.sportModality)}`}
                        </small>
                      </div>
                      {canEditCategories && (
                        <div>
                          <button
                            type="button"
                            onClick={() => reorderCategory(index, -1)}
                            disabled={index === 0 || Boolean(busy)}
                            aria-label={`Subir ${category.name}`}
                          >
                            <ArrowUp size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => reorderCategory(index, 1)}
                            disabled={index === categories.length - 1 || Boolean(busy)}
                            aria-label={`Bajar ${category.name}`}
                          >
                            <ArrowDown size={15} />
                          </button>
                          <button type="button" onClick={() => openCategoryForm(category)}>
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => archiveCategory(category)}
                            disabled={Boolean(busy)}
                            aria-label={`Archivar ${category.name}`}
                          >
                            <Archive size={15} />
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
              {errors.categories && (
                <span className={styles.fieldError}>{errors.categories}</span>
              )}
            </div>

            {categoryForm && (
              <form className={styles.categoryForm} onSubmit={submitCategory}>
                <div>
                  <span className={styles.kicker}>
                    {categoryForm.id ? 'Editar categoría' : 'Nueva categoría'}
                  </span>
                  <h3>{categoryForm.id ? categoryForm.name : 'Definí el segmento'}</h3>
                </div>
                <label>
                  <span>Nombre</span>
                  <input
                    value={categoryForm.name}
                    onChange={(event) => setCategoryForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))}
                    required
                    maxLength={80}
                  />
                </label>
                <label>
                  <span>Descripción <em>opcional</em></span>
                  <textarea
                    value={categoryForm.description}
                    onChange={(event) => setCategoryForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))}
                    rows={2}
                    maxLength={600}
                  />
                </label>
                <div className={styles.miniGrid}>
                  <label>
                    <span>Edad mínima</span>
                    <input
                      type="number"
                      min="5"
                      max="99"
                      value={categoryForm.minAge}
                      onChange={(event) => setCategoryForm((current) => ({
                        ...current,
                        minAge: event.target.value,
                      }))}
                    />
                  </label>
                  <label>
                    <span>Edad máxima</span>
                    <input
                      type="number"
                      min="5"
                      max="99"
                      value={categoryForm.maxAge}
                      onChange={(event) => setCategoryForm((current) => ({
                        ...current,
                        maxAge: event.target.value,
                      }))}
                    />
                  </label>
                </div>
                <label>
                  <span>Género</span>
                  <select
                    value={categoryForm.genderCategory}
                    onChange={(event) => setCategoryForm((current) => ({
                      ...current,
                      genderCategory: event.target.value,
                    }))}
                  >
                    <option value="">Heredar del torneo</option>
                    {GENDER_OPTIONS.map((option) => (
                      <option key={option.code} value={option.code}>{option.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Modalidad</span>
                  <select
                    value={categoryForm.sportModality}
                    onChange={(event) => {
                      const modality = modalities.find(
                        (item) => item.code === event.target.value,
                      );
                      setCategoryForm((current) => ({
                        ...current,
                        sportModality: event.target.value,
                        teamSize: modality?.teamSize || '',
                      }));
                    }}
                  >
                    <option value="">Heredar del torneo</option>
                    {modalities.map((modality) => (
                      <option key={modality.code} value={modality.code}>
                        {modality.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className={styles.formButtons}>
                  <button
                    type="button"
                    className={styles.ghostAction}
                    onClick={() => setCategoryForm(null)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className={styles.primaryAction}
                    disabled={busy === 'category'}
                  >
                    <Save size={16} />
                    {busy === 'category' ? 'Guardando…' : 'Guardar'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {step === 5 && (
          <div className={styles.reviewLayout}>
            <section className={styles.reviewSummary}>
              <div className={styles.reviewHero}>
                <span><Trophy size={25} /></span>
                <div>
                  <small>{seasons.find((season) => season.id === draft.seasonId)?.name}</small>
                  <h3>{draft.name}</h3>
                  <p>
                    {getOptionName(modalities, draft.sportModality)}
                    {' · '}
                    {getOptionName(formats, draft.competitionFormat)}
                    {' · '}
                    {getGenderName(draft.genderCategory)}
                  </p>
                </div>
              </div>
              <dl>
                <div>
                  <dt>Jugadores</dt>
                  <dd>{draft.teamSize} + {draft.substitutesLimit} suplentes</dd>
                </div>
                <div>
                  <dt>Categorías</dt>
                  <dd>{categories.length}</dd>
                </div>
                <div>
                  <dt>Puntos</dt>
                  <dd>
                    {draft.scoring.pointsWin} / {draft.scoring.pointsDraw} /
                    {' '}{draft.scoring.pointsLoss}
                  </dd>
                </div>
                <div>
                  <dt>Desempates</dt>
                  <dd>{draft.tiebreaks.length}</dd>
                </div>
              </dl>
            </section>
            <section className={styles.checklistPanel}>
              <div>
                <span className={styles.kicker}>Validación real</span>
                <h3>Listo para preparar inscripción</h3>
              </div>
              <ul>
                {CHECKLIST_ITEMS.map((item) => {
                  const checked = tournament?.checklist?.checks?.[item.key] ?? (
                    item.key === 'categories' ? categories.length > 0 : true
                  );
                  return (
                    <li key={item.key} data-complete={checked}>
                      {checked ? <CheckCircle2 size={17} /> : <Circle size={17} />}
                      {item.label}
                    </li>
                  );
                })}
              </ul>
              {tournament?.checklist?.warnings?.length > 0 && (
                <div className={styles.warningBox}>
                  <ShieldAlert size={17} />
                  Hay datos tentativos pendientes, pero no bloquean la preparación.
                </div>
              )}
              {editable && tournament?.status === 'draft' && canChangeStatus && (
                <button
                  type="button"
                  className={styles.primaryAction}
                  onClick={() => changeStatus('registration')}
                  disabled={Boolean(busy) || !tournament?.checklist?.ready}
                >
                  <CheckCircle2 size={17} />
                  {busy === 'registration'
                    ? 'Validando…'
                    : 'Preparar inscripción'}
                </button>
              )}
              {editable && tournament?.status === 'registration' && canChangeStatus && (
                <button
                  type="button"
                  className={styles.secondaryAction}
                  onClick={() => changeStatus('draft')}
                  disabled={Boolean(busy)}
                >
                  Volver a borrador
                </button>
              )}
              {canArchive && tournament && ['draft', 'registration'].includes(tournament.status) && (
                <button
                  type="button"
                  className={styles.dangerAction}
                  onClick={() => changeStatus('archived')}
                  disabled={Boolean(busy)}
                >
                  <Archive size={16} />
                  Archivar torneo
                </button>
              )}
            </section>
          </div>
        )}

        {formError && <div className={styles.formAlert} role="alert">{formError}</div>}

        <footer className={styles.wizardFooter}>
          <button
            type="button"
            className={styles.ghostAction}
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0 || Boolean(busy)}
          >
            <ArrowLeft size={16} />
            Anterior
          </button>
          <div>
            {editable && step < 4 && (
              <button
                type="button"
                className={styles.secondaryAction}
                onClick={() => saveCurrent()}
                disabled={Boolean(busy)}
              >
                <Save size={16} />
                {busy === 'save' ? 'Guardando…' : 'Guardar borrador'}
              </button>
            )}
            {step < STEPS.length - 1 && (
              <button
                type="button"
                className={styles.primaryAction}
                onClick={() => (
                  editable && step < 4
                    ? saveCurrent({ advance: true })
                    : setStep(step + 1)
                )}
                disabled={Boolean(busy) || (isNew && !editable)}
              >
                {busy === 'continue' ? 'Guardando…' : 'Continuar'}
                <ArrowRight size={16} />
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
