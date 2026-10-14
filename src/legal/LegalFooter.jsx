import React from 'react';
import { Link } from 'react-router-dom';
import {
  CONSUMER_COMPLAINTS_LABEL, CONSUMER_COMPLAINTS_URL, LEGAL_IDENTITY, LEGAL_ROUTES,
} from './legalIdentity';

/** Datos del proveedor y enlaces legales. El enlace con la leyenda «BOTÓN DE ARREPENTIMIENTO» va siempre visible en el pie. */
export default function LegalFooter({ className = '' }) {
  const { name, cuit, contactEmail, publicAddress, city } = LEGAL_IDENTITY;
  return (
    <footer className={`legal-footer ${className}`.trim()} aria-label="Información legal">
      <p className="legal-footer__identity">
        <span>Arma2 — {name}</span>
        <span>CUIT {cuit}</span>
        {publicAddress && <span>{publicAddress}, {city}</span>}
        {contactEmail && <a href={`mailto:${contactEmail}`}>{contactEmail}</a>}
      </p>
      <nav className="legal-footer__links" aria-label="Enlaces legales">
        <Link to={LEGAL_ROUTES.terms}>Términos</Link>
        <Link to={LEGAL_ROUTES.termsOfSale}>Términos de venta</Link>
        <Link to={LEGAL_ROUTES.privacy}>Privacidad</Link>
        <Link to={LEGAL_ROUTES.revocation} className="legal-footer__revocation">BOTÓN DE ARREPENTIMIENTO</Link>
        <a href={CONSUMER_COMPLAINTS_URL} target="_blank" rel="noopener noreferrer">{CONSUMER_COMPLAINTS_LABEL}</a>
      </nav>
    </footer>
  );
}
