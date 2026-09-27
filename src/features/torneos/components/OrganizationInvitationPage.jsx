import React, { useState } from 'react';
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useTorneosWorkspace } from '../context/TorneosWorkspaceContext';
import { getRoleLabel } from '../domain/capabilities';
import { canonicalRoutes } from '../routing/canonicalRoutes';
import styles from './TeamRegistration.module.css';

// OFFICIALIZATION-V1: aceptar la invitación a una organización. El backend exige que el
// email verificado de la cuenta de Arma2 sea el invitado (contrato Core verified_email),
// así que la pantalla no pide ni muestra datos de la organización hasta confirmar.
export default function OrganizationInvitationPage() {
  const { token } = useParams();
  const { service, refresh } = useTorneosWorkspace();
  const [state, setState] = useState({ status: 'idle', result: null, error: '' });
  const available = typeof service?.acceptOrganizationInvitation === 'function';
  const accept = async () => {
    setState({ status: 'loading', result: null, error: '' });
    try {
      const result = await service.acceptOrganizationInvitation(token);
      setState({ status: 'success', result, error: '' });
      refresh?.({ background: true })?.catch?.(() => {});
    } catch (error) {
      setState({ status: 'error', result: null, error: error.message });
    }
  };
  return (
    <div className={styles.invitationPage}>
      <section className={styles.invitationCard}>
        <span className={styles.invitationMark}><ShieldCheck size={28} /></span>
        <span className={styles.kicker}>Invitación privada</span>
        <h1>Sumate a una organización</h1>
        <p>
          Iniciá sesión con el mismo email que recibió esta invitación. El enlace es de un
          solo uso y vence a los 7 días.
        </p>
        {!available && (
          <div className={styles.errorBanner} role="alert">
            <XCircle size={17} />
            Las invitaciones a organizaciones no están disponibles en este entorno.
          </div>
        )}
        {state.status === 'error' && <div className={styles.errorBanner} role="alert"><XCircle size={17} />{state.error}</div>}
        {state.status === 'success' ? (
          <>
            <div className={styles.successBanner}>
              <CheckCircle2 size={17} />
              Ya sos {getRoleLabel(state.result.role)} de {state.result.organizationName}.
            </div>
            <Link className={styles.primaryButton} to={canonicalRoutes.organizationRoot(state.result.organizationId)}>
              Abrir organización
            </Link>
          </>
        ) : (
          <button
            className={styles.primaryButton}
            type="button"
            onClick={accept}
            disabled={!available || state.status === 'loading'}
          >
            {state.status === 'loading' ? <Loader2 className={styles.spin} size={18} /> : <ShieldCheck size={18} />}
            Aceptar invitación
          </button>
        )}
      </section>
    </div>
  );
}
