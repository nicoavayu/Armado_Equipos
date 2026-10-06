// SOCIAL-V1 — the Estudio Social page as Production will mount it: FREE vs PREMIUM, locks, the Arma2 signature,
// the server authorization before every file, Editorial multi-page export and human copy. jsdom has no Canvas, so
// the render/export pipeline is replaced by recorders (the real one is exercised in a browser by
// scripts/qa/social-studio/browser-check.cjs); everything else is the real page.
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import SocialStudioPage, {
  assertSocialExportAuthorization,
  describeSocialExportError,
} from '../features/torneos/components/SocialStudioPage';
import { normalizeTournamentEntitlements, TOURNAMENT_PLANS } from '../features/torneos/domain/entitlements';
import { tournamentEntitlementsFixture } from '../testUtils/tournamentEntitlementsFixture';
import { socialQaSnapshot } from '../testUtils/socialStudioSnapshots';
import { TournamentWorkspaceError } from '../features/torneos/api/tournamentWorkspaceErrors';
import { socialFileName } from '../features/torneos/social/socialContracts';
import { resolveEditorialStandingsPagination } from '../features/torneos/social/premium/premiumPagination';
import * as studio from '../features/torneos/social/socialStudio';

const ORG = '10000000-0000-4000-8000-000000000001';
const SEASON = '20000000-0000-4000-8000-000000000001';
const OTHER_SEASON = '20000000-0000-4000-8000-000000000002';
const TOURNAMENT = '30000000-0000-4000-8000-000000000001';
const OTHER_ORG = '10000000-0000-4000-8000-000000000002';
const OTHER_TOURNAMENT = '30000000-0000-4000-8000-000000000002';
const CATEGORY = '40000000-0000-4000-8000-000000000001';
const PHASE = '50000000-0000-4000-8000-000000000001';
const ROUND = '60000000-0000-4000-8000-000000000001';

let mockWorkspace;
let mockCompetition;
jest.mock('../features/torneos/context/TorneosWorkspaceContext', () => ({
  useTorneosWorkspace: () => mockWorkspace,
}));
jest.mock('../features/torneos/context/TorneosCompetitionContext', () => ({
  useTorneosCompetition: () => mockCompetition,
  useOptionalTorneosCompetition: () => mockCompetition,
}));
jest.mock('../features/torneos/social/socialStudio', () => {
  const actual = jest.requireActual('../features/torneos/social/socialStudio');
  return {
    ...actual,
    prepareSocialRender: jest.fn(),
    exportSocialPiece: jest.fn(),
    downloadSocialPieces: jest.fn(),
    shareSocialPieces: jest.fn(),
  };
});

function planState(plan, seasonId = SEASON) {
  return {
    status: 'ready',
    error: '',
    data: normalizeTournamentEntitlements(
      tournamentEntitlementsFixture({ seasonId, tournamentId: null, plan }),
      { organizationId: ORG, seasonId },
    ),
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.hash}`}</div>;
}

function setup({
  plan = TOURNAMENT_PLANS.FREE,
  plan_state = null,
  capabilities = ['social.read', 'social.create', 'social.export', 'social.manual_selection', 'social.editorial_text'],
  tournaments = [{
    id: TOURNAMENT, name: 'Apertura', categories: [{
      id: CATEGORY, name: 'Primera', phases: [{ id: PHASE, name: 'Fase regular', rounds: [{ id: ROUND, name: 'Fecha 9' }] }],
    }],
  }],
  snapshotOptions = {},
  authorize = null,
} = {}) {
  const service = {
    loadSocialStudioContext: jest.fn().mockResolvedValue({ capabilities, tournaments, freeBaseFamilies: ['round_results', 'standings', 'next_fixture'] }),
    loadSocialSnapshot: jest.fn(async ({ piece }) => socialQaSnapshot(piece, { organizationId: ORG, ...snapshotOptions })),
    // The answer of authorize_tournament_social_export (00000000000008): it names the scope it authorized.
    authorizeSocialExport: jest.fn(authorize || (async (args) => ({
      authorized: true,
      organizationId: args.organizationId,
      seasonId: SEASON,
      tournamentId: args.tournamentId,
      piece: args.piece,
      theme: args.theme,
      includeArma2Branding: args.includeArma2Branding,
      plan,
    }))),
  };
  mockWorkspace = { service };
  mockCompetition = {
    status: 'ready',
    tournaments: [{ id: TOURNAMENT, seasonId: SEASON, name: 'Apertura' }],
    activeTournament: { id: TOURNAMENT, seasonId: SEASON },
    planState: plan_state || planState(plan),
    selectContext: jest.fn().mockResolvedValue({}),
  };
  render(
    <MemoryRouter initialEntries={[`/torneos/organizacion/${ORG}/estudio-social`]}>
      <Routes>
        <Route path="/torneos/organizacion/:organizationId/estudio-social" element={<SocialStudioPage />} />
        <Route path="/torneos/organizacion/:organizationId/temporada/:seasonId/plan" element={<LocationProbe />} />
        <Route path="/torneos/organizacion/:organizationId/mi-plan" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
  return service;
}

beforeEach(() => {
  jest.clearAllMocks();
  studio.prepareSocialRender.mockImplementation(async ({ editorial, branding, theme }) => ({
    canvas: document.createElement('canvas'),
    format: { id: editorial.format },
    renderKey: `key-${theme?.id}-${editorial.format}-${editorial.page || 1}-${branding?.showArma2Branding}`,
    branding: { showArma2Branding: branding?.showArma2Branding === true },
    theme,
  }));
  studio.exportSocialPiece.mockImplementation(async ({ prepared, snapshot, editorial }) => {
    const pagination = resolveEditorialStandingsPagination(snapshot, editorial, prepared.theme);
    const name = socialFileName(snapshot, editorial, prepared.theme?.id);
    return {
      blob: new Blob(['png'], { type: 'image/png' }),
      fileName: pagination.enabled ? name.replace(/\.png$/, `-pagina-${pagination.page}-de-${pagination.pageCount}.png`) : name,
      pieceLabel: snapshot.piece,
      pagination,
    };
  });
  studio.downloadSocialPieces.mockResolvedValue(undefined);
  studio.shareSocialPieces.mockResolvedValue({ shared: true, downloaded: false });
});

const pieceSelect = () => screen.getByRole('combobox', { name: 'Placa' });
const pieceOption = (name) => within(pieceSelect()).getAllByRole('option')
  .find((option) => option.textContent === name || option.textContent.startsWith(`${name} ·`));
const choosePiece = (name) => fireEvent.change(pieceSelect(), { target: { value: pieceOption(name).value } });
const styleButton = (name) => within(screen.getByRole('radiogroup', { name: 'Estilo' })).getByRole('radio', { name: new RegExp(`^${name}`) });
async function ready() {
  await waitFor(() => expect(studio.prepareSocialRender).toHaveBeenCalled());
  await screen.findByRole('img', { name: /Vista previa/ });
}

describe('FREE season', () => {
  test('exports the three Base pieces with the mandatory Arma2 signature, authorized before the file', async () => {
    const service = setup();
    await ready();
    for (const piece of ['Tabla de posiciones', 'Resultados de la fecha', 'Próxima fecha']) {
      choosePiece(piece);
      await waitFor(() => expect(screen.getByRole('button', { name: /Descargar PNG/ })).toBeEnabled());
      // A piece FREE can download is shown clean: no Premium veil over it.
      expect(document.querySelector('[data-premium-preview-lock]')).toBeNull();
      service.authorizeSocialExport.mockClear(); studio.downloadSocialPieces.mockClear();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Descargar PNG/ })); });
      expect(service.authorizeSocialExport).toHaveBeenCalledWith(expect.objectContaining({
        organizationId: ORG, tournamentId: TOURNAMENT, theme: 'base', includeArma2Branding: true,
      }));
      expect(studio.downloadSocialPieces).toHaveBeenCalledTimes(1);
      const [files] = studio.downloadSocialPieces.mock.calls[0];
      expect(files).toHaveLength(1);
      expect(files[0].fileName).toMatch(/-base-feed-4x5\.png$/);
      expect(service.authorizeSocialExport.mock.invocationCallOrder[0]).toBeLessThan(studio.exportSocialPiece.mock.invocationCallOrder.at(-1));
    }
    const signature = screen.getByRole('checkbox', { name: 'Mostrar la firma Arma2 en la placa' });
    expect(signature).toBeChecked();
    expect(signature).toBeDisabled();
    expect(screen.getByText(/En FREE la firma Arma2 va siempre/)).toBeInTheDocument();
  });

  test.each(['Figura', 'Equipo de la fecha', 'Goleadores', 'Sancionados', 'Resumen de fecha', 'Semifinales', 'Final', 'Campeón'])(
    '%s previews but never exports: the lock leads to Mi plan',
    async (piece) => {
      const service = setup();
      await ready();
      expect(pieceOption(piece)).toHaveTextContent(`${piece} · Premium`);
      choosePiece(piece);
      await waitFor(() => expect(service.loadSocialSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ organizationId: ORG })));
      // The teaser is visible but never clean: the Premium veil covers the art.
      await waitFor(() => expect(document.querySelector('[data-premium-preview-lock="true"]')).not.toBeNull());
      expect(screen.queryByRole('button', { name: /Descargar/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Compartir' })).not.toBeInTheDocument();
      const lock = screen.getByText(/es Premium$/).closest('[role="note"]');
      expect(lock).toHaveTextContent('La compra de Premium todavía no está disponible.');
      fireEvent.click(within(lock).getByRole('button', { name: 'Ver Premium' }));
      expect(screen.getByTestId('location')).toHaveTextContent(`/torneos/organizacion/${ORG}/temporada/${SEASON}/plan#premium`);
      expect(service.authorizeSocialExport).not.toHaveBeenCalled();
    },
  );

  test.each(['Heritage', 'Street', 'Scoreboard', 'Editorial'])('the %s style previews for real but stays locked', async (style) => {
    const service = setup();
    await ready();
    fireEvent.click(styleButton(style));
    await waitFor(() => expect(studio.prepareSocialRender).toHaveBeenLastCalledWith(expect.objectContaining({
      theme: expect.objectContaining({ id: style.toLowerCase() }),
      brandAssetUrls: null,
    })));
    await waitFor(() => expect(document.querySelector('[data-premium-preview-lock="true"]')).not.toBeNull());
    expect(screen.queryByRole('button', { name: /Descargar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Compartir' })).not.toBeInTheDocument();
    expect(screen.getByText(`El estilo ${style} es Premium`)).toBeInTheDocument();
    expect(screen.getByText(/no llevan la firma Arma2/)).toBeInTheDocument();
    expect(service.authorizeSocialExport).not.toHaveBeenCalled();
  });

  test('a plan that is loading, failed or belongs to another season never unlocks anything Premium', async () => {
    for (const state of [
      { status: 'loading', data: null, error: '' },
      { status: 'error', data: null, error: 'x' },
      planState(TOURNAMENT_PLANS.PREMIUM, OTHER_SEASON),
      { ...planState(TOURNAMENT_PLANS.PREMIUM), data: { ...planState(TOURNAMENT_PLANS.PREMIUM).data, isTrusted: false } },
    ]) {
      const { unmount } = { unmount: () => document.body.replaceChildren() };
      setup({ plan_state: state });
      await ready();
      expect(pieceOption('Figura')).toHaveTextContent('Figura · Premium');
      expect(pieceOption('Tabla de posiciones').textContent).toBe('Tabla de posiciones');
      expect(screen.getByRole('checkbox', { name: 'Mostrar la firma Arma2 en la placa' })).toBeDisabled();
      expect(screen.queryByText('PREMIUM')).not.toBeInTheDocument();
      unmount();
    }
  });

  test('a server refusal is shown in human words, keeps the preview and downloads nothing', async () => {
    const service = setup({
      authorize: async () => { throw new TournamentWorkspaceError('TORNEOS_SOCIAL_PREMIUM_REQUIRED', 'Esta placa o este estilo necesitan Premium en esta temporada.'); },
    });
    await ready();
    await waitFor(() => expect(screen.getByRole('button', { name: /Descargar PNG/ })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Descargar PNG/ })); });
    expect(service.authorizeSocialExport).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('alert')).toHaveTextContent('Esta placa o este estilo necesitan Premium en esta temporada.');
    expect(studio.exportSocialPiece).not.toHaveBeenCalled();
    expect(studio.downloadSocialPieces).not.toHaveBeenCalled();
    expect(screen.getByRole('img', { name: /Vista previa/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Descargar PNG/ })).toBeEnabled();
  });

  test('an authorization that does not describe the rendered file is refused (no file)', async () => {
    for (const answer of [
      { authorized: true, piece: 'standings', theme: 'base', includeArma2Branding: false },
      { authorized: true, piece: 'mvp', theme: 'base', includeArma2Branding: true },
      { authorized: true, piece: 'standings', theme: 'heritage', includeArma2Branding: true },
      { authorized: false, piece: 'standings', theme: 'base', includeArma2Branding: true },
      null,
    ]) {
      document.body.replaceChildren();
      setup({ authorize: async () => answer });
      await ready();
      await waitFor(() => expect(screen.getByRole('button', { name: /Descargar PNG/ })).toBeEnabled());
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Descargar PNG/ })); });
      expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos confirmar la autorización de esta placa.');
      expect(studio.downloadSocialPieces).not.toHaveBeenCalled();
    }
  });
});

describe('PREMIUM season', () => {
  test('every piece and style is available; Base signature optional, Premium styles always without it', async () => {
    const service = setup({ plan: TOURNAMENT_PLANS.PREMIUM });
    await ready();
    expect(screen.getByText('PREMIUM')).toBeInTheDocument();
    for (const piece of ['Figura', 'Equipo de la fecha', 'Campeón', 'Goleadores']) expect(pieceOption(piece).textContent).toBe(piece);
    const signature = screen.getByRole('checkbox', { name: 'Mostrar la firma Arma2 en la placa' });
    expect(signature).toBeEnabled();
    fireEvent.click(signature);
    await waitFor(() => expect(studio.prepareSocialRender).toHaveBeenLastCalledWith(expect.objectContaining({ brandAssetUrls: null })));
    await waitFor(() => expect(screen.getByRole('button', { name: /Descargar PNG/ })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Descargar PNG/ })); });
    expect(service.authorizeSocialExport).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'base', includeArma2Branding: false }));
    expect(studio.downloadSocialPieces).toHaveBeenCalledTimes(1);

    for (const style of ['Heritage', 'Street', 'Scoreboard', 'Editorial']) {
      fireEvent.click(styleButton(style));
      await waitFor(() => expect(studio.prepareSocialRender).toHaveBeenLastCalledWith(expect.objectContaining({ theme: expect.objectContaining({ id: style.toLowerCase() }) })));
      await waitFor(() => expect(screen.getByRole('button', { name: /Descargar PNG/ })).toBeEnabled());
      expect(document.querySelector('[data-premium-preview-lock]')).toBeNull();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Descargar PNG/ })); });
      expect(service.authorizeSocialExport).toHaveBeenLastCalledWith(expect.objectContaining({ theme: style.toLowerCase(), includeArma2Branding: false }));
      expect(studio.downloadSocialPieces.mock.calls.at(-1)[0][0].fileName).toMatch(new RegExp(`-${style.toLowerCase()}-feed-4x5\\.png$`));
    }
  });

  test('visiting a Premium style never changes the Base signature choice', async () => {
    const service = setup({ plan: TOURNAMENT_PLANS.PREMIUM });
    await ready();
    fireEvent.click(styleButton('Heritage'));
    await waitFor(() => expect(studio.prepareSocialRender).toHaveBeenLastCalledWith(expect.objectContaining({ theme: expect.objectContaining({ id: 'heritage' }) })));
    fireEvent.click(styleButton('Base'));
    const signature = await screen.findByRole('checkbox', { name: 'Mostrar la firma Arma2 en la placa' });
    expect(signature).toBeChecked();
    await waitFor(() => expect(studio.prepareSocialRender).toHaveBeenLastCalledWith(expect.objectContaining({
      theme: expect.objectContaining({ id: 'base' }), brandAssetUrls: expect.objectContaining({ lockup: expect.any(String) }),
    })));
    await waitFor(() => expect(screen.getByRole('button', { name: /Descargar PNG/ })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Descargar PNG/ })); });
    expect(service.authorizeSocialExport).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'base', includeArma2Branding: true }));
  });

  test('Editorial standings with 24 teams export every page, in order, with unambiguous names (download and share)', async () => {
    const service = setup({ plan: TOURNAMENT_PLANS.PREMIUM, snapshotOptions: { standingsRows: 24 } });
    await ready();
    fireEvent.click(styleButton('Editorial'));
    expect(await screen.findByText('Página 1 de 2')).toBeInTheDocument();
    const download = await screen.findByRole('button', { name: /Descargar 2 PNG/ });
    await waitFor(() => expect(download).toBeEnabled());
    await act(async () => { fireEvent.click(download); });
    expect(service.authorizeSocialExport).toHaveBeenCalledTimes(1);
    const [files] = studio.downloadSocialPieces.mock.calls[0];
    expect(files.map((file) => file.fileName)).toEqual([
      expect.stringMatching(/-editorial-feed-4x5-pagina-1-de-2\.png$/),
      expect.stringMatching(/-editorial-feed-4x5-pagina-2-de-2\.png$/),
    ]);
    expect(screen.getByRole('status', { name: '' })).toBeTruthy();
    expect(screen.getByText('Descargamos las 2 páginas de la tabla.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(await screen.findByText('Página 2 de 2')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Compartir' })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Compartir' })); });
    const [{ files: shared }] = studio.shareSocialPieces.mock.calls[0];
    expect(shared.map((file) => file.fileName.match(/pagina-\d-de-2/)[0])).toEqual(['pagina-1-de-2', 'pagina-2-de-2']);
  });
});

test('roles: a collaborator without export sees the Studio read-only and no download control', async () => {
  const service = setup({ capabilities: ['social.read'] });
  await ready();
  expect(screen.getByText('Modo lectura')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Descargar/ })).not.toBeInTheDocument();
  expect(screen.getByText('Tu rol no puede descargar placas. Pedí el permiso a un administrador.')).toBeInTheDocument();
  expect(service.authorizeSocialExport).not.toHaveBeenCalled();
});

test('empty states: no tournaments, and a tournament without a published fixture', async () => {
  setup({ tournaments: [] });
  expect(await screen.findByText('Todavía no hay torneos para generar placas')).toBeInTheDocument();
  document.body.replaceChildren();
  const service = setup({ tournaments: [{ id: TOURNAMENT, name: 'Apertura', categories: [] }] });
  expect(await screen.findByText(/todavía no tiene un fixture publicado/)).toBeInTheDocument();
  expect(service.loadSocialSnapshot).not.toHaveBeenCalled();
});

test('the page never shows internal names, codes or "familias"', async () => {
  setup();
  await ready();
  choosePiece('Figura');
  await waitFor(() => expect(screen.getByText(/es Premium$/)).toBeInTheDocument());
  expect(document.body).not.toHaveTextContent(/famili|white-label|TORNEOS_|social_studio|round_results|next_fixture|best_eleven|capabilit|theme /i);
});

test('export errors are always human copy', () => {
  expect(describeSocialExportError(new TournamentWorkspaceError('TORNEOS_BRANDING_PREMIUM_REQUIRED', 'Sólo Premium permite descargar placas sin la firma Arma2.')))
    .toBe('Sólo Premium permite descargar placas sin la firma Arma2.');
  expect(describeSocialExportError(Object.assign(new Error('THEME_ENTITLEMENT_REQUIRED: heritage/mvp'), { code: 'THEME_ENTITLEMENT_REQUIRED' })))
    .toBe('Esta placa o este estilo necesitan Premium en esta temporada.');
  expect(describeSocialExportError(new Error('PREMIUM_FONT_UNAVAILABLE: 400 96px "Anton"'))).toMatch(/tipografías/);
  expect(describeSocialExportError(new Error('boom'))).toBe('No pudimos generar el archivo. Revisá los datos y volvé a intentar.');
  expect(describeSocialExportError({ code: 'TORNEOS_X', message: 'TORNEOS_X' })).not.toMatch(/TORNEOS_/);
  expect(() => assertSocialExportAuthorization({ authorized: true, piece: 'standings', theme: 'base', includeArma2Branding: true },
    { piece: 'standings', theme: 'base', showArma2Branding: true })).not.toThrow();
  // An authorization for another organization, tournament or season does not cover this file.
  const answer = { authorized: true, organizationId: ORG, seasonId: SEASON, tournamentId: TOURNAMENT, piece: 'standings', theme: 'base', includeArma2Branding: true };
  const expected = { organizationId: ORG, tournamentId: TOURNAMENT, seasonId: SEASON, piece: 'standings', theme: 'base', showArma2Branding: true };
  expect(() => assertSocialExportAuthorization(answer, expected)).not.toThrow();
  for (const foreign of [{ organizationId: OTHER_ORG }, { tournamentId: OTHER_TOURNAMENT }, { seasonId: OTHER_SEASON }, { organizationId: undefined }, { tournamentId: undefined }]) {
    expect(() => assertSocialExportAuthorization({ ...answer, ...foreign }, expected)).toThrow('SOCIAL_AUTHORIZATION_MISMATCH');
  }
});

test('a Premium preview root is never unmounted synchronously inside a React commit', () => {
  jest.useFakeTimers();
  try {
    const { releasePremiumDomRender } = jest.requireActual('../features/torneos/social/premium/premiumDomRenderer');
    const node = document.createElement('div');
    document.body.appendChild(node);
    const root = { unmount: jest.fn() };
    releasePremiumDomRender({ node, root });
    expect(node.isConnected).toBe(false);
    expect(root.unmount).not.toHaveBeenCalled();
    jest.runOnlyPendingTimers();
    expect(root.unmount).toHaveBeenCalledTimes(1);
    expect(() => releasePremiumDomRender(null)).not.toThrow();
  } finally {
    jest.useRealTimers();
  }
});

test('the Base renderer waits for every font weight it draws (deterministic preview = export)', () => {
  const fs = jest.requireActual('fs');
  const path = jest.requireActual('path');
  const { SOCIAL_REQUIRED_FONTS } = jest.requireActual('../features/torneos/social/socialRenderer');
  const dir = path.join(process.cwd(), 'src/features/torneos/social/base');
  const source = fs.readdirSync(dir).map((file) => fs.readFileSync(path.join(dir, file), 'utf8')).join('\n');
  const headWeights = new Set(['500', ...[...source.matchAll(/fam: 'head', weight: (\d{3})/g)].map((m) => m[1]),
    ...[...source.matchAll(/weight: (\d{3})/g)].map((m) => m[1])]);
  for (const weight of headWeights) {
    expect(SOCIAL_REQUIRED_FONTS.some((descriptor) => descriptor.startsWith(`${weight} `) && descriptor.endsWith('"Oswald"'))).toBe(true);
  }
  const bodyWeights = [...source.matchAll(/fam: 'body', weight: (\d{3})/g)].map((m) => m[1]);
  for (const weight of bodyWeights) {
    expect(SOCIAL_REQUIRED_FONTS.some((descriptor) => descriptor.startsWith(`${weight} `) && descriptor.endsWith('"Inter"'))).toBe(true);
  }
  expect(SOCIAL_REQUIRED_FONTS).toContain('400 96px "Bebas Neue"');
});

test('re-choosing the format already chosen does not render the piece again', async () => {
  setup();
  await ready();
  await waitFor(() => expect(screen.getByRole('button', { name: /Descargar PNG/ })).toBeEnabled());
  const renders = studio.prepareSocialRender.mock.calls.length;
  fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Formato' })).getByRole('radio', { name: 'Feed 4:5' }));
  fireEvent.click(styleButton('Base'));
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 50); }); });
  expect(studio.prepareSocialRender.mock.calls.length).toBe(renders);
  fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Formato' })).getByRole('radio', { name: 'Historia 9:16' }));
  await waitFor(() => expect(studio.prepareSocialRender.mock.calls.length).toBe(renders + 1));
});

test('late web fonts: the preview retries instead of staying broken, and gives up with human copy', async () => {
  const fontError = () => Object.assign(new Error('SOCIAL_FONTS_UNAVAILABLE'), { code: 'SOCIAL_FONTS_UNAVAILABLE' });
  const ok = studio.prepareSocialRender.getMockImplementation();
  studio.prepareSocialRender.mockImplementationOnce(async () => { throw fontError(); });
  setup();
  await screen.findByRole('img', { name: /Vista previa/ }, { timeout: 4000 });
  expect(screen.queryByText(/tipografías/)).not.toBeInTheDocument();
  document.body.replaceChildren();
  studio.prepareSocialRender.mockImplementation(async () => { throw fontError(); });
  setup();
  expect(await screen.findByText(/No pudimos cargar las tipografías/, {}, { timeout: 6000 })).toBeInTheDocument();
  expect(studio.prepareSocialRender.mock.calls.length).toBeGreaterThanOrEqual(3);
  studio.prepareSocialRender.mockImplementation(ok);
}, 15000);
