import React from 'react';
import { ArrowLeft, LockKeyhole } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { canonicalRoutes } from '../routing/canonicalRoutes';
import styles from './TorneosShell.module.css';

const FEATURE_LABELS = Object.freeze({
  fixtures: 'Fixture, sorteo y programación',
  match_operations: 'Partidos, actas y convocatorias',
  standings: 'Tabla, estadísticas y disciplina',
  communications: 'Comunicaciones',
  participant_hub: 'Portal del participante',
  plan: 'Planes y compras',
  media: 'Multimedia',
  social_studio: 'Estudio Social',
  team_photos: 'Identidad visual del equipo',
});

// What a route outside the staging-v1 scope renders instead of its page. It
// makes no request: the surface is not served by the gateway in this version.
export default function FeatureUnavailablePage({ feature }) {
  const { organizationId } = useParams();
  const backTo = organizationId ? canonicalRoutes.organizationHome(organizationId) : '/torneos';
  return (
    <section className={styles.unifiedEmptyState} data-feature-unavailable={feature}>
      <span><LockKeyhole size={28} aria-hidden="true" /></span>
      <div>
        <span className={styles.eyebrow}>No disponible en esta versión</span>
        <h1>{FEATURE_LABELS[feature] || 'Esta sección'} todavía no está habilitada</h1>
        <p>
          Esta parte de Torneos no está incluida en la versión que estás usando.
          Podés seguir con la organización, las temporadas, los torneos y las inscripciones.
        </p>
        <Link className={styles.primaryButton} to={backTo}>
          <ArrowLeft size={17} aria-hidden="true" /> {organizationId ? 'Volver al inicio' : 'Volver a Torneos'}
        </Link>
      </div>
    </section>
  );
}
