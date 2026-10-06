import React, {
  useCallback,
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
  RefreshCw,
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

// A team's request or entry in the chosen category blocks a new one (same rule as the backend's duplicate check).
function registrationIn(team, categorySlug) {
  return (team?.registrations || []).find((item) => item.categorySlug === categorySlug) || null;
}

function TeamCrest({ name, crestUrl }) {
  const [failed, setFailed] = useState(false);
  const initials = String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return (
    <span className={styles.teamCrest} aria-hidden="true">
      {crestUrl && !failed && /^https:\/\//.test(crestUrl)
        ? <img src={crestUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
        : <span>{initials}</span>}
    </span>
  );
}

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
  const [teams, setTeams] = useState({ status: 'idle', items: [], hasMore: false, error: '' });
  const listSupported = typeof service?.listMyCoreTeamsForApplication === 'function';
  const fieldRefs = useRef({});
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
  const callOpen = entryState.status === 'ready' && entry?.state === 'open';

  // Your own Arma2 teams, without typing: Core says which ones you can register and which ones you only belong to.
  const loadTeams = useCallback(async () => {
    if (!listSupported) return;
    setTeams((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const payload = await service.listMyCoreTeamsForApplication({ publicSlug });
      setTeams({ status: 'ready', items: payload?.items || [], hasMore: Boolean(payload?.hasMore), error: '' });
    } catch (error) {
      // A failure is never shown as «no teams».
      setTeams({ status: 'error', items: [], hasMore: false, error: errorCopy(error, 'No pudimos cargar tus equipos de Arma2.') });
    }
  }, [listSupported, publicSlug, service]);

  useEffect(() => {
    if (callOpen && teamMode === 'core' && teams.status === 'idle') loadTeams();
  }, [callOpen, loadTeams, teamMode, teams.status]);
  useEffect(() => {
    if (categorySlug || !categories.length) return;
    const firstOpen = categories.find((category) => category.accepting);
    if (firstOpen) setCategorySlug(firstOpen.slug);
  }, [categories, categorySlug]);

  const searchAvailable = !listSupported || teams.hasMore;
  useEffect(() => {
    if (teamMode !== 'core' || !searchAvailable) return undefined;
    const trimmed = query.trim();
    if (!listSupported) setCoreTeamId('');
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
  }, [listSupported, publicSlug, query, searchAvailable, service, teamMode]);

  const openExisting = existing.filter((item) => OPEN_REGISTRATION_STATUSES.includes(item.status) || item.status === 'approved');
  const nameValid = displayName.trim().length >= 2 && displayName.trim().length <= 60;
  const selectableTeams = (query.trim().length >= 2 && searchAvailable && search.items.length ? search.items : teams.items);
  const selectedTeam = selectableTeams.find((team) => team.id === coreTeamId)
    || teams.items.find((team) => team.id === coreTeamId) || null;
  const selectedTeamTaken = Boolean(selectedTeam && registrationIn(selectedTeam, categorySlug));
  const teamValid = teamMode === 'core'
    ? Boolean(coreTeamId) && !selectedTeamTaken
    : teamName.trim().length >= 2;
  const ready = supported && entry?.state === 'open' && nameValid && Boolean(categorySlug) && teamValid && accepted
    && submit.status !== 'saving';
  // What is still missing, said next to the action and linked to each field: the button never stays disabled silently.
  const missing = [
    !nameValid && { key: 'name', label: 'Tu nombre de presentación (2 a 60 letras)' },
    !categorySlug && { key: 'category', label: 'Elegir una categoría con lugar' },
    !teamValid && {
      key: 'team',
      label: teamMode === 'core'
        ? (selectedTeamTaken ? 'Elegir otro equipo: el elegido ya está en esa categoría' : 'Elegir uno de tus equipos')
        : 'El nombre del equipo nuevo',
    },
    !accepted && { key: 'conditions', label: 'Aceptar las condiciones' },
  ].filter(Boolean);
  const focusField = (key) => {
    const target = fieldRefs.current[key];
    if (target) {
      target.scrollIntoView?.({ block: 'center' });
      target.focus?.();
    }
  };

  // Changing category clears a team that already has a request there.
  useEffect(() => {
    if (selectedTeamTaken) setCoreTeamId('');
  }, [selectedTeamTaken]);

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
                ref={(node) => { fieldRefs.current.name = node; }}
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
                    ref={(node) => { if (node && category.accepting && !fieldRefs.current.category) fieldRefs.current.category = node; }}
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
                Mis equipos de Arma2
              </button>
              <button type="button" role="radio" aria-checked={teamMode === 'new'} onClick={() => setTeamMode('new')}>
                Un equipo nuevo para este torneo
              </button>
            </div>
            {teamMode === 'core' ? (
              <div ref={(node) => { fieldRefs.current.team = node; }} tabIndex={-1} className={styles.teamPicker}>
                {listSupported && teams.status === 'loading' && (
                  <p className={styles.help} role="status"><Loader2 className={styles.spin} size={14} aria-hidden="true" /> Cargando tus equipos…</p>
                )}
                {listSupported && teams.status === 'error' && (
                  <div className={styles.infoCard} role="alert">
                    <p>{teams.error}</p>
                    <button type="button" className={styles.secondaryAction} onClick={loadTeams}>
                      <RefreshCw size={15} aria-hidden="true" /> Reintentar
                    </button>
                  </div>
                )}
                {listSupported && teams.status === 'ready' && teams.items.length === 0 && (
                  <div className={styles.infoCard}>
                    <p>No tenés equipos en Arma2. Podés inscribir un equipo nuevo para este torneo.</p>
                    <button type="button" className={styles.secondaryAction} onClick={() => setTeamMode('new')}>Inscribir un equipo nuevo</button>
                  </div>
                )}
                {teams.items.some((team) => team.canRegister) && (
                  <div className={styles.choiceList}>
                    {teams.items.filter((team) => team.canRegister).map((team) => {
                      const taken = registrationIn(team, categorySlug);
                      const elsewhere = (team.registrations || []).filter((item) => item.categorySlug !== categorySlug);
                      return (
                        <label key={team.id} className={styles.choice} data-disabled={Boolean(taken)}>
                          <input
                            type="radio"
                            name="core-team"
                            value={team.id}
                            checked={coreTeamId === team.id}
                            disabled={Boolean(taken)}
                            onChange={() => setCoreTeamId(team.id)}
                          />
                          <TeamCrest name={team.name} crestUrl={team.crestUrl} />
                          <span>
                            <strong>{team.name}</strong>
                            {taken
                              ? <small className={styles.warningText}>Ya está en {taken.categoryName}: {registrationStage(taken.status).label.toLowerCase()}</small>
                              : <small>Podés inscribirlo: lo administrás en Arma2</small>}
                            {!taken && elsewhere.length > 0 && (
                              <small>También está en {elsewhere.map((item) => item.categoryName).join(', ')}</small>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
                {teams.items.some((team) => !team.canRegister) && (
                  <div className={styles.memberTeams}>
                    <h3>Equipos que integrás</h3>
                    <p className={styles.help}>
                      La inscripción la hace su responsable en Arma2. Compartile la convocatoria para que la pida.
                    </p>
                    <ul>
                      {teams.items.filter((team) => !team.canRegister).map((team) => (
                        <li key={team.id}>
                          <TeamCrest name={team.name} crestUrl={team.crestUrl} />
                          <span><strong>{team.name}</strong><small>Sos integrante: no podés inscribirlo</small></span>
                        </li>
                      ))}
                    </ul>
                    <ShareCallButton publicSlug={publicSlug} tournamentName={entry.tournamentName} />
                  </div>
                )}
                {searchAvailable && (
                  <>
                    {listSupported && <p className={styles.help}>¿No está tu equipo? Buscalo por nombre.</p>}
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
                    {search.status === 'loading' && <p className={styles.help} role="status"><Loader2 className={styles.spin} size={14} /> Buscando…</p>}
                    {search.status === 'error' && <p className={styles.errorText} role="alert">{search.error}</p>}
                    {search.status === 'ready' && search.items.length === 0 && (
                      <p className={styles.help}>No encontramos equipos que administres con ese nombre.</p>
                    )}
                    {search.items.length > 0 && (
                      <div className={styles.choiceList}>
                        {search.items.map((team) => {
                          const taken = registrationIn(team, categorySlug);
                          return (
                            <label key={team.id} className={styles.choice} data-disabled={Boolean(taken)}>
                              <input
                                type="radio"
                                name="core-team"
                                value={team.id}
                                checked={coreTeamId === team.id}
                                disabled={Boolean(taken)}
                                onChange={() => setCoreTeamId(team.id)}
                              />
                              <TeamCrest name={team.name} crestUrl={team.crestUrl} />
                              <span>
                                <strong>{team.name}</strong>
                                {taken
                                  ? <small className={styles.warningText}>Ya está en {taken.categoryName}: {registrationStage(taken.status).label.toLowerCase()}</small>
                                  : <small>Podés inscribirlo: lo administrás en Arma2</small>}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
                <p className={styles.help}>
                  Inscribirlo no cambia sus miembros ni sus partidos en Arma2, y nadie entra al plantel automáticamente.
                </p>
              </div>
            ) : (
              <>
                <label className={styles.field}>
                  <span>Nombre del equipo</span>
                  <input
                    ref={(node) => { fieldRefs.current.team = node; }}
                    value={teamName}
                    maxLength={100}
                    onChange={(event) => setTeamName(event.target.value)}
                  />
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
              <li>
                <strong>Costo:</strong>{' '}
                {entryFeeLabel(entry.entryFee) || 'la organización no publicó un precio; consultalo antes de enviar'}
                {entry.entryFee?.includes ? ` (incluye ${entry.entryFee.includes})` : ''}.
              </li>
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
              <input
                ref={(node) => { fieldRefs.current.conditions = node; }}
                type="checkbox"
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
              />
              <span>Leí y acepto las condiciones de esta convocatoria.</span>
            </label>
          </fieldset>

          {submit.status === 'error' && <p className={styles.errorText} role="alert"><AlertCircle size={16} aria-hidden="true" /> {submit.error}</p>}
          <div className={styles.formActions}>
            <button
              type="submit"
              className={styles.primaryAction}
              disabled={!ready}
              aria-describedby={missing.length ? 'application-missing' : undefined}
            >
              {submit.status === 'saving' ? <Loader2 className={styles.spin} size={17} aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}
              Crear solicitud
            </button>
            <span className={styles.help}>
              <UsersRound size={14} aria-hidden="true" /> Después armás el plantel y la enviás.
            </span>
          </div>
          {missing.length > 0 && submit.status !== 'saving' && (
            <div id="application-missing" className={styles.missingList}>
              <p>Para crear la solicitud falta:</p>
              <ul>
                {missing.map((item) => (
                  <li key={item.key}>
                    <button type="button" className={styles.textAction} onClick={() => focusField(item.key)}>{item.label}</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {submit.status === 'saving' && <p className={styles.help} role="status"><CheckCircle2 size={14} /> Creando la solicitud…</p>}
        </form>
      )}
    </div>
  );
}
