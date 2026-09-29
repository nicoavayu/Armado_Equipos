import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getShareableAppOrigin, toShareableAppUrl } from '../utils/shareableAppUrl';
import { PUBLIC_APP_ORIGIN } from '../utils/publicAppUrl';
import TournamentPublicPageSettings from '../features/torneos/components/TournamentPublicPageSettings';
import { organizationInvitationUrl } from '../features/torneos/components/OrganizationMembersPage';

let mockNativeRuntime = false;

jest.mock('../utils/runtimePlatform', () => ({
  ...jest.requireActual('../utils/runtimePlatform'),
  isArma2NativeRuntime: () => mockNativeRuntime,
}));

const PUBLIC_PATH = '/torneos/publico/stable-a1b2c3d4e5';
const LOCALHOST_SHARE = /^https:\/\/localhost(?![:\d])|^capacitor:/i;

// ANDROID 43 smoke: inside Capacitor the public link was built from the WebView
// origin (https://localhost/torneos/publico/...), which nobody else can open.
describe('shareable app URLs', () => {
  beforeEach(() => {
    mockNativeRuntime = false;
  });

  test('the Production web base is the existing public app origin', () => {
    expect(PUBLIC_APP_ORIGIN).toBe('https://app.arma2.com.ar');
  });

  test.each([
    'https://app.arma2.com.ar',
    'https://staging.arma2.com.ar',
    'http://localhost:3000',
  ])('web keeps the current origin %s', (currentOrigin) => {
    expect(getShareableAppOrigin({ isNative: false, currentOrigin })).toBe(currentOrigin);
    expect(toShareableAppUrl(PUBLIC_PATH, { isNative: false, currentOrigin }))
      .toBe(`${currentOrigin}${PUBLIC_PATH}`);
  });

  test.each([
    'https://localhost',
    'capacitor://localhost',
  ])('native WebView origin %s shares https://app.arma2.com.ar', (currentOrigin) => {
    const url = toShareableAppUrl(PUBLIC_PATH, { isNative: true, currentOrigin });
    expect(url).toBe(`https://app.arma2.com.ar${PUBLIC_PATH}`);
    expect(url).not.toMatch(LOCALHOST_SHARE);
  });

  test.each([
    'https://localhost',
    'capacitor://localhost',
    '',
    'null',
  ])('a WebView origin never leaks even before the Capacitor bridge answers (%s)', (currentOrigin) => {
    const url = toShareableAppUrl(PUBLIC_PATH, { isNative: false, currentOrigin });
    expect(url).toBe(`${PUBLIC_APP_ORIGIN}${PUBLIC_PATH}`);
    expect(url).not.toMatch(LOCALHOST_SHARE);
  });

  test('the default reads the real runtime', () => {
    mockNativeRuntime = true;
    expect(toShareableAppUrl(PUBLIC_PATH)).toBe(`https://app.arma2.com.ar${PUBLIC_PATH}`);
    mockNativeRuntime = false;
    expect(toShareableAppUrl(PUBLIC_PATH)).toBe(`${window.location.origin}${PUBLIC_PATH}`);
  });

  test('organization invitations follow the same rule', () => {
    mockNativeRuntime = true;
    expect(organizationInvitationUrl('a'.repeat(64)))
      .toBe(`https://app.arma2.com.ar/torneos/invitacion/organizacion/${'a'.repeat(64)}`);
  });
});

describe('tournament public settings on Android', () => {
  test.each([
    [true, `https://app.arma2.com.ar${PUBLIC_PATH}`],
    [false, `${window.location.origin}${PUBLIC_PATH}`],
  ])('native=%s shows and copies %s', async (native, expected) => {
    mockNativeRuntime = native;
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const service = {
      loadPublicPageSettings: jest.fn().mockResolvedValue({
        published: true, publicPath: PUBLIC_PATH, publicSlug: 'stable-a1b2c3d4e5', eligible: true,
      }),
      setPublicPagePublished: jest.fn(),
    };
    render(<TournamentPublicPageSettings organizationId="org" tournamentId="tournament" canPublish service={service} />);

    expect(await screen.findByLabelText('Enlace público')).toHaveValue(expected);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar enlace público' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected));
    if (native) expect(writeText.mock.calls[0][0]).not.toMatch(LOCALHOST_SHARE);
    // Internal navigation stays relative: the WebView keeps its own routing.
    expect(screen.getByRole('link', { name: /abrir página/i })).toHaveAttribute('href', PUBLIC_PATH);
  });
});
