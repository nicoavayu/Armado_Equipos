import React from 'react';
import { createRoot } from 'react-dom/client';
import BrandingImage from '../features/torneos/components/BrandingImage';

// A deterministic scheduler, so a test can stop after a commit and before React
// flushes that commit's passive effects. On a real (or slow CI) host that gap
// opens whenever the render outlasts the scheduler's time slice.
jest.mock('scheduler', () => require('scheduler/unstable_mock'));

jest.mock('../services/api/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({ getPublicUrl: (path) => ({ data: { publicUrl: `https://assets.local/${path}` } }) }),
    },
  },
}));

const Scheduler = require('scheduler');

const organizationId = '11111111-1111-4111-8111-111111111111';
const tournamentId = '22222222-2222-4222-8222-222222222222';
const organizationPath = `${organizationId}/organizations/${organizationId}/33333333-3333-4333-8333-333333333333.png`;
const tournamentPath = `${organizationId}/tournaments/${tournamentId}/44444444-4444-4444-8444-444444444444.webp`;

// A logo that fails fast can fire onError after the commit that mounted it but
// before its passive effects run. A mount-time "reset to the first candidate"
// effect then landed after the +1 and pinned the broken logo (the CI flake of
// the public page branding test).
test('an onError that lands before the mount effects flush still advances to the fallback', async () => {
  const previousActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;
  global.IS_REACT_ACT_ENVIRONMENT = false;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    root.render(
      <BrandingImage
        kind="tournament"
        path={tournamentPath}
        fallbackPath={organizationPath}
        name="Torneo Apertura"
        decorative={false}
      />,
    );
    // Render + commit only: stops at the commit's paint, passive effects pending.
    Scheduler.unstable_flushUntilNextPaint();
    const tournamentLogo = container.querySelector('img');
    expect(tournamentLogo).toHaveAttribute('src', `https://assets.local/${tournamentPath}`);

    tournamentLogo.dispatchEvent(new Event('error'));
    await Promise.resolve();
    Scheduler.unstable_flushAll();
    await Promise.resolve();

    expect(container.querySelector('img')).toHaveAttribute('src', `https://assets.local/${organizationPath}`);
  } finally {
    root.unmount();
    Scheduler.unstable_flushAll();
    container.remove();
    global.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});
