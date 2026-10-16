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
      <section aria-labelledby="terms-ugc">
        <h2 id="terms-ugc">Contenido prohibido y moderación</h2>
        <p>
          Estas reglas valen para todo lo que alguien escribe o sube y otras personas ven: nombres de organizaciones,
          torneos, equipos y jugadores, logos y escudos, descripciones, convocatorias, comunicados, mensajes de solicitudes
          de inscripción y fotos.
        </p>
        <p>No está permitido publicar:</p>
        <ul>
          <li>insultos, contenido discriminatorio, violento, sexual o que incite al odio;</li>
          <li>acoso, amenazas o burlas dirigidas a una persona o a un equipo;</li>
          <li>suplantar a otra persona, equipo u organización;</li>
          <li>datos personales de terceros sin su permiso (teléfonos, direcciones, documentos, fotos);</li>
          <li>spam, engaños o publicidad no autorizada;</li>
          <li>contenido ilegal o que infrinja derechos de otros (por ejemplo, marcas o imágenes ajenas).</li>
        </ul>
        <p>
          <strong>Cómo reportar.</strong> En la página pública de cada torneo está el botón «Reportar contenido» (torneo,
          organización, convocatoria, un equipo o un jugador); en cada comunicado, «Reportar comunicado»; y quien organiza
          puede reportar una solicitud de inscripción con «Reportar a Arma2». Para reportar hace falta iniciar sesión.
          También podés escribirnos a <a href="mailto:arma2app@gmail.com">arma2app@gmail.com</a>. No le mostramos a nadie
          quién envió un reporte.
        </p>
        <p>
          <strong>Quién lo revisa y cuándo.</strong> Los nombres y escudos de equipos y jugadores los revisa la organización
          del torneo (su propietario y sus administradores), que puede escalar el caso a Arma2. Todo lo demás lo revisa el
          equipo de Arma2. Nuestro objetivo es revisar cada reporte dentro de las 24 a 48 horas; es un objetivo, no una
          garantía. No revisamos todo antes de que se publique: quien organiza aprueba las inscripciones y los planteles,
          y el resto se modera a partir de los reportes.
        </p>
        <p>
          <strong>Qué puede pasar.</strong> Según el caso, se puede reemplazar un nombre por uno neutro, quitar un escudo o
          un logo, retirar un comunicado, dar de baja la página pública y la convocatoria de un torneo (y no permitir que se
          vuelvan a publicar hasta revisarlo), bloquear a quien envía solicitudes abusivas a una organización, y suspender o
          eliminar la cuenta de quien incumpla estas reglas de forma grave o repetida.
        </p>
        <p>
          <strong>Bloquear.</strong> Si recibís comunicados de una organización que no querés ver, podés silenciarla desde el
          comunicado: los nuevos van directo al archivo (los de emergencia te siguen llegando) y podés reactivarla cuando
          quieras. Quien organiza puede bloquear a un solicitante para que no vuelva a pedir lugar en sus torneos.
        </p>
        <p>
          Quien organiza un torneo es responsable de lo que publica su organización y de revisar lo que le reportan sobre sus
          equipos y jugadores.
        </p>
      </section>
      <p>
        El servicio puede actualizarse, modificarse o suspenderse parcialmente por razones técnicas, operativas o legales.
      </p>
      <p>
        La compra de Premium para una temporada de Torneos se rige además por los{' '}
        <Link to={LEGAL_ROUTES.termsOfSale}>Términos de venta</Link>.
      </p>
      <p>
        Podés cerrar sesión en cualquier momento y eliminar tu cuenta desde la app en la sección Perfil. Ver también la{' '}
        <Link to={LEGAL_ROUTES.privacy}>Política de Privacidad</Link>.
      </p>
    </LegalPageLayout>
  );
}
