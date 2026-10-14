import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import LegalPageLayout from '../legal/LegalPageLayout';
import { LEGAL_IDENTITY, LEGAL_ROUTES, LEGAL_UPDATED_AT, REVOCATION_DAYS } from '../legal/legalIdentity';

// Botón de arrepentimiento: público, sin registro. Esta página NO registra la solicitud ni la envía: arma el texto de un
// correo al proveedor (con una referencia generada en el dispositivo para identificarlo) y lo deja listo para enviar
// desde el correo de quien compra, o para copiarlo si no tiene un cliente de correo. La solicitud existe cuando el correo
// llega; la confirmación de recepción y el código de la solicitud los manda el proveedor por email.
export function revocationReference(now = new Date(), random = Math.random) {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  const tail = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(random() * 32)]).join('');
  return `ARR-${day}-${tail}`;
}

export function revocationSubject(reference) {
  return `Arrepentimiento ${reference}`;
}

export function revocationBody(reference, form) {
  return [
    'Solicito revocar mi compra de Arma2 Torneos Premium (Botón de arrepentimiento).',
    '',
    `Referencia: ${reference}`,
    `Nombre y apellido: ${form.name}`,
    `Email de contacto: ${form.email}`,
    `Operación de Mercado Pago (o fecha y monto): ${form.operation}`,
    form.season ? `Organización y temporada: ${form.season}` : null,
    form.comment ? `Comentario: ${form.comment}` : null,
  ].filter((line) => line !== null).join('\n');
}

export function revocationMailto(email, reference, form) {
  return `mailto:${email}?subject=${encodeURIComponent(revocationSubject(reference))}&body=${encodeURIComponent(revocationBody(reference, form))}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function RevocationPage() {
  const { contactEmail } = LEGAL_IDENTITY;
  const [form, setForm] = useState({ name: '', email: '', operation: '', season: '', comment: '' });
  const [reference, setReference] = useState('');
  const [copied, setCopied] = useState('');
  const ready = form.name.trim() && /\S+@\S+\.\S+/.test(form.email) && form.operation.trim();
  const set = (key) => (event) => { setForm((current) => ({ ...current, [key]: event.target.value })); setCopied(''); };
  const prepare = (event) => {
    event.preventDefault();
    if (!ready || !contactEmail) return;
    setReference((current) => current || revocationReference());
  };
  const copy = async (what, text) => setCopied((await copyText(text)) ? what : `${what}-error`);
  const fullText = reference ? `Para: ${contactEmail}\nAsunto: ${revocationSubject(reference)}\n\n${revocationBody(reference, form)}` : '';

  return (
    <LegalPageLayout title="Botón de arrepentimiento" updatedAt={LEGAL_UPDATED_AT}>
      <p>
        Si compraste Premium para una temporada, tenés <strong>{REVOCATION_DAYS} días corridos desde el pago</strong> para
        arrepentirte, sin dar motivos y sin costo. Te devolvemos el total por Mercado Pago y la temporada vuelve al plan
        FREE. No hace falta iniciar sesión.
      </p>
      <p>
        La solicitud se hace <strong>por email a {contactEmail || 'nuestro correo de contacto'}</strong>. Este formulario te
        ayuda a armar ese correo; <strong>no lo envía por vos</strong>. Cuando lo recibimos, te respondemos por email
        confirmando la recepción, con el código de tu solicitud.
      </p>
      {contactEmail ? (
        <form onSubmit={prepare} aria-label="Preparar la solicitud de arrepentimiento">
          <label>Nombre y apellido<input value={form.name} onChange={set('name')} required autoComplete="name" /></label>
          <label>Email de contacto<input type="email" value={form.email} onChange={set('email')} required autoComplete="email" /></label>
          <label>Número de operación de Mercado Pago, o la fecha y el monto del pago<input value={form.operation} onChange={set('operation')} required /></label>
          <label>Organización y temporada (opcional)<input value={form.season} onChange={set('season')} /></label>
          <label>Comentario (opcional)<textarea rows={3} value={form.comment} onChange={set('comment')} /></label>
          <button type="submit" disabled={!ready}>Preparar el correo</button>
        </form>
      ) : (
        <p role="alert">El canal de solicitudes todavía no está habilitado.</p>
      )}
      {reference && (
        <section aria-label="Correo listo para enviar">
          <p role="status">
            <strong>Tu solicitud todavía no fue enviada.</strong> Falta que envíes el correo. La referencia{' '}
            <strong>{reference}</strong> la generó tu dispositivo para identificar el correo:{' '}
            <strong>no es un comprobante de recepción</strong>. La recepción te la confirmamos nosotros por email.
          </p>
          <p>
            <a href={revocationMailto(contactEmail, reference, form)}>Abrir mi correo con la solicitud lista</a>
          </p>
          <p>Si no se abre tu correo, copiá la dirección y el texto y envialos desde la cuenta de email que uses:</p>
          <p>
            Dirección: <strong>{contactEmail}</strong>{' '}
            <button type="button" onClick={() => copy('address', contactEmail)}>Copiar dirección</button>
          </p>
          <label>Texto del correo<textarea rows={9} readOnly value={fullText} /></label>
          <button type="button" onClick={() => copy('text', fullText)}>Copiar texto</button>
          {copied === 'address' && <p role="status">Dirección copiada.</p>}
          {copied === 'text' && <p role="status">Texto copiado.</p>}
          {copied.endsWith('-error') && <p role="alert">No se pudo copiar automáticamente: seleccioná el texto y copialo a mano.</p>}
        </section>
      )}
      <p>
        Condiciones completas en los <Link to={LEGAL_ROUTES.termsOfSale}>Términos de venta</Link>.
      </p>
    </LegalPageLayout>
  );
}
