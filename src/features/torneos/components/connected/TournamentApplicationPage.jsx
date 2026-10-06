import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Search,
  Send,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTorneosWorkspace } from '../../context/TorneosWorkspaceContext';
import {
  BLOCK_REASON_COPY,
  OPEN_REGISTRATION_STATUSES,
  ageRangeLabel,
  capacityLabel,
  entryFeeLabel,
  registrationStage,
} from '../../domain/connectedProduct';
import { ShareCallButton } from './CatalogCallPage';
import { useCatalogService } from './useCatalogService';
import { announceTorneosProfileChanged, useTorneosProfile } from './useTorneosProfile';
import styles from './ConnectedProduct.module.css';

const SEARCH_DELAY_MS = 350;

function errorCopy(error, fallback) {
  if (error?.code === 'CORE_DENIED') {
    return 'Arma2 no confirmó que administres ese equipo. Sólo su dueño o un administrador puede inscribirlo.';
  }
  return error?.message || fallback;
}

// Explorar → convocatoria → «Solicitar inscripción». The request is a team entry in preparation: the applicant
// becomes captain of THAT entry only (never of the organization), completes the roster with the tournament's own
// rules and sends it. Nothing here grants a place or private access: the organization decides.
export default function TournamentApplicationPage() {
  const { publicSlug } = useParams();
  const navigate = useNavigate();
  const { service } = useTorneosWorkspace();
  const catalog = useCatalogService();
  const profile = useTorneosProfile();
  const supported = typeof service?.startTournamentApplication === 'function';
  const [idempotencyKey] = useState(() => service?.createIdempotencyKey?.() || null);
  const [entryState, setEntryState] = useState({ status: 'loading', entry: null });
  const [existing, setExisting] = useState([]);
  const [displayName, setDisplayName] = useState('');
  const [categorySlug, setCategorySlug] = useState('');
  const [teamMode, setTeamMode] = useState('core');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState({ status: 'idle', items: [], error: '' });
  const [coreTeamId, setCoreTeamId] = useState('');
  const [teamName, setTeamName] = useState('');
  const [message, setMessage] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [submit, setSubmit] = useState({ status: 'idle', error: '' });
  const searchRequestRef = useRef(0);

  useEffect(() => {
    let active = true;
    catalog.loadEntry(publicSlug)
      .then((entry) => { if (active) setEntryState({ status: entry ? 'ready' : 'missing', entry }); })
      .catch(() => { if (active) setEntryState({ status: 'error', entry: null }); });
    if (typeof service?.loadMyRegistrations === 'function') {
      service.loadMyRegistrations({ limit: 50, offset: 0 })
        .then((payload) => {
          if (!active) return;
          setExisting((payload?.items || []).filter((item) => item.publicSlug === publicSlug));
        })
        .catch(() => {});
    }
    return () => { active = false; };
  }, [catalog, publicSlug, service]);

  useEffect(() => {
    if (!displayName && profile.status !== 'loading') setDisplayName(profile.profile?.displayName || profile.fallbackName || '');
  }, [displayName, profile.fallbackName, profile.profile, profile.status]);

  const entry = entryState.entry;
  const categories = useMemo(() => (entry?.categories || []), [entry]);
  useEffect(() => {
    if (categorySlug || !categories.length) return;
    const firstOpen = categories.find((category) => category.accepting);
    if (firstOpen) setCategorySlug(firstOpen.slug);
  }, [categories, categorySlug]);

  useEffect(() => {
    if (teamMode !== 'core') return undefined;
    const trimmed = query.trim();
    setCoreTeamId('');
    if (trimmed.length < 2) {
      setSearch({ status: 'idle', items: [], error: '' });
      return undefined;
    }
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    setSearch((current) => ({ ...current, status: 'loading', error: '' }));
    const timer = window.setTimeout(async () => {
      try {
        const payload = await service.searchApplicableCoreTeams({ publicSlug, query: trimmed, limit: 8 });
        if (searchRequestRef.current === requestId) setSearch({ status: 'ready', items: payload?.items || [], error: '' });
      } catch (error) {
        if (searchRequestRef.current === requestId) {
          setSearch({ status: 'error', items: [], error: errorCopy(error, 'No pudimos buscar tus equipos.') });
        }
      }
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [publicSlug, query, service, teamMode]);

  const openExisting = existing.filter((item) => OPEN_REGISTRATION_STATUSES.includes(item.status) || item.status === 'approved');
  const nameValid = displayName.trim().length >= 2 && displayName.trim().length <= 60;
  const teamValid = teamMode === 'core' ? Boolean(coreTeamId) : teamName.trim().length >= 2;
  const ready = supported && entry?.state === 'open' && nameValid && Boolean(categorySlug) && teamValid && accepted
    && submit.status !== 'saving';

  const send = async (event) => {
    event.preventDefault();
    if (!ready) return;
    setSubmit({ status: 'saving', error: '' });
    try {
      const trimmedName = displayName.trim();
      if (profile.supported && trimmedName !== (profile.profile?.displayName || '')) {
        await service.updateTorneosProfile({
          displayName: trimmedName,
          notifyRegistrationRequests: profile.profile?.notifyRegistrationRequests !== false,
        });
        announceTorneosProfileChanged();
      }
      const result = await service.startTournamentApplication({
        publicSlug,
        categorySlug,
        coreTeamId: teamMode === 'core' ? coreTeamId : null,
        teamName: teamMode === 'new' ? teamName.trim() : null,
        message: message.trim() || null,
        acceptConditions: true,
        idempotencyKey,
      });
      navigate(`/torneos/mis-equipos/${encodeURIComponent(result.organizationId)}/${encodeURIComponent(result.teamEntryId)}/plantel`, {
        replace: true,
        state: { notice: 'Solicitud creada. Completá el plantel con los requisitos del torneo y enviala a la organización.' },
      });
    } catch (error) {
      setSubmit({ status: 'error', error: errorCopy(error, 'No pudimos crear la solicitud.') });
    }
  };

  const back = (
    <Link className={styles.backLink} to={`/torneos/explorar/${encodeURIComponent(publicSlug)}`}>
      <ArrowLeft size={17} aria-hidden="true" /> Volver a la convocatoria
    </Link>
  );

  if (entryState.status === 'loading') {
    return <div className={styles.page}>{back}<div className={styles.skeletonBlock} role="status"><span className={styles.srOnly}>Cargando…</span></div></div>;
  }
  if (entryState.status !== 'ready') {
    return (
      <div className={styles.page}>
        {back}
        <section className={styles.stateCard} role="alert">
          <h1>Esta convocatoria no está disponible</h1>
          <p>La organización la retiró o ya no recibe equipos.</p>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {back}
      <header className={styles.pageHero}>
        <span className={styles.kicker}><ShieldCheck size={15} aria-hidden="true" /> Solicitud de inscripción</span>
        <h1>{entry.tournamentName}</h1>
        <p>Organiza {entry.organizationName}. Pedir la inscripción no garantiza un lugar: la organización revisa cada solicitud.</p>
      </header>

      {openExisting.length > 0 && (
        <section className={styles.infoCard} aria-label="Tus inscripciones en este torneo">
          <h2>Ya tenés {openExisting.length === 1 ? 'una inscripción' : 'inscripciones'} en este torneo</h2>
          <ul className={styles.plainList}>
            {openExisting.map((item) => (
              <li key={item.teamEntryId}>
                <Link to={`/torneos/mis-equipos/${encodeURIComponent(item.organizationId)}/${encodeURIComponent(item.teamEntryId)}`}>
                  {item.teamName} · {item.categoryName} — {registrationStage(item.status).label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {entry.state !== 'open' ? (
        <section className={styles.stateCard} role="status">
          <h2>No está recibiendo solicitudes</h2>
          <p>{BLOCK_REASON_COPY[entry.blockReason] || 'La organización no está recibiendo solicitudes ahora.'}</p>
        </section>
      ) : !supported ? (
        <section className={styles.stateCard} role="status">
          <h2>Las solicitudes no están disponibles en esta versión</h2>
          <p>Podés compartir la convocatoria con la persona responsable de tu equipo.</p>
          <ShareCallButton publicSlug={publicSlug} tournamentName={entry.tournamentName} />
        </section>
      ) : (
        <form className={styles.stepForm} onSubmit={send} noValidate>
          <fieldset className={styles.step}>
            <legend><span>1</span> Cómo te va a ver la organización</legend>
            <label className={styles.field}>
              <span>Nombre de presentación en Torneos</span>
              <input
                value={displayName}
                maxLength={60}
                autoComplete="name"
                onChange={(event) => setDisplayName(event.target.value)}
                aria-invalid={!nameValid}
                aria-describedby="application-name-help"
              />
            </label>
            <p id="application-name-help" className={styles.help}>
              Se guarda en tu perfil de Torneos. No cambia tu perfil de Arma2 ni los nombres oficiales del plantel.
            </p>
          </fieldset>

          <fieldset className={styles.step}>
            <legend><span>2</span> Categoría</legend>
            <div className={styles.choiceList}>
              {categories.map((category) => (
                <label key={category.slug} className={styles.choice} data-disabled={!category.accepting}>
                  <input
                    type="radio"
                    name="category"
                    value={category.slug}
                    checked={categorySlug === category.slug}
                    disabled={!category.accepting}
                    onChange={() => setCategorySlug(category.slug)}
                  />
                  <span>
                    <strong>{category.name}</strong>
                    <small>{ageRangeLabel(category.minAge, category.maxAge)} · {capacityLabel(category)}</small>
                    {!category.accepting && <small className={styles.warningText}>{BLOCK_REASON_COPY[category.blockReason] || 'No disponible'}</small>}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className={styles.step}>
            <legend><span>3</span> Equipo</legend>
            <div className={styles.segmented} role="radiogroup" aria-label="Qué equipo vas a inscribir">
              <button type="button" role="radio" aria-checked={teamMode === 'core'} onClick={() => setTeamMode('core')}>
                Un equipo que administro en Arma2
              </button>
              <button type="button" role="radio" aria-checked={teamMode === 'new'} onClick={() => setTeamMode('new')}>
                Un equipo nuevo para este torneo
              </button>
            </div>
            {teamMode === 'core' ? (
              <>
                <label className={styles.searchField}>
                  <Search size={18} aria-hidden="true" />
                  <span className={styles.srOnly}>Nombre de tu equipo</span>
                  <input
                    type="search"
                    value={query}
                    maxLength={100}
                    placeholder="Escribí el nombre de tu equipo"
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <p className={styles.help}>
                  Sólo aparecen equipos de los que sos dueño o administrador en Arma2. Inscribirlo no cambia sus
                  miembros ni sus partidos, y nadie entra al plantel automáticamente.
                </p>
                {search.status === 'loading' && <p className={styles.help} role="status"><Loader2 className={styles.spin} size={14} /> Buscando…</p>}
                {search.status === 'error' && <p className={styles.errorText} role="alert">{search.error}</p>}
                {search.status === 'ready' && search.items.length === 0 && (
                  <div className={styles.infoCard}>
                    <p>
                      No encontramos equipos que administres con ese nombre. Si sos jugador, compartí la convocatoria
                      con quien administra el equipo, o inscribí un equipo nuevo.
                    </p>
                    <ShareCallButton publicSlug={publicSlug} tournamentName={entry.tournamentName} />
                  </div>
                )}
                {search.items.length > 0 && (
                  <div className={styles.choiceList}>
                    {search.items.map((team) => (
                      <label key={team.id} className={styles.choice}>
                        <input
                          type="radio"
                          name="core-team"
                          value={team.id}
                          checked={coreTeamId === team.id}
                          onChange={() => setCoreTeamId(team.id)}
                        />
                        <span><strong>{team.name}</strong><small>Equipo de Arma2 que administrás</small></span>
                      </label>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <label className={styles.field}>
                  <span>Nombre del equipo</span>
                  <input value={teamName} maxLength={100} onChange={(event) => setTeamName(event.target.value)} />
                </label>
                <p className={styles.help}>
                  Vas a ser su responsable sólo en esta inscripción. No te da permisos sobre la organización ni crea un
                  equipo en Arma2.
                </p>
              </>
            )}
          </fieldset>

          <fieldset className={styles.step}>
            <legend><span>4</span> Condiciones</legend>
            <ul className={styles.conditions}>
              <li><strong>Costo:</strong> {entryFeeLabel(entry.entryFee)}{entry.entryFee?.includes ? ` (incluye ${entry.entryFee.includes})` : ''}.</li>
              {entry.entryFee?.paymentNote && <li><strong>Pago:</strong> {entry.entryFee.paymentNote}</li>}
              {entry.entryFee && Number(entry.entryFee.amountCents) > 0 && <li>Arma2 no cobra ni procesa este pago.</li>}
              {entry.requirements && <li><strong>Requisitos:</strong> {entry.requirements}</li>}
              <li>Vas a completar el plantel con las reglas del torneo antes de enviar la solicitud.</li>
              <li>La organización puede aprobarla, pedir cambios o rechazarla. Sólo una inscripción aprobada ocupa un cupo.</li>
            </ul>
            <label className={styles.field}>
              <span>Mensaje para la organización (opcional)</span>
              <textarea rows={3} maxLength={500} value={message} onChange={(event) => setMessage(event.target.value)} />
            </label>
            <label className={styles.checkboxField}>
              <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
              <span>Leí y acepto las condiciones de esta convocatoria.</span>
            </label>
          </fieldset>

          {submit.status === 'error' && <p className={styles.errorText} role="alert"><AlertCircle size={16} aria-hidden="true" /> {submit.error}</p>}
          <div className={styles.formActions}>
            <button type="submit" className={styles.primaryAction} disabled={!ready}>
              {submit.status === 'saving' ? <Loader2 className={styles.spin} size={17} aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}
              Crear solicitud
            </button>
            <span className={styles.help}>
              <UsersRound size={14} aria-hidden="true" /> Después armás el plantel y la enviás.
            </span>
          </div>
          {submit.status === 'saving' && <p className={styles.help} role="status"><CheckCircle2 size={14} /> Creando la solicitud…</p>}
        </form>
      )}
    </div>
  );
}
