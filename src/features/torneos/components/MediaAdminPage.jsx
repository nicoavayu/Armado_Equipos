import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  Camera,
  Check,
  CheckCircle2,
  Eye,
  FileImage,
  Filter,
  ImagePlus,
  Images,
  LockKeyhole,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Star,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { useParams } from 'react-router-dom';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import {
  formatMediaBytes,
  prepareTournamentMediaBatch,
} from '../domain/mediaValidation';
import styles from './MediaAdminPage.module.css';

const STATUS_LABELS = {
  draft: 'Borrador',
  under_review: 'En revisión',
  published: 'Publicada',
  archived: 'Archivada',
  revoked: 'Revocada',
  pending_review: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  hidden: 'Oculta',
  failed: 'Con error',
};
const VISIBILITY_LABELS = {
  organization: 'Organización',
  tournament_participants: 'Participantes del torneo',
  match_participants: 'Participantes del partido',
  related_teams: 'Equipos relacionados',
  administrative_private: 'Sólo administración',
};
const EMPTY_FORM = {
  tournamentId: '',
  categoryId: '',
  matchId: '',
  title: '',
  description: '',
  visibility: 'tournament_participants',
};

function MediaState({
  icon: Icon = Images, title, copy, action = null,
}) {
  return (
    <section className={styles.stateCard}>
      <Icon size={30} />
      <h2>{title}</h2>
      <p>{copy}</p>
      {action}
    </section>
  );
}

function AssetPreview({ asset, cover, canManage, onAction, onMove }) {
  const actionable = ['pending_review', 'approved', 'published', 'hidden'].includes(asset.status);
  return (
    <article className={styles.assetCard} data-status={asset.status}>
      <div className={styles.assetVisual} aria-label={`Vista protegida de ${asset.safeName}`}>
        <Camera size={25} />
        <span>{asset.width} × {asset.height}</span>
        {cover && <b><Star size={13} /> Portada</b>}
      </div>
      <div className={styles.assetInfo}>
        <span><strong>{asset.safeName}</strong><small>{formatMediaBytes(asset.byteSize)}</small></span>
        <em data-status={asset.status}>{STATUS_LABELS[asset.status] || asset.status}</em>
      </div>
      {canManage && actionable && (
        <div className={styles.assetActions}>
          {asset.status === 'pending_review' && (
            <>
              <button type="button" onClick={() => onAction(asset, 'approve')}>
                <Check size={15} /> Aprobar
              </button>
              <button type="button" onClick={() => onAction(asset, 'reject')}>
                <X size={15} /> Rechazar
              </button>
            </>
          )}
          {['approved', 'published'].includes(asset.status) && !cover && (
            <button type="button" onClick={() => onAction(asset, 'cover')}>
              <Star size={15} /> Portada
            </button>
          )}
          {['approved', 'published'].includes(asset.status) && (
            <button type="button" onClick={() => onAction(asset, 'hide')}>
              <Eye size={15} /> Ocultar
            </button>
          )}
          {asset.status === 'hidden' && (
            <button type="button" onClick={() => onAction(asset, 'restore')}>
              <RefreshCw size={15} /> Restaurar
            </button>
          )}
          <button
            type="button"
            aria-label={`Mover ${asset.safeName} hacia arriba`}
            disabled={asset.sortOrder === 0}
            onClick={() => onMove(asset, Math.max(0, asset.sortOrder - 1))}
          >
            <ArrowUp size={15} />
          </button>
          <button
            type="button"
            aria-label={`Mover ${asset.safeName} hacia abajo`}
            onClick={() => onMove(asset, asset.sortOrder + 1)}
          >
            <ArrowDown size={15} />
          </button>
        </div>
      )}
    </article>
  );
}

export default function MediaAdminPage() {
  const { organizationId } = useParams();
  const { service } = useTorneosWorkspace();
  const requestRef = useRef(0);
  const publishLockRef = useRef(false);
  const fileInputRef = useRef(null);
  const queueRef = useRef([]);
  const [state, setState] = useState({ status: 'loading', data: null, error: '' });
  const [filters, setFilters] = useState({ tournamentId: '', status: '' });
  const [composerOpen, setComposerOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [queue, setQueue] = useState([]);
  const [activeGalleryId, setActiveGalleryId] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  queueRef.current = queue;

  const load = async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setState((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const data = await service.loadMediaAdminContext({
        organizationId,
        tournamentId: filters.tournamentId || null,
        status: filters.status || null,
      });
      if (requestRef.current !== requestId) return;
      setState({ status: 'ready', data, error: '' });
      const firstTournament = data.tournaments?.[0]?.id || '';
      setForm((current) => ({
        ...current,
        tournamentId: current.tournamentId || firstTournament,
      }));
      setActiveGalleryId((current) => (
        data.galleries?.some((gallery) => gallery.id === current)
          ? current : data.galleries?.[0]?.id || ''
      ));
    } catch (error) {
      if (requestRef.current !== requestId) return;
      setState({
        status: 'error',
        data: null,
        error: error?.message || 'No pudimos abrir Multimedia.',
      });
    }
  };

  useEffect(() => {
    setQueue((current) => {
      current.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
      return [];
    });
    setComposerOpen(false);
    setForm(EMPTY_FORM);
    setNotice('');
    load();
    return () => {
      requestRef.current += 1;
    };
    // service is stable in the workspace provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, filters.tournamentId, filters.status, service]);

  useEffect(() => () => {
    queueRef.current.forEach(
      (item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl),
    );
  }, []);

  const capabilities = state.data?.capabilities || [];
  const canCreate = capabilities.includes('media.create_gallery');
  const canUpload = capabilities.includes('media.upload');
  const canReview = capabilities.includes('media.review');
  const canPublish = capabilities.includes('media.publish');
  const canHandleReports = capabilities.includes('media.handle_reports');
  const uploadReady = state.data?.storage?.uploadReady === true;
  const selectedTournament = useMemo(() => (
    state.data?.tournaments?.find((item) => item.id === form.tournamentId) || null
  ), [form.tournamentId, state.data]);
  const selectedGallery = state.data?.galleries?.find(
    (gallery) => gallery.id === activeGalleryId,
  ) || null;

  const updateForm = (key, value) => {
    setForm((current) => ({
      ...current,
      [key]: value,
      ...(key === 'tournamentId' ? { categoryId: '', matchId: '' } : {}),
      ...(key === 'categoryId' ? { matchId: '' } : {}),
      ...(key === 'matchId' && value
        ? { visibility: 'match_participants' } : {}),
    }));
  };

  const createGallery = async (event) => {
    event.preventDefault();
    if (busy || !canCreate) return;
    setBusy('create');
    setNotice('');
    try {
      const galleryId = await service.createMediaGallery({
        organizationId,
        ...form,
        roundId: selectedTournament?.matches?.find(
          (match) => match.id === form.matchId,
        )?.roundId || null,
        categoryId: form.categoryId || null,
        matchId: form.matchId || null,
        idempotencyKey: service.createIdempotencyKey(),
      });
      setComposerOpen(false);
      setForm({ ...EMPTY_FORM, tournamentId: form.tournamentId });
      setActiveGalleryId(galleryId);
      setNotice('Galería creada. Ya podés preparar la selección de fotos.');
      await load();
    } catch (error) {
      setState((current) => ({ ...current, error: error?.message || 'No pudimos crear la galería.' }));
    } finally {
      setBusy('');
    }
  };

  const selectFiles = (event) => {
    const prepared = prepareTournamentMediaBatch(event.target.files).map((item) => ({
      ...item,
      idempotencyKey: service.createIdempotencyKey(),
      previewUrl: item.status === 'ready' ? URL.createObjectURL(item.file) : '',
      ...(item.status === 'ready' && !uploadReady ? {
        status: 'staging_required',
        error: 'La carga de fotos todavía no está habilitada en este entorno.',
      } : {}),
    }));
    setQueue((current) => {
      current.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
      return prepared;
    });
    event.target.value = '';
  };

  const prepareUpload = async (item) => {
    if (!selectedGallery || !canUpload || !uploadReady || item.status === 'requesting') return;
    setQueue((current) => current.map((candidate) => (
      candidate.id === item.id
        ? { ...candidate, status: 'requesting', error: '', progress: 0 }
        : candidate
    )));
    try {
      const session = await service.requestMediaUploadSession({
        galleryId: selectedGallery.id,
        fileName: item.file.name,
        mime: item.file.type,
        byteSize: item.file.size,
        idempotencyKey: item.idempotencyKey,
      });
      setQueue((current) => current.map((candidate) => (
        candidate.id === item.id
          ? {
            ...candidate,
            session,
            status: session.uploadReady ? 'ready_to_upload' : 'staging_required',
            error: session.uploadReady
              ? ''
              : 'La carga de fotos todavía no está habilitada en este entorno.',
          }
          : candidate
      )));
    } catch (error) {
      setQueue((current) => current.map((candidate) => (
        candidate.id === item.id
          ? { ...candidate, status: 'error', error: error?.message || 'No pudimos preparar esta foto.' }
          : candidate
      )));
    }
  };

  const removeQueueItem = (item) => {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    setQueue((current) => current.filter((candidate) => candidate.id !== item.id));
  };

  const actOnAsset = async (asset, action) => {
    if (busy) return;
    setBusy(`${action}:${asset.id}`);
    try {
      if (action === 'cover') {
        await service.setMediaCover({ galleryId: selectedGallery.id, assetId: asset.id });
      } else {
        const reasons = {
          reject: 'No cumple los criterios editoriales de la galería.',
          hide: 'Ocultada preventivamente por revisión editorial.',
          restore: null,
        };
        await service.transitionMediaAsset({
          assetId: asset.id,
          action,
          reason: reasons[action] || null,
        });
      }
      await load();
    } catch (error) {
      setState((current) => ({ ...current, error: error?.message || 'No pudimos actualizar la foto.' }));
    } finally {
      setBusy('');
    }
  };

  const moveAsset = async (asset, targetOrder) => {
    if (busy || targetOrder < 0 || targetOrder >= selectedGallery.assets.length) return;
    setBusy(`move:${asset.id}`);
    try {
      await service.reorderMediaItem({
        galleryId: selectedGallery.id,
        assetId: asset.id,
        targetOrder,
      });
      await load();
    } finally {
      setBusy('');
    }
  };

  const publish = async () => {
    if (busy || publishLockRef.current || !canPublish || !selectedGallery) return;
    publishLockRef.current = true;
    setBusy('publish');
    try {
      await service.publishMediaGallery(selectedGallery.id);
      setNotice('Galería publicada para su audiencia autorizada.');
      await load();
    } catch (error) {
      setState((current) => ({ ...current, error: error?.message || 'No pudimos publicar.' }));
    } finally {
      publishLockRef.current = false;
      setBusy('');
    }
  };

  const archive = async () => {
    if (busy || !selectedGallery) return;
    setBusy('archive');
    try {
      await service.changeMediaGalleryState({
        galleryId: selectedGallery.id,
        action: 'archive',
        reason: 'Galería archivada desde el Centro Multimedia.',
      });
      await load();
    } finally {
      setBusy('');
    }
  };

  const handleReport = async (report, status) => {
    if (busy || !canHandleReports) return;
    setBusy(`report:${report.id}`);
    try {
      await service.handleMediaReport({
        reportId: report.id,
        status,
        resolution: status === 'resolved'
          ? 'Revisión completada y medidas de privacidad registradas.'
          : 'El reporte no requiere una medida adicional.',
      });
      await load();
    } finally {
      setBusy('');
    }
  };

  if (state.status === 'loading' && !state.data) {
    return <div className={styles.skeleton}><span /><span /><span /></div>;
  }
  if (state.status === 'error' && !state.data) {
    return (
      <MediaState
        icon={AlertTriangle}
        title="No pudimos abrir Multimedia"
        copy={state.error}
        action={<button type="button" onClick={load}><RefreshCw size={16} /> Reintentar</button>}
      />
    );
  }

  const galleries = state.data?.galleries || [];
  const reports = state.data?.reports || [];
  const pendingCount = galleries.reduce(
    (total, gallery) => total + gallery.assets.filter(
      (asset) => asset.status === 'pending_review',
    ).length,
    0,
  );

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p>Archivo visual · Privado por diseño</p>
          <h1>Centro Multimedia</h1>
          <span>Curá cada jornada, revisá derechos y publicá sólo para relaciones autorizadas.</span>
        </div>
        <div className={styles.heroMetrics}>
          <article><Images size={19} /><span><strong>{galleries.length}</strong><small>galerías</small></span></article>
          <article><ShieldAlert size={19} /><span><strong>{pendingCount}</strong><small>pendientes</small></span></article>
          <article><LockKeyhole size={19} /><span><strong>Privado</strong><small>sin acceso anónimo</small></span></article>
        </div>
      </header>

      <div className={styles.storageGate}>
        <ShieldCheck size={20} />
        <span>
          <strong>Carga protegida</strong>
          <small>
            La carga de fotos todavía no está habilitada en este entorno.
          </small>
        </span>
        <em>Próximamente</em>
      </div>

      {(state.error || notice) && (
        <div className={state.error ? styles.errorBanner : styles.noticeBanner} role="status">
          {state.error ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
          {state.error || notice}
        </div>
      )}

      <section className={styles.toolbar} aria-label="Filtros y acciones">
        <div>
          <Filter size={17} />
          <label>
            <span>Torneo</span>
            <select
              value={filters.tournamentId}
              onChange={(event) => setFilters((current) => ({
                ...current, tournamentId: event.target.value,
              }))}
            >
              <option value="">Todos</option>
              {(state.data?.tournaments || []).map((tournament) => (
                <option key={tournament.id} value={tournament.id}>{tournament.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Estado</span>
            <select
              value={filters.status}
              onChange={(event) => setFilters((current) => ({
                ...current, status: event.target.value,
              }))}
            >
              <option value="">Todos</option>
              {Object.entries(STATUS_LABELS).slice(0, 5).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </div>
        {canCreate && (
          <button type="button" onClick={() => setComposerOpen((current) => !current)}>
            <ImagePlus size={18} /> Crear galería
          </button>
        )}
      </section>

      {composerOpen && (
        <form className={styles.composer} onSubmit={createGallery}>
          <header><span>01</span><div><p>Nueva colección editorial</p><h2>Crear galería</h2></div></header>
          <div className={styles.formGrid}>
            <label>
              <span>Torneo</span>
              <select required value={form.tournamentId} onChange={(event) => updateForm('tournamentId', event.target.value)}>
                <option value="">Elegí un torneo</option>
                {(state.data?.tournaments || []).map((tournament) => (
                  <option key={tournament.id} value={tournament.id}>{tournament.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Categoría</span>
              <select value={form.categoryId} onChange={(event) => updateForm('categoryId', event.target.value)}>
                <option value="">Todo el torneo</option>
                {(selectedTournament?.categories || []).map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Partido</span>
              <select value={form.matchId} onChange={(event) => updateForm('matchId', event.target.value)}>
                <option value="">Sin partido específico</option>
                {(selectedTournament?.matches || []).filter((match) => (
                  !form.categoryId || match.categoryId === form.categoryId
                )).map((match) => (
                  <option key={match.id} value={match.id}>Partido #{match.matchNumber}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Visibilidad</span>
              <select value={form.visibility} onChange={(event) => updateForm('visibility', event.target.value)}>
                {Object.entries(VISIBILITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className={styles.wideField}>
              <span>Título</span>
              <input required minLength={3} maxLength={120} value={form.title} onChange={(event) => updateForm('title', event.target.value)} placeholder="La noche de la fecha 6" />
            </label>
            <label className={styles.wideField}>
              <span>Descripción</span>
              <textarea maxLength={1200} value={form.description} onChange={(event) => updateForm('description', event.target.value)} placeholder="Una mirada editorial de la jornada…" />
            </label>
          </div>
          <footer>
            <button type="button" onClick={() => setComposerOpen(false)}>Cancelar</button>
            <button type="submit" disabled={busy === 'create'}><Check size={17} /> Crear borrador</button>
          </footer>
        </form>
      )}

      {!canCreate && (
        <div className={styles.readOnlyBanner}>
          <Eye size={18} />
          <span><strong>Modo lectura</strong><small>Tu rol puede consultar Multimedia, sin cargar ni publicar.</small></span>
        </div>
      )}

      {galleries.length ? (
        <div className={styles.workspace}>
          <aside className={styles.galleryRail} aria-label="Galerías">
            {galleries.map((gallery) => (
              <button
                key={gallery.id}
                type="button"
                aria-pressed={activeGalleryId === gallery.id}
                onClick={() => {
                  setActiveGalleryId(gallery.id);
                  setQueue([]);
                }}
              >
                <span>{gallery.matchId ? 'PARTIDO' : gallery.categoryId ? 'CATEGORÍA' : 'TORNEO'}</span>
                <strong>{gallery.title}</strong>
                <small>{gallery.assets.length} fotos · {STATUS_LABELS[gallery.status]}</small>
              </button>
            ))}
          </aside>

          {selectedGallery && (
            <section className={styles.galleryDesk}>
              <header>
                <div>
                  <p>{VISIBILITY_LABELS[selectedGallery.visibility]}</p>
                  <h2>{selectedGallery.title}</h2>
                  <span>{selectedGallery.description || 'Sin descripción editorial.'}</span>
                </div>
                <em data-status={selectedGallery.status}>{STATUS_LABELS[selectedGallery.status]}</em>
              </header>

              {canUpload && ['draft', 'under_review'].includes(selectedGallery.status) && (
                <section className={styles.uploadPanel}>
                  <div>
                    <UploadCloud size={24} />
                    <span>
                      <strong>{uploadReady ? 'Preparar fotos' : 'Revisar fotos'}</strong>
                      <small>JPEG, PNG o WebP · hasta 12 MB · máximo 40 por tanda</small>
                    </span>
                  </div>
                  <input
                    ref={fileInputRef}
                    className={styles.srOnly}
                    type="file"
                    aria-label="Seleccionar fotos"
                    accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                    multiple
                    onChange={selectFiles}
                  />
                  <button type="button" onClick={() => fileInputRef.current?.click()}>
                    <FileImage size={17} /> Seleccionar archivos
                  </button>
                  {queue.length > 0 && (
                    <div className={styles.queue} aria-live="polite">
                      {queue.map((item) => (
                        <article key={item.id} data-status={item.status}>
                          <div className={styles.queueThumb}>
                            {item.previewUrl
                              ? <img src={item.previewUrl} alt="" />
                              : <FileImage size={20} />}
                          </div>
                          <span>
                            <strong>{item.safeName}</strong>
                            <small>{formatMediaBytes(item.file.size)} · {item.file.type || 'Formato desconocido'}</small>
                            {item.error && <em>{item.error}</em>}
                          </span>
                          {['ready', 'error'].includes(item.status) && (
                            <button type="button" onClick={() => prepareUpload(item)}>
                              {item.status === 'error' ? <RefreshCw size={15} /> : <Send size={15} />}
                              {item.status === 'error' ? 'Reintentar' : 'Preparar'}
                            </button>
                          )}
                          <button type="button" aria-label={`Quitar ${item.safeName}`} onClick={() => removeQueueItem(item)}>
                            <Trash2 size={16} />
                          </button>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {selectedGallery.assets.length ? (
                <div className={styles.assetGrid}>
                  {selectedGallery.assets.map((asset) => (
                    <AssetPreview
                      key={asset.id}
                      asset={asset}
                      cover={selectedGallery.coverAssetId === asset.id}
                      canManage={canReview}
                      onAction={actOnAsset}
                      onMove={moveAsset}
                    />
                  ))}
                </div>
              ) : (
                <MediaState title="Todavía no hay fotos" copy="Elegí archivos para validar la tanda. Ningún archivo inválido cancela los demás." />
              )}

              <footer className={styles.galleryActions}>
                {canPublish && ['draft', 'under_review'].includes(selectedGallery.status) && (
                  <button type="button" disabled={busy === 'publish'} onClick={publish}>
                    <Send size={17} /> Publicar galería
                  </button>
                )}
                {capabilities.includes('media.archive') && selectedGallery.status === 'published' && (
                  <button type="button" onClick={archive}><Archive size={17} /> Archivar</button>
                )}
              </footer>
            </section>
          )}
        </div>
      ) : (
        <MediaState
          icon={ImagePlus}
          title="El archivo visual empieza acá"
          copy={canCreate
            ? 'Creá una galería para un torneo, jornada o partido y prepará la primera selección.'
            : 'Todavía no hay galerías disponibles para consultar.'}
        />
      )}

      {reports.length > 0 && (
        <section className={styles.reports}>
          <header><ShieldAlert size={20} /><div><p>Privacidad</p><h2>Reportes para revisar</h2></div></header>
          <div>
            {reports.map((report) => (
              <article key={report.id}>
                <span><strong>{report.reason.replaceAll('_', ' ')}</strong><small>{report.detail || 'Sin detalle adicional'}</small></span>
                {report.requestHide && <em>Solicita ocultamiento</em>}
                {canHandleReports && (
                  <div>
                    <button type="button" onClick={() => handleReport(report, 'resolved')}><Check size={15} /> Resolver</button>
                    <button type="button" onClick={() => handleReport(report, 'dismissed')}><X size={15} /> Descartar</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
