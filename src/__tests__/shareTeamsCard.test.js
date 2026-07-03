jest.mock('html-to-image', () => ({ toPng: jest.fn() }));
jest.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile: jest.fn(), getUri: jest.fn() },
  Directory: { Cache: 'CACHE' },
}));
jest.mock('@capacitor/share', () => ({ Share: { share: jest.fn() } }));
jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: {
    error: jest.fn(), warn: jest.fn(), info: jest.fn(), log: jest.fn(), debug: jest.fn(),
  },
}));

import { toPng } from 'html-to-image';
import { Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import {
  captureNodeToPng,
  exportAndShareTeamsCard,
} from '../utils/shareTeamsCard';

const PNG_DATA_URL = 'data:image/png;base64,QUJD'; // base64 of "ABC"

describe('captureNodeToPng', () => {
  beforeEach(() => jest.clearAllMocks());

  test('throws when there is no node', async () => {
    await expect(captureNodeToPng(null)).rejects.toThrow();
  });

  test('renders the node at the fixed card width (height follows content)', async () => {
    toPng.mockResolvedValue(PNG_DATA_URL);
    const node = document.createElement('div');

    const result = await captureNodeToPng(node);

    expect(result).toBe(PNG_DATA_URL);
    expect(toPng).toHaveBeenCalledTimes(1);
    const [calledNode, opts] = toPng.mock.calls[0];
    expect(calledNode).toBe(node);
    expect(opts).toMatchObject({ width: 1080, cacheBust: true });
    expect(opts).not.toHaveProperty('height');
  });
});

describe('exportAndShareTeamsCard (native)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('writes the PNG to cache and opens the native share sheet', async () => {
    toPng.mockResolvedValue(PNG_DATA_URL);
    Filesystem.writeFile.mockResolvedValue({ uri: 'file:///cache/teams.png' });

    const node = document.createElement('div');
    const result = await exportAndShareTeamsCard({
      node,
      isNative: true,
      fileName: 'teams.png',
      title: 'Equipos',
      text: 'mira',
    });

    expect(result).toEqual({ ok: true });
    expect(Filesystem.writeFile).toHaveBeenCalledWith({
      path: 'teams.png',
      data: 'QUJD', // prefix stripped
      directory: 'CACHE',
    });
    expect(Share.share).toHaveBeenCalledWith({
      title: 'Equipos',
      text: 'mira',
      files: ['file:///cache/teams.png'],
    });
  });

  test('falls back to Filesystem.getUri when writeFile returns no uri', async () => {
    toPng.mockResolvedValue(PNG_DATA_URL);
    Filesystem.writeFile.mockResolvedValue({});
    Filesystem.getUri.mockResolvedValue({ uri: 'file:///cache/from-geturi.png' });

    const node = document.createElement('div');
    const result = await exportAndShareTeamsCard({ node, isNative: true, fileName: 'x.png' });

    expect(result).toEqual({ ok: true });
    expect(Share.share).toHaveBeenCalledWith(
      expect.objectContaining({ files: ['file:///cache/from-geturi.png'] }),
    );
  });

  test('returns export-failed when capture throws', async () => {
    toPng.mockRejectedValue(new Error('boom'));
    const node = document.createElement('div');

    const result = await exportAndShareTeamsCard({ node, isNative: true });

    expect(result).toEqual({ ok: false, reason: 'export-failed' });
    expect(Share.share).not.toHaveBeenCalled();
  });

  test('treats a cancelled share as a non-error', async () => {
    toPng.mockResolvedValue(PNG_DATA_URL);
    Filesystem.writeFile.mockResolvedValue({ uri: 'file:///cache/teams.png' });
    Share.share.mockRejectedValue(new Error('Share canceled'));

    const node = document.createElement('div');
    const result = await exportAndShareTeamsCard({ node, isNative: true, fileName: 'teams.png' });

    expect(result).toEqual({ ok: false, reason: 'cancelled' });
  });
});

describe('exportAndShareTeamsCard (web)', () => {
  const originalOpen = window.open;
  const originalFetch = global.fetch;

  beforeEach(() => jest.clearAllMocks());
  afterEach(() => {
    window.open = originalOpen;
    global.fetch = originalFetch;
  });

  test('opens the image when the Web Share API is unavailable', async () => {
    toPng.mockResolvedValue(PNG_DATA_URL);
    // No navigator.share/canShare in jsdom; force the file fetch to fail so we
    // deterministically hit the open-in-tab fallback.
    global.fetch = jest.fn().mockRejectedValue(new Error('no fetch'));
    window.open = jest.fn(() => ({}));

    const node = document.createElement('div');
    const result = await exportAndShareTeamsCard({ node, isNative: false, fileName: 'teams.png' });

    expect(result).toEqual({ ok: true, reason: 'fallback-open' });
    expect(window.open).toHaveBeenCalledWith(PNG_DATA_URL, '_blank', 'noopener,noreferrer');
    expect(Filesystem.writeFile).not.toHaveBeenCalled();
  });

  test('reuses a tab reserved by the original user tap after async capture', async () => {
    toPng.mockResolvedValue(PNG_DATA_URL);
    global.fetch = jest.fn().mockRejectedValue(new Error('no fetch'));
    window.open = jest.fn();
    const fallbackDocument = document.implementation.createHTMLDocument('Generando');
    const fallbackWindow = {
      document: fallbackDocument,
      close: jest.fn(),
    };

    const node = document.createElement('div');
    const result = await exportAndShareTeamsCard({
      node,
      isNative: false,
      fileName: 'resumen.png',
      title: 'Resumen del partido',
      fallbackWindow,
    });

    expect(result).toEqual({ ok: true, reason: 'fallback-open' });
    expect(window.open).not.toHaveBeenCalled();
    const image = fallbackDocument.querySelector('img');
    expect(image).not.toBeNull();
    expect(image.src).toContain('data:image/png;base64,QUJD');
    expect(image.alt).toBe('Resumen del partido');
  });
});
