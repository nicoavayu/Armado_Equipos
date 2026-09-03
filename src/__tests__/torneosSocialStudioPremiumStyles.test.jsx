import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import SocialResultsThemePicker, {
  canUsePremiumResultStyles,
  isSocialResultThemeAllowed,
} from '../features/torneos/components/SocialResultsThemePicker';
import {
  applyFiguraDragToEditorial,
  claimFiguraDragPointer,
  hasSocialStudioRoleCapability,
  resolveSocialStudioSeasonId,
} from '../features/torneos/components/SocialStudioPage';
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

  test.each(['Heritage', 'Street', 'Scoreboard', 'Editorial'])(
    'FREE keeps %s visible and selects its locked preview',
    (label) => {
      const { onSelect } = renderPicker();
      const locked = screen.getByRole('radio', { name: `${label}, disponible con Premium` });
      expect(locked).toHaveTextContent('Premium');
      fireEvent.click(locked);
      expect(onSelect).toHaveBeenCalledWith(label.toLowerCase());
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    },
  );

  test('Ver Premium targets the current organization and season Plan', () => {
    renderPicker({ themeId: 'street' });
    fireEvent.click(screen.getByRole('button', { name: 'Ver Premium' }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      `/torneos/organizacion/${ORGANIZATION_ID}/temporada/${FREE_SEASON}/plan`,
    );
  });

  test('PREMIUM enables all five catalog themes without an explanation', () => {
    const { onSelect } = renderPicker({
      planState: PREMIUM_PLAN,
      seasonId: PREMIUM_SEASON,
    });
    for (const [label, id] of [
      ['Base', 'base'], ['Heritage', 'heritage'], ['Street', 'street'],
      ['Scoreboard', 'scoreboard'], ['Editorial', 'editorial'],
    ]) {
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

  test('associates the Studio tournament with its real competition season', () => {
    const studioTournament = { id: PREMIUM_TOURNAMENT, name: 'Copa Premium' };
    expect(resolveSocialStudioSeasonId(studioTournament, [{
      id: PREMIUM_TOURNAMENT,
      seasonId: PREMIUM_SEASON,
    }])).toBe(PREMIUM_SEASON);
    expect(canUsePremiumResultStyles(PREMIUM_PLAN, PREMIUM_SEASON)).toBe(true);
    expect(canUsePremiumResultStyles(FREE_PLAN, PREMIUM_SEASON)).toBe(false);
  });

  test('Figura pointer drag is claimed and preserves the selected player', () => {
    const event = { preventDefault: jest.fn(), stopPropagation: jest.fn() };
    claimFiguraDragPointer(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);

    const selection = ['player-9'];
    const next = applyFiguraDragToEditorial({
      selection,
      selectedLines: { 'player-9': 'DEL' },
      figuraFocalX: 0.5,
      figuraFocalY: 0.5,
      figuraZoom: 2,
    }, {
      x: 0, y: 0, focalX: 0.5, focalY: 0.5,
    }, {
      clientX: 100, clientY: -50, frameWidth: 200, frameHeight: 100,
    });
    expect(next.selection).toBe(selection);
    expect(next.selectedLines).toEqual({ 'player-9': 'DEL' });
    expect(next).toMatchObject({ figuraFocalX: 0.25, figuraFocalY: 0.75 });
  });

  test('FREE preview of a Premium theme is clearly locked outside the art', () => {
    renderPicker({ themeId: 'heritage' });
    expect(screen.getByText(/Preview white-label · export bloqueado/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver Premium' })).toBeInTheDocument();
  });
});
