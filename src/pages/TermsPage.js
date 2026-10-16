import React from 'react';
import { Link } from 'react-router-dom';
import LegalPageLayout from '../legal/LegalPageLayout';
import { LEGAL_ROUTES, LEGAL_UPDATED_AT } from '../legal/legalIdentity';

export default function TermsPage() {
  return (
    <LegalPageLayout title="Términos y Condiciones" updatedAt={LEGAL_UPDATED_AT}>
      <p>
        Arma2 es una plataforma para organizar partidos y coordinar jugadores, y Arma2 Torneos, para organizar torneos y
        temporadas. Al usar la app aceptás estos términos.
      </p>
      <p>
        Sos responsable del contenido que cargás y de mantener tus credenciales seguras. No está permitido usar la app para
        actividades ilegales o abusivas.
      </p>
      <p>
        El servicio puede actualizarse, modificarse o suspenderse parcialmente por razones técnicas, operativas o legales.
      </p>
      <p>
        La compra de Premium para una temporada de Torneos se rige además por los{' '}
        <Link to={LEGAL_ROUTES.termsOfSale}>Términos de venta</Link>.
      </p>
      <p>
        Podés cerrar sesión en cualquier momento y eliminar tu cuenta desde la app (Perfil → Eliminar cuenta), desde la web o
        pedirlo por email. Si falla una parte del borrado, podés reintentar; lo ya anonimizado en Torneos no se puede
        revertir. Ver <Link to={LEGAL_ROUTES.accountDeletion}>Eliminar cuenta</Link> y la{' '}
        <Link to={LEGAL_ROUTES.privacy}>Política de Privacidad</Link>.
      </p>
    </LegalPageLayout>
  );
}
