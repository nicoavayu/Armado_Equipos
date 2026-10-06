import React from 'react';
import { Compass } from 'lucide-react';
import TournamentCatalog from './TournamentCatalog';
import { useCatalogService } from './useCatalogService';
import styles from './ConnectedProduct.module.css';

// Explorar torneos inside Torneos: the catalog with the participant's navigation around it.
export default function ExplorePage() {
  const service = useCatalogService();
  return (
    <div className={styles.page}>
      <header className={styles.pageHero}>
        <span className={styles.kicker}><Compass size={15} aria-hidden="true" /> Explorar torneos</span>
        <h1>Encontrá tu próxima competencia</h1>
        <p>
          Convocatorias que las organizaciones publicaron para sumar equipos. Mirá condiciones, fechas y cupos,
          y pedí la inscripción si administrás un equipo.
        </p>
      </header>
      <TournamentCatalog
        service={service}
        entryPath={(item) => `/torneos/explorar/${encodeURIComponent(item.publicSlug)}`}
      />
    </div>
  );
}
