import fs from 'fs';
import path from 'path';
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PublicTournamentPage from '../features/torneos/components/PublicTournamentPage';
import { resolvePublicBrand } from '../features/torneos/components/PublicTournamentPage';
import { BASE_LOCKUP_DATA_URL } from '../features/torneos/social/base/brandAsset';

jest.mock('../services/api/supabase', () => ({
  supabase: {
    storage: {
      from: (bucket) => ({
        getPublicUrl: (objectPath) => ({ data: { publicUrl: `https://cdn.test/${bucket}/${objectPath}` } }),
      }),
    },
  },
}));

const ORG = '11111111-1111-4111-8111-111111111111';
const TOURNAMENT = '22222222-2222-4222-8222-222222222222';
const TOURNAMENT_LOGO = `${ORG}/tournaments/${TOURNAMENT}/33333333-3333-4333-8333-333333333333.png`;
const ORG_LOGO = `${ORG}/organizations/${ORG}/44444444-4444-4444-8444-444444444444.webp`;
const url = (objectPath) => `https://cdn.test/tournament-branding/${objectPath}`;

const buildPage = ({ branding, tournamentLogo = null, organizationLogo = null } = {}) => ({
  publicSlug: 'liga-devoto-apertura-a1b2c3d4e5',
  ...(branding ? { branding } : {}),
  organization: { name: 'Liga Devoto', logoPath: organizationLogo },
  season: { name: 'Temporada 2027' },
  tournament: {
    name: 'Copa Apertura',
    status: 'active',
    sportModality: 'football_7',
    competitionFormat: 'league',
    logoPath: tournamentLogo,
  },
  categories: [{ name: 'Primera', slug: 'primera' }],
  selectedCategory: { name: 'Primera', slug: 'primera' },
  matches: [],
  teams: [],
  competition: [],
});

const FREE = { mode: 'arma2_visible', arma2Visible: true, canRemoveArma2: false };
const PREMIUM = { mode: 'branding_optional', arma2Visible: true, canRemoveArma2: true };

async function renderPublic(page) {
  render(
    <MemoryRouter initialEntries={['/torneos/publico/liga-devoto-apertura-a1b2c3d4e5']}>
      <Routes>
        <Route
          path="/torneos/publico/:publicSlug"
          element={<PublicTournamentPage service={{ loadPage: jest.fn().mockResolvedValue(page) }} />}
        />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { level: 1, name: 'Copa Apertura' });
  return {
    header: document.querySelector('header'),
    footer: document.querySelector('footer'),
  };
}

const expectOfficial = (region) => {
  const logo = within(region).getByRole('img', { name: 'Arma2 Torneos' });
  expect(logo.closest('[data-brand]')).toHaveAttribute('data-brand', 'official');
  expect(logo).toHaveAttribute('width', '864');
  expect(logo).toHaveAttribute('height', '100');
};

describe('public tournament page branding', () => {
  test('the styled-text pseudo logo is gone', async () => {
    await renderPublic(buildPage({ branding: FREE }));

    expect(document.body.textContent).not.toMatch(/ARMA2\s*TORNEOS/);
  });

  test('FREE without its own logo: official Arma2 Torneos logo in header and footer', async () => {
    const { header, footer } = await renderPublic(buildPage({ branding: FREE }));

    expectOfficial(header);
    expectOfficial(footer);
  });

  test('FREE with a logo uploaded: still the official logo (no white-label without Premium)', async () => {
    const { header, footer } = await renderPublic(buildPage({
      branding: FREE,
      tournamentLogo: TOURNAMENT_LOGO,
      organizationLogo: ORG_LOGO,
    }));

    expectOfficial(header);
    expectOfficial(footer);
    expect(within(header).queryByRole('img', { name: 'Liga Devoto' })).not.toBeInTheDocument();
  });

  test('no plan signal at all (today\'s production payload) fails closed to the official logo', async () => {
    const { header } = await renderPublic(buildPage({ tournamentLogo: TOURNAMENT_LOGO }));

    expectOfficial(header);
  });

  test('PREMIUM with its own logo: the tournament logo replaces the official one', async () => {
    const { header, footer } = await renderPublic(buildPage({
      branding: PREMIUM,
      tournamentLogo: TOURNAMENT_LOGO,
      organizationLogo: ORG_LOGO,
    }));

    for (const region of [header, footer]) {
      const logo = within(region).getByRole('img', { name: 'Liga Devoto' });
      expect(logo).toHaveAttribute('src', url(TOURNAMENT_LOGO));
      expect(logo.closest('[data-brand="official"]')).toBeNull();
      expect(within(region).queryByRole('img', { name: 'Arma2 Torneos' })).not.toBeInTheDocument();
    }
  });

  test('PREMIUM with only an organization logo uses it', async () => {
    const { header } = await renderPublic(buildPage({ branding: PREMIUM, organizationLogo: ORG_LOGO }));

    expect(within(header).getByRole('img', { name: 'Liga Devoto' })).toHaveAttribute('src', url(ORG_LOGO));
  });

  test('PREMIUM without its own logo falls back to the official logo', async () => {
    const { header, footer } = await renderPublic(buildPage({ branding: PREMIUM }));

    expectOfficial(header);
    expectOfficial(footer);
  });

  test('PREMIUM own logo that fails to load walks to the organization logo, then the official one', async () => {
    const { header } = await renderPublic(buildPage({
      branding: PREMIUM,
      tournamentLogo: TOURNAMENT_LOGO,
      organizationLogo: ORG_LOGO,
    }));

    fireEvent.error(within(header).getByRole('img', { name: 'Liga Devoto' }));
    const organizationLogo = within(header).getByRole('img', { name: 'Liga Devoto' });
    expect(organizationLogo).toHaveAttribute('src', url(ORG_LOGO));

    fireEvent.error(organizationLogo);
    expectOfficial(header);
  });

  test('the resolver never trusts a truthy-but-not-true Premium flag', () => {
    expect(resolvePublicBrand(buildPage({
      branding: { canRemoveArma2: 'true' },
      tournamentLogo: TOURNAMENT_LOGO,
    }))).toEqual({ kind: 'official' });
  });

  test('the served lockup file is byte-identical to the approved Social Studio lockup', () => {
    const file = fs.readFileSync(path.join(process.cwd(), 'src/assets/branding/arma2-torneos-lockup.webp'));
    const approved = Buffer.from(BASE_LOCKUP_DATA_URL.split('base64,')[1], 'base64');
    expect(file.equals(approved)).toBe(true);
  });
});
