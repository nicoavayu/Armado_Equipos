import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import SocialResultsThemePicker, {
  canUsePremiumResultStyles,
  isSocialResultThemeAllowed,
} from '../features/torneos/components/SocialResultsThemePicker';
import { hasSocialStudioRoleCapability } from '../features/torneos/components/SocialStudioPage';
import {
  normalizeTournamentEntitlements,
  TOURNAMENT_PLANS,
} from '../features/torneos/domain/entitlements';
import { tournamentEntitlementsFixture } from '../testUtils/tournamentEntitlementsFixture';

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000001';
const FREE_TOURNAMENT = '30000000-0000-4000-8000-000000000001';
const PREMIUM_TOURNAMENT = '30000000-0000-4000-8000-000000000002';
const FREE_SEASON = '20000000-0000-4000-8000-000000000001';
const PREMIUM_SEASON = '20000000-0000-4000-8000-000000000002';

function readyPlan(seasonId, tournamentId, plan) {
  return {
    status: 'ready',
    error: '',
    data: normalizeTournamentEntitlements(
      tournamentEntitlementsFixture({ seasonId, tournamentId, plan }),
      { organizationId: ORGANIZATION_ID, seasonId },
    ),
  };
}

const FREE_PLAN = readyPlan(FREE_SEASON, FREE_TOURNAMENT, TOURNAMENT_PLANS.FREE);
const PREMIUM_PLAN = readyPlan(PREMIUM_SEASON, PREMIUM_TOURNAMENT, TOURNAMENT_PLANS.PREMIUM);

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderPicker({
  planState = FREE_PLAN,
  seasonId = FREE_SEASON,
  themeId = 'base',
  onSelect = jest.fn(),
  onFallback = jest.fn(),
} = {}) {
  render(
    <MemoryRouter initialEntries={[
      `/torneos/organizacion/${ORGANIZATION_ID}/estudio-social`,
    ]}>
      <Routes>
        <Route
          path="/torneos/organizacion/:organizationId/estudio-social"
          element={(
            <SocialResultsThemePicker
              organizationId={ORGANIZATION_ID}
              seasonId={seasonId}
              planState={planState}
              themeId={themeId}
              onSelect={onSelect}
              onFallback={onFallback}
            />
          )}
        />
        <Route
          path="/torneos/organizacion/:organizationId/temporada/:seasonId/plan"
          element={<LocationProbe />}
        />
      </Routes>
    </MemoryRouter>,
  );
  return { onSelect, onFallback };
}

describe('Social Studio Premium result styles', () => {
  test('FREE keeps Base enabled', () => {
    const { onSelect } = renderPicker();
    fireEvent.click(screen.getByRole('radio', { name: 'Base' }));
    expect(onSelect).toHaveBeenCalledWith('base');
  });

  test.each(['Street', 'Editorial'])(
    'FREE keeps %s visible and opens the Premium explanation',
    (label) => {
      const { onSelect } = renderPicker();
      const locked = screen.getByRole('radio', { name: `${label}, disponible con Premium` });
      expect(locked).toHaveTextContent('Premium');
      fireEvent.click(locked);
      expect(screen.getByRole('dialog', { name: 'Disponible con Premium' })).toBeInTheDocument();
      expect(screen.getByText(
        'Sumá más estilos profesionales para tus placas de resultados.',
      )).toBeInTheDocument();
      expect(onSelect).not.toHaveBeenCalled();
    },
  );

  test('Ver Premium targets the current organization and season Plan', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('radio', { name: 'Street, disponible con Premium' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver Premium' }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      `/torneos/organizacion/${ORGANIZATION_ID}/temporada/${FREE_SEASON}/plan`,
    );
  });

  test('PREMIUM enables Base, Street and Editorial without an explanation', () => {
    const { onSelect } = renderPicker({
      planState: PREMIUM_PLAN,
      seasonId: PREMIUM_SEASON,
    });
    for (const [label, id] of [['Base', 'base'], ['Street', 'street'], ['Editorial', 'editorial']]) {
      fireEvent.click(screen.getByRole('radio', { name: label }));
      expect(onSelect).toHaveBeenCalledWith(id);
    }
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('plan scope must match the selected tournament and fails closed while loading', () => {
    expect(canUsePremiumResultStyles(PREMIUM_PLAN, FREE_SEASON)).toBe(false);
    expect(isSocialResultThemeAllowed('street', { status: 'loading' }, FREE_SEASON))
      .toBe(false);
    expect(isSocialResultThemeAllowed('base', { status: 'loading' }, FREE_SEASON))
      .toBe(true);
  });

  test('Premium never manufactures missing role permissions', () => {
    expect(canUsePremiumResultStyles(PREMIUM_PLAN, PREMIUM_SEASON)).toBe(true);
    expect(hasSocialStudioRoleCapability(['social.read'], 'social.create')).toBe(false);
    expect(hasSocialStudioRoleCapability(['social.read'], 'social.export')).toBe(false);
  });

  test('PREMIUM to FREE falls back to Base and explains the change', async () => {
    function SwitchHarness() {
      const [planState, setPlanState] = useState(PREMIUM_PLAN);
      const [themeId, setThemeId] = useState('street');
      const [notice, setNotice] = useState('');
      const seasonId = planState === PREMIUM_PLAN ? PREMIUM_SEASON : FREE_SEASON;
      return (
        <>
          <button type="button" onClick={() => setPlanState(FREE_PLAN)}>Cambiar a Free</button>
          <span data-testid="theme">{themeId}</span>
          <span>{notice}</span>
          <SocialResultsThemePicker
            organizationId={ORGANIZATION_ID}
            seasonId={seasonId}
            planState={planState}
            themeId={themeId}
            onSelect={setThemeId}
            onFallback={() => setNotice('Volvimos a Base porque el torneo seleccionado es Free.')}
          />
        </>
      );
    }

    render(<MemoryRouter><SwitchHarness /></MemoryRouter>);
    expect(screen.getByTestId('theme')).toHaveTextContent('street');
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar a Free' }));
    await waitFor(() => expect(screen.getByTestId('theme')).toHaveTextContent('base'));
    expect(screen.getByText(/Volvimos a Base/)).toBeInTheDocument();
  });
});
