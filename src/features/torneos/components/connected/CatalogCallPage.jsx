import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ExternalLink,
  Send,
  Share2,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useTorneosFeatures } from '../../context/TorneosFeaturesContext';
import CatalogCallSection from './CatalogCallSection';
import { useCatalogService } from './useCatalogService';
import styles from './ConnectedProduct.module.css';

export function publicTournamentUrl(publicSlug) {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}/torneos/publico/${encodeURIComponent(publicSlug)}`;
}

// Sharing is how a player without authority over the team gets the call to the person who has it.
export function ShareCallButton({ publicSlug, tournamentName }) {
  const [copied, setCopied] = useState('');
  const share = async () => {
    const url = publicTournamentUrl(publicSlug);
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title: tournamentName, text: `Convocatoria: ${tournamentName}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied('Enlace copiado');
    } catch {
      setCopied('');
    }
  };
  return (
    <button type="button" className={styles.secondaryAction} onClick={share}>
      <Share2 size={17} aria-hidden="true" />
      {copied || 'Compartir convocatoria'}
    </button>
  );
}

// The call of one tournament inside the app: the participant's navigation stays around it, and «Volver» returns to
// the catalog, never to another product.
export default function CatalogCallPage() {
  const { publicSlug } = useParams();
  const service = useCatalogService();
  const features = useTorneosFeatures();
  const [state, setState] = useState({ status: 'loading', entry: null, error: '' });

  useEffect(() => {
    let active = true;
    setState({ status: 'loading', entry: null, error: '' });
    service.loadEntry(publicSlug)
      .then((entry) => { if (active) setState({ status: entry ? 'ready' : 'missing', entry, error: '' }); })
      .catch((error) => { if (active) setState({ status: 'error', entry: null, error: error?.message || '' }); });
    return () => { active = false; };
  }, [publicSlug, service]);

  return (
    <div className={styles.page}>
      <Link className={styles.backLink} to="/torneos/explorar">
        <ArrowLeft size={17} aria-hidden="true" /> Explorar torneos
      </Link>

      {state.status === 'loading' && <div className={styles.skeletonBlock} role="status"><span className={styles.srOnly}>Cargando convocatoria…</span></div>}

      {state.status === 'error' && (
        <section className={styles.stateCard} role="alert">
          <h1>No pudimos cargar la convocatoria</h1>
          <p>{state.error || 'Probá de nuevo en unos minutos.'}</p>
        </section>
      )}

      {state.status === 'missing' && (
        <section className={styles.stateCard}>
          <h1>Esta convocatoria ya no está publicada</h1>
          <p>La organización la retiró del catálogo o el torneo ya no recibe equipos.</p>
          <Link className={styles.secondaryAction} to="/torneos/explorar">Ver otras convocatorias</Link>
        </section>
      )}

      {state.status === 'ready' && (
        <CatalogCallSection
          entry={state.entry}
          headingLevel={1}
          actions={(
            <>
              {state.entry.state === 'open' && features.tournament_applications !== false && (
                <Link className={styles.primaryAction} to={`/torneos/explorar/${encodeURIComponent(publicSlug)}/solicitar`}>
                  <Send size={17} aria-hidden="true" />
                  Solicitar inscripción
                </Link>
              )}
              <ShareCallButton publicSlug={publicSlug} tournamentName={state.entry.tournamentName} />
              <Link
                className={styles.textAction}
                to={`/torneos/publico/${encodeURIComponent(publicSlug)}`}
                state={{ from: `/torneos/explorar/${publicSlug}` }}
              >
                Página pública del torneo <ExternalLink size={14} aria-hidden="true" />
              </Link>
            </>
          )}
        />
      )}
    </div>
  );
}
