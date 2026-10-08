// Read-exposure probe for the Core lab: for every Core relation in `public`, how many rows
// (and which columns) anon, an unrelated account and a brand-new account can read through
// PostgREST, against the total the service role sees. Local lab only.
import { readFile } from 'node:fs/promises';
import { API, root, config } from './lab.mjs';
import { signIn } from './seed.mjs';

if (new URL(API).hostname !== '127.0.0.1') throw new Error('probe refuses non-loopback targets');

const c = await config();
const qa = JSON.parse(await readFile(`${root}.runtime/qa-users.json`, 'utf8'));
const tokens = { anon: null };
for (const key of ['ajeno', 'nuevo']) tokens[key] = (await signIn(c, key, qa.passwords)).session.access_token;

const openapi = await (await fetch(`${API}/rest/v1/`, { headers: { apikey: c.serviceRoleKey, authorization: `Bearer ${c.serviceRoleKey}` } })).json();
const relations = Object.keys(openapi.paths).map((p) => p.slice(1)).filter((p) => p && !p.startsWith('rpc/') && !/tournament/.test(p));

async function read(relation, token, key = c.anonKey) {
  const r = await fetch(`${API}/rest/v1/${relation}?select=*&limit=5000`, {
    headers: { apikey: key, ...(token ? { authorization: `Bearer ${token}` } : {}), prefer: 'count=exact' },
  });
  if (!r.ok) return { status: r.status, rows: null };
  const rows = await r.json();
  return { status: r.status, rows };
}

const report = [];
for (const relation of relations.sort()) {
  const all = await read(relation, c.serviceRoleKey, c.serviceRoleKey);
  const row = { relation, total: all.rows?.length ?? null };
  for (const [who, token] of Object.entries(tokens)) {
    const seen = await read(relation, token);
    row[who] = seen.rows ? seen.rows.length : `HTTP ${seen.status}`;
    if (seen.rows?.length) row[`${who}_columns`] = Object.keys(seen.rows[0]);
  }
  report.push(row);
}
const interesting = report.filter((r) => r.total && (Number(r.anon) > 0 || Number(r.ajeno) > 0 || Number(r.nuevo) > 0));
console.log(JSON.stringify({ relations: report.length, readable_by_unrelated: interesting.map(({ relation, total, anon, ajeno, nuevo, anon_columns }) => ({ relation, total, anon, ajeno, nuevo, anon_columns })) }, null, 2));
