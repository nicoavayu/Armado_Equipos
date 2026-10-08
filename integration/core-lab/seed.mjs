// Core lab QA fixture. LOCAL ONLY: refuses any API that is not the lab loopback origin.
// Accounts are created through GoTrue's admin API; domain data goes through the same
// paths the web app uses (each user's own session + RLS) wherever the app does so, and
// through the service role only where the app relies on a backend (e.g. the join of
// other players). Lab-only passwords live in .runtime/qa-users.json (0600, ignored):
// people sign in with the magic link that lands in the local Mailpit.
import { writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { API, root, config } from './lab.mjs';

if (new URL(API).hostname !== '127.0.0.1') throw new Error('seed refuses non-loopback targets');

export const QA_DOMAIN = 'arma2.lab';
export const PEOPLE = [
  { key: 'organizador', nombre: 'Lucía Organizadora', posicion: 'MED', localidad: 'Palermo' },
  { key: 'jugador1', nombre: 'Martín Gómez', posicion: 'DEL', localidad: 'Palermo' },
  { key: 'jugador2', nombre: 'Sofía Ruiz', posicion: 'DEF', localidad: 'Colegiales' },
  { key: 'jugador3', nombre: 'Diego Sosa', posicion: 'ARQ', localidad: 'Belgrano' },
  { key: 'jugador4', nombre: 'Valentina Paz', posicion: 'MED', localidad: 'Núñez' },
  { key: 'jugador5', nombre: 'Joaquín Ferro', posicion: 'DEL', localidad: 'Villa Crespo' },
  { key: 'jugador6', nombre: 'Carolina Díaz', posicion: 'DEF', localidad: 'Almagro' },
  { key: 'jugador7', nombre: 'Nahuel Ibarra', posicion: 'MED', localidad: 'Caballito' },
  { key: 'jugador8', nombre: 'Patricio Luna', posicion: 'DEF', localidad: 'Palermo' },
  { key: 'jugador9', nombre: 'Emilia Soto', posicion: 'DEL', localidad: 'Chacarita' },
  { key: 'nuevo', nombre: null, posicion: null, localidad: null },
  { key: 'ajeno', nombre: 'Ramiro Ajeno', posicion: 'MED', localidad: 'Quilmes' },
];
export const emailOf = (key) => `${key}@${QA_DOMAIN}`;

const day = (offset) => {
  const d = new Date(Date.now() + offset * 86400000);
  return d.toISOString().slice(0, 10);
};
// Match times are Buenos Aires wall-clock (the survey scheduler reads them that way).
const buenosAiresSlot = (hoursFromNow) => {
  const local = new Date(Date.now() + hoursFromNow * 3600000 - 3 * 3600000);
  const minutes = local.getUTCMinutes() < 30 ? '00' : '30';
  return { fecha: local.toISOString().slice(0, 10), hora: `${String(local.getUTCHours()).padStart(2, '0')}:${minutes}` };
};

async function adminFetch(c, path, init = {}) {
  const r = await fetch(`${API}${path}`, { ...init, headers: { apikey: c.serviceRoleKey,
    authorization: `Bearer ${c.serviceRoleKey}`, 'content-type': 'application/json', ...(init.headers || {}) } });
  const text = await r.text();
  const body = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${path} → ${r.status} ${body?.msg || body?.message || ''}`);
  return body;
}

export async function signIn(c, key, passwords) {
  const client = createClient(API, c.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email: emailOf(key), password: passwords[key] });
  if (error) throw new Error(`sign-in ${key}: ${error.message}`);
  return { client, user: data.user, session: data.session };
}

const must = (label) => ({ data, error }) => {
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
};

export async function seed() {
  const c = await config();
  const admin = createClient(API, c.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const existing = await adminFetch(c, '/auth/v1/admin/users?per_page=200');
  if ((existing.users || []).some((u) => u.email === emailOf('organizador'))) {
    console.log('QA fixture already present (destroy the lab to rebuild it).');
    return;
  }
  const passwords = {};
  const ids = {};
  for (const person of PEOPLE) {
    passwords[person.key] = randomBytes(18).toString('base64url');
    const created = await adminFetch(c, '/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({
      email: emailOf(person.key), password: passwords[person.key], email_confirm: true,
      user_metadata: person.nombre ? { full_name: person.nombre } : {},
    }) });
    ids[person.key] = created.id;
  }
  await writeFile(`${root}.runtime/qa-users.json`, JSON.stringify({ ids, passwords }), { mode: 0o600 });

  const s = {};
  for (const person of PEOPLE) s[person.key] = await signIn(c, person.key, passwords);

  // Profiles: each user completes their own (the onboarding path).
  for (const person of PEOPLE.filter((p) => p.nombre)) {
    await s[person.key].client.from('usuarios').update({
      nombre: person.nombre, posicion: person.posicion, localidad: person.localidad,
      posiciones: [person.posicion], acepta_invitaciones: true, pais_codigo: 'AR', nacionalidad: 'argentina',
      perfil_completo: true, profile_completion: 90, ranking: 5,
    }).eq('id', ids[person.key]).then(must(`profile ${person.key}`));
  }

  // Matches created by the organizer through the app path (insert as the user, RLS applies).
  const org = s.organizador;
  const createMatch = (client, owner, fields) => client.from('partidos').insert({
    creado_por: owner, admin_id: owner, modalidad: 'F5', tipo_partido: 'Masculino', estado: 'activo',
    falta_jugadores: true, cupo_jugadores: 10, precio_cancha_por_persona: 6000,
    sede: 'Complejo La Cancha, Av. Dorrego 1500, Palermo', player_invites_enabled: true,
    codigo: randomBytes(4).toString('hex').toUpperCase(), ...fields,
  }).select().single().then(must(`match ${fields.nombre}`));
  const jueves = await createMatch(org.client, ids.organizador, { nombre: 'Fútbol del jueves', fecha: day(3), hora: '21:00' });
  const sabado = await createMatch(org.client, ids.organizador, { nombre: 'Sábado en Palermo', fecha: day(1), hora: '18:00', falta_jugadores: false });
  // Played three hours ago and still 'activo' (results come after the survey closes): the
  // scheduler opens its post-match survey for the next ~21 hours.
  const pasado = await createMatch(org.client, ids.organizador, { nombre: 'Picadito de anoche', ...buenosAiresSlot(-3), falta_jugadores: false });
  const ajeno = await createMatch(s.ajeno.client, ids.ajeno, { nombre: 'Partido privado de Ramiro', fecha: day(2), hora: '22:00' });

  // Rosters: the organizer joins their own matches like the app does; other players' joins
  // happen in the backend (invite acceptance), so the fixture inserts them with the service role.
  const roster = async (match, keys) => {
    const rows = keys.map((key) => ({ partido_id: match.id, usuario_id: ids[key], nombre: PEOPLE.find((p) => p.key === key).nombre,
      posicion: PEOPLE.find((p) => p.key === key).posicion, score: 5 }));
    await admin.from('jugadores').insert(rows).then(must(`roster ${match.nombre}`));
  };
  await roster(jueves, ['organizador', 'jugador1', 'jugador2', 'jugador3', 'jugador4', 'jugador5', 'jugador6']);
  await roster(sabado, ['organizador', 'jugador1', 'jugador2', 'jugador3', 'jugador4', 'jugador5', 'jugador6', 'jugador7', 'jugador8', 'jugador9']);
  await roster(pasado, ['organizador', 'jugador1', 'jugador2', 'jugador3', 'jugador4', 'jugador5', 'jugador6', 'jugador7', 'jugador8', 'jugador9']);
  await roster(ajeno, ['ajeno']);

  // Friendships through the app path (request as the sender, accept as the recipient).
  for (const key of ['jugador1', 'jugador2', 'jugador3', 'jugador4', 'jugador5']) {
    const req = await org.client.from('amigos').insert({ user_id: ids.organizador, friend_id: ids[key], status: 'pending' })
      .select().single().then(must(`friend ${key}`));
    await s[key].client.from('amigos').update({ status: 'accepted' }).eq('id', req.id).then(must(`accept ${key}`));
  }
  await s.jugador7.client.from('amigos').insert({ user_id: ids.jugador7, friend_id: ids.organizador, status: 'pending' }).then(must('pending friend'));

  // Invitations through the real RPC (it writes the notification the recipient sees).
  for (const key of ['jugador7', 'jugador8']) {
    await org.client.rpc('send_match_invite', { p_user_id: ids[key], p_partido_id: Number(jueves.id),
      p_title: 'Invitación a partido', p_message: `Lucía Organizadora te invitó a jugar el ${jueves.fecha} a las 21:00`,
      p_invite_mode: 'direct' }).then(must(`invite ${key}`));
  }

  // A team owned by the organizer, created through the app path.
  const team = await org.client.from('teams').insert({ owner_user_id: ids.organizador, name: 'Los Pibes FC', format: 5,
    base_zone: 'Palermo', skill_level: 'intermedio', color_primary: '#ec007d', is_active: true, mode: 'Masculino', country_code: 'AR' })
    .select().single().then(must('team'));
  // Like ensureRosterCandidateByUserId(): the roster points at the user's latest `jugadores`
  // row, which today is always a match row (jugadores.partido_id is NOT NULL).
  for (const [key, captain] of [['organizador', true], ['jugador1', false], ['jugador2', false], ['jugador3', false]]) {
    const [player] = await admin.from('jugadores').select('id').eq('usuario_id', ids[key]).order('id', { ascending: false })
      .limit(1).then(must(`team player ${key}`));
    await admin.from('team_members').insert({ team_id: team.id, jugador_id: player.id, user_id: ids[key], is_captain: captain,
      role: 'player', permissions_role: key === 'organizador' ? 'owner' : 'member' }).then(must(`member ${key}`));
  }
  await org.client.rpc('rpc_send_team_invitation', { p_team_id: team.id, p_invited_user_id: ids.jugador4 })
    .then(({ error }) => { if (error) console.warn(`team invitation skipped: ${error.message}`); });

  await notifyLikeTheBackend(c);
  console.log(`QA fixture ready: ${PEOPLE.length} accounts (@${QA_DOMAIN}), matches ${[jueves, sabado, pasado, ajeno].map((m) => m.id).join(', ')}, team ${team.id}`);
}

// Notifications the backend would have produced by now. Friend requests already notify
// through the amigos trigger; the post-match survey is the scheduler's job.
export async function notifyLikeTheBackend(c) {
  const admin = createClient(API, c.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await admin.rpc('process_survey_start_notifications_backend', { p_delay_minutes: 60, p_limit: 50 })
    .then(must('survey start notifications'));
}
