import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {
  QA_SAFE_FALLBACK_PATH,
  sanitizeReturnTo,
} from './qaRoleSwitcher';
import {
  fetchQaRoles,
  resolveCurrentIdentity,
  switchQaRole,
} from './qaRoleSwitcherClient';

//
// Tooling QA, no una feature de producto: consistente con Torneos en paleta y
// tipografía, sin pretender más que eso. Lo único que la pantalla promete es
// que se entiende de un vistazo en qué entorno estás y con qué identidad.
//
const palette = {
  background: '#0c0a1d',
  surface: '#171334',
  border: '#2c2559',
  text: '#f7f3ff',
  muted: '#b3a9dd',
  accent: '#7c5cff',
  warn: '#ffd166',
  danger: '#ff6b6b',
};

const styles = {
  page: {
    minHeight: '100dvh',
    background: palette.background,
    color: palette.text,
    padding: '24px 16px 48px',
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
  },
  shell: { maxWidth: 720, margin: '0 auto', display: 'grid', gap: 20 },
  banner: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'start',
    padding: '6px 12px',
    borderRadius: 999,
    border: `1px solid ${palette.warn}`,
    color: palette.warn,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  title: { margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-0.01em' },
  current: {
    background: palette.surface,
    border: `1px solid ${palette.border}`,
    borderRadius: 14,
    padding: 16,
    display: 'grid',
    gap: 4,
  },
  label: { fontSize: 12, color: palette.muted, textTransform: 'uppercase', letterSpacing: '0.08em' },
  value: { fontSize: 20, fontWeight: 700 },
  list: { display: 'grid', gap: 10 },
  card: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 12,
    alignItems: 'center',
    background: palette.surface,
    border: `1px solid ${palette.border}`,
    borderRadius: 14,
    padding: 14,
  },
  roleName: { fontSize: 16, fontWeight: 700, margin: 0 },
  roleDescription: { fontSize: 13, color: palette.muted, margin: '4px 0 0' },
  button: {
    minHeight: 44,
    padding: '0 18px',
    borderRadius: 10,
    border: 'none',
    background: palette.accent,
    color: palette.text,
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
  },
  buttonDisabled: { background: palette.border, color: palette.muted, cursor: 'not-allowed' },
  activeTag: { fontSize: 12, color: palette.muted, fontWeight: 700 },
  note: { fontSize: 13, color: palette.muted, margin: 0 },
  error: { fontSize: 13, color: palette.danger, margin: 0 },
};

function formatExpiry(secondsLeft) {
  if (!secondsLeft) return 'sesión vencida';
  const hours = Math.floor(secondsLeft / 3600);
  const minutes = Math.floor((secondsLeft % 3600) / 60);
  if (hours > 0) return `vence en ${hours} h ${minutes} min`;
  return `vence en ${minutes} min`;
}

export default function QaRoleSwitcherPage({
  supabaseUrl = process.env.REACT_APP_SUPABASE_URL,
  anonKey = process.env.REACT_APP_SUPABASE_ANON_KEY,
  storage = typeof window === 'undefined' ? null : window.localStorage,
  viewStorage = typeof window === 'undefined' ? null : window.sessionStorage,
  location = typeof window === 'undefined' ? null : window.location,
  navigate = (target) => { window.location.assign(target); },
}) {
  const [roles, setRoles] = useState([]);
  const [storageKey, setStorageKey] = useState(null);
  const [identity, setIdentity] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [pendingRole, setPendingRole] = useState(null);

  const returnTo = useMemo(() => sanitizeReturnTo(
    new URLSearchParams(location?.search || '').get('returnTo'),
    { origin: location?.origin },
  ), [location?.search, location?.origin]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const payload = await fetchQaRoles();
        if (cancelled) return;
        setRoles(payload.roles || []);
        setStorageKey(payload.storageKey || null);
        const current = await resolveCurrentIdentity({
          supabaseUrl, anonKey, storage, storageKey: payload.storageKey,
        });
        if (cancelled) return;
        setIdentity(current);
        setStatus('ready');
      } catch (bridgeError) {
        if (cancelled) return;
        setError(bridgeError.message);
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [supabaseUrl, anonKey, storage]);

  const onSelect = useCallback(async (role) => {
    setPendingRole(role);
    setError(null);
    try {
      const result = await switchQaRole({
        role, supabaseUrl, anonKey, storage, sessionStorage: viewStorage, returnTo,
      });
      navigate(result.path || QA_SAFE_FALLBACK_PATH);
    } catch (switchError) {
      setError(switchError.message);
      setPendingRole(null);
    }
  }, [supabaseUrl, anonKey, storage, viewStorage, returnTo, navigate]);

  return (
    <main style={styles.page}>
      <div style={styles.shell}>
        <span style={styles.banner}>Entorno QA local</span>
        <h1 style={styles.title}>QA · Cambiar rol</h1>

        <section style={styles.current} aria-label="Sesión actual">
          <span style={styles.label}>Sesión actual</span>
          <span style={styles.value}>
            {status === 'loading' ? 'Consultando Auth local…' : (identity?.qaRole || 'Sin sesión')}
          </span>
          <span style={styles.note}>
            {identity?.email
              ? `Identidad reconocida por Auth local: ${identity.email}`
              : 'Auth local no reconoce ninguna sesión en este navegador.'}
          </span>
        </section>

        {returnTo ? (
          <p style={styles.note}>
            Al cambiar de rol se vuelve a <strong>{returnTo}</strong> si el rol nuevo tiene
            acceso; si no, a {QA_SAFE_FALLBACK_PATH}.
          </p>
        ) : (
          <p style={styles.note}>Al cambiar de rol se entra por {QA_SAFE_FALLBACK_PATH}.</p>
        )}

        {error ? <p style={styles.error} role="alert">{error}</p> : null}

        <section style={styles.list} aria-label="Roles QA disponibles">
          {roles.map((entry) => {
            const isCurrent = identity?.qaRole === entry.role;
            const disabled = !entry.available || pendingRole !== null;
            return (
              <article key={entry.role} style={styles.card}>
                <div>
                  <p style={styles.roleName}>{entry.label}</p>
                  <p style={styles.roleDescription}>{entry.description}</p>
                  <p style={styles.roleDescription}>
                    {entry.available ? formatExpiry(entry.secondsLeft) : (entry.reason || 'no disponible')}
                  </p>
                </div>
                {isCurrent ? (
                  <span style={styles.activeTag}>Sesión actual</span>
                ) : (
                  <button
                    type="button"
                    style={disabled ? { ...styles.button, ...styles.buttonDisabled } : styles.button}
                    disabled={disabled}
                    onClick={() => onSelect(entry.role)}
                  >
                    {pendingRole === entry.role ? 'Entrando…' : `Entrar como ${entry.label}`}
                  </button>
                )}
              </article>
            );
          })}
        </section>

        <p style={styles.note}>
          Las sesiones QA se preparan y se renuevan con
          {' '}<code>npm run qa:torneos:review -- --start</code>. Viven fuera del repositorio,
          en archivos locales 0600, y nunca se muestran acá.
          {storageKey ? '' : ' El puente no informó la clave de sesión.'}
        </p>
      </div>
    </main>
  );
}
