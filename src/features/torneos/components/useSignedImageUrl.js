/**
 * Firmas efímeras de imágenes privadas, en un solo lugar.
 *
 * Retratos (1C.2B) y foto del equipo (1C.3B) resuelven la misma clase de
 * problema: un `ImageRef` durable que hay que cambiar por una URL firmada que
 * vence, sin persistir nunca la firma y sin que dos consumidores de la misma
 * imagen pidan dos firmas. Lo único que cambia entre los dos es a qué Edge
 * function se le pregunta, así que eso es lo único que se parametriza.
 *
 * Cada familia estrena su propio caché: los `ImageRef` traen `kind`, pero un
 * caché compartido haría que limpiar el de retratos en un test se llevara
 * puesto el de fotos de equipo.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// Margen para no entregar una firma que va a vencer mientras carga la imagen.
const EXPIRY_SAFETY_MS = 30_000;
// Firmar depende de la red y del servicio de auth. Un hipo no puede condenar a
// la imagen al fallback hasta que alguien recargue la página, pero tampoco vale
// insistir para siempre: un reintento y después el fallback se queda.
const RESOLVE_RETRY_MS = 1_200;

const EMPTY = Object.freeze({ status: 'empty', url: null, resolved: null });

export function createSignedImageUrl(defaultResolver) {
  const cache = new Map();

  const keyOf = (ref) => (ref ? `${ref.kind}:${ref.id}:${ref.variant}` : '');

  function invalidate(ref) {
    cache.delete(keyOf(ref));
  }

  function clear() {
    cache.clear();
  }

  async function get(ref, { signal, resolver = defaultResolver } = {}) {
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
   *   resolved: object|null, retry: () => void, reportImageError: () => void}}
   */
  function useSignedUrl(ref) {
    const key = keyOf(ref);
    const [state, setState] = useState(() => (
      key ? { status: 'loading', url: null, resolved: null } : EMPTY
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
        setState(EMPTY);
        return undefined;
      }
      let active = true;
      let retryTimer = null;
      setState((current) => (
        current.status === 'ready' ? current : { status: 'loading', url: null, resolved: null }
      ));
      // Deliberadamente sin AbortController: la firma en vuelo es compartida por
      // todos los consumidores de esa imagen, así que uno que se desmonta no
      // puede cancelarla. Si lo hiciera, el siguiente montaje —el segundo de
      // StrictMode, o cualquier remonte— encontraría en el caché la promesa ya
      // abortada y caería al fallback para siempre.
      get(ref)
        .then((resolved) => {
          if (active) setState({ status: 'ready', url: resolved.url, resolved });
        })
        .catch(() => {
          if (!active) return;
          // Sin firma se cae al fallback: es el estado correcto, no un error roto.
          setState({ status: 'error', url: null, resolved: null });
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
      invalidate(ref);
      resolveRetriedRef.current = false;
      setAttempt((current) => current + 1);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    /** Una firma vencida entre la resolución y el `<img>` merece un reintento, uno solo. */
    const reportImageError = useCallback(() => {
      if (!key) return;
      invalidate(ref);
      if (imageRetriedRef.current) {
        setState({ status: 'error', url: null, resolved: null });
        return;
      }
      imageRetriedRef.current = true;
      setAttempt((current) => current + 1);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    return { ...state, retry, reportImageError };
  }

  return { get, invalidate, clear, useSignedUrl };
}
