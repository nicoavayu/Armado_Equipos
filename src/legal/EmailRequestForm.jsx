import React, { useState } from 'react';
import { LEGAL_IDENTITY } from './legalIdentity';

// Solicitudes por email (arrepentimiento, baja del servicio): esta pieza NO registra ni envía nada. Arma el texto de un
// correo al proveedor, con una referencia generada en el dispositivo, y lo deja listo para enviar desde el correo de quien
// lo pide, o para copiarlo si no tiene un cliente de correo. La recepción y el código de la solicitud los informa el
// proveedor por email (manual, dentro de las 24 h).
export function requestReference(prefix, now = new Date(), random = Math.random) {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  const tail = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(random() * 32)]).join('');
  return `${prefix}-${day}-${tail}`;
}

export function requestBody(intro, reference, form, operationBodyLabel = 'Operación de Mercado Pago (o fecha y monto)') {
  return [
    intro,
    '',
    `Referencia: ${reference}`,
    `Nombre y apellido: ${form.name}`,
    `Email de contacto: ${form.email}`,
    `${operationBodyLabel}: ${form.operation}`,
    form.season ? `Organización y temporada: ${form.season}` : null,
    form.comment ? `Comentario: ${form.comment}` : null,
  ].filter((line) => line !== null).join('\n');
}

export function requestMailto(email, subject, body) {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * kind: { prefix: 'ARR' | 'BAJA' | 'ELIM', subject: 'Arrepentimiento' | 'Baja del servicio' | 'Eliminar cuenta', intro: first line
 *         of the email, formLabel, operationLabel, operationRequired, operationBodyLabel? (line of the email; default the
 *         Mercado Pago operation), seasonField? (false hides «Organización y temporada») }
 */
export default function EmailRequestForm({ kind }) {
  const { contactEmail } = LEGAL_IDENTITY;
  const [form, setForm] = useState({ name: '', email: '', operation: '', season: '', comment: '' });
  const [reference, setReference] = useState('');
  const [copied, setCopied] = useState('');
  const ready = form.name.trim() && /\S+@\S+\.\S+/.test(form.email) && (!kind.operationRequired || form.operation.trim());
  const set = (key) => (event) => { setForm((current) => ({ ...current, [key]: event.target.value })); setCopied(''); };
  const prepare = (event) => {
    event.preventDefault();
    if (!ready || !contactEmail) return;
    setReference((current) => current || requestReference(kind.prefix));
  };
  const copy = async (what, text) => setCopied((await copyText(text)) ? what : `${what}-error`);
  const subject = reference ? `${kind.subject} ${reference}` : '';
  const body = reference ? requestBody(kind.intro, reference, form, kind.operationBodyLabel) : '';
  const fullText = reference ? `Para: ${contactEmail}\nAsunto: ${subject}\n\n${body}` : '';

  if (!contactEmail) return <p role="alert">El canal de solicitudes todavía no está habilitado.</p>;
  return (
    <>
      <form onSubmit={prepare} aria-label={kind.formLabel}>
        <label>Nombre y apellido<input value={form.name} onChange={set('name')} required autoComplete="name" /></label>
        <label>Email de contacto<input type="email" value={form.email} onChange={set('email')} required autoComplete="email" /></label>
        <label>{kind.operationLabel}<input value={form.operation} onChange={set('operation')} required={kind.operationRequired} /></label>
        {kind.seasonField !== false && (
          <label>Organización y temporada (opcional)<input value={form.season} onChange={set('season')} /></label>
        )}
        <label>Comentario (opcional)<textarea rows={3} value={form.comment} onChange={set('comment')} /></label>
        <button type="submit" disabled={!ready}>Preparar el correo</button>
      </form>
      {reference && (
        <section aria-label="Correo listo para enviar">
          <p role="status">
            <strong>Tu solicitud todavía no fue enviada.</strong> Falta que envíes el correo. La referencia{' '}
            <strong>{reference}</strong> la generó tu dispositivo para identificar el correo:{' '}
            <strong>no es un comprobante de recepción</strong>. La recepción te la confirmamos nosotros por email.
          </p>
          <p><a href={requestMailto(contactEmail, subject, body)}>Abrir mi correo con la solicitud lista</a></p>
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
    </>
  );
}
