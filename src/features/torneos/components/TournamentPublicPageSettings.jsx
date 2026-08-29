import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Globe2,
  LoaderCircle,
  LockKeyhole,
  Radio,
} from 'lucide-react';
import { tournamentWorkspaceService } from '../api/tournamentWorkspaceService';
import styles from './TournamentPublicPageSettings.module.css';

const REASONS = {
  organization_inactive: 'La organización debe estar activa.',
  season_archived: 'La temporada está archivada.',
  tournament_not_publishable: 'Pasá el torneo a Inscripción, Programado, En juego o Finalizado.',
  tournament_unavailable: 'El torneo no está disponible.',
};

export default function TournamentPublicPageSettings({
  organizationId,
  tournamentId,
  canPublish,
  service = tournamentWorkspaceService,
}) {
  const [state, setState] = useState({ status: 'loading', settings: null, error: '' });
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setState((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const settings = await service.loadPublicPageSettings({ organizationId, tournamentId });
      setState({ status: 'ready', settings, error: '' });
    } catch (error) {
      setState({ status: 'error', settings: null, error: error?.message || 'No pudimos cargar la publicación.' });
    }
  }, [organizationId, service, tournamentId]);

  useEffect(() => { load(); }, [load]);

  const publicUrl = useMemo(() => (
    state.settings?.publicPath
      ? `${window.location.origin}${state.settings.publicPath}`
      : ''
  ), [state.settings]);

  const changePublication = async (published) => {
    setBusy(published ? 'publish' : 'unpublish');
    setState((current) => ({ ...current, error: '' }));
    try {
      const settings = await service.setPublicPagePublished({
        organizationId,
        tournamentId,
        published,
      });
      setState({ status: 'ready', settings, error: '' });
    } catch (error) {
      setState((current) => ({ ...current, error: error?.message || 'No pudimos actualizar la publicación.' }));
    } finally {
      setBusy('');
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setState((current) => ({ ...current, error: 'No pudimos copiar el enlace. Seleccionalo manualmente.' }));
    }
  };

  return (
    <section className={styles.publicSettings} aria-labelledby="public-page-title">
      <div className={styles.iconBlock}><Globe2 size={25} /></div>
      <div className={styles.copy}>
        <span className={styles.kicker}>Visibilidad externa</span>
        <h2 id="public-page-title">Página pública</h2>
        <p>Compartí fixture, resultados, tabla y estadísticas oficiales sin pedir una cuenta de Arma2.</p>
        {state.status === 'loading' && <span className={styles.loading}><LoaderCircle size={15} /> Consultando estado…</span>}
        {state.status === 'error' && <button type="button" className={styles.retry} onClick={load}>Reintentar carga</button>}
        {state.settings && (
          <div className={styles.statusLine} data-published={state.settings.published}>
            {state.settings.published ? <Radio size={15} /> : <LockKeyhole size={15} />}
            <b>{state.settings.published ? 'Publicada' : 'No publicada'}</b>
            <span>{state.settings.published ? 'Cualquier persona con el enlace puede verla.' : 'Sólo tu equipo de organización puede verla.'}</span>
          </div>
        )}
        {state.settings && !state.settings.eligible && (
          <p className={styles.eligibility}>{REASONS[state.settings.unavailableReason] || 'El torneo no está en un estado publicable.'}</p>
        )}
        {state.error && <p className={styles.error} role="alert">{state.error}</p>}
      </div>
      {state.settings && (
        <div className={styles.actions}>
          {state.settings.published && publicUrl && (
            <>
              <div className={styles.linkBox}>
                <input aria-label="Enlace público" value={publicUrl} readOnly onFocus={(event) => event.target.select()} />
                <button type="button" onClick={copyLink} aria-label="Copiar enlace público">
                  {copied ? <Check size={17} /> : <Copy size={17} />}
                </button>
              </div>
              <a href={state.settings.publicPath} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Abrir página</a>
            </>
          )}
          {canPublish && !state.settings.published && (
            <button type="button" className={styles.publish} disabled={!state.settings.eligible || Boolean(busy)} onClick={() => changePublication(true)}>
              <Globe2 size={17} /> {busy === 'publish' ? 'Publicando…' : 'Publicar página'}
            </button>
          )}
          {canPublish && state.settings.published && (
            <button type="button" className={styles.unpublish} disabled={Boolean(busy)} onClick={() => changePublication(false)}>
              <LockKeyhole size={16} /> {busy === 'unpublish' ? 'Despublicando…' : 'Despublicar'}
            </button>
          )}
          {!canPublish && <span className={styles.readOnly}>Tu rol puede consultar el estado, pero no cambiarlo.</span>}
        </div>
      )}
    </section>
  );
}
