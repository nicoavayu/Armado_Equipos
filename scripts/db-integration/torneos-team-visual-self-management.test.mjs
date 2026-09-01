// Matriz de permisos de la autogestión visual del equipo (Multimedia 1C.3A).
//
// Corre contra el Supabase LOCAL con el dataset QA de Torneos ya sembrado. No
// crea usuarios ni equipos: usa las identidades QA existentes, que ya cubren
// las diez clases de actor que el producto necesita distinguir.
//
//   TORNEOS_TEAM_VISUAL_LOCAL_TEST=true SUPABASE_DB_URL=... npm run test:db:torneos:visual
import assert from 'node:assert/strict';
import process from 'node:process';
import test from 'node:test';

import pg from 'pg';

const enabled = process.env.TORNEOS_TEAM_VISUAL_LOCAL_TEST === 'true';
const databaseUrl = process.env.SUPABASE_DB_URL || '';
const loopback = new Set(['127.0.0.1', 'localhost', '::1']);

const POLICIES = ['organization_only', 'delegates', 'roster'];
const FOREIGN_ORGANIZATION = '00000000-0000-4000-8000-000000000001';

function assertLocal(raw) {
  const parsed = new URL(raw);
  assert.ok(['postgres:', 'postgresql:'].includes(parsed.protocol));
  assert.ok(loopback.has(parsed.hostname), 'este test sólo corre contra LOCAL');
}

async function one(client, sql, params = []) {
  const { rows } = await client.query(sql, params);
  return rows[0];
}

/** Evalúa predicados en nombre de un actor, sin dejar el claim puesto. */
async function asActor(client, actorId, run) {
  await client.query('begin');
  try {
    await client.query(
      "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
      [actorId],
    );
    return await run();
  } finally {
    await client.query('rollback');
  }
}

/**
 * Igual que `asActor`, pero además aplica mutaciones dentro de la MISMA
 * transacción que se revierte. Sirve para probar clases de actor y estados que
 * el dataset QA no trae sembrados —un `captain` que no sea además staff de la
 * organización, un roster todavía en `draft`— sin crear usuarios ad hoc ni
 * dejar rastro. El rollback del `finally` de `asActor` deshace las dos cosas.
 */
async function asActorWith(client, actorId, mutations, run) {
  return asActor(client, actorId, async () => {
    for (const [sql, params] of mutations) {
      await client.query(sql, params);
    }
    return run();
  });
}

async function setPolicy(client, tournamentId, policy) {
  await client.query(
    'update public.tournaments set team_visual_management_policy = $2 where id = $1',
    [tournamentId, policy],
  );
}

test('la política de autogestión visual sólo amplía permisos hacia el propio equipo', {
  skip: !enabled,
  timeout: 120_000,
}, async (t) => {
  assertLocal(databaseUrl);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const scope = await one(client, `
      select organization.id as organization_id,
             tournament.id as tournament_id,
             tournament.team_visual_management_policy as original_policy,
             own.id as own_entry_id,
             other.id as other_entry_id
      from public.tournament_organizations organization
      join public.tournaments tournament
        on tournament.organization_id = organization.id
      join public.tournament_team_entries own
        on own.tournament_id = tournament.id and own.short_name = 'BNO'
      join public.tournament_team_entries other
        on other.tournament_id = tournament.id and other.short_name = 'HOR'
      where tournament.name = 'Torneo Apertura QA 2026'
    `);
    assert.ok(scope, 'falta el dataset QA de Torneos en el Supabase LOCAL');

    const actorRows = (await client.query(
      `select email, id from auth.users where email = any($1::text[])`,
      [[
        'qa-owner@localhost.invalid', 'qa-admin@localhost.invalid',
        'qa-collaborator@localhost.invalid', 'qa-delegate@localhost.invalid',
        'qa-player@localhost.invalid', 'qa-outsider@localhost.invalid',
      ]],
    )).rows;
    const actor = Object.fromEntries(
      actorRows.map((row) => [row.email.replace('@localhost.invalid', '').replace(/^qa-/, ''), row.id]),
    );
    for (const key of [
      'owner', 'admin', 'collaborator', 'delegate', 'player', 'outsider',
    ]) {
      assert.ok(actor[key], `falta la identidad QA ${key}`);
    }

    const playerOf = async (entryId) => (await one(client, `
      select id from public.tournament_roster_players
      where team_entry_id = $1 and status = 'active'
      order by display_name limit 1
    `, [entryId])).id;
    const ownPlayerId = await playerOf(scope.own_entry_id);
    const otherPlayerId = await playerOf(scope.other_entry_id);

    /** Escudo y retrato, evaluados con los mismos predicados que autorizan. */
    async function permissions({
      actorId, entryId, rosterPlayerId, organizationId = scope.organization_id,
    }) {
      return asActor(client, actorId, async () => {
        const row = await one(client, `
          select public.can_update_tournament_team_branding($1, $2) as shield,
                 public.can_manage_tournament_player_portrait_as($1, $3, $4) as portrait
        `, [organizationId, entryId, rosterPlayerId, actorId]);
        return { shield: row.shield, portrait: row.portrait };
      });
    }

    // actor → [organization_only, delegates, roster] esperado, escudo y retrato
    // por igual. Los tres valores comparten la misma fuente de verdad.
    const MATRIX = [
      ['OWNER', () => actor.owner, 'own', [true, true, true]],
      ['ADMIN', () => actor.admin, 'own', [true, true, true]],
      // COLLABORATOR es de sólo lectura en el modelo real: no tiene
      // team_entries.update ni roster_players.update en ningún valor.
      ['COLLABORATOR', () => actor.collaborator, 'own', [false, false, false]],
      ['DELEGATE OWN TEAM', () => actor.delegate, 'own', [false, true, true]],
      ['DELEGATE OTHER TEAM', () => actor.delegate, 'other', [false, false, false]],
      ['ROSTER MEMBER OWN TEAM', () => actor.player, 'own', [false, false, true]],
      ['ROSTER MEMBER OTHER TEAM', () => actor.player, 'other', [false, false, false]],
      ['OUTSIDER', () => actor.outsider, 'own', [false, false, false]],
    ];

    for (const [label, resolve, target, expected] of MATRIX) {
      await t.test(`${label}`, async () => {
        const entryId = target === 'own' ? scope.own_entry_id : scope.other_entry_id;
        const rosterPlayerId = target === 'own' ? ownPlayerId : otherPlayerId;
        for (const [index, policy] of POLICIES.entries()) {
          await setPolicy(client, scope.tournament_id, policy);
          const granted = await permissions({ actorId: resolve(), entryId, rosterPlayerId });
          assert.equal(granted.shield, expected[index], `escudo · ${policy}`);
          assert.equal(granted.portrait, expected[index], `retrato · ${policy}`);
        }
      });
    }

    // CAPTAIN es un rol real de tournament_team_managers, igual que DELEGATE, y
    // la política los trata igual. En el dataset QA los capitanes sembrados son
    // además staff de la organización —qa-owner, qa-admin—, así que preguntarles
    // no distingue nada: siempre dirían que sí por capability. Para medir el rol
    // solo, `qa-delegate` (que no es miembro de la organización) pasa a capitán
    // dentro de una transacción que se revierte.
    const asCaptain = [[
      `update public.tournament_team_managers set role = 'captain'
       where user_id = $1 and team_entry_id = $2`,
      [actor.delegate, scope.own_entry_id],
    ]];

    await t.test('CAPTAIN OWN TEAM: mismo trato que el delegado', async () => {
      for (const [index, policy] of POLICIES.entries()) {
        await setPolicy(client, scope.tournament_id, policy);
        const row = await asActorWith(client, actor.delegate, asCaptain, () => one(client, `
          select public.can_update_tournament_team_branding($1, $2) as shield,
                 public.can_manage_tournament_player_portrait_as($1, $3, $4) as portrait
        `, [scope.organization_id, scope.own_entry_id, ownPlayerId, actor.delegate]));
        assert.equal(row.shield, [false, true, true][index], `escudo · ${policy}`);
        assert.equal(row.portrait, [false, true, true][index], `retrato · ${policy}`);
      }
    });

    await t.test('CAPTAIN OTHER TEAM: el rol no cruza de equipo', async () => {
      for (const policy of POLICIES) {
        await setPolicy(client, scope.tournament_id, policy);
        const row = await asActorWith(client, actor.delegate, asCaptain, () => one(client, `
          select public.can_update_tournament_team_branding($1, $2) as shield,
                 public.can_manage_tournament_player_portrait_as($1, $3, $4) as portrait
        `, [scope.organization_id, scope.other_entry_id, otherPlayerId, actor.delegate]));
        assert.equal(row.shield, false, `escudo · ${policy}`);
        assert.equal(row.portrait, false, `retrato · ${policy}`);
      }
    });

    await t.test('ASSISTANT no forma parte de esta autogestión', async () => {
      const asAssistant = [[
        `update public.tournament_team_managers set role = 'assistant'
         where user_id = $1 and team_entry_id = $2`,
        [actor.delegate, scope.own_entry_id],
      ]];
      await setPolicy(client, scope.tournament_id, 'delegates');
      const row = await asActorWith(client, actor.delegate, asAssistant, () => one(client, `
        select public.can_update_tournament_team_branding($1, $2) as shield
      `, [scope.organization_id, scope.own_entry_id]));
      assert.equal(row.shield, false);
    });

    // -----------------------------------------------------------------------
    // Qué cuenta como «este usuario juega hoy en este equipo»
    // -----------------------------------------------------------------------

    await t.test('el plantel vigente no exige estar cerrado deportivamente', async () => {
      // La pregunta de la autogestión no es «¿puede ser convocado?» sino «¿juega
      // en este equipo?». Un plantel en armado ya responde que sí, y es
      // justamente cuando el equipo todavía no tiene ni escudo ni fotos.
      await setPolicy(client, scope.tournament_id, 'roster');
      for (const status of ['draft', 'submitted', 'changes_requested', 'approved', 'locked']) {
        const row = await asActorWith(client, actor.player, [[
          `update public.tournament_rosters
           set status = $2,
               submitted_at = coalesce(submitted_at, now()),
               approved_at = coalesce(approved_at, now()),
               locked_at = coalesce(locked_at, now())
           where team_entry_id = $1`,
          [scope.own_entry_id, status],
        ]], () => one(client, `
          select public.is_tournament_team_roster_member_as($1, $2) as member,
                 public.can_update_tournament_team_branding($3, $1) as shield
        `, [scope.own_entry_id, actor.player, scope.organization_id]));
        assert.equal(row.member, true, `miembro · ${status}`);
        assert.equal(row.shield, true, `escudo · ${status}`);
      }
    });

    await t.test('un plantel histórico no habilita a nadie', async () => {
      await setPolicy(client, scope.tournament_id, 'roster');
      const row = await asActorWith(client, actor.player, [[
        `update public.tournament_rosters
         set status = 'superseded', submitted_at = coalesce(submitted_at, now()),
             approved_at = coalesce(approved_at, now())
         where team_entry_id = $1`,
        [scope.own_entry_id],
      ]], () => one(client, `
        select public.is_tournament_team_roster_member_as($1, $2) as member
      `, [scope.own_entry_id, actor.player]));
      assert.equal(row.member, false);
    });

    await t.test('un jugador removido deja de ser plantel', async () => {
      await setPolicy(client, scope.tournament_id, 'roster');
      const row = await asActorWith(client, actor.player, [[
        `update public.tournament_roster_players
         set status = 'removed', removed_at = now()
         where team_entry_id = $1 and arma2_user_id = $2`,
        [scope.own_entry_id, actor.player],
      ]], () => one(client, `
        select public.is_tournament_team_roster_member_as($1, $2) as member,
               public.can_update_tournament_team_branding($3, $1) as shield
      `, [scope.own_entry_id, actor.player, scope.organization_id]));
      assert.equal(row.member, false);
      assert.equal(row.shield, false);
    });

    await t.test('una inscripción rechazada o retirada cierra la autogestión, no el override', async () => {
      await setPolicy(client, scope.tournament_id, 'roster');
      for (const status of ['rejected', 'withdrawn']) {
        const mutation = [[
          // `tournament_team_entries_lifecycle_check` no admite `approved_at`
          // sobre una inscripción rechazada: el estado y sus marcas de tiempo
          // se mueven juntos.
          `update public.tournament_team_entries
           set status = $2,
               approved_at = case when $2 = 'rejected' then null else approved_at end,
               rejected_at = case when $2 = 'rejected' then now() else null end,
               withdrawn_at = case when $2 = 'withdrawn' then now() else null end
           where id = $1`,
          [scope.own_entry_id, status],
        ]];
        for (const [label, actorId] of [['delegate', actor.delegate], ['player', actor.player]]) {
          const row = await asActorWith(client, actorId, mutation, () => one(client, `
            select public.can_manage_tournament_player_portrait_as($1, $2, $3) as portrait
          `, [scope.organization_id, ownPlayerId, actorId]));
          assert.equal(row.portrait, false, `${label} · ${status}`);
        }
        const staff = await asActorWith(client, actor.owner, mutation, () => one(client, `
          select public.can_manage_tournament_player_portrait_as($1, $2, $3) as portrait
        `, [scope.organization_id, ownPlayerId, actor.owner]));
        assert.equal(staff.portrait, true, `organización · ${status}`);
      }
    });

    // -----------------------------------------------------------------------
    // Autogestión visual no es acceso administrativo
    // -----------------------------------------------------------------------

    await t.test('el jugador con la pantalla abierta no puede tocar nada deportivo', async () => {
      await setPolicy(client, scope.tournament_id, 'roster');
      const rosterId = (await one(client,
        'select id from public.tournament_rosters where team_entry_id = $1 order by version desc limit 1',
        [scope.own_entry_id])).id;

      // Las llamadas que un DevTools tiene a mano desde esta misma pantalla.
      const tampering = [
        ['agregar jugador', `select public.add_tournament_roster_player(
            $1, $2, $3, $4, null, 'Intruso QA', null, null::smallint, null, null, false)`,
        [scope.organization_id, scope.own_entry_id, rosterId, actor.outsider]],
        ['quitar jugador', 'select public.remove_tournament_roster_player($1, $2, $3)',
          [scope.organization_id, scope.own_entry_id, ownPlayerId]],
        ['editar dorsal y posición', `select public.update_tournament_roster_player(
            $1, $2, $3, 99::smallint, 'ARQ', null, true)`,
        [scope.organization_id, scope.own_entry_id, ownPlayerId]],
        ['renombrar el equipo', `select public.update_tournament_team_entry(
            $1, $2, jsonb_build_object('name', 'Equipo Secuestrado'))`,
        [scope.organization_id, scope.own_entry_id]],
        ['presentar la inscripción', 'select public.submit_tournament_team_entry($1, $2)',
          [scope.organization_id, scope.own_entry_id]],
        ['revisar la inscripción', `select public.review_tournament_team_entry(
            $1, $2, 'approved', 'auto-aprobado', '[]'::jsonb)`,
        [scope.organization_id, scope.own_entry_id]],
        ['retirar la inscripción', `select public.withdraw_tournament_team_entry(
            $1, $2, 'me voy')`,
        [scope.organization_id, scope.own_entry_id]],
      ];

      for (const [label, sql, params] of tampering) {
        await assert.rejects(
          () => asActor(client, actor.player, () => client.query(sql, params)),
          (error) => {
            assert.match(String(error.message), /FORBIDDEN|forbidden|permission denied/i, label);
            return true;
          },
          label,
        );
      }

      // Y tampoco moderación ni consentimiento del retrato que sí puede subir.
      const portrait = await one(client, `
        select id from public.tournament_player_portraits
        where team_entry_id = $1 and lifecycle_status = 'active' limit 1
      `, [scope.own_entry_id]);
      if (portrait) {
        for (const [label, sql] of [
          ['aprobar el retrato',
            "select public.set_tournament_player_portrait_editorial_status($1, $2, 'approved')"],
          ['revocar el consentimiento',
            'select public.revoke_tournament_player_portrait_publication($1, $2)'],
        ]) {
          await assert.rejects(
            () => asActor(client, actor.player, () => client.query(sql,
              [scope.organization_id, portrait.id])),
            /TORNEOS_PORTRAIT_FORBIDDEN/,
            label,
          );
        }
      }
    });

    await t.test('los predicados con actor explícito no son ejecutables por authenticated', async () => {
      // Un predicado con actor por parámetro respondido al navegador es un
      // oráculo de membresía sobre cualquier usuario y cualquier equipo. La
      // puerta de `authenticated` son los wrappers que leen auth.uid().
      const grants = await client.query(`
        select proname,
               has_function_privilege('authenticated', oid, 'execute') as authenticated,
               has_function_privilege('anon', oid, 'execute') as anon
        from pg_proc
        where proname in (
          'is_tournament_team_roster_member_as',
          'can_manage_tournament_team_visual_assets_as',
          'can_moderate_tournament_team_visual_assets_as',
          'can_manage_tournament_player_portrait_as',
          'can_read_tournament_player_portrait_as'
        )
      `);
      assert.equal(grants.rows.length, 5);
      for (const row of grants.rows) {
        assert.equal(row.authenticated, false, `${row.proname} · authenticated`);
        assert.equal(row.anon, false, `${row.proname} · anon`);
      }
    });

    await t.test('CROSS TENANT: el organization_id no es un parámetro negociable', async () => {
      for (const policy of POLICIES) {
        await setPolicy(client, scope.tournament_id, policy);
        for (const actorId of [actor.owner, actor.delegate, actor.player]) {
          const granted = await permissions({
            actorId,
            entryId: scope.own_entry_id,
            rosterPlayerId: ownPlayerId,
            organizationId: FOREIGN_ORGANIZATION,
          });
          assert.equal(granted.shield, false, `escudo · ${policy}`);
          assert.equal(granted.portrait, false, `retrato · ${policy}`);
        }
      }
    });

    await t.test('PLAYER PROVISIONAL: sin identidad autenticable no hay permiso', async () => {
      await setPolicy(client, scope.tournament_id, 'roster');
      const provisional = await one(client, `
        select player.id
        from public.tournament_roster_players player
        left join public.tournament_provisional_players provisional
          on provisional.id = player.provisional_player_id
        where player.team_entry_id = $1
          and player.status = 'active'
          and player.arma2_user_id is null
          and coalesce(provisional.claim_status, 'unclaimed') <> 'claimed'
        limit 1
      `, [scope.own_entry_id]);
      assert.ok(provisional, 'el dataset QA debería tener jugadores sin cuenta');
      // No hay actor al que darle el permiso: el predicado exige un uuid real.
      const row = await one(client, `
        select public.can_manage_tournament_player_portrait_as($1, $2, null) as portrait,
               public.is_tournament_team_roster_member_as($3, null) as member
      `, [scope.organization_id, provisional.id, scope.own_entry_id]);
      assert.equal(row.portrait, false);
      assert.equal(row.member, false);
      // Y el jugador provisional sigue siendo gestionable por la organización.
      const staff = await permissions({
        actorId: actor.owner,
        entryId: scope.own_entry_id,
        rosterPlayerId: provisional.id,
      });
      assert.equal(staff.portrait, true);
    });

    await t.test('la autogestión no habilita moderación ni consentimiento', async () => {
      await setPolicy(client, scope.tournament_id, 'roster');
      for (const [label, actorId] of [
        ['delegate', actor.delegate], ['player', actor.player],
      ]) {
        const row = await asActor(client, actorId, () => one(client, `
          select public.can_manage_tournament_team_visual_assets_as($1, $2, $3, 'roster_players.update') as manage,
                 public.can_moderate_tournament_team_visual_assets_as($1, $2, $3, 'roster_players.update') as moderate
        `, [scope.organization_id, scope.own_entry_id, actorId]));
        assert.equal(row.manage, true, `${label} gestiona`);
        assert.equal(row.moderate, false, `${label} NO modera`);
      }
      const staff = await asActor(client, actor.owner, () => one(client, `
        select public.can_moderate_tournament_team_visual_assets_as($1, $2, $3, 'roster_players.update') as moderate
      `, [scope.organization_id, scope.own_entry_id, actor.owner]));
      assert.equal(staff.moderate, true);
    });

    await t.test('una capability arbitraria no se convierte en una llave', async () => {
      await setPolicy(client, scope.tournament_id, 'roster');
      for (const capability of ['tournaments.update', 'media.publish', '', 'roster_players.read']) {
        const row = await asActor(client, actor.owner, () => one(client, `
          select public.can_manage_tournament_team_visual_assets_as($1, $2, $3, $4) as granted
        `, [scope.organization_id, scope.own_entry_id, actor.owner, capability]));
        assert.equal(row.granted, false, capability);
      }
    });

    await t.test('la ventana de estados del escudo no se amplía por política', async () => {
      // Un equipo retirado o archivado no vuelve a ser editable por nadie: la
      // política amplía QUIÉN, nunca CUÁNDO.
      await setPolicy(client, scope.tournament_id, 'roster');
      const original = await one(client,
        'select status from public.tournament_team_entries where id = $1',
        [scope.own_entry_id]);
      try {
        for (const [status, archivedAt] of [['withdrawn', null], ['archived', 'now()']]) {
          await client.query(
            `update public.tournament_team_entries
             set status = $2, archived_at = ${archivedAt ?? 'null'}
             where id = $1`,
            [scope.own_entry_id, status],
          );
          for (const actorId of [actor.owner, actor.delegate, actor.player]) {
            const granted = await asActor(client, actorId, () => one(client, `
              select public.can_update_tournament_team_branding($1, $2) as shield
            `, [scope.organization_id, scope.own_entry_id]));
            assert.equal(granted.shield, false, `${status}`);
          }
        }
      } finally {
        await client.query(
          `update public.tournament_team_entries
           set status = $2, archived_at = null where id = $1`,
          [scope.own_entry_id, original.status],
        );
      }
    });

    await t.test('`archived` cierra la inscripción para todos, también para la organización', async () => {
      // Dos gates distintos y a propósito, sobre la MISMA fuente de verdad:
      //
      //   * `entry.status NOT IN ('rejected', 'withdrawn')` limita sólo la rama
      //     de autogestión. Con la inscripción retirada la organización sigue
      //     pudiendo gestionar y moderar: conserva el alcance que ya tenía.
      //   * `entry.status <> 'archived'` está en el WHERE exterior, antes de
      //     abrir las ramas, así que también corta la de organización. Por eso
      //     `archived` no necesita figurar en la lista de la rama: ya quedó
      //     afuera arriba, en el predicado de gestión y en el de moderación.
      await setPolicy(client, scope.tournament_id, 'roster');
      const original = await one(client,
        'select status, archived_at from public.tournament_team_entries where id = $1',
        [scope.own_entry_id]);
      const verdicts = async (actorId) => asActor(client, actorId, () => one(client, `
        select public.can_manage_tournament_team_visual_assets_as($1, $2, $3, 'team_entries.update') as manage_shield,
               public.can_manage_tournament_team_visual_assets_as($1, $2, $3, 'roster_players.update') as manage_portrait,
               public.can_moderate_tournament_team_visual_assets_as($1, $2, $3, 'roster_players.update') as moderate
      `, [scope.organization_id, scope.own_entry_id, actorId]));
      try {
        // `withdrawn`: cae la autogestión, la organización se mantiene.
        await client.query(
          `update public.tournament_team_entries
           set status = 'withdrawn', withdrawn_at = now(), archived_at = null where id = $1`,
          [scope.own_entry_id],
        );
        for (const [label, actorId] of [['delegate', actor.delegate], ['player', actor.player]]) {
          const row = await verdicts(actorId);
          assert.equal(row.manage_shield, false, `${label} escudo · withdrawn`);
          assert.equal(row.manage_portrait, false, `${label} retrato · withdrawn`);
          assert.equal(row.moderate, false, `${label} moderación · withdrawn`);
        }
        const staffWithdrawn = await verdicts(actor.owner);
        assert.equal(staffWithdrawn.manage_shield, true, 'organización escudo · withdrawn');
        assert.equal(staffWithdrawn.manage_portrait, true, 'organización retrato · withdrawn');
        assert.equal(staffWithdrawn.moderate, true, 'organización moderación · withdrawn');

        // `archived`: cae TODO, el override de organización incluido.
        await client.query(
          `update public.tournament_team_entries
           set status = 'archived', archived_at = now() where id = $1`,
          [scope.own_entry_id],
        );
        for (const [label, actorId] of [
          ['owner', actor.owner], ['admin', actor.admin],
          ['delegate', actor.delegate], ['player', actor.player],
        ]) {
          const row = await verdicts(actorId);
          assert.equal(row.manage_shield, false, `${label} escudo · archived`);
          assert.equal(row.manage_portrait, false, `${label} retrato · archived`);
          assert.equal(row.moderate, false, `${label} moderación · archived`);
        }
        // Y por las funciones de cara al producto, no sólo por el predicado.
        const staffArchived = await permissions({
          actorId: actor.owner, entryId: scope.own_entry_id, rosterPlayerId: ownPlayerId,
        });
        assert.equal(staffArchived.shield, false, 'escudo público · archived');
        assert.equal(staffArchived.portrait, false, 'retrato público · archived');
      } finally {
        await client.query(
          `update public.tournament_team_entries
           set status = $2, archived_at = $3, withdrawn_at = null where id = $1`,
          [scope.own_entry_id, original.status, original.archived_at],
        );
      }
    });

    await t.test('cambiar y deshabilitar la política no toca ninguna imagen', async () => {
      const snapshot = async () => (await client.query(`
        select id, object_path, lifecycle_status, editorial_status,
               publication_consent, focal_x, focal_y, crop_zoom
        from public.tournament_player_portraits order by id
      `)).rows;
      const shields = async () => (await client.query(`
        select id, shield_path from public.tournament_team_entries order by id
      `)).rows;

      const portraitsBefore = await snapshot();
      const shieldsBefore = await shields();
      assert.ok(portraitsBefore.length > 0, 'el dataset QA debería tener retratos');

      for (const policy of ['organization_only', 'delegates', 'roster', 'organization_only']) {
        await setPolicy(client, scope.tournament_id, policy);
        assert.deepEqual(await snapshot(), portraitsBefore, `retratos tras ${policy}`);
        assert.deepEqual(await shields(), shieldsBefore, `escudos tras ${policy}`);
      }

      // Y al volver a organization_only el permiso se retira, no se conserva.
      const granted = await permissions({
        actorId: actor.delegate,
        entryId: scope.own_entry_id,
        rosterPlayerId: ownPlayerId,
      });
      assert.equal(granted.shield, false);
      assert.equal(granted.portrait, false);
    });

    await t.test('el cambio de política se audita por el mecanismo existente', async () => {
      await setPolicy(client, scope.tournament_id, 'organization_only');
      await client.query('begin');
      try {
        await client.query(
          "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
          [actor.owner],
        );
        const result = await one(client, `
          select public.set_tournament_team_visual_policy($1, $2, 'delegates') as payload
        `, [scope.organization_id, scope.tournament_id]);
        assert.equal(result.payload.previousPolicy, 'organization_only');
        assert.equal(result.payload.policy, 'delegates');

        const entry = await one(client, `
          select actor_user_id, action, tournament_id, metadata, created_at
          from public.tournament_audit_log
          where action = 'tournament.team_visual_policy_updated'
          order by created_at desc limit 1
        `);
        assert.equal(entry.actor_user_id, actor.owner);
        assert.equal(entry.tournament_id, scope.tournament_id);
        assert.equal(entry.metadata.previousPolicy, 'organization_only');
        assert.equal(entry.metadata.policy, 'delegates');
        assert.ok(entry.created_at instanceof Date);
      } finally {
        await client.query('rollback');
      }
    });

    await t.test('sin tournaments.update la política no se cambia', async () => {
      await setPolicy(client, scope.tournament_id, 'organization_only');
      for (const [label, actorId] of [
        ['collaborator', actor.collaborator],
        ['delegate', actor.delegate],
        ['outsider', actor.outsider],
      ]) {
        await assert.rejects(
          () => asActor(client, actorId, () => client.query(
            "select public.set_tournament_team_visual_policy($1, $2, 'roster')",
            [scope.organization_id, scope.tournament_id],
          )),
          /TORNEOS_VISUAL_POLICY_FORBIDDEN/,
          label,
        );
      }
      await assert.rejects(
        () => asActor(client, actor.owner, () => client.query(
          "select public.set_tournament_team_visual_policy($1, $2, 'everyone')",
          [scope.organization_id, scope.tournament_id],
        )),
        /TORNEOS_VISUAL_POLICY_INVALID/,
        'valor fuera del contrato',
      );
      const current = await one(client,
        'select team_visual_management_policy as policy from public.tournaments where id = $1',
        [scope.tournament_id]);
      assert.equal(current.policy, 'organization_only');
    });

    await t.test('el plantel llega a la misma pantalla, sin datos que no son suyos', async () => {
      await setPolicy(client, scope.tournament_id, 'roster');
      const asPlayer = await asActor(client, actor.player, () => one(client, `
        select public.get_team_registration_context($1, $2) as payload
      `, [scope.organization_id, scope.own_entry_id]));
      assert.equal(asPlayer.payload.visualAssets.policy, 'roster');
      assert.equal(asPlayer.payload.visualAssets.canManageShield, true);
      assert.equal(asPlayer.payload.visualAssets.canManagePortraits, true);
      assert.ok(asPlayer.payload.roster.players.length > 0);
      assert.deepEqual(asPlayer.payload.reviews, []);
      assert.deepEqual(asPlayer.payload.audit, []);
      assert.deepEqual(asPlayer.payload.managers, []);
      // Y lo dice, en vez de dejar que la pantalla lea el vacío como un hecho.
      assert.equal(asPlayer.payload.viewer.scope, 'visual');

      const asStaff = await asActor(client, actor.owner, () => one(client, `
        select public.get_team_registration_context($1, $2) as payload
      `, [scope.organization_id, scope.own_entry_id]));
      assert.ok(asStaff.payload.managers.length > 0, 'la organización sí ve responsables');
      assert.equal(asStaff.payload.visualAssets.canManageShield, true);
      assert.equal(asStaff.payload.viewer.scope, 'full');

      await setPolicy(client, scope.tournament_id, 'organization_only');
      await assert.rejects(
        () => asActor(client, actor.player, () => client.query(
          'select public.get_team_registration_context($1, $2)',
          [scope.organization_id, scope.own_entry_id],
        )),
        /TORNEOS_RESOURCE_FORBIDDEN/,
        'al deshabilitar, el jugador pierde la puerta',
      );
      await assert.rejects(
        () => asActor(client, actor.outsider, () => client.query(
          'select public.list_tournament_player_portrait_refs($1, $2)',
          [scope.organization_id, scope.own_entry_id],
        )),
        /TORNEOS_PORTRAIT_FORBIDDEN/,
        'outsider',
      );
    });
  } finally {
    await client.query(
      'update public.tournaments set team_visual_management_policy = $2 where id = $1',
      [
        (await one(client, "select id from public.tournaments where name = 'Torneo Apertura QA 2026'")).id,
        'organization_only',
      ],
    ).catch(() => {});
    await client.end();
  }
});
