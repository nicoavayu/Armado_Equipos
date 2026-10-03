// SOCIAL-V1 — Mi plan presents the Estudio Social as available exactly when the navigation offers it (the
// production-eligible flag AND the composition feature), and as "Próximamente" otherwise.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PlanExperiencePage from '../features/torneos/components/PlanExperiencePage';
import { TorneosCompetitionProvider } from '../features/torneos/context/TorneosCompetitionContext';
import { TorneosFeaturesProvider } from '../features/torneos/context/TorneosFeaturesContext';
import { stagingV1FeaturesFor } from '../features/torneos/stagingV1/stagingV1Features';
import { planComparisonFor, PLAN_COMPARISON, PLAN_COMING_SOON } from '../features/torneos/domain/planComparison';
import { tournamentEntitlementsFixture } from '../testUtils/tournamentEntitlementsFixture';

let mockSocialFlag = true;
jest.mock('../features/torneos/config/featureFlags', () => {
  const actual = jest.requireActual('../features/torneos/config/featureFlags');
  return {
    ...actual,
    get torneosFeatureFlags() { return { ...actual.torneosFeatureFlags, socialContentGenerator: mockSocialFlag }; },
  };
});

const org = { id: '10000000-0000-4000-8000-000000000001', name: 'Liga Devoto' };
const season = { id: '20000000-0000-4000-8000-000000000001', name: 'Temporada 2026' };

function show({ plan = 'FREE', social = true } = {}) {
  const service = {
    loadCompetitionContext: jest.fn().mockResolvedValue({ seasons: [season], tournaments: [], preference: { activeSeasonId: season.id } }),
    setTournamentContext: jest.fn().mockResolvedValue({}),
    loadSeasonEntitlements: jest.fn(async ({ seasonId }) => tournamentEntitlementsFixture({ seasonId, plan })),
  };
  render(
    <MemoryRouter>
      <TorneosFeaturesProvider features={stagingV1FeaturesFor('off', { planRead: true, social })}>
        <TorneosCompetitionProvider organizationId={org.id} service={service}>
          <PlanExperiencePage organization={org} />
        </TorneosCompetitionProvider>
      </TorneosFeaturesProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => { mockSocialFlag = true; });

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
