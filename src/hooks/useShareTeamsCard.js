import { useCallback, useEffect, useRef, useState } from 'react';
import { exportAndShareTeamsCard } from '../utils/shareTeamsCard';
import { notifyBlockingError } from '../utils/notifyBlockingError';

const nextFrame = () => new Promise((resolve) => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  } else {
    setTimeout(resolve, 32);
  }
});

/**
 * Drives the "share teams as an image" flow:
 *  - exposes `cardData` + `cardRef` so the caller can render an off-screen
 *    <ShareableTeamsCard ref={cardRef} data={cardData} />,
 *  - captures that node to a PNG once it has painted,
 *  - shares it via the native / web share sheet,
 *  - tracks `isSharing` and reports failures through notifyBlockingError.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.isNative]
 * @returns {{ isSharing:boolean, shareTeamsCard:(data:Object, options?:Object)=>Promise<boolean>, cardData:?Object, cardRef:React.RefObject }}
 */
export const useShareTeamsCard = ({ isNative = false } = {}) => {
  const [isSharing, setIsSharing] = useState(false);
  const [cardData, setCardData] = useState(null);
  const cardRef = useRef(null);
  const shareOptionsRef = useRef({});
  const fallbackWindowRef = useRef(null);
  const isMountedRef = useRef(true);

  useEffect(() => () => {
    isMountedRef.current = false;
    try {
      fallbackWindowRef.current?.close?.();
    } catch (_error) {
      // Ignore a browser-owned/cross-origin window that can no longer be closed.
    }
  }, []);

  const shareTeamsCard = useCallback(async (data, options = {}) => {
    if (isSharing) return false;
    if (!data || data.isShareable === false) {
      notifyBlockingError('Todavía no hay equipos para compartir.');
      return false;
    }

    let fallbackWindow = null;
    if (!isNative && typeof window !== 'undefined') {
      try {
        // The PNG capture is asynchronous, so opening the fallback after it
        // finishes loses the original user activation and mobile browsers block
        // it. Reserve the tab synchronously in this tap and populate it later.
        fallbackWindow = window.open('', '_blank');
        if (fallbackWindow) {
          fallbackWindow.opener = null;
          fallbackWindow.document.title = 'Generando resumen…';
          fallbackWindow.document.body.style.cssText = [
            'margin:0',
            'min-height:100vh',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'background:#0d0820',
            'color:#fff',
            'font-family:system-ui,sans-serif',
          ].join(';');
          fallbackWindow.document.body.textContent = 'Generando imagen para compartir…';
        }
      } catch (_error) {
        fallbackWindow = null;
      }
    }
    fallbackWindowRef.current = fallbackWindow;
    shareOptionsRef.current = { ...options, fallbackWindow };
    setIsSharing(true);
    setCardData(data);
    return true;
  }, [isNative, isSharing]);

  // Once the off-screen card has painted, capture + share it.
  useEffect(() => {
    if (!cardData) return undefined;
    let cancelled = false;

    (async () => {
      await nextFrame();
      if (cancelled) return;

      const node = cardRef.current;
      const result = node
        ? await exportAndShareTeamsCard({ node, isNative, ...shareOptionsRef.current })
        : { ok: false, reason: 'no-node' };

      if (cancelled) return;
      if (!result.ok && result.reason !== 'cancelled') {
        notifyBlockingError('No pudimos generar la imagen para compartir. Intentá de nuevo.');
      }

      if (!result.ok || result.reason !== 'fallback-open') {
        try {
          fallbackWindowRef.current?.close?.();
        } catch (_error) {
          // Ignore window lifecycle errors.
        }
      }
      fallbackWindowRef.current = null;

      if (isMountedRef.current) {
        setCardData(null);
        setIsSharing(false);
      }
    })();

    return () => { cancelled = true; };
  }, [cardData, isNative]);

  return { isSharing, shareTeamsCard, cardData, cardRef };
};

export default useShareTeamsCard;
