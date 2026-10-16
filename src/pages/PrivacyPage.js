import React from 'react';
import { Link } from 'react-router-dom';
import LegalPageLayout from '../legal/LegalPageLayout';
import { LEGAL_IDENTITY, LEGAL_ROUTES, LEGAL_UPDATED_AT } from '../legal/legalIdentity';

// Proveedores verificados en el código y la configuración (2026-10-14): Supabase (base, autenticación, almacenamiento),
// Netlify (web), Google Cloud Run (servidor de Torneos), Deno Deploy (pagos), Mercado Pago (cobros), Sentry (errores de la
// web), Google Maps Platform (mapas y búsqueda de lugares), Google y Apple (inicio de sesión), Firebase (notificaciones push;
// en Android además Analytics y Crashlytics). PostHog está en el código pero sin clave en producción: no se lista.
export default function PrivacyPage() {
  const { name, cuit, contactEmail, publicAddress, city } = LEGAL_IDENTITY;
  return (
    <LegalPageLayout title="Política de Privacidad" updatedAt={LEGAL_UPDATED_AT}>
      <h2>1. Responsable</h2>
      <p>
        {name}, CUIT {cuit}{publicAddress ? `, ${publicAddress}, ${city}` : ''}.
        {contactEmail && <> Consultas de privacidad: <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.</>}
      </p>

      <h2>2. Qué datos tratamos</h2>
      <ul>
        <li>
          <strong>Cuenta y perfil:</strong> email, nombre y foto de perfil; y, si los cargás, teléfono, fecha de nacimiento,
          posición y ubicación aproximada.
        </li>
        <li><strong>Arma2 (partidos):</strong> partidos, invitaciones, votaciones, actividad y notificaciones.</li>
        <li>
          <strong>Torneos:</strong> organizaciones, temporadas, torneos, equipos, planteles, partidos, resultados,
          comunicados, logos, escudos y fotos que cargás.
        </li>
        <li>
          <strong>Compras:</strong> organización y temporada, plan, monto, estado del pago, número de operación de Mercado
          Pago y fechas. No recibimos ni guardamos datos de tarjetas ni de la cuenta de Mercado Pago de quien paga.
        </li>
        <li>
          <strong>Datos técnicos:</strong> registros de acceso y errores para que el servicio funcione y sea seguro;
          reportes de errores de la web (Sentry) y, en la app de Android, estadísticas de uso y de fallas (Firebase).
        </li>
      </ul>

      <h2>3. Para qué los usamos</h2>
      <ul>
        <li>Prestar el servicio: tu cuenta, tus partidos y torneos, y las páginas públicas que publicás.</li>
        <li>Cobrar Premium, activarlo y gestionar devoluciones y contracargos.</li>
        <li>Enviar las notificaciones que habilitás.</li>
        <li>Seguridad, prevención de abusos, soporte y corrección de errores.</li>
      </ul>
      <p><strong>No vendemos tus datos</strong> ni los usamos para publicidad de terceros.</p>

      <h2>4. Proveedores que los procesan por cuenta nuestra</h2>
      <table>
        <tbody>
          <tr><td>Supabase</td><td>Base de datos, autenticación y almacenamiento</td></tr>
          <tr><td>Netlify</td><td>Publicación de la web</td></tr>
          <tr><td>Google Cloud</td><td>Servidor de Torneos</td></tr>
          <tr><td>Deno Deploy</td><td>Servicio de pagos</td></tr>
          <tr><td>Mercado Pago</td><td>Cobros y devoluciones</td></tr>
          <tr><td>Sentry</td><td>Reportes de errores de la web</td></tr>
          <tr><td>Google Maps Platform</td><td>Mapas y búsqueda de lugares</td></tr>
          <tr><td>Google y Apple</td><td>Inicio de sesión con esas cuentas</td></tr>
          <tr><td>Firebase (Google)</td><td>Notificaciones push; en Android, estadísticas de uso y de fallas</td></tr>
        </tbody>
      </table>
      <p>
        Algunos guardan datos fuera de Argentina. Lo que publicás como público (por ejemplo, el fixture o la tabla de un
        torneo) lo puede ver cualquiera.
      </p>

      <h2>5. Cuánto tiempo los guardamos</h2>
      <ul>
        <li>Cuenta y contenido: mientras la cuenta exista o hasta que los borres.</li>
        <li>
          Si eliminás la cuenta: se borran tu cuenta, tu perfil y tus datos personales en Arma2 y en Torneos. En partidos,
          planteles, actas y estadísticas tu nombre se reemplaza por uno anónimo y los resultados se conservan (son la
          historia de los demás equipos y organizaciones). Primero se borra en Torneos y después en Arma2: si falla una
          parte, podés reintentar; lo ya anonimizado en Torneos no se puede revertir. Detalle completo en{' '}
          <Link to={LEGAL_ROUTES.accountDeletion}>Eliminar cuenta</Link>.
        </li>
        <li>Fotos de una temporada: hasta el fin de la temporada; después pueden eliminarse.</li>
        <li>
          Compras: el tiempo que exigen las normas aplicables (contables y de defensa del consumidor), aunque borres la cuenta;
          quedan sin vínculo con tu cuenta.
        </li>
      </ul>

      <h2>6. Tus derechos</h2>
      <p>
        Podés pedir acceso, rectificación, actualización o supresión de tus datos (Ley 25.326)
        {contactEmail ? <> escribiendo a <a href={`mailto:${contactEmail}`}>{contactEmail}</a></> : ''}. Para borrar tu
        cuenta, ver <Link to={LEGAL_ROUTES.accountDeletion}>Eliminar cuenta</Link>.
      </p>
      <p>
        La AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA, en su carácter de Órgano de Control de la Ley N° 25.326, tiene la
        atribución de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por
        incumplimiento de las normas vigentes en materia de protección de datos personales.
      </p>

      <h2>7. Cambios</h2>
      <p>Si cambiamos esta política, lo avisamos en la app antes de que el cambio rija.</p>
    </LegalPageLayout>
  );
}
