// Datos del proveedor que la web publica (Ley 24.240 y normas de comercio electrónico). Una sola fuente para las páginas
// legales, el pie y el gate estático (public/mobile-only.html, verificado por legalPages.test.jsx).
// Autorizados por Nico (2026-10-14): nombre, CUIT, domicilio público (sin departamento) y email comercial. Si alguno
// faltara, legalIdentityComplete() es false, las páginas no lo muestran y la apertura pública no procede (el procedimiento
// de apertura verifica el pie publicado). Nada de esto afirma inscripción ni condición fiscal.
export const LEGAL_IDENTITY = Object.freeze({
  name: 'Nicolás Gabriel Avayu',
  cuit: '20-30334438-2',
  contactEmail: 'arma2app@gmail.com',
  publicAddress: 'Bacon 4884',
  city: 'Ciudad Autónoma de Buenos Aires, Argentina',
});

// Leyenda y enlace exigidos para reclamos de consumo (Ventanilla Federal de Defensa de las y los Consumidores).
export const CONSUMER_COMPLAINTS_LABEL = 'Defensa de las y los Consumidores. Para reclamos ingrese aquí';
export const CONSUMER_COMPLAINTS_URL = 'https://www.argentina.gob.ar/produccion/defensadelconsumidor/formulario';

export const LEGAL_UPDATED_AT = '15 de octubre de 2026';
export const REVOCATION_DAYS = 10;

export const LEGAL_ROUTES = Object.freeze({
  terms: '/terms',
  termsOfSale: '/terminos-de-venta',
  privacy: '/privacy',
  revocation: '/arrepentimiento',
  cancellation: '/baja-del-servicio',
  accountDeletion: '/account-deletion',
});

export function legalIdentityComplete(identity = LEGAL_IDENTITY) {
  return Boolean(identity.name && identity.cuit && identity.contactEmail && identity.publicAddress);
}
