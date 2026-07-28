#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dbContainer = `supabase_db_${path.basename(root)}`;

const statusResult = spawnSync('npx', ['supabase', 'status', '-o', 'env'], {
  cwd: root,
  encoding: 'utf8',
});
if (statusResult.status !== 0) {
  console.error(statusResult.stderr || statusResult.stdout);
  process.exit(1);
}

const localEnv = Object.fromEntries(
  statusResult.stdout
    .split('\n')
    .map((line) => line.match(/^([A-Z0-9_]+)="(.*)"$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2]]),
);

const apiUrl = localEnv.API_URL;
const anonKey = localEnv.ANON_KEY;
if (!apiUrl || !anonKey) throw new Error('Supabase local no expuso API_URL/ANON_KEY.');

let checks = 0;
let failures = 0;

const check = (condition, label, detail = '') => {
  checks += 1;
  if (condition) {
    console.log(`  ✔ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const equal = (actual, expected, label) => check(
  JSON.stringify(actual) === JSON.stringify(expected),
  label,
  `esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`,
);

const request = async (pathname, {
  method = 'GET',
  token = null,
  body,
  headers = {},
} = {}) => {
  const response = await fetch(`${apiUrl}${pathname}`, {
    method,
    headers: {
      apikey: anonKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }
  return { response, data };
};

const signUp = async (label) => {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const result = await request('/auth/v1/signup', {
    method: 'POST',
    body: {
      email: `golden-${label}-${nonce}@example.com`,
      password: 'Golden-contract-123!',
      data: { full_name: `Golden ${label}` },
    },
  });
  check(result.response.ok, `Auth real local registra ${label}`, JSON.stringify(result.data));
  check(Boolean(result.data?.access_token), `Registro de ${label} devuelve sesión`);
  return {
    id: result.data?.user?.id,
    token: result.data?.access_token,
    email: result.data?.user?.email,
  };
};

const rest = async (resource, options = {}) => request(`/rest/v1/${resource}`, options);
const rpc = async (name, body, token = null) => request(`/rest/v1/rpc/${name}`, {
  method: 'POST',
  token,
  body,
});

const sql = (query) => {
  const result = spawnSync('docker', [
    'exec',
    dbContainer,
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-At',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    query,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
};

async function main() {
  console.log('\nGolden contract — Supabase local canónico\n');

  const [admin, starter, substitute, outsider] = await Promise.all([
    signUp('admin'),
    signUp('starter'),
    signUp('substitute'),
    signUp('outsider'),
  ]);

  for (const user of [admin, starter, substitute, outsider]) {
    const profile = await rest(`usuarios?id=eq.${user.id}&select=id,nombre,email`, { token: user.token });
    check(profile.response.ok && profile.data?.length === 1, `Trigger Auth crea usuarios para ${user.email}`);
  }

  const createMatch = await rest('partidos?select=id,codigo,creado_por,nombre', {
    method: 'POST',
    token: admin.token,
    headers: { Prefer: 'return=representation' },
    body: {
      codigo: `GOLDEN${Date.now()}`,
      nombre: 'Golden contract match',
      fecha: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      hora: '20:00',
      sede: 'Cancha golden',
      modalidad: 'F5',
      cupo_jugadores: 2,
      creado_por: admin.id,
      admin_id: admin.id,
      estado: 'active',
    },
  });
  check(createMatch.response.ok && createMatch.data?.length === 1, 'Administrador crea partido por PostgREST', JSON.stringify(createMatch.data));
  const match = createMatch.data?.[0];

  const anonMatch = await rest(`partidos?id=eq.${match.id}&select=id,codigo,nombre`);
  check(anonMatch.response.ok && anonMatch.data?.length === 1, 'Link público conserva lectura anon del partido compartido');

  const anonWrite = await rest('partidos', {
    method: 'POST',
    body: { nombre: 'No autorizado' },
  });
  check(!anonWrite.response.ok, 'anon no puede escribir tablas directamente');

  const insertPlayers = await rest('jugadores?select=id,usuario_id,is_substitute,titular', {
    method: 'POST',
    token: admin.token,
    headers: { Prefer: 'return=representation' },
    body: [
      {
        partido_id: match.id,
        usuario_id: admin.id,
        nombre: 'Golden admin',
        score: 5,
        titular: true,
        is_substitute: false,
      },
      {
        partido_id: match.id,
        usuario_id: starter.id,
        nombre: 'Golden starter',
        score: 5,
        titular: true,
        is_substitute: false,
      },
      {
        partido_id: match.id,
        usuario_id: substitute.id,
        nombre: 'Golden substitute',
        score: 5,
        titular: false,
        is_substitute: true,
      },
    ],
  });
  check(insertPlayers.response.ok && insertPlayers.data?.length === 3, 'Admin invita titulares y suplente');
  const playerByUser = new Map((insertPlayers.data || []).map((row) => [row.usuario_id, row]));

  const anonRoster = await rest(`jugadores?partido_id=eq.${match.id}&select=id,nombre,is_substitute`);
  check(anonRoster.response.ok && anonRoster.data?.length === 3, 'Invitación/votación pública conserva roster visible');

  const outsiderUpdate = await rest(`partidos?id=eq.${match.id}&select=id,nombre`, {
    method: 'PATCH',
    token: outsider.token,
    headers: { Prefer: 'return=representation' },
    body: { nombre: 'Secuestro' },
  });
  equal(outsiderUpdate.data, [], 'RLS evita que un tercero edite el partido');

  const adminUpdate = await rest(`partidos?id=eq.${match.id}&select=id,nombre`, {
    method: 'PATCH',
    token: admin.token,
    headers: { Prefer: 'return=representation' },
    body: { nombre: 'Golden contract match editado' },
  });
  check(adminUpdate.response.ok && adminUpdate.data?.[0]?.nombre.endsWith('editado'), 'Administrador edita el partido');

  const openVoting = await rpc('send_call_to_vote', {
    p_partido_id: match.id,
    p_title: 'Golden voting',
    p_message: 'Golden voting is open',
  }, admin.token);
  check(openVoting.response.ok, 'Administrador abre la votación con el RPC canónico', JSON.stringify(openVoting.data));

  const starterVote = await rest('votos?select=id,partido_id,votante_id,votado_id,puntaje', {
    method: 'POST',
    token: starter.token,
    headers: { Prefer: 'return=representation' },
    body: {
      partido_id: match.id,
      votante_id: starter.id,
      votado_id: admin.id,
      puntaje: 5,
      jugador_nombre: 'Golden starter',
    },
  });
  check(starterVote.response.ok && starterVote.data?.length === 1, 'Titular puede votar', JSON.stringify(starterVote.data));

  const doubleVote = await rest('votos', {
    method: 'POST',
    token: starter.token,
    body: {
      partido_id: match.id,
      votante_id: starter.id,
      votado_id: admin.id,
      puntaje: 4,
    },
  });
  equal(doubleVote.data?.code, '23505', 'Doble click conserva idempotencia por unique');

  const substituteVote = await rest('votos', {
    method: 'POST',
    token: substitute.token,
    body: {
      partido_id: match.id,
      votante_id: substitute.id,
      votado_id: admin.id,
      puntaje: 5,
    },
  });
  equal(substituteVote.data?.code, '42501', 'Suplente no puede votar');

  const resolvePublic = await rpc('resolve_match_by_code', { p_codigo: match.codigo });
  check(resolvePublic.response.ok && Number(resolvePublic.data) === Number(match.id), 'RPC pública resuelve código compartido', JSON.stringify(resolvePublic.data));

  const invalidPublicVote = await rpc('public_submit_player_rating', {
    p_partido_id: match.id,
    p_codigo: 'CODIGO_INCORRECTO',
    p_votante_nombre: 'Invitado',
    p_votado_jugador_id: playerByUser.get(admin.id)?.id,
    p_puntaje: 5,
  });
  check(invalidPublicVote.response.ok && invalidPublicVote.data === 'invalid', 'Voto público rechaza código inválido con payload estable', JSON.stringify(invalidPublicVote.data));

  const notify = await rest('notifications', {
    method: 'POST',
    token: admin.token,
    headers: { Prefer: 'return=minimal' },
    body: {
      user_id: starter.id,
      partido_id: match.id,
      type: 'match_invite',
      title: 'Golden',
      message: 'Golden notification',
      data: { partido_id: match.id },
    },
  });
  check(!notify.response.ok, 'Stage B bloquea fanout directo entre usuarios', JSON.stringify(notify.data));

  const notifyRpc = await rpc('create_notification', {
    p_type: 'match_update',
    p_recipient_id: starter.id,
    p_context: { match_id: match.id },
  }, admin.token);
  check(notifyRpc.response.ok, 'Cliente publicado conserva fanout por RPC validada', JSON.stringify(notifyRpc.data));

  const ownNotifications = await rest('notifications?select=id,user_id,type', { token: starter.token });
  check(ownNotifications.data?.some((row) => row.user_id === starter.id), 'Destinatario ve su notificación', JSON.stringify(ownNotifications.data));
  const privateNotifications = await rest('notifications?select=id,user_id,type', { token: outsider.token });
  equal(privateNotifications.data, [], 'Tercero no ve notificaciones ajenas');

  const friendRequest = await rest('amigos?select=id,user_id,friend_id,status', {
    method: 'POST',
    token: starter.token,
    headers: { Prefer: 'return=representation' },
    body: { user_id: starter.id, friend_id: outsider.id, status: 'pending' },
  });
  check(friendRequest.response.ok && friendRequest.data?.[0]?.status === 'pending', 'Solicitud de amistad conserva estado pending');

  const acceptFriend = await rest(`amigos?id=eq.${friendRequest.data?.[0]?.id}&select=id,status`, {
    method: 'PATCH',
    token: outsider.token,
    headers: { Prefer: 'return=representation' },
    body: { status: 'accepted' },
  });
  check(acceptFriend.response.ok && acceptFriend.data?.[0]?.status === 'accepted', 'Destinatario acepta amistad');

  const upload = async (bucket, objectPath, token) => fetch(
    `${apiUrl}/storage/v1/object/${bucket}/${objectPath}`,
    {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'image/png',
        'x-upsert': 'true',
      },
      body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    },
  );

  const profileUpload = await upload('jugadores-fotos', `${starter.id}/golden.png`, starter.token);
  check(profileUpload.ok, 'Storage permite foto de perfil authenticated');
  const crestUpload = await upload('team-crests', `${admin.id}/golden.png`, admin.token);
  check(crestUpload.ok, 'Storage permite escudo en carpeta propia');
  const wrongCrestUpload = await upload('team-crests', `${admin.id}/forbidden.png`, outsider.token);
  check(!wrongCrestUpload.ok, 'Storage impide escribir escudo en carpeta ajena');

  const expired = await request('/rest/v1/usuarios?select=id', { token: 'expired.invalid.token' });
  check(expired.response.status === 401, 'Sesión expirada/inválida recibe 401');

  const contractText = fs.readFileSync(path.join(root, 'docs/database/arma2-functional-contract.md'), 'utf8');
  const rpcSection = contractText.split('## RPCs consumidas')[1]?.split('\n## ')[0] || '';
  const expectedRpcs = [...rpcSection.matchAll(/^- `([^`]+)`$/gm)].map((matchValue) => matchValue[1]);
  const databaseRpcs = new Set(sql(
    "select distinct proname from pg_proc where pronamespace = 'public'::regnamespace order by proname",
  ).split('\n').filter(Boolean));
  const intentionallyAbsentRpcs = new Set([
    // Build-time repair scripts only. Exposing arbitrary SQL is forbidden.
    'exec_sql',
    // The active awards path has an explicit client-side implementation and
    // treats this old remote-only RPC as optional.
    'compute_awards_for_match',
  ]);
  const missingRpcs = expectedRpcs.filter(
    (name) => !databaseRpcs.has(name) && !intentionallyAbsentRpcs.has(name),
  );
  check(missingRpcs.length === 0, 'Todas las RPCs estáticas del cliente existen', missingRpcs.join(', '));

  equal(sql(
    "select count(*) from pg_class relation join pg_namespace namespace on namespace.oid=relation.relnamespace where namespace.nspname='public' and relation.relkind in ('r','p') and not relation.relrowsecurity",
  ), '0', 'Todas las tablas public tienen RLS');

  equal(sql(
    `select count(*)
     from pg_proc procedure_row
     where procedure_row.pronamespace='public'::regnamespace
       and procedure_row.prosecdef
       and has_function_privilege('anon', procedure_row.oid, 'execute')
       and procedure_row.proname not in (
         'get_invite_landing','get_partido_by_invite','resolve_match_by_code',
         'validate_guest_match_invite','is_public_voting_open',
         'public_has_voter_already_voted','public_mark_voter_completed',
         'public_submit_no_lo_conozco','public_submit_player_rating',
         'get_published_tournament_documents','get_published_tournament_matches',
         'get_published_tournament_media','get_published_tournament_standings',
         'get_published_tournament_statistics','get_published_tournament_teams',
         'get_tournament_announcement','get_tournament_participant_hub',
         'get_tournament_participant_match'
       )`,
  ), '0', 'anon no ejecuta funciones SECURITY DEFINER internas');

  equal(sql(
    "select string_agg(id, ',' order by id) from storage.buckets",
  ), 'jugadores-fotos,team-crests', 'Storage crea sólo buckets activos; Multimedia Upload sigue apagado');

  equal(sql(
    "select string_agg(jobname, ',' order by jobname) from cron.job",
  ), [
    'auto_match_sweep',
    'challenge_result_survey_backend_fanout',
    'directed_challenge_expiry_scheduler',
    'match_reminder_1h_scheduler',
    'notifications_retention_cleanup_scheduler',
    'push_sender_dispatch_scheduler',
    'survey_reminder_backend_scheduler',
    'survey_start_backend_scheduler',
  ].join(','), 'Los ocho schedulers canónicos se recrean sin estado remoto');

  const migrationCount = fs.readdirSync(path.join(root, 'supabase/migrations'))
    .filter((name) => /^\d+_.+\.sql$/.test(name)).length;
  equal(migrationCount, 2, 'Ruta activa contiene baseline + contratos RLS, no historial incompleto');

  console.log(`\nResultado: ${checks - failures}/${checks} checks pasaron.\n`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
