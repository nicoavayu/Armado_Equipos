// Offline fixture of the Estudio Social exactly as the hybrid composition mounts it with SOCIAL-V1 on: the real
// TorneosShell, the real page, renderers, fonts (src/styles.css) and export pipeline. Only the backend is emulated,
// including the database rules of authorize_tournament_social_export (00000000000008), so a page that asked for
// something the database refuses fails here too. No network besides this server and the Google Fonts faces.
//
// PREMIUM SPONSORS (`sponsors=on`): the branding composition is on and the organization has four fictional sponsors
// whose logos are the designed PNGs of sponsor-logos/ (served by this harness: no network, no real brand). The emulated
// get_tournament_organization_sponsors / authorize_tournament_social_sponsors follow the rules of 0020: access first,
// then the theme (Base refuses a non-empty selection), at most three distinct active ids with a logo, and the season's
// `sponsors` entitlement (PREMIUM only). Settings can add, edit and archive them in memory.
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
import './sponsorBandMeasure';
import logoTornillo from './sponsor-logos/ferreteria-el-tornillo.png';
import logoEspiga from './sponsor-logos/panaderia-la-espiga.png';
import logoFenix from './sponsor-logos/gimnasio-fenix.png';
import logoFaro from './sponsor-logos/libreria-el-faro.png';

const args = new URLSearchParams(window.location.search);
const plan = args.get('plan') || 'free';
const social = args.get('social') !== 'off';
// `role=collaborator`: no social.export. `role=exporter`: a collaborator WITH the export grant — exports, but never with
// sponsors (0020: a non-empty selection needs organization.update) and, like every collaborator, sees no sponsor logo.
const role = args.get('role') || 'owner';
const collaboratorRole = role === 'collaborator' || role === 'exporter';
const teamSize = Number(args.get('teamSize') || 5);
const standingsRows = Number(args.get('rows') || 8);
// `items=N` keeps only N entries in every other list: the sparse pieces of a league that just started.
const listSize = args.get('items') ? Number(args.get('items')) : null;
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
const sponsorsOn = args.get('sponsors') === 'on';
const record = (window.__social = { authorize: [], snapshots: [], refusals: [], sponsorLoads: [], sponsorAuthorize: [], sponsorWrites: [] });
// The official order of the table rows, for the multi-page checks.
window.__socialTeamNames = (count) => socialQaStandings(count).map((row) => row.teamName);
const refuse = (code) => { record.refusals.push(code); const error = new Error(code); error.code = code; throw error; };
// Transitions (D1): the browser gate slows answers down or fails one, to open the windows a slow network opens. Nothing
// is held or failed unless a check asks for it.
const control = (window.__socialControl = { snapshotDelayMs: 0, authorizeDelayMs: 0, failSnapshot: [], failAuthorize: 0, failSponsorAuthorize: null });
const pause = (ms) => (ms > 0 ? new Promise((resolve) => { setTimeout(resolve, ms); }) : Promise.resolve());

// ── fictional sponsors (no real brand): designed vector logos (sponsor-logos/*.svg), rasterized to 1200 px PNGs ──────
// Realistic variety for the band: a transparent logo in dark ink (Ferretería El Tornillo), one that carries its own
// coloured field (Panadería La Espiga), a wide horizontal wordmark (Gimnasio Fénix) and a square emblem (Librería El
// Faro). `node scripts/qa/social-studio/sponsor-logos/rasterize.cjs` redraws the PNGs from their SVG sources.
// `logos=square` replaces the first one with a square 200 × 200 logo bordered on its four edges: the settings frame
// must show it whole (E2E demo D3), all four borders visible = nothing cropped.
function squareLogo() {
  const canvas = document.createElement('canvas');
  canvas.width = 200; canvas.height = 200;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#F4F1EA'; ctx.fillRect(0, 0, 200, 200);
  ctx.fillStyle = '#C2410C';
  ctx.beginPath(); ctx.moveTo(40, 20); ctx.lineTo(110, 20); ctx.lineTo(80, 64); ctx.lineTo(118, 64); ctx.lineTo(48, 122); ctx.lineTo(66, 76); ctx.lineTo(34, 76); ctx.closePath(); ctx.fill();
  ctx.font = 'bold 46px Arial, sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText('FET', 24, 168);
  ctx.strokeStyle = '#C2410C'; ctx.lineWidth = 10; ctx.strokeRect(5, 5, 190, 190);
  return canvas.toDataURL('image/png');
}
const SPONSOR_SEED = [
  { id: '70000000-0000-4000-8000-000000000001', name: 'Ferretería El Tornillo', logo: logoTornillo },
  { id: '70000000-0000-4000-8000-000000000002', name: 'Panadería La Espiga', logo: logoEspiga },
  { id: '70000000-0000-4000-8000-000000000003', name: 'Gimnasio Fénix', logo: logoFenix },
  { id: '70000000-0000-4000-8000-000000000004', name: 'Librería El Faro', logo: logoFaro },
];
const sponsorRows = sponsorsOn ? SPONSOR_SEED.map((entry, index) => ({
  id: entry.id, name: entry.name, logoPath: `${org.id}/organizations/${org.id}/7100000${index}-0000-4000-8000-000000000001.png`,
  logoUrl: index === 0 && args.get('logos') === 'square' ? squareLogo() : entry.logo, sortOrder: index, archived: false,
})) : [];
window.__sponsorNames = () => sponsorRows.filter((row) => !row.archived).map((row) => row.name);
const activeSponsors = () => sponsorRows.filter((row) => !row.archived).sort((a, b) => a.sortOrder - b.sortOrder);
// Collaborators read the list, but the gateway signs no logo for them (README: logoUrl null), and the hybrid adapter
// drops the unsigned path while keeping that the sponsor HAS a logo (hasLogo).
const listedSponsor = (row) => (collaboratorRole
  ? { id: row.id, name: row.name, logoPath: null, logoUrl: null, hasLogo: Boolean(row.logoPath), sortOrder: row.sortOrder }
  : { id: row.id, name: row.name, logoPath: row.logoPath, logoUrl: row.logoUrl, hasLogo: Boolean(row.logoPath), sortOrder: row.sortOrder });
const fileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('No pudimos leer el logo.'));
  reader.readAsDataURL(file);
});
const sponsorService = sponsorsOn ? {
  loadOrganizationSponsors: async ({ organizationId, seasonId = null }) => {
    record.sponsorLoads.push({ seasonId });
    if (organizationId !== org.id || (seasonId && seasonId !== season.id)) refuse('TORNEOS_SPONSORS_FORBIDDEN');
    return {
      schemaVersion: 1, organizationId, seasonId, canManage: !collaboratorRole, entitled: premium,
      limits: { maxActive: 20, maxPerExport: 3, nameMaxLength: 60 }, sponsors: activeSponsors().map(listedSponsor),
    };
  },
  saveOrganizationSponsor: async ({ organizationId, sponsorId = null, name, file = null, logoPath = null, sortOrder = null }) => {
    record.sponsorWrites.push({ kind: 'save', sponsorId, name });
    if (organizationId !== org.id || collaboratorRole) refuse('TORNEOS_SPONSORS_FORBIDDEN');
    if (!premium) refuse('TORNEOS_SPONSORS_PREMIUM_REQUIRED');
    const trimmed = String(name || '').trim();
    if (!trimmed || trimmed.length > 60) refuse('TORNEOS_SPONSOR_INVALID');
    const row = sponsorId ? sponsorRows.find((entry) => entry.id === sponsorId && !entry.archived) : null;
    if (sponsorId && !row) refuse('TORNEOS_SPONSOR_NOT_FOUND');
    if (!row && activeSponsors().length >= 20) refuse('TORNEOS_SPONSOR_LIMIT_REACHED');
    const next = row || { id: `70000000-0000-4000-8000-${String(sponsorRows.length + 1).padStart(12, '0')}`, archived: false, sortOrder: activeSponsors().length };
    const previousLogoPath = file && row ? row.logoPath : null;
    next.name = trimmed;
    if (file) {
      next.logoUrl = await fileAsDataUrl(file);
      next.logoPath = `${org.id}/organizations/${org.id}/7200000${sponsorRows.length}-0000-4000-8000-${String(Date.now()).slice(-12).padStart(12, '0')}.png`;
    } else if (!row) {
      next.logoPath = logoPath; next.logoUrl = null;
    }
    if (Number.isInteger(sortOrder)) next.sortOrder = sortOrder;
    if (!row) sponsorRows.push(next);
    return { sponsor: { id: next.id, name: next.name, logoPath: next.logoPath, sortOrder: next.sortOrder }, previousLogoPath };
  },
  archiveOrganizationSponsor: async ({ organizationId, sponsorId }) => {
    record.sponsorWrites.push({ kind: 'archive', sponsorId });
    if (organizationId !== org.id || collaboratorRole) refuse('TORNEOS_SPONSORS_FORBIDDEN');
    const row = sponsorRows.find((entry) => entry.id === sponsorId);
    if (!row) refuse('TORNEOS_SPONSOR_NOT_FOUND');
    const alreadyArchived = row.archived;
    const previousLogoPath = alreadyArchived ? null : row.logoPath;
    row.archived = true; row.logoPath = null;
    return { sponsorId, archived: true, alreadyArchived, previousLogoPath };
  },
  // The rules of authorize_tournament_social_sponsors (0020), in its order.
  authorizeSocialSponsors: async ({ seasonId, tournamentId, theme, sponsorIds }) => {
    record.sponsorAuthorize.push({ theme, sponsorIds });
    if (control.failSponsorAuthorize) {
      const code = control.failSponsorAuthorize;
      control.failSponsorAuthorize = null;
      const error = new Error({
        TORNEOS_SPONSORS_SELECTION_UNAVAILABLE: 'Uno de los sponsors elegidos ya no está disponible o no tiene logo. Revisá la selección.',
        TORNEOS_SPONSORS_PREMIUM_REQUIRED: 'Los sponsors son una función Premium: la temporada necesita Premium para sumarlos o usarlos en las placas.',
      }[code] || code);
      error.code = code;
      record.refusals.push(`sponsors:${code}`);
      throw error;
    }
    if (role === 'collaborator' || seasonId !== season.id || tournamentId !== tournament.id) refuse('TORNEOS_SOCIAL_EXPORT_FORBIDDEN');
    if (Array.isArray(sponsorIds) && sponsorIds.length && collaboratorRole) refuse('TORNEOS_SPONSORS_FORBIDDEN');
    if (!THEMES.includes(theme)) refuse('TORNEOS_SOCIAL_THEME_UNKNOWN');
    if (!Array.isArray(sponsorIds)) refuse('TORNEOS_SPONSORS_SELECTION_INVALID');
    if (sponsorIds.length && theme === 'base') refuse('TORNEOS_SPONSORS_THEME_UNSUPPORTED');
    if (sponsorIds.length > 3 || new Set(sponsorIds).size !== sponsorIds.length) refuse('TORNEOS_SPONSORS_SELECTION_INVALID');
    const rows = sponsorIds.map((id) => sponsorRows.find((entry) => entry.id === id && !entry.archived && entry.logoPath));
    if (rows.some((row) => !row)) refuse('TORNEOS_SPONSORS_SELECTION_UNAVAILABLE');
    if (sponsorIds.length && !premium) refuse('TORNEOS_SPONSORS_PREMIUM_REQUIRED');
    return {
      authorized: true, organizationId: org.id, seasonId, tournamentId, theme, capability: 'sponsors',
      sponsors: rows.map((row) => ({ id: row.id, name: row.name, logoPath: row.logoPath, logoUrl: row.logoUrl })),
    };
  },
} : {};

const service = {
  ...sponsorService,
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
      capabilities: role === 'collaborator' ? ['social.read']
        : role === 'exporter' ? ['social.read', 'social.create', 'social.export', 'social.manual_selection', 'social.editorial_text']
          : ['social.read', 'social.create', 'social.export', 'social.manual_selection', 'social.editorial_text', 'social.brand_toggle'],
      brand: { organizationName: org.name, canHideArma2Logo: !collaboratorRole },
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
      return socialQaSnapshot(piece, { organizationId: org.id, tournamentId: tournament.id, ...ids, teamSize, standingsRows, listSize });
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

const features = stagingV1FeaturesFor('off', { planRead: true, social, branding: sponsorsOn });
createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={[`/torneos/organizacion/${org.id}/${args.get('path') || 'estudio-social'}`]}>
    <TorneosFeaturesProvider features={features}>
      <TorneosWorkspaceProvider service={service}>
        <Routes><Route path="/torneos/*" element={<TorneosShell />} /></Routes>
      </TorneosWorkspaceProvider>
    </TorneosFeaturesProvider>
  </MemoryRouter>,
);
