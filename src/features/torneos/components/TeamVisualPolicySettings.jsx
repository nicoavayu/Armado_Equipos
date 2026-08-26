import React, { useCallback, useEffect, useState } from 'react';
import { ImageUp, LoaderCircle } from 'lucide-react';
import { tournamentWorkspaceService } from '../api/tournamentWorkspaceService';
import { TEAM_VISUAL_POLICY_OPTIONS } from '../domain/teamVisualPolicy';
import styles from './TeamVisualPolicySettings.module.css';

/**
 * La configuración de autogestión visual del torneo.
 *
 * El control se habilita con `canUpdate`, que llega del servidor junto con el
 * valor: la pantalla no decide permisos, los refleja. Si alguien igual llama a
 * la RPC, la RPC vuelve a chequear.
 */
export default function TeamVisualPolicySettings({
  organizationId,
  tournamentId,
  service = tournamentWorkspaceService,
}) {
  const [state, setState] = useState({ status: 'loading', settings: null, error: '' });
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setState((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const settings = await service.loadTeamVisualPolicy({ organizationId, tournamentId });
      setState({ status: 'ready', settings, error: '' });
    } catch (error) {
      setState({
        status: 'error',
        settings: null,
        error: error?.message || 'No pudimos cargar la gestión de imágenes.',
      });
    }
  }, [organizationId, service, tournamentId]);

  useEffect(() => { load(); }, [load]);

  const changePolicy = async (policy) => {
    if (busy || state.settings?.policy === policy) return;
    setBusy(policy);
    setState((current) => ({ ...current, error: '' }));
    try {
      const settings = await service.setTeamVisualPolicy({
        organizationId,
        tournamentId,
        policy,
      });
      setState({ status: 'ready', settings, error: '' });
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error?.message || 'No pudimos actualizar la gestión de imágenes.',
      }));
    } finally {
      setBusy('');
    }
  };

  const canUpdate = state.settings?.canUpdate === true;

  return (
    <section className={styles.visualPolicy} aria-labelledby="team-visual-policy-title">
      <div className={styles.iconBlock}><ImageUp size={25} /></div>
      <div className={styles.copy}>
        <span className={styles.kicker}>Autogestión del equipo</span>
        <h2 id="team-visual-policy-title">Gestión de imágenes por los equipos</h2>
        <p>Elegí quién puede mantener actualizados el escudo y las fotos de cada equipo.</p>
        {state.status === 'loading' && (
          <span className={styles.loading}><LoaderCircle size={15} /> Consultando configuración…</span>
        )}
        {state.status === 'error' && (
          <button type="button" className={styles.retry} onClick={load}>Reintentar carga</button>
        )}
        <p className={styles.help}>
          Cada usuario sólo puede gestionar imágenes de su propio equipo. La organización
          siempre puede editar o quitar cualquier imagen.
        </p>
        {state.error && <p className={styles.error} role="alert">{state.error}</p>}
      </div>
      {state.settings && (
        <div className={styles.options} role="radiogroup" aria-label="Gestión de imágenes por los equipos">
          {TEAM_VISUAL_POLICY_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={styles.option}
              data-selected={state.settings.policy === option.value}
            >
              <input
                type="radio"
                name="team-visual-policy"
                value={option.value}
                checked={state.settings.policy === option.value}
                disabled={!canUpdate || Boolean(busy)}
                onChange={() => changePolicy(option.value)}
              />
              <span>
                <b>{option.label}</b>
                <small>{option.description}</small>
              </span>
              {busy === option.value && <LoaderCircle className={styles.optionSpinner} size={15} />}
            </label>
          ))}
          {!canUpdate && (
            <span className={styles.readOnly}>
              Tu rol puede consultar esta configuración, pero no cambiarla.
            </span>
          )}
        </div>
      )}
    </section>
  );
}
