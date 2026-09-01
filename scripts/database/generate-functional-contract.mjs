#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findRegisteredSupabaseCalls } from './static-supabase-targets.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '../..');
const outputPath = path.join(root, 'docs/database/arma2-functional-contract.md');
const sourceRoots = ['src', 'supabase/functions'];
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

const walk = (directory) => {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'build', 'dist', 'coverage'].includes(entry.name)) return [];
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
};

const files = sourceRoots
  .flatMap((directory) => walk(path.join(root, directory)))
  .filter((file) => sourceExtensions.has(path.extname(file)))
  .filter((file) => !file.includes(`${path.sep}__tests__${path.sep}`));

const escapeCell = (value) => String(value ?? '—')
  .replace(/\s+/g, ' ')
  .replace(/\|/g, '\\|')
  .trim() || '—';

const clip = (value, max = 180) => {
  const normalized = escapeCell(value);
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
};

const lineAt = (text, index) => text.slice(0, index).split('\n').length;

const flowFor = (relative) => {
  const value = relative.toLowerCase();
  if (value.includes('/torneos/')) return 'Arma2 Torneos';
  if (value.includes('voting') || value.includes('votar') || value.includes('/db/matches')) return 'Votación y armado';
  if (value.includes('encuesta') || value.includes('survey') || value.includes('award') || value.includes('penalt') || value.includes('absence') || value.includes('stats')) return 'Post partido';
  if (value.includes('friend') || value.includes('amigo') || value.includes('group') || value.includes('chat')) return 'Social';
  if (value.includes('auto_match') || value.includes('automatch') || value.includes('availability') || value.includes('quierojugar') || value.includes('quiero_jugar')) return 'Partido automático / mercado';
  if (value.includes('notification') || value.includes('push')) return 'Notificaciones';
  if (value.includes('auth') || value.includes('profile') || value.includes('onboarding') || value.includes('useridentity')) return 'Autenticación y perfil';
  if (value.includes('partido') || value.includes('match') || value.includes('player') || value.includes('equipo') || value.includes('team')) return 'Partidos';
  return 'Aplicación transversal';
};

const publicRpcNames = new Set([
  'get_invite_landing',
  'get_partido_by_invite',
  'resolve_match_by_code',
  'validate_guest_match_invite',
  'is_public_voting_open',
  'public_has_voter_already_voted',
  'public_mark_voter_completed',
  'public_submit_no_lo_conozco',
  'public_submit_player_rating',
  'get_published_tournament_documents',
  'get_published_tournament_matches',
  'get_published_tournament_media',
  'get_published_tournament_standings',
  'get_published_tournament_statistics',
  'get_published_tournament_teams',
  'get_tournament_announcement',
  'get_tournament_participant_hub',
  'get_tournament_participant_match',
]);

const permissionFor = (relative, kind, target) => {
  if (relative.startsWith('supabase/functions/')) return 'service_role/backend o JWT según Function';
  if (kind === 'auth') return target.includes('signIn') || target.includes('signUp') || target.includes('resetPassword')
    ? 'anon permitido por Auth'
    : 'sesión del usuario';
  if (kind === 'rpc' && publicRpcNames.has(target)) return 'anon + authenticated; validación interna por token/código/publicación';
  if (kind === 'storage' && target === 'jugadores-fotos') return 'lectura pública; escritura authenticated';
  if (kind === 'storage' && target === 'team-crests') return 'lectura pública; escritura authenticated en carpeta propia';
  if (/public|invite|votar/i.test(relative) && kind === 'read') return 'anon/authenticated según RLS o vista security_invoker';
  return 'authenticated según RLS/capability; service_role sólo backend';
};

const nearestErrors = (text, index) => {
  const nearby = text.slice(Math.max(0, index - 1800), Math.min(text.length, index + 2200));
  const values = new Set();
  for (const match of nearby.matchAll(/(?:code\s*===?\s*|code:\s*)['"`]([A-Z0-9_]{4,})['"`]/g)) values.add(match[1]);
  for (const match of nearby.matchAll(/['"`]((?:TORNEOS|PGRST|23505|42501|not_|invalid_|already_|forbidden|unauthorized)[A-Z0-9_a-z-]*)['"`]/g)) values.add(match[1]);
  for (const match of nearby.matchAll(/(?:throw new Error|RAISE EXCEPTION)\s*\(\s*['"`]([^'"`]{3,100})['"`]/g)) values.add(match[1]);
  return [...values].slice(0, 6).join(', ') || 'error Supabase propagado / fallback UI';
};

const chainAfter = (text, index, max = 2200) => {
  const slice = text.slice(index, index + max);
  const terminator = slice.search(/;\s*(?:\n|$)/);
  return slice.slice(0, terminator >= 0 ? terminator + 1 : Math.min(slice.length, 900));
};

const operations = [];
const subscriptions = [];

const addOperation = ({ flow, client, kind, target, input, output, permission, error }) => {
  operations.push({ flow, client, kind, target, input, output, permission, error });
};

for (const absolute of files) {
  const relative = path.relative(root, absolute);
  const text = fs.readFileSync(absolute, 'utf8');
  const flow = flowFor(relative);

  const literalFromCalls = [...text.matchAll(/\.from\(\s*(['"`])([^'"`]+)\1\s*\)/g)]
    .map((match) => ({ index: match.index, target: match[2] }));
  const registeredFromCalls = findRegisteredSupabaseCalls(text, relative, 'from');
  for (const match of [...literalFromCalls, ...registeredFromCalls]) {
    const prefix = text.slice(Math.max(0, match.index - 120), match.index);
    const chain = chainAfter(text, match.index);
    const isStorage = /\.storage\s*$/.test(prefix) || /storage\s*\n?\s*$/.test(prefix);
    const mutation = chain.match(/\.(insert|upsert|update|delete)\s*\(([\s\S]{0,500}?)(?:\)\s*\.|\)\s*[;,])/);
    const select = chain.match(/\.select\s*\(\s*(['"`])([\s\S]*?)\1/);
    const filters = [...chain.matchAll(/\.(eq|neq|in|contains|overlaps|gte|lte|lt|gt|is|or|match)\s*\(([\s\S]{0,120}?)\)/g)]
      .map((item) => `${item[1]}(${clip(item[2], 80)})`)
      .slice(0, 5)
      .join('; ');
    const kind = isStorage ? 'storage' : mutation ? 'write' : 'read';
    const operation = isStorage
      ? (chain.match(/\.(upload|remove|download|getPublicUrl|list|createSignedUrl)\s*\(/)?.[1] || 'bucket')
      : (mutation?.[1] || 'select');
    addOperation({
      flow,
      client: `${relative}:${lineAt(text, match.index)}`,
      kind,
      target: isStorage ? `storage:${match.target} (${operation})` : match.target,
      input: mutation ? `${operation}: ${clip(mutation[2])}${filters ? `; ${filters}` : ''}` : (filters || 'sin filtro estático'),
      output: select ? clip(select[2]) : (isStorage ? 'Storage response / public URL' : operation === 'delete' ? 'filas afectadas' : 'payload Supabase'),
      permission: permissionFor(relative, kind, match.target),
      error: nearestErrors(text, match.index),
    });
  }

  const literalRpcCalls = [...text.matchAll(/\.rpc\(\s*(['"`])([^'"`]+)\1\s*(?:,\s*([\s\S]{0,700}?))?\)/g)]
    .map((match) => ({ index: match.index, target: match[2], args: match[3] || '' }));
  const registeredRpcCalls = findRegisteredSupabaseCalls(text, relative, 'rpc');
  for (const match of [...literalRpcCalls, ...registeredRpcCalls]) {
    const chain = chainAfter(text, match.index, 1200);
    const select = chain.match(/\.select\s*\(\s*(['"`])([\s\S]*?)\1/);
    addOperation({
      flow,
      client: `${relative}:${lineAt(text, match.index)}`,
      kind: 'rpc',
      target: match.target,
      input: clip(match.args || '{}'),
      output: select ? clip(select[2]) : 'payload definido por RPC; data/error',
      permission: permissionFor(relative, 'rpc', match.target),
      error: nearestErrors(text, match.index),
    });
  }

  for (const match of text.matchAll(/functions\.invoke\(\s*(['"`])([^'"`]+)\1\s*(?:,\s*([\s\S]{0,700}?))?\)/g)) {
    addOperation({
      flow,
      client: `${relative}:${lineAt(text, match.index)}`,
      kind: 'edge-function',
      target: match[2],
      input: clip(match[3] || '{}'),
      output: 'HTTP Function data/error',
      permission: 'según supabase/config.toml verify_jwt',
      error: nearestErrors(text, match.index),
    });
  }

  for (const match of text.matchAll(/\.auth\.(signUp|signInWithPassword|signInWithOAuth|signOut|refreshSession|getSession|getUser|setSession|resetPasswordForEmail|updateUser|onAuthStateChange)\s*\(([\s\S]{0,700}?)\)/g)) {
    addOperation({
      flow: 'Autenticación y perfil',
      client: `${relative}:${lineAt(text, match.index)}`,
      kind: 'auth',
      target: `auth.${match[1]}`,
      input: clip(match[2] || '{}'),
      output: 'Session/User/AuthError según supabase-js',
      permission: permissionFor(relative, 'auth', match[1]),
      error: nearestErrors(text, match.index),
    });
  }

  for (const match of text.matchAll(/\.channel\(\s*([\s\S]{0,160}?)\)([\s\S]{0,1600}?)\.subscribe\(/g)) {
    const tail = match[2];
    const changes = [...tail.matchAll(/postgres_changes['"`]?\s*,\s*\{([\s\S]{0,320}?)\}/g)]
      .map((item) => clip(item[1], 240));
    subscriptions.push({
      flow,
      client: `${relative}:${lineAt(text, match.index)}`,
      channel: clip(match[1], 100),
      filters: changes.join('; ') || 'canal Realtime/broadcast',
    });
  }
}

const uniqueOperations = [...new Map(operations.map((item) => [
  [item.client, item.kind, item.target, item.input, item.output].join('|'),
  item,
])).values()].sort((a, b) => a.flow.localeCompare(b.flow) || a.target.localeCompare(b.target) || a.client.localeCompare(b.client));

const uniqueSubscriptions = [...new Map(subscriptions.map((item) => [
  [item.client, item.channel, item.filters].join('|'),
  item,
])).values()].sort((a, b) => a.client.localeCompare(b.client));

const appText = fs.readFileSync(path.join(root, 'src/App.js'), 'utf8');
const routes = [...appText.matchAll(/<Route[\s\S]{0,280}?\bpath=\{?(['"`])([^'"`]+)\1/g)]
  .map((match) => ({ route: match[2], line: lineAt(appText, match.index) }));

const routeConfigFiles = [
  'src/config/publicVotingRoutes.js',
  'src/config/publicMatchInviteRoutes.js',
  'src/utils/authRedirectUrl.js',
  'src/utils/nativeAppLink.js',
].filter((file) => fs.existsSync(path.join(root, file)));

const deeplinks = routeConfigFiles.flatMap((relative) => {
  const text = fs.readFileSync(path.join(root, relative), 'utf8');
  return [...text.matchAll(/['"`]((?:\/|https?:\/\/|com\.)[^'"`\s]+)['"`]/g)]
    .map((match) => ({ value: match[1], client: `${relative}:${lineAt(text, match.index)}` }));
});

const errorConstantsFile = path.join(root, 'src/features/torneos/api/tournamentWorkspaceService.js');
const errorConstantsText = fs.existsSync(errorConstantsFile) ? fs.readFileSync(errorConstantsFile, 'utf8') : '';
const interpretedErrors = [...errorConstantsText.matchAll(/\b([A-Z][A-Z0-9_]{3,})\s*:\s*['"`]([^'"`]+)['"`]/g)]
  .map((match) => ({ code: match[1], message: match[2] }));

const directTables = [...new Set(uniqueOperations.filter((item) => ['read', 'write'].includes(item.kind)).map((item) => item.target))].sort();
const rpcNames = [...new Set(uniqueOperations.filter((item) => item.kind === 'rpc').map((item) => item.target))].sort();
const edgeFunctions = [...new Set(uniqueOperations.filter((item) => item.kind === 'edge-function').map((item) => item.target))].sort();
const buckets = [...new Set(uniqueOperations.filter((item) => item.kind === 'storage').map((item) => item.target.split(' ')[0].replace('storage:', '')))].sort();

const lines = [
  '# Golden contract funcional de Arma2',
  '',
  `Generado: ${new Date().toISOString()}.`,
  '',
  '> Este inventario se genera desde el código cliente y las Edge Functions con `node scripts/database/generate-functional-contract.mjs`. Es un contrato observable: conservar nombres, parámetros, proyecciones, permisos, errores y semántica. Las expresiones dinámicas se conservan como tales y requieren golden tests.',
  '',
  '## Resumen auditable',
  '',
  `- Operaciones Supabase estáticas: **${uniqueOperations.length}**.`,
  `- Tablas/vistas leídas o escritas directamente: **${directTables.length}**.`,
  `- RPCs estáticas consumidas: **${rpcNames.length}**.`,
  `- Edge Functions invocadas: **${edgeFunctions.length}**.`,
  `- Buckets consumidos: **${buckets.length}**.`,
  `- Suscripciones Realtime detectadas: **${uniqueSubscriptions.length}**.`,
  '',
  `Tablas/vistas: ${directTables.map((value) => `\`${value}\``).join(', ')}.`,
  '',
  `Buckets: ${buckets.map((value) => `\`${value}\``).join(', ')}.`,
  '',
  `Edge Functions: ${edgeFunctions.map((value) => `\`${value}\``).join(', ')}.`,
  '',
  '## Matriz de operaciones',
  '',
  '| Flujo | Cliente | Tabla/RPC | Input | Output | Permiso | Error esperado |',
  '| ----- | ------- | --------- | ----- | ------ | ------- | -------------- |',
  ...uniqueOperations.map((item) => `| ${escapeCell(item.flow)} | \`${escapeCell(item.client)}\` | \`${escapeCell(item.target)}\` (${item.kind}) | ${clip(item.input)} | ${clip(item.output)} | ${clip(item.permission)} | ${clip(item.error)} |`),
  '',
  '## RPCs consumidas',
  '',
  ...rpcNames.map((name) => `- \`${name}\``),
  '',
  '## Suscripciones Realtime',
  '',
  '| Flujo | Cliente | Canal | Evento/filtro |',
  '| ----- | ------- | ----- | ------------- |',
  ...uniqueSubscriptions.map((item) => `| ${escapeCell(item.flow)} | \`${escapeCell(item.client)}\` | \`${clip(item.channel)}\` | ${clip(item.filters)} |`),
  '',
  '## Rutas, deeplinks y flujos públicos',
  '',
  '| Ruta/deeplink | Fuente | Contrato |',
  '| -------------- | ------ | -------- |',
  ...routes.map((item) => `| \`${escapeCell(item.route)}\` | \`src/App.js:${item.line}\` | navegación existente; no exigir autenticación si el route guard actual no la exige |`),
  ...deeplinks.map((item) => `| \`${escapeCell(item.value)}\` | \`${escapeCell(item.client)}\` | alias/origen/deeplink existente |`),
  '',
  'Los flujos especialmente públicos son las invitaciones por token/código, la votación por `codigo`, los links compartidos y las lecturas de contenido publicado de Torneos. La baseline concede `anon` sólo a sus RPCs declaradas y mantiene las decisiones dentro de funciones `SECURITY DEFINER` validadas.',
  '',
  '## Códigos de error interpretados por UI',
  '',
  '| Código | Mensaje funcional observado |',
  '| ------ | ---------------------------- |',
  ...interpretedErrors.map((item) => `| \`${escapeCell(item.code)}\` | ${escapeCell(item.message)} |`),
  '',
  'Además de estos códigos nominales, la matriz conserva códigos PostgreSQL/PostgREST observados (`23505`, `42501`, `PGRST116`) y strings funcionales como `not_authenticated`, `forbidden`, `invalid_*` y `already_*`.',
  '',
  '## Configuración fuera del esquema',
  '',
  '- Auth providers, Site URL, redirects, SMTP, templates, password/session policy: inventariar en el proyecto actual y reproducir manualmente en el proyecto nuevo; no se almacenan secretos aquí.',
  '- Buckets activos en baseline: `jugadores-fotos` y `team-crests`.',
  '- `tournament-media` no se crea: Multimedia Upload permanece apagado.',
  '- Edge Functions y `verify_jwt` se conservan en `supabase/config.toml`.',
  '- Cron, Realtime publications, grants, policies y triggers forman parte de la baseline SQL.',
  '- Variables Vercel/nativas y service-role secrets deben migrarse por canal seguro, nunca al repositorio.',
  '',
  '## Regla de compatibilidad',
  '',
  'Cualquier cambio futuro de tabla interna debe mantener esta matriz mediante vista, wrapper o adapter, o actualizar focalizadamente el cliente con golden tests equivalentes. Un objeto dinámico o incierto no se retira sin evidencia de uso negativa en frontend, Edge Functions, scripts, tests, notificaciones y deeplinks.',
  '',
];

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${lines.join('\n').trimEnd()}\n`);
console.log(`Wrote ${path.relative(root, outputPath)} with ${uniqueOperations.length} operations.`);
