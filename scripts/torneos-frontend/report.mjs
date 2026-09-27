import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { audit, currentSources, root, read } from './audit.mjs';

// Rebuilds the B04 contract fixture and the call map from the WORKING TREE.
//
// Two fixtures live side by side:
//   • docs/torneos/b04/legacy-audit.json — the frozen inventory of the legacy Torneos
//     frontend at Phase 2D (2058da03). Never regenerated: it is what B04 migrates.
//   • docs/torneos/b04/b04-audit.json    — the audit of the integrated tree. The guards
//     compare the tree against it, so any new backend access reachable from Torneos
//     has to be re-audited here on purpose (this script) and reviewed in the diff.
// Neither test resolves a git revision: a squash-merge or a shallow clone changes
// nothing (F1).
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const legacy = JSON.parse(read('docs/torneos/b04/legacy-audit.json'));
const snapshot = audit(currentSources());
const fixture = {
  generatedFrom: head,
  legacyBase: legacy.base,
  coreSingletonSha256: createHash('sha256').update(read('src/lib/supabaseClient.js')).digest('hex'),
  ...snapshot,
};
const scope = JSON.parse(read('backend/torneos/phase2d/staging-v1-rpc-allowlist.json')).features;
// COMPETITION-V1: the hybrid adapter also routes the full-competition contract.
const competition = JSON.parse(read('backend/torneos/supabase/functions/torneos-gateway/competition-v1-rpc-allowlist.json'));
const allowed = new Set([...Object.values(scope).flat(), ...Object.values(competition.features).flat()]);
const rpcs = snapshot.calls.filter(c => c.kind === 'rpc');
const names = [...new Set(rpcs.flatMap(c => c.targets))].sort();
const link = (file, line) => `[${file}:${line}](../../../${file}#L${line})`;
const rows = (items) => items.map(name => {
  const sites = rpcs.filter(c => c.targets.includes(name));
  return `| \`${name}\` | ${[...new Set(sites.map(c => `\`${c.function}\``))].join(', ')} | ${sites.map(c => link(c.file,c.line)).join(', ')} |`;
}).join('\n');
const migratable = names.filter(n => allowed.has(n));
const blocked = names.filter(n => !allowed.has(n));
const legacyFiles = new Set(legacy.calls.map(c => c.file));
const b04Calls = snapshot.calls.filter(c => !legacyFiles.has(c.file));
const md = `# TORNEOS-CALL-MAP — auditoría B04

Inventario legacy congelado en \`${legacy.base}\` (Phase 2D); árbol integrado auditado en \`${head}\`. Reconstruido del código. No representa resultados de R2/R3/R4/R5.

${rpcs.length} sitios RPC legacy; ${names.length} nombres distintos; ${migratable.length} nombres dentro de scope; ${blocked.length} fuera. La selección dinámica de \`changeTournamentMatchPlan\` se resuelve a sus tres nombres literales. No quedan RPC dinámicas sin resolver.

## Encaminadas por el adapter híbrido — staging v1 + COMPETITION-V1 (${migratable.length})

\`src/features/torneos/stagingV1/stagingV1WorkspaceService.js\` expone la misma interfaz de aliases que \`tournamentWorkspaceService\` para estas ${migratable.length} RPC (mismo nombre, mismo payload \`p_*\`, verificado alias por alias contra el servicio legacy en \`scripts/torneos-frontend/adapter.test.mjs\` y \`competition-adapter.test.mjs\`) sobre \`foundation/torneosClient.execute\` → \`foundation/torneosTransport\` → \`POST {gateway}/torneos/rest/v1/rpc/<name>\`. Los sitios legacy siguen existiendo para la composición single-project LOCAL; la composición híbrida nunca los alcanza.

| RPC | Función frontend legacy | Sitio legacy |
| --- | --- | --- |
${rows(migratable)}

## Permitidas por los contratos, sin llamada frontend (${allowed.size - migratable.length})

${[...allowed].filter(n=>!names.includes(n)).sort().map(n=>`- \`${n}\``).join('\n')}

La foundation copia las ${allowed.size} operaciones de los contratos aprobados (Phase 2D + COMPETITION-V1) exactamente; no amplía la allowlist del backend. Además lee tres tablas del contrato certificado (\`tournament_organization_members\`, \`tournament_venues\`, \`tournament_courts\`, \`foundation/stagingV1Tables.js\`) y la página pública usa la ruta anónima de sólo lectura del gateway (\`${Object.values(competition.public).flat().join(', ')}\`).

## Bloqueadas por scope (${blocked.length})

\`torneosClient.execute\` devuelve \`TORNEOS_OUTSIDE_STAGING_V1\` antes de cualquier red. El adapter staging-v1 no tiene alias para ninguna; las pantallas las esconden o deshabilitan vía \`TorneosFeaturesContext\` (\`stagingV1/stagingV1Features.js\`).

| RPC | Función frontend | Sitio |
| --- | --- | --- |
${rows(blocked)}

## Accesos backend nuevos de B04 (${b04Calls.length})

Los únicos sitios fuera del inventario legacy. El transporte habla sólo con el gateway; el puente de sesión sólo lee la sesión Core.

| Tipo | Llamada | Sitio |
| --- | --- | --- |
${b04Calls.map(c=>`| ${c.kind} | \`${c.callee}\` | ${link(c.file,c.line)} |`).join('\n')}

## Tablas, Storage, Auth, red y persistencia legacy

Ninguna de estas superficies se habilita en la composición híbrida. \`from\` puede ser tabla o bucket: se muestra el receptor para distinguirlo.

| Tipo | Llamada | Destino literal | Sitio |
| --- | --- | --- | --- |
${snapshot.calls.filter(c=>c.kind!=='rpc' && legacyFiles.has(c.file)).map(c=>`| ${c.kind} | \`${c.callee}\` | ${c.targets.map(t=>`\`${t}\``).join(', ') || 'No literal / sin argumento'} | ${link(c.file,c.line)} |`).join('\n')}

## Imports directos del singleton Core (${snapshot.directSingletonImports.length})

| Archivo | Import |
| --- | --- |
${snapshot.directSingletonImports.map(c=>`| ${link(c.file,c.line)} | \`${c.source}\` |`).join('\n')}

## Dependencias Core transitivas dentro de Torneos (${snapshot.coreDependencies.length} aristas)

Cada fila es un import que alcanza el singleton por el grafo estático, no una consulta de datos ni una llamada en tiempo de ejecución. La única arista nueva de B04 es \`stagingV1/coreSessionBridge.js → lib/coreSupabaseClient.js\` (lectura de sesión y eventos de auth; nunca \`rpc\`/\`from\`/\`storage\`).

| Archivo | Import que alcanza Core |
| --- | --- |
${snapshot.coreDependencies.map(c=>`| ${link(c.file,c.line)} | \`${c.source}\` |`).join('\n')}

## Límites

AST estático JS/JSX/TS: imports relativos, reexports, require/import literales y miembros por nombre. No es análisis semántico general de código ofuscado, eval, aliases de métodos extraídos o imports calculados. Los módulos de foundation sólo pueden importar otros módulos de foundation; los guards congelan accesos backend transitivos. La autorización real sigue en gateway/ACL/RLS. Inventarios verificables: [legacy-audit.json](legacy-audit.json) (legacy congelado) y [b04-audit.json](b04-audit.json) (árbol integrado).
`;
fs.writeFileSync(`${root}/docs/torneos/b04/b04-audit.json`, JSON.stringify(fixture, null, 2) + '\n');
fs.writeFileSync(`${root}/docs/torneos/b04/TORNEOS-CALL-MAP.md`, md);
console.log(`HEAD ${head}: ${migratable.length} encaminadas, ${blocked.length} bloqueadas; ${allowed.size} operaciones de contrato; ${b04Calls.length} accesos nuevos B04.`);
