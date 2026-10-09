// 20261010132000: only the recipient accepts a friend request. Checked twice: inside the
// database (rolled-back transactions, as each account) and through the real API
// (PostgREST with each account's own session), which is what a modified client would use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { API, config, root, sqlTry } from '../lab.mjs';

const qa = JSON.parse(await readFile(`${root}.runtime/qa-users.json`, 'utf8'));
const [SENDER, RECIPIENT, OTHER] = [qa.ids.jugador8, qa.ids.jugador9, qa.ids.jugador6];
const as = (userId) => `reset role; set local "request.jwt.claims" to '{"sub":"${userId}","role":"authenticated"}'; set local role authenticated;`;
const inTx = (statements) => sqlTry(`begin; delete from public.amigos where user_id in ('${SENDER}', '${RECIPIENT}') and friend_id in ('${SENDER}', '${RECIPIENT}'); ${statements} rollback;`);
const denied = (result, pattern) => {
  assert.equal(result.ok, false, `allowed: ${result.out}`);
  assert.match(result.error, pattern);
};

test('database: the sender can only create a pending request, never to themselves', () => {
  denied(inTx(`${as(SENDER)} insert into public.amigos (user_id, friend_id, status) values ('${SENDER}', '${RECIPIENT}', 'accepted');`),
    /only its recipient can accept|row-level security/);
  denied(inTx(`${as(SENDER)} insert into public.amigos (user_id, friend_id, status) values ('${SENDER}', '${SENDER}', 'pending');`),
    /row-level security/);
  denied(inTx(`${as(SENDER)} insert into public.amigos (user_id, friend_id, status) values ('${RECIPIENT}', '${SENDER}', 'pending');`),
    /row-level security/);
  const ok = inTx(`${as(SENDER)} insert into public.amigos (user_id, friend_id) values ('${SENDER}', '${RECIPIENT}') returning status;`);
  assert.equal(ok.ok, true, ok.error);
  assert.equal(ok.out.trim(), 'pending');
});

const pending = `insert into public.amigos (user_id, friend_id, status) values ('${SENDER}', '${RECIPIENT}', 'pending');`;

test('database: the sender cannot accept (or reject) their own request', () => {
  for (const status of ['accepted', 'rejected']) {
    denied(inTx(`${as(SENDER)} ${pending} update public.amigos set status = '${status}' where user_id = '${SENDER}' and friend_id = '${RECIPIENT}';`),
      /only the recipient/);
  }
});

test('database: the recipient accepts or rejects; nobody re-points the request', () => {
  const accepted = inTx(`${as(SENDER)} ${pending} ${as(RECIPIENT)}
    update public.amigos set status = 'accepted' where user_id = '${SENDER}' and friend_id = '${RECIPIENT}' returning status;`);
  assert.equal(accepted.ok, true, accepted.error);
  assert.equal(accepted.out.trim(), 'accepted');
  denied(inTx(`${as(SENDER)} ${pending} ${as(RECIPIENT)}
    update public.amigos set status = 'accepted' where user_id = '${SENDER}' and friend_id = '${RECIPIENT}';
    update public.amigos set status = 'rejected' where user_id = '${SENDER}' and friend_id = '${RECIPIENT}';`), /from pending/);
  denied(inTx(`${as(SENDER)} ${pending} update public.amigos set friend_id = '${OTHER}' where user_id = '${SENDER}' and friend_id = '${RECIPIENT}';`),
    /cannot change/);
});

test('database: either side can still delete (cancel, unfriend, clear a rejection)', () => {
  const result = inTx(`${as(SENDER)} ${pending} ${as(RECIPIENT)}
    update public.amigos set status = 'rejected' where user_id = '${SENDER}' and friend_id = '${RECIPIENT}';
    ${as(SENDER)} delete from public.amigos where user_id = '${SENDER}' and friend_id = '${RECIPIENT}' returning status;`);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.out.trim(), 'rejected');
});

// --- Direct API calls with each account's own session ------------------------------
const c = await config();
const signIn = async (key) => {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: c.anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${key}@arma2.lab`, password: qa.passwords[key] }),
  });
  if (!r.ok) throw new Error(`sign-in ${key}: ${r.status}`);
  return (await r.json()).access_token;
};
const rest = (token) => async (method, path, body) => {
  const r = await fetch(`${API}/rest/v1/${path}`, {
    method,
    headers: { apikey: c.anonKey, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
};

test('API: a modified client cannot forge or self-accept a friendship', async () => {
  const sender = rest(await signIn('jugador8'));
  const recipient = rest(await signIn('jugador9'));
  const pair = `user_id=eq.${SENDER}&friend_id=eq.${RECIPIENT}`;
  await sender('DELETE', `amigos?${pair}`);
  try {
    const forged = await sender('POST', 'amigos', { user_id: SENDER, friend_id: RECIPIENT, status: 'accepted' });
    assert.ok(forged.status >= 400, `forged accepted: ${forged.status}`);

    const created = await sender('POST', 'amigos', { user_id: SENDER, friend_id: RECIPIENT, status: 'pending' });
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const selfAccept = await sender('PATCH', `amigos?${pair}`, { status: 'accepted' });
    assert.ok(selfAccept.status >= 400, `sender accepted: ${selfAccept.status}`);
    assert.match(JSON.stringify(selfAccept.body), /only the recipient/);

    const repoint = await sender('PATCH', `amigos?${pair}`, { friend_id: OTHER });
    assert.ok(repoint.status >= 400, `re-pointed: ${repoint.status}`);

    const accepted = await recipient('PATCH', `amigos?${pair}`, { status: 'accepted' });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body?.[0]?.status, 'accepted');
  } finally {
    await sender('DELETE', `amigos?${pair}`);
  }
  const leftovers = await sender('GET', `amigos?select=id&${pair}`);
  assert.deepEqual(leftovers.body, []);
});
