import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { clearLocalAuthSession } from '../services/authLogoutService';
import { ACCOUNT_DELETION_SHORT, requestCoreAccountDeletion } from './accountDeletion';

// Eliminar la cuenta desde la web (o la app) con la sesión iniciada en este navegador: el MISMO flujo que Perfil → Eliminar
// cuenta (la función delete-account de Core, que primero borra en Torneos). Sin sesión, la página ofrece el pedido por email.
export default function AccountDeletionPanel({ client = supabase, clearSession = clearLocalAuthSession }) {
  const [session, setSession] = useState({ status: 'loading', email: null });
  const [confirmation, setConfirmation] = useState('');
  const [state, setState] = useState({ status: 'idle', message: '' });

  useEffect(() => {
    let active = true;
    Promise.resolve(client?.auth?.getSession?.())
      .then((result) => {
        const current = result?.data?.session;
        if (active) setSession(current ? { status: 'signed-in', email: current.user?.email || null } : { status: 'signed-out', email: null });
      })
      .catch(() => { if (active) setSession({ status: 'signed-out', email: null }); });
    return () => { active = false; };
  }, [client]);

  const canConfirm = confirmation.trim().toUpperCase() === 'ELIMINAR' && state.status !== 'deleting';
  const submit = async (event) => {
    event.preventDefault();
    if (!canConfirm) return;
    setState({ status: 'deleting', message: '' });
    try {
      await requestCoreAccountDeletion(client);
      await clearSession();
      setState({ status: 'deleted', message: '' });
    } catch (error) {
      setState({ status: 'error', message: error?.message || 'No se pudo eliminar la cuenta. Intentá de nuevo más tarde.' });
    }
  };

  if (state.status === 'deleted') {
    return <p role="status"><strong>Tu cuenta fue eliminada</strong> y cerramos tu sesión en este navegador.</p>;
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
      <label>
        Escribí ELIMINAR para confirmar
        <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" placeholder="ELIMINAR" />
      </label>
      <button type="submit" disabled={!canConfirm}>{state.status === 'deleting' ? 'Eliminando…' : 'Eliminar mi cuenta'}</button>
      {state.status === 'error' && <p role="alert">{state.message}</p>}
    </form>
  );
}
