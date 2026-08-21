import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  ChevronLeft,
  ChevronRight,
  Flag,
  Images,
  LockKeyhole,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import { getMediaAssetUrl } from '../domain/mediaValidation';
import styles from './ParticipantMediaGallery.module.css';

const REPORT_REASONS = [
  ['do_not_want_to_appear', 'No quiero aparecer'],
  ['incorrect_identification', 'Identificación incorrecta'],
  ['privacy', 'Privacidad'],
  ['inappropriate_content', 'Contenido inapropiado'],
  ['other', 'Otro'],
];

function ProtectedImage({
  asset, variant = 'grid', alt = '', className = '', eager = false,
}) {
  const url = getMediaAssetUrl(asset, variant);
  if (!url) {
    return (
      <span className={`${styles.protectedFrame} ${className}`} role="img" aria-label={alt || 'Foto protegida pendiente de entrega segura'}>
        <Camera size={26} />
        <small>Vista protegida</small>
      </span>
    );
  }
  return (
    <img
      className={className}
      src={url}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      width={asset.width || 1200}
      height={asset.height || 800}
    />
  );
}

function Lightbox({
  assets, activeIndex, setActiveIndex, close, service,
}) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [report, setReport] = useState({
    reason: 'do_not_want_to_appear',
    detail: '',
    requestHide: false,
  });
  const [reportState, setReportState] = useState({ busy: false, sent: false, error: '' });
  const reportFormId = useId();
  const active = assets[activeIndex];
  const previous = useCallback(() => {
    setActiveIndex((current) => (current - 1 + assets.length) % assets.length);
    setReportOpen(false);
  }, [assets.length, setActiveIndex]);
  const next = useCallback(() => {
    setActiveIndex((current) => (current + 1) % assets.length);
    setReportOpen(false);
  }, [assets.length, setActiveIndex]);

  useEffect(() => {
    closeRef.current?.focus();
    const handleKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (reportOpen) setReportOpen(false);
        else close();
      }
      if (!reportOpen && event.key === 'ArrowLeft') previous();
      if (!reportOpen && event.key === 'ArrowRight') next();
      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(dialogRef.current.querySelectorAll(
          'button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled])',
        ));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [close, next, previous, reportOpen]);

  const submitReport = async (event) => {
    event.preventDefault();
    if (reportState.busy || reportState.sent) return;
    setReportState({ busy: true, sent: false, error: '' });
    try {
      await service.reportMediaAsset({
        assetId: active.id,
        ...report,
        idempotencyKey: service.createIdempotencyKey(),
      });
      setReportState({ busy: false, sent: true, error: '' });
    } catch (error) {
      setReportState({
        busy: false,
        sent: false,
        error: error?.message || 'No pudimos enviar el reporte.',
      });
    }
  };

  return (
    <div className={styles.lightboxBackdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <section
        ref={dialogRef}
        className={styles.lightbox}
        role="dialog"
        aria-modal="true"
        aria-label={`Foto ${activeIndex + 1} de ${assets.length}`}
      >
        <header>
          <span><strong>{active.galleryTitle}</strong><small>{activeIndex + 1} / {assets.length}</small></span>
          <button ref={closeRef} type="button" onClick={close} aria-label="Cerrar galería">
            <X size={21} />
          </button>
        </header>
        <div className={styles.lightboxStage}>
          <ProtectedImage
            asset={active}
            variant="detail"
            alt={active.caption || `Foto ${activeIndex + 1} de ${active.galleryTitle}`}
            eager
          />
          {assets.length > 1 && (
            <>
              <button type="button" className={styles.previous} onClick={previous} aria-label="Foto anterior">
                <ChevronLeft size={24} />
              </button>
              <button type="button" className={styles.next} onClick={next} aria-label="Foto siguiente">
                <ChevronRight size={24} />
              </button>
            </>
          )}
        </div>
        <footer>
          <span>
            <strong>{active.caption || 'Archivo oficial del torneo'}</strong>
            <small>Original restringido · acceso temporal por relación</small>
          </span>
          <button
            type="button"
            className={styles.reportAction}
            aria-expanded={reportOpen}
            aria-controls={reportFormId}
            onClick={() => {
              setReportOpen((current) => !current);
              setReportState({ busy: false, sent: false, error: '' });
            }}
          >
            <Flag size={16} aria-hidden="true" /> Reportar foto
          </button>
        </footer>
        {reportOpen && (
          <form id={reportFormId} className={styles.reportForm} onSubmit={submitReport}>
            <div>
              <span><ShieldCheck size={18} /><strong>Reporte privado</strong></span>
              <p>Tu identidad no se muestra en la galería ni a otros participantes.</p>
            </div>
            {reportState.sent ? (
              <div className={styles.reportSuccess} role="status">
                <ShieldCheck size={19} />
                <span><strong>Reporte enviado</strong><small>El equipo organizador lo revisará sin borrar contenido automáticamente.</small></span>
              </div>
            ) : (
              <>
                <label>
                  <span>Motivo</span>
                  <select value={report.reason} onChange={(event) => setReport((current) => ({
                    ...current, reason: event.target.value,
                  }))}>
                    {REPORT_REASONS.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Detalle</span>
                  <textarea
                    value={report.detail}
                    onChange={(event) => setReport((current) => ({
                      ...current, detail: event.target.value,
                    }))}
                    maxLength={1000}
                    placeholder="Contanos qué deberíamos revisar…"
                  />
                </label>
                <label className={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={report.requestHide}
                    onChange={(event) => setReport((current) => ({
                      ...current, requestHide: event.target.checked,
                    }))}
                  />
                  <span>Solicitar que se oculte mientras se revisa</span>
                </label>
                {reportState.error && <p className={styles.reportError} role="alert">{reportState.error}</p>}
                <button
                  type="submit"
                  className={styles.reportSubmit}
                  disabled={reportState.busy}
                >
                  <Send size={16} aria-hidden="true" />
                  {reportState.busy ? 'Enviando…' : 'Enviar reporte'}
                </button>
              </>
            )}
          </form>
        )}
      </section>
    </div>
  );
}

export default function ParticipantMediaGallery({
  tournamentId,
  categoryId = null,
  matchId = null,
  service,
  hideWhenEmpty = false,
  compact = false,
}) {
  const requestRef = useRef(0);
  const triggerRef = useRef(null);
  const [state, setState] = useState({ status: 'loading', data: null, error: '' });
  const [activeIndex, setActiveIndex] = useState(null);
  const [signedUrls, setSignedUrls] = useState({});

  const load = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setState({ status: 'loading', data: null, error: '' });
    try {
      const data = await service.loadPublishedMedia({
        tournamentId,
        categoryId,
        matchId,
      });
      if (requestRef.current !== requestId) return;
      setState({ status: 'ready', data, error: '' });
    } catch (error) {
      if (requestRef.current !== requestId) return;
      setState({
        status: 'error',
        data: null,
        error: error?.message || 'No pudimos cargar las fotos.',
      });
    }
  }, [categoryId, matchId, service, tournamentId]);

  useEffect(() => {
    // Signed URLs are scoped to the query that produced them; a new tournament
    // or category must not reuse a grant issued for the previous one.
    setSignedUrls({});
    load();
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  const galleries = state.data?.items || [];
  const assets = useMemo(() => galleries.flatMap((gallery) => (
    (gallery.assets || []).map((asset) => ({
      ...asset,
      galleryId: gallery.id,
      galleryTitle: gallery.title,
      // The projection carries no URL: it never has and never will. Whatever
      // this participant is allowed to see arrives from the signer, briefly.
      thumbnailUrl: asset.thumbnailUrl || signedUrls[`${asset.id}:thumbnail`] || null,
      gridUrl: asset.gridUrl || signedUrls[`${asset.id}:grid`] || null,
      detailUrl: asset.detailUrl || signedUrls[`${asset.id}:detail`] || null,
    }))
  )), [galleries, signedUrls]);

  const assetIds = useMemo(
    () => assets.filter((asset) => !asset.gridUrl).map((asset) => asset.id).join(','),
    [assets],
  );

  useEffect(() => {
    const ids = assetIds ? assetIds.split(',') : [];
    if (ids.length === 0) return undefined;
    if (state.data?.delivery?.status !== 'signed_urls') return undefined;
    if (typeof service.signMediaReadUrls !== 'function') return undefined;
    const controller = new AbortController();
    service.signMediaReadUrls(
      ids.flatMap((assetId) => [
        { assetId, kind: 'grid' },
        { assetId, kind: 'detail' },
      ]).slice(0, 60),
      { signal: controller.signal },
    ).then((urls) => {
      if (!controller.signal.aborted) setSignedUrls((current) => ({ ...current, ...urls }));
    }).catch(() => {
      // Without a URL the grid falls back to the protected placeholder, which
      // is the correct behaviour for an unauthorised or unprocessed asset.
    });
    return () => controller.abort();
  }, [assetIds, service, state.data?.delivery?.status]);

  const closeLightbox = () => {
    setActiveIndex(null);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const openAsset = (assetId, event) => {
    const index = assets.findIndex((asset) => asset.id === assetId);
    if (index < 0) return;
    triggerRef.current = event.currentTarget;
    setActiveIndex(index);
  };

  if (state.status === 'loading') {
    return hideWhenEmpty ? null : (
      <div className={styles.skeleton} role="status">
        <span className={styles.srOnly}>Cargando fotos…</span>
        <i /><i /><i />
      </div>
    );
  }
  if (state.status === 'error') {
    return hideWhenEmpty ? null : (
      <section className={styles.emptyState}>
        <AlertTriangle size={27} />
        <h2>No pudimos cargar las fotos</h2>
        <p>{state.error}</p>
        <button type="button" onClick={load}><RefreshCw size={16} /> Reintentar</button>
      </section>
    );
  }
  if (!galleries.length) {
    return hideWhenEmpty ? null : (
      <section className={styles.emptyState}>
        <Images size={29} />
        <h2>Todavía no hay fotos publicadas</h2>
        <p>Esta sección aparece cuando la organización aprueba y publica una galería para tu relación.</p>
      </section>
    );
  }

  return (
    <section className={`${styles.mediaSection} ${compact ? styles.compact : ''}`} aria-label="Fotos del torneo">
      <header className={styles.sectionHeading}>
        <div><p>Memoria de juego</p><h2>{matchId ? 'Fotos del partido' : 'Fotos'}</h2></div>
        <span><LockKeyhole size={14} /> Sólo participantes autorizados</span>
      </header>
      {galleries.map((gallery, galleryIndex) => {
        const cover = gallery.assets.find((asset) => asset.id === gallery.coverAssetId)
          || gallery.assets[0];
        const rest = gallery.assets.filter((asset) => asset.id !== cover?.id);
        return (
          <article className={styles.gallery} key={gallery.id}>
            <header>
              <span><strong>{gallery.title}</strong><small>{gallery.description || `${gallery.assets.length} fotos publicadas`}</small></span>
              <em>{gallery.assets.length} fotos</em>
            </header>
            <div className={styles.photoGrid}>
              {cover && (
                <button
                  type="button"
                  className={styles.cover}
                  onClick={(event) => openAsset(cover.id, event)}
                  aria-label={`Abrir portada de ${gallery.title}`}
                >
                  <ProtectedImage
                    asset={cover}
                    alt={cover.caption || `Portada de ${gallery.title}`}
                    eager={galleryIndex === 0}
                  />
                  <span><Camera size={16} /> Abrir galería</span>
                </button>
              )}
              <div>
                {rest.slice(0, compact ? 3 : 7).map((asset, index) => (
                  <button
                    type="button"
                    key={asset.id}
                    onClick={(event) => openAsset(asset.id, event)}
                    aria-label={`Abrir foto ${index + 2} de ${gallery.title}`}
                  >
                    <ProtectedImage asset={asset} alt={asset.caption || ''} />
                    {index === (compact ? 2 : 6) && rest.length > (compact ? 3 : 7) && (
                      <b>+{rest.length - (compact ? 3 : 7)}</b>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </article>
        );
      })}
      {activeIndex !== null && assets[activeIndex] && (
        <Lightbox
          assets={assets}
          activeIndex={activeIndex}
          setActiveIndex={setActiveIndex}
          close={closeLightbox}
          service={service}
        />
      )}
    </section>
  );
}
