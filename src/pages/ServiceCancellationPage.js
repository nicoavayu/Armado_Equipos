import React from 'react';
import { Link } from 'react-router-dom';
import LegalPageLayout from '../legal/LegalPageLayout';
import EmailRequestForm from '../legal/EmailRequestForm';
import { LEGAL_IDENTITY, LEGAL_ROUTES, LEGAL_UPDATED_AT, REVOCATION_DAYS } from '../legal/legalIdentity';

// Botón de baja de servicio: público, sin registro, por el mismo canal de correo que el arrepentimiento. Explica que
// Premium es un pago único sin renovación, y que pedir la baja, arrepentirse de la compra y eliminar la cuenta son cosas
// distintas. No promete devoluciones fuera de los Términos de venta. La confirmación de recepción, con el código de la
// solicitud, la manda el proveedor por email dentro de las 24 h (manual).
const CANCELLATION = Object.freeze({
  prefix: 'BAJA',
  subject: 'Baja del servicio',
  intro: 'Solicito la baja del servicio contratado en Arma2 Torneos.',
  formLabel: 'Preparar la solicitud de baja del servicio',
  operationLabel: 'Número de operación de Mercado Pago, o la fecha y el monto del pago (si corresponde)',
  operationRequired: false,
});

export default function ServiceCancellationPage() {
  const { contactEmail } = LEGAL_IDENTITY;
  return (
    <LegalPageLayout title="Baja del servicio" updatedAt={LEGAL_UPDATED_AT}>
      <p>
        <strong>Premium es un pago único por temporada: no es una suscripción.</strong> No se renueva automáticamente ni se
        vuelve a cobrar, así que no hay cobros futuros que cancelar.
      </p>
      <p>Si igual querés pedir la baja del servicio contratado, podés hacerlo acá, sin iniciar sesión.</p>
      <h2>Tres cosas distintas</h2>
      <ul>
        <li>
          <strong>Pedir la baja del servicio</strong> (esta página): nos pedís por email dejar de prestarte el servicio
          contratado. Te confirmamos la recepción por email, con el código de tu solicitud, y te informamos cómo queda.
          Pedir la baja no genera por sí sola una devolución: las devoluciones son las previstas en los{' '}
          <Link to={LEGAL_ROUTES.termsOfSale}>Términos de venta</Link>.
        </li>
        <li>
          <strong>Arrepentirte de la compra</strong>: dentro de los {REVOCATION_DAYS} días corridos desde el pago, con el{' '}
          <Link to={LEGAL_ROUTES.revocation}>BOTÓN DE ARREPENTIMIENTO</Link>. Te devolvemos el total y la temporada vuelve al
          plan FREE.
        </li>
        <li>
          <strong>Eliminar tu cuenta de Arma2</strong>: desde la app, en Perfil → Eliminar cuenta (ver{' '}
          <Link to={LEGAL_ROUTES.accountDeletion}>Eliminar cuenta</Link>). No es lo mismo que la baja de una compra.
        </li>
      </ul>
      <p>
        La solicitud de baja se hace <strong>por email a {contactEmail || 'nuestro correo de contacto'}</strong>. Este
        formulario te ayuda a armar ese correo; <strong>no lo envía por vos</strong>.
      </p>
      <EmailRequestForm kind={CANCELLATION} />
    </LegalPageLayout>
  );
}
