import React, { useState } from 'react';
import { useNotifications } from '../context/NotificationContext';
import { supabase } from '../supabase';

const RLS_SQL = `-- Enable RLS if needed (optional)
-- alter table public.notifications enable row level security;

create policy "notifications_insert_own"
on public.notifications
for insert
to authenticated
with check (user_id = auth.uid());

create policy "notifications_select_own"
on public.notifications
for select
to authenticated
using (user_id = auth.uid());

create policy "notifications_update_own"
on public.notifications
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
`;

const NotificationsDebugPanel = () => {
  const {
    notifications,
    fetchNotifications,
    createNotification,
    currentUserId,
    subscriptionStatus,
    lastFetchAt,
    lastFetchCount,
    lastRealtimeAt,
    lastRealtimePayloadType,
  } = useNotifications();

  const [lastTestRead, setLastTestRead] = useState({ ok: false, rows: null, error: { message: 'not-run' } });
  const [authCheck, setAuthCheck] = useState({ user: 'not-run', error: null });
  const [lastInsertResult, setLastInsertResult] = useState({ ok: false, error: { message: 'not-run' } });
  const [lastRawFetch, setLastRawFetch] = useState({ ok: false, rows: null, error: { message: 'not-run' } });

  if (process.env.NODE_ENV !== 'development') return null;

  // helper to run the raw latest fetch and store result
  const runFetchRawLatest = async () => {
    try {
      const res = await supabase
        .from('notifications')
        .select('id,type,partido_id,data,created_at')
        .order('created_at', { ascending: false })
        .limit(20);
      if (res.error) {
        setLastRawFetch({ ok: false, rows: null, error: { code: res.error.code, message: res.error.message, details: res.error.details } });
      } else {
        setLastRawFetch({ ok: true, rows: res.data, error: null });
      }
      console.log('[DEBUG PANEL] Fetch raw latest result:', res);
    } catch (err) {
      setLastRawFetch({ ok: false, rows: null, error: { message: String(err) } });
    }
  };

  return (
    <div style={{ position: 'fixed', right: 12, bottom: 12, zIndex: 9999, background: 'rgba(0,0,0,0.8)', color: '#fff', padding: 12, borderRadius: 8, width: 480, maxHeight: '70vh', overflow: 'auto' }}>
      <h4 style={{ marginTop: 0 }}>Notifications Debug</h4>
      <div style={{ fontSize: 12, marginBottom: 8 }}>
        <div>currentUserId: {currentUserId ? String(currentUserId) : 'NULL'}</div>
        <div>subscriptionStatus: {String(subscriptionStatus)}</div>
        <div>lastFetchAt: {String(lastFetchAt)}</div>
        <div>lastFetchCount: {String(lastFetchCount)}</div>
        <div>lastRealtimeAt: {String(lastRealtimeAt)}</div>
        <div>lastRealtimePayloadType: {String(lastRealtimePayloadType)}</div>
      </div>

      <div style={{ fontSize: 14, marginBottom: 8 }}>
        <div style={{ fontWeight: 'bold' }}>Last Insert Result:</div>
        <pre style={{ whiteSpace: 'pre-wrap', color: '#0f0' }}>{JSON.stringify(lastInsertResult, null, 2)}</pre>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button onClick={() => fetchNotifications()} style={{ flex: 1 }}>Force Fetch</button>
        <button onClick={async () => {
          setLastInsertResult({ ok: false, error: { message: 'running' } });
          const res = await createNotification('call_to_vote', 'test', 'test');
          setLastInsertResult(res || { ok: false, error: { message: 'no-response' } });
          if (res && res.ok) {
            await fetchNotifications();
            await runFetchRawLatest();
          }
        }} style={{ flex: 1 }}>Create Test Notification</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button onClick={async () => {
          setLastInsertResult({ ok: false, error: { message: 'running' } });
          const res = await createNotification('awards_ready', 'Premios listos', 'Ya podés ver los premios', { match_id: 196, link: '/encuesta/196' }, 196);
          setLastInsertResult(res || { ok: false, error: { message: 'no-response' } });
          if (res && res.ok) {
            await fetchNotifications();
            await runFetchRawLatest();
          }
        }} style={{ flex: 1 }}>Create Test awards_ready</button>
        <button onClick={async () => {
          setLastInsertResult({ ok: false, error: { message: 'running' } });
          const res = await createNotification('survey_results_ready', 'Resultados listos', 'Ya están los resultados', { match_id: 196, link: '/encuesta/196' }, 196);
          setLastInsertResult(res || { ok: false, error: { message: 'no-response' } });
          if (res && res.ok) {
            await fetchNotifications();
            await runFetchRawLatest();
          }
        }} style={{ flex: 1 }}>Create Test survey_results_ready</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button onClick={async () => {
          if (!currentUserId) {
            setLastTestRead({ ok: false, rows: null, error: { message: 'no_current_user' } });
            return;
          }
          try {
            const res = await supabase
              .from('notifications')
              .select('id,type,created_at')
              .eq('user_id', currentUserId)
              .order('created_at', { ascending: false })
              .limit(5);
            if (res.error) {
              setLastTestRead({ ok: false, rows: null, error: { code: res.error.code, message: res.error.message, details: res.error.details, hint: res.error.hint } });
            } else {
              setLastTestRead({ ok: true, rows: res.data, error: null });
            }
            console.log('[DEBUG PANEL] Test Read result:', res);
          } catch (err) {
            setLastTestRead({ ok: false, rows: null, error: { message: String(err) } });
            console.log('[DEBUG PANEL] Test Read exception:', err);
          }
        }} style={{ flex: 1 }}>Test Read</button>
        <button onClick={async () => {
          try {
            const { data, error } = await supabase.auth.getUser();
            setAuthCheck({ user: data?.user?.id || null, error: error ? { message: error.message, code: error.code } : null });
            console.log('[DEBUG PANEL] auth.getUser result:', data, error);
          } catch (err) {
            setAuthCheck({ user: null, error: { message: String(err) } });
            console.log('[DEBUG PANEL] auth.getUser error:', err);
          }
        }} style={{ flex: 1 }}>RE-CHECK AUTH</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button onClick={runFetchRawLatest} style={{ flex: 1 }}>Fetch raw latest</button>
      </div>

      <div style={{ maxHeight: 200, overflow: 'auto', marginBottom: 8 }}>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>id</th>
              <th style={{ textAlign: 'left' }}>type</th>
              <th style={{ textAlign: 'left' }}>created_at</th>
              <th style={{ textAlign: 'left' }}>read</th>
            </tr>
          </thead>
          <tbody>
            {notifications.slice(0, 30).map((n) => (
              <tr key={n.id}>
                <td style={{ paddingRight: 8 }}>{n.id}</td>
                <td style={{ paddingRight: 8 }}>{n.type}</td>
                <td style={{ paddingRight: 8 }}>{n.created_at}</td>
                <td style={{ paddingRight: 8 }}>{String(n.read)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 12, marginBottom: 8 }}>
        <div>Last Test Read Result:</div>
        <pre style={{ whiteSpace: 'pre-wrap', color: '#0f0' }}>{JSON.stringify(lastTestRead, null, 2)}</pre>
        <div>Auth Check:</div>
        <pre style={{ whiteSpace: 'pre-wrap', color: '#0f0' }}>{JSON.stringify(authCheck, null, 2)}</pre>
      </div>

      <div style={{ fontSize: 12, marginBottom: 8 }}>
        <div>Last Raw Fetch:</div>
        <pre style={{ whiteSpace: 'pre-wrap', color: '#0f0' }}>{JSON.stringify(lastRawFetch, null, 2)}</pre>
      </div>

      <div style={{ fontSize: 12, marginBottom: 8 }}>
        <div>Last Raw Fetch Rows:</div>
        <div style={{ maxHeight: 160, overflow: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>id</th>
                <th style={{ textAlign: 'left' }}>type</th>
                <th style={{ textAlign: 'left' }}>partido_id</th>
                <th style={{ textAlign: 'left' }}>data.match_id</th>
                <th style={{ textAlign: 'left' }}>created_at</th>
              </tr>
            </thead>
            <tbody>
              {(lastRawFetch.rows || []).map((r) => (
                <tr key={r.id}>
                  <td style={{ paddingRight: 8 }}>{r.id}</td>
                  <td style={{ paddingRight: 8 }}>{r.type}</td>
                  <td style={{ paddingRight: 8 }}>{r.partido_id}</td>
                  <td style={{ paddingRight: 8 }}>{r.data?.match_id ?? (r.match_ref || '')}</td>
                  <td style={{ paddingRight: 8 }}>{r.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ fontSize: 12 }}>
        <div style={{ marginBottom: 8 }}>If insert is blocked by RLS, run this SQL:</div>
        <pre style={{ whiteSpace: 'pre-wrap', color: '#ff8' }}>{RLS_SQL}</pre>
      </div>
    </div>
  );
};

export default NotificationsDebugPanel;
