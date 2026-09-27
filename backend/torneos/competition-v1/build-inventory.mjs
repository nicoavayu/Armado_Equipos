#!/usr/bin/env node
// COMPETITION-V1 — renders INVENTORY.md (Phase A) from contract.json and the certification evidence.
// Pure local file transformation: `node backend/torneos/competition-v1/build-inventory.mjs`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(fs.readFileSync(path.join(dir, 'contract.json'), 'utf8'));
const evidence = Object.fromEntries(['node', 'edge'].map((g) => [g, JSON.parse(fs.readFileSync(path.join(dir, `evidence/${g}/results.json`), 'utf8'))]));
const exercised = new Set(evidence.node.summary.exercised);
const matrixBy = new Map();
for (const row of evidence.node.matrix) matrixBy.set(row.rpc, [...(matrixBy.get(row.rpc) ?? []), row.why]);

// Existing frontend tests per surface (src/__tests__) and what COMPETITION-V1 added.
const FRONTEND_TESTS = {
  fixtures: ['torneosFixtureContext', 'torneosCompetitionFlow', 'torneosDesktopSchedulingLayout', 'tournamentFixtureService'],
  match_operations: ['torneosMatchOperationsFlow', 'torneosMatchLocalization', 'torneosAttendanceActorContract', 'torneosPlayerMatchesRelations', 'tournamentMatchOperationsService'],
  standings: ['torneosCompetitionCenter'],
  lifecycle_actions: ['torneosCompetitionContext', 'torneosCompetitionFlow'],
  participant_withdrawal: ['torneosTeamsFlow'],
  participant_hub: ['torneosParticipantHub', 'torneosParticipantHubService', 'torneosUnifiedExperience'],
  communications: ['torneosCommunications', 'torneosCommunicationsService'],
  notifications: ['torneosCommunications'],
  public_pages: ['torneosPublicPages', 'torneosPublicPagesService', 'torneosCompetitionV1PublicRoute (new)'],
};
const RISK = {
  fixtures: 'Writes the competition structure. Season scope was missing on update_draft_fixture (fixed in 0004). Service-only archive/postpone/cancel/restore stay closed; the UI hides "Descartar borrador".',
  match_operations: 'Official results feed standings. Dual control (submitter ≠ validator), official/correction idempotent under concurrency, captains limited to their own squad — all exercised.',
  standings: 'Published table is what participants and the public page see. Rebuild is idempotent by key; qualification refuses ambiguous tables.',
  lifecycle_actions: 'Finish requires no pending commitments; reopen is owner-only (tournaments.reopen).',
  participant_withdrawal: 'Irreversible for the season; participants.withdraw staff only (captains/collaborators refused).',
  participant_hub: 'Read-only published projections for participants; hub access = season staff or active captain/delegate/player of an approved entry.',
  communications: 'Recipients are resolved server-side at publish; collaborators may draft but never publish. Publishing a document had an authorization-order oracle (fixed in 0004).',
  notifications: 'Own preferences only; no delivery channel exists in Torneos (in-app inbox).',
  public_pages: 'The only anonymous surface: one read RPC behind the gateway public route (no credential accepted, exact arguments, 2 KiB). Unpublished/unknown slug → null.',
};

const lines = [];
lines.push('# COMPETITION-V1 — Inventario (Fase A)', '');
lines.push('Generado por `build-inventory.mjs` desde [`contract.json`](contract.json) y la evidencia de certificación LOCAL (`evidence/node|edge/results.json`). No editar a mano.', '');
lines.push(`Contrato: **${Object.values(contract.features).reduce((n, f) => n + Object.keys(f.rpcs).length, 0)} RPC** en ${Object.keys(contract.features).length} superficies (74 autenticadas + 1 pública), 3 tablas leídas por la ruta de tablas (members, venues, courts). Categorías: ${Object.keys(contract.categories).join(', ')}.`, '');
lines.push('Columnas: **cat** = categoría del contrato · **scope** = season / organization / resource / self / public · **DB** = de dónde sale el EXECUTE · **2B** = veredicto Phase 2B · **journey** = ejercida con éxito por `integration/torneos-core-contracts/competition.test.mjs` (Node y Edge) · **matriz** = actores rechazados con 42501 en C2.', '');
for (const [feature, f] of Object.entries(contract.features)) {
  lines.push(`## ${feature}`, '');
  lines.push(`- Rutas: ${f.frontend_routes.map((r) => `\`${r}\``).join(' · ')}`);
  lines.push(`- Componentes: ${f.frontend_components.map((c) => `\`${c}\``).join(', ')}`);
  if (f.tables.length) lines.push(`- Tablas (GET, RLS): ${f.tables.map((t) => `\`${t}\``).join(', ')}`);
  lines.push(`- Tests frontend existentes: ${FRONTEND_TESTS[feature].map((t) => `\`${t}\``).join(', ')}; agregados: \`competition-adapter.test.mjs\` (paridad de payload), \`torneosStagingV1Composition\` (composición híbrida).`);
  lines.push(`- Riesgo: ${RISK[feature]}`, '');
  lines.push('| RPC | alias | cat | scope | escribe | autoridad | DB | 2B | journey | matriz |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const [name, r] of Object.entries(f.rpcs)) {
    const m = matrixBy.get(name) ?? [];
    const journey = r.route === 'public' ? 'B14 + D2' : (exercised.has(name) ? 'sí' : '—');
    lines.push(`| \`${name}\` | \`${r.frontend_alias}\` | ${r.category.replace('_', ' ')} | ${r.scope} | ${r.write ? 'sí' : 'no'} | ${r.authority.replace(/\|/g, "/")}${r.collaborator_allowed ? ' · collaborator redacta' : ''}${r.team_manager ? ' · capitán del equipo' : ''} | ${r.db_acl} | ${r.phase2b} | ${journey} | ${m.length ? [...new Set(m)].join(', ') : '—'} |`);
  }
  lines.push('');
}
lines.push('## Fuera del contrato', '');
lines.push('| RPC / alias | motivo |', '|---|---|');
for (const [group, entries] of Object.entries(contract.excluded)) {
  if (Array.isArray(entries)) for (const e of entries) lines.push(`| \`${e.split(' ')[0]}\` | ${group.replace(/_/g, ' ')}${e.includes(' ') ? ` — ${e.slice(e.indexOf(' ') + 1)}` : ''} |`);
  else for (const [n, why] of Object.entries(entries)) lines.push(`| \`${n}\` | ${group.replace(/_/g, ' ')} — ${why} |`);
}
lines.push('');
fs.writeFileSync(path.join(dir, 'INVENTORY.md'), lines.join('\n'));
console.log(`INVENTORY.md: ${lines.length} lines`);
