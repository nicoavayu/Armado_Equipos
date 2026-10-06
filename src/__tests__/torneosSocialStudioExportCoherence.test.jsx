// D1 — the Estudio Social exports exactly what it shows. Selection, snapshot, prepared render, server authorization and
// file describe the same piece and scope (organization, tournament, category, phase, round), style, format and
// signature, whatever the order in which answers arrive and whatever the person does meanwhile.
//
// jsdom has no Canvas, so the renderer is replaced by a recorder whose "PNG" carries what it was drawn from: every
// assertion reads the delivered file's bytes, not only which functions ran. Answers are held with controlled gates
// (snapshot, render, authorization, encoding) to open the windows a slow network opens. The real renderer and real
// PNGs are covered in Chromium by scripts/qa/social-studio/browser-check.cjs (section "transitions").
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SocialStudioPage from '../features/torneos/components/SocialStudioPage';
import { normalizeTournamentEntitlements, TOURNAMENT_PLANS } from '../features/torneos/domain/entitlements';
import { tournamentEntitlementsFixture } from '../testUtils/tournamentEntitlementsFixture';
import { socialQaSnapshot } from '../testUtils/socialStudioSnapshots';
import { socialFileName } from '../features/torneos/social/socialContracts';
import * as studio from '../features/torneos/social/socialStudio';

const ORG = '10000000-0000-4000-8000-000000000001';
const SEASON = '20000000-0000-4000-8000-000000000001';
const T1 = '30000000-0000-4000-8000-000000000001';
const T2 = '30000000-0000-4000-8000-000000000002';
const CAT_A = '40000000-0000-4000-8000-00000000000a';
const CAT_B = '40000000-0000-4000-8000-00000000000b';
const CAT_C = '40000000-0000-4000-8000-00000000000c';
const PHASE_A = '50000000-0000-4000-8000-00000000000a';
const PHASE_B = '50000000-0000-4000-8000-00000000000b';
const PHASE_C = '50000000-0000-4000-8000-00000000000c';
const ROUND_1 = '60000000-0000-4000-8000-000000000001';
const ROUND_2 = '60000000-0000-4000-8000-000000000002';
const ROUND_3 = '60000000-0000-4000-8000-000000000003';
const ROUND_4 = '60000000-0000-4000-8000-000000000004';
const TOURNAMENTS = [
  {
    id: T1,
    name: 'Apertura',
    categories: [
      { id: CAT_A, name: 'Primera', phases: [{ id: PHASE_A, name: 'Fase regular', rounds: [{ id: ROUND_1, name: 'Fecha 1' }, { id: ROUND_2, name: 'Fecha 2' }] }] },
      { id: CAT_B, name: 'Reserva', phases: [{ id: PHASE_B, name: 'Liguilla', rounds: [{ id: ROUND_3, name: 'Fecha 3' }] }] },
    ],
  },
  { id: T2, name: 'Clausura', categories: [{ id: CAT_C, name: 'Libre', phases: [{ id: PHASE_C, name: 'Única', rounds: [{ id: ROUND_4, name: 'Fecha 4' }] }] }] },
];
const LAST_ROUND = { [PHASE_A]: ROUND_2, [PHASE_B]: ROUND_3, [PHASE_C]: ROUND_4 };

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

// ── controlled gates ────────────────────────────────────────────────────────────────────────────────────────────
function gate() {
  let open;
  const promise = new Promise((resolve) => { open = resolve; });
  return { promise, open };
}
// Per test: a matcher decides which call waits on which gate.
let holds;
function hold(kind, match) {
  const entry = { kind, match, gate: gate(), used: 0 };
  holds.push(entry);
  return { open: () => act(async () => { entry.gate.open(); await entry.gate.promise; }), get used() { return entry.used; } };
}
async function passThrough(kind, value) {
  const entry = holds.find((candidate) => candidate.kind === kind && candidate.match(value) && candidate.used === 0);
  if (!entry) return;
  entry.used += 1;
  await entry.gate.promise;
}
let failures;
function failOnce(kind, match, error) {
  failures.push({ kind, match, error, used: false });
}
function takeFailure(kind, value) {
  const entry = failures.find((candidate) => candidate.kind === kind && !candidate.used && candidate.match(value));
  if (!entry) return null;
  entry.used = true;
  return entry.error;
}

// What a render was drawn from: this string travels inside the exported "PNG".
function contentOf({ snapshot, editorial, theme, branding }) {
  const { source } = snapshot;
  return [snapshot.piece, source.tournamentId, source.categoryId, source.phaseId, source.roundId, theme?.id,
    editorial.format, branding?.showArma2Branding ? 'firma' : 'sin-firma'].join('|');
}
const expectedContent = ({ piece, tournamentId = T1, categoryId = CAT_A, phaseId = PHASE_A, roundId = LAST_ROUND[phaseId], theme = 'base', format = 'portrait', firma = true }) => (
  [piece, tournamentId, categoryId, phaseId, roundId, theme, format, firma ? 'firma' : 'sin-firma'].join('|')
);

function planState(plan) {
  return {
    status: 'ready',
    error: '',
    data: normalizeTournamentEntitlements(tournamentEntitlementsFixture({ seasonId: SEASON, tournamentId: null, plan }), { organizationId: ORG, seasonId: SEASON }),
  };
}

function setup({ plan = TOURNAMENT_PLANS.FREE } = {}) {
  const service = {
    loadSocialStudioContext: jest.fn().mockResolvedValue({
      capabilities: ['social.read', 'social.create', 'social.export', 'social.manual_selection', 'social.editorial_text'],
      tournaments: TOURNAMENTS,
      freeBaseFamilies: ['round_results', 'standings', 'next_fixture'],
    }),
    // The server echoes the scope it answered (get_tournament_social_snapshot: source.*).
    loadSocialSnapshot: jest.fn(async (request) => {
      await passThrough('snapshot', request);
      const failure = takeFailure('snapshot', request);
      if (failure) throw failure;
      return socialQaSnapshot(request.piece, {
        organizationId: request.organizationId,
        tournamentId: request.tournamentId,
        categoryId: request.categoryId,
        phaseId: request.phaseId,
        roundId: request.roundId || LAST_ROUND[request.phaseId],
      });
    }),
    // The answer of authorize_tournament_social_export (00000000000008): the scope it authorized.
    authorizeSocialExport: jest.fn(async (request) => {
      await passThrough('authorize', request);
      const failure = takeFailure('authorize', request);
      if (failure) throw failure;
      return {
        authorized: true,
        organizationId: request.organizationId,
        seasonId: SEASON,
        tournamentId: request.tournamentId,
        piece: request.piece,
        theme: request.theme,
        includeArma2Branding: request.includeArma2Branding,
        plan,
      };
    }),
  };
  mockWorkspace = { service };
  mockCompetition = {
    status: 'ready',
    tournaments: [{ id: T1, seasonId: SEASON, name: 'Apertura' }, { id: T2, seasonId: SEASON, name: 'Clausura' }],
    activeTournament: { id: T1, seasonId: SEASON },
    planState: planState(plan),
    // Choosing a tournament makes it the active one (TorneosCompetitionContext.selectContext).
    selectContext: jest.fn((seasonId, tournamentId) => {
      mockCompetition.activeTournament = { id: tournamentId, seasonId };
      return Promise.resolve({});
    }),
  };
  render(
    <MemoryRouter initialEntries={[`/torneos/organizacion/${ORG}/estudio-social`]}>
      <Routes>
        <Route path="/torneos/organizacion/:organizationId/estudio-social" element={<SocialStudioPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return service;
}

let rendersMade;
beforeEach(() => {
  jest.clearAllMocks();
  holds = [];
  failures = [];
  rendersMade = [];
  studio.prepareSocialRender.mockImplementation(async (options) => {
    const content = contentOf(options);
    await passThrough('render', content);
    const failure = takeFailure('render', content);
    if (failure) throw failure;
    const canvas = document.createElement('canvas');
    canvas.dataset.content = content;
    // A bitmap the page must not release while an export still encodes this render.
    const photo = { closed: false, close() { this.closed = true; } };
    const prepared = {
      canvas,
      format: { id: options.editorial.format },
      renderKey: `key|${content}|${JSON.stringify(options.editorial)}`,
      branding: { showArma2Branding: options.branding?.showArma2Branding === true },
      theme: options.theme,
      assets: { photo },
      content,
    };
    rendersMade.push(prepared);
    return prepared;
  });
  studio.exportSocialPiece.mockImplementation(async ({ prepared, snapshot, editorial }) => {
    await passThrough('encode', prepared.content);
    // Encoding a released render is what produces a broken file in a browser.
    if (prepared.assets.photo.closed) throw new Error(`USED_AFTER_RELEASE ${prepared.content}`);
    return {
      blob: new Blob([`PNG ${prepared.content}`], { type: 'image/png' }),
      fileName: socialFileName(snapshot, editorial, prepared.theme?.id),
      pieceLabel: snapshot.piece,
      pagination: { enabled: false },
    };
  });
  studio.downloadSocialPieces.mockResolvedValue(undefined);
  studio.shareSocialPieces.mockResolvedValue({ shared: true, downloaded: false });
});

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────
const pieceSelect = () => screen.getByRole('combobox', { name: 'Placa' });
const pieceOption = (name) => within(pieceSelect()).getAllByRole('option')
  .find((option) => option.textContent === name || option.textContent.startsWith(`${name} ·`));
const choosePiece = (name) => fireEvent.change(pieceSelect(), { target: { value: pieceOption(name).value } });
const styleButton = (name) => within(screen.getByRole('radiogroup', { name: 'Estilo' })).getByRole('radio', { name: new RegExp(`^${name}`) });
const formatButton = (name) => within(screen.getByRole('radiogroup', { name: 'Formato' })).getByRole('radio', { name });
const downloadButton = () => screen.queryByRole('button', { name: /^Descargar/ });
const shareButton = () => screen.queryByRole('button', { name: /^Compartir$/ });
const onScreen = () => screen.queryByRole('img', { name: /Vista previa/ })?.dataset.content || null;
const reactProps = (element) => element[Object.keys(element).find((key) => key.startsWith('__reactProps$'))];

function readBlob(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}
// Every file the page handed to the browser (download or share sheet), in order, with its bytes.
async function delivered() {
  const files = [
    ...studio.downloadSocialPieces.mock.calls.flatMap(([list]) => list),
    ...studio.shareSocialPieces.mock.calls.flatMap(([{ files: list }]) => list),
  ];
  return Promise.all(files.map(async (file) => ({ name: file.fileName, content: await readBlob(file.blob) })));
}

async function shown(content, { exportable = true } = {}) {
  await waitFor(() => expect(onScreen()).toBe(content));
  if (exportable) await waitFor(() => expect(downloadButton()).toBeEnabled());
}
async function exportWith(button) {
  await act(async () => { fireEvent.click(button()); });
  await waitFor(() => expect(downloadButton()).toBeEnabled());
}

// Nothing can start an export: not the buttons, and not their handler called directly (any other way in).
async function expectNoExportPossible(service) {
  const authorizations = service.authorizeSocialExport.mock.calls.length;
  const encodings = studio.exportSocialPiece.mock.calls.length;
  for (const button of [downloadButton(), shareButton()]) {
    if (!button) continue;
    expect(button).toBeDisabled();
    await act(async () => { fireEvent.click(button); });
    await act(async () => { await reactProps(button).onClick?.(); });
  }
  expect(service.authorizeSocialExport).toHaveBeenCalledTimes(authorizations);
  expect(studio.exportSocialPiece).toHaveBeenCalledTimes(encodings);
}

const STANDINGS = expectedContent({ piece: 'standings' });
const NEXT = expectedContent({ piece: 'next_fixture' });
const RESULTS = expectedContent({ piece: 'round_results' });
const SCORERS = expectedContent({ piece: 'scorers' });

// ── FREE → FREE ─────────────────────────────────────────────────────────────────────────────────────────────────
test('FREE → FREE: while Resultados is on its way nothing can be exported; then the file is Resultados', async () => {
  const service = setup();
  await shown(STANDINGS);
  const results = hold('snapshot', (request) => request.piece === 'round_results');
  choosePiece('Resultados de la fecha');
  await waitFor(() => expect(results.used).toBe(1));
  expect(onScreen()).not.toBe(STANDINGS);
  await expectNoExportPossible(service);

  await results.open();
  await shown(RESULTS);
  await exportWith(downloadButton);
  expect(await delivered()).toEqual([{ name: expect.stringMatching(/-resultados-de-la-fecha-base-feed-4x5\.png$/), content: `PNG ${RESULTS}` }]);
  expect(service.authorizeSocialExport.mock.calls.map(([request]) => request)).toEqual([{
    organizationId: ORG, tournamentId: T1, piece: 'round_results', theme: 'base', includeArma2Branding: true,
  }]);
});

// ── Premium locked → FREE ───────────────────────────────────────────────────────────────────────────────────────
test('Premium locked → FREE: the Goleadores render (Premium) is never exported as Próxima fecha (share)', async () => {
  const service = setup();
  await shown(STANDINGS);
  choosePiece('Goleadores');
  await shown(SCORERS, { exportable: false });
  expect(downloadButton()).not.toBeInTheDocument();
  const next = hold('snapshot', (request) => request.piece === 'next_fixture');
  choosePiece('Próxima fecha');
  await waitFor(() => expect(next.used).toBe(1));
  await expectNoExportPossible(service);

  await next.open();
  await shown(NEXT);
  await exportWith(shareButton);
  const files = await delivered();
  expect(files).toEqual([{ name: expect.stringMatching(/-proxima-fecha-base-feed-4x5\.png$/), content: `PNG ${NEXT}` }]);
  expect(files.some((file) => file.content.includes('scorers'))).toBe(false);
  expect(service.authorizeSocialExport).toHaveBeenCalledTimes(1);
  expect(service.authorizeSocialExport).toHaveBeenCalledWith(expect.objectContaining({ piece: 'next_fixture', theme: 'base', includeArma2Branding: true }));
});

// ── rapid changes and answers out of order ──────────────────────────────────────────────────────────────────────
test('rapid piece changes with answers out of order: only the last selection is rendered and exported', async () => {
  const service = setup();
  await shown(STANDINGS);
  const scorers = hold('snapshot', (request) => request.piece === 'scorers');
  const discipline = hold('snapshot', (request) => request.piece === 'discipline');
  const next = hold('snapshot', (request) => request.piece === 'next_fixture');
  choosePiece('Goleadores');
  choosePiece('Sancionados');
  choosePiece('Próxima fecha');
  await waitFor(() => expect(next.used).toBe(1));
  await expectNoExportPossible(service);

  await next.open();
  await shown(NEXT);
  // The earlier answers arrive late: they never replace what is on screen.
  await scorers.open();
  await discipline.open();
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 20); }); });
  expect(onScreen()).toBe(NEXT);
  expect(rendersMade.some((prepared) => /^(scorers|discipline)\|/.test(prepared.content))).toBe(false);
  await exportWith(downloadButton);
  expect((await delivered()).map((file) => file.content)).toEqual([`PNG ${NEXT}`]);
  expect(service.authorizeSocialExport.mock.calls.map(([request]) => request.piece)).toEqual(['next_fixture']);
});

test('a render that finishes late never replaces a newer one (format 9:16 then back to 4:5)', async () => {
  const service = setup();
  await shown(STANDINGS);
  const story = hold('render', (content) => content === expectedContent({ piece: 'standings', format: 'story' }));
  fireEvent.click(formatButton('Historia 9:16'));
  await waitFor(() => expect(story.used).toBe(1));
  await expectNoExportPossible(service);
  fireEvent.click(formatButton('Feed 4:5'));
  await shown(STANDINGS);
  await story.open();
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 20); }); });
  expect(onScreen()).toBe(STANDINGS);
  await exportWith(downloadButton);
  expect((await delivered()).map((file) => file.content)).toEqual([`PNG ${STANDINGS}`]);
});

// ── scope: category, phase, round, tournament ───────────────────────────────────────────────────────────────────
test('changing category, round and tournament: the file and its authorization follow the scope on screen', async () => {
  const service = setup();
  await shown(STANDINGS);

  const reserve = hold('snapshot', (request) => request.categoryId === CAT_B);
  fireEvent.change(screen.getByRole('combobox', { name: 'Categoría' }), { target: { value: CAT_B } });
  // A category without a chosen phase asks for nothing; choosing its phase does.
  fireEvent.change(screen.getByRole('combobox', { name: 'Fase' }), { target: { value: PHASE_B } });
  await waitFor(() => expect(reserve.used).toBe(1));
  await expectNoExportPossible(service);
  await reserve.open();
  const reserveStandings = expectedContent({ piece: 'standings', categoryId: CAT_B, phaseId: PHASE_B });
  await shown(reserveStandings);
  await exportWith(downloadButton);

  // Round: Resultados asks for a round; switching it while the answer travels exports nothing in between.
  fireEvent.change(screen.getByRole('combobox', { name: 'Categoría' }), { target: { value: CAT_A } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Fase' }), { target: { value: PHASE_A } });
  choosePiece('Resultados de la fecha');
  fireEvent.change(await screen.findByRole('combobox', { name: 'Fecha' }), { target: { value: ROUND_2 } });
  await shown(expectedContent({ piece: 'round_results', roundId: ROUND_2 }));
  const round1 = hold('snapshot', (request) => request.roundId === ROUND_1);
  fireEvent.change(screen.getByRole('combobox', { name: 'Fecha' }), { target: { value: ROUND_1 } });
  await waitFor(() => expect(round1.used).toBe(1));
  await expectNoExportPossible(service);
  await round1.open();
  const round1Results = expectedContent({ piece: 'round_results', roundId: ROUND_1 });
  await shown(round1Results);
  await exportWith(downloadButton);

  // Tournament.
  const clausura = hold('snapshot', (request) => request.tournamentId === T2);
  fireEvent.change(screen.getByRole('combobox', { name: 'Torneo' }), { target: { value: T2 } });
  await waitFor(() => expect(clausura.used).toBe(1));
  await expectNoExportPossible(service);
  await clausura.open();
  const clausuraResults = expectedContent({ piece: 'round_results', tournamentId: T2, categoryId: CAT_C, phaseId: PHASE_C, roundId: ROUND_4 });
  await shown(clausuraResults);
  await exportWith(downloadButton);

  expect((await delivered()).map((file) => file.content)).toEqual([`PNG ${reserveStandings}`, `PNG ${round1Results}`, `PNG ${clausuraResults}`]);
  expect(service.authorizeSocialExport.mock.calls.map(([request]) => `${request.tournamentId}/${request.piece}`))
    .toEqual([`${T1}/standings`, `${T1}/round_results`, `${T2}/round_results`]);
});

// ── style, format and signature (PREMIUM) ───────────────────────────────────────────────────────────────────────
test('PREMIUM: style, format and signature changes never export the previous render', async () => {
  const service = setup({ plan: TOURNAMENT_PLANS.PREMIUM });
  await shown(STANDINGS);

  const street = expectedContent({ piece: 'standings', theme: 'street', firma: false });
  const streetRender = hold('render', (content) => content === street);
  fireEvent.click(styleButton('Street'));
  await waitFor(() => expect(streetRender.used).toBe(1));
  await expectNoExportPossible(service);
  await streetRender.open();
  await shown(street);
  await exportWith(downloadButton);

  const streetStory = expectedContent({ piece: 'standings', theme: 'street', format: 'story', firma: false });
  const storyRender = hold('render', (content) => content === streetStory);
  fireEvent.click(formatButton('Historia 9:16'));
  await waitFor(() => expect(storyRender.used).toBe(1));
  await expectNoExportPossible(service);
  await storyRender.open();
  await shown(streetStory);
  await exportWith(shareButton);

  fireEvent.click(styleButton('Base'));
  const signed = expectedContent({ piece: 'standings', format: 'story' });
  await shown(signed);
  const unsigned = expectedContent({ piece: 'standings', format: 'story', firma: false });
  const unsignedRender = hold('render', (content) => content === unsigned);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar la firma Arma2 en la placa' }));
  await waitFor(() => expect(unsignedRender.used).toBe(1));
  await expectNoExportPossible(service);
  await unsignedRender.open();
  await shown(unsigned);
  await exportWith(downloadButton);

  // delivered() lists the downloads first, then the share sheets.
  expect((await delivered()).map((file) => file.content)).toEqual([`PNG ${street}`, `PNG ${unsigned}`, `PNG ${streetStory}`]);
  expect(service.authorizeSocialExport.mock.calls.map(([request]) => `${request.theme}/${request.includeArma2Branding}`))
    .toEqual(['street/false', 'street/false', 'base/false']);
});

// ── the selection changes while the export is in flight ─────────────────────────────────────────────────────────
test('selection changed during a pending authorization: no file, a clear message, and the next export is right', async () => {
  const service = setup();
  await shown(STANDINGS);
  const authorization = hold('authorize', (request) => request.piece === 'standings');
  await act(async () => { fireEvent.click(downloadButton()); });
  await waitFor(() => expect(authorization.used).toBe(1));
  const standingsRender = rendersMade.find((prepared) => prepared.content === STANDINGS);

  choosePiece('Próxima fecha');
  await shown(NEXT, { exportable: false });
  // The render the pending export uses is still alive.
  expect(standingsRender.assets.photo.closed).toBe(false);
  await authorization.open();
  expect(await screen.findByRole('alert')).toHaveTextContent('La vista previa cambió mientras preparábamos el archivo. Volvé a intentar.');
  expect(studio.exportSocialPiece).not.toHaveBeenCalled();
  expect(await delivered()).toEqual([]);
  // Released once nobody uses it.
  expect(standingsRender.assets.photo.closed).toBe(true);

  await waitFor(() => expect(downloadButton()).toBeEnabled());
  await exportWith(downloadButton);
  expect((await delivered()).map((file) => file.content)).toEqual([`PNG ${NEXT}`]);
  expect(service.authorizeSocialExport.mock.calls.map(([request]) => request.piece)).toEqual(['standings', 'next_fixture']);
});

test('selection changed while the PNG is encoded: the render in use is not released under the encoder, and no stale file is delivered', async () => {
  setup({ plan: TOURNAMENT_PLANS.PREMIUM });
  await shown(STANDINGS);
  const encoding = hold('encode', (content) => content === STANDINGS);
  await act(async () => { fireEvent.click(shareButton()); });
  await waitFor(() => expect(encoding.used).toBe(1));
  const standingsRender = rendersMade.find((prepared) => prepared.content === STANDINGS);

  fireEvent.click(styleButton('Heritage'));
  await shown(expectedContent({ piece: 'standings', theme: 'heritage', firma: false }), { exportable: false });
  expect(standingsRender.assets.photo.closed).toBe(false);
  await encoding.open();
  expect(await screen.findByRole('alert')).toHaveTextContent('La vista previa cambió mientras preparábamos el archivo.');
  expect(await delivered()).toEqual([]);
  expect(standingsRender.assets.photo.closed).toBe(true);
});

// ── failures and recovery ───────────────────────────────────────────────────────────────────────────────────────
test('snapshot failure: a clear error, nothing exportable; Actualizar recovers and exports the right piece', async () => {
  const service = setup();
  await shown(STANDINGS);
  failOnce('snapshot', (request) => request.piece === 'next_fixture', new Error('No pudimos preparar esta pieza con datos oficiales.'));
  choosePiece('Próxima fecha');
  expect(await screen.findByText('No pudimos preparar esta pieza con datos oficiales.')).toBeInTheDocument();
  expect(onScreen()).toBe(null);
  await expectNoExportPossible(service);
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar datos oficiales' }));
  await shown(NEXT);
  expect(screen.queryByText('No pudimos preparar esta pieza con datos oficiales.')).not.toBeInTheDocument();
  await exportWith(downloadButton);
  expect((await delivered()).map((file) => file.content)).toEqual([`PNG ${NEXT}`]);
});

test('an answer for another scope is refused: never rendered, never exported', async () => {
  const service = setup();
  await shown(STANDINGS);
  service.loadSocialSnapshot.mockImplementationOnce(async (request) => socialQaSnapshot('scorers', {
    organizationId: request.organizationId, tournamentId: request.tournamentId, categoryId: request.categoryId, phaseId: request.phaseId, roundId: ROUND_2,
  }));
  choosePiece('Próxima fecha');
  expect(await screen.findByText(/No pudimos preparar esta pieza con los datos de esta selección/)).toBeInTheDocument();
  expect(rendersMade.some((prepared) => prepared.content.startsWith('scorers|'))).toBe(false);
  await expectNoExportPossible(service);
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar datos oficiales' }));
  await shown(NEXT);
});

test('render failure: the preview says so, nothing is exportable; a new render recovers', async () => {
  const service = setup();
  await shown(STANDINGS);
  failOnce('render', (content) => content === NEXT, new Error('boom'));
  choosePiece('Próxima fecha');
  expect(await screen.findByText('No pudimos generar la vista previa con estos datos.')).toBeInTheDocument();
  await expectNoExportPossible(service);
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar datos oficiales' }));
  await shown(NEXT);
  await exportWith(downloadButton);
  expect((await delivered()).map((file) => file.content)).toEqual([`PNG ${NEXT}`]);
});

test('authorization failure: human copy, the preview stays, and retrying exports the same piece', async () => {
  const service = setup();
  await shown(STANDINGS);
  failOnce('authorize', () => true, Object.assign(new Error('Torneos no está disponible en este momento. Volvé a intentar en unos minutos.'), { code: 'TORNEOS_UNAVAILABLE' }));
  await act(async () => { fireEvent.click(downloadButton()); });
  expect(await screen.findByRole('alert')).toHaveTextContent('Torneos no está disponible en este momento. Volvé a intentar en unos minutos.');
  expect(onScreen()).toBe(STANDINGS);
  expect(await delivered()).toEqual([]);
  await waitFor(() => expect(downloadButton()).toBeEnabled());
  await exportWith(downloadButton);
  expect((await delivered()).map((file) => file.content)).toEqual([`PNG ${STANDINGS}`]);
  expect(service.authorizeSocialExport).toHaveBeenCalledTimes(2);
});
