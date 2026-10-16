// Clean login (owner decision 2026-10-15): the sign-in screen shows brand, sign-in methods, one consent line and a compact
// legal footer. The provider's name, CUIT, address and email are NOT on the login: they live at /legales («Datos del
// proveedor», one tap). On the web the two legends of Disp. SSDCyLC 954/2025 stay on the first screen with their exact
// names; in the native app (which sells nothing: Premium is web-only) the footer links no purchase-related page.
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthHome from '../components/AuthHome';
import ProviderInfoPage from '../pages/ProviderInfoPage';
import { CONSUMER_COMPLAINTS_URL, LEGAL_IDENTITY } from '../legal/legalIdentity';
import { isArma2NativeRuntime } from '../utils/runtimePlatform';

jest.mock('../components/AuthProvider', () => ({ useAuth: () => ({ user: null, loading: false }) }));
jest.mock('../supabase', () => ({ supabase: { auth: { signInWithOtp: jest.fn() } } }));
jest.mock('../services/auth/socialAuth', () => ({
  signInWithGoogle: jest.fn(),
  signInWithApple: jest.fn(),
  canShowAppleSignIn: jest.fn(() => false),
}));
jest.mock('../utils/runtimePlatform', () => ({
  ...jest.requireActual('../utils/runtimePlatform'),
  isArma2NativeRuntime: jest.fn(() => false),
  getAuthenticatedProductHome: () => '/torneos',
}));

const PROVIDER_VALUES = [LEGAL_IDENTITY.name, LEGAL_IDENTITY.cuit, LEGAL_IDENTITY.publicAddress, LEGAL_IDENTITY.contactEmail, 'CUIT'];

const renderAt = (node, route = '/login') => render(<MemoryRouter initialEntries={[route]}>{node}</MemoryRouter>);
const linkPairs = (root = screen) => root.getAllByRole('link').map((a) => [a.textContent.trim(), a.getAttribute('href')]);

beforeEach(() => isArma2NativeRuntime.mockReturnValue(false));

describe('login (web)', () => {
  test('consent line + compact footer: exact legends and hrefs, provider data one tap away, no duplicated links', () => {
    renderAt(<AuthHome />);
    expect(linkPairs()).toEqual([
      ['Términos', '/terms'],
      ['Política de Privacidad', '/privacy'],
      ['BOTÓN DE ARREPENTIMIENTO', '/arrepentimiento'],
      ['BOTÓN DE BAJA DE SERVICIO', '/baja-del-servicio'],
      ['Datos del proveedor', '/legales'],
    ]);
    const hrefs = linkPairs().map(([, href]) => href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    // The sign-in methods are untouched.
    expect(screen.getByRole('button', { name: /Continuar con email/ })).toBeTruthy();
  });

  test('the login does not expose the provider name, CUIT, address or email, nor big legal buttons', () => {
    const { container } = renderAt(<AuthHome />);
    for (const value of PROVIDER_VALUES) expect(container.textContent).not.toContain(value);
    expect(container.querySelector('.legal-footer__button, .legal-footer__identity')).toBeNull();
    const footer = screen.getByRole('contentinfo', { name: 'Información legal' });
    expect(within(footer).getAllByRole('link').filter((a) => a.className.includes('legal-footer__consumer'))).toHaveLength(2);
  });
});

describe('login (native app: Capacitor runtime)', () => {
  test('no purchase-related links (Premium is web-only); Términos, Privacidad and Datos del proveedor stay', () => {
    isArma2NativeRuntime.mockReturnValue(true);
    const { container } = renderAt(<AuthHome />);
    expect(linkPairs()).toEqual([
      ['Términos', '/terms'],
      ['Política de Privacidad', '/privacy'],
      ['Datos del proveedor', '/legales'],
    ]);
    expect(container.textContent).not.toMatch(/ARREPENTIMIENTO|BAJA DE SERVICIO|Términos de venta|Premium|Mercado Pago/);
    for (const value of PROVIDER_VALUES) expect(container.textContent).not.toContain(value);
  });
});

describe('Datos del proveedor (/legales)', () => {
  test('web: full provider identification, contact, complaints link and every legal document', () => {
    renderAt(<ProviderInfoPage native={false} />, '/legales');
    const text = document.body.textContent;
    expect(screen.getByRole('heading', { level: 1, name: 'Datos del proveedor' })).toBeTruthy();
    expect(screen.getByRole('row', { name: `Nombre ${LEGAL_IDENTITY.name}` })).toBeTruthy();
    expect(screen.getByRole('row', { name: `CUIT ${LEGAL_IDENTITY.cuit}` })).toBeTruthy();
    expect(text).toContain(`${LEGAL_IDENTITY.publicAddress}, ${LEGAL_IDENTITY.city}`);
    expect(screen.getAllByRole('link', { name: LEGAL_IDENTITY.contactEmail })[0].getAttribute('href')).toBe(`mailto:${LEGAL_IDENTITY.contactEmail}`);
    expect(screen.getByRole('link', { name: /Para reclamos ingrese aquí/ }).getAttribute('href')).toBe(CONSUMER_COMPLAINTS_URL);
    const main = screen.getByRole('list');
    expect(linkPairs(within(main))).toEqual([
      ['Términos y condiciones', '/terms'],
      ['Términos de venta', '/terminos-de-venta'],
      ['Política de privacidad', '/privacy'],
      ['BOTÓN DE ARREPENTIMIENTO', '/arrepentimiento'],
      ['BOTÓN DE BAJA DE SERVICIO', '/baja-del-servicio'],
      ['Eliminar cuenta', '/account-deletion'],
    ]);
    expect(text.toLowerCase()).not.toMatch(/monotribut|responsable inscripto|factura/);
  });

  test('native: same provider data, no terms of sale, arrepentimiento or baja links', () => {
    isArma2NativeRuntime.mockReturnValue(true);
    renderAt(<ProviderInfoPage native />, '/legales');
    expect(document.body.textContent).toContain(`CUIT${LEGAL_IDENTITY.cuit}`);
    expect(screen.queryByRole('link', { name: 'Términos de venta' })).toBeNull();
    expect(screen.queryByRole('link', { name: /ARREPENTIMIENTO|BAJA DE SERVICIO/ })).toBeNull();
    expect(linkPairs(within(screen.getByRole('list'))).map(([, href]) => href)).toEqual(['/terms', '/privacy', '/account-deletion']);
  });

  test('the SPA routes /legales (public path allow-listed by the gate middleware)', () => {
    const app = fs.readFileSync(path.join(__dirname, '../App.js'), 'utf8');
    expect(app).toContain('<Route path="/legales" element={');
    const middleware = fs.readFileSync(path.join(__dirname, '../../middleware.ts'), 'utf8');
    expect(middleware).toMatch(/PUBLIC_LEGAL_PATHS = new Set\(\[[^\]]*'\/legales'/);
  });
});
