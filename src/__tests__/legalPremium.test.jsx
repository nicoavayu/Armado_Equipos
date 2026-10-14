// Legal pages before the public opening of Premium: the approved terms of sale (ARS 20.000 finales por temporada, pago
// único sin renovación, hasta seis meses desde la activación sin reinicio, FREE 25 / Premium 100 fotos), the provider's
// identity, the Botón de arrepentimiento (code + email to the provider, no login) and the verified providers. Nothing
// claims a tax status, and the email / address appear only once set.
import React from 'react';
import fs from 'fs';
import path from 'path';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TermsOfSalePage from '../pages/TermsOfSalePage';
import PrivacyPage from '../pages/PrivacyPage';
import TermsPage from '../pages/TermsPage';
import RevocationPage, { revocationCode, revocationMailto } from '../pages/RevocationPage';
import LegalFooter from '../legal/LegalFooter';
import { CONSUMER_COMPLAINTS_URL, LEGAL_IDENTITY, legalIdentityComplete } from '../legal/legalIdentity';

const renderAt = (node) => render(<MemoryRouter>{node}</MemoryRouter>);

describe('provider identity', () => {
  test('name and CUIT authorized by Nico; email and address pending (null) until he gives them', () => {
    expect(LEGAL_IDENTITY.name).toBe('Nicolás Gabriel Avayu');
    expect(LEGAL_IDENTITY.cuit).toBe('20-30334438-2');
    expect(legalIdentityComplete()).toBe(LEGAL_IDENTITY.contactEmail !== null && LEGAL_IDENTITY.publicAddress !== null);
    expect(legalIdentityComplete({ ...LEGAL_IDENTITY, contactEmail: 'a@b.co', publicAddress: 'Calle 1' })).toBe(true);
  });

  test('the static public gate (home page) shows the same identity, the Botón de arrepentimiento and the complaints link', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../public/mobile-only.html'), 'utf8');
    expect(html).toContain(`Arma2 — ${LEGAL_IDENTITY.name} · CUIT ${LEGAL_IDENTITY.cuit}`);
    expect(html).toContain('href="/arrepentimiento"');
    expect(html).toContain(CONSUMER_COMPLAINTS_URL);
    if (LEGAL_IDENTITY.contactEmail) expect(html).toContain(LEGAL_IDENTITY.contactEmail);
    if (LEGAL_IDENTITY.publicAddress) expect(html).toContain(LEGAL_IDENTITY.publicAddress);
  });
});

describe('terms of sale', () => {
  test('state exactly the approved conditions', () => {
    renderAt(<TermsOfSalePage />);
    const text = document.body.textContent;
    expect(text).toContain('ARS 20.000 finales por temporada');
    expect(text).toMatch(/Pago único\..*no se renueva automáticamente ni se vuelve a cobrar/);
    expect(text).toContain('hasta seis meses desde su activación');
    expect(text).toContain('Comprar Premium no reinicia ni extiende ese plazo');
    expect(text).toContain('Hasta 25 fotos por temporada');
    expect(text).toContain('Hasta 100 fotos por temporada');
    expect(text).toContain('10 días corridos');
    expect(text).toContain(`${LEGAL_IDENTITY.name}, CUIT ${LEGAL_IDENTITY.cuit}`);
    expect(screen.getAllByRole('link', { name: 'Botón de arrepentimiento' }).length).toBeGreaterThan(0);
  });

  test('no tax status, invoice or deletion promise is claimed', () => {
    renderAt(<TermsOfSalePage />);
    const text = document.body.textContent.toLowerCase();
    for (const word of ['monotribut', 'factura', 'responsable inscripto', 'exent', 'se eliminan']) expect(text).not.toContain(word);
  });
});

describe('Botón de arrepentimiento', () => {
  test('code format and the email the consumer sends (subject + body carry the code)', () => {
    const code = revocationCode(new Date('2026-10-14T18:00:00Z'), () => 0);
    expect(code).toBe('ARR-20261014-AAAAAA');
    const url = revocationMailto('ventas@example.com', code, { name: 'Ana Pérez', email: 'ana@example.com', operation: '184150037496', season: '', comment: '' });
    expect(url.startsWith('mailto:ventas@example.com?subject=Arrepentimiento%20ARR-20261014-AAAAAA&body=')).toBe(true);
    const body = decodeURIComponent(url.split('&body=')[1]);
    expect(body).toContain('Código de solicitud: ARR-20261014-AAAAAA');
    expect(body).toContain('Operación de Mercado Pago (o fecha y monto): 184150037496');
    expect(body).not.toContain('Organización y temporada');
  });

  test('without a contact email the page says the channel is not enabled (the opening is blocked meanwhile)', () => {
    renderAt(<RevocationPage />);
    if (LEGAL_IDENTITY.contactEmail) {
      expect(screen.getByRole('form', { name: 'Solicitud de arrepentimiento' })).toBeTruthy();
    } else {
      expect(screen.getByRole('alert').textContent).toContain('todavía no está habilitado');
    }
    expect(document.body.textContent).toContain('No hace falta iniciar sesión');
  });
});

describe('privacy', () => {
  test('lists the verified providers and the AAIP legend; PostHog (no production key) is not listed', () => {
    renderAt(<PrivacyPage />);
    const text = document.body.textContent;
    for (const provider of ['Supabase', 'Netlify', 'Google Cloud', 'Deno Deploy', 'Mercado Pago', 'Sentry', 'Google Maps Platform', 'Firebase']) {
      expect(text).toContain(provider);
    }
    expect(text).toContain('AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA');
    expect(text).not.toMatch(/posthog/i);
    expect(text).not.toMatch(/menores/i);
  });
});

describe('footer and terms', () => {
  test('the footer always shows the identity, the Botón de arrepentimiento and the complaints link', () => {
    renderAt(<LegalFooter />);
    expect(document.body.textContent).toContain(`CUIT ${LEGAL_IDENTITY.cuit}`);
    expect(screen.getByRole('link', { name: 'Botón de arrepentimiento' }).getAttribute('href')).toBe('/arrepentimiento');
    expect(screen.getByRole('link', { name: /Para reclamos ingrese aquí/ }).getAttribute('href')).toBe(CONSUMER_COMPLAINTS_URL);
  });

  test('the general terms link the terms of sale', () => {
    renderAt(<TermsPage />);
    expect(screen.getAllByRole('link', { name: 'Términos de venta' })[0].getAttribute('href')).toBe('/terminos-de-venta');
  });
});
