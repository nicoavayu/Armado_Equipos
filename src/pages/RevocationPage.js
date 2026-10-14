import React from 'react';
import { Link } from 'react-router-dom';
import LegalPageLayout from '../legal/LegalPageLayout';
import EmailRequestForm, { requestBody, requestMailto, requestReference } from '../legal/EmailRequestForm';
import { LEGAL_IDENTITY, LEGAL_ROUTES, LEGAL_UPDATED_AT, REVOCATION_DAYS } from '../legal/legalIdentity';

// Botón de arrepentimiento: público, sin registro. Esta página NO registra la solicitud ni la envía: arma el correo al
// proveedor (EmailRequestForm). La confirmación de recepción, con el código de la solicitud, la manda el proveedor por
// email dentro de las 24 h (manual).
const REVOCATION = Object.freeze({
  prefix: 'ARR',
  subject: 'Arrepentimiento',
  intro: 'Solicito revocar mi compra de Arma2 Torneos Premium (Botón de arrepentimiento).',
  formLabel: 'Preparar la solicitud de arrepentimiento',
  operationLabel: 'Número de operación de Mercado Pago, o la fecha y el monto del pago',
  operationRequired: true,
});

export const revocationReference = (now, random) => requestReference(REVOCATION.prefix, now, random);
export const revocationSubject = (reference) => `${REVOCATION.subject} ${reference}`;
export const revocationBody = (reference, form) => requestBody(REVOCATION.intro, reference, form);
export const revocationMailto = (email, reference, form) => requestMailto(email, revocationSubject(reference), revocationBody(reference, form));

export default function RevocationPage() {
  const { contactEmail } = LEGAL_IDENTITY;
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
      <EmailRequestForm kind={REVOCATION} />
      <p>
        Condiciones completas en los <Link to={LEGAL_ROUTES.termsOfSale}>Términos de venta</Link>. Para pedir la baja del
        servicio, ver la <Link to={LEGAL_ROUTES.cancellation}>baja del servicio</Link>.
      </p>
    </LegalPageLayout>
  );
}
