// PREMIUM SPONSORS in the Estudio Social page. The selector «Sponsors (hasta 3)» exists only where everything agrees:
// the branding composition offers the aliases, the season's trusted plan and the server say the season has sponsors,
// and the style draws them (never Base). FREE asks nothing and renders exactly as before. Before a file exists the
// server authorizes the piece's sponsors and the file carries only the list it answered.
//
// jsdom has no Canvas: the renderer is a recorder, as in torneosSocialStudioExportCoherence.test.jsx; the real render is
// covered by torneosSocialSponsorsRender.test.js and in Chromium by scripts/qa/social-studio (section "sponsors").
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SocialStudioPage, { assertSocialSponsorsAuthorization } from '../features/torneos/components/SocialStudioPage';
import { TorneosFeaturesProvider } from '../features/torneos/context/TorneosFeaturesContext';
import { stagingV1FeaturesFor } from '../features/torneos/stagingV1/stagingV1Features';
import { normalizeTournamentEntitlements, TOURNAMENT_PLANS } from '../features/torneos/domain/entitlements';
import { tournamentEntitlementsFixture } from '../testUtils/tournamentEntitlementsFixture';
import { socialQaSnapshot } from '../testUtils/socialStudioSnapshots';
import { socialFileName } from '../features/torneos/social/socialContracts';
import * as studio from '../features/torneos/social/socialStudio';

const ORG = '10000000-0000-4000-8000-000000000001';
const SEASON = '20000000-0000-4000-8000-000000000001';
const T1 = '30000000-0000-4000-8000-000000000001';
const CAT = '40000000-0000-4000-8000-000000000001';
const PHASE = '50000000-0000-4000-8000-000000000001';
const ROUND = '60000000-0000-4000-8000-000000000001';
const logo = (n) => `${ORG}/organizations/${ORG}/7100000${n}-0000-4000-8000-000000000001.png`;
const SPONSORS = ['Ferretería El Tornillo', 'Panadería La Espiga', 'Gimnasio Fénix', 'Kiosco Doble Siete'].map((name, index) => ({
  id: `70000000-0000-4000-8000-00000000000${index + 1}`, name, logoPath: logo(index + 1), logoUrl: `blob:logo-${index + 1}`, sortOrder: index,
}));
const NO_LOGO = { id: '70000000-0000-4000-8000-000000000009', name: 'Club Sin Logo', logoPath: null, logoUrl: null, sortOrder: 9 };

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

const sponsorNamesOf = (options) => (options.sponsors || []).map((entry) => entry.name).join('+') || 'sin-sponsors';
const contentOf = (options) => `${options.snapshot.piece}|${options.theme?.id}|${sponsorNamesOf(options)}`;

function setup({
  plan = TOURNAMENT_PLANS.PREMIUM, entitled = true, features = stagingV1FeaturesFor('off', { planRead: true, social: true, branding: true }),
  sponsors = [...SPONSORS, NO_LOGO], aliases = true, authorizeAnswer = null,
} = {}) {
  const calls = { load: [], authorize: [], authorizeExport: [] };
  const list = () => ({
    organizationId: ORG, seasonId: SEASON, canManage: true, entitled,
    limits: { maxActive: 20, maxPerExport: 3, nameMaxLength: 60 }, sponsors,
  });
  const service = {
    loadSocialStudioContext: async () => ({
      capabilities: ['social.read', 'social.create', 'social.export', 'social.manual_selection', 'social.editorial_text'],
      tournaments: [{ id: T1, name: 'Copa Horizonte 2026', categories: [{ id: CAT, name: 'Primera', phases: [{ id: PHASE, name: 'Fase regular', rounds: [{ id: ROUND, name: 'Fecha 9' }] }] }] }],
      freeBaseFamilies: ['round_results', 'standings', 'next_fixture'],
    }),
    loadSocialSnapshot: async (request) => socialQaSnapshot(request.piece, {
      organizationId: ORG, tournamentId: T1, categoryId: CAT, phaseId: PHASE, roundId: request.roundId || ROUND,
    }),
    authorizeSocialExport: async (request) => {
      calls.authorizeExport.push(request);
      return { authorized: true, organizationId: ORG, seasonId: SEASON, tournamentId: T1, piece: request.piece, theme: request.theme, includeArma2Branding: request.includeArma2Branding, plan };
    },
    ...(aliases ? {
      loadOrganizationSponsors: async (input) => { calls.load.push(input); return list(); },
      authorizeSocialSponsors: async (request) => {
        calls.authorize.push(request);
        if (authorizeAnswer) return authorizeAnswer(request);
        return {
          authorized: true, organizationId: ORG, seasonId: SEASON, tournamentId: T1, theme: request.theme, capability: 'sponsors',
          sponsors: request.sponsorIds.map((id) => SPONSORS.find((entry) => entry.id === id)),
        };
      },
    } : {}),
  };
  mockWorkspace = { service };
  mockCompetition = {
    status: 'ready',
    tournaments: [{ id: T1, seasonId: SEASON, name: 'Copa Horizonte 2026' }],
    activeTournament: { id: T1, seasonId: SEASON },
    planState: {
      status: 'ready', error: '',
      data: normalizeTournamentEntitlements(tournamentEntitlementsFixture({ seasonId: SEASON, tournamentId: null, plan }), { organizationId: ORG, seasonId: SEASON }),
    },
    selectContext: async () => ({}),
  };
  render(
    <TorneosFeaturesProvider features={features}>
      <MemoryRouter initialEntries={[`/torneos/organizacion/${ORG}/estudio-social`]}>
        <Routes>
          <Route path="/torneos/organizacion/:organizationId/estudio-social" element={<SocialStudioPage />} />
        </Routes>
      </MemoryRouter>
    </TorneosFeaturesProvider>,
  );
  return calls;
}

beforeEach(() => {
  studio.prepareSocialRender.mockImplementation(async (options) => {
    const canvas = document.createElement('canvas');
    canvas.dataset.content = contentOf(options);
    return {
      canvas,
      format: { id: options.editorial.format },
      renderKey: `key|${contentOf(options)}|${JSON.stringify(options.editorial)}`,
      branding: { showArma2Branding: options.branding?.showArma2Branding === true },
      theme: options.theme,
      assets: {},
      content: contentOf(options),
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

const styleButton = (name) => within(screen.getByRole('radiogroup', { name: 'Estilo' })).getByRole('radio', { name: new RegExp(`^${name}`) });
const picker = () => screen.queryByRole('group', { name: /^Sponsors \(hasta 3\)$/ });
const onScreen = () => screen.queryByRole('img', { name: /Vista previa/ })?.dataset.content || null;
const downloadButton = () => screen.queryByRole('button', { name: /^Descargar/ });
const deliveredNames = () => studio.downloadSocialPieces.mock.calls.flatMap(([files]) => files.map((file) => file.fileName));

async function shown(content) {
  await waitFor(() => expect(onScreen()).toBe(content));
  await waitFor(() => expect(downloadButton()).toBeEnabled());
}
const choose = (name) => fireEvent.click(within(picker()).getByRole('checkbox', { name: new RegExp(name) }));

test('FREE: no sponsors request, no selector in any style, and the render inputs carry no sponsors key', async () => {
  const calls = setup({ plan: TOURNAMENT_PLANS.FREE });
  await shown('standings|base|sin-sponsors');
  for (const style of ['Heritage', 'Street', 'Scoreboard', 'Editorial']) {
    fireEvent.click(styleButton(style));
    await waitFor(() => expect(onScreen()).toBe(`standings|${style.toLowerCase()}|sin-sponsors`));
    expect(picker()).not.toBeInTheDocument();
  }
  expect(calls.load).toEqual([]);
  expect(studio.prepareSocialRender.mock.calls.every(([options]) => !Object.prototype.hasOwnProperty.call(options, 'sponsors'))).toBe(true);
});

test('PREMIUM: the selector appears only on a Premium style, lists only sponsors with a logo, and draws the chosen ones in order', async () => {
  const calls = setup();
  await shown('standings|base|sin-sponsors');
  expect(calls.load).toEqual([{ organizationId: ORG, seasonId: SEASON }]);
  expect(picker()).not.toBeInTheDocument();
  fireEvent.click(styleButton('Heritage'));
  await waitFor(() => expect(picker()).toBeInTheDocument());
  const boxes = within(picker()).getAllByRole('checkbox');
  expect(boxes).toHaveLength(4);
  expect(within(picker()).queryByText('Club Sin Logo')).not.toBeInTheDocument();
  choose('Gimnasio Fénix');
  choose('Ferretería El Tornillo');
  await shown('standings|heritage|Gimnasio Fénix+Ferretería El Tornillo');
  const last = studio.prepareSocialRender.mock.calls.at(-1)[0];
  expect(last.sponsors).toEqual([
    { id: SPONSORS[2].id, name: 'Gimnasio Fénix', logoPath: logo(3), image: 'blob:logo-3' },
    { id: SPONSORS[0].id, name: 'Ferretería El Tornillo', logoPath: logo(1), image: 'blob:logo-1' },
  ]);
});

test('at most three: the fourth cannot be chosen until one is removed', async () => {
  setup();
  await shown('standings|base|sin-sponsors');
  fireEvent.click(styleButton('Street'));
  await waitFor(() => expect(picker()).toBeInTheDocument());
  for (const name of ['Ferretería', 'Panadería', 'Gimnasio']) choose(name);
  expect(within(picker()).getByRole('checkbox', { name: /Kiosco Doble Siete/ })).toBeDisabled();
  expect(within(picker()).getByText('3 de 3 elegidos')).toBeInTheDocument();
  choose('Kiosco');
  await shown('standings|street|Ferretería El Tornillo+Panadería La Espiga+Gimnasio Fénix');
  choose('Panadería');
  expect(within(picker()).getByRole('checkbox', { name: /Kiosco Doble Siete/ })).toBeEnabled();
});

test('Base hides the selector and clears the choice', async () => {
  setup();
  await shown('standings|base|sin-sponsors');
  fireEvent.click(styleButton('Editorial'));
  await waitFor(() => expect(picker()).toBeInTheDocument());
  choose('Panadería');
  await shown('standings|editorial|Panadería La Espiga');
  fireEvent.click(styleButton('Base'));
  await shown('standings|base|sin-sponsors');
  expect(picker()).not.toBeInTheDocument();
  fireEvent.click(styleButton('Editorial'));
  await shown('standings|editorial|sin-sponsors');
  expect(within(picker()).getAllByRole('checkbox').every((box) => !box.checked)).toBe(true);
});

test('export: the piece is authorized, then its sponsors; the file is delivered only with the server list', async () => {
  const calls = setup();
  await shown('standings|base|sin-sponsors');
  fireEvent.click(styleButton('Scoreboard'));
  await waitFor(() => expect(picker()).toBeInTheDocument());
  choose('Kiosco');
  choose('Ferretería');
  await shown('standings|scoreboard|Kiosco Doble Siete+Ferretería El Tornillo');
  await act(async () => { fireEvent.click(downloadButton()); });
  await waitFor(() => expect(deliveredNames()).toHaveLength(1));
  expect(calls.authorizeExport.at(-1)).toMatchObject({ piece: 'standings', theme: 'scoreboard', includeArma2Branding: false });
  expect(calls.authorize).toEqual([{ seasonId: SEASON, tournamentId: T1, theme: 'scoreboard', sponsorIds: [SPONSORS[3].id, SPONSORS[0].id] }]);
});

test('a piece without sponsors asks no sponsors authorization', async () => {
  const calls = setup();
  await shown('standings|base|sin-sponsors');
  fireEvent.click(styleButton('Heritage'));
  await shown('standings|heritage|sin-sponsors');
  await act(async () => { fireEvent.click(downloadButton()); });
  await waitFor(() => expect(deliveredNames()).toHaveLength(1));
  expect(calls.authorize).toEqual([]);
});

test('a refused sponsors authorization shows its copy, delivers nothing and reads the list again', async () => {
  const calls = setup({
    authorizeAnswer: () => {
      throw Object.assign(new Error('Uno de los sponsors elegidos ya no está disponible o no tiene logo. Revisá la selección.'), { code: 'TORNEOS_SPONSORS_SELECTION_UNAVAILABLE' });
    },
  });
  await shown('standings|base|sin-sponsors');
  fireEvent.click(styleButton('Street'));
  await waitFor(() => expect(picker()).toBeInTheDocument());
  choose('Gimnasio');
  await shown('standings|street|Gimnasio Fénix');
  await act(async () => { fireEvent.click(downloadButton()); });
  expect(await screen.findByRole('alert')).toHaveTextContent('ya no está disponible');
  expect(deliveredNames()).toEqual([]);
  expect(studio.exportSocialPiece).not.toHaveBeenCalled();
  await waitFor(() => expect(calls.load).toHaveLength(2));
});

test('an answer that is not the list on screen (renamed, replaced logo, other order) delivers nothing', async () => {
  const calls = setup({
    authorizeAnswer: (request) => ({
      authorized: true, seasonId: SEASON, tournamentId: T1, theme: request.theme,
      sponsors: request.sponsorIds.map((id) => ({ ...SPONSORS.find((entry) => entry.id === id), logoPath: logo(8) })),
    }),
  });
  await shown('standings|base|sin-sponsors');
  fireEvent.click(styleButton('Heritage'));
  await waitFor(() => expect(picker()).toBeInTheDocument());
  choose('Ferretería');
  await shown('standings|heritage|Ferretería El Tornillo');
  await act(async () => { fireEvent.click(downloadButton()); });
  expect(await screen.findByRole('alert')).toHaveTextContent('Los sponsors cambiaron desde la vista previa');
  expect(deliveredNames()).toEqual([]);
  expect(calls.authorize).toHaveLength(1);
});

test('no selector when the server says the season has no sponsors (the plan said Premium)', async () => {
  const refused = setup({ entitled: false });
  await shown('standings|base|sin-sponsors');
  fireEvent.click(styleButton('Heritage'));
  await shown('standings|heritage|sin-sponsors');
  expect(picker()).not.toBeInTheDocument();
  expect(refused.load).toHaveLength(1);
});

test('without the branding composition the page never asks for sponsors', async () => {
  const off = setup({ features: stagingV1FeaturesFor('off', { planRead: true, social: true }) });
  await shown('standings|base|sin-sponsors');
  fireEvent.click(styleButton('Heritage'));
  await shown('standings|heritage|sin-sponsors');
  expect(picker()).not.toBeInTheDocument();
  expect(off.load).toEqual([]);
});

test('the authorization check: same sponsors, order, names and logo objects, each drawable', () => {
  const rendered = [SPONSORS[0], SPONSORS[1]].map(({ id, name, logoPath }) => ({ id, name, logoPath }));
  const ok = { authorized: true, seasonId: SEASON, tournamentId: T1, theme: 'street', sponsors: [SPONSORS[0], SPONSORS[1]] };
  const context = { seasonId: SEASON, tournamentId: T1, theme: 'street', sponsors: rendered };
  expect(assertSocialSponsorsAuthorization(ok, context)).toEqual([SPONSORS[0], SPONSORS[1]]);
  for (const bad of [
    { ...ok, authorized: false },
    { ...ok, theme: 'heritage' },
    { ...ok, tournamentId: '30000000-0000-4000-8000-000000000009' },
    { ...ok, sponsors: [SPONSORS[1], SPONSORS[0]] },
    { ...ok, sponsors: [SPONSORS[0]] },
    { ...ok, sponsors: [SPONSORS[0], { ...SPONSORS[1], logoUrl: null }] },
    { ...ok, sponsors: [SPONSORS[0], { ...SPONSORS[1], name: 'Otro' }] },
  ]) expect(() => assertSocialSponsorsAuthorization(bad, context)).toThrow('SPONSORS_AUTHORIZATION_MISMATCH');
});
