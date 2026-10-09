// COMMERCE-PRODUCTION phase B — lab-only Mercado Pago (production shape) for the integrated preview. Never deployed,
// never reachable from outside the lab.
//
// The production payments worker (torneos-payments-production, lab configuration) reaches this server as
// http://mp-stub:8080 through its lab fetch wrapper; every API call is answered by the certified in-process emulator
// (infra/torneos-payments-test/mp-emulator.mjs) in production shape: a non-test MLA seller and live_mode true.
//
// The browser cannot pay here: the Plan page only navigates to Mercado Pago's own hosts. The payment step is this
// console instead (loopback-only port, path guarded by the lab control token): it lists the Preferences the service
// created and, per purchase, produces what a buyer or the seller would (approved, rejected, pending, accreditation,
// panel refund, chargeback dispute won/lost) and sends the SIGNED notification to the payments worker, exactly as
// Mercado Pago would. The return links open the purchase status page of the preview app.
//
// It logs actions and ids only, never a token, secret or the control path.
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { makeMercadoPago, signedNotification } from '../../../infra/torneos-payments-test/mp-emulator.mjs';

const PORT = 8080;
const MAX_BODY = 64 * 1024;

function required(name) {
  const value = (process.env[name] ?? '').trim();
  if (!value) { console.error(`mp-stub-production: missing ${name}`); process.exit(1); }
  return value;
}
const ACCESS_TOKEN = required('MP_STUB_ACCESS_TOKEN');
const SELLER_ID = required('MP_STUB_SELLER_ID');
const CONTROL_TOKEN = required('MP_STUB_CONTROL_TOKEN');
const WEBHOOK_SECRET = required('MP_STUB_WEBHOOK_SECRET');
const PAYMENTS_URL = required('MP_STUB_PAYMENTS_URL').replace(/\/$/, '');
const APP_ORIGIN = required('MP_STUB_APP_ORIGIN').replace(/\/$/, '');

// Lab-only targets: the payments worker on the lab network, the preview app on loopback.
if (!/^[1-9]\d{5,15}$/.test(SELLER_ID)) { console.error('mp-stub-production: seller id must be numeric'); process.exit(1); }
if (!/^[0-9a-f]{32,}$/.test(CONTROL_TOKEN)) { console.error('mp-stub-production: control token must be lowercase hex'); process.exit(1); }
if (!/^http:\/\/torneos-functions:\d{2,5}\/torneos-payments-production$/.test(PAYMENTS_URL)) {
  console.error('mp-stub-production: MP_STUB_PAYMENTS_URL must be the lab torneos-payments-production mount'); process.exit(1);
}
if (!/^https?:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/.test(APP_ORIGIN)) {
  console.error('mp-stub-production: MP_STUB_APP_ORIGIN must be a loopback origin'); process.exit(1);
}

const PRODUCTION_ME = Object.freeze({ id: Number(SELLER_ID), nickname: 'ARMA2_LAB_PRODUCTION', site_id: 'MLA', tags: ['normal'] });
// Ids start from the boot time (ms × 1000): a restarted stub never reuses a payment id the lab database already bound.
const mp = makeMercadoPago({ sellerId: SELLER_ID, accessToken: ACCESS_TOKEN, me: PRODUCTION_ME, liveMode: true, idBase: Date.now() * 1000 });
const chargebackOf = new Map(); // payment id → chargeback id
const notifications = []; // newest first: { at, purchaseId, type, dataId, status, outcome }

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function controlPath(pathname) {
  const m = /^\/__lab\/([0-9a-f]+)(\/[a-z-]*)?$/.exec(pathname);
  if (!m) return null;
  const given = Buffer.from(m[1]); const expected = Buffer.from(CONTROL_TOKEN);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return m[2] && m[2] !== '/' ? m[2] : '/';
}

// ─────────────────────────── state view

function purchases() {
  return [...mp.state.preferences.entries()].reverse().map(([preferenceId, p]) => {
    const purchaseId = p.body.metadata?.purchase_id ?? null;
    const payments = [...mp.state.payments.entries()].filter(([, x]) => x.base.metadata?.purchase_id === purchaseId)
      .map(([id, x]) => { const last = x.snapshots.at(-1); return { id, status: last.status, statusDetail: last.status_detail, chargeback: chargebackOf.get(id) ?? null }; });
    const back = (kind) => { try { return `${APP_ORIGIN}${new URL(p.body.back_urls[kind]).pathname}`; } catch { return null; } };
    return { purchaseId, preferenceId, amount: p.body.items?.[0]?.unit_price ?? null, currency: p.body.items?.[0]?.currency_id ?? null,
      title: p.body.items?.[0]?.title ?? null, returnPending: back('pending'), returnSuccess: back('success'), returnFailure: back('failure'), payments };
  });
}

// ─────────────────────────── actions (what a buyer / the seller does on Mercado Pago) + the signed notification

function nextAt(paymentId) {
  const now = Date.now();
  const last = paymentId ? Date.parse(mp.state.payments.get(paymentId)?.snapshots.at(-1)?.date_last_updated ?? 0) : 0;
  return new Date(Math.max(now, last + 1000)).toISOString();
}

async function notify(purchaseId, type, dataId) {
  const n = signedNotification({ base: PAYMENTS_URL, secret: WEBHOOK_SECRET, dataId, sellerId: SELLER_ID, type, liveMode: true });
  let status = 0; let outcome = null;
  try {
    const r = await fetch(n.url, { ...n.init, signal: AbortSignal.timeout(30_000) });
    status = r.status;
    const body = await r.json().catch(() => null);
    outcome = body?.outcome ?? body?.error ?? null;
  } catch {
    outcome = 'payments_unreachable';
  }
  const entry = { at: new Date().toISOString(), purchaseId, type, dataId: String(dataId), status, outcome };
  notifications.unshift(entry);
  notifications.length = Math.min(notifications.length, 50);
  console.log(JSON.stringify({ fn: 'mp-stub-production', event: 'notification', purchaseId, type, status, outcome }));
  return entry;
}

const PAY_STATES = Object.freeze({
  approve: { status: 'approved', statusDetail: 'accredited' },
  reject: { status: 'rejected', statusDetail: 'cc_rejected_other_reason' },
  pending: { status: 'pending', statusDetail: 'pending_waiting_payment' },
});

async function act({ action, preferenceId, paymentId }) {
  if (PAY_STATES[action]) {
    const pref = mp.preference(String(preferenceId ?? ''));
    if (!pref) return { status: 404, body: { error: 'unknown_preference' } };
    const id = mp.pay(String(preferenceId), { ...PAY_STATES[action], at: nextAt(null) });
    return { status: 200, body: { paymentId: id, notification: await notify(pref.body.metadata.purchase_id, 'payment', id) } };
  }
  const id = String(paymentId ?? '');
  const payment = mp.state.payments.get(id);
  if (!payment) return { status: 404, body: { error: 'unknown_payment' } };
  const purchaseId = payment.base.metadata?.purchase_id ?? null;
  const last = payment.snapshots.at(-1);
  switch (action) {
    case 'accredit':
      if (last.status !== 'pending' && last.status !== 'in_process') return { status: 409, body: { error: 'not_pending' } };
      mp.update(id, { status: 'approved', statusDetail: 'accredited', at: nextAt(id) });
      return { status: 200, body: { notification: await notify(purchaseId, 'payment', id) } };
    case 'expire':
      if (last.status !== 'pending' && last.status !== 'in_process') return { status: 409, body: { error: 'not_pending' } };
      mp.update(id, { status: 'cancelled', statusDetail: 'expired', at: nextAt(id) });
      return { status: 200, body: { notification: await notify(purchaseId, 'payment', id) } };
    case 'refund':
      if (last.status !== 'approved') return { status: 409, body: { error: 'not_approved' } };
      mp.panelRefund(id, { at: nextAt(id) });
      return { status: 200, body: { notification: await notify(purchaseId, 'payment', id) } };
    case 'dispute': {
      if (last.status !== 'approved') return { status: 409, body: { error: 'not_approved' } };
      mp.update(id, { status: 'charged_back', statusDetail: 'in_process', at: nextAt(id) });
      const chargeback = chargebackOf.get(id) ?? mp.chargeback(id, { liveMode: true });
      chargebackOf.set(id, chargeback);
      return { status: 200, body: { notification: await notify(purchaseId, 'topic_chargebacks_wh', chargeback) } };
    }
    case 'dispute-won':
    case 'dispute-lost': {
      const chargeback = chargebackOf.get(id);
      if (!chargeback || last.status !== 'charged_back' || last.status_detail !== 'in_process') return { status: 409, body: { error: 'no_open_dispute' } };
      // Mercado Pago's chargeback resolution: `reimbursed` = covered for the seller (Premium restored), `settled` = the
      // buyer won (revoked) — the same details the certified provider policy reads.
      mp.update(id, { status: 'charged_back', statusDetail: action === 'dispute-won' ? 'reimbursed' : 'settled', at: nextAt(id) });
      return { status: 200, body: { notification: await notify(purchaseId, 'topic_chargebacks_wh', chargeback) } };
    }
    case 'resend':
      return { status: 200, body: { notification: await notify(purchaseId, 'payment', id) } };
    default:
      return { status: 400, body: { error: 'unknown_action' } };
  }
}

// ─────────────────────────── console (HTML, Spanish: it is what the reviewer sees)

const STATUS_COPY = Object.freeze({ approved: 'Aprobado', rejected: 'Rechazado', pending: 'Pendiente', in_process: 'En proceso',
  cancelled: 'Cancelado', refunded: 'Devuelto', charged_back: 'Contracargo' });
const ACTION_COPY = Object.freeze({ approve: 'Aprobar pago', reject: 'Rechazar pago', pending: 'Pago pendiente (efectivo)',
  accredit: 'Acreditar', expire: 'Vencer', refund: 'Devolver (panel)', dispute: 'Abrir contracargo', 'dispute-won': 'Disputa ganada',
  'dispute-lost': 'Disputa perdida', resend: 'Reenviar aviso' });

function paymentActions(p) {
  if (p.status === 'pending' || p.status === 'in_process') return ['accredit', 'expire', 'resend'];
  if (p.status === 'approved') return ['refund', 'dispute', 'resend'];
  if (p.status === 'charged_back' && p.statusDetail === 'in_process') return ['dispute-won', 'dispute-lost', 'resend'];
  return ['resend'];
}

function button(base, action, fields) {
  const hidden = Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  return `<form method="post" action="${base}/action">${hidden}<input type="hidden" name="action" value="${esc(action)}"><button type="submit">${esc(ACTION_COPY[action])}</button></form>`;
}

function page(base, flash) {
  const list = purchases();
  const rows = list.map((p) => `
    <section class="card">
      <header><strong>${esc(p.title)}</strong><span>${esc(p.currency)} ${esc(Number(p.amount).toLocaleString('es-AR'))}</span></header>
      <p class="mono">Compra ${esc(p.purchaseId)}</p>
      <div class="actions">${['approve', 'reject', 'pending'].map((a) => button(base, a, { preferenceId: p.preferenceId })).join('')}</div>
      ${p.payments.length ? `<table><thead><tr><th>Pago</th><th>Estado</th><th></th></tr></thead><tbody>${p.payments.map((x) => `
        <tr><td class="mono">${esc(x.id)}</td><td>${esc(STATUS_COPY[x.status] ?? x.status)}${x.statusDetail ? ` <small>${esc(x.statusDetail)}</small>` : ''}</td>
        <td class="actions">${paymentActions(x).map((a) => button(base, a, { paymentId: x.id })).join('')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Todavía sin pagos.</p>'}
      <p class="links">Volver a la app como lo haría Mercado Pago:
        ${p.returnSuccess ? `<a href="${esc(p.returnSuccess)}">éxito</a>` : ''} ·
        ${p.returnPending ? `<a href="${esc(p.returnPending)}">pendiente</a>` : ''} ·
        ${p.returnFailure ? `<a href="${esc(p.returnFailure)}">falló</a>` : ''}</p>
    </section>`).join('');
  const log = notifications.slice(0, 12).map((n) => `<tr><td>${esc(n.at.slice(11, 19))}</td><td>${esc(n.type)}</td><td class="mono">${esc(n.dataId)}</td><td>${esc(n.status)}</td><td>${esc(n.outcome)}</td></tr>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mercado Pago de laboratorio</title>
<style>
:root{--bg:#f6f7f9;--fg:#15171a;--muted:#5d6470;--card:#fff;--line:#dfe3e8;--accent:#0a66c2}
@media (prefers-color-scheme:dark){:root{--bg:#121417;--fg:#eceff3;--muted:#9aa3ae;--card:#1b1e22;--line:#2c3138;--accent:#5aa2ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:860px;margin:0 auto;padding:20px 16px 48px}
h1{font-size:20px;margin:0 0 4px}.muted,small{color:var(--muted)}
.notice{border:1px solid var(--line);background:var(--card);border-radius:10px;padding:10px 12px;margin:12px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin:14px 0}
.card header{display:flex;justify-content:space-between;gap:12px}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;word-break:break-all}
.actions{display:flex;flex-wrap:wrap;gap:8px}.actions form{margin:0}
button{white-space:nowrap;border:1px solid var(--line);background:var(--bg);color:var(--fg);border-radius:8px;padding:7px 12px;font:inherit;cursor:pointer}
button:hover{border-color:var(--accent)}
table{width:100%;border-collapse:collapse;margin-top:10px}td,th{text-align:left;padding:6px 4px;border-top:1px solid var(--line);vertical-align:top}
a{color:var(--accent)}.links{margin:10px 0 0}
</style></head><body><main>
<h1>Mercado Pago de laboratorio</h1>
<p class="muted">Sólo laboratorio: ningún pago es real y nada sale de esta máquina. Cada acción envía el aviso firmado al servicio de pagos, como lo haría Mercado Pago.</p>
${flash ? `<p class="notice">${esc(flash)}</p>` : ''}
${rows || '<p class="notice">Todavía no hay compras. Tocá “Pagar con Mercado Pago” en Mi plan de la preview y volvé a esta página.</p>'}
${log ? `<h2>Avisos enviados</h2><table><thead><tr><th>Hora</th><th>Tipo</th><th>Id</th><th>HTTP</th><th>Resultado</th></tr></thead><tbody>${log}</tbody></table>` : ''}
</main></body></html>`;
}

// ─────────────────────────── server

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://mp-stub');
    if (url.pathname === '/__lab/health' && req.method === 'GET') return json(res, 200, { ok: true });
    if (url.pathname.startsWith('/__lab/')) {
      const route = controlPath(url.pathname);
      if (route === null) return json(res, 404, { message: 'not found' });
      const base = `/__lab/${CONTROL_TOKEN}`;
      if (route === '/' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" });
        return res.end(page(base, url.searchParams.get('m')));
      }
      if (route === '/state' && req.method === 'GET') return json(res, 200, { purchases: purchases(), notifications });
      if (route === '/action' && req.method === 'POST') {
        const raw = await readBody(req);
        const form = (req.headers['content-type'] ?? '').includes('application/json') ? JSON.parse(raw || '{}') : Object.fromEntries(new URLSearchParams(raw));
        const r = await act(form);
        console.log(JSON.stringify({ fn: 'mp-stub-production', event: 'action', action: String(form.action ?? ''), status: r.status }));
        if ((req.headers['content-type'] ?? '').includes('application/json')) return json(res, r.status, r.body);
        const n = r.body?.notification;
        const flash = r.status === 200 ? `${ACTION_COPY[form.action] ?? form.action}: aviso ${n?.status ?? '—'} ${n?.outcome ?? ''}`.trim() : `No se pudo: ${r.body?.error ?? r.status}`;
        res.writeHead(303, { location: `${base}/?m=${encodeURIComponent(flash)}`, 'cache-control': 'no-store' });
        return res.end();
      }
      return json(res, 404, { message: 'not found' });
    }
    // The Mercado Pago API as the payments worker sees it (lab fetch wrapper → http://mp-stub:8080).
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
    const answer = await mp.fetch(`https://api.mercadopago.com${url.pathname}${url.search}`, { method: req.method, headers: req.headers, body });
    res.writeHead(answer.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(await answer.text());
  } catch {
    if (!res.headersSent) json(res, 500, { message: 'stub error' }); else res.end();
  }
});
server.listen(PORT, '0.0.0.0', () => console.log(`mp-stub-production listening on ${PORT}`));
