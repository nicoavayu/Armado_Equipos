#!/usr/bin/env node
// COMPETITION-V1 — reconciliation of the gateway delta 43 → 117 (authenticated route) + 1 (public route), RPC by RPC,
// from primary sources only (no hand-written table):
//   • grants BEFORE 0004 = the certified baseline ACL on the real Supabase image (phase2d/evidence/real-image-acl-after-
//     template0.json) minus the 0001 gate (phase2d/staging-v1-rpc-gate.json), shifted by MP-A2 (mp-a/mp-a2-acl-delta.json);
//   • grants AFTER 0004 = that + contract.acl.granted_by_0004 (the migration's GRANT list is checked equal to it);
//   • the journey = the adapter alias (stagingV1WorkspaceService.js) → the component that calls it (source grep; the
//     fixture context actions are followed to FixtureWorkspacePage);
//   • positive / negative tests = the committed lab evidence of BOTH gateways (evidence/{node,edge}/results.json).
// Writes RECONCILIATION.json and RECONCILIATION.md. `--check` only verifies (exit 1 on any broken invariant).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));

const contract = json('backend/torneos/competition-v1/contract.json');
const staging = json('backend/torneos/supabase/functions/torneos-gateway/staging-v1-rpc-allowlist.json');
const allow = json('backend/torneos/supabase/functions/torneos-gateway/competition-v1-rpc-allowlist.json');
const template0 = json('backend/torneos/phase2d/evidence/real-image-acl-after-template0.json').inventory.functions.filter((f) => f.schema === 'public');
const gate = new Set(json('backend/torneos/phase2d/staging-v1-rpc-gate.json').functions.map((g) => g.name));
const mpa2 = json('backend/torneos/mp-a/mp-a2-acl-delta.json');
const evidence = { node: json('backend/torneos/competition-v1/evidence/node/results.json'), edge: json('backend/torneos/competition-v1/evidence/edge/results.json') };
const migration = read('backend/torneos/supabase/migrations/00000000000004_competition_v1_rpc_exposure.sql');
const service = read('src/features/torneos/stagingV1/stagingV1WorkspaceService.js');
const fixtureContext = read('src/features/torneos/context/TorneosFixtureContext.jsx');
const fixturePage = read('src/features/torneos/components/FixtureWorkspacePage.jsx');
// The feature map as it was on main before COMPETITION-V1 (PR #158 merge).
const MAIN_BASE = 'ff9f9a77e4b7dfe99765f5b94055f94dedb2384b';
const oldFeatures = execFileSync('git', ['-C', REPO, 'show', `${MAIN_BASE}:src/features/torneos/stagingV1/stagingV1Features.js`], { encoding: 'utf8' });

const nameOf = (sig) => sig.replace(/\(.*$/, '').replace(/^public\./, '');
const failures = [];
const need = (ok, msg) => { if (!ok) failures.push(msg); };

// ── the sets ──
const stagingSet = new Set(Object.values(staging.features).flat());
const authSet = Object.values(allow.features).flat();
const publicSet = Object.values(allow.public).flat();
need(stagingSet.size === 43, `staging v1 allowlist is ${stagingSet.size}, not 43`);
need(authSet.length === 74 && new Set(authSet).size === 74, `competition authenticated allowlist is ${authSet.length}`);
need(authSet.every((n) => !stagingSet.has(n)), 'competition allowlist overlaps staging v1');
need(publicSet.length === 1 && publicSet[0] === 'get_public_tournament_page', 'public route is not exactly get_public_tournament_page');
const granted0004 = new Set(contract.acl.granted_by_0004.map(nameOf));
const migrationGrants = new Set([...migration.matchAll(/^GRANT EXECUTE ON FUNCTION public\.(\w+)\(/gm)].map((m) => m[1]));
need(JSON.stringify([...granted0004].sort()) === JSON.stringify([...migrationGrants].sort()), 'contract granted_by_0004 ≠ the GRANT statements of 0004');

// ── grants before / after 0004, per function name (the 75 names are not overloaded in public) ──
const t0 = (n) => { const rows = template0.filter((f) => nameOf(f.function) === n); need(rows.length === 1, `${n}: ${rows.length} baseline signatures`); return rows[0]; };
const mpaGranted = new Set(mpa2.authenticated_execute_granted.map(nameOf));
const mpaRevoked = new Set(mpa2.authenticated_execute_revoked.map(nameOf));
const before = (n, role) => { const f = t0(n); if (!f) return null; if (gate.has(n)) return role === 'service_role' ? f.service_role : false; if (role === 'authenticated') return mpaGranted.has(n) ? true : (mpaRevoked.has(n) ? false : f.authenticated); return f[role]; };

// ── journeys: alias → components (fixture context actions followed to the workspace page) ──
const srcFiles = [];
(function walk(d) { for (const e of fs.readdirSync(path.join(REPO, d), { withFileTypes: true })) { const r = `${d}/${e.name}`; if (e.isDirectory()) { if (e.name !== '__tests__') walk(r); } else if (/\.(jsx?|tsx?)$/.test(e.name)) srcFiles.push(r); } })('src/features/torneos');
const uiFiles = srcFiles.filter((f) => !/Service\.js$|service\.js$|legacy|[Aa]dapter|foundation\//.test(f));
const ctxAction = {};
for (const m of fixtureContext.matchAll(/(\w+): \([^)]*\) => (?:mutate\(\s*(?:\(\) => |async \(\) => \{\s*const result = await )?)?service\.(\w+)\(/g)) ctxAction[m[2]] = m[1];
function callers(alias) {
  const re = new RegExp(`\\b${alias}\\b`);
  const direct = uiFiles.filter((f) => re.test(read(f))).map((f) => path.basename(f));
  const out = new Set(direct.filter((f) => f !== 'TorneosFixtureContext.jsx' && f !== 'TorneosCompetitionContext.jsx'));
  if (direct.includes('TorneosFixtureContext.jsx') && ctxAction[alias] && new RegExp(`actions\\.${ctxAction[alias]}\\(`).test(fixturePage)) out.add(`FixtureWorkspacePage.jsx (actions.${ctxAction[alias]})`);
  if (direct.includes('TorneosFixtureContext.jsx') && !ctxAction[alias] && new RegExp(`service\\.${alias}\\(`).test(fixtureContext)) out.add('TorneosFixtureContext.jsx (provider load of the fixture / programación routes)');
  if (direct.includes('TorneosCompetitionContext.jsx') && !out.size) out.add('TorneosCompetitionContext.jsx');
  return [...out].sort();
}

// ── evidence ──
const exercised = { node: new Set(evidence.node.summary.exercised), edge: new Set(evidence.edge.summary.exercised) };
const negatives = (n) => [...new Set(evidence.edge.matrix.filter((m) => m.rpc === n).map((m) => m.why))];
const negStatuses = (n) => [...new Set(evidence.edge.matrix.filter((m) => m.rpc === n).map((m) => `${m.status}${m.code ? ` ${m.code}` : ''}`))];
need(evidence.node.summary.failed === 0 && evidence.edge.summary.failed === 0, 'lab evidence has failures');

const OFF_AT_MAIN = (feature) => new RegExp(`^\\s*${feature}: false,`, 'm').test(oldFeatures.split('const OFF')[1] ?? '');
const rows = [];
for (const [feature, def] of Object.entries(contract.features)) {
  for (const [name, d] of Object.entries(def.rpcs ?? {})) {
    const pub = d.route === 'public';
    const inAllow = pub ? publicSet.includes(name) : authSet.includes(name);
    need(inAllow, `${name}: in contract but not in the gateway allowlist`);
    const alias = d.frontend_alias.split(' ')[0];
    const mapped = pub || new RegExp(`\\b${alias}\\s*:[\\s\\S]{0,400}?['"]${name}['"]`).test(service);
    need(mapped, `${name}: adapter alias ${alias} does not call it`);
    const ui = pub ? ['PublicTournamentPage.jsx (via publicTournamentComposition.js)'] : callers(alias);
    need(ui.length > 0, `${name}: no UI caller for ${alias}`);
    const authBefore = before(name, 'authenticated');
    const anonBefore = before(name, 'anon');
    const cls = pub ? 'C' : granted0004.has(name) ? 'A' : 'B';
    if (cls === 'A') need(gate.has(name) && authBefore === false, `${name}: class A but not gated/closed before 0004`);
    if (cls === 'B') need(!gate.has(name) && authBefore === true, `${name}: class B but authenticated lacked EXECUTE before 0004`);
    if (cls === 'C') need(anonBefore === true, `${name}: public RPC without anon EXECUTE`);
    const neg = negatives(name);
    const posNode = pub || exercised.node.has(name); const posEdge = pub || exercised.edge.has(name);
    if (pub) { const ok = (e) => ['D2', 'D5b', 'D6'].every((k) => e.results.some((r) => r.name.startsWith(`${k} `) && r.status === 'PASS')); need(ok(evidence.node) && ok(evidence.edge), `${name}: public route checks not PASS on both gateways`); }
    else need(posNode && posEdge, `${name}: not exercised on both gateways`);
    need(pub || neg.length > 0, `${name}: no negative row in the matrix`);
    need(pub || OFF_AT_MAIN(feature), `${name}: feature ${feature} was not OFF at main`);
    rows.push({ rpc: name, class: cls, feature, route: d.route, category: d.category, scope: d.scope, write: d.write, authority: d.authority,
      collaborator_writes: !!d.collaborator_allowed, team_manager: !!d.team_manager, phase2b: d.phase2b,
      execute_before_0004: { authenticated: authBefore, anon: anonBefore, gated_by_0001: gate.has(name) }, execute_after_0004: { authenticated: cls === 'A' ? true : authBefore, anon: anonBefore },
      alias, ui, routes: def.frontend_routes, positive: { node: posNode, edge: posEdge }, negative: neg, negative_statuses: negStatuses(name),
      why_blocked_before: pub ? 'no public route existed (the gateway served only bearer-authenticated RPCs)' : `feature "${feature}" was OFF in stagingV1Features at main, so the RPC was left out of the 43`,
    });
  }
}
need(rows.filter((r) => r.class === 'A').length === 15, 'class A ≠ 15');
need(rows.filter((r) => r.class === 'B').length === 59, 'class B ≠ 59');
need(rows.filter((r) => r.class === 'C').length === 1, 'class C ≠ 1');
need(rows.filter((r) => r.route === 'authenticated').length === 74, 'authenticated rows ≠ 74');

const summary = { staging_v1: 43, competition_authenticated: 74, authenticated_total: 117, public: 1,
  class_A_new_grant: rows.filter((r) => r.class === 'A').length, class_B_already_granted: rows.filter((r) => r.class === 'B').length, class_C_public: 1,
  writes: rows.filter((r) => r.write).length, reads: rows.filter((r) => !r.write).length,
  by_category: Object.fromEntries(['ADMIN_OWNER', 'PRIVATE_AUTHENTICATED', 'PUBLIC_READ_ONLY'].map((c) => [c, rows.filter((r) => r.category === c).length])),
  removed_from_allowlist: 0, failures };

if (process.argv.includes('--check')) {
  if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
  console.log(`RECONCILIATION_OK ${JSON.stringify({ A: summary.class_A_new_grant, B: summary.class_B_already_granted, C: 1 })}`);
  process.exit(0);
}
fs.writeFileSync(path.join(HERE, 'RECONCILIATION.json'), `${JSON.stringify({ generated_by: 'backend/torneos/competition-v1/reconcile.mjs', summary, rows }, null, 1)}\n`);

// ── markdown ──
const yn = (v) => (v === true ? 'sí' : v === false ? 'no' : '?');
const role = (r) => r.category === 'PUBLIC_READ_ONLY' ? 'anónimo (ruta pública)' : r.category === 'ADMIN_OWNER'
  ? (r.write ? (r.collaborator_writes ? 'owner/admin; collaborator sólo borrador' : 'owner/admin') : 'owner/admin/collaborator (lectura)')
  : (r.team_manager ? 'staff o capitán/delegado del equipo' : r.scope === 'self' ? 'cualquier identidad, sólo sus filas' : 'participante/destinatario del recurso');
const guard = (r) => `${r.authority}${r.scope === 'season' ? ' + acceso a la temporada' : r.scope === 'organization' ? ' (organización activa)' : ''}`;
const neg = (r) => r.class === 'C' ? 'D2/D5b (credenciales, nombre, forma, tamaño, cota)' : `${r.negative.join(', ')} → ${r.negative_statuses.join(' / ')}`;
const table = (cls) => ['| # | RPC | feature | pantalla / journey | rol | EXECUTE antes de 0004 (auth) | guard | + | − |', '|---|---|---|---|---|---|---|---|---|',
  ...rows.filter((r) => r.class === cls).map((r, i) => `| ${i + 1} | \`${r.rpc}\` | ${r.feature} | ${r.ui.join('<br>')} | ${role(r)} | ${yn(r.execute_before_0004.authenticated)}${r.execute_before_0004.gated_by_0001 ? ' (cerrada por 0001)' : ''}${r.execute_before_0004.anon ? '; anon sí' : ''} | ${guard(r)} | Node ✔ Edge ✔ | ${neg(r)} |`)].join('\n');
const md = `# COMPETITION-V1 — reconciliación 43 → 117 (+1 pública)

Generado por [\`reconcile.mjs\`](reconcile.mjs) desde fuentes primarias (ACL del baseline en la imagen real + gate 0001 +
delta MP-A2; alias del adapter → componente; evidencia de laboratorio de **ambos** gateways). \`node reconcile.mjs --check\`
verifica todos los invariantes (lo corre \`reconcile.test.mjs\`). Datos completos: [\`RECONCILIATION.json\`](RECONCILIATION.json).

## Aritmética

| conjunto | RPC |
|---|---|
| staging v1 (sin cambios) | 43 |
| COMPETITION-V1 ruta autenticada | **74** = A 15 + B 59 |
| total ruta autenticada | 117 |
| ruta pública anónima (C) | 1 |
| lecturas / escrituras (de las 75) | ${summary.reads} / ${summary.writes} |
| ADMIN_OWNER / PRIVATE_AUTHENTICATED / PUBLIC_READ_ONLY | ${summary.by_category.ADMIN_OWNER} / ${summary.by_category.PRIVATE_AUTHENTICATED} / ${summary.by_category.PUBLIC_READ_ONLY} |
| quitadas de la allowlist por no tener journey | **0** (las 75 tienen un llamador de UI real) |

- **A (15)**: 0001 les quitó EXECUTE a \`authenticated\`; 0004 lo devuelve. Sin 0004 el gateway las serviría y la DB las negaría.
- **B (59)**: \`authenticated\` ya tenía EXECUTE en Production desde el baseline (0001 no las tocó). Sólo el gateway las
  bloqueaba, porque su feature estaba OFF en \`stagingV1Features\`. **Ojo:** un bridge token válido ya podía llamarlas
  directo en Torneos PostgREST (C5 de GATEWAY_AUTH_CERTIFIED). La allowlist no era la frontera de estas 59: lo son el ACL
  de la DB y el guard de cada función. Abrirlas en el gateway no agrega privilegio de DB.
- **C (1)**: \`get_public_tournament_page\` ya era ejecutable por \`anon\` desde el baseline. La clave publicable de Torneos
  la entrega \`/config\` del gateway, así que ya era llamable directo en PostgREST. La ruta pública no agrega privilegio.

Por qué estaban fuera antes: las 74 pertenecen a features que en \`main\` estaban OFF en \`stagingV1Features\` (fixtures,
match_operations, standings, lifecycle_actions, participant_withdrawal, communications, notifications, participant_hub,
public_pages). Por qué hacen falta ahora: son exactamente las que llaman las pantallas de esas features (columna
"pantalla"). Ninguna RPC de la allowlist queda sin llamador.

Columnas: **+** = ejercida con 200 por un actor legítimo en el journey B del lab (gateway Node y Edge). **−** = filas de la
matriz negativa (otro workspace, membresía removida, admin de otra temporada, collaborator escribiendo, jugador/capitán
en RPC de staff, aislamiento de RPC self-scoped) con su resultado. Además, las 74 sin bearer → 401 (C3); las 15 de A
directas en PostgREST como anon → negadas por ACL (C4).

## A — 15 RPC que necesitan el GRANT de 0004

${table('A')}

## B — 59 RPC que ya tenían GRANT y estaban bloqueadas sólo por el gateway

${table('B')}

## C — ruta pública anónima

${table('C')}
`;
fs.writeFileSync(path.join(HERE, 'RECONCILIATION.md'), md);
console.log(`written RECONCILIATION.{md,json} — A ${summary.class_A_new_grant}, B ${summary.class_B_already_granted}, C 1; failures ${failures.length}`);
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
