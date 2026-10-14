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
import RevocationPage, { revocationReference, revocationMailto } from '../pages/RevocationPage';
import LegalFooter from '../legal/LegalFooter';
import { CONSUMER_COMPLAINTS_URL, LEGAL_IDENTITY, legalIdentityComplete } from '../legal/legalIdentity';

const renderAt = (node) => render(<MemoryRouter>{node}</MemoryRouter>);

describe('provider identity', () => {
  test('identity exactly as Nico authorized it: name, CUIT, public address (no apartment, no DNI) and commercial email', () => {
    expect(LEGAL_IDENTITY.name).toBe('Nicolás Gabriel Avayu');
    expect(LEGAL_IDENTITY.cuit).toBe('20-30334438-2');
    expect(LEGAL_IDENTITY.publicAddress).toBe('Bacon 4884');
    expect(LEGAL_IDENTITY.city).toBe('Ciudad Autónoma de Buenos Aires, Argentina');
    expect(LEGAL_IDENTITY.contactEmail).toBe('arma2app@gmail.com');
    expect(JSON.stringify(LEGAL_IDENTITY)).not.toMatch(/depto|departamento|piso|dni/i);
    expect(legalIdentityComplete()).toBe(true);
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
    expect(screen.getAllByRole('link', { name: 'BOTÓN DE ARREPENTIMIENTO' }).length).toBeGreaterThan(0);
  });

  test('no tax status, invoice or deletion promise is claimed', () => {
    renderAt(<TermsOfSalePage />);
    const text = document.body.textContent.toLowerCase();
    for (const word of ['monotribut', 'factura', 'responsable inscripto', 'exent', 'se eliminan']) expect(text).not.toContain(word);
  });
});

describe('Botón de arrepentimiento', () => {
  test('reference format and the prepared email (subject + body carry the reference, labelled as a reference)', () => {
    const ref = revocationReference(new Date('2026-10-14T18:00:00Z'), () => 0);
    expect(ref).toBe('ARR-20261014-AAAAAA');
    const url = revocationMailto('ventas@example.com', ref, { name: 'Ana Pérez', email: 'ana@example.com', operation: '184150037496', season: '', comment: '' });
    expect(url.startsWith('mailto:ventas@example.com?subject=Arrepentimiento%20ARR-20261014-AAAAAA&body=')).toBe(true);
    const body = decodeURIComponent(url.split('&body=')[1]);
    expect(body).toContain('Referencia: ARR-20261014-AAAAAA');
    expect(body).not.toContain('Código de solicitud');
    expect(body).toContain('Operación de Mercado Pago (o fecha y monto): 184150037496');
    expect(body).not.toContain('Organización y temporada');
  });

  test('the page only PREPARES the email: it says it does not send it, and the local reference is not a receipt', () => {
    renderAt(<RevocationPage />);
    const text = () => document.body.textContent;
    expect(text()).toContain('No hace falta iniciar sesión');
    expect(text()).toContain('no lo envía por vos');
    expect(screen.queryByRole('button', { name: /enviar solicitud/i })).toBeNull();
    const submit = screen.getByRole('button', { name: 'Preparar el correo' });
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Nombre y apellido'), { target: { value: 'Ana Pérez' } });
    fireEvent.change(screen.getByLabelText('Email de contacto'), { target: { value: 'ana@example.com' } });
    fireEvent.change(screen.getByLabelText(/Número de operación/), { target: { value: '184150037496' } });
    fireEvent.click(submit);
    expect(text()).toContain('Tu solicitud todavía no fue enviada');
    expect(text()).toContain('Falta que envíes el correo');
    expect(text()).toContain('no es un comprobante de recepción');
    expect(text()).not.toMatch(/recibimos tu solicitud|solicitud enviada|te confirmamos la recepción dentro de/i);
    const link = screen.getByRole('link', { name: 'Abrir mi correo con la solicitud lista' });
    expect(link.getAttribute('href').startsWith(`mailto:${LEGAL_IDENTITY.contactEmail}?subject=Arrepentimiento%20ARR-`)).toBe(true);
    // Without a mail client: the address and the full text to copy by hand.
    expect(screen.getByRole('button', { name: 'Copiar dirección' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copiar texto' })).toBeTruthy();
    const area = screen.getByLabelText('Texto del correo');
    expect(area.value).toContain(`Para: ${LEGAL_IDENTITY.contactEmail}`);
    expect(area.value).toMatch(/Asunto: Arrepentimiento ARR-\d{8}-[A-Z2-9]{6}/);
    expect(area.value).toContain('Operación de Mercado Pago (o fecha y monto): 184150037496');
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
    expect(screen.getByRole('link', { name: 'BOTÓN DE ARREPENTIMIENTO' }).getAttribute('href')).toBe('/arrepentimiento');
    expect(screen.getByRole('link', { name: /Para reclamos ingrese aquí/ }).getAttribute('href')).toBe(CONSUMER_COMPLAINTS_URL);
  });

  test('the general terms link the terms of sale', () => {
    renderAt(<TermsPage />);
    expect(screen.getAllByRole('link', { name: 'Términos de venta' })[0].getAttribute('href')).toBe('/terminos-de-venta');
  });
});
