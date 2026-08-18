#!/usr/bin/env node

import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import sharp from 'sharp';

import { buildTorneosDemoDataset, stableUuid } from '../qa/torneos-demo-dataset.mjs';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const BUCKET = 'tournament-branding';
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:57321';
const DATABASE_URL = process.env.SUPABASE_DB_URL
  || 'postgresql://postgres:postgres@127.0.0.1:57322/postgres';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function assertLoopback(rawUrl, protocols) {
  const parsed = new URL(rawUrl);
  if (!protocols.includes(parsed.protocol) || !LOOPBACK.has(parsed.hostname)) {
    throw new Error('Branding QA provisioning only accepts an explicit loopback backend.');
  }
  return rawUrl;
}

const escapeXml = (value) => String(value).replace(/[<>&"']/g, (character) => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
}[character]));

async function makeAsset({ label, subtitle, start, end, width = 900, height = 620 }) {
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${start}"/><stop offset="1" stop-color="${end}"/></linearGradient></defs>
      <rect width="${width}" height="${height}" rx="84" fill="url(#g)"/>
      <path d="M90 ${height - 120} L${width - 90} 90" stroke="rgba(255,255,255,.18)" stroke-width="38"/>
      <text x="50%" y="48%" text-anchor="middle" dominant-baseline="middle" fill="white" font-family="Arial, sans-serif" font-size="112" font-weight="800">${escapeXml(label)}</text>
      <text x="50%" y="68%" text-anchor="middle" dominant-baseline="middle" fill="rgba(255,255,255,.78)" font-family="Arial, sans-serif" font-size="34" font-weight="600" letter-spacing="8">${escapeXml(subtitle)}</text>
    </svg>`;
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

function qaTargets() {
  const dataset = buildTorneosDemoDataset();
  const tournament = dataset.tournaments.find((item) => item.isPrimaryDataset);
  const team = dataset.teams[0];
  const organizationPath = `${dataset.organization.id}/organizations/${dataset.organization.id}/${stableUuid('branding:qa:organization')}.png`;
  const tournamentPath = `${dataset.organization.id}/tournaments/${tournament.id}/${stableUuid('branding:qa:tournament')}.png`;
  const teamPath = `${dataset.organization.id}/teams/${team.id}/${stableUuid('branding:qa:team')}.png`;
  return { dataset, tournament, team, organizationPath, tournamentPath, teamPath };
}

async function verifyDatabase(client, targets) {
  const { rows } = await client.query(
    `select
      (select logo_path from public.tournament_organizations where id = $1) as organization_path,
      (select logo_path from public.tournaments where id = $2) as tournament_path,
      (select shield_path from public.tournament_team_entries where id = $3) as team_path,
      (select count(*)::integer from public.tournament_competition_participants
        where team_entry_id = $3 and snapshot_shield_path = $6) as snapshot_count,
      (select count(*)::integer from public.tournament_team_entries
        where organization_id = $1 and shield_path like 'qa/shields/%.svg') as legacy_team_refs,
      (select count(*)::integer from public.tournament_competition_participants
        where organization_id = $1 and snapshot_shield_path like 'qa/shields/%.svg') as legacy_snapshot_refs,
      (select public.is_tournament_branding_path($4, 'organizations')) as organization_valid,
      (select public.is_tournament_branding_path($5, 'tournaments')) as tournament_valid,
      (select public.is_tournament_branding_path($6, 'teams')) as team_valid`,
    [
      targets.dataset.organization.id,
      targets.tournament.id,
      targets.team.id,
      targets.organizationPath,
      targets.tournamentPath,
      targets.teamPath,
    ],
  );
  const row = rows[0] || {};
  if (
    row.organization_path !== targets.organizationPath
    || row.tournament_path !== targets.tournamentPath
    || row.team_path !== targets.teamPath
    || row.snapshot_count < 1
    || !row.organization_valid
    || !row.tournament_valid
    || !row.team_valid
    || row.legacy_team_refs !== 0
    || row.legacy_snapshot_refs !== 0
  ) throw new Error('QA branding database references are incomplete.');
  return row.snapshot_count;
}

async function verifyPublicObjects(storage, targets) {
  const paths = [targets.organizationPath, targets.tournamentPath, targets.teamPath];
  for (const path of paths) {
    const { data } = storage.from(BUCKET).getPublicUrl(path);
    const response = await fetch(data.publicUrl);
    if (!response.ok || response.headers.get('content-type') !== 'image/png') {
      throw new Error(`QA branding object did not resolve: ${response.status}`);
    }
  }
}

async function run() {
  const verifyOnly = process.argv.includes('--verify');
  assertLoopback(SUPABASE_URL, ['http:', 'https:']);
  assertLoopback(DATABASE_URL, ['postgres:', 'postgresql:']);
  if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required in memory.');

  const targets = qaTargets();
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  try {
    if (!verifyOnly) {
      const assets = [
        [targets.organizationPath, await makeAsset({ label: 'LM', subtitle: 'LIGA METROPOLITANA', start: '#5028a9', end: '#158ec3' })],
        [targets.tournamentPath, await makeAsset({ label: 'A26', subtitle: 'APERTURA 2026', start: '#7027b8', end: '#ef6f4f' })],
        [targets.teamPath, await makeAsset({ label: targets.team.shortName, subtitle: targets.team.name.toUpperCase(), start: '#153d8a', end: '#55b7e7', width: 620, height: 720 })],
      ];
      for (const [path, bytes] of assets) {
        // This service-role path is confined to deterministic LOCAL QA
        // fixtures. Browser writes use authenticated RLS and never this key.
        const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
          contentType: 'image/png',
          cacheControl: '31536000',
          upsert: true,
        });
        if (error) throw error;
      }

      await client.query('BEGIN');
      try {
        await client.query(
          'update public.tournament_organizations set logo_path = $2 where id = $1',
          [targets.dataset.organization.id, targets.organizationPath],
        );
        await client.query(
          'update public.tournaments set logo_path = $2 where id = $1',
          [targets.tournament.id, targets.tournamentPath],
        );
        await client.query(
          'update public.tournament_team_entries set shield_path = $2 where id = $1',
          [targets.team.id, targets.teamPath],
        );
        await client.query(
          `update public.tournament_competition_participants
           set snapshot_shield_path = $2 where team_entry_id = $1`,
          [targets.team.id, targets.teamPath],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    const snapshotCount = await verifyDatabase(client, targets);
    await verifyPublicObjects(supabase.storage, targets);
    process.stdout.write(`${JSON.stringify({
      mode: verifyOnly ? 'verify' : 'apply',
      target: 'loopback-only',
      bucket: BUCKET,
      verified: true,
      qaAssets: {
        organization: targets.dataset.organization.name,
        tournament: targets.tournament.name,
        team: targets.team.name,
        frozenSnapshotsUpdated: snapshotCount,
      },
    }, null, 2)}\n`);
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(`[tournament-branding] ${error.message}`);
  process.exitCode = 1;
});
