#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import productionGuard from './production-guard.js';
import { buildCanonicalManifest } from './torneos-demo-manifest.mjs';

const { assertLocalDatabaseTarget } = productionGuard;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SHORT_TERM_TABLES = new Set([
  'tournament_announcement_audiences',
  'tournament_announcement_deliveries',
  'tournament_announcement_links',
  'tournament_announcements',
  'tournament_courts',
  'tournament_disciplinary_overrides',
  'tournament_document_acknowledgements',
  'tournament_document_versions',
  'tournament_documents',
  'tournament_match_availability_responses',
  'tournament_match_reschedules',
  'tournament_match_resumptions',
  'tournament_match_sources',
  'tournament_match_squad_players',
  'tournament_match_squads',
  'tournament_media_assets',
  'tournament_media_galleries',
  'tournament_media_gallery_items',
  'tournament_notification_preferences',
  'tournament_points_adjustments',
  'tournament_qualification_resolutions',
  'tournament_roster_settings',
  'tournament_schedule_windows',
  'tournament_scoring_rules',
  'tournament_team_invitations',
  'tournament_team_reviews',
  'tournament_tiebreak_rules',
]);

function classificationFor(tableName, criticalTables) {
  if (criticalTables.has(tableName)) return 'critical_qa';
  if (SHORT_TERM_TABLES.has(tableName)) return 'short_term';
  return 'no_current_evidence';
}

async function readUnindexedForeignKeys(client) {
  const result = await client.query(`
    with foreign_keys as (
      select
        constraint_row.oid,
        constraint_row.conrelid,
        constraint_row.confrelid,
        constraint_row.conkey,
        constraint_row.conname,
        namespace.nspname schema_name,
        child.relname table_name,
        parent.relname target_table
      from pg_constraint constraint_row
      join pg_namespace namespace on namespace.oid = constraint_row.connamespace
      join pg_class child on child.oid = constraint_row.conrelid
      join pg_class parent on parent.oid = constraint_row.confrelid
      where constraint_row.contype = 'f'
        and namespace.nspname = 'public'
    ),
    covered as (
      select distinct foreign_key.oid
      from foreign_keys foreign_key
      join pg_index index_row
        on index_row.indrelid = foreign_key.conrelid
       and index_row.indisvalid
       and index_row.indisready
       and (index_row.indkey::smallint[])[
         0:cardinality(foreign_key.conkey)-1
       ] = foreign_key.conkey
    )
    select
      foreign_key.table_name,
      foreign_key.conname constraint_name,
      foreign_key.target_table,
      array_agg(attribute.attname order by key_column.ordinality) columns
    from foreign_keys foreign_key
    join unnest(foreign_key.conkey) with ordinality key_column(attnum, ordinality)
      on true
    join pg_attribute attribute
      on attribute.attrelid = foreign_key.conrelid
     and attribute.attnum = key_column.attnum
    where foreign_key.oid not in (select oid from covered)
    group by foreign_key.oid, foreign_key.table_name,
      foreign_key.conname, foreign_key.target_table
    order by foreign_key.table_name, foreign_key.conname
  `);
  return result.rows;
}

function renderForeignKeyReport(allRows) {
  const normalizedRows = allRows.map((row) => ({
    ...row,
    columns: Array.isArray(row.columns)
      ? row.columns
      : String(row.columns).replace(/^\{|\}$/g, '').split(',').filter(Boolean),
  }));
  const inventory = normalizedRows.filter((row) => (
    row.table_name.startsWith('tournament_')
    || row.table_name === 'user_tournament_context_preferences'
  ));
  const manifestTables = new Set(buildCanonicalManifest().operations.map(
    (operation) => operation.table,
  ));
  manifestTables.add('tournament_groups');
  manifestTables.add('tournament_group_members');
  manifestTables.add('user_tournament_context_preferences');

  const classified = inventory.map((row) => ({
    ...row,
    classification: classificationFor(row.table_name, manifestTables),
  }));
  const counts = Object.fromEntries([
    'critical_qa',
    'short_term',
    'no_current_evidence',
  ].map((name) => [name, classified.filter((row) => row.classification === name).length]));
  const extraRoot = normalizedRows.filter((row) => row.table_name === 'tournaments');
  const labels = {
    critical_qa: 'Crítica para flujos QA',
    short_term: 'Probablemente necesaria a corto plazo',
    no_current_evidence: 'Sin evidencia de necesidad actual',
  };
  const lines = [
    '# Clasificación de foreign keys sin índice · Torneos',
    '',
    `Catálogo: Supabase local efímero, esquema canónico del branch. Inventario solicitado: **${inventory.length}** FKs (tablas \`tournament_*\` más \`user_tournament_context_preferences\`).`,
    '',
    `El advisor local actual reporta **${normalizedRows.length}** FKs sin índice en todo \`public\`. Además del inventario de 197, detecta ${extraRoot.length} FKs en la tabla raíz \`tournaments\` y ${normalizedRows.length - inventory.length - extraRoot.length} FKs ajenas al módulo. Esa deriva se informa; no se agrega ningún índice en esta etapa.`,
    '',
    '## Resumen',
    '',
    '| Clasificación | Cantidad | Criterio |',
    '| --- | ---: | --- |',
    `| Crítica para flujos QA | ${counts.critical_qa} | Tabla materializada/limpiada por el seed, grupos canónicos, o preferencia de contexto del workspace. |`,
    `| Probablemente necesaria a corto plazo | ${counts.short_term} | Comunicaciones, hub, convocatoria, scheduling, media publicada o configuración operativa ya expuesta por flujos/RPCs. |`,
    `| Sin evidencia de necesidad actual | ${counts.no_current_evidence} | Relación opcional/administrativa no recorrida por el dataset ni por las nueve lecturas auditadas. |`,
    `| **Total** | **${inventory.length}** | |`,
    '',
    '## Inventario clasificado',
    '',
    '| Clasificación | Tabla | Foreign key | Columnas | Referencia |',
    '| --- | --- | --- | --- | --- |',
    ...classified.map((row) => (
      `| ${labels[row.classification]} | \`${row.table_name}\` | `
      + `\`${row.constraint_name}\` | \`${row.columns.join(', ')}\` | `
      + `\`${row.target_table}\` |`
    )),
    '',
    '## Deriva fuera del inventario de 197',
    '',
    ...extraRoot.map((row) => (
      `- \`${row.table_name}.${row.constraint_name}\` `
      + `(\`${row.columns.join(', ')}\` → \`${row.target_table}\`): `
      + 'crítica para el flujo QA, pero no formaba parte del conjunto reportado de 197.'
    )),
    '',
    '## Recomendación',
    '',
    'No crear índices por conteo. Antes de una etapa específica de performance: capturar `EXPLAIN (ANALYZE, BUFFERS)` de fixture, partido, standings, roster y cleanup; priorizar las FKs críticas que participan en DELETE/UPDATE de padres o joins de las RPCs; estimar costo de escritura; y crear índices de a uno con pruebas de regresión.',
    '',
  ];
  return { markdown: lines.join('\n'), counts, inventoryCount: inventory.length };
}

async function main() {
  const target = assertLocalDatabaseTarget(process.env);
  const client = new pg.Client({ connectionString: target.databaseUrl });
  await client.connect();
  try {
    const rows = await readUnindexedForeignKeys(client);
    const report = renderForeignKeyReport(rows);
    if (report.inventoryCount !== 197) {
      throw new Error(`Expected the reported 197 Torneos FKs, found ${report.inventoryCount}.`);
    }
    if (process.argv.includes('--write')) {
      fs.writeFileSync(
        path.join(ROOT, 'docs', 'qa', 'torneos-foreign-key-classification.md'),
        report.markdown,
      );
    }
    console.log(JSON.stringify({
      mode: 'local-read-only-catalog-audit',
      totalUnindexedPublic: rows.length,
      inventory: report.inventoryCount,
      classification: report.counts,
      wroteReport: process.argv.includes('--write'),
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.message }, null, 2));
  process.exitCode = 1;
});
