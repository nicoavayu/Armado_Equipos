// D3 — the format is the person's choice. Choosing Historia 9:16 and then Resultados de la fecha, or refreshing the
// official data, keeps 9:16: in the controls, in the preview, in the authorized export and in the file. jsdom has no
// Canvas, so the renderer is a recorder whose "PNG" carries the format it was drawn in; the real 1080×1920 PNG is
// certified in Chromium by scripts/qa/social-studio/browser-check.cjs.
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
const TOURNAMENT = '30000000-0000-4000-8000-000000000001';
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

function setup() {
  const service = {
    loadSocialStudioContext: jest.fn().mockResolvedValue({
      capabilities: ['social.read', 'social.create', 'social.export', 'social.manual_selection', 'social.editorial_text'],
      tournaments: [{ id: TOURNAMENT, name: 'Apertura', categories: [{ id: CATEGORY, name: 'Primera', phases: [{ id: PHASE, name: 'Fase regular', rounds: [{ id: ROUND, name: 'Fecha 9' }] }] }] }],
      freeBaseFamilies: ['round_results', 'standings', 'next_fixture'],
    }),
    loadSocialSnapshot: jest.fn(async ({ piece }) => socialQaSnapshot(piece, { organizationId: ORG })),
    authorizeSocialExport: jest.fn(async (request) => ({
      authorized: true, organizationId: request.organizationId, seasonId: SEASON, tournamentId: request.tournamentId,
      piece: request.piece, theme: request.theme, includeArma2Branding: request.includeArma2Branding, plan: 'FREE',
    })),
  };
  mockWorkspace = { service };
  mockCompetition = {
    status: 'ready',
    tournaments: [{ id: TOURNAMENT, seasonId: SEASON, name: 'Apertura' }],
    activeTournament: { id: TOURNAMENT, seasonId: SEASON },
    planState: {
      status: 'ready',
      error: '',
      data: normalizeTournamentEntitlements(tournamentEntitlementsFixture({ seasonId: SEASON, tournamentId: null, plan: TOURNAMENT_PLANS.FREE }), { organizationId: ORG, seasonId: SEASON }),
    },
    selectContext: jest.fn().mockResolvedValue({}),
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

beforeEach(() => {
  jest.clearAllMocks();
  studio.prepareSocialRender.mockImplementation(async ({ snapshot, editorial, theme, branding }) => {
    const canvas = document.createElement('canvas');
    canvas.dataset.content = `${snapshot.piece}|${editorial.format}`;
    return {
      canvas,
      format: { id: editorial.format },
      renderKey: `key|${snapshot.piece}|${editorial.format}|${branding?.showArma2Branding}`,
      branding: { showArma2Branding: branding?.showArma2Branding === true },
      theme,
      content: `${snapshot.piece}|${editorial.format}`,
    };
  });
  studio.exportSocialPiece.mockImplementation(async ({ prepared, snapshot, editorial }) => ({
    blob: new Blob([`PNG ${prepared.content}`], { type: 'image/png' }),
    fileName: socialFileName(snapshot, editorial, prepared.theme?.id),
    pieceLabel: snapshot.piece,
    pagination: { enabled: false },
  }));
  studio.downloadSocialPieces.mockResolvedValue(undefined);
  studio.shareSocialPieces.mockResolvedValue({ shared: true, downloaded: false });
});

const pieceButton = (name) => within(screen.getByRole('radiogroup', { name: 'Plantilla' })).getByRole('radio', { name: new RegExp(`^${name}`) });
const formatButton = (name) => within(screen.getByRole('radiogroup', { name: 'Formato' })).getByRole('radio', { name });
const onScreen = () => screen.queryByRole('img', { name: /Vista previa/ })?.dataset.content || null;
const download = () => screen.getByRole('button', { name: /^Descargar PNG$/ });

function readBlob(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(blob);
  });
}
async function exportFile() {
  const before = studio.downloadSocialPieces.mock.calls.length;
  await waitFor(() => expect(download()).toBeEnabled());
  await act(async () => { fireEvent.click(download()); });
  await waitFor(() => expect(studio.downloadSocialPieces.mock.calls.length).toBe(before + 1));
  const [file] = studio.downloadSocialPieces.mock.calls.at(-1)[0];
  return { name: file.fileName, content: await readBlob(file.blob) };
}
const settle = () => act(async () => { await new Promise((resolve) => { setTimeout(resolve, 20); }); });

test('Historia 9:16 chosen, then Resultados de la fecha: the preview and the file stay 9:16', async () => {
  setup();
  await waitFor(() => expect(onScreen()).toBe('standings|portrait'));
  fireEvent.click(formatButton('Historia 9:16'));
  await waitFor(() => expect(onScreen()).toBe('standings|story'));
  fireEvent.click(pieceButton('Resultados de la fecha'));
  await waitFor(() => expect(studio.prepareSocialRender).toHaveBeenLastCalledWith(expect.objectContaining({
    snapshot: expect.objectContaining({ piece: 'round_results' }),
  })));
  await settle();
  expect(onScreen()).toBe('round_results|story');
  expect(formatButton('Historia 9:16')).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByText('1080 × 1920')).toBeInTheDocument();
  expect(await exportFile()).toEqual({ name: expect.stringMatching(/-resultados-de-la-fecha-base-historia-9x16\.png$/), content: 'PNG round_results|story' });
});

test('Actualizar on Resultados keeps the chosen format (9:16 and 4:5)', async () => {
  const service = setup();
  await waitFor(() => expect(onScreen()).toBe('standings|portrait'));
  fireEvent.click(pieceButton('Resultados de la fecha'));
  await waitFor(() => expect(onScreen()).toBe('round_results|portrait'));
  fireEvent.click(formatButton('Historia 9:16'));
  await waitFor(() => expect(onScreen()).toBe('round_results|story'));
  const loads = service.loadSocialSnapshot.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar datos oficiales' }));
  await waitFor(() => expect(service.loadSocialSnapshot.mock.calls.length).toBe(loads + 1));
  await settle();
  expect(onScreen()).toBe('round_results|story');
  expect(formatButton('Historia 9:16')).toHaveAttribute('aria-checked', 'true');
  expect((await exportFile()).content).toBe('PNG round_results|story');

  fireEvent.click(formatButton('Feed 4:5'));
  await waitFor(() => expect(onScreen()).toBe('round_results|portrait'));
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar datos oficiales' }));
  await waitFor(() => expect(service.loadSocialSnapshot.mock.calls.length).toBe(loads + 2));
  await settle();
  expect(onScreen()).toBe('round_results|portrait');
  expect((await exportFile()).content).toBe('PNG round_results|portrait');
});
