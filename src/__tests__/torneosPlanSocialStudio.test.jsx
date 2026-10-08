// SOCIAL-V1 — Mi plan presents the Estudio Social as available exactly when the navigation offers it (the
// production-eligible flag AND the composition feature), and as "Próximamente" otherwise.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PlanExperiencePage from '../features/torneos/components/PlanExperiencePage';
import { TorneosCompetitionProvider } from '../features/torneos/context/TorneosCompetitionContext';
import { TorneosFeaturesProvider } from '../features/torneos/context/TorneosFeaturesContext';
import { stagingV1FeaturesFor } from '../features/torneos/stagingV1/stagingV1Features';
import { planComparisonFor, PLAN_COMPARISON, PLAN_COMING_SOON, PLAN_BRANDING_ROW, PLAN_MEDIA_GALLERY_ROW } from '../features/torneos/domain/planComparison';
import { tournamentEntitlementsFixture } from '../testUtils/tournamentEntitlementsFixture';

let mockSocialFlag = true;
jest.mock('../features/torneos/config/featureFlags', () => {
  const actual = jest.requireActual('../features/torneos/config/featureFlags');
  return {
    ...actual,
    get torneosFeatureFlags() { return { ...actual.torneosFeatureFlags, socialContentGenerator: mockSocialFlag }; },
  };
});

// #182 alone always keeps the Galería upcoming; the empty list first appears once the Gallery's media joins Social and
// branding, so this file can force it.
let mockNothingUpcoming = false;
jest.mock('../features/torneos/domain/planComparison', () => {
  const actual = jest.requireActual('../features/torneos/domain/planComparison');
  return {
    ...actual,
    planComparisonFor: (options) => {
      const composition = actual.planComparisonFor(options);
      return mockNothingUpcoming ? { ...composition, comingSoon: [] } : composition;
    },
  };
});

const org = { id: '10000000-0000-4000-8000-000000000001', name: 'Liga Devoto' };
const season = { id: '20000000-0000-4000-8000-000000000001', name: 'Temporada 2026' };

function show({ plan = 'FREE', social = true, branding = false } = {}) {
  const service = {
    loadCompetitionContext: jest.fn().mockResolvedValue({ seasons: [season], tournaments: [], preference: { activeSeasonId: season.id } }),
    setTournamentContext: jest.fn().mockResolvedValue({}),
    loadSeasonEntitlements: jest.fn(async ({ seasonId }) => tournamentEntitlementsFixture({ seasonId, plan })),
  };
  render(
    <MemoryRouter>
      <TorneosFeaturesProvider features={stagingV1FeaturesFor('off', { planRead: true, social, branding })}>
        <TorneosCompetitionProvider organizationId={org.id} service={service}>
          <PlanExperiencePage organization={org} />
        </TorneosCompetitionProvider>
      </TorneosFeaturesProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => { mockSocialFlag = true; mockNothingUpcoming = false; });

test('available: the Studio joins FREE vs PREMIUM with the real split and leaves Próximamente', async () => {
  show();
  await screen.findByRole('heading', { name: 'FREE · Temporada 2026' });
  const comparison = screen.getByRole('region', { name: 'Qué agrega Premium' });
  const row = within(comparison).getByRole('rowheader', { name: 'Estudio Social' }).closest('tr');
  const [free, premium] = [...row.querySelectorAll('td')].map((cell) => cell.textContent);
  expect(free).toBe('Estilo Base: Resultados, Tabla de posiciones y Próxima fecha, con la firma Arma2');
  expect(premium).toBe('Todas las placas, 5 estilos y la opción de quitar la firma Arma2');
  const upcoming = screen.getByRole('region', { name: 'Próximamente' });
  expect(within(upcoming).queryByRole('region', { name: 'Estudio Social' })).not.toBeInTheDocument();
  for (const name of ['Galería de fotos', 'Logos y escudos']) expect(within(upcoming).getByRole('region', { name })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Inclusiones actuales' })).toHaveTextContent('Estudio Social: Estilo Base');
  expect(document.body).not.toHaveTextContent(/famili|social_studio|round_results|next_fixture|Comprar|checkout/i);
});

test('PREMIUM season lists the Premium side of the Studio in its inclusions', async () => {
  show({ plan: 'PREMIUM' });
  await screen.findByRole('heading', { name: 'PREMIUM · Temporada 2026' });
  expect(screen.getByRole('region', { name: 'Inclusiones actuales' }))
    .toHaveTextContent('Estudio Social: Todas las placas, 5 estilos y la opción de quitar la firma Arma2');
});

test.each([
  ['the flag is off', { social: true }, false],
  ['the composition does not serve it', { social: false }, true],
])('not available when %s: it stays in Próximamente and out of the comparison', async (_label, options, flag) => {
  mockSocialFlag = flag;
  show(options);
  await screen.findByRole('heading', { name: 'FREE · Temporada 2026' });
  expect(screen.getByRole('region', { name: 'Qué agrega Premium' })).not.toHaveTextContent('Estudio');
  expect(within(screen.getByRole('region', { name: 'Próximamente' })).getByRole('region', { name: 'Estudio Social' })).toBeInTheDocument();
});

test('planComparisonFor is all-or-nothing and never mutates the Production tables', () => {
  expect(planComparisonFor().comparison).toBe(PLAN_COMPARISON);
  expect(planComparisonFor({ socialStudio: 'true' }).comingSoon).toBe(PLAN_COMING_SOON);
  const on = planComparisonFor({ socialStudio: true });
  expect(on.comparison.map((row) => row.name)).toEqual([...PLAN_COMPARISON.map((row) => row.name), 'Estudio Social']);
  expect(on.comingSoon.map((item) => item.name)).toEqual(['Galería de fotos', 'Logos y escudos']);
  expect(PLAN_COMPARISON).toHaveLength(3);
  expect(PLAN_COMING_SOON.map((item) => item.name)).toEqual(['Estudio Social', 'Galería de fotos', 'Logos y escudos']);
});

// BRANDING-V1: with logos and shields on (the composition's `branding_assets`), Mi plan stops announcing them as
// upcoming and lists them as included in both plans (found in the integrated phase B preview, 2026-10-08).
test('planComparisonFor: each surface leaves Próximamente only when it is available, in every combination', () => {
  for (const socialStudio of [false, true]) {
    for (const media of [false, true]) {
      for (const branding of [false, true]) {
        const { comparison, comingSoon } = planComparisonFor({ socialStudio, media, branding });
        const rows = comparison.map((row) => row.name);
        const upcoming = comingSoon.map((item) => item.name);
        for (const [name, available] of [['Estudio Social', socialStudio], ['Galería de fotos', media], ['Logos y escudos', branding]]) {
          expect(rows.includes(name)).toBe(available);
          expect(upcoming.includes(name)).toBe(!available);
        }
        expect(Object.isFrozen(comparison) && Object.isFrozen(comingSoon)).toBe(true);
      }
    }
  }
  expect(planComparisonFor({ branding: 'true', media: 'true' })).toBe(planComparisonFor());
  expect(planComparisonFor().comparison).toBe(PLAN_COMPARISON);
  expect(PLAN_BRANDING_ROW).toEqual({ name: 'Logos y escudos', free: 'Incluidos', premium: 'Incluidos' });
});

// MEDIA-V1: the gallery row says exactly what the server counts per season (tournament_plan_catalog).
test('the gallery row quotes the plan catalog the server enforces', () => {
  // eslint-disable-next-line global-require
  const baseline = require('fs').readFileSync(require('path').join(__dirname, '../../backend/torneos/supabase/migrations/00000000000000_torneos_baseline_v1.sql'), 'utf8');
  const limit = (plan) => Number(new RegExp(`INSERT INTO public\\.tournament_plan_catalog \\(plan_code, gallery_asset_limit[^)]*\\) VALUES \\('${plan}', (\\d+),`).exec(baseline)[1]);
  expect([limit('FREE'), limit('PREMIUM')]).toEqual([25, 1000]);
  expect(PLAN_MEDIA_GALLERY_ROW.free).toBe(`Hasta ${limit('FREE')} fotos por temporada`);
  expect(PLAN_MEDIA_GALLERY_ROW.premium).toBe(`Hasta ${limit('PREMIUM').toLocaleString('es-AR')} fotos por temporada`);
});

test('branding available: Logos y escudos is included in both plans and is no longer upcoming', async () => {
  show({ branding: true });
  await screen.findByRole('heading', { name: 'FREE · Temporada 2026' });
  const upcoming = screen.getByRole('region', { name: 'Próximamente' });
  expect(within(upcoming).queryByRole('region', { name: 'Logos y escudos' })).not.toBeInTheDocument();
  expect(within(upcoming).getByRole('region', { name: 'Galería de fotos' })).toBeInTheDocument();
  const row = within(screen.getByRole('region', { name: 'Qué agrega Premium' })).getByRole('rowheader', { name: 'Logos y escudos' }).closest('tr');
  expect([...row.querySelectorAll('td')].map((cell) => cell.textContent)).toEqual(['Incluidos', 'Incluidos']);
  expect(screen.getByRole('region', { name: 'Inclusiones actuales' })).toHaveTextContent('Logos y escudos: Incluidos');
});

test('nothing upcoming: Mi plan drops Próximamente instead of announcing an empty list', async () => {
  mockNothingUpcoming = true;
  show({ branding: true });
  await screen.findByRole('heading', { name: 'FREE · Temporada 2026' });
  expect(screen.queryByRole('heading', { name: 'Próximamente' })).not.toBeInTheDocument();
  expect(screen.queryByText(/todavía no están disponibles/)).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Qué agrega Premium' })).toBeInTheDocument();
});
