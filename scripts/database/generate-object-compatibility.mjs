#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const contractPath = path.join(root, 'docs/database/arma2-functional-contract.md');
const outputPath = path.join(root, 'docs/database/arma2-object-compatibility.md');
const container = `supabase_db_${path.basename(root)}`;
const contract = fs.readFileSync(contractPath, 'utf8');

const directTargets = new Set(
  (contract.match(/^Tablas\/vistas: (.+)\.$/m)?.[1] || '')
    .split(', ')
    .map((value) => value.replaceAll('`', '').trim())
    .filter(Boolean),
);

const rpcSection = contract.split('## RPCs consumidas')[1]?.split('\n## ')[0] || '';
const directRpcs = new Set(
  [...rpcSection.matchAll(/^- `([^`]+)`$/gm)].map((match) => match[1]),
);

const query = (sql) => {
  const result = spawnSync('docker', [
    'exec',
    container,
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-At',
    '-F',
    '\t',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    sql,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim().split('\n').filter(Boolean).map((line) => line.split('\t'));
};

const relations = query(`
  select
    relation.relname,
    case relation.relkind
      when 'r' then 'tabla'
      when 'p' then 'tabla particionada'
      when 'v' then 'vista'
      when 'm' then 'vista materializada'
    end
  from pg_class relation
  where relation.relnamespace = 'public'::regnamespace
    and relation.relkind in ('r', 'p', 'v', 'm')
  order by relation.relname
`);

const functions = query(`
  select distinct procedure_row.proname
  from pg_proc procedure_row
  where procedure_row.pronamespace = 'public'::regnamespace
  order by procedure_row.proname
`);

const triggerFunctions = new Set(query(`
  select distinct procedure_row.proname
  from pg_trigger trigger_row
  join pg_proc procedure_row on procedure_row.oid = trigger_row.tgfoid
  where not trigger_row.tgisinternal
    and procedure_row.pronamespace = 'public'::regnamespace
  order by procedure_row.proname
`).flat());

const cronRows = query('select jobname, schedule, command from cron.job order by jobname');
const buckets = query('select id, public::text from storage.buckets order by id');

const escapeCell = (value) => String(value).replaceAll('|', '\\|').replace(/\s+/g, ' ').trim();
const relationRows = relations.map(([name, kind]) => [
  `public.${name}`,
  kind,
  directTargets.has(name) ? 'usado' : 'compatibilidad necesaria / indirecta',
  directTargets.has(name)
    ? 'Lectura o escritura estática detectada en cliente/Edge Function.'
    : 'Retenido: RPCs, triggers, FKs, vistas o flujos históricos pueden depender del objeto; no existe evidencia suficiente para eliminarlo.',
]);

const functionRows = functions.map(([name]) => {
  if (directRpcs.has(name)) {
    return [`public.${name}`, 'función/RPC', 'usado', 'RPC estática consumida por cliente o Edge Function.'];
  }
  if (triggerFunctions.has(name)) {
    return [`public.${name}`, 'función trigger', 'compatibilidad necesaria', 'Vinculada a un trigger activo.'];
  }
  return [
    `public.${name}`,
    'función interna/compat',
    'compatibilidad necesaria / indirecta',
    'Retenida para composición entre RPCs, jobs, mantenimiento o compatibilidad histórica; sin evidencia de eliminación segura.',
  ];
});

const lines = [
  '# Matriz de compatibilidad de objetos Arma2',
  '',
  'Generado: 2026-07-27.',
  '',
  'La clasificación es conservadora: “no aparece como llamada directa” no equivale a “se puede borrar”. Todo objeto incierto se retiene hasta contar con evidencia ejecutable de desuso.',
  '',
  '## Resumen',
  '',
  `- Relaciones públicas: **${relations.length}**.`,
  `- Funciones públicas (nombres únicos): **${functions.length}**.`,
  `- RPCs estáticas observadas: **${directRpcs.size}**.`,
  `- Funciones conectadas a triggers: **${triggerFunctions.size}**.`,
  `- Jobs canónicos: **${cronRows.length}**.`,
  `- Buckets activos: **${buckets.length}**.`,
  '',
  '## Excepciones deliberadas',
  '',
  '| Objeto | Clasificación | Decisión |',
  '| --- | --- | --- |',
  '| `public.exec_sql` | legacy inseguro | No se crea. Sólo aparece en scripts de reparación/build; exponer SQL arbitrario contradice privilegio mínimo. |',
  '| `public.compute_awards_for_match` | compatibilidad opcional | No se crea. El cliente trata explícitamente su ausencia como opcional y ejecuta el cálculo/persistencia canónicos. |',
  '| `tournament-media` (bucket) | futuro apagado | No se crea; Multimedia Upload permanece fail-closed. Se conservan metadata/RPCs y policies de preparación. |',
  '| Estudio Social | no iniciado | No se agregan objetos ni permisos. |',
  '',
  '## Relaciones',
  '',
  '| Objeto | Tipo | Clasificación | Evidencia/decisión |',
  '| --- | --- | --- | --- |',
  ...relationRows.map((row) => `| ${row.map((value) => `\`${escapeCell(value)}\``).join(' | ')} |`),
  '',
  '## Funciones y RPCs',
  '',
  '| Objeto | Tipo | Clasificación | Evidencia/decisión |',
  '| --- | --- | --- | --- |',
  ...functionRows.map((row) => `| ${row.map((value) => `\`${escapeCell(value)}\``).join(' | ')} |`),
  '',
  '## Jobs pg_cron',
  '',
  '| Job | Schedule | Comando |',
  '| --- | --- | --- |',
  ...cronRows.map(([name, schedule, command]) => `| \`${escapeCell(name)}\` | \`${escapeCell(schedule)}\` | \`${escapeCell(command)}\` |`),
  '',
  '## Storage',
  '',
  '| Bucket | Público | Estado |',
  '| --- | --- | --- |',
  ...buckets.map(([name, isPublic]) => `| \`${escapeCell(name)}\` | \`${escapeCell(isPublic)}\` | activo y cubierto por golden test |`),
  '',
  '## Archivo SQL',
  '',
  '- `supabase/migrations/`: fuente ejecutable canónica; contiene sólo baseline + contratos.',
  '- `supabase/migrations_history/`: historial preservado, no ejecutable por Supabase CLI.',
  '- `migrations/`, `migrations/legacy/` y `db/migrations/`: evidencia legacy; no son fuente de verdad.',
  '',
];

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${lines.join('\n')}\n`);
console.log(`Wrote ${path.relative(root, outputPath)} with ${relationRows.length + functionRows.length} object rows.`);
