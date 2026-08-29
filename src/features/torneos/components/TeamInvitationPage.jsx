import React, { useState } from 'react';
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import { canonicalRoutes } from '../routing/canonicalRoutes';
import styles from './TeamRegistration.module.css';

export default function TeamInvitationPage() {
  const { token } = useParams();
  const { service } = useTorneosWorkspace();
  const [state, setState] = useState({ status: 'idle', result: null, error: '' });
  const accept = async () => {
    setState({ status: 'loading', result: null, error: '' });
    try {
      const result = await service.acceptTeamInvitation(token);
      setState({ status: 'success', result, error: '' });
    } catch (error) {
      setState({ status: 'error', result: null, error: error.message });
    }
  };
  return (
    <div className={styles.invitationPage}>
      <section className={styles.invitationCard}>
        <span className={styles.invitationMark}><ShieldCheck size={28} /></span>
        <span className={styles.kicker}>Invitación privada</span>
        <h1>Responsable de equipo</h1>
        <p>
          Iniciá sesión con el mismo email que recibió esta invitación. El enlace
          es de un solo uso y no revela datos del equipo hasta confirmar.
        </p>
        {state.status === 'error' && <div className={styles.errorBanner} role="alert"><XCircle size={17} />{state.error}</div>}
        {state.status === 'success' ? (
          <>
            <div className={styles.successBanner}><CheckCircle2 size={17} />Invitación aceptada.</div>
            <Link className={styles.primaryButton} to={canonicalRoutes.organizationTeamEntryRegistration(
              state.result.organizationId,
              state.result.teamEntryId,
            )}>Abrir inscripción</Link>
          </>
        ) : (
          <button className={styles.primaryButton} type="button" onClick={accept} disabled={state.status === 'loading'}>
            {state.status === 'loading' ? <Loader2 className={styles.spin} size={18} /> : <ShieldCheck size={18} />}
            Aceptar invitación
          </button>
        )}
      </section>
    </div>
  );
}
