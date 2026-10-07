#!/usr/bin/env node
// MEDIA-V1 lab driver — LOCAL ONLY. Runs the gallery beside an existing Torneos+Core lab (default: the promotion
// rehearsal `arma2-promo-rehearsal`) without touching that lab's own gateway, bridge or app:
//
//   apply     apply 00000000000012 to the lab's torneos-db (refuses if 0011 is not there; idempotent re-run is refused
//             by the migration's own preconditions only where they apply — the policies are drop-if-exists)
//   mode M    set the lab pipeline mode (MVP_SIMPLE | PROCESSOR_EXTERNAL | DISABLED) and print the readiness
//   up        start `arma2-media-lab-storage` (storage-api on the lab DB and the lab storage volume, 4 MiB objects,
//             loopback 58445) and `arma2-media-lab-gateway` (the Node lab gateway from THIS worktree with
//             CONNECTED + BRANDING + MEDIA on, loopback 58440)
//   down      remove only those two containers
//   rollback  apply the documented rollback SQL to the lab torneos-db
//   status    containers, migration state, pipeline mode, readiness (no secrets)
//
// Every target is loopback or the lab's internal network; the lab's secrets are read from its .runtime and never
// printed. Then: B04_LAB_APP_PORT=3110 B04_LAB_GATEWAY_ORIGIN=http://127.0.0.1:58440 B04_LAB_BRIDGE_CORE_PORT=58446 \
//   B04_LAB_BRIDGE_GATEWAY_PORT=58447 node scripts/torneos-frontend/start-hybrid-lab-app.mjs --start --connected --branding --media
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const DOCKER = '/Applications/Docker.app/Contents/Resources/bin/docker';
const PROJECT = process.env.MEDIA_LAB_PROJECT || 'arma2-promo-rehearsal';
const REHEARSAL = process.env.MEDIA_LAB_REHEARSAL;
if (!/^arma2-[a-z0-9-]+$/.test(PROJECT)) throw new Error('MEDIA_LAB_PROJECT must be a local arma2-* compose project');
if (!REHEARSAL || !fs.existsSync(path.join(REHEARSAL, 'integration/torneos-core-contracts/.runtime/server/config.json'))) {
  throw new Error('MEDIA_LAB_REHEARSAL must point at the lab checkout that owns integration/torneos-core-contracts/.runtime');
}
const LAB = path.join(REHEARSAL, 'integration/torneos-core-contracts');
const RUNTIME = path.join(LAB, '.runtime');
const STORAGE = 'arma2-media-lab-storage';
const GATEWAY = 'arma2-media-lab-gateway';
const NET_ISOLATED = `${PROJECT}_isolated`;
const NET_INGRESS = `${PROJECT}_loopback-ingress`;
const STORAGE_VOLUME = `${PROJECT}_torneos-storage-data`;
const MIGRATION = path.join(ROOT, 'backend/torneos/supabase/migrations/00000000000012_media_gallery_v1.sql');
const ROLLBACK = path.join(ROOT, 'backend/torneos/media-v1/rollback/00000000000012_media_gallery_v1.rollback.sql');

function docker(args, { input, allowFail = false } = {}) {
  const r = spawnSync(DOCKER, args, { input, encoding: 'utf8' });
  if (r.status !== 0 && !allowFail) {
    // Never echo the command (it may carry paths of secret files); only the error lines.
    throw new Error(`docker ${args[0]} failed: ${(r.stderr || '').split('\n').filter((l) => /error|ERROR/.test(l)).slice(0, 4).join(' | ')}`);
  }
  return r;
}
const torneosSql = (sql) => docker(['exec', '-i', `${PROJECT}-torneos-db-1`, 'psql', '-U', 'supabase_admin', '-d', 'postgres',
  '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'], { input: sql }).stdout.trim();

function status() {
  const ps = docker(['ps', '-a', '--filter', 'name=arma2-media-lab-', '--format', '{{.Names}} {{.Status}} {{.Ports}}'], { allowFail: true }).stdout.trim();
  console.log(ps || '(no media lab containers)');
  console.log(torneosSql(`select json_build_object(
    'has_0011', to_regprocedure('public.search_tournament_players(uuid,uuid,text,integer,uuid)') is not null,
    'has_0012', to_regprocedure('public.begin_tournament_media_gallery_upload(uuid,uuid,text,bigint)') is not null,
    'mode', (select mode from public.tournament_media_pipeline_configuration where singleton),
    'readiness', public.tournament_media_effective_readiness() - 'storage',
    'media_objects', (select count(*) from storage.objects where bucket_id = 'tournament-media'))`));
}

const command = process.argv[2];
if (command === 'status') {
  status();
} else if (command === 'apply' || command === 'rollback') {
  const file = command === 'apply' ? MIGRATION : ROLLBACK;
  torneosSql(fs.readFileSync(file, 'utf8'));
  console.log(`${command}: ${path.basename(file)} applied to ${PROJECT}-torneos-db-1`);
  status();
} else if (command === 'mode') {
  const mode = process.argv[3];
  if (!['MVP_SIMPLE', 'PROCESSOR_EXTERNAL', 'DISABLED'].includes(mode)) throw new Error('mode: MVP_SIMPLE | PROCESSOR_EXTERNAL | DISABLED');
  torneosSql(`update public.tournament_media_pipeline_configuration set mode = '${mode}', updated_at = now() where singleton;`);
  status();
} else if (command === 'up') {
  docker(['rm', '-f', STORAGE, GATEWAY], { allowFail: true });
  // Storage: the same image, env file, DB and volume as the lab's own torneos-storage; only the object ceiling differs.
  docker(['run', '-d', '--name', STORAGE, '--network', NET_INGRESS, '-p', '127.0.0.1:58445:5000',
    '--env-file', path.join(RUNTIME, 'torneos-storage.env'),
    '-e', 'STORAGE_BACKEND=file', '-e', 'FILE_STORAGE_BACKEND_PATH=/var/lib/storage', '-e', 'FILE_SIZE_LIMIT=4194304',
    '-e', 'UPLOAD_FILE_SIZE_LIMIT=4194304', '-e', 'TENANT_ID=torneos-lab', '-e', 'REGION=local', '-e', 'GLOBAL_S3_BUCKET=torneos-lab',
    '-e', 'ENABLE_IMAGE_TRANSFORMATION=false', '-e', 'DB_MIGRATIONS_FREEZE_AT=',
    '-v', `${STORAGE_VOLUME}:/var/lib/storage`, 'public.ecr.aws/supabase/storage-api:v1.67.15']);
  docker(['network', 'connect', NET_ISOLATED, STORAGE]);
  const storageIp = docker(['inspect', '-f', `{{(index .NetworkSettings.Networks "${NET_ISOLATED}").IPAddress}}`, STORAGE]).stdout.trim();
  if (!/^[0-9.]+$/.test(storageIp)) throw new Error('media lab storage has no address on the lab network');
  const fn = path.join(ROOT, 'backend/torneos/supabase/functions/torneos-gateway');
  const mount = (from, to) => ['-v', `${from}:${to}:ro`];
  const realModules = fs.realpathSync(path.join(LAB, 'node_modules'));
  docker(['run', '-d', '--name', GATEWAY, '--network', NET_INGRESS, '-p', '127.0.0.1:58440:58420', '-w', '/lab',
    // `torneos-storage` on THIS container is the media lab storage (4 MiB objects); the lab's own stays untouched.
    '--add-host', `torneos-storage:${storageIp}`,
    '-e', 'TORNEOS_CONNECTED_MODE=on', '-e', 'TORNEOS_BRANDING_MODE=on', '-e', 'TORNEOS_MEDIA_MODE=on',
    '-e', 'TORNEOS_STORAGE_URL=http://torneos-storage:5000', '-e', 'TORNEOS_STORAGE_PUBLIC_URL=http://127.0.0.1:58445',
    '-e', 'PHASE3A_GATEWAY_PUBLIC_ORIGIN=http://127.0.0.1:58440',
    ...mount(path.join(ROOT, 'integration/torneos-core-contracts/gateway.mjs'), '/lab/gateway.mjs'),
    ...mount(path.join(ROOT, 'integration/torneos-core-contracts/adapter.mjs'), '/lab/adapter.mjs'),
    ...mount(path.join(ROOT, 'integration/torneos-core-contracts/core-client.mjs'), '/lab/core-client.mjs'),
    ...mount(path.join(ROOT, 'integration/torneos-sso/token.mjs'), '/lab/token.mjs'),
    ...mount(path.join(ROOT, 'backend/torneos/phase2a/schemas.json'), '/lab/schemas.json'),
    ...mount(path.join(fn, 'my-teams.schema.json'), '/lab/my-teams.schema.json'),
    ...mount(path.join(ROOT, 'backend/torneos/phase2d/staging-v1-rpc-allowlist.json'), '/lab/staging-v1-rpc-allowlist.json'),
    ...['competition.ts', 'competition-v1-rpc-allowlist.json', 'officialization-v1-rpc-allowlist.json', 'connected.ts',
      'connected-v1-rpc-allowlist.json', 'branding.ts', 'branding-v1-rpc-allowlist.json', 'media.ts', 'media-image.ts',
      'media-contract.ts', 'media-v1-rpc-allowlist.json'].flatMap((f) => mount(path.join(fn, f), `/lab/functions/torneos-gateway/${f}`)),
    ...mount(realModules, '/lab/node_modules'),
    ...mount(path.join(RUNTIME, 'server'), '/lab/.runtime/server'),
    'node:22.22.0-bookworm-slim', 'node', 'gateway.mjs']);
  docker(['network', 'connect', NET_ISOLATED, GATEWAY]);
  console.log('media lab up: gateway http://127.0.0.1:58440 · storage http://127.0.0.1:58445');
} else if (command === 'down') {
  docker(['rm', '-f', STORAGE, GATEWAY], { allowFail: true });
  console.log('media lab containers removed (the lab itself is untouched)');
} else {
  console.error('usage: media-lab.mjs status | apply | mode <MODE> | up | down | rollback');
  process.exit(2);
}
