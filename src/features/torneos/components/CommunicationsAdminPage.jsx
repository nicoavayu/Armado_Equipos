import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BellRing,
  BookOpen,
  Check,
  Eye,
  FilePlus2,
  Megaphone,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import { useParams } from 'react-router-dom';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import styles from './CommunicationsAdminPage.module.css';

const STEPS = ['Tipo', 'Contenido', 'Audiencia', 'Contexto', 'Vista previa', 'Confirmar'];
const EMPTY_FORM = {
  tournamentId: '',
  categoryId: '',
  type: 'general',
  title: '',
  summary: '',
  body: '',
  priority: 'normal',
  acknowledgementMode: 'none',
  audienceType: 'tournament',
  teamEntryId: '',
  matchId: '',
};

function formatDate(value) {
  return value ? new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value)) : 'Sin fecha';
}

export default function CommunicationsAdminPage() {
  const { organizationId } = useParams();
  const { service } = useTorneosWorkspace();
  const requestRef = useRef(0);
  const publishLockRef = useRef(false);
  const [section, setSection] = useState('announcements');
  const [step, setStep] = useState(1);
  const [state, setState] = useState({
    status: 'loading',
    data: null,
    error: '',
  });
  const [form, setForm] = useState(EMPTY_FORM);
  const [draftId, setDraftId] = useState('');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [documentForm, setDocumentForm] = useState({
    tournamentId: '',
    categoryId: '',
    type: 'regulation',
    title: '',
    summary: '',
    body: '',
    acknowledgementMode: 'read',
  });

  const load = async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setState({ status: 'loading', data: null, error: '' });
    try {
      const data = await service.loadCommunicationsAdminContext({ organizationId });
      if (requestRef.current !== requestId) return;
      setState({ status: 'ready', data, error: '' });
      const firstTournament = data.tournaments?.[0]?.id || '';
      setForm((current) => ({
        ...current,
        tournamentId: current.tournamentId || firstTournament,
      }));
      setDocumentForm((current) => ({
        ...current,
        tournamentId: current.tournamentId || firstTournament,
      }));
    } catch (error) {
      if (requestRef.current !== requestId) return;
      setState({
        status: 'error',
        data: null,
        error: error?.message || 'No pudimos abrir comunicaciones.',
      });
    }
  };

  useEffect(() => {
    load();
    return () => {
      requestRef.current += 1;
    };
    // service is stable in the workspace provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, service]);

  const tournament = useMemo(() => (
    state.data?.tournaments?.find((item) => item.id === form.tournamentId) || null
  ), [form.tournamentId, state.data]);
  const canPublish = state.data?.capabilities?.includes('announcements.publish');
  const canPublishDocuments = state.data?.capabilities?.includes('documents.publish');

  const updateForm = (key, value) => {
    setForm((current) => ({
      ...current,
      [key]: value,
      ...(key === 'tournamentId'
        ? { categoryId: '', teamEntryId: '', matchId: '' } : {}),
    }));
    setPreview(null);
    setResult(null);
  };

  const preparePreview = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const announcementId = draftId || await service.createAnnouncementDraft({
        organizationId,
        tournamentId: form.tournamentId,
        categoryId: form.categoryId || null,
        type: form.type,
        title: form.title,
        summary: form.summary,
        body: form.body,
        priority: form.priority,
        acknowledgementMode: form.acknowledgementMode,
        idempotencyKey: service.createIdempotencyKey(),
      });
      setDraftId(announcementId);
      await service.setAnnouncementAudience({
        announcementId,
        type: form.audienceType,
        categoryId: form.audienceType === 'category' ? form.categoryId || null : null,
        teamEntryId: form.audienceType === 'team' ? form.teamEntryId || null : null,
        matchId: ['match', 'home_team', 'away_team'].includes(form.audienceType)
          ? form.matchId || null : null,
      });
      const audiencePreview = await service.previewAnnouncementAudience(announcementId);
      setPreview(audiencePreview);
      setStep(5);
    } catch (error) {
      setState((current) => ({ ...current, error: error?.message || 'No pudimos preparar la vista previa.' }));
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (busy || publishLockRef.current || !draftId || !canPublish) return;
    publishLockRef.current = true;
    setBusy(true);
    try {
      const publication = await service.publishAnnouncement({
        announcementId: draftId,
        expectedRecipientCount: preview?.estimatedRecipients ?? null,
      });
      setResult(publication);
      await load();
    } catch (error) {
      setState((current) => ({ ...current, error: error?.message || 'No pudimos publicar.' }));
    } finally {
      publishLockRef.current = false;
      setBusy(false);
    }
  };

  const resetComposer = () => {
    const firstTournament = state.data?.tournaments?.[0]?.id || '';
    setForm({ ...EMPTY_FORM, tournamentId: firstTournament });
    setDraftId('');
    setPreview(null);
    setResult(null);
    setStep(1);
  };

  const publishDocument = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const document = await service.createDocument({
        organizationId,
        tournamentId: documentForm.tournamentId,
        categoryId: documentForm.categoryId || null,
        type: documentForm.type,
        title: documentForm.title,
        summary: documentForm.summary,
        body: documentForm.body,
        acknowledgementMode: documentForm.acknowledgementMode,
        idempotencyKey: service.createIdempotencyKey(),
      });
      if (canPublishDocuments) {
        await service.publishDocumentVersion(document.versionId);
      }
      setResult({
        documentId: document.documentId,
        status: canPublishDocuments ? 'published' : 'draft',
      });
      await load();
    } catch (error) {
      setState((current) => ({ ...current, error: error?.message || 'No pudimos crear el documento.' }));
    } finally {
      setBusy(false);
    }
  };

  if (state.status === 'loading') {
    return <div className={styles.skeleton}><span /><span /><span /></div>;
  }
  if (state.status === 'error' && !state.data) {
    return (
      <section className={styles.stateCard}>
        <AlertTriangle size={26} />
        <h1>No pudimos abrir comunicaciones</h1>
        <p>{state.error}</p>
        <button type="button" onClick={load}><RefreshCw size={17} /> Reintentar</button>
      </section>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p>Canal institucional · Sólo interno</p>
          <h1>Comunicaciones</h1>
          <span>
            Publicá información oficial con audiencia revalidada y entregas auditables.
          </span>
        </div>
        <div className={styles.channelCard}>
          <Radio size={20} />
          <strong>Canal activo</strong>
          <span>Inbox interno</span>
          <small>Push y email desactivados</small>
        </div>
      </header>

      {state.error && (
        <div className={styles.errorBanner} role="alert">
          <AlertTriangle size={17} /> {state.error}
        </div>
      )}

      <div className={styles.mainTabs} role="tablist" aria-label="Comunicaciones">
        <button
          type="button"
          role="tab"
          aria-selected={section === 'announcements'}
          onClick={() => setSection('announcements')}
        >
          <Megaphone size={18} /> Comunicados
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === 'documents'}
          onClick={() => setSection('documents')}
        >
          <BookOpen size={18} /> Documentos
        </button>
      </div>

      {section === 'announcements' && (
        <div className={styles.workspace}>
          <section className={styles.composer}>
            <div className={styles.steps} aria-label={`Paso ${step} de ${STEPS.length}`}>
              {STEPS.map((label, index) => (
                <span
                  key={label}
                  data-active={step === index + 1}
                  data-complete={step > index + 1}
                >
                  <b>{index + 1}</b> {label}
                </span>
              ))}
            </div>

            {result?.announcementId ? (
              <div className={styles.successState} role="status">
                <ShieldCheck size={31} />
                <h2>Comunicado publicado</h2>
                <p>
                  Se crearon {result.recipientCount} entregas internas de forma atómica.
                  {result.audienceChanged ? ' La audiencia cambió desde la vista previa.' : ''}
                </p>
                <button type="button" onClick={resetComposer}>Crear otro comunicado</button>
              </div>
            ) : (
              <>
                {step === 1 && (
                  <fieldset>
                    <legend>¿Qué necesitás comunicar?</legend>
                    <div className={styles.choiceGrid}>
                      {[
                        ['general', 'Información general'],
                        ['registration', 'Inscripciones'],
                        ['schedule_change', 'Cambio de fecha'],
                        ['match_update', 'Actualización de partido'],
                        ['discipline', 'Disciplina'],
                        ['regulation', 'Reglamento'],
                        ['administrative', 'Administrativo'],
                        ['emergency', 'Emergencia'],
                      ].map(([value, label]) => (
                        <label key={value} data-selected={form.type === value}>
                          <input
                            type="radio"
                            name="announcement-type"
                            value={value}
                            checked={form.type === value}
                            onChange={() => updateForm('type', value)}
                          />
                          <BellRing size={18} />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}

                {step === 2 && (
                  <fieldset>
                    <legend>Contenido</legend>
                    <label className={styles.field}>
                      <span>Título <small>{form.title.length}/120</small></span>
                      <input
                        value={form.title}
                        maxLength={120}
                        onChange={(event) => updateForm('title', event.target.value)}
                        placeholder="Ej. Cambio de sede confirmado"
                      />
                    </label>
                    <label className={styles.field}>
                      <span>Resumen <small>{form.summary.length}/280</small></span>
                      <textarea
                        value={form.summary}
                        maxLength={280}
                        rows={3}
                        onChange={(event) => updateForm('summary', event.target.value)}
                        placeholder="La información esencial en una frase."
                      />
                    </label>
                    <label className={styles.field}>
                      <span>Contenido <small>{form.body.length}/12000</small></span>
                      <textarea
                        value={form.body}
                        maxLength={12000}
                        rows={8}
                        onChange={(event) => updateForm('body', event.target.value)}
                        placeholder="Texto plano. No se admite HTML."
                      />
                    </label>
                  </fieldset>
                )}

                {step === 3 && (
                  <fieldset>
                    <legend>Audiencia</legend>
                    <label className={styles.field}>
                      <span>Torneo</span>
                      <select
                        value={form.tournamentId}
                        onChange={(event) => updateForm('tournamentId', event.target.value)}
                      >
                        {state.data.tournaments.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} · {item.seasonName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span>Criterio</span>
                      <select
                        value={form.audienceType}
                        onChange={(event) => updateForm('audienceType', event.target.value)}
                      >
                        <option value="tournament">Todos los participantes</option>
                        <option value="category">Una categoría</option>
                        <option value="team">Un equipo</option>
                        <option value="captains">Capitanes y delegados</option>
                        <option value="players">Jugadores</option>
                        <option value="match">Participantes de un partido</option>
                        <option value="home_team">Equipo local</option>
                        <option value="away_team">Equipo visitante</option>
                      </select>
                    </label>
                    {form.audienceType === 'category' && (
                      <label className={styles.field}>
                        <span>Categoría</span>
                        <select
                          value={form.categoryId}
                          onChange={(event) => updateForm('categoryId', event.target.value)}
                        >
                          <option value="">Seleccionar</option>
                          {tournament?.categories?.map((category) => (
                            <option value={category.id} key={category.id}>{category.name}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    {form.audienceType === 'team' && (
                      <label className={styles.field}>
                        <span>Equipo</span>
                        <select
                          value={form.teamEntryId}
                          onChange={(event) => updateForm('teamEntryId', event.target.value)}
                        >
                          <option value="">Seleccionar</option>
                          {tournament?.teams?.map((team) => (
                            <option value={team.id} key={team.id}>{team.name}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    {['match', 'home_team', 'away_team'].includes(form.audienceType) && (
                      <label className={styles.field}>
                        <span>Partido</span>
                        <select
                          value={form.matchId}
                          onChange={(event) => updateForm('matchId', event.target.value)}
                        >
                          <option value="">Seleccionar</option>
                          {tournament?.matches?.map((match) => (
                            <option value={match.id} key={match.id}>
                              Partido {match.matchNumber} · {formatDate(match.scheduledAt)}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <div className={styles.audiencePromise}>
                      <UsersRound size={19} />
                      El servidor resolverá y deduplicará usuarios activos al publicar.
                    </div>
                  </fieldset>
                )}

                {step === 4 && (
                  <fieldset>
                    <legend>Contexto y prioridad</legend>
                    <label className={styles.field}>
                      <span>Categoría del comunicado (opcional)</span>
                      <select
                        value={form.categoryId}
                        onChange={(event) => updateForm('categoryId', event.target.value)}
                      >
                        <option value="">Todo el torneo</option>
                        {tournament?.categories?.map((category) => (
                          <option value={category.id} key={category.id}>{category.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span>Prioridad</span>
                      <select
                        value={form.priority}
                        onChange={(event) => updateForm('priority', event.target.value)}
                      >
                        <option value="normal">Información</option>
                        <option value="important">Importante</option>
                        <option value="urgent">Urgente</option>
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span>Registro de lectura</span>
                      <select
                        value={form.acknowledgementMode}
                        onChange={(event) => updateForm('acknowledgementMode', event.target.value)}
                      >
                        <option value="none">Sin confirmación</option>
                        <option value="read">Marcar como leído</option>
                        <option value="explicit">Confirmo que lo leí</option>
                      </select>
                    </label>
                    <div className={styles.disabledSchedule}>
                      <Radio size={18} />
                      Publicación programada modelada, pero sin automatización habilitada.
                    </div>
                  </fieldset>
                )}

                {step === 5 && preview && (
                  <div className={styles.preview}>
                    <div className={styles.phonePreview}>
                      <small>Así se verá en móvil</small>
                      <span data-priority={form.priority}>{form.priority}</span>
                      <h3>{form.title}</h3>
                      <p>{form.summary}</p>
                      <button type="button">Ver comunicado</button>
                    </div>
                    <div className={styles.previewFacts}>
                      <p className={styles.kicker}>Audiencia revalidada</p>
                      <h2>{preview.estimatedRecipients} destinatarios</h2>
                      <dl>
                        <div><dt>Canal</dt><dd>Sólo inbox interno</dd></div>
                        <div><dt>Torneo</dt><dd>{tournament?.name}</dd></div>
                        <div><dt>Criterio</dt><dd>{form.audienceType}</dd></div>
                        <div><dt>Roles</dt><dd>{preview.roles.join(', ')}</dd></div>
                      </dl>
                      <p>La cantidad se volverá a calcular al publicar.</p>
                    </div>
                  </div>
                )}

                {step === 6 && (
                  <div className={styles.confirmation}>
                    <ShieldCheck size={29} />
                    <h2>Confirmar publicación</h2>
                    <p>
                      Se crearán entregas internas para la audiencia definitiva.
                      La operación es atómica y el contenido publicado será inmutable.
                    </p>
                    {!canPublish && (
                      <div className={styles.errorBanner}>
                        Tu perfil puede preparar borradores, pero no publicar.
                      </div>
                    )}
                    <button type="button" disabled={busy || !canPublish} onClick={publish}>
                      <Send size={18} /> {busy ? 'Publicando…' : 'Publicar comunicado'}
                    </button>
                  </div>
                )}

                <footer className={styles.composerFooter}>
                  <button
                    type="button"
                    disabled={step === 1 || busy}
                    onClick={() => setStep((current) => current - 1)}
                  >
                    <ArrowLeft size={17} /> Anterior
                  </button>
                  {step < 4 && (
                    <button
                      type="button"
                      onClick={() => setStep((current) => current + 1)}
                    >
                      Siguiente <ArrowRight size={17} />
                    </button>
                  )}
                  {step === 4 && (
                    <button type="button" disabled={busy} onClick={preparePreview}>
                      <Eye size={17} /> {busy ? 'Preparando…' : 'Preparar vista previa'}
                    </button>
                  )}
                  {step === 5 && (
                    <button type="button" onClick={() => setStep(6)}>
                      Revisar publicación <ArrowRight size={17} />
                    </button>
                  )}
                </footer>
              </>
            )}
          </section>

          <aside className={styles.history}>
            <p className={styles.kicker}>Actividad reciente</p>
            <h2>Comunicados</h2>
            <div>
              {state.data.announcements.slice(0, 12).map((announcement) => (
                <article key={announcement.id}>
                  <span data-status={announcement.status}>{announcement.status}</span>
                  <strong>{announcement.title}</strong>
                  <small>
                    {announcement.recipientCount ?? '—'} entregas ·
                    {' '}{formatDate(announcement.publishedAt || announcement.scheduledFor)}
                  </small>
                </article>
              ))}
              {!state.data.announcements.length && <p>Todavía no hay comunicados.</p>}
            </div>
          </aside>
        </div>
      )}

      {section === 'documents' && (
        <div className={styles.workspace}>
          <form className={styles.composer} onSubmit={publishDocument}>
            <div className={styles.formHeading}>
              <FilePlus2 size={24} />
              <div>
                <p className={styles.kicker}>Documento estructurado</p>
                <h2>Nueva versión oficial</h2>
              </div>
            </div>
            <label className={styles.field}>
              <span>Torneo</span>
              <select
                value={documentForm.tournamentId}
                onChange={(event) => setDocumentForm((current) => ({
                  ...current,
                  tournamentId: event.target.value,
                  categoryId: '',
                }))}
              >
                {state.data.tournaments.map((item) => (
                  <option value={item.id} key={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Tipo</span>
              <select
                value={documentForm.type}
                onChange={(event) => setDocumentForm((current) => ({
                  ...current,
                  type: event.target.value,
                }))}
              >
                <option value="regulation">Reglamento</option>
                <option value="discipline">Disciplina</option>
                <option value="terms">Bases</option>
                <option value="requirements">Requisitos</option>
                <option value="policy">Política</option>
                <option value="other">Otro</option>
              </select>
            </label>
            {[
              ['title', 'Título', 120],
              ['summary', 'Resumen', 280],
            ].map(([key, label, maxLength]) => (
              <label className={styles.field} key={key}>
                <span>{label}</span>
                <input
                  value={documentForm[key]}
                  maxLength={maxLength}
                  onChange={(event) => setDocumentForm((current) => ({
                    ...current,
                    [key]: event.target.value,
                  }))}
                />
              </label>
            ))}
            <label className={styles.field}>
              <span>Contenido</span>
              <textarea
                rows={12}
                maxLength={20000}
                value={documentForm.body}
                onChange={(event) => setDocumentForm((current) => ({
                  ...current,
                  body: event.target.value,
                }))}
              />
            </label>
            <label className={styles.field}>
              <span>Lectura</span>
              <select
                value={documentForm.acknowledgementMode}
                onChange={(event) => setDocumentForm((current) => ({
                  ...current,
                  acknowledgementMode: event.target.value,
                }))}
              >
                <option value="none">Sin registro</option>
                <option value="read">Marcar como leído</option>
                <option value="explicit">Confirmo que lo leí</option>
              </select>
            </label>
            <button className={styles.primaryAction} disabled={busy} type="submit">
              <Check size={18} />
              {busy ? 'Guardando…' : canPublishDocuments
                ? 'Crear y publicar versión' : 'Guardar borrador'}
            </button>
          </form>
          <aside className={styles.history}>
            <p className={styles.kicker}>Referencia oficial</p>
            <h2>Documentos</h2>
            <div>
              {state.data.documents.map((document) => (
                <article key={document.id}>
                  <span data-status={document.status}>{document.status}</span>
                  <strong>{document.title}</strong>
                  <small>{document.type}</small>
                </article>
              ))}
              {!state.data.documents.length && <p>Todavía no hay documentos.</p>}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
