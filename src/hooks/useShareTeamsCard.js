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
  const isMountedRef = useRef(true);

  useEffect(() => () => { isMountedRef.current = false; }, []);

  const shareTeamsCard = useCallback(async (data, options = {}) => {
    if (isSharing) return false;
    if (!data || data.isShareable === false) {
      notifyBlockingError('Todavía no hay equipos para compartir.');
      return false;
    }
    shareOptionsRef.current = options;
    setIsSharing(true);
    setCardData(data);
    return true;
  }, [isSharing]);

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
