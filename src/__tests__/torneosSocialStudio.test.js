/**
 * Estudio Social: contracts and deterministic rendering.
 *
 * jsdom has no Canvas 2D implementation, so the renderer is driven through a
 * recording context that logs every operation. That is not a compromise — it
 * is a stronger assertion than a pixel diff: two runs with the same input must
 * produce the identical *sequence of draw calls*, which is what "deterministic"
 * actually means here.
 */

import {
  SOCIAL_FORMATS,
  SOCIAL_PIECES,
  SocialSnapshotError,
  assertNoPrivateData,
  createEditorialState,
  describeCurationGap,
  findSocialPiece,
  selectionSizeForSnapshot,
  socialFileName,
  validateSocialSnapshot,
} from '../features/torneos/social/socialContracts';
import {
  SocialRenderError,
  drawSocialPiece,
  exportSocialPiece,
  renderSocialPiece,
  shareSocialPiece,
} from '../features/torneos/social/socialStudio';
import { getSocialTemplate } from '../features/torneos/social/socialTemplates';
import { fitLines, initialsOf } from '../features/torneos/social/base/core';

const ORGANIZATION = '11111111-1111-4111-8111-111111111111';

function recordingContext(log) {
  const state = { font: '', fillStyle: '', textAlign: '', letterSpacing: '' };
  const record = (name) => (...args) => {
    log.push(`${name}(${args.map((value) => (
      typeof value === 'object' && value !== null ? '[obj]' : String(value)
    )).join(',')})`);
  };
  return new Proxy({
    measureText: (text) => {
      // Deterministic metrics: 0.52em per character is close enough to a
      // condensed display face for layout decisions, and identical every run.
      const size = Number((state.font.match(/(\d+)px/) || [0, 16])[1]);
      return { width: String(text).length * size * 0.52 };
    },
    createRadialGradient: () => ({ addColorStop: record('gradient.stop') }),
    createLinearGradient: () => ({ addColorStop: record('gradient.stop') }),
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    translate: record('translate'),
    rotate: record('rotate'),
    scale: record('scale'),
    quadraticCurveTo: record('quadraticCurveTo'),
    arc: record('arc'),
    fill: record('fill'),
    stroke: record('stroke'),
    clip: record('clip'),
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    setLineDash: record('setLineDash'),
    fillText: record('fillText'),
    drawImage: record('drawImage'),
  }, {
    get(target, key) {
      if (key in target) return target[key];
      return state[key];
    },
    set(target, key, value) {
      state[key] = value;
      log.push(`set:${String(key)}=${String(value)}`);
      return true;
    },
  });
}

function fakeCanvasFactory(log) {
  return (width, height) => ({
    width,
    height,
    setAttribute: () => {},
    getContext: () => recordingContext(log),
    toBlob: (callback) => callback(new Blob(['png'], { type: 'image/png' })),
  });
}

function baseSnapshot(piece, official) {
  return {
    schemaVersion: 1,
    piece,
    generatedAt: '2026-08-03T12:00:00.000Z',
    source: {
      organizationId: ORGANIZATION,
      tournamentId: 't-1',
      categoryId: 'c-1',
      phaseId: 'p-1',
      roundId: 'r-6',
      fixtureVersionId: 'f-1',
      standingsRevisionId: 'rev-9',
      standingsRevisionNumber: '9',
    },
    competition: {
      organizationName: 'Liga Horizonte',
      tournamentName: 'Copa Horizonte',
      categoryName: 'Primera',
      phaseName: 'Fase regular',
      roundName: 'Fecha 6',
      roundNumber: 6,
    },
    official,
    capabilities: ['social.read', 'social.create', 'social.export'],
  };
}

const team = (name, shieldPath = null) => ({
  participantId: `p-${name}`, name, shortName: name.slice(0, 12), shieldPath,
});

const SNAPSHOTS = {
  next_fixture: baseSnapshot('next_fixture', {
    matches: [{
      id: 'm-1', matchNumber: 1, scheduledAt: '2026-08-09T21:00:00.000Z',
      venueName: 'Cancha 3', home: team('Deportivo Belgrano'), away: team('Atlético Sur'),
      result: null,
    }],
  }),
  round_results: baseSnapshot('round_results', {
    matches: [{
      id: 'm-1', matchNumber: 1, home: team('Deportivo Belgrano'), away: team('Atlético Sur'),
      result: { homeScore: 3, awayScore: 1, homePenalties: null, awayPenalties: null },
    }],
  }),
  standings: baseSnapshot('standings', {
    revision: { id: 'rev-9', number: 9 },
    rows: [
      { position: 1, teamName: 'Deportivo Belgrano', points: 18, goalDifference: 9, played: 6 },
      { position: 2, teamName: 'Atlético Sur', points: 15, goalDifference: 4, played: 6 },
    ],
  }),
  scorers: baseSnapshot('scorers', {
    revisionId: 'rev-9',
    players: [{ rosterPlayerId: 'rp-1', name: 'Lucía Fernández', goals: 9, assists: 3 }],
  }),
  discipline: baseSnapshot('discipline', {
    revisionId: 'rev-9',
    players: [{
      rosterPlayerId: 'rp-2', name: 'Martín Paz', yellowCards: 4, directReds: 1,
      fairPlayPoints: 7, suspensions: [{ remainingMatches: 2 }],
    }],
  }),
  best_eleven: baseSnapshot('best_eleven', {
    requiresHumanSelection: true,
    candidates: Array.from({ length: 14 }, (_unused, index) => ({
      rosterPlayerId: `rp-${index}`, name: `Jugadora ${index}`, goals: index, assists: 1,
    })),
  }),
  mvp: baseSnapshot('mvp', {
    requiresHumanSelection: true,
    candidates: [{
      rosterPlayerId: 'rp-1', name: 'Lucía Fernández', goals: 9, assists: 3, appearances: 6,
    }],
  }),
  round_summary: baseSnapshot('round_summary', {
    matches: [{
      id: 'm-1', matchNumber: 1, home: team('Deportivo Belgrano'), away: team('Atlético Sur'),
      result: { homeScore: 3, awayScore: 1 },
    }],
    leaders: [{ rosterPlayerId: 'rp-1', name: 'Lucía Fernández', goals: 3 }],
    topOfTable: { position: 1, teamName: 'Deportivo Belgrano', points: 18 },
  }),
  semifinals: baseSnapshot('semifinals', {
    matches: [
      {
        id: 'm-1', matchNumber: 1, home: team('Deportivo Belgrano'), away: team('Atlético Sur'),
        result: { homeScore: 2, awayScore: 2, homePenalties: 4, awayPenalties: 3 },
      },
      {
        id: 'm-2', matchNumber: 2, home: team('Racing Norte'), away: team('Unión Este'),
        result: { homeScore: 1, awayScore: 0 },
      },
    ],
  }),
  final: baseSnapshot('final', {
    matches: [{
      id: 'm-9', matchNumber: 9, home: team('Deportivo Belgrano'), away: team('Racing Norte'),
      result: { homeScore: 2, awayScore: 1 },
    }],
  }),
  champion: baseSnapshot('champion', {
    requiresHumanSelection: true,
    officialChampion: {
      participantId: 'p-1', teamName: 'Deportivo Belgrano', shieldPath: 'org/belgrano.png',
    },
    candidates: [{
      participantId: 'p-1', teamName: 'Deportivo Belgrano', points: 24,
      shieldPath: 'org/belgrano.png',
    }],
  }),
};

function editorialFor(pieceId, overrides = {}) {
  const snapshot = SNAPSHOTS[pieceId];
  const piece = findSocialPiece(pieceId);
  const selection = piece.requiresHumanSelection
    ? (snapshot.official.candidates || [])
      .slice(0, selectionSizeForSnapshot(snapshot))
      .map((candidate) => candidate.rosterPlayerId || candidate.participantId)
    : [];
  return createEditorialState(snapshot, { selection, ...overrides });
}

async function renderToLog(pieceId, overrides = {}) {
  const log = [];
  await renderSocialPiece({
    snapshot: SNAPSHOTS[pieceId],
    editorial: editorialFor(pieceId, overrides),
    organizationId: ORGANIZATION,
    createCanvas: fakeCanvasFactory(log),
    skipFonts: true,
  });
  return log;
}

describe('social snapshot contracts', () => {
  test('every registered piece has a template and a snapshot fixture', () => {
    for (const piece of SOCIAL_PIECES) {
      expect(getSocialTemplate(piece.id)).toBeInstanceOf(Function);
      expect(SNAPSHOTS[piece.id]).toBeTruthy();
    }
    expect(SOCIAL_PIECES).toHaveLength(11);
  });

  test('accepts a well-formed snapshot for its own tenant', () => {
    expect(() => validateSocialSnapshot(SNAPSHOTS.standings, {
      organizationId: ORGANIZATION,
    })).not.toThrow();
  });

  test('rejects a snapshot from another tenant', () => {
    expect(() => validateSocialSnapshot(SNAPSHOTS.standings, {
      organizationId: '22222222-2222-4222-8222-222222222222',
    })).toThrow(/SNAPSHOT_TENANT_MISMATCH/);
  });

  test('rejects an unknown schema version rather than guessing', () => {
    expect(() => validateSocialSnapshot(
      { ...SNAPSHOTS.standings, schemaVersion: 3 }, { organizationId: ORGANIZATION },
    )).toThrow(/SNAPSHOT_VERSION_UNSUPPORTED/);
  });

  test('rejects data that is not from a published fixture', () => {
    const unpublished = {
      ...SNAPSHOTS.standings,
      source: { ...SNAPSHOTS.standings.source, fixtureVersionId: null },
    };
    expect(() => validateSocialSnapshot(unpublished, { organizationId: ORGANIZATION }))
      .toThrow(/SNAPSHOT_UNPUBLISHED/);
  });

  test('rejects an unknown piece and a malformed payload', () => {
    expect(() => validateSocialSnapshot({ ...SNAPSHOTS.standings, piece: 'memes' }, {}))
      .toThrow(/SNAPSHOT_PIECE_UNKNOWN/);
    expect(() => validateSocialSnapshot(
      { ...SNAPSHOTS.standings, official: { rows: 'nope' } }, {},
    )).toThrow(/SNAPSHOT_MALFORMED/);
    expect(() => validateSocialSnapshot(null, {})).toThrow(SocialSnapshotError);
  });

  test('refuses a curated piece whose backend forgot the curation contract', () => {
    const broken = {
      ...SNAPSHOTS.mvp,
      official: { ...SNAPSHOTS.mvp.official, requiresHumanSelection: false },
    };
    expect(() => validateSocialSnapshot(broken, {}))
      .toThrow(/SNAPSHOT_CURATION_CONTRACT_BROKEN/);
  });

  test('refuses private data anywhere in the tree', () => {
    for (const key of ['auditLog', 'notes', 'internalPath', 'checksum', 'availability']) {
      const leaked = {
        ...SNAPSHOTS.standings,
        official: {
          ...SNAPSHOTS.standings.official,
          rows: [{ ...SNAPSHOTS.standings.official.rows[0], [key]: 'secret' }],
        },
      };
      expect(() => assertNoPrivateData(leaked)).toThrow(/SNAPSHOT_PRIVATE_DATA/);
    }
    expect(() => assertNoPrivateData(SNAPSHOTS.standings)).not.toThrow();
  });
});

describe('human curation', () => {
  test('the ideal eleven is never filled in automatically', () => {
    const empty = createEditorialState(SNAPSHOTS.best_eleven);
    expect(empty.selection).toEqual([]);
    expect(describeCurationGap(SNAPSHOTS.best_eleven, empty)).toMatch(/0\/11/);
  });

  test('an MVP is required before the piece is considered complete', () => {
    expect(describeCurationGap(SNAPSHOTS.mvp, createEditorialState(SNAPSHOTS.mvp)))
      .toMatch(/figura/i);
    expect(describeCurationGap(SNAPSHOTS.mvp, editorialFor('mvp'))).toBeNull();
  });

  test('a champion must be confirmed even when the standings already show one', () => {
    const gap = describeCurationGap(SNAPSHOTS.champion, createEditorialState(SNAPSHOTS.champion));
    expect(gap).toMatch(/Confirmá/);
  });

  test('non-curated pieces have no gap', () => {
    for (const piece of ['standings', 'scorers', 'discipline', 'round_results']) {
      expect(describeCurationGap(SNAPSHOTS[piece], createEditorialState(SNAPSHOTS[piece])))
        .toBeNull();
    }
  });

  test('rendering refuses rather than inventing a selection', async () => {
    await expect(renderSocialPiece({
      snapshot: SNAPSHOTS.best_eleven,
      editorial: createEditorialState(SNAPSHOTS.best_eleven),
      organizationId: ORGANIZATION,
      createCanvas: fakeCanvasFactory([]),
      skipFonts: true,
    })).rejects.toMatchObject({ code: 'CURATION_REQUIRED' });
  });
});

describe('deterministic renderer', () => {
  test('renders every piece in both aspect ratios', async () => {
    for (const piece of SOCIAL_PIECES) {
      for (const format of ['portrait', 'story']) {
        // eslint-disable-next-line no-await-in-loop
        const log = await renderToLog(piece.id, { format });
        expect(log.length).toBeGreaterThan(20);
        expect(log.some((entry) => entry.startsWith('fillText('))).toBe(true);
      }
    }
  });

  test('produces exactly the contracted dimensions', async () => {
    for (const [id, format] of Object.entries(SOCIAL_FORMATS)) {
      // eslint-disable-next-line no-await-in-loop
      const { canvas } = await renderSocialPiece({
        snapshot: SNAPSHOTS.standings,
        editorial: editorialFor('standings', { format: id }),
        organizationId: ORGANIZATION,
        createCanvas: fakeCanvasFactory([]),
        skipFonts: true,
      });
      expect([canvas.width, canvas.height]).toEqual([format.width, format.height]);
    }
    expect(SOCIAL_FORMATS.portrait.height).toBe(1350);
    expect(SOCIAL_FORMATS.story.height).toBe(1920);
  });

  test('the same input yields an identical operation sequence', async () => {
    for (const piece of ['standings', 'scorers', 'final', 'best_eleven']) {
      // eslint-disable-next-line no-await-in-loop
      const first = await renderToLog(piece);
      // eslint-disable-next-line no-await-in-loop
      const second = await renderToLog(piece);
      expect(second).toEqual(first);
    }
  });

  test('Base ignores legacy title and accent mutations', async () => {
    const base = await renderToLog('standings');
    const retitled = await renderToLog('standings', { title: 'Otra cosa' });
    const recoloured = await renderToLog('standings', { accent: 'cyan' });
    expect(retitled).toEqual(base);
    expect(recoloured).toEqual(base);
  });

  test('the approved Base lockup cannot be hidden by the legacy toggle', async () => {
    const withMark = await renderToLog('standings', { showArma2Logo: true });
    const without = await renderToLog('standings', { showArma2Logo: false });
    expect(without).toEqual(withMark);
  });

  test('long names and special characters are fitted, never overflowed', () => {
    const longName = 'Club Atlético Deportivo Unión de los Trabajadores del Sur Ñandú';
    const context = recordingContext([]);
    const fitted = fitLines(context, longName, { size: 48, maxW: 280, maxLines: 2 });
    expect(fitted.lines.length).toBeLessThanOrEqual(2);
    expect(fitted.lines.join(' ')).toContain('Club Atlético');
  });

  test('a crestless team gets a monogram instead of a hole', async () => {
    const log = await renderToLog('standings');
    expect(initialsOf('Deportivo Belgrano')).toBe('DB');
    expect(log.some((entry) => entry.startsWith('fillText('))).toBe(true);
    expect(log.some((entry) => entry.startsWith('drawImage('))).toBe(false);
  });

  test('an empty official payload renders an explicit empty state', async () => {
    const snapshot = { ...SNAPSHOTS.standings, official: { rows: [] } };
    const log = [];
    await renderSocialPiece({
      snapshot,
      editorial: createEditorialState(snapshot),
      organizationId: ORGANIZATION,
      createCanvas: fakeCanvasFactory(log),
      skipFonts: true,
    });
    expect(log.some((entry) => entry.startsWith('fillText('))).toBe(true);
    expect(log.length).toBeGreaterThan(20);
  });

  test('a very long table is truncated with a count, not squeezed illegibly', async () => {
    const rows = Array.from({ length: 20 }, (_unused, index) => ({
      position: index + 1, teamName: `Equipo ${index + 1}`, points: 40 - index,
      goalDifference: 10 - index, played: 19,
    }));
    const snapshot = { ...SNAPSHOTS.standings, official: { rows } };
    const log = [];
    await renderSocialPiece({
      snapshot,
      editorial: createEditorialState(snapshot, { format: 'portrait' }),
      organizationId: ORGANIZATION,
      createCanvas: fakeCanvasFactory(log),
      skipFonts: true,
    });
    const sizes = log.filter((entry) => entry.startsWith('set:font='))
      .map((entry) => Number((entry.match(/(\d+)px/) || [0, 0])[1]))
      .filter(Boolean);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
    const truncation = log.find((entry) => /fillText\(\+\d+ más/.test(entry));
    if (truncation) expect(truncation).toMatch(/\+\d+ más/);
  });

  test('a template is never asked to draw a piece it does not own', () => {
    expect(getSocialTemplate('does_not_exist')).toBeNull();
    expect(() => drawSocialPiece(recordingContext([]), {
      snapshot: { ...SNAPSHOTS.standings, piece: 'does_not_exist' },
      editorial: createEditorialState(SNAPSHOTS.standings),
      assets: { shields: {} },
      format: SOCIAL_FORMATS.portrait,
    })).toThrow(SocialRenderError);
  });
});

describe('private assets', () => {
  test('a chosen photo is fetched through the signer and never left as a URL', async () => {
    const signMediaReadUrls = jest.fn().mockResolvedValue({
      'asset-1:detail': 'https://signed.local/asset-1?token=secret-token',
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, blob: async () => new Blob([new Uint8Array(4)], { type: 'image/png' }),
    });
    global.createImageBitmap = jest.fn().mockResolvedValue({
      width: 800, height: 600, close: jest.fn(),
    });

    const log = [];
    await renderSocialPiece({
      snapshot: SNAPSHOTS.mvp,
      editorial: editorialFor('mvp', { photoAssetId: 'asset-1' }),
      organizationId: ORGANIZATION,
      signMediaReadUrls,
      createCanvas: fakeCanvasFactory(log),
      skipFonts: true,
    });

    expect(signMediaReadUrls).toHaveBeenCalledWith(
      [{ assetId: 'asset-1', kind: 'detail' }], expect.anything(),
    );
    expect(log.some((entry) => entry.startsWith('drawImage('))).toBe(true);
    // The signature must not survive anywhere in what was drawn.
    expect(log.join('|')).not.toMatch(/secret-token|signed\.local/);
  });

  test('a photo the signer refuses fails the render instead of dropping it silently', async () => {
    const signMediaReadUrls = jest.fn().mockResolvedValue({});
    await expect(renderSocialPiece({
      snapshot: SNAPSHOTS.mvp,
      editorial: editorialFor('mvp', { photoAssetId: 'asset-revoked' }),
      organizationId: ORGANIZATION,
      signMediaReadUrls,
      createCanvas: fakeCanvasFactory([]),
      skipFonts: true,
    })).rejects.toMatchObject({ code: 'ASSET_PHOTO_FORBIDDEN' });
  });

  test('a piece without photos works when Multimedia is unavailable', async () => {
    await expect(renderToLog('standings')).resolves.toBeInstanceOf(Array);
  });

  test('a photo cannot be requested at all when Multimedia is unavailable', async () => {
    await expect(renderSocialPiece({
      snapshot: SNAPSHOTS.mvp,
      editorial: editorialFor('mvp', { photoAssetId: 'asset-1' }),
      organizationId: ORGANIZATION,
      createCanvas: fakeCanvasFactory([]),
      skipFonts: true,
    })).rejects.toMatchObject({ code: 'ASSET_PHOTO_UNAVAILABLE' });
  });
});

describe('export and share', () => {
  test('exports a PNG with a sanitised, descriptive filename', async () => {
    const result = await exportSocialPiece({
      snapshot: SNAPSHOTS.standings,
      editorial: editorialFor('standings'),
      organizationId: ORGANIZATION,
      createCanvas: fakeCanvasFactory([]),
      skipFonts: true,
    });
    expect(result.blob.type).toBe('image/png');
    expect(result.fileName).toBe('copa-horizonte-primera-fecha-6-tabla-de-posiciones-portrait.png');
    expect(result.fileName).not.toMatch(/[^a-z0-9.-]/);
  });

  test('the filename survives accents, slashes and absurd lengths', () => {
    const snapshot = {
      ...SNAPSHOTS.standings,
      competition: {
        tournamentName: '../../etc/passwd Ñandú',
        categoryName: 'A'.repeat(200),
        roundName: '',
      },
    };
    const name = socialFileName(snapshot, { format: 'story' });
    expect(name).toMatch(/^[a-z0-9-]+\.png$/);
    expect(name).not.toContain('..');
    expect(name.length).toBeLessThanOrEqual(94);
  });

  test('shares a file when the browser really supports it', async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    global.navigator.share = share;
    global.navigator.canShare = jest.fn(() => true);
    const outcome = await shareSocialPiece({
      blob: new Blob(['png'], { type: 'image/png' }), fileName: 'a.png', title: 'Tabla',
    });
    expect(outcome).toEqual({ shared: true, downloaded: false });
    expect(share).toHaveBeenCalled();
  });

  test('falls back to a download when file sharing is not supported', async () => {
    global.navigator.share = jest.fn();
    global.navigator.canShare = jest.fn(() => false);
    global.URL.createObjectURL = jest.fn(() => 'blob:x');
    global.URL.revokeObjectURL = jest.fn();
    const outcome = await shareSocialPiece({
      blob: new Blob(['png'], { type: 'image/png' }), fileName: 'a.png', title: 'Tabla',
    });
    expect(outcome).toEqual({ shared: false, downloaded: true });
    expect(global.URL.createObjectURL).toHaveBeenCalled();
  });

  test('a cancelled share sheet is not an error and does not download', async () => {
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    global.navigator.share = jest.fn().mockRejectedValue(abort);
    global.navigator.canShare = jest.fn(() => true);
    global.URL.createObjectURL = jest.fn(() => 'blob:x');
    const outcome = await shareSocialPiece({
      blob: new Blob(['png'], { type: 'image/png' }), fileName: 'a.png', title: 'Tabla',
    });
    expect(outcome).toEqual({ shared: false, downloaded: false });
    expect(global.URL.createObjectURL).not.toHaveBeenCalled();
  });

  test('a failing share sheet still gets the user their file', async () => {
    global.navigator.share = jest.fn().mockRejectedValue(new Error('nope'));
    global.navigator.canShare = jest.fn(() => true);
    global.URL.createObjectURL = jest.fn(() => 'blob:x');
    global.URL.revokeObjectURL = jest.fn();
    const outcome = await shareSocialPiece({
      blob: new Blob(['png'], { type: 'image/png' }), fileName: 'a.png', title: 'Tabla',
    });
    expect(outcome).toEqual({ shared: false, downloaded: true });
  });
});

describe('performance characteristics', () => {
  test('a twenty-team table with long names renders in bounded work', async () => {
    const rows = Array.from({ length: 20 }, (_unused, index) => ({
      position: index + 1,
      teamName: `Club Atlético Deportivo Número ${index + 1} de la Ribera Sur`,
      points: 40 - index, goalDifference: 12 - index, played: 19,
    }));
    const snapshot = { ...SNAPSHOTS.standings, official: { rows } };
    const log = [];
    const started = Date.now();
    await renderSocialPiece({
      snapshot,
      editorial: createEditorialState(snapshot),
      organizationId: ORGANIZATION,
      createCanvas: fakeCanvasFactory(log),
      skipFonts: true,
    });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(log.length).toBeLessThan(6000);
  });

  test('repeated generation does not grow the work per render', async () => {
    const lengths = [];
    for (let index = 0; index < 5; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      lengths.push((await renderToLog('scorers')).length);
    }
    expect(new Set(lengths).size).toBe(1);
  });

  test('bitmaps are closed after a render that allocated them', async () => {
    const close = jest.fn();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, blob: async () => new Blob([new Uint8Array(4)], { type: 'image/png' }),
    });
    global.createImageBitmap = jest.fn().mockResolvedValue({ width: 40, height: 40, close });
    const { releaseSocialAssets, resolveSocialAssets } = await import(
      '../features/torneos/social/socialStudio'
    );
    const assets = await resolveSocialAssets(
      SNAPSHOTS.champion,
      editorialFor('champion'),
      { resolveShieldUrl: () => 'https://crest.local/a.png' },
    );
    releaseSocialAssets(assets);
    expect(close).toHaveBeenCalled();
  });
});
