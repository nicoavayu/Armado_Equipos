import React, { useEffect, useState } from 'react';
import { ArrowRight, Compass, Inbox } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTorneosWorkspace } from '../../context/TorneosWorkspaceContext';
import { useTorneosFeatures } from '../../context/TorneosFeaturesContext';
import { canonicalRoutes } from '../../routing/canonicalRoutes';
import CatalogStateChip from './CatalogStateChip';
import styles from './ConnectedProduct.module.css';

// Where an organizer reaches the call for teams and the requests of a tournament, from its teams screen.
export default function CatalogEntryStrip({ organizationId, tournamentId }) {
  const { service } = useTorneosWorkspace();
  const features = useTorneosFeatures();
  const supported = features.catalog_management !== false && typeof service?.loadCatalogListingSettings === 'function';
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    if (!supported || !tournamentId) return undefined;
    let active = true;
    service.loadCatalogListingSettings({ organizationId, tournamentId })
      .then((value) => { if (active) setSettings(value); })
      .catch(() => { if (active) setSettings(null); });
    return () => { active = false; };
  }, [organizationId, service, supported, tournamentId]);

  if (!supported || !settings) return null;
  const pending = (settings.categories || []).reduce((total, category) => total + Number(category.pending || 0), 0);
  return (
    <section className={styles.catalogStrip} aria-label="Convocatoria a equipos">
      <div>
        <Compass size={18} aria-hidden="true" />
        <span>
          <strong>Explorar torneos</strong>
          <small>
            {settings.visibleInCatalog
              ? 'La convocatoria está publicada en el catálogo.'
              : 'El torneo no aparece en el catálogo de Arma2.'}
          </small>
        </span>
        {settings.visibleInCatalog && <CatalogStateChip state={settings.catalogState} />}
      </div>
      <nav>
        <Link className={styles.secondaryAction} to={canonicalRoutes.tournamentApplications(organizationId, tournamentId)}>
          <Inbox size={16} aria-hidden="true" /> Solicitudes{pending > 0 ? ` (${pending})` : ''}
        </Link>
        <Link className={styles.textAction} to={canonicalRoutes.tournamentCatalogListing(organizationId, tournamentId)}>
          Convocatoria <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </nav>
    </section>
  );
}
