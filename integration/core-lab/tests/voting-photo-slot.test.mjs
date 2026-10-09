// 20261010138000: with the match code, a guest's voting photo is changed only by the session
// voting as that guest (the first to claim the slot), never by a fresh session per slot,
// and never for a guest who already voted. No login and no extra code on that path.
// SQL checks run as service_role (the only caller of bind_voting_photo_slot) in rolled-back
// transactions; the API check goes through the real edge function on a fixture that is
// removed at the end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { API, config, sqlTry } from '../lab.mjs';

const M = 990901;
const CODE = 'FOTOLAB1';
const ONE = 990911;
const TWO = 990912;
const BENCH = 990913;
const fixture = `
  insert into public.partidos (id, nombre, codigo, fecha, hora, sede, modalidad, cupo_jugadores, estado, creado_por, admin_id)
  select ${M}, 'Foto lab', '${CODE}', current_date + 1, '21:00', 'Cancha lab', 'F5', 2, 'activo', id, id
  from auth.users where email = 'organizador@arma2.lab';
  insert into public.jugadores (id, partido_id, nombre, usuario_id, is_substitute) values
    (${ONE}, ${M}, 'Invitado Uno', null, false),
    (${TWO}, ${M}, 'Invitado Dos', null, false),
    (${BENCH}, ${M}, 'Suplente Tres', null, false);
  insert into public.notifications (user_id, partido_id, type, title, message, data)
  select creado_por, ${M}, 'call_to_vote', 'A votar', 'Votá', jsonb_build_object('match_id', ${M}) from public.partidos where id = ${M};`;
const cleanup = `
  delete from public.voting_photo_upload_tokens where match_id = ${M};
  delete from public.voting_photo_slot_claims where match_id = ${M};
  delete from public.public_voters where partido_id = ${M};
  delete from public.notifications where partido_id = ${M};
  delete from public.jugadores where partido_id = ${M};
  delete from public.partidos where id = ${M};`;
const bind = (session, player) => `select coalesce(public.bind_voting_photo_slot(${M}, '${session}', ${player})::text, 'refused');`;
const asService = (statements) => sqlTry(`begin; ${fixture} set local role service_role; ${statements} rollback;`);
const lines = (result) => {
  assert.equal(result.ok, true, result.error);
  return result.out.trim().split('\n').filter(Boolean);
};

test('the first session owns a guest slot; a fresh session cannot take it', () => {
  assert.deepEqual(lines(asService(`${bind('sesion-uno', ONE)} ${bind('sesion-uno', ONE)} ${bind('sesion-ajena', ONE)}`)),
    [String(ONE), String(ONE), 'refused']);
});

test('the refused session is not bound by the attempt: it can still claim its own slot', () => {
  assert.deepEqual(lines(asService(`${bind('sesion-uno', ONE)} ${bind('sesion-dos', ONE)} ${bind('sesion-dos', TWO)}`)),
    [String(ONE), 'refused', String(TWO)]);
});

test('a session keeps only the slot it claimed first (unchanged)', () => {
  assert.deepEqual(lines(asService(`${bind('sesion-uno', ONE)} ${bind('sesion-uno', TWO)}`)),
    [String(ONE), String(ONE)]);
});

test('a guest who already voted cannot be claimed by a new session', () => {
  assert.deepEqual(lines(asService(`
    reset role; set local role anon;
    select public.public_mark_voter_completed(${M}, '${CODE}', 'Invitado Uno');
    reset role; set local role service_role;
    ${bind('sesion-nueva', ONE)} ${bind('sesion-nueva', TWO)}`)).slice(-2),
  ['refused', String(TWO)]);
});

test('only guest starters (the "¿Quién sos?" list) can be claimed', () => {
  assert.deepEqual(lines(asService(`${bind('sesion-uno', BENCH)} ${bind('sesion-uno', 990999)}`)), ['refused', 'refused']);
});

test('claims made before the rule: the earliest one owns a shared slot; nothing is deleted', () => {
  assert.deepEqual(lines(asService(`
    reset role;
    insert into public.voting_photo_slot_claims (match_id, guest_session_id, player_id, created_at) values
      (${M}, 'vieja-primera', ${ONE}, now() - interval '2 minutes'),
      (${M}, 'vieja-segunda', ${ONE}, now() - interval '1 minute');
    set local role service_role;
    ${bind('vieja-primera', ONE)} ${bind('vieja-segunda', ONE)}
    reset role; select count(*) from public.voting_photo_slot_claims where match_id = ${M};`)),
  [String(ONE), 'refused', '2']);
});

test('nobody but service_role can call the binding', () => {
  for (const role of ['anon', 'authenticated']) {
    const r = sqlTry(`begin; ${fixture} set local role ${role}; ${bind('x-sesion', ONE)} rollback;`);
    assert.equal(r.ok, false, role);
    assert.match(r.error, /permission denied/);
  }
});

test('API: through issue-voting-photo-token, the code alone no longer replaces another guest\'s photo', async () => {
  const c = await config();
  const issue = async (guestSessionId, playerId) => {
    const r = await fetch(`${API}/functions/v1/issue-voting-photo-token`, {
      method: 'POST',
      headers: { apikey: c.anonKey, authorization: `Bearer ${c.anonKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ codigo: CODE, matchId: M, playerId, guestSessionId }),
    });
    const body = await r.json().catch(() => null);
    return { status: r.status, error: body?.error ?? null, token: Boolean(body?.token) };
  };
  sqlTry(cleanup);
  const setup = sqlTry(fixture);
  assert.equal(setup.ok, true, setup.error);
  try {
    assert.deepEqual(await issue('guest-session-uno', ONE), { status: 200, error: null, token: true });
    assert.deepEqual(await issue('guest-session-uno', ONE), { status: 200, error: null, token: true });
    assert.deepEqual(await issue('guest-session-ajena', ONE), { status: 409, error: 'session_claimed_other_slot', token: false });
    assert.deepEqual(await issue('guest-session-ajena', TWO), { status: 200, error: null, token: true });
    assert.deepEqual(await issue('guest-session-tres', ONE), { status: 409, error: 'session_claimed_other_slot', token: false });
    const wrongCode = await fetch(`${API}/functions/v1/issue-voting-photo-token`, {
      method: 'POST',
      headers: { apikey: c.anonKey, authorization: `Bearer ${c.anonKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ codigo: 'WRONG123', matchId: M, playerId: ONE, guestSessionId: 'guest-session-uno' }),
    });
    assert.equal(wrongCode.status, 403);
  } finally {
    const removed = sqlTry(cleanup);
    assert.equal(removed.ok, true, removed.error);
  }
});
