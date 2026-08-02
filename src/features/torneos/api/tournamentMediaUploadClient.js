/**
 * Drives one photo from a file input into the processing queue.
 *
 * The browser never chooses a path, never names a bucket and never tells the
 * database what a file is. It asks for an intent, exchanges it for a signed
 * URL at the signer and PUTs ONE object — the quarantined upload.
 *
 * What it no longer does is produce the published renditions. The three
 * canvas re-encodes below are a local preview and a size pre-flight; the
 * trusted worker decodes the quarantined object with a real codec, re-encodes
 * it, strips its metadata, derives every variant from those pixels and scans
 * them. So the flow ends at `processing`, not at `pending_review`: the asset
 * does not exist until the worker says it does.
 *
 * Progress, cancellation and retry live here rather than in the component so
 * that the UI only renders state.
 */

import { supabase } from '../../../services/api/supabase';
import {
  describeMediaPipelineError,
  syntheticUploadName,
} from '../domain/mediaPipeline';
import { MediaClientError, prepareUploadPayload } from '../domain/mediaImageClient';

const SIGNER_FUNCTION = 'tournament-media-signer';
const ORCHESTRATOR_FUNCTION = 'tournament-media-processor';

export class MediaUploadError extends Error {
  constructor(message, { code = null, retryable = true } = {}) {
    super(message);
    this.name = 'MediaUploadError';
    this.code = code;
    this.retryable = retryable;
  }
}

function functionsBaseUrl() {
  const url = String(process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  return url ? `${url}/functions/v1` : '';
}

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const accessToken = data?.session?.access_token;
  if (!accessToken) {
    throw new MediaUploadError(
      'Tu sesión venció. Volvé a iniciar sesión y reintentá.',
      { code: 'auth_required', retryable: false },
    );
  }
  return {
    apikey: process.env.REACT_APP_SUPABASE_ANON_KEY || '',
    Authorization: `Bearer ${accessToken}`,
  };
}

async function callFunction(name, { body, headers = {}, signal }) {
  const base = functionsBaseUrl();
  if (!base) {
    throw new MediaUploadError('El servicio de fotos no está configurado en este entorno.', {
      code: 'storage_unavailable', retryable: false,
    });
  }
  const response = await fetch(`${base}/${name}`, {
    method: 'POST',
    headers: { ...(await authHeaders()), ...headers },
    body,
    signal,
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new MediaUploadError(
      describeMediaPipelineError(payload?.error, payload?.code),
      {
        code: payload?.code || payload?.error || `http_${response.status}`,
        // A rejected file will be rejected again; a transport hiccup will not.
        retryable: ![403, 409, 422].includes(response.status)
          || payload?.error === 'upload_session_invalid',
      },
    );
  }
  return payload;
}

/**
 * PUT with real progress. `fetch` still cannot report upload progress, so this
 * is the one place the codebase reaches for XMLHttpRequest.
 */
function putWithProgress(url, blob, contentType, { onProgress, signal }) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    request.open('PUT', url, true);
    request.setRequestHeader('Content-Type', contentType);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && typeof onProgress === 'function') {
        onProgress(Math.min(0.95, event.loaded / event.total));
      }
    };
    request.onload = () => {
      signal?.removeEventListener?.('abort', abort);
      if (request.status >= 200 && request.status < 300) resolve();
      else {
        reject(new MediaUploadError('No pudimos subir la foto. Reintentá.', {
          code: `storage_${request.status}`,
          retryable: request.status !== 409,
        }));
      }
    };
    request.onerror = () => {
      signal?.removeEventListener?.('abort', abort);
      reject(new MediaUploadError('Se cortó la conexión durante la carga.', {
        code: 'network', retryable: true,
      }));
    };
    request.onabort = () => {
      signal?.removeEventListener?.('abort', abort);
      reject(new MediaUploadError('Carga cancelada.', {
        code: 'cancelled', retryable: true,
      }));
    };
    if (signal) {
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener('abort', abort, { once: true });
    }
    request.send(blob);
  });
}

/**
 * Runs the whole flow for one file.
 *
 * `onStage` reports the coarse phase the user sees; `onProgress` reports the
 * byte-level fraction within the upload phase only, so the bar never jumps
 * backwards when processing starts.
 */
export async function uploadTournamentMediaPhoto({
  galleryId,
  file,
  idempotencyKey,
  requestUploadSession,
  cancelUploadSession,
  signal,
  onStage = () => {},
  onProgress = () => {},
}) {
  let session = null;
  try {
    onStage('preparing');
    const payload = await prepareUploadPayload(file, { signal });
    if (signal?.aborted) throw new MediaUploadError('Carga cancelada.', { code: 'cancelled' });

    // The intent is opened for the NORMALISED bytes, not the original file:
    // the recorded size has to describe the object that will actually land in
    // the bucket, and the name is synthetic so no filename ever leaves here.
    session = await requestUploadSession({
      galleryId,
      fileName: syntheticUploadName(payload.mime),
      mime: payload.mime,
      byteSize: payload.source.size,
      idempotencyKey,
    });
    if (session?.uploadReady !== true) {
      throw new MediaUploadError(
        'La carga de fotos todavía no está habilitada en este entorno.',
        { code: 'staging_required', retryable: false },
      );
    }
    if (!session?.token) {
      throw new MediaUploadError(
        'Esta foto ya se había preparado. Reintentá para empezar de nuevo.',
        { code: 'upload_session_invalid', retryable: false },
      );
    }

    const intent = await callFunction(SIGNER_FUNCTION, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'upload-intent',
        sessionId: session.sessionId,
        token: session.token,
      }),
      signal,
    });

    onStage('uploading');
    await putWithProgress(intent.uploadUrl, payload.source, payload.mime, {
      onProgress, signal,
    });
    onProgress(1);

    onStage('processing');
    const queued = await callFunction(ORCHESTRATOR_FUNCTION, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'queue',
        sessionId: session.sessionId,
        token: session.token,
      }),
      signal,
    });

    // Deliberately terminal at `processing`. There is no assetId yet, and
    // pretending otherwise is what let a browser rendition look publishable.
    return {
      jobId: queued.jobId,
      assetId: null,
      safeName: session.safeName,
      status: 'processing',
      width: payload.width ?? null,
      height: payload.height ?? null,
      byteSize: payload.source.size,
    };
  } catch (error) {
    // A session that was issued but never consumed holds quota until it
    // expires, so cancel it on the way out whenever we still can.
    if (session?.sessionId && typeof cancelUploadSession === 'function') {
      try {
        await cancelUploadSession(session.sessionId);
      } catch {
        /* the session expires within ten minutes regardless */
      }
    }
    if (error instanceof MediaUploadError) throw error;
    if (error instanceof MediaClientError) {
      throw new MediaUploadError(error.message, {
        code: error.code,
        retryable: !['mime', 'dimensions', 'canvas_unavailable'].includes(error.code),
      });
    }
    if (error?.name === 'AbortError') {
      throw new MediaUploadError('Carga cancelada.', { code: 'cancelled' });
    }
    throw new MediaUploadError(
      error?.message || 'No pudimos completar la carga. Reintentá en unos minutos.',
      { code: 'media_service_failed' },
    );
  }
}

/**
 * Exchanges asset ids for short-lived signed URLs. Returns a map keyed by
 * `assetId:kind`; an entry the caller is not allowed to see simply has no URL.
 */
export async function signTournamentMediaReadUrls(assets, { signal } = {}) {
  if (!Array.isArray(assets) || assets.length === 0) return {};
  const payload = await callFunction(SIGNER_FUNCTION, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'read-urls', assets }),
    signal,
  });
  const urls = {};
  for (const item of payload?.items || []) {
    if (item?.url) urls[`${item.assetId}:${item.kind}`] = item.url;
  }
  return urls;
}
