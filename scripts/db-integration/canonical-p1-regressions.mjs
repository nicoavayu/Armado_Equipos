#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import process from 'node:process';

import pg from 'pg';

const statusResult = spawnSync('npx', ['supabase', 'status', '-o', 'env'], {
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

if (!localEnv.DB_URL || !localEnv.API_URL || !localEnv.ANON_KEY) {
  throw new Error('Supabase local no expuso DB_URL/API_URL/ANON_KEY.');
}

const clients = [];
let checks = 0;
let failures = 0;

const check = (condition, label, detail = '') => {
  checks += 1;
  if (condition) {
    console.log(`  ✔ ${label}`);
    return;
  }
  failures += 1;
  console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
};

const equal = (actual, expected, label) => check(
  JSON.stringify(actual) === JSON.stringify(expected),
  label,
  `esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`,
);

async function connect(role = null) {
  const client = new pg.Client({ connectionString: localEnv.DB_URL });
  await client.connect();
  clients.push(client);
  if (role) await client.query(`set role ${role}`);
  return client;
}

const one = async (client, text, params = []) => (
  (await client.query(text, params)).rows[0] || null
);

const value = async (client, text, params = []) => {
  const row = await one(client, text, params);
  return row ? Object.values(row)[0] : null;
};

const count = async (client, text, params = []) => Number(
  await value(client, text, params),
);

const runTokenPrefix = randomBytes(14).toString('hex');
const runUuidPrefix = randomBytes(4).toString('hex');
const token = (suffix) => `${runTokenPrefix}${String(suffix).padStart(4, '0')}`;
const guestUuid = (suffix) => (
  `${runUuidPrefix}-0000-4000-8000-${String(suffix).padStart(12, '0')}`
);

async function createMatch(admin, {
  code,
  capacity,
  creatorId = null,
}) {
  return value(
    admin,
    `insert into public.partidos (
       codigo, nombre, fecha, hora, sede, modalidad, cupo_jugadores,
       creado_por, admin_id, estado
     )
     values ($1, $2, current_date + 1, '20:00', 'Cancha P1', 'F5', $3, $4, $4, 'active')
     returning id`,
    [code, `Contrato ${code}`, capacity, creatorId],
  );
}

async function createInvite(admin, {
  matchId,
  inviteToken,
  creatorId = null,
  expired = false,
  maxUses = 20,
}) {
  await admin.query(
    `insert into public.guest_match_invites (
       partido_id, token, created_by, expires_at, max_uses, uses_count
     )
     values ($1, $2, $3, now() + $4::interval, $5, 0)`,
    [
      matchId,
      inviteToken,
      creatorId,
      expired ? '-1 minute' : '1 day',
      maxUses,
    ],
  );
}

async function joinGuest(client, {
  matchId,
  inviteToken,
  uuid,
  name,
  avatarUrl = null,
}) {
  return one(
    client,
    `select *
     from public.join_guest_match_with_invite($1, $2, $3::uuid, $4, $5)`,
    [matchId, inviteToken, uuid, name, avatarUrl],
  );
}

async function joinGuestThroughEdge({
  matchId,
  code,
  inviteToken,
  uuid,
  name,
}) {
  const response = await fetch(`${localEnv.API_URL}/functions/v1/join-match-guest`, {
    method: 'POST',
    headers: {
      apikey: localEnv.ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      partido_id: Number(matchId),
      codigo: code,
      invite: inviteToken,
      nombre: name,
      guest_uuid: uuid,
    }),
  });
  const data = await response.json();
  return { response, data };
}

async function main() {
  console.log('\nRegresiones P1 — baseline canónica local\n');

  const admin = await connect();
  const service = await connect('service_role');
  const serviceRace = await connect('service_role');
  const anonymous = await connect('anon');

  equal(
    await admin.query(
      `select
         column_name,
         data_type,
         is_nullable,
         column_default
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'jugadores'
         and column_name = 'substitute_order'`,
    ).then(({ rows }) => rows),
    [{
      column_name: 'substitute_order',
      data_type: 'smallint',
      is_nullable: 'YES',
      column_default: null,
    }],
    'substitute_order restaura tipo smallint, nullable y sin default',
  );
  equal(
    await value(
      admin,
      `select pg_get_indexdef(index_row.indexrelid)
       from pg_index index_row
       join pg_class relation on relation.oid = index_row.indexrelid
       where relation.relname = 'jugadores_partido_substitute_idx'`,
    ),
    'CREATE INDEX jugadores_partido_substitute_idx ON public.jugadores USING btree (partido_id, is_substitute, substitute_order, created_at)',
    'la cola de suplentes conserva su índice histórico',
  );
  equal(
    await admin.query(
      `select code, name, team_size, recommended_substitutes,
              team_of_round_size, suggested_duration_minutes, requires_goalkeeper
       from public.tournament_sport_modalities
       order by team_size`,
    ).then(({ rows }) => rows),
    [
      {
        code: 'football_5',
        name: 'Fútbol 5',
        team_size: 5,
        recommended_substitutes: 3,
        team_of_round_size: 5,
        suggested_duration_minutes: 40,
        requires_goalkeeper: true,
      },
      {
        code: 'football_6',
        name: 'Fútbol 6',
        team_size: 6,
        recommended_substitutes: 4,
        team_of_round_size: 6,
        suggested_duration_minutes: 50,
        requires_goalkeeper: true,
      },
      {
        code: 'football_7',
        name: 'Fútbol 7',
        team_size: 7,
        recommended_substitutes: 5,
        team_of_round_size: 7,
        suggested_duration_minutes: 50,
        requires_goalkeeper: true,
      },
      {
        code: 'football_8',
        name: 'Fútbol 8',
        team_size: 8,
        recommended_substitutes: 5,
        team_of_round_size: 8,
        suggested_duration_minutes: 60,
        requires_goalkeeper: true,
      },
      {
        code: 'football_9',
        name: 'Fútbol 9',
        team_size: 9,
        recommended_substitutes: 6,
        team_of_round_size: 9,
        suggested_duration_minutes: 70,
        requires_goalkeeper: true,
      },
      {
        code: 'football_11',
        name: 'Fútbol 11',
        team_size: 11,
        recommended_substitutes: 7,
        team_of_round_size: 11,
        suggested_duration_minutes: 90,
        requires_goalkeeper: true,
      },
    ],
    'baseline fresca contiene las seis modalidades históricas exactas',
  );

  await admin.query(
    `insert into public.tournament_sport_modalities (
       code, name, team_size, recommended_substitutes, team_of_round_size,
       suggested_duration_minutes, requires_goalkeeper
     )
     values
       ('football_5', 'Fútbol 5', 5, 3, 5, 40, true),
       ('football_6', 'Fútbol 6', 6, 4, 6, 50, true),
       ('football_7', 'Fútbol 7', 7, 5, 7, 50, true),
       ('football_8', 'Fútbol 8', 8, 5, 8, 60, true),
       ('football_9', 'Fútbol 9', 9, 6, 9, 70, true),
       ('football_11', 'Fútbol 11', 11, 7, 11, 90, true)
     on conflict (code) do update
     set
       name = excluded.name,
       team_size = excluded.team_size,
       recommended_substitutes = excluded.recommended_substitutes,
       team_of_round_size = excluded.team_of_round_size,
       suggested_duration_minutes = excluded.suggested_duration_minutes,
       requires_goalkeeper = excluded.requires_goalkeeper`,
  );
  equal(
    await count(admin, 'select count(*) from public.tournament_sport_modalities'),
    6,
    'repetir el seed no duplica modalidades',
  );

  const existingUserId = await value(
    admin,
    'select id from public.usuarios order by created_at limit 1',
  );
  check(Boolean(existingUserId), 'golden previo dejó un usuario registrado para el control de no regresión');

  const matchId = await createMatch(admin, {
    code: `P1A${Date.now()}`,
    capacity: 2,
    creatorId: existingUserId,
  });
  const validToken = token('a1');
  await createInvite(admin, {
    matchId,
    inviteToken: validToken,
    creatorId: existingUserId,
  });

  const registeredUuid = guestUuid(90);
  const registeredPlayerId = await value(
    admin,
    `insert into public.jugadores (partido_id, usuario_id, nombre, uuid)
     values ($1, $2, 'Usuario registrado intacto', $3)
     returning id`,
    [matchId, existingUserId, registeredUuid],
  );

  const starter = await joinGuest(service, {
    matchId,
    inviteToken: validToken,
    uuid: guestUuid(1),
    name: 'Invitado titular',
  });
  check(starter?.ok && starter?.status === 'accepted', 'invitación válida crea al invitado');
  equal(starter?.is_substitute, false, 'el cupo titular conserva is_substitute=false');
  equal(starter?.substitute_order, null, 'un titular no recibe substitute_order');
  equal(
    Object.keys(starter || {}).sort(),
    ['is_substitute', 'jugador_id', 'nombre', 'ok', 'status', 'substitute_order', 'uuid'].sort(),
    'la respuesta de la RPC expone sólo campos sanitizados',
  );

  const usesAfterStarter = await count(
    admin,
    'select uses_count from public.guest_match_invites where partido_id = $1 and token = $2',
    [matchId, validToken],
  );
  const repeated = await joinGuest(service, {
    matchId,
    inviteToken: validToken,
    uuid: guestUuid(1),
    name: 'Nombre ignorado en retry',
  });
  equal(repeated?.status, 'already_joined', 'repetir el uso devuelve el mismo jugador');
  equal(
    await count(
      admin,
      'select uses_count from public.guest_match_invites where partido_id = $1 and token = $2',
      [matchId, validToken],
    ),
    usesAfterStarter,
    'un retry idempotente no vuelve a consumir la invitación',
  );
  equal(
    await count(
      admin,
      'select count(*) from public.jugadores where partido_id = $1 and uuid = $2',
      [matchId, guestUuid(1)],
    ),
    1,
    'un retry idempotente no duplica jugadores',
  );

  const conflictUsesBefore = await count(
    admin,
    'select uses_count from public.guest_match_invites where partido_id = $1 and token = $2',
    [matchId, validToken],
  );
  const registeredConflict = await joinGuest(service, {
    matchId,
    inviteToken: validToken,
    uuid: registeredUuid,
    name: 'Intento de colisión',
  });
  equal(
    registeredConflict?.status,
    'guest_identity_conflict',
    'una UUID registrada no se trata como identidad guest',
  );
  equal(
    await count(
      admin,
      'select uses_count from public.guest_match_invites where partido_id = $1 and token = $2',
      [matchId, validToken],
    ),
    conflictUsesBefore,
    'la colisión con usuario registrado no consume invitación',
  );
  equal(
    await one(
      admin,
      'select id, usuario_id, nombre, uuid from public.jugadores where id = $1',
      [registeredPlayerId],
    ),
    {
      id: registeredPlayerId,
      usuario_id: existingUserId,
      nombre: 'Usuario registrado intacto',
      uuid: registeredUuid,
    },
    'el jugador registrado permanece intacto',
  );

  const substitute = await joinGuest(service, {
    matchId,
    inviteToken: validToken,
    uuid: guestUuid(2),
    name: 'Primer suplente',
  });
  equal(substitute?.is_substitute, true, 'el primer excedente entra como suplente');
  equal(substitute?.substitute_order, 1, 'el primer suplente recibe orden 1');

  for (let order = 2; order <= 4; order += 1) {
    const row = await joinGuest(service, {
      matchId,
      inviteToken: validToken,
      uuid: guestUuid(order + 1),
      name: `Suplente ${order}`,
    });
    equal(row?.substitute_order, order, `la cola asigna substitute_order=${order}`);
  }

  const fullUsesBefore = await count(
    admin,
    'select uses_count from public.guest_match_invites where partido_id = $1 and token = $2',
    [matchId, validToken],
  );
  const full = await joinGuest(service, {
    matchId,
    inviteToken: validToken,
    uuid: guestUuid(20),
    name: 'Sin cupo',
  });
  equal(full?.status, 'full', 'cupo completo sigue siendo rechazado');
  equal(
    await count(
      admin,
      'select uses_count from public.guest_match_invites where partido_id = $1 and token = $2',
      [matchId, validToken],
    ),
    fullUsesBefore,
    'el rechazo por cupo completo no consume invitación',
  );

  const invalidUsesBefore = fullUsesBefore;
  const invalid = await joinGuest(service, {
    matchId,
    inviteToken: token('ff'),
    uuid: guestUuid(21),
    name: 'Token inválido',
  });
  equal(invalid?.status, 'invalid_invite', 'invitación inválida sigue siendo rechazada');
  equal(
    await count(
      admin,
      'select uses_count from public.guest_match_invites where partido_id = $1 and token = $2',
      [matchId, validToken],
    ),
    invalidUsesBefore,
    'una invitación inválida no altera la válida',
  );

  const expiredToken = token('e1');
  await createInvite(admin, {
    matchId,
    inviteToken: expiredToken,
    creatorId: existingUserId,
    expired: true,
  });
  const expired = await joinGuest(service, {
    matchId,
    inviteToken: expiredToken,
    uuid: guestUuid(22),
    name: 'Token vencido',
  });
  equal(expired?.status, 'invalid_invite', 'invitación vencida sigue siendo rechazada');
  equal(
    await count(
      admin,
      'select uses_count from public.guest_match_invites where partido_id = $1 and token = $2',
      [matchId, expiredToken],
    ),
    0,
    'una invitación vencida no se consume',
  );

  const failureMatchId = await createMatch(admin, {
    code: `P1F${Date.now()}`,
    capacity: 1,
    creatorId: existingUserId,
  });
  const failureToken = token('f1');
  await createInvite(admin, {
    matchId: failureMatchId,
    inviteToken: failureToken,
    creatorId: existingUserId,
  });
  const invalidPayload = await joinGuest(service, {
    matchId: failureMatchId,
    inviteToken: failureToken,
    uuid: guestUuid(30),
    name: ' nombre sin normalizar ',
  });
  equal(invalidPayload?.status, 'invalid_payload', 'fallo previo al insert se rechaza');
  equal(
    await count(
      admin,
      'select uses_count from public.guest_match_invites where partido_id = $1 and token = $2',
      [failureMatchId, failureToken],
    ),
    0,
    'un fallo previo al insert no consume invitación',
  );

  await admin.query(
    `create function public.fail_test_guest_insert()
     returns trigger
     language plpgsql
     set search_path = ''
     as $$
     begin
       if new.nombre = 'Falla durante insert' then
         raise exception 'GUEST_TEST_INSERT_FAILURE';
       end if;
       return new;
     end;
     $$;
     create trigger fail_test_guest_insert
     before insert on public.jugadores
     for each row execute function public.fail_test_guest_insert()`,
  );
  let insertFailure = null;
  try {
    await joinGuest(service, {
      matchId: failureMatchId,
      inviteToken: failureToken,
      uuid: guestUuid(31),
      name: 'Falla durante insert',
    });
  } catch (error) {
    insertFailure = error;
  } finally {
    await admin.query(
      `drop trigger if exists fail_test_guest_insert on public.jugadores;
       drop function if exists public.fail_test_guest_insert()`,
    );
  }
  check(
    /GUEST_TEST_INSERT_FAILURE/.test(String(insertFailure?.message || insertFailure)),
    'un fallo durante el insert se propaga',
  );
  equal(
    await count(
      admin,
      'select uses_count from public.guest_match_invites where partido_id = $1 and token = $2',
      [failureMatchId, failureToken],
    ),
    0,
    'un fallo durante el insert revierte el consumo',
  );
  equal(
    await count(
      admin,
      'select count(*) from public.jugadores where partido_id = $1 and uuid = $2',
      [failureMatchId, guestUuid(31)],
    ),
    0,
    'un fallo durante el insert no deja jugador parcial',
  );

  const raceMatchId = await createMatch(admin, {
    code: `P1R${Date.now()}`,
    capacity: 1,
    creatorId: existingUserId,
  });
  const raceToken = token('c1');
  await createInvite(admin, {
    matchId: raceMatchId,
    inviteToken: raceToken,
    creatorId: existingUserId,
  });
  for (let index = 0; index < 4; index += 1) {
    await admin.query(
      `insert into public.jugadores (partido_id, nombre, uuid)
       values ($1, $2, $3)`,
      [raceMatchId, `Prefill ${index}`, guestUuid(40 + index)],
    );
  }
  const raceRows = await Promise.all([
    joinGuest(service, {
      matchId: raceMatchId,
      inviteToken: raceToken,
      uuid: guestUuid(50),
      name: 'Carrera A',
    }),
    joinGuest(serviceRace, {
      matchId: raceMatchId,
      inviteToken: raceToken,
      uuid: guestUuid(51),
      name: 'Carrera B',
    }),
  ]);
  equal(
    raceRows.map((row) => row.status).sort(),
    ['accepted', 'full'],
    'dos joins concurrentes compiten por un único cupo sin sobreventa',
  );
  equal(
    await count(
      admin,
      'select uses_count from public.guest_match_invites where partido_id = $1 and token = $2',
      [raceMatchId, raceToken],
    ),
    1,
    'la carrera concurrente consume exactamente un uso',
  );
  equal(
    await count(
      admin,
      'select count(*) from public.jugadores where partido_id = $1',
      [raceMatchId],
    ),
    5,
    'la carrera concurrente deja un plantel máximo de titular + cuatro suplentes',
  );
  equal(
    await value(
      admin,
      `select string_agg(substitute_order::text, ',' order by substitute_order)
       from public.jugadores
       where partido_id = $1 and is_substitute`,
      [raceMatchId],
    ),
    '1,2,3,4',
    'la carrera concurrente conserva una cola de suplentes continua',
  );

  const edgeCode = `P1E${Date.now()}`;
  const edgeMatchId = await createMatch(admin, {
    code: edgeCode,
    capacity: 1,
    creatorId: existingUserId,
  });
  const edgeToken = token('d1');
  await createInvite(admin, {
    matchId: edgeMatchId,
    inviteToken: edgeToken,
    creatorId: existingUserId,
  });
  const edgeAccepted = await joinGuestThroughEdge({
    matchId: edgeMatchId,
    code: edgeCode,
    inviteToken: edgeToken,
    uuid: guestUuid(70),
    name: 'Invitado Edge',
  });
  check(
    edgeAccepted.response.status === 200
      && edgeAccepted.data?.ok
      && edgeAccepted.data?.jugador?.is_substitute === false,
    'la Edge Function pública completa un ingreso titular real',
    JSON.stringify(edgeAccepted.data),
  );
  equal(
    Object.keys(edgeAccepted.data?.jugador || {}).sort(),
    ['id', 'is_substitute', 'nombre', 'substitute_order', 'uuid'].sort(),
    'la Edge Function devuelve un jugador sanitizado',
  );
  const edgeRepeated = await joinGuestThroughEdge({
    matchId: edgeMatchId,
    code: edgeCode,
    inviteToken: edgeToken,
    uuid: guestUuid(70),
    name: 'Retry Edge',
  });
  check(
    edgeRepeated.response.status === 200 && edgeRepeated.data?.already_joined === true,
    'la Edge Function pública conserva idempotencia en el retry',
    JSON.stringify(edgeRepeated.data),
  );
  equal(
    await count(
      admin,
      'select uses_count from public.guest_match_invites where partido_id = $1 and token = $2',
      [edgeMatchId, edgeToken],
    ),
    1,
    'el retry real de Edge no consume un segundo uso',
  );

  let anonymousError = null;
  try {
    await joinGuest(anonymous, {
      matchId: failureMatchId,
      inviteToken: failureToken,
      uuid: guestUuid(60),
      name: 'Anon directo',
    });
  } catch (error) {
    anonymousError = error;
  }
  check(
    /permission denied/i.test(String(anonymousError?.message || anonymousError)),
    'la RPC atómica no es ejecutable directamente por anon',
  );

  console.log(`\nResultado P1: ${checks - failures}/${checks} checks pasaron.\n`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled(clients.map((client) => client.end()));
  });
