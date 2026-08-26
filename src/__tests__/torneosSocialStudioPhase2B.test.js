import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createEditorialState } from '../features/torneos/social/socialContracts';
import { adaptSnapshotToResultsContent } from '../features/torneos/social/resultsContent';
import {
  createSocialAssetPlan,
  prepareSocialRender,
  releasePreparedSocialRender,
} from '../features/torneos/social/socialStudio';
import {
  CLASSIC_SOCIAL_THEME,
  EDITORIAL_SOCIAL_THEME,
  STREET_SOCIAL_THEME,
} from '../features/torneos/social/socialThemes';

const ORGANIZATION = '11111111-1111-4111-8111-111111111111';
const OFFICIAL_LOCKUP_SHA256 = '38270f747580b404f8e994ef55d9bfbc1217796d0441d50daa416470482cc250';

const snapshot = {
  schemaVersion: 1,
  piece: 'round_results',
  generatedAt: '2026-08-14T12:00:00.000Z',
  source: {
    organizationId: ORGANIZATION,
    tournamentId: 't-1', categoryId: 'c-1', phaseId: 'p-1', roundId: 'r-7',
    fixtureVersionId: 'f-1',
  },
  competition: {
    organizationName: 'Asociación Metropolitana de Fútbol Amateur del Río de la Plata',
    tournamentName: 'Torneo Apertura', categoryName: 'Primera', phaseName: 'Fase regular',
    roundName: 'Fecha 7', roundNumber: 7, timezone: 'America/Argentina/Buenos_Aires',
  },
  official: {
    matches: [{
      id: 'm-1', status: 'played',
      home: { participantId: 'home', name: 'Los Pibes del Parque Central y Biblioteca Popular', shieldPath: null },
      away: { participantId: 'away', name: 'Social y Deportivo Constitución', shieldPath: null },
      result: { homeScore: 3, awayScore: 2, homePenalties: null, awayPenalties: null },
    }],
  },
  capabilities: ['social.read', 'social.create', 'social.export'],
};

function recordingCanvas(log) {
  const state = { font: '', fillStyle: '', textAlign: '', letterSpacing: '' };
  const record = (name) => (...args) => log.push(`${name}(${args.map(String).join(',')})`);
  const ctx = new Proxy({
    measureText: (text) => {
      const size = Number((state.font.match(/(\d+)px/) || [0, 16])[1]);
      return { width: String(text).length * size * 0.52 };
    },
    createRadialGradient: () => ({ addColorStop: record('gradient.stop') }),
    createLinearGradient: () => ({ addColorStop: record('gradient.stop') }),
    save: record('save'), restore: record('restore'), beginPath: record('beginPath'),
    closePath: record('closePath'), moveTo: record('moveTo'), lineTo: record('lineTo'),
    translate: record('translate'), rotate: record('rotate'), scale: record('scale'),
    quadraticCurveTo: record('quadraticCurveTo'), arc: record('arc'), fill: record('fill'),
    stroke: record('stroke'), clip: record('clip'), fillRect: record('fillRect'),
    strokeRect: record('strokeRect'), setLineDash: record('setLineDash'),
    fillText: record('fillText'), drawImage: record('drawImage'),
  }, {
    get(target, key) { return key in target ? target[key] : state[key]; },
    set(_target, key, value) { state[key] = value; return true; },
  });
  return {
    width: 1080, height: 1350, setAttribute: jest.fn(), getContext: () => ctx,
    toBlob: (callback) => callback(new Blob(['png'], { type: 'image/png' })),
  };
}

describe('Social Studio Phase 2B art direction', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
    delete global.createImageBitmap;
  });

  test('ships the approved lockup byte-for-byte and plans it as one asset', () => {
    const bytes = readFileSync(resolve(process.cwd(), 'public/assets/social-studio/Logo Arma2_torneo.png'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(OFFICIAL_LOCKUP_SHA256);

    const editorial = createEditorialState(snapshot);
    const content = adaptSnapshotToResultsContent(snapshot, editorial);
    const plan = createSocialAssetPlan(snapshot, editorial, content, {
      brandAssetUrls: { lockup: '/assets/social-studio/Logo%20Arma2_torneo.png' },
    });
    expect(plan.branding).toEqual({
      tournamentLogoUrl: null,
      officialLockupUrl: '/assets/social-studio/Logo%20Arma2_torneo.png',
    });
    expect(plan.branding).not.toHaveProperty('arma2LogoUrl');
    expect(plan.branding).not.toHaveProperty('torneosLogoUrl');
  });

  test('all three art directions render the same ResultsContent through the shared contract', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, blob: async () => new Blob(['official-lockup'], { type: 'image/png' }),
    });
    global.createImageBitmap = jest.fn().mockResolvedValue({
      width: 1536, height: 1024, close: jest.fn(),
    });
    const editorial = createEditorialState(snapshot);
    const prepared = [];
    const logs = [];
    for (const theme of [CLASSIC_SOCIAL_THEME, STREET_SOCIAL_THEME, EDITORIAL_SOCIAL_THEME]) {
      const log = [];
      logs.push(log);
      prepared.push(await prepareSocialRender({
        snapshot,
        editorial,
        organizationId: ORGANIZATION,
        theme,
        brandAssetUrls: { lockup: '/assets/social-studio/Logo%20Arma2_torneo.png' },
        createCanvas: () => recordingCanvas(log),
        skipFonts: true,
      }));
    }
    expect(prepared[1].content).toEqual(prepared[0].content);
    expect(prepared[2].content).toEqual(prepared[0].content);
    expect(prepared[0].content).not.toHaveProperty('theme');
    logs.forEach((log) => {
      expect(log.filter((entry) => entry.startsWith('drawImage('))).toHaveLength(1);
      expect(log.join('\n')).not.toMatch(/NaN|Infinity|undefined/);
    });
    prepared.forEach(releasePreparedSocialRender);
  });

  test('Street is poster-led and Editorial removes table UI language', async () => {
    const render = async (theme) => {
      const log = [];
      await prepareSocialRender({
        snapshot, editorial: createEditorialState(snapshot), organizationId: ORGANIZATION,
        theme, createCanvas: () => recordingCanvas(log), skipFonts: true,
      });
      return log.join('\n');
    };
    const street = await render(STREET_SOCIAL_THEME);
    const editorial = await render(EDITORIAL_SOCIAL_THEME);
    expect(street).toContain('fillText(Resultados');
    expect(street).toContain('fillText(:');
    expect(street).toContain('arc(744');
    expect(street).not.toMatch(/fillText\([^\n]*…/);
    expect(editorial).toContain('fillText(EDICIÓN DEPORTIVA');
    expect(editorial.match(/fillText\(Fecha 7,/g)).toHaveLength(1);
    expect(editorial).toContain('fillText(Fase regular');
    expect(editorial).not.toMatch(/fillText\([^\n]*…/);
    expect(editorial).not.toMatch(/fillText\((PARTIDO|MARCADOR|0[1-9]),/);
  });
});
