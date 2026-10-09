import React from 'react';
import { Link } from 'react-router-dom';
import OfficialLockup from '../../../../assets/branding/arma2-torneos-lockup.webp';
import { useOptionalAuth } from '../../../../components/AuthContext';
import TournamentCatalog from './TournamentCatalog';
import { useCatalogService } from './useCatalogService';
import styles from './ConnectedProduct.module.css';

// Explorar torneos on the public web: anyone can browse and share calls without an account. Requesting a place, and
// anything private, needs signing in (the request route is behind authentication).
export default function PublicCatalogRoute() {
  const service = useCatalogService();
  const auth = useOptionalAuth();
  return (
    <div className={styles.publicShell}>
      <a className={styles.skipLink} href="#catalogo-publico">Saltar al catálogo</a>
      <header className={styles.publicHeader}>
        <Link to="/torneos/publico" aria-label="Arma2 Torneos · Explorar torneos">
          <img src={OfficialLockup} alt="Arma2 Torneos" width="864" height="100" />
        </Link>
        {auth?.user
          ? <Link className={styles.secondaryAction} to="/torneos">Ir a Mis torneos</Link>
          : <Link className={styles.secondaryAction} to="/login?returnTo=%2Ftorneos%2Fexplorar">Ingresar</Link>}
      </header>
      <main id="catalogo-publico" className={styles.publicMain} tabIndex={-1}>
        <header className={styles.pageHero}>
          <span className={styles.kicker}>Explorar torneos</span>
          <h1>Encontrá tu próxima competencia</h1>
          <p>Torneos que buscan equipos. Mirá condiciones, fechas y cupos. Para pedir la inscripción necesitás tu cuenta de Arma2.</p>
        </header>
        {service.mode === 'closed' ? (
          <section className={styles.stateCard}>
            <h2>El catálogo no está disponible en este entorno</h2>
            <p>Volvé a intentar más tarde.</p>
          </section>
        ) : (
          <TournamentCatalog
            service={service}
            entryPath={(item) => `/torneos/publico/${encodeURIComponent(item.publicSlug)}`}
          />
        )}
      </main>
    </div>
  );
}
