/**
 * The upload orchestration, driven without a browser codec or a network.
 *
 * jsdom has no canvas encoder, so `prepareUploadPayload` is mocked: what is
 * under test here is the ORDER and the GUARDS — that no session is opened
 * before the file decodes, that a closed environment never reaches the signer,
 * that a failed attempt releases its quota, and that a retry cannot replay a
 * consumed intent.
 */

jest.mock('../features/torneos/domain/mediaImageClient', () => {
  const actual = jest.requireActual('../features/torneos/domain/mediaImageClient');
  return { ...actual, prepareUploadPayload: jest.fn() };
});
jest.mock('../services/api/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: { access_token: 'jwt-token' } },
      }),
    },
  },
}));

import { supabase } from '../services/api/supabase';
import { MediaClientError, prepareUploadPayload } from '../features/torneos/domain/mediaImageClient';
import {
  MediaUploadError,
  uploadTournamentMediaPhoto,
} from '../features/torneos/api/tournamentMediaUploadClient';

// Real Blobs: FormData rejects anything else, and the client appends the
// renditions verbatim.
const blob = (size) => new Blob([new Uint8Array(size)], { type: 'image/jpeg' });

function payload() {
  return {
    mime: 'image/jpeg',
    width: 4000,
    height: 3000,
    source: blob(900_000),
    renditions: [
      { kind: 'thumbnail', blob: blob(9_000), width: 320, height: 240 },
      { kind: 'grid', blob: blob(60_000), width: 800, height: 600 },
      { kind: 'detail', blob: blob(300_000), width: 1600, height: 1200 },
    ],
  };
}

let xhrInstances;

class FakeXhr {
  constructor() {
    this.upload = {};
    this.status = 200;
    xhrInstances.push(this);
  }

  open(method, url) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name, value) {
    this.headers = { ...(this.headers || {}), [name]: value };
  }

  send(body) {
    this.body = body;
    // Deliberately asynchronous so a caller can abort mid-flight.
    this.pending = setTimeout(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 45, total: 90 });
      this.upload.onprogress?.({ lengthComputable: true, loaded: 90, total: 90 });
      if (this.status >= 400) this.onerror?.();
      else this.onload?.();
    }, 0);
  }

  abort() {
    clearTimeout(this.pending);
    this.onabort?.();
  }
}

function serviceResponses(overrides = {}) {
  return {
    'tournament-media-signer': {
      ok: true,
      body: { uploadUrl: 'https://storage.local/signed', uploadToken: 'storage-token' },
    },
    'tournament-media-processor': {
      ok: true,
      status: 202,
      // The orchestrator only queues. There is no assetId yet, and there will
      // not be one until the trusted worker has decoded, transcoded, scanned
      // and written every final object.
      body: { sessionId: 'session-1', jobId: 'job-1', status: 'queued', assetId: null },
    },
    ...overrides,
  };
}

function mockFetch(responses) {
  return jest.fn(async (url) => {
    const name = String(url).split('/').pop();
    const entry = responses[name];
    if (!entry) throw new Error(`unexpected call to ${url}`);
    return {
      ok: entry.ok,
      status: entry.status || (entry.ok ? 200 : 500),
      json: async () => entry.body,
    };
  });
}

function runUpload(overrides = {}) {
  return uploadTournamentMediaPhoto({
    galleryId: 'gallery-1',
    file: new File(['x'], 'partido.jpg', { type: 'image/jpeg' }),
    idempotencyKey: 'idem-1',
    requestUploadSession: jest.fn().mockResolvedValue({
      sessionId: 'session-1', token: 'a'.repeat(64), uploadReady: true, reused: false,
    }),
    cancelUploadSession: jest.fn().mockResolvedValue({}),
    ...overrides,
  });
}

describe('tournament media upload client', () => {
  beforeEach(() => {
    xhrInstances = [];
    process.env.REACT_APP_SUPABASE_URL = 'http://127.0.0.1:57321';
    process.env.REACT_APP_SUPABASE_ANON_KEY = 'anon-key';
    global.XMLHttpRequest = FakeXhr;
    global.fetch = mockFetch(serviceResponses());
    prepareUploadPayload.mockReset();
    prepareUploadPayload.mockResolvedValue(payload());
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'jwt-token' } },
    });
  });

  test('runs decode, intent, signer, upload and queue in that order', async () => {
    const stages = [];
    const progress = [];
    const requestUploadSession = jest.fn().mockResolvedValue({
      sessionId: 'session-1', token: 'a'.repeat(64), uploadReady: true,
    });
    const result = await runUpload({
      requestUploadSession,
      onStage: (stage) => stages.push(stage),
      onProgress: (value) => progress.push(value),
    });

    // Terminal at `processing`: the browser is done, the asset does not exist.
    expect(stages).toEqual(['preparing', 'uploading', 'processing']);
    expect(result).toMatchObject({ jobId: 'job-1', assetId: null, status: 'processing' });
    // Decoding happens before the intent, so a file that cannot be decoded
    // never consumes quota or creates a session.
    expect(prepareUploadPayload).toHaveBeenCalledTimes(1);
    expect(progress[progress.length - 1]).toBe(1);
    expect(progress.every((value) => value >= 0 && value <= 1)).toBe(true);
  });

  test('opens the intent for the normalised bytes under a synthetic name', async () => {
    const requestUploadSession = jest.fn().mockResolvedValue({
      sessionId: 'session-1', token: 'a'.repeat(64), uploadReady: true,
    });
    await runUpload({ requestUploadSession });
    expect(requestUploadSession).toHaveBeenCalledWith({
      galleryId: 'gallery-1',
      // Not `partido.jpg`: the real filename never leaves the browser.
      fileName: 'upload.jpg',
      mime: 'image/jpeg',
      // The size of what will actually be stored, not of the picked file.
      byteSize: 900_000,
      idempotencyKey: 'idem-1',
    });
  });

  test('sends only the session handle to the orchestrator — never a rendition', async () => {
    await runUpload();
    const call = global.fetch.mock.calls.find(
      ([url]) => String(url).endsWith('tournament-media-processor'),
    );
    // A FormData body is what carried the browser's renditions. There is none.
    expect(call[1].body).toEqual(expect.any(String));
    const body = JSON.parse(call[1].body);
    expect(body).toEqual({
      action: 'queue', sessionId: 'session-1', token: 'a'.repeat(64),
    });
    // Nothing about the file, the path or the client's own measurements.
    for (const key of ['thumbnail', 'grid', 'detail', 'fileName', 'path', 'checksum']) {
      expect(body[key]).toBeUndefined();
    }
  });

  test('the browser never uploads more than the one quarantined object', async () => {
    await runUpload();
    // One PUT, to the signed URL, and nothing else touches Storage.
    expect(xhrInstances).toHaveLength(1);
    expect(xhrInstances[0].url).toBe('https://storage.local/signed');
    const storageCalls = global.fetch.mock.calls.filter(
      ([url]) => String(url).includes('storage'),
    );
    expect(storageCalls).toHaveLength(0);
  });

  test('never reaches the signer when the environment is not ready', async () => {
    const requestUploadSession = jest.fn().mockResolvedValue({
      sessionId: 'session-1', token: 'a'.repeat(64), uploadReady: false,
      requiresStagingStorageSigner: true,
    });
    await expect(runUpload({ requestUploadSession })).rejects.toMatchObject({
      code: 'staging_required', retryable: false,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('refuses a reused intent instead of uploading without a token', async () => {
    const requestUploadSession = jest.fn().mockResolvedValue({
      sessionId: 'session-1', token: null, reused: true, uploadReady: true,
    });
    await expect(runUpload({ requestUploadSession })).rejects.toMatchObject({
      code: 'upload_session_invalid',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('releases the session when the upload fails', async () => {
    const cancelUploadSession = jest.fn().mockResolvedValue({});
    global.fetch = mockFetch(serviceResponses({
      'tournament-media-processor': {
        ok: false, status: 422, body: { error: 'source_rejected', code: 'MEDIA_MIME_MISMATCH' },
      },
    }));
    await expect(runUpload({ cancelUploadSession })).rejects.toMatchObject({
      code: 'MEDIA_MIME_MISMATCH', retryable: false,
    });
    expect(cancelUploadSession).toHaveBeenCalledWith('session-1');
  });

  test('surfaces a content rejection in the user\'s language, not the server\'s', async () => {
    global.fetch = mockFetch(serviceResponses({
      'tournament-media-processor': {
        ok: false, status: 422,
        body: { error: 'source_rejected', code: 'MEDIA_ANIMATION_UNSUPPORTED' },
      },
    }));
    await expect(runUpload()).rejects.toThrow(/animadas/i);
  });

  test('treats transport failures as retryable and rejections as final', async () => {
    global.fetch = mockFetch(serviceResponses({
      'tournament-media-signer': { ok: false, status: 502, body: { error: 'storage_unavailable' } },
    }));
    await expect(runUpload()).rejects.toMatchObject({ retryable: true });

    global.fetch = mockFetch(serviceResponses({
      'tournament-media-signer': { ok: false, status: 403, body: { error: 'forbidden' } },
    }));
    await expect(runUpload()).rejects.toMatchObject({ retryable: false });
  });

  test('an expired intent stays retryable so the queue can start over', async () => {
    global.fetch = mockFetch(serviceResponses({
      'tournament-media-signer': {
        ok: false, status: 409, body: { error: 'upload_session_invalid' },
      },
    }));
    await expect(runUpload()).rejects.toMatchObject({
      code: 'upload_session_invalid', retryable: true,
    });
  });

  test('cancelling mid-flight aborts the transfer and releases the session', async () => {
    const controller = new AbortController();
    const cancelUploadSession = jest.fn().mockResolvedValue({});
    const pending = runUpload({
      cancelUploadSession,
      signal: controller.signal,
      onStage: (stage) => { if (stage === 'uploading') controller.abort(); },
    });
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(cancelUploadSession).toHaveBeenCalledWith('session-1');
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('tournament-media-processor'), expect.anything(),
    );
  });

  test('a storage rejection of the PUT does not reach the processor', async () => {
    const original = FakeXhr.prototype.send;
    FakeXhr.prototype.send = function send(body) {
      this.status = 500;
      original.call(this, body);
    };
    try {
      await expect(runUpload()).rejects.toMatchObject({ code: 'network' });
      expect(global.fetch).toHaveBeenCalledTimes(1);
    } finally {
      FakeXhr.prototype.send = original;
    }
  });

  test('a file the browser cannot decode never opens a session', async () => {
    const requestUploadSession = jest.fn();
    prepareUploadPayload.mockRejectedValue(
      new MediaClientError('decode_failed', 'No pudimos abrir esta imagen.'),
    );
    await expect(runUpload({ requestUploadSession })).rejects.toBeInstanceOf(MediaUploadError);
    expect(requestUploadSession).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('an unsupported format is final, a transient decode failure is not', async () => {
    prepareUploadPayload.mockRejectedValue(new MediaClientError('mime', 'Formato no admitido.'));
    await expect(runUpload()).rejects.toMatchObject({ retryable: false });

    prepareUploadPayload.mockRejectedValue(new MediaClientError('encode_failed', 'Falló.'));
    await expect(runUpload()).rejects.toMatchObject({ retryable: true });
  });

  test('a missing session fails closed before any network call', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    await expect(runUpload()).rejects.toMatchObject({
      code: 'auth_required', retryable: false,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('an unconfigured environment fails closed rather than guessing a URL', async () => {
    process.env.REACT_APP_SUPABASE_URL = '';
    await expect(runUpload()).rejects.toMatchObject({
      code: 'storage_unavailable', retryable: false,
    });
  });
});
