import React from 'react';
import { Link } from 'react-router-dom';
import { LEGAL_ROUTES } from './legalIdentity';
import { isArma2NativeRuntime } from '../utils/runtimePlatform';

// Leyendas exactas de la Disposición SSDCyLC 954/2025 (art. 1 «BOTÓN DE ARREPENTIMIENTO», art. 4 «BOTÓN DE BAJA DE
// SERVICIO»): «a simple vista, en lugar destacado y en el primer acceso», sin registro previo. La norma no fija tamaño:
// van como enlaces de texto legibles, no como bloque comercial.
export const REVOCATION_LINK_LABEL = 'BOTÓN DE ARREPENTIMIENTO';
export const CANCELLATION_LINK_LABEL = 'BOTÓN DE BAJA DE SERVICIO';
export const PROVIDER_LINK_LABEL = 'Datos del proveedor';

/**
 * Pie legal compacto. Los datos del proveedor (nombre, CUIT, domicilio, email) NO van acá: viven en /legales («Datos del
 * proveedor», un toque) y en los Términos de venta.
 * - variant 'login': el ingreso ya enlaza Términos y Privacidad en su línea de consentimiento, así que el pie no los repite.
 * - native: la app nativa no vende (Premium se compra sólo en la web), así que no enlaza el arrepentimiento ni la baja de
 *   una compra web (App Store 3.1.1 / Google Play Payments: nada que lleve a un medio de compra fuera de la tienda).
 */
export default function LegalFooter({ className = '', variant = 'full', native = isArma2NativeRuntime() }) {
  const links = [
    ...(native ? [] : [
      { to: LEGAL_ROUTES.revocation, label: REVOCATION_LINK_LABEL, consumer: true },
      { to: LEGAL_ROUTES.cancellation, label: CANCELLATION_LINK_LABEL, consumer: true },
    ]),
    ...(variant === 'login' ? [] : [
      { to: LEGAL_ROUTES.terms, label: 'Términos' },
      { to: LEGAL_ROUTES.privacy, label: 'Privacidad' },
    ]),
    { to: LEGAL_ROUTES.provider, label: PROVIDER_LINK_LABEL },
  ];
  return (
    <footer className={`legal-footer ${className}`.trim()} aria-label="Información legal">
      <nav className="legal-footer__links" aria-label="Enlaces legales">
        {links.map(({ to, label, consumer }) => (
          <Link key={to} to={to} className={consumer ? 'legal-footer__consumer' : undefined}>{label}</Link>
        ))}
      </nav>
    </footer>
  );
}
