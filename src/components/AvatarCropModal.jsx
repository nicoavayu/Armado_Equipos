import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import logger from '../utils/logger';

// "Ajustar foto" modal for the profile avatar.
//
// The user pans (one finger / mouse drag), pinch-zooms (two pointers) and
// fine-tunes with a slider inside a circular mask that matches the ProfileCard's
// photo hole. On confirm the visible circle is exported as a square JPEG
// (EXPORT_SIZE × EXPORT_SIZE) drawn from the source image — what you see inside
// the circle is exactly what the card shows, with no distortion (uniform scale
// only, clamped so the image always covers the full circle).
//
// No cropper dependency: the maths is ~30 lines and pure (exported below for
// unit tests), and Pointer Events cover mouse + touch + pinch on iOS/Android.

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;
const EXPORT_SIZE = 768; // square output; small enough for any mobile canvas cap
const JPEG_QUALITY = 0.92;

// Keep the image covering the whole circle: with a cover-fit base scale the
// offset can never exceed half the overhang on each axis.
export const clampOffset = (offset, naturalSide, scale, circle) => {
  const max = Math.max(0, (naturalSide * scale - circle) / 2);
  return Math.min(max, Math.max(-max, offset));
};

// Source rectangle (in natural image pixels) of what the circle shows.
// The image is rendered centred in the circle, translated by (tx, ty) display
// px and uniformly scaled by `base * zoom`, where base = cover-fit scale.
export const computeCropSourceRect = ({ naturalW, naturalH, zoom, tx, ty, circle }) => {
  const base = circle / Math.min(naturalW, naturalH);
  const s = base * zoom;
  const size = circle / s;
  return {
    sx: (naturalW - size) / 2 - tx / s,
    sy: (naturalH - size) / 2 - ty / s,
    size,
  };
};

const canvasToBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
  if (typeof canvas.toBlob === 'function') {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode-failed'))), type, quality);
    return;
  }
  // Fallback for engines without canvas.toBlob (mirrors utils/imageUpload).
  try {
    const [, base64] = canvas.toDataURL(type, quality).split(',');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    resolve(new Blob([bytes], { type }));
  } catch (err) {
    reject(err);
  }
});

const pointerDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const AvatarCropModal = ({ isOpen, imageUrl, onCancel, onConfirm }) => {
  const imgRef = useRef(null);
  const pointersRef = useRef(new Map()); // pointerId -> { x, y }
  const naturalRef = useRef({ w: 0, h: 0 });
  const zoomRef = useRef(MIN_ZOOM);
  const txRef = useRef(0);
  const tyRef = useRef(0);

  const [circle, setCircle] = useState(280);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [ready, setReady] = useState(false);
  const [exporting, setExporting] = useState(false);

  // The pan/zoom transform is written imperatively (refs + direct style) so the
  // gesture stays at pointer-move frequency without re-rendering the modal;
  // `zoom` state only mirrors zoomRef for the slider position.
  const applyTransform = useCallback(() => {
    const img = imgRef.current;
    const { w, h } = naturalRef.current;
    if (!img || !w || !h) return;
    const base = circle / Math.min(w, h);
    const s = base * zoomRef.current;
    txRef.current = clampOffset(txRef.current, w, s, circle);
    tyRef.current = clampOffset(tyRef.current, h, s, circle);
    img.style.transform =
      `translate(-50%, -50%) translate3d(${txRef.current.toFixed(2)}px, ${tyRef.current.toFixed(2)}px, 0) scale(${s.toFixed(5)})`;
  }, [circle]);

  const resetView = useCallback(() => {
    zoomRef.current = MIN_ZOOM;
    txRef.current = 0;
    tyRef.current = 0;
    setZoom(MIN_ZOOM);
    applyTransform();
  }, [applyTransform]);

  // Fresh session per photo: size the circle to the viewport and reset the view.
  useEffect(() => {
    if (!isOpen) return;
    setReady(false);
    setExporting(false);
    pointersRef.current.clear();
    setCircle(Math.max(200, Math.min((window.innerWidth || 360) - 72, 300)));
    zoomRef.current = MIN_ZOOM;
    txRef.current = 0;
    tyRef.current = 0;
    setZoom(MIN_ZOOM);
  }, [isOpen, imageUrl]);

  useEffect(() => {
    if (isOpen && ready) applyTransform();
  }, [isOpen, ready, applyTransform]);

  const handleImageLoad = useCallback((e) => {
    const img = e.target;
    naturalRef.current = {
      w: img.naturalWidth || img.width || 0,
      h: img.naturalHeight || img.height || 0,
    };
    setReady(true);
  }, []);

  // Zoom to `nextZoom` keeping the display point `anchor` (px, relative to the
  // circle centre) fixed — the pinch midpoint, or the centre for the slider.
  const zoomAround = useCallback((nextZoom, anchor) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
    const k = clamped / zoomRef.current;
    if (k !== 1) {
      txRef.current = anchor.x + (txRef.current - anchor.x) * k;
      tyRef.current = anchor.y + (tyRef.current - anchor.y) * k;
      zoomRef.current = clamped;
      setZoom(clamped);
      applyTransform();
    }
  }, [applyTransform]);

  const handlePointerDown = useCallback((e) => {
    e.preventDefault();
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) {
      /* pointer may already be gone; harmless */
    }
  }, []);

  const handlePointerMove = useCallback((e) => {
    const pointers = pointersRef.current;
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };

    if (pointers.size === 1) {
      txRef.current += next.x - prev.x;
      tyRef.current += next.y - prev.y;
      pointers.set(e.pointerId, next);
      applyTransform();
      return;
    }

    // Pinch: the other pointer stays put; pan by the midpoint delta, then zoom
    // by the distance ratio anchored at the midpoint.
    const otherEntry = Array.from(pointers.entries()).find(([id]) => id !== e.pointerId);
    if (!otherEntry) return;
    const [, other] = otherEntry;
    const rect = e.currentTarget.getBoundingClientRect();
    const centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };

    const prevMid = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 };
    const nextMid = { x: (next.x + other.x) / 2, y: (next.y + other.y) / 2 };
    txRef.current += nextMid.x - prevMid.x;
    tyRef.current += nextMid.y - prevMid.y;

    const prevDist = pointerDistance(prev, other);
    const nextDist = pointerDistance(next, other);
    pointers.set(e.pointerId, next);
    if (prevDist > 0 && nextDist > 0) {
      const anchor = { x: nextMid.x - centre.x, y: nextMid.y - centre.y };
      zoomAround(zoomRef.current * (nextDist / prevDist), anchor);
    } else {
      applyTransform();
    }
  }, [applyTransform, zoomAround]);

  const handlePointerUp = useCallback((e) => {
    pointersRef.current.delete(e.pointerId);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* already released */
    }
  }, []);

  const handleSliderChange = useCallback((e) => {
    zoomAround(Number(e.target.value), { x: 0, y: 0 });
  }, [zoomAround]);

  const handleConfirm = useCallback(async () => {
    const img = imgRef.current;
    const { w, h } = naturalRef.current;
    if (!img || !w || !h || exporting) return;
    setExporting(true);
    try {
      const { sx, sy, size } = computeCropSourceRect({
        naturalW: w,
        naturalH: h,
        zoom: zoomRef.current,
        tx: txRef.current,
        ty: tyRef.current,
        circle,
      });
      const canvas = document.createElement('canvas');
      canvas.width = EXPORT_SIZE;
      canvas.height = EXPORT_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no-2d-context');
      // JPEG has no alpha: paint a background first so transparent PNG sources
      // never come out black.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, EXPORT_SIZE, EXPORT_SIZE);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, size, size, 0, 0, EXPORT_SIZE, EXPORT_SIZE);
      const blob = await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY);
      await onConfirm(blob);
    } catch (err) {
      logger.error('Avatar crop export failed:', err);
      setExporting(false);
    }
  }, [circle, exporting, onConfirm]);

  if (!isOpen || !imageUrl) return null;

  // Portal to <body>: the embedded profile editor lives inside a transformed
  // ancestor (PageTransition), which would turn `fixed` into a local containing
  // block and push the modal off-screen.
  return ReactDOM.createPortal(
    <div
      data-modal-root="true"
      className="fixed inset-0 z-[1300] bg-black/90 backdrop-blur-md flex items-center justify-center overflow-y-auto"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
        paddingLeft: '24px',
        paddingRight: '24px',
      }}
    >
      <div className="w-full max-w-[360px] m-auto flex flex-col items-center gap-4">
        <h3 className="text-white text-xl font-semibold font-oswald m-0">Ajustar foto</h3>
        <p className="text-white/60 text-xs text-center m-0 -mt-2">
          Movela y hacé zoom hasta que quede como querés.
        </p>

        {/* Gesture viewport: the square is the touch surface, the circular mask
            shows exactly what the card's photo hole will show. */}
        <div
          className="relative overflow-hidden bg-black/60 rounded-[18px] select-none"
          style={{ width: `${circle}px`, height: `${circle}px`, touchAction: 'none', cursor: 'grab' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <img
            ref={imgRef}
            src={imageUrl}
            alt="Vista previa para ajustar"
            draggable={false}
            onLoad={handleImageLoad}
            onError={onCancel}
            className="absolute left-1/2 top-1/2 max-w-none select-none pointer-events-none"
            style={{ transform: 'translate(-50%, -50%)', willChange: 'transform' }}
          />
          {/* Circular mask: dim everything outside the circle. */}
          <div
            aria-hidden
            className="absolute inset-0 rounded-full border border-white/40 pointer-events-none"
            style={{ boxShadow: '0 0 0 9999px rgba(5, 3, 16, 0.72)' }}
          />
        </div>

        <div className="w-full flex items-center gap-3">
          <span aria-hidden className="text-white/60 text-xs">−</span>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={handleSliderChange}
            aria-label="Zoom de la foto"
            className="flex-1 accent-[#8b5cff] cursor-pointer"
            disabled={!ready}
          />
          <span aria-hidden className="text-white/60 text-base">+</span>
        </div>

        <button
          type="button"
          onClick={resetView}
          disabled={!ready}
          className="bg-transparent border-0 p-1 text-[#a78bfa] text-sm font-semibold cursor-pointer hover:text-[#c4b5fd] transition-colors disabled:opacity-50"
        >
          Recentrar
        </button>

        <div className="w-full flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={exporting}
            className="flex-1 h-[46px] font-bebas font-semibold text-base border border-[rgba(148,134,255,0.28)] rounded-2xl cursor-pointer transition-all text-white/90 bg-white/[0.05] hover:bg-white/[0.1] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!ready || exporting}
            className="flex-1 h-[46px] font-bebas font-semibold text-base border border-white/15 rounded-2xl cursor-pointer transition-all text-white bg-cta-gradient shadow-cta hover:brightness-110 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {exporting ? 'Guardando…' : 'Usar foto'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default AvatarCropModal;
