import React, { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, ShieldCheck, UserCheck, UsersRound } from 'lucide-react';
import styles from './TournamentPublicPageSettings.module.css';

// OFFICIALIZATION-V1: política de doble control de actas del torneo. Sólo el propietario la
// cambia (el backend lo exige); el resto la consulta. Apagada por defecto: un organizador
// único presenta y oficializa sus actas. Encendida: quien presenta no puede validar.
export default function MatchDualControlSettings({ organizationId, tournamentId, service }) {
  const [state, setState] = useState({ status: 'loading', policy: null, error: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const policy = await service.loadMatchDualControl({ organizationId, tournamentId });
      setState({ status: 'ready', policy, error: '' });
    } catch (error) {
      setState({ status: 'error', policy: null, error: error?.message || 'No pudimos cargar la política de doble control.' });
    }
  }, [organizationId, service, tournamentId]);

  useEffect(() => { load(); }, [load]);

  const change = async (enabled) => {
    const question = enabled
      ? '¿Activar el doble control? Desde ahora, quien presenta un acta no podrá validarla: hará falta otro Administrador.'
      : '¿Desactivar el doble control? Un Administrador podrá validar y oficializar el acta que presentó.';
    if (!window.confirm(question)) return;
    setBusy(true);
    setState((current) => ({ ...current, error: '' }));
    try {
      const policy = await service.setMatchDualControl({ organizationId, tournamentId, enabled });
      setState({ status: 'ready', policy, error: '' });
    } catch (error) {
      setState((current) => ({ ...current, error: error?.message || 'No pudimos cambiar la política.' }));
    } finally {
      setBusy(false);
    }
  };

  const policy = state.policy;
  const needsSecondValidator = policy && !policy.enabled && policy.eligibleValidators < 2;
  return (
    <section className={styles.publicSettings} aria-labelledby="dual-control-title">
      <div className={styles.iconBlock}><ShieldCheck size={25} /></div>
      <div className={styles.copy}>
        <span className={styles.kicker}>Resultados oficiales</span>
        <h2 id="dual-control-title">Doble control de actas</h2>
        <p>
          Apagado, cualquier Propietario o Administrador con acceso a la temporada carga el resultado y lo
          oficializa. Encendido, quien presenta el acta no puede validarla: otra persona autorizada debe hacerlo.
        </p>
        {state.status === 'loading' && <span className={styles.loading}><LoaderCircle size={15} /> Consultando política…</span>}
        {state.status === 'error' && <button type="button" className={styles.retry} onClick={load}>Reintentar carga</button>}
        {policy && (
          <div className={styles.statusLine} data-published={policy.enabled}>
            {policy.enabled ? <UsersRound size={15} /> : <UserCheck size={15} />}
            <b>{policy.enabled ? 'Activado' : 'Desactivado'}</b>
            <span>
              {policy.enabled
                ? 'Se necesitan dos personas distintas para oficializar.'
                : 'Un organizador puede oficializar sus propias actas.'}
            </span>
          </div>
        )}
        {needsSecondValidator && policy.canManage && (
          <p className={styles.eligibility}>
            Para activarlo invitá a otro Administrador y asignale esta temporada.
          </p>
        )}
        {state.error && <p className={styles.error} role="alert">{state.error}</p>}
      </div>
      {policy && (
        <div className={styles.actions}>
          {policy.canManage && !policy.readOnly && (
            <button
              type="button"
              className={policy.enabled ? styles.unpublish : styles.publish}
              disabled={busy || needsSecondValidator}
              onClick={() => change(!policy.enabled)}
            >
              <ShieldCheck size={16} />
              {busy ? 'Guardando…' : (policy.enabled ? 'Desactivar doble control' : 'Activar doble control')}
            </button>
          )}
          {policy.readOnly && <span className={styles.readOnly}>La competencia está cerrada: la política no se modifica.</span>}
          {!policy.canManage && <span className={styles.readOnly}>Sólo el Propietario puede cambiar esta política.</span>}
        </div>
      )}
    </section>
  );
}
