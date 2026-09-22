import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../components/AuthProvider';
import { supabaseCore } from '../../../lib/supabaseClient';
import { signOutWithPushDeactivation } from '../../../services/authLogoutService';
import { createTorneosClient } from './createTorneosClient';
import { isolatedOrigin } from './config';

export default function IsolatedTorneosPage() {
  const { user, profile } = useAuth();
  const [state, setState] = useState({ status: 'Verificando acceso…', rows: [] });
  const [attempt, setAttempt] = useState(0);
  const clientRef = useRef(null);
  useEffect(() => {
    const client = createTorneosClient(supabaseCore, {
      origin: isolatedOrigin, anonKey: process.env.REACT_APP_SUPABASE_ANON_KEY,
    });
    clientRef.current = client;
    return () => { client.dispose(); clientRef.current = null; };
  }, []);
  useEffect(() => {
    let active = true;
    setState({ status: 'Verificando acceso…', rows: [] });
    async function load() {
      try {
        const { data, error } = await clientRef.current.supabaseTorneos.from('sso_probe').select('id,identity_id,note');
        if (error) throw error;
        if (active) setState({ status: 'Acceso Torneos confirmado', rows: data });
      } catch {
        if (active) setState({ status: 'Torneos no disponible. Tu sesión Arma2 sigue independiente.', rows: [] });
      }
    }
    load();
    return () => { active = false; };
  }, [user?.id, attempt]);
  return <main style={{ minHeight: '100dvh', background: '#0c0a1d', color: '#f7f3ff', padding: '32px', maxWidth: '100%' }}>
    <header><Link to="/">ARMA2</Link><h1>Torneos</h1><p>Prueba local · entorno aislado</p></header>
    <p>{profile?.nombre || 'Usuario Arma2'}</p>
    <p role="status">{state.status}</p>
    <ul>{state.rows.map(row => <li key={row.id}>{row.note}</li>)}</ul>
    <nav style={{ display: 'flex', gap: 24, marginTop: 24 }}>
      <Link to="/">Volver a Arma2</Link>
      <button onClick={() => setAttempt(n => n + 1)}>Verificar acceso</button>
      <button onClick={async () => {
        const result = await signOutWithPushDeactivation();
        if (!result.success) setState({ status: 'No se pudo cerrar la sesión Arma2.', rows: [] });
      }}>Cerrar sesión</button>
    </nav>
  </main>;
}
