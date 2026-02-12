import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { useAuth } from '../components/AuthProvider';
import PageTitle from '../components/PageTitle';
import { useNavigate } from 'react-router-dom';

const CheckCard = ({ title, status, latency, error }) => (
  <div style={{
    background: 'rgba(255,255,255,0.08)',
    border: `2px solid ${status === 'OK' ? '#4CAF50' : status === 'FAIL' ? '#DE1C49' : '#FFA500'}`,
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '12px',
  }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
      <h3 style={{ margin: 0, color: 'white', fontFamily: 'Bebas Neue, Arial, sans-serif', fontSize: '20px' }}>
        {title}
      </h3>
      <span style={{
        background: status === 'OK' ? '#4CAF50' : status === 'FAIL' ? '#DE1C49' : '#FFA500',
        color: 'white',
        padding: '4px 12px',
        borderRadius: '6px',
        fontSize: '14px',
        fontWeight: '700',
        fontFamily: 'Oswald, Arial, sans-serif',
      }}>
        {status}
      </span>
    </div>
    {latency && (
      <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '14px', fontFamily: 'Oswald, Arial, sans-serif' }}>
        Latencia: {latency}ms
      </div>
    )}
    {error && (
      <div
        style={{
          color: status === 'FAIL' ? '#ff6b6b' : 'rgba(255,255,255,0.8)',
          fontSize: '13px',
          marginTop: '8px',
          fontFamily: 'Oswald, Arial, sans-serif',
        }}
      >
        {status === 'FAIL' ? 'Error: ' : ''}{error}
      </div>
    )}
  </div>
);

export default function HealthCheck() {
  const navigate = useNavigate();
  const { user: _user } = useAuth();
  const [checks, setChecks] = useState({
    supabase: { status: 'CHECKING', latency: null, error: null },
    auth: { status: 'CHECKING', latency: null, error: null },
    notifications: { status: 'CHECKING', latency: null, error: null },
    scheduler: { status: 'CHECKING', latency: null, error: null },
  });
  const [running, setRunning] = useState(false);

  const runChecks = async () => {
    if (running) return;
    setRunning(true);
    
    // Supabase check with timeout
    const supabaseStart = performance.now();
    try {
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('TIMEOUT')), 2500),
      );
      
      const fetchPromise = supabase
        .from('partidos')
        .select('id', { count: 'exact', head: true });
      
      const { error, status } = await Promise.race([fetchPromise, timeoutPromise]);
      const ms = Math.round(performance.now() - supabaseStart);
      
      if (error) {
        let reason = 'Error desconocido';
        if (status === 401 || status === 403) {
          reason = 'Credenciales inválidas (URL/KEY)';
        } else if (status >= 500) {
          reason = `HTTP ${status}`;
        } else if (error.message) {
          reason = error.message;
        }
        
        console.error('[Health] Supabase check failed:', { status, message: error.message, ms });
        setChecks((prev) => ({
          ...prev,
          supabase: {
            status: 'FAIL',
            latency: ms,
            error: reason,
          },
        }));
      } else {
        setChecks((prev) => ({
          ...prev,
          supabase: {
            status: 'OK',
            latency: ms,
            error: null,
          },
        }));
      }
    } catch (err) {
      const ms = Math.round(performance.now() - supabaseStart);
      let reason = 'Error desconocido';
      
      if (err.message === 'TIMEOUT') {
        reason = 'Timeout al conectar';
      } else if (err instanceof TypeError || err.message.includes('fetch')) {
        reason = 'URL inválida o sin red';
      } else {
        reason = err.message;
      }
      
      console.error('[Health] Supabase check failed:', { message: err.message, ms });
      setChecks((prev) => ({
        ...prev,
        supabase: {
          status: 'FAIL',
          latency: ms,
          error: reason,
        },
      }));
    }

    // Auth check with timeout
    const authStart = performance.now();
    try {
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('TIMEOUT')), 2500),
      );
      
      const authPromise = supabase.auth.getUser();
      
      const { data: { user: authUser }, error } = await Promise.race([authPromise, timeoutPromise]);
      const ms = Math.round(performance.now() - authStart);
      
      if (error) {
        const reason = error.message || 'Auth error';
        console.error('[Health] Auth check failed:', { message: error.message, ms });
        setChecks((prev) => ({
          ...prev,
          auth: {
            status: 'FAIL',
            latency: ms,
            error: reason,
          },
        }));
      } else if (authUser) {
        setChecks((prev) => ({
          ...prev,
          auth: {
            status: 'OK',
            latency: ms,
            error: `User: ${authUser.id.slice(0, 8)}...`,
          },
        }));
      } else {
        // Guest mode (no authenticated user)
        setChecks((prev) => ({
          ...prev,
          auth: {
            status: 'OK',
            latency: ms,
            error: 'Guest (no autenticado)',
          },
        }));
      }
    } catch (err) {
      const ms = Math.round(performance.now() - authStart);
      const reason = err.message === 'TIMEOUT' ? 'Timeout' : (err.message || 'Auth error');
      console.error('[Health] Auth check failed:', { message: err.message, ms });
      setChecks((prev) => ({
        ...prev,
        auth: {
          status: 'FAIL',
          latency: ms,
          error: reason,
        },
      }));
    }

    // Notifications check with timeout
    const notifStart = performance.now();
    try {
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('TIMEOUT')), 3000),
      );
      
      const fetchPromise = supabase
        .from('notifications')
        .select('id')
        .limit(1);
      
      const { error, status } = await Promise.race([fetchPromise, timeoutPromise]);
      const ms = Math.round(performance.now() - notifStart);
      
      if (error) {
        const reason = status === 401 ? 'FAIL(401)' : status === 403 ? 'FAIL(403)' : status >= 500 ? `FAIL(${status})` : 'FAIL';
        console.error('[Health] Notifications check failed:', { status, error: error.message });
        setChecks((prev) => ({
          ...prev,
          notifications: {
            status: 'FAIL',
            latency: ms,
            error: reason,
          },
        }));
      } else {
        setChecks((prev) => ({
          ...prev,
          notifications: {
            status: 'OK',
            latency: ms,
            error: null,
          },
        }));
      }
    } catch (err) {
      const ms = Math.round(performance.now() - notifStart);
      const reason = err.message === 'TIMEOUT' ? 'FAIL(TIMEOUT)' : 'FAIL';
      console.error('[Health] Notifications check failed:', err.message);
      setChecks((prev) => ({
        ...prev,
        notifications: {
          status: 'FAIL',
          latency: ms,
          error: reason,
        },
      }));
    }

    // Scheduler health check (backend cron + pending survey fanout)
    const schedulerStart = performance.now();
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), 3500),
      );

      const healthPromise = supabase.rpc('get_survey_scheduler_health', {
        p_window_minutes: 60,
      });

      const { data, error, status } = await Promise.race([healthPromise, timeoutPromise]);
      const ms = Math.round(performance.now() - schedulerStart);

      if (error) {
        const reason = status === 401
          ? 'Requiere sesión autenticada'
          : status === 403
            ? 'Sin permisos para leer salud del scheduler'
            : (error.message || 'Error consultando scheduler');

        setChecks((prev) => ({
          ...prev,
          scheduler: {
            status: status === 401 || status === 403 ? 'WARN' : 'FAIL',
            latency: ms,
            error: reason,
          },
        }));
      } else {
        const health = Array.isArray(data) ? data[0] : data;
        const pendingMatches = Number(health?.pending_matches || 0);
        const recentNotifications = Number(health?.recent_notifications || 0);
        const cronEnabled = Boolean(health?.cron_enabled);
        const cronActive = Boolean(health?.cron_active);
        const windowMinutes = Number(health?.window_minutes || 60);

        const checkStatus = String(health?.status || '').toLowerCase() === 'ok'
          ? 'OK'
          : 'WARN';

        const lastSuccess = health?.last_success_at
          ? new Date(health.last_success_at).toLocaleString('es-AR')
          : 'sin registro';

        const details = [
          health?.message || null,
          `Pendientes: ${pendingMatches}`,
          `Envíos ${windowMinutes}m: ${recentNotifications}`,
          `Cron: ${cronEnabled ? (cronActive ? 'activo' : 'inactivo') : 'no disponible'}`,
          `Último éxito: ${lastSuccess}`,
        ].filter(Boolean).join(' · ');

        setChecks((prev) => ({
          ...prev,
          scheduler: {
            status: checkStatus,
            latency: ms,
            error: details,
          },
        }));
      }
    } catch (err) {
      const ms = Math.round(performance.now() - schedulerStart);
      const reason = err.message === 'TIMEOUT'
        ? 'Timeout consultando scheduler'
        : (err.message || 'Error consultando scheduler');

      setChecks((prev) => ({
        ...prev,
        scheduler: {
          status: 'FAIL',
          latency: ms,
          error: reason,
        },
      }));
    }

    setRunning(false);
  };

  useEffect(() => {
    runChecks();
  }, []);

  return (
    <div className="voting-bg" style={{ minHeight: '100vh', paddingBottom: '80px' }}>
      <PageTitle onBack={() => navigate('/')}>HEALTH CHECK</PageTitle>
      
      <div style={{ maxWidth: '600px', margin: '0 auto', padding: '20px' }}>
        <CheckCard
          title="Supabase Database"
          status={checks.supabase.status}
          latency={checks.supabase.latency}
          error={checks.supabase.error}
        />
        
        <CheckCard
          title="Authentication"
          status={checks.auth.status}
          latency={checks.auth.latency}
          error={checks.auth.error}
        />
        
        <CheckCard
          title="Notifications"
          status={checks.notifications.status}
          latency={checks.notifications.latency}
          error={checks.notifications.error}
        />

        <CheckCard
          title="Survey Scheduler"
          status={checks.scheduler.status}
          latency={checks.scheduler.latency}
          error={checks.scheduler.error}
        />

        <button
          onClick={runChecks}
          disabled={running}
          style={{
            width: '100%',
            background: '#0EA9C6',
            border: 'none',
            borderRadius: '10px',
            color: 'white',
            padding: '12px',
            fontSize: '16px',
            fontWeight: '700',
            cursor: running ? 'not-allowed' : 'pointer',
            fontFamily: 'Bebas Neue, Arial, sans-serif',
            letterSpacing: '0.5px',
            opacity: running ? 0.6 : 1,
            marginTop: '12px',
          }}
        >
          {running ? 'EJECUTANDO...' : 'RE-EJECUTAR CHEQUEOS'}
        </button>
      </div>
    </div>
  );
}
