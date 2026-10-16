import React from 'react';
import { Link } from 'react-router-dom';
import LegalPageLayout from '../legal/LegalPageLayout';
import { CANCELLATION_LINK_LABEL, REVOCATION_LINK_LABEL } from '../legal/LegalFooter';
import { CONSUMER_COMPLAINTS_LABEL, CONSUMER_COMPLAINTS_URL, LEGAL_IDENTITY, LEGAL_ROUTES } from '../legal/legalIdentity';
import { isArma2NativeRuntime } from '../utils/runtimePlatform';

// «Datos del proveedor» (/legales): la identificación completa del proveedor, a un toque desde el ingreso, el gate y cada
// pie legal. Res. SCI 270/2020 (Res. GMC 37/19, art. 2): nombre, domicilio físico y electrónico, email de atención y número
// de identificación tributaria «en ubicación de fácil visualización», antes de contratar (la compra además enlaza los
// Términos de venta, que repiten estos datos). En la app nativa no se enlazan los Términos de venta, el arrepentimiento ni
// la baja: allí no se vende nada (Premium se compra sólo en la web).
export default function ProviderInfoPage({ native = isArma2NativeRuntime() }) {
  const { name, cuit, contactEmail, publicAddress, city } = LEGAL_IDENTITY;
  return (
    <LegalPageLayout title="Datos del proveedor">
      <h2>Quién presta el servicio</h2>
      <table>
        <tbody>
          <tr><th scope="row">Nombre</th><td>{name}</td></tr>
          <tr><th scope="row">CUIT</th><td>{cuit}</td></tr>
          {publicAddress && <tr><th scope="row">Domicilio</th><td>{publicAddress}, {city}</td></tr>}
          {contactEmail && (
            <tr><th scope="row">Email</th><td><a href={`mailto:${contactEmail}`}>{contactEmail}</a></td></tr>
          )}
          <tr><th scope="row">Servicio</th><td>Arma2 y Arma2 Torneos (app.arma2.com.ar)</td></tr>
        </tbody>
      </table>

      <h2>Consultas y reclamos</h2>
      {contactEmail && <p>Escribinos a <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.</p>}
      <p>
        <a href={CONSUMER_COMPLAINTS_URL} target="_blank" rel="noopener noreferrer">{CONSUMER_COMPLAINTS_LABEL}</a>
      </p>

      <h2>Documentos legales</h2>
      <ul>
        <li><Link to={LEGAL_ROUTES.terms}>Términos y condiciones</Link></li>
        {!native && <li><Link to={LEGAL_ROUTES.termsOfSale}>Términos de venta</Link></li>}
        <li><Link to={LEGAL_ROUTES.privacy}>Política de privacidad</Link></li>
        {!native && <li><Link to={LEGAL_ROUTES.revocation}>{REVOCATION_LINK_LABEL}</Link></li>}
        {!native && <li><Link to={LEGAL_ROUTES.cancellation}>{CANCELLATION_LINK_LABEL}</Link></li>}
        <li><Link to={LEGAL_ROUTES.accountDeletion}>Eliminar cuenta</Link></li>
      </ul>
    </LegalPageLayout>
  );
}
