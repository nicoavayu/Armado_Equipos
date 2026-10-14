import React from 'react';
import { Link } from 'react-router-dom';
import LegalPageLayout from '../legal/LegalPageLayout';
import {
  CONSUMER_COMPLAINTS_LABEL, CONSUMER_COMPLAINTS_URL, LEGAL_IDENTITY, LEGAL_ROUTES, LEGAL_UPDATED_AT, REVOCATION_DAYS,
} from '../legal/legalIdentity';

// Condiciones aprobadas por Nico (2026-10-14): ARS 20.000 finales por temporada, pago único sin renovación automática,
// temporada de hasta seis meses desde su activación, comprar Premium no reinicia el plazo, FREE 25 fotos y Premium 100.
// El precio vigente lo muestra «Mi plan» (lo decide el servidor); esta página no inventa otro.
export default function TermsOfSalePage() {
  const { name, cuit, contactEmail, publicAddress, city } = LEGAL_IDENTITY;
  return (
    <LegalPageLayout title="Términos y condiciones de venta — Arma2 Torneos Premium" updatedAt={LEGAL_UPDATED_AT}>
      <h2>1. Quién vende</h2>
      <p>
        {name}, CUIT {cuit}{publicAddress ? `, con domicilio en ${publicAddress}, ${city}` : ''}.
        {contactEmail && <> Contacto: <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.</>}
        {' '}Servicio: Arma2 Torneos, en app.arma2.com.ar.
      </p>

      <h2>2. Qué se compra</h2>
      <p>
        «Premium» es un plan para <strong>una temporada</strong> de una organización en Arma2 Torneos. Se aplica a esa
        temporada y a todos sus torneos, y no se traslada a otras temporadas: cada temporada tiene su propio plan.
      </p>
      <table>
        <thead><tr><th /><th>FREE</th><th>Premium</th></tr></thead>
        <tbody>
          <tr><td>Galería de fotos</td><td>Hasta 25 fotos por temporada</td><td>Hasta 100 fotos por temporada</td></tr>
          <tr><td>Colaboradores por temporada</td><td>Propietario + 1</td><td>Propietario + 10</td></tr>
          <tr><td>Estudio Social</td><td>Estilo Base, con la firma Arma2</td><td>Todas las placas y estilos, y la opción de quitar la firma Arma2</td></tr>
        </tbody>
      </table>
      <p>Fixture, partidos, actas, tabla, página pública, comunicados, logos y escudos están incluidos en ambos planes.</p>

      <h2>3. Precio y pago</h2>
      <ul>
        <li><strong>ARS 20.000 finales por temporada</strong>, el precio que se muestra en «Mi plan» antes de pagar.</li>
        <li><strong>Pago único.</strong> No es una suscripción: no se renueva automáticamente ni se vuelve a cobrar.</li>
        <li>
          Se paga con <strong>Mercado Pago</strong>. Arma2 no recibe ni guarda los datos de tu tarjeta ni de tu cuenta de
          Mercado Pago.
        </li>
        <li>Pueden comprar el Propietario o un Administrador de la temporada.</li>
      </ul>

      <h2>4. Activación</h2>
      <p>
        Premium se activa cuando Mercado Pago confirma el pago. Si cerrás la ventana antes de volver, el estado se
        actualiza solo y se ve en «Mi plan». Si el pago queda pendiente, Premium se activa cuando Mercado Pago lo acredita.
      </p>

      <h2>5. Duración de la temporada y fotos</h2>
      <ul>
        <li>
          Una temporada dura <strong>hasta seis meses desde su activación</strong>. La fecha de fin se muestra en «Mi plan»
          antes de pagar. <strong>Comprar Premium no reinicia ni extiende ese plazo.</strong>
        </li>
        <li>Si la temporada ya terminó, no se puede comprar Premium para ella.</li>
        <li>
          Al terminar la temporada sus fotos dejan de estar disponibles y pueden eliminarse; los resultados, las tablas y el
          historial se conservan. Si querés guardar las fotos, descargalas antes de la fecha de fin.
        </li>
      </ul>

      <h2>6. Derecho de arrepentimiento</h2>
      <p>
        Podés revocar la compra dentro de los <strong>{REVOCATION_DAYS} días corridos</strong> desde el pago, sin dar
        motivos y sin costo (art. 34 de la Ley 24.240 y art. 1110 del Código Civil y Comercial), con el{' '}
        <Link to={LEGAL_ROUTES.revocation}>Botón de arrepentimiento</Link>, que te ayuda a enviarnos la solicitud por email;
        al recibirla te confirmamos la recepción por email. Devolvemos el total por Mercado Pago y, al devolverse el pago,
        la temporada vuelve al plan FREE.
      </p>

      <h2>7. Si algo falla</h2>
      <p>
        Si pagaste y Premium no se activó, escribinos{contactEmail ? <> a <a href={`mailto:${contactEmail}`}>{contactEmail}</a></> : ''} con
        el número de operación de Mercado Pago: lo revisamos y, si no se puede activar, devolvemos el total. Toda
        devolución total deja la temporada en FREE.
      </p>

      <h2>8. Desconocimiento del pago (contracargo)</h2>
      <p>
        Si el pago se desconoce ante Mercado Pago o ante el emisor de la tarjeta, Premium queda suspendido para esa
        temporada mientras se resuelve. Si se resuelve a favor de quien pagó, la temporada queda en FREE.
      </p>

      <h2>9. Cambios</h2>
      <p>Si cambian el precio o lo que incluye Premium, el cambio no afecta a las temporadas ya pagadas.</p>

      <h2>10. Reclamos</h2>
      <p>
        Podés reclamar ante <a href={CONSUMER_COMPLAINTS_URL} target="_blank" rel="noopener noreferrer">{CONSUMER_COMPLAINTS_LABEL}</a>.
        Se aplica la ley de la República Argentina; como consumidor, podés reclamar en la jurisdicción de tu domicilio.
      </p>
    </LegalPageLayout>
  );
}
