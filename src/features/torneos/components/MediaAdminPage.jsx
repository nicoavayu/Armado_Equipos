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
  MEDIA_ASSET_STATE_LABELS,
  MEDIA_LIMITS,
  formatMediaBytes,
  localDisplayName,
  resolveUploadCapability,
} from '../domain/mediaPipeline';
import { createPreviewUrl, validateSelection } from '../domain/mediaImageClient';
import MediaUploadQueue from './MediaUploadQueue';
import styles from './MediaAdminPage.module.css';

const STATUS_LABELS = {
  draft: 'Borrador',
  under_review: 'En revisión',
  published: 'Publicada',
  archived: 'Archivada',
  revoked: 'Revocada',
  ...MEDIA_ASSET_STATE_LABELS,
  pending_review: 'Pendiente',
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

function AssetPreview({ asset, cover, canManage, onAction, onMove, thumbnailUrl }) {
  const actionable = ['pending_review', 'approved', 'published', 'hidden'].includes(asset.status);
  // Four ready variants is the same gate the database enforces on approval, so
  // the card can say "procesando" without guessing.
  const processing = Number(asset.variantsReady ?? 4) < 4;
  return (
    <article className={styles.assetCard} data-status={asset.status}>
      <div className={styles.assetVisual} aria-label={`Vista protegida de ${asset.safeName}`}>
        {thumbnailUrl
          ? <img src={thumbnailUrl} alt="" loading="lazy" />
          : <Camera size={25} aria-hidden="true" />}
        <span>{asset.width} × {asset.height}</span>
        {cover && <b><Star size={13} aria-hidden="true" /> Portada</b>}
        {processing && <i>Procesando…</i>}
      </div>
      <div className={styles.assetInfo}>
        <span><strong>{asset.safeName}</strong><small>{formatMediaBytes(asset.byteSize)}</small></span>
        <em data-status={asset.status}>{STATUS_LABELS[asset.status] || asset.status}</em>
      </div>
      {canManage && actionable && !processing && (
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
  const cameraInputRef = useRef(null);
  const queueRef = useRef([]);
  const controllersRef = useRef(new Map());
  const activeUploadsRef = useRef(0);
  const [state, setState] = useState({ status: 'loading', data: null, error: '' });
  const [filters, setFilters] = useState({ tournamentId: '', status: '' });
  const [composerOpen, setComposerOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [queue, setQueue] = useState([]);
  const [activeGalleryId, setActiveGalleryId] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState(false);
  const [thumbnails, setThumbnails] = useState({});
  queueRef.current = queue;

  const patchQueueItem = (id, patch) => setQueue((current) => current.map(
    (candidate) => (candidate.id === id ? { ...candidate, ...patch } : candidate),
  ));

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

  useEffect(() => {
    const controllers = controllersRef.current;
    return () => {
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    };
  }, []);

  const capabilities = state.data?.capabilities || [];
  const canCreate = capabilities.includes('media.create_gallery');
  const canUpload = capabilities.includes('media.upload');
  const canReview = capabilities.includes('media.review');
  const canPublish = capabilities.includes('media.publish');
  const canHandleReports = capabilities.includes('media.handle_reports');
  const capability = resolveUploadCapability(state.data?.storage, { canUpload });
  const uploadReady = capability.canOfferUpload;
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

  const enqueueFiles = async (files) => {
    const selected = Array.from(files || []).slice(0, capability.maxBatchFiles);
    if (selected.length === 0) return;
    const prepared = selected.map((file, index) => {
      const validation = validateSelection(file, {
        ...MEDIA_LIMITS, maxFileBytes: capability.maxFileBytes,
      });
      const invalid = !validation.valid;
      return {
        id: `${file.name}:${file.size}:${file.lastModified || 0}:${index}:${Date.now()}`,
        file,
        displayName: `Foto ${String(index + 1).padStart(2, '0')}`,
        // Shown only here, only to the person who picked the file. The name is
        // never sent: the upload intent uses a synthetic one.
        localName: localDisplayName(file, index),
        status: invalid
          ? 'invalid'
          : uploadReady ? 'ready' : 'staging_required',
        error: invalid
          ? validation.message
          : uploadReady ? '' : capability.unavailableCopy,
        progress: 0,
        previewUrl: '',
        retryable: true,
        idempotencyKey: service.createIdempotencyKey(),
      };
    });
    setQueue(prepared);

    // Previews are decoded one at a time so that picking forty photos does not
    // hold forty full-size bitmaps in memory at once.
    for (const item of prepared) {
      if (item.status === 'invalid') continue;
      // eslint-disable-next-line no-await-in-loop
      const previewUrl = await createPreviewUrl(item.file);
      if (!queueRef.current.some((candidate) => candidate.id === item.id)) continue;
      patchQueueItem(item.id, { previewUrl });
    }
  };

  const selectFiles = (event) => {
    enqueueFiles(event.target.files);
    event.target.value = '';
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    if (!uploadReady && !canUpload) return;
    enqueueFiles(event.dataTransfer?.files);
  };

  const startUpload = async (item) => {
    if (!selectedGallery || !uploadReady) return;
    if (activeUploadsRef.current >= MEDIA_LIMITS.maxConcurrentUploads) {
      patchQueueItem(item.id, {
        status: 'ready',
        error: 'Hay otras fotos subiendo. Esperá a que terminen.',
      });
      return;
    }
    const controller = new AbortController();
    controllersRef.current.set(item.id, controller);
    activeUploadsRef.current += 1;
    patchQueueItem(item.id, { status: 'preparing', error: '', progress: 0 });
    try {
      const result = await service.uploadMediaPhoto({
        galleryId: selectedGallery.id,
        file: item.file,
        idempotencyKey: item.idempotencyKey,
        signal: controller.signal,
        onStage: (stage) => patchQueueItem(item.id, { status: stage }),
        onProgress: (progress) => patchQueueItem(item.id, { progress }),
      });
      patchQueueItem(item.id, {
        status: 'pending_review', progress: 1, error: '', assetId: result.assetId,
      });
      await load();
    } catch (error) {
      patchQueueItem(item.id, {
        status: error?.code === 'cancelled' ? 'cancelled' : 'error',
        error: error?.message || 'No pudimos subir esta foto.',
        retryable: error?.retryable !== false,
        // A consumed intent can never be replayed, so a retry needs a new one.
        idempotencyKey: service.createIdempotencyKey(),
        progress: 0,
      });
    } finally {
      controllersRef.current.delete(item.id);
      activeUploadsRef.current = Math.max(0, activeUploadsRef.current - 1);
    }
  };

  const cancelUpload = (item) => {
    controllersRef.current.get(item.id)?.abort();
  };

  const retryUpload = (item) => startUpload({
    ...item,
    ...(queueRef.current.find((candidate) => candidate.id === item.id) || {}),
  });

  const uploadAll = async () => {
    const pending = queueRef.current.filter((item) => item.status === 'ready');
    for (const item of pending) {
      // Sequential on purpose: the concurrency ceiling exists to keep a phone
      // on a stadium connection from thrashing, not to go faster.
      // eslint-disable-next-line no-await-in-loop
      await startUpload(item);
    }
  };

  const removeQueueItem = (item) => {
    controllersRef.current.get(item.id)?.abort();
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

  // Thumbnails are signed on demand and never persisted: the projection from
  // the database carries no URL at all, by design.
  useEffect(() => {
    const assets = (selectedGallery?.assets || [])
      .filter((asset) => Number(asset.variantsReady ?? 4) >= 4)
      .slice(0, 60);
    if (assets.length === 0 || typeof service.signMediaReadUrls !== 'function') return undefined;
    const controller = new AbortController();
    service.signMediaReadUrls(
      assets.map((asset) => ({ assetId: asset.id, kind: 'thumbnail' })),
      { signal: controller.signal },
    ).then((urls) => {
      if (!controller.signal.aborted) setThumbnails((current) => ({ ...current, ...urls }));
    }).catch(() => {
      // A gallery still renders without thumbnails; it must not error out.
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGallery?.id, selectedGallery?.assets?.length, service]);

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

      <div className={styles.storageGate} data-ready={capability.uploadReady}>
        <ShieldCheck size={20} aria-hidden="true" />
        <span>
          <strong>Carga protegida</strong>
          <small>
            {capability.uploadReady
              ? 'Cada foto se verifica y se limpia antes de quedar pendiente de aprobación.'
              : 'La carga de fotos todavía no está habilitada en este entorno.'}
          </small>
        </span>
        <em>{capability.uploadReady ? 'Activa' : 'Próximamente'}</em>
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
                <section
                  className={styles.uploadPanel}
                  data-dragging={dragging}
                  onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                >
                  <div>
                    <UploadCloud size={24} aria-hidden="true" />
                    <span>
                      <strong>{uploadReady ? 'Cargar fotos' : 'Revisar fotos'}</strong>
                      <small>
                        JPEG, PNG o WebP · hasta 12 MB · máximo {capability.maxBatchFiles} por tanda
                      </small>
                      {!uploadReady && <small>{capability.unavailableCopy}</small>}
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
                  <input
                    ref={cameraInputRef}
                    className={styles.srOnly}
                    type="file"
                    aria-label="Tomar una foto"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    onChange={selectFiles}
                  />
                  <div className={styles.uploadActions}>
                    <button type="button" onClick={() => fileInputRef.current?.click()}>
                      <FileImage size={17} aria-hidden="true" /> Seleccionar archivos
                    </button>
                    <button
                      type="button"
                      className={styles.secondaryAction}
                      onClick={() => cameraInputRef.current?.click()}
                    >
                      <Camera size={17} aria-hidden="true" /> Tomar foto
                    </button>
                    {uploadReady && queue.some((item) => item.status === 'ready') && (
                      <button
                        type="button"
                        className={styles.secondaryAction}
                        onClick={uploadAll}
                      >
                        <UploadCloud size={17} aria-hidden="true" /> Subir todas
                      </button>
                    )}
                  </div>
                  <p className={styles.dropHint}>
                    También podés arrastrar y soltar las fotos acá.
                  </p>
                  <MediaUploadQueue
                    items={queue}
                    canUpload={uploadReady}
                    onUpload={startUpload}
                    onCancel={cancelUpload}
                    onRetry={retryUpload}
                    onRemove={removeQueueItem}
                  />
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
                      thumbnailUrl={thumbnails[`${asset.id}:thumbnail`] || ''}
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
