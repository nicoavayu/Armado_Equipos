import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import LegalPageLayout from '../legal/LegalPageLayout';
import { LEGAL_IDENTITY, LEGAL_ROUTES, LEGAL_UPDATED_AT, REVOCATION_DAYS } from '../legal/legalIdentity';

// Botón de arrepentimiento (Res. SCI 424/2020): público, sin registro. El formulario arma la solicitud con un código de
// identificación y la envía por email al proveedor (sin backend nuevo); el proveedor confirma la recepción dentro de las
// 24 h y hace la devolución total por Mercado Pago, que deja la temporada en FREE.
export function revocationCode(now = new Date(), random = Math.random) {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  const tail = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(random() * 32)]).join('');
  return `ARR-${day}-${tail}`;
}

export function revocationMailto(email, code, form) {
  const body = [
    'Solicito revocar mi compra de Arma2 Torneos Premium (Botón de arrepentimiento).',
    '',
    `Código de solicitud: ${code}`,
    `Nombre y apellido: ${form.name}`,
    `Email de contacto: ${form.email}`,
    `Operación de Mercado Pago (o fecha y monto): ${form.operation}`,
    form.season ? `Organización y temporada: ${form.season}` : null,
    form.comment ? `Comentario: ${form.comment}` : null,
  ].filter((line) => line !== null).join('\n');
  return `mailto:${email}?subject=${encodeURIComponent(`Arrepentimiento ${code}`)}&body=${encodeURIComponent(body)}`;
}

export default function RevocationPage() {
  const { contactEmail } = LEGAL_IDENTITY;
  const [form, setForm] = useState({ name: '', email: '', operation: '', season: '', comment: '' });
  const [code, setCode] = useState('');
  const ready = form.name.trim() && /\S+@\S+\.\S+/.test(form.email) && form.operation.trim();
  const mailto = useMemo(() => (code && contactEmail ? revocationMailto(contactEmail, code, form) : ''), [code, contactEmail, form]);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const submit = (event) => {
    event.preventDefault();
    if (!ready || !contactEmail) return;
    const next = code || revocationCode();
    setCode(next);
    window.location.href = revocationMailto(contactEmail, next, form);
  };

  return (
    <LegalPageLayout title="Botón de arrepentimiento" updatedAt={LEGAL_UPDATED_AT}>
      <p>
        Si compraste Premium para una temporada, tenés <strong>{REVOCATION_DAYS} días corridos desde el pago</strong> para
        arrepentirte, sin dar motivos y sin costo. Te devolvemos el total por Mercado Pago y la temporada vuelve al plan
        FREE. No hace falta iniciar sesión.
      </p>
      {contactEmail ? (
        <form onSubmit={submit} aria-label="Solicitud de arrepentimiento">
          <label>Nombre y apellido<input value={form.name} onChange={set('name')} required autoComplete="name" /></label>
          <label>Email de contacto<input type="email" value={form.email} onChange={set('email')} required autoComplete="email" /></label>
          <label>Número de operación de Mercado Pago, o la fecha y el monto del pago<input value={form.operation} onChange={set('operation')} required /></label>
          <label>Organización y temporada (opcional)<input value={form.season} onChange={set('season')} /></label>
          <label>Comentario (opcional)<textarea rows={3} value={form.comment} onChange={set('comment')} /></label>
          <button type="submit" disabled={!ready}>Enviar solicitud</button>
          {code && (
            <p role="status">
              Tu código de solicitud es <strong>{code}</strong>. Se abrió tu correo con la solicitud lista para enviar a{' '}
              <strong>{contactEmail}</strong>; si no se abrió, <a href={mailto}>tocá acá</a> o escribinos con ese código.
              Te confirmamos la recepción dentro de las 24 horas.
            </p>
          )}
        </form>
      ) : (
        <p role="alert">El canal de solicitudes todavía no está habilitado.</p>
      )}
      <p>
        Condiciones completas en los <Link to={LEGAL_ROUTES.termsOfSale}>Términos de venta</Link>.
      </p>
    </LegalPageLayout>
  );
}
