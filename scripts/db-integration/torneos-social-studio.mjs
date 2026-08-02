#!/usr/bin/env node
//
// PostgreSQL/RLS coverage for the Estudio Social.
//
// Three properties matter here and nothing else really does: only published
// data can become a graphic, only the right people can ask for it, and the
// database never makes an editorial decision on anyone's behalf.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  USERS,
  cleanupMatchOperationsHarness,
  connect,
  seedOperationalMatch,
  setup,
  value,
} from './torneos-match-operations.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOCIAL_MIGRATION = '20260803090000_tournament_social_studio.sql';
const PIECES = [
  'next_fixture', 'round_results', 'standings', 'scorers', 'discipline',
  'best_eleven', 'mvp', 'round_summary', 'semifinals', 'final', 'champion',
];
const CURATED = ['best_eleven', 'mvp', 'champion'];

let checks = 0;
let failures = 0;

function ok(condition, label, detail = '') {
  checks += 1;
  if (condition) console.log(`  ✔ ${label}`);
  else {
    failures += 1;
    console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(actual, expected, label) {
  ok(
    actual === expected,
    label,
    `esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`,
  );
}

async function expectError(action, pattern, label) {
  try {
    await action();
    ok(false, label, 'la operación no fue rechazada');
  } catch (error) {
    const message = String(error?.message || error);
    ok(pattern.test(message), label, message);
  }
}

async function snapshot(client, scope, piece, overrides = {}) {
  return value(
    client,
    'select public.get_tournament_social_snapshot($1,$2,$3,$4,$5,$6,$7)',
    [
      overrides.organizationId || scope.organizationId,
      overrides.tournamentId || scope.tournamentId,
      overrides.categoryId || scope.categoryId,
      overrides.phaseId === undefined ? scope.phaseId : overrides.phaseId,
      piece,
      overrides.roundId === undefined ? scope.roundId : overrides.roundId,
      overrides.groupId || null,
    ],
  );
}

async function run() {
  console.log('Arma2 Torneos · Estudio Social PostgreSQL/RLS');
  try {
    const admin = await setup([
      '20260726200000_tournament_standings_discipline.sql',
      '20260726230000_tournament_participant_hub.sql',
      '20260727010000_tournament_communications.sql',
    ]);
    await admin.query(
      fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', SOCIAL_MIGRATION), 'utf8'),
    );
    const base = await seedOperationalMatch(admin);
    const owner = base.owner;
    const adminUser = await connect({ role: 'authenticated', userId: USERS.admin });
    const collaborator = await connect({
      role: 'authenticated', userId: USERS.collaborator,
    });
    const captain = await connect({ role: 'authenticated', userId: USERS.captainHome });
    const player = await connect({ role: 'authenticated', userId: USERS.playerHome });
    const outsider = await connect({ role: 'authenticated', userId: USERS.outsider });
    const anonymous = await connect({ role: 'anon' });

    const context = await value(
      owner, 'select public.get_tournament_social_studio_context($1)',
      [base.organizationId],
    );
    ok(Array.isArray(context.tournaments), 'el contexto del estudio responde');
    const tournament = context.tournaments.find(
      (entry) => entry.id === base.tournamentId,
    );
    const category = tournament?.categories?.find((entry) => entry.id === base.categoryId);
    const phase = category?.phases?.[0];
    ok(Boolean(phase), 'el contexto expone una fase de un fixture publicado');
    const scope = {
      organizationId: base.organizationId,
      tournamentId: base.tournamentId,
      categoryId: base.categoryId,
      phaseId: phase?.id,
      roundId: phase?.rounds?.[0]?.id || null,
    };

    // -----------------------------------------------------------------------
    console.log('\n· capacidades por rol');
    // -----------------------------------------------------------------------
    eq(
      JSON.stringify(context.capabilities.slice().sort()),
      JSON.stringify([
        'social.brand_toggle', 'social.create', 'social.editorial_text',
        'social.export', 'social.manage_permissions', 'social.manual_selection',
        'social.read',
      ]),
      'el owner recibe el estudio completo',
    );
    const adminContext = await value(
      adminUser, 'select public.get_tournament_social_studio_context($1)',
      [base.organizationId],
    );
    ok(adminContext.capabilities.includes('social.export'), 'el admin puede exportar');

    const collaboratorContext = await value(
      collaborator, 'select public.get_tournament_social_studio_context($1)',
      [base.organizationId],
    );
    eq(
      JSON.stringify(collaboratorContext.capabilities),
      JSON.stringify(['social.read']),
      'un colaborador entra en modo lectura, sin exportar',
    );
    eq(
      collaboratorContext.brand.canHideArma2Logo, false,
      'y no puede ocultar la marca',
    );

    for (const [label, client] of [
      ['capitán', captain], ['jugador', player], ['outsider', outsider],
    ]) {
      await expectError(
        () => value(client, 'select public.get_tournament_social_studio_context($1)',
          [base.organizationId]),
        /TORNEOS_SOCIAL_FORBIDDEN/,
        `${label} no accede al estudio`,
      );
    }
    await expectError(
      () => value(anonymous, 'select public.get_tournament_social_studio_context($1)',
        [base.organizationId]),
      /TORNEOS_SOCIAL_FORBIDDEN|permission denied/,
      'anon no accede al estudio',
    );

    await value(owner, 'select public.set_tournament_social_permission($1,$2,$3)',
      [base.organizationId, USERS.collaborator, true]);
    const grantedContext = await value(
      collaborator, 'select public.get_tournament_social_studio_context($1)',
      [base.organizationId],
    );
    ok(
      grantedContext.capabilities.includes('social.export')
      && grantedContext.capabilities.includes('social.create'),
      'con permiso explícito el colaborador crea y exporta',
    );
    ok(
      !grantedContext.capabilities.includes('social.manage_permissions'),
      'pero nunca administra permisos',
    );
    await expectError(
      () => value(collaborator, 'select public.set_tournament_social_permission($1,$2,$3)',
        [base.organizationId, USERS.admin, true]),
      /TORNEOS_SOCIAL_FORBIDDEN/,
      'un colaborador con permiso no puede repartir permisos',
    );
    await expectError(
      () => value(owner, 'select public.set_tournament_social_permission($1,$2,$3)',
        [base.organizationId, USERS.outsider, true]),
      /TORNEOS_SOCIAL_GRANT_INVALID/,
      'no se puede otorgar permiso social a quien no es miembro',
    );
    await value(owner, 'select public.set_tournament_social_permission($1,$2,$3)',
      [base.organizationId, USERS.collaborator, false]);
    eq(
      (await value(collaborator, 'select public.get_tournament_social_studio_context($1)',
        [base.organizationId])).capabilities.length,
      1,
      'revocar el permiso devuelve al colaborador a modo lectura',
    );

    await admin.query(
      `update public.tournament_organization_members set status = 'suspended'
       where organization_id = $1 and user_id = $2`,
      [base.organizationId, USERS.admin],
    );
    await expectError(
      () => value(adminUser, 'select public.get_tournament_social_studio_context($1)',
        [base.organizationId]),
      /TORNEOS_SOCIAL_FORBIDDEN/,
      'un miembro suspendido pierde el estudio',
    );
    await admin.query(
      `update public.tournament_organization_members set status = 'active'
       where organization_id = $1 and user_id = $2`,
      [base.organizationId, USERS.admin],
    );

    // -----------------------------------------------------------------------
    console.log('\n· snapshots tipados y sólo publicados');
    // -----------------------------------------------------------------------
    let rendered = 0;
    for (const piece of PIECES) {
      // eslint-disable-next-line no-await-in-loop
      const payload = await snapshot(owner, scope, piece);
      const valid = payload
        && payload.schemaVersion === 1
        && payload.piece === piece
        && Boolean(payload.source?.fixtureVersionId)
        && payload.source.organizationId === base.organizationId
        && typeof payload.official === 'object';
      if (valid) rendered += 1;
      else console.error(`    (${piece}) ${JSON.stringify(payload)?.slice(0, 200)}`);
    }
    eq(rendered, PIECES.length, 'las once piezas devuelven un snapshot tipado y versionado');

    for (const piece of CURATED) {
      // eslint-disable-next-line no-await-in-loop
      const payload = await snapshot(owner, scope, piece);
      ok(
        payload.official.requiresHumanSelection === true,
        `${piece} exige curaduría humana explícita`,
      );
    }
    const bestEleven = await snapshot(owner, scope, 'best_eleven');
    ok(
      !('selection' in bestEleven.official) && !('chosen' in bestEleven.official),
      'la base nunca arma el equipo ideal por estadística',
    );
    const mvp = await snapshot(owner, scope, 'mvp');
    ok(
      !('winner' in mvp.official) && !('mvp' in mvp.official),
      'la base nunca elige la figura por ranking',
    );

    const serialized = JSON.stringify(await snapshot(owner, scope, 'round_results'));
    ok(
      !/auditLog|internalNotes|"notes"|availability|reporterId|internalPath|checksum/i
        .test(serialized),
      'el snapshot no arrastra auditoría, notas, disponibilidad ni paths',
    );

    await expectError(
      () => snapshot(owner, scope, 'un_meme'),
      /TORNEOS_SOCIAL_PIECE_INVALID/,
      'una pieza fuera del registro se rechaza',
    );
    await expectError(
      () => snapshot(owner, scope, 'standings', {
        phaseId: '99000000-0000-4000-8000-000000000099',
      }),
      /TORNEOS_SOCIAL_SCOPE_UNAVAILABLE/,
      'una fase inexistente no produce pieza',
    );
    await expectError(
      () => snapshot(owner, scope, 'round_results', {
        roundId: '99000000-0000-4000-8000-000000000098',
      }),
      /TORNEOS_SOCIAL_SCOPE_UNAVAILABLE/,
      'una fecha ajena al fixture no produce pieza',
    );
    await expectError(
      () => snapshot(collaborator, scope, 'standings', {
        organizationId: '99000000-0000-4000-8000-000000000097',
      }),
      /TORNEOS_SOCIAL_FORBIDDEN/,
      'no se puede mezclar tenants en una pieza',
    );
    for (const [label, client] of [['jugador', player], ['outsider', outsider]]) {
      await expectError(
        () => snapshot(client, scope, 'standings'),
        /TORNEOS_SOCIAL_FORBIDDEN/,
        `${label} no obtiene snapshots`,
      );
    }
    ok(
      Boolean(await snapshot(collaborator, scope, 'standings')),
      'un colaborador en modo lectura sí puede ver una pieza',
    );

    // A scope that stops being published must stop feeding the studio the
    // moment it happens, not on the next deploy.
    const originalPhaseStatus = await value(
      admin, 'select status from public.tournament_phases where id = $1', [scope.phaseId],
    );
    await admin.query(
      "update public.tournament_phases set status = 'archived' where id = $1",
      [scope.phaseId],
    );
    await expectError(
      () => snapshot(owner, scope, 'standings'),
      /TORNEOS_SOCIAL_SCOPE_UNAVAILABLE/,
      'archivar la fase corta el estudio de inmediato',
    );
    await admin.query(
      'update public.tournament_phases set status = $2 where id = $1',
      [scope.phaseId, originalPhaseStatus],
    );
    ok(
      Boolean(await snapshot(owner, scope, 'standings')),
      'y republicarla lo restituye',
    );

    // -----------------------------------------------------------------------
    console.log('\n· superficie de permisos');
    // -----------------------------------------------------------------------
    const internalFunctions = [
      'tournament_social_role_capabilities',
      'current_user_tournament_social_capabilities',
      'has_tournament_social_capability',
      'tournament_social_published_scope',
      'tournament_social_match_rows',
    ];
    eq(
      Number(await value(
        admin,
        `select count(*)
         from pg_proc proc
         join pg_namespace namespace on namespace.oid = proc.pronamespace
         cross join lateral aclexplode(coalesce(proc.proacl, acldefault('f', proc.proowner))) grant_row
         join pg_roles grantee on grantee.oid = grant_row.grantee
         where namespace.nspname = 'public'
           and proc.proname = any($1::text[])
           and grantee.rolname in ('anon','authenticated')`,
        [internalFunctions],
      )),
      0,
      'los helpers internos no se conceden a clientes',
    );
    eq(
      Number(await value(
        admin,
        `select count(*) from information_schema.role_table_grants
         where table_schema = 'public'
           and table_name = 'tournament_social_permissions'
           and grantee in ('PUBLIC','anon','authenticated')`,
      )),
      0,
      'la tabla de permisos sociales no es legible por clientes',
    );
    eq(
      Boolean(await value(
        admin,
        `select relrowsecurity from pg_class
         where oid = 'public.tournament_social_permissions'::regclass`,
      )),
      true,
      'la tabla de permisos sociales tiene RLS',
    );
    eq(
      Number(await value(
        admin,
        `select count(*) from pg_proc proc
         join pg_namespace namespace on namespace.oid = proc.pronamespace
         where namespace.nspname = 'public'
           and proc.proname like '%tournament_social%'
           and (proc.proconfig is null or not exists (
             select 1 from unnest(proc.proconfig) setting
             where setting in ('search_path=', 'search_path=""')
           ))`,
      )),
      0,
      'todas las funciones sociales fijan search_path vacío',
    );
    eq(
      Number(await value(
        admin,
        `select count(*) from pg_proc proc
         join pg_namespace namespace on namespace.oid = proc.pronamespace
         where namespace.nspname = 'public'
           and proc.proname in (
             'get_tournament_social_snapshot','get_tournament_social_studio_context'
           )
           and proc.provolatile <> 's'`,
      )),
      0,
      'los getters sociales son STABLE y de sólo lectura',
    );
    for (const [label, client] of [['authenticated', owner], ['anon', anonymous]]) {
      await expectError(
        () => value(client, 'select count(*) from public.tournament_social_permissions'),
        /permission denied/i,
        `${label} no lee la tabla de permisos sociales`,
      );
    }

    console.log(`\n${checks - failures}/${checks} verificaciones del Estudio Social aprobadas`);
    if (failures > 0) process.exitCode = 1;
  } finally {
    await cleanupMatchOperationsHarness();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
