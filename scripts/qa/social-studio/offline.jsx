// Offline fixture of the Estudio Social exactly as the hybrid composition mounts it with SOCIAL-V1 on: the real
// TorneosShell, the real page, renderers, fonts (src/styles.css) and export pipeline. Only the backend is emulated,
// including the database rules of authorize_tournament_social_export (00000000000008), so a page that asked for
// something the database refuses fails here too. No network besides this server and the Google Fonts faces.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../../src/styles.css';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TorneosShell from '../../../src/features/torneos/components/TorneosShell';
import { TorneosWorkspaceProvider } from '../../../src/features/torneos/context/TorneosWorkspaceContext';
import { TorneosFeaturesProvider } from '../../../src/features/torneos/context/TorneosFeaturesContext';
import { stagingV1FeaturesFor } from '../../../src/features/torneos/stagingV1/stagingV1Features';
import { tournamentEntitlementsFixture } from '../../../src/testUtils/tournamentEntitlementsFixture';
import { socialQaSnapshot, socialQaStandings } from '../../../src/testUtils/socialStudioSnapshots';

const args = new URLSearchParams(window.location.search);
const plan = args.get('plan') || 'free';
const social = args.get('social') !== 'off';
const role = args.get('role') || 'owner';
const teamSize = Number(args.get('teamSize') || 5);
const standingsRows = Number(args.get('rows') || 8);
// Sparse and crowded pieces (the anchoring checks): matches of a round, scorers, discipline rows and semifinals.
const counts = {
  ...(args.get('matches') ? { matchCount: Number(args.get('matches')) } : {}),
  ...(args.get('scorers') ? { scorerCount: Number(args.get('scorers')) } : {}),
  ...(args.get('discipline') ? { disciplineCount: Number(args.get('discipline')) } : {}),
  ...(args.get('semis') ? { semifinalCount: Number(args.get('semis')) } : {}),
};
const org = { id: '10000000-0000-4000-8000-000000000001', name: 'Liga Devoto', slug: 'liga-devoto', role, capabilities: ['organization.read', 'workspace.access', 'workspace.manage'] };
const season = { id: '20000000-0000-4000-8000-000000000001', name: 'Temporada 2026' };
const tournament = { id: '30000000-0000-4000-8000-000000000001', seasonId: season.id, organizationId: org.id, name: 'Copa Horizonte 2026' };
const ids = {
  categoryId: '40000000-0000-4000-8000-000000000001',
  phaseId: '50000000-0000-4000-8000-000000000001',
  roundId: '60000000-0000-4000-8000-000000000001',
};
const FREE_PIECES = ['round_results', 'standings', 'next_fixture'];
const THEMES = ['base', 'heritage', 'street', 'scoreboard', 'editorial'];
const PIECES = ['round_results', 'next_fixture', 'standings', 'mvp', 'final', 'champion', 'scorers', 'discipline', 'best_eleven', 'round_summary', 'semifinals'];
const premium = plan === 'premium';
const record = (window.__social = { authorize: [], snapshots: [], refusals: [] });
// The official order of the table rows, for the multi-page checks.
window.__socialTeamNames = (count) => socialQaStandings(count).map((row) => row.teamName);
const refuse = (code) => { record.refusals.push(code); const error = new Error(code); error.code = code; throw error; };
// Transitions (D1): the browser gate slows answers down or fails one, to open the windows a slow network opens. Nothing
// is held or failed unless a check asks for it.
const control = (window.__socialControl = { snapshotDelayMs: 0, authorizeDelayMs: 0, failSnapshot: [], failAuthorize: 0 });
const pause = (ms) => (ms > 0 ? new Promise((resolve) => { setTimeout(resolve, ms); }) : Promise.resolve());

const service = {
  loadContext: async () => ({ organizations: [org], preference: { activeOrganizationId: org.id } }),
  loadCompetitionContext: async () => ({ seasons: [season], tournaments: [tournament], preference: { activeSeasonId: season.id, activeTournamentId: tournament.id } }),
  setTournamentContext: async () => ({}),
  createIdempotencyKey: () => 'offline',
  loadSeasonEntitlements: async ({ seasonId }) => {
    if (plan === 'loading') return new Promise(() => {});
    return tournamentEntitlementsFixture({ seasonId, tournamentId: null, plan: premium ? 'PREMIUM' : 'FREE' });
  },
  ...(social ? {
    loadSocialStudioContext: async () => ({
      capabilities: role === 'collaborator' ? ['social.read'] : ['social.read', 'social.create', 'social.export', 'social.manual_selection', 'social.editorial_text', 'social.brand_toggle'],
      brand: { organizationName: org.name, canHideArma2Logo: role !== 'collaborator' },
      tournaments: args.get('tournaments') === '0' ? [] : [{
        id: tournament.id, name: tournament.name, status: 'in_progress',
        categories: args.get('fixture') === 'none' ? [] : [{
          id: ids.categoryId, name: 'Primera División', phases: [{
            id: ids.phaseId, name: 'Fase regular', kind: 'league', fixtureVersionId: 'fixture-version-1',
            rounds: [{ id: ids.roundId, name: 'Fecha 9', number: 9 }],
          }],
        }],
      }],
      commercialUnit: 'season',
      freeBaseFamilies: FREE_PIECES,
    }),
    loadSocialSnapshot: async ({ piece }) => {
      record.snapshots.push(piece);
      await pause(control.snapshotDelayMs);
      if (control.failSnapshot.includes(piece)) {
        control.failSnapshot = control.failSnapshot.filter((entry) => entry !== piece);
        throw new Error('No pudimos preparar esta pieza con datos oficiales.');
      }
      // The last answer stays readable: the layout checks locate each official row on the rendered piece.
      record.lastSnapshot = socialQaSnapshot(piece, { organizationId: org.id, tournamentId: tournament.id, ...ids, teamSize, standingsRows, ...counts });
      return record.lastSnapshot;
    },
    // The rules of 00000000000008, in the same order: access, then NULL/unknown inputs, then the plan.
    authorizeSocialExport: async ({ organizationId, tournamentId, piece, theme, includeArma2Branding }) => {
      record.authorize.push({ piece, theme, includeArma2Branding });
      await pause(control.authorizeDelayMs);
      if (control.failAuthorize > 0) {
        control.failAuthorize -= 1;
        const error = new Error('Torneos no está disponible en este momento. Volvé a intentar en unos minutos.');
        error.code = 'TORNEOS_UNAVAILABLE';
        throw error;
      }
      if (role === 'collaborator' || organizationId !== org.id || tournamentId !== tournament.id) refuse('TORNEOS_SOCIAL_EXPORT_FORBIDDEN');
      if (!THEMES.includes(theme)) refuse('TORNEOS_SOCIAL_THEME_UNKNOWN');
      if (!PIECES.includes(piece)) refuse('TORNEOS_SOCIAL_PIECE_UNKNOWN');
      if (typeof includeArma2Branding !== 'boolean') refuse('TORNEOS_SOCIAL_BRANDING_INVALID');
      if (!premium && (theme !== 'base' || !FREE_PIECES.includes(piece))) refuse('TORNEOS_SOCIAL_PREMIUM_REQUIRED');
      if (!premium && theme === 'base' && !includeArma2Branding) refuse('TORNEOS_BRANDING_PREMIUM_REQUIRED');
      return {
        authorized: true, organizationId, seasonId: season.id, tournamentId, piece, theme,
        plan: premium ? 'PREMIUM' : 'FREE', capability: 'social_studio.premium',
        includeArma2Branding: theme === 'base' ? (premium ? includeArma2Branding : true) : false,
      };
    },
  } : {}),
};

const features = stagingV1FeaturesFor('off', { planRead: true, social });
createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={[`/torneos/organizacion/${org.id}/${args.get('path') || 'estudio-social'}`]}>
    <TorneosFeaturesProvider features={features}>
      <TorneosWorkspaceProvider service={service}>
        <Routes><Route path="/torneos/*" element={<TorneosShell />} /></Routes>
      </TorneosWorkspaceProvider>
    </TorneosFeaturesProvider>
  </MemoryRouter>,
);
