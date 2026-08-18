/**
 * Resolución de firmas para retratos privados, en un solo lugar.
 *
 * Cada card podría pedir su propia URL, pero entonces cada card tendría lógica
 * de Storage y la misma foto se firmaría varias veces. Acá vive un caché en
 * memoria con la expiración real de la firma: mientras siga vigente se reusa, y
 * cuando le queda poco se pide otra. Nada de esto se persiste.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { resolvePlayerPortrait } from '../api/tournamentPlayerPortraitService';

// Margen para no entregar una firma que va a vencer mientras carga la imagen.
const EXPIRY_SAFETY_MS = 30_000;
// Firmar depende de la red y del servicio de auth. Un hipo no puede condenar al
// retrato al monograma hasta que alguien recargue la página, pero tampoco vale
// insistir para siempre: un reintento y después el fallback se queda.
const RESOLVE_RETRY_MS = 1_200;

const cache = new Map();

function keyOf(ref) {
  return ref ? `${ref.kind}:${ref.id}:${ref.variant}` : '';
}

export function invalidatePlayerPortraitUrl(ref) {
  cache.delete(keyOf(ref));
}

export function clearPlayerPortraitUrlCache() {
  cache.clear();
}

export async function getPlayerPortraitUrl(ref, { signal, resolver = resolvePlayerPortrait } = {}) {
  const key = keyOf(ref);
  const entry = cache.get(key);
  if (entry?.value && entry.expiresAt - Date.now() > EXPIRY_SAFETY_MS) return entry.value;
  if (entry?.pending) return entry.pending;
  const pending = resolver(ref, { signal }).then((resolved) => {
    cache.set(key, {
      value: resolved,
      expiresAt: Date.now() + (resolved.ttlSeconds || 0) * 1000,
    });
    return resolved;
  }).catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { pending });
  return pending;
}

/**
 * @returns {{status: 'empty'|'loading'|'ready'|'error', url: string|null,
 *   focal: {x: number, y: number}|null, retry: () => void, reportImageError: () => void}}
 */
export function usePlayerPortraitUrl(ref) {
  const key = keyOf(ref);
  const [state, setState] = useState(() => (
    key ? { status: 'loading', url: null, focal: null } : { status: 'empty', url: null, focal: null }
  ));
  const [attempt, setAttempt] = useState(0);
  const imageRetriedRef = useRef(false);
  const resolveRetriedRef = useRef(false);

  useEffect(() => {
    imageRetriedRef.current = false;
    resolveRetriedRef.current = false;
  }, [key]);

  useEffect(() => {
    if (!key) {
      setState({ status: 'empty', url: null, focal: null });
      return undefined;
    }
    let active = true;
    let retryTimer = null;
    setState((current) => (
      current.status === 'ready' ? current : { status: 'loading', url: null, focal: null }
    ));
    // Deliberadamente sin AbortController: la firma en vuelo es compartida por
    // todas las cards que muestran ese retrato, así que un consumidor que se
    // desmonta no puede cancelarla. Si lo hiciera, el siguiente montaje —el
    // segundo de StrictMode, o cualquier remonte— encontraría en el caché la
    // promesa ya abortada y caería al monograma para siempre.
    getPlayerPortraitUrl(ref)
      .then((resolved) => {
        if (active) setState({ status: 'ready', url: resolved.url, focal: resolved.focal });
      })
      .catch(() => {
        if (!active) return;
        // Sin firma se cae al monograma: es el estado correcto, no un error roto.
        setState({ status: 'error', url: null, focal: null });
        if (resolveRetriedRef.current) return;
        resolveRetriedRef.current = true;
        retryTimer = setTimeout(() => {
          if (active) setAttempt((current) => current + 1);
        }, RESOLVE_RETRY_MS);
      });
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // `ref` es un objeto nuevo en cada render; la identidad real es `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const retry = useCallback(() => {
    if (!key) return;
    invalidatePlayerPortraitUrl(ref);
    resolveRetriedRef.current = false;
    setAttempt((current) => current + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  /** Una firma vencida entre la resolución y el `<img>` merece un reintento, uno solo. */
  const reportImageError = useCallback(() => {
    if (!key) return;
    invalidatePlayerPortraitUrl(ref);
    if (imageRetriedRef.current) {
      setState({ status: 'error', url: null, focal: null });
      return;
    }
    imageRetriedRef.current = true;
    setAttempt((current) => current + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { ...state, retry, reportImageError };
}
