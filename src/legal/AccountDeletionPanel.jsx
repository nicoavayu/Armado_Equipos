import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { clearLocalAuthSession } from '../services/authLogoutService';
import { isIosNativePlatform, requestAppleAuthorizationCodeForDeletion } from '../services/auth/appleDeletionReauth';
import AppleUnlinkSteps from './AppleUnlinkSteps';
import {
  ACCOUNT_DELETION_SHORT,
  APPLE_NO_REAUTH_NOTICE,
  APPLE_REAUTH_DECLINED,
  APPLE_REAUTH_NOTICE,
  APPLE_UNLINK_MANUAL,
  hasAppleIdentity,
  runAccountDeletion,
} from './accountDeletion';

// Eliminar la cuenta desde la web (o la app) con la sesión iniciada en este navegador: el MISMO flujo que Perfil → Eliminar
// cuenta (la función delete-account de Core, que primero borra en Torneos). Sin sesión, la página ofrece el pedido por email.
// Torneos (también dentro de la app de iPhone) llega acá desde Perfil → Eliminar cuenta: en iOS nativo, una cuenta de
// Apple confirma con Apple antes (revocación); en la web y en Android no hay hoja de Apple y se muestran los pasos a mano.
export default function AccountDeletionPanel({
  client = supabase,
  clearSession = clearLocalAuthSession,
  isIosNative = isIosNativePlatform,
  getAppleAuthorizationCode = requestAppleAuthorizationCodeForDeletion,
}) {
  const [session, setSession] = useState({ status: 'loading', email: null, user: null });
  const [confirmation, setConfirmation] = useState('');
  const [state, setState] = useState({ status: 'idle', message: '' });

  useEffect(() => {
    let active = true;
    Promise.resolve(client?.auth?.getSession?.())
      .then((result) => {
        const current = result?.data?.session;
        if (active) {
          setSession(current
            ? { status: 'signed-in', email: current.user?.email || null, user: current.user || null }
            : { status: 'signed-out', email: null, user: null });
        }
      })
      .catch(() => { if (active) setSession({ status: 'signed-out', email: null, user: null }); });
    return () => { active = false; };
  }, [client]);

  const isApple = hasAppleIdentity(session.user);
  const appleOnThisDevice = isApple && isIosNative();
  const canConfirm = confirmation.trim().toUpperCase() === 'ELIMINAR' && state.status !== 'deleting';

  const remove = async ({ withoutApple = false } = {}) => {
    setState({ status: 'deleting', message: '' });
    try {
      const outcome = await runAccountDeletion({ client, user: session.user, isIosNative, getAppleAuthorizationCode, withoutApple });
      if (outcome.status === 'apple_declined') {
        setState({ status: 'apple-declined', message: '' });
        return;
      }
      await clearSession();
      setState({ status: 'deleted', message: '', appleUnlinkNeeded: outcome.appleUnlinkNeeded });
    } catch (error) {
      setState({ status: 'error', message: error?.message || 'No se pudo eliminar la cuenta. Intentá de nuevo más tarde.' });
    }
  };
  const submit = async (event) => {
    event.preventDefault();
    if (!canConfirm) return;
    await remove();
  };

  if (state.status === 'deleted') {
    return (
      <div role="status">
        <p><strong>Tu cuenta fue eliminada</strong> y cerramos tu sesión en este navegador.</p>
        {state.appleUnlinkNeeded && (
          <>
            <p>{APPLE_UNLINK_MANUAL}</p>
            <AppleUnlinkSteps />
          </>
        )}
      </div>
    );
  }
  if (state.status === 'apple-declined') {
    return (
      <div role="alert">
        <p>{APPLE_REAUTH_DECLINED}</p>
        <AppleUnlinkSteps />
        <button type="button" onClick={() => remove({ withoutApple: true })}>Eliminar igual</button>{' '}
        <button type="button" onClick={() => setState({ status: 'idle', message: '' })}>Volver</button>
      </div>
    );
  }
  if (session.status === 'loading') return <p>Revisando si tenés la sesión iniciada…</p>;
  if (session.status === 'signed-out') {
    return (
      <p>
        No tenés la sesión iniciada en este navegador. Iniciá sesión en <a href="/login">Arma2</a>, entrá a{' '}
        <strong>Torneos → Perfil → Eliminar cuenta</strong> y vas a volver a esta página con el botón para eliminarla. Si no
        podés iniciar sesión, usá el pedido por email de abajo.
      </p>
    );
  }
  return (
    <form onSubmit={submit} aria-label="Eliminar mi cuenta">
      <p>
        Tenés la sesión iniciada{session.email ? <> como <strong>{session.email}</strong></> : null}. {ACCOUNT_DELETION_SHORT}{' '}
        <strong>No se puede deshacer.</strong>
      </p>
      {isApple && <p>{appleOnThisDevice ? APPLE_REAUTH_NOTICE : APPLE_NO_REAUTH_NOTICE}</p>}
      <label>
        Escribí ELIMINAR para confirmar
        <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" placeholder="ELIMINAR" />
      </label>
      <button type="submit" disabled={!canConfirm}>{state.status === 'deleting' ? 'Eliminando…' : 'Eliminar mi cuenta'}</button>
      {state.status === 'error' && <p role="alert">{state.message}</p>}
    </form>
  );
}
