import React from 'react';
import { Link } from 'react-router-dom';
import LegalPageLayout from '../legal/LegalPageLayout';
import EmailRequestForm from '../legal/EmailRequestForm';
import AccountDeletionPanel from '../legal/AccountDeletionPanel';
import { ACCOUNT_DELETION_SUMMARY } from '../legal/accountDeletion';
import { LEGAL_IDENTITY, LEGAL_ROUTES, LEGAL_UPDATED_AT } from '../legal/legalIdentity';

// Eliminar la cuenta: pública, sin registro (Google Play exige un recurso web para PEDIR el borrado; middleware.ts la deja
// pública). Tres caminos para la misma cuenta: la app (Perfil → Eliminar cuenta), esta página con la sesión iniciada (el
// mismo flujo de Core, que primero borra en Torneos) y el pedido por email, que esta página NO envía: arma el correo con
// una referencia ELIM-… generada en el dispositivo (EmailRequestForm). Lo que dice sale de legal/accountDeletion.js, que
// describe lo que hacen delete-account y la migración Torneos 0021.
export const ACCOUNT_DELETION_REQUEST = Object.freeze({
  prefix: 'ELIM',
  subject: 'Eliminar cuenta',
  intro: 'Solicito eliminar mi cuenta de Arma2 (incluido Torneos) y mis datos asociados.',
  formLabel: 'Preparar el pedido de eliminación de cuenta',
  operationLabel: 'Email con el que entrás a Arma2 (si es otro que el de contacto)',
  operationRequired: false,
  operationBodyLabel: 'Email de la cuenta Arma2',
  seasonField: false,
});

export default function AccountDeletionInfoPage() {
  const { contactEmail } = LEGAL_IDENTITY;
  const { deleted, anonymised, kept, organizations, timing } = ACCOUNT_DELETION_SUMMARY;
  return (
    <LegalPageLayout title="Eliminación de Cuenta" updatedAt={LEGAL_UPDATED_AT}>
      <p>
        Tu cuenta es <strong>una sola para Arma2 y Torneos</strong>. Eliminarla borra tu cuenta y tus datos personales en
        las dos. {timing}
      </p>

      <h2>Qué se borra</h2>
      <ul>{deleted.map((item) => <li key={item}>{item}</li>)}</ul>
      <h2>Qué queda, sin tu nombre</h2>
      <ul>{anonymised.map((item) => <li key={item}>{item}</li>)}</ul>
      <h2>Qué se conserva y por qué</h2>
      <ul>{kept.map((item) => <li key={item}>{item}</li>)}</ul>
      <h2>Organizaciones de Torneos</h2>
      <p>{organizations}</p>

      <h2>Eliminarla ahora</h2>
      <ul>
        <li><strong>En la app de Arma2:</strong> Perfil → Eliminar cuenta, y confirmá escribiendo ELIMINAR.</li>
        <li><strong>En Torneos (app o web):</strong> Perfil → Eliminar cuenta te trae a esta página.</li>
        <li><strong>En esta página</strong>, si tenés la sesión iniciada en este navegador:</li>
      </ul>
      <AccountDeletionPanel />

      <h2>Pedirla por email (sin iniciar sesión)</h2>
      <p>
        Si no podés iniciar sesión, pedí la eliminación <strong>por email a {contactEmail || 'nuestro correo de contacto'}</strong>.
        Este formulario arma el correo; <strong>no lo envía por vos</strong>. Te confirmamos la recepción por email y, una vez
        verificado que la cuenta es tuya, la eliminamos dentro de los 5 días hábiles (Ley 25.326, art. 16), con el mismo
        alcance que el botón.
      </p>
      <EmailRequestForm kind={ACCOUNT_DELETION_REQUEST} />

      <p>
        Eliminar la cuenta no es lo mismo que pedir la baja de una compra: ver{' '}
        <Link to={LEGAL_ROUTES.cancellation}>Baja del servicio</Link> y la{' '}
        <Link to={LEGAL_ROUTES.privacy}>Política de Privacidad</Link>.
      </p>
    </LegalPageLayout>
  );
}
