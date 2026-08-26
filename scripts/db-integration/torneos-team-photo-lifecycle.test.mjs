// Foto del equipo: permisos y ciclo de vida (Multimedia 1C.3B).
//
// Corre contra el Supabase LOCAL con el dataset QA de Torneos ya sembrado. No
// crea usuarios ni equipos: usa las identidades QA existentes, que ya cubren las
// clases de actor que el producto necesita distinguir. Todo lo que escribe vive
// dentro de una transacción que se revierte, así que el dataset queda intacto.
//
//   TORNEOS_TEAM_PHOTO_LOCAL_TEST=true SUPABASE_DB_URL=... npm run test:db:torneos:team-photo
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import process from 'node:process';
import test from 'node:test';

import pg from 'pg';

const enabled = process.env.TORNEOS_TEAM_PHOTO_LOCAL_TEST === 'true';
const databaseUrl = process.env.SUPABASE_DB_URL || '';
const loopback = new Set(['127.0.0.1', 'localhost', '::1']);

const POLICIES = ['organization_only', 'delegates', 'roster'];
const FOREIGN_ORGANIZATION = '00000000-0000-4000-8000-000000000001';
const CAPABILITY = 'team_entries.update';

function assertLocal(raw) {
  const parsed = new URL(raw);
  assert.ok(['postgres:', 'postgresql:'].includes(parsed.protocol));
  assert.ok(loopback.has(parsed.hostname), 'este test sólo corre contra LOCAL');
}

const checksum = (seed) => crypto.createHash('sha256').update(String(seed)).digest('hex');

async function one(client, sql, params = []) {
  const { rows } = await client.query(sql, params);
  return rows[0];
}

/** Evalúa en nombre de un actor dentro de una transacción que se revierte. */
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
 * Un error de PostgreSQL aborta la transacción entera, así que un rechazo
 * esperado en un test que después sigue trabajando tiene que correr sobre un
 * savepoint. Sin esto el segundo rechazo del mismo test «pasa» por el motivo
 * equivocado —`current transaction is aborted`— y deja de probar lo que dice.
 */
let savepointSeq = 0;
async function expectRejection(client, sql, params, pattern, label) {
  savepointSeq += 1;
  const name = `sp_${savepointSeq}`;
  await client.query(`savepoint ${name}`);
  let failure = null;
  try {
    await client.query(sql, params);
  } catch (error) {
    failure = error;
  }
  await client.query(`rollback to savepoint ${name}`);
  await client.query(`release savepoint ${name}`);
  assert.ok(failure, `${label}: se esperaba un rechazo y la operación fue aceptada`);
  assert.match(String(failure.message), pattern, label);
}

async function asActorWith(client, actorId, mutations, run) {
  return asActor(client, actorId, async () => {
    for (const [sql, params] of mutations) await client.query(sql, params);
    return run();
  });
}

test('la foto del equipo respeta el contrato visual y no reemplaza a la vigente sin moderación', {
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
      'select email, id from auth.users where email = any($1::text[])',
      [[
        'qa-owner@localhost.invalid', 'qa-admin@localhost.invalid',
        'qa-collaborator@localhost.invalid', 'qa-delegate@localhost.invalid',
        'qa-player@localhost.invalid', 'qa-outsider@localhost.invalid',
      ]],
    )).rows;
    const actor = Object.fromEntries(actorRows.map((row) => [
      row.email.replace('@localhost.invalid', '').replace(/^qa-/, ''), row.id,
    ]));
    for (const key of ['owner', 'admin', 'collaborator', 'delegate', 'player', 'outsider']) {
      assert.ok(actor[key], `falta la identidad QA ${key}`);
    }

    const setPolicy = (policy) => client.query(
      'update public.tournaments set team_visual_management_policy = $2 where id = $1',
      [scope.tournament_id, policy],
    );

    /**
     * Los tests de ciclo de vida afirman «cuál es la vigente» y «cuál la
     * candidata», así que necesitan partir de un equipo sin fotos. El dataset
     * QA puede traerlas de una sesión de review, y borrarlas de verdad sería
     * romper el dataset: se jubilan DENTRO de la transacción que se revierte.
     */
    const clearSlots = (entryId) => client.query(`
      update public.tournament_team_photos
      set lifecycle_status = 'replaced', replaced_at = now(), replaced_by_id = null
      where team_entry_id = $1 and lifecycle_status = 'active'
    `, [entryId]);

    /** Sube una foto y la deja `active` + `pending_review`, como el Edge function. */
    const uploadSql = `
      select (public.request_tournament_team_photo_upload(
        $1, $2, $3, 'image/jpeg', 240000::bigint, 1600, 900
      ) ->> 'teamPhotoId')::uuid as id`;
    const finalizeSql = 'select public.finalize_tournament_team_photo_upload($1, $2, $3)';

    async function upload(actorId, entryId, seed = 'a') {
      const { id } = await one(client, uploadSql, [actorId, scope.organization_id, entryId]);
      await client.query(finalizeSql, [actorId, id, checksum(seed)]);
      return id;
    }

    const slots = (entryId) => one(client, `
      select
        (select id from public.tournament_team_photos
         where team_entry_id = $1 and lifecycle_status = 'active'
           and editorial_status = 'approved') as current_id,
        (select id from public.tournament_team_photos
         where team_entry_id = $1 and lifecycle_status = 'active'
           and editorial_status in ('pending_review', 'rejected')) as candidate_id
    `, [entryId]);

    // -----------------------------------------------------------------------
    // 18. Matriz de permisos
    // -----------------------------------------------------------------------

    async function capabilities({
      actorId, entryId, organizationId = scope.organization_id,
    }) {
      return asActor(client, actorId, async () => {
        const row = await one(client, `
          select public.can_manage_tournament_team_visual_assets_as($1, $2, $3, $4) as manage,
                 public.can_moderate_tournament_team_visual_assets_as($1, $2, $3, $4) as moderate,
                 public.can_read_tournament_team_photo_as($1, $2, $3) as read
        `, [organizationId, entryId, actorId, CAPABILITY]);
        return row;
      });
    }

    // actor → [organization_only, delegates, roster] para gestionar.
    const MATRIX = [
      ['OWNER', () => actor.owner, 'own', [true, true, true], true],
      ['ADMIN', () => actor.admin, 'own', [true, true, true], true],
      // COLLABORATOR es de sólo lectura en el modelo real: tiene
      // `team_entries.read` y no tiene `team_entries.update`. Ve la foto
      // vigente y no puede tocar nada.
      ['COLLABORATOR', () => actor.collaborator, 'own', [false, false, false], false],
      ['DELEGATE OWN TEAM', () => actor.delegate, 'own', [false, true, true], false],
      ['DELEGATE OTHER TEAM', () => actor.delegate, 'other', [false, false, false], false],
      ['ROSTER MEMBER OWN TEAM', () => actor.player, 'own', [false, false, true], false],
      ['ROSTER MEMBER OTHER TEAM', () => actor.player, 'other', [false, false, false], false],
      ['OUTSIDER', () => actor.outsider, 'own', [false, false, false], false],
    ];

    for (const [label, resolve, target, expectedManage, expectedModerate] of MATRIX) {
      await t.test(`PERMISOS · ${label}`, async () => {
        const entryId = target === 'own' ? scope.own_entry_id : scope.other_entry_id;
        for (const [index, policy] of POLICIES.entries()) {
          await setPolicy(policy);
          const granted = await capabilities({ actorId: resolve(), entryId });
          assert.equal(granted.manage, expectedManage[index], `gestionar · ${policy}`);
          // Moderar NUNCA depende de la política: es la rama de organización sola.
          assert.equal(granted.moderate, expectedModerate, `moderar · ${policy}`);
        }
      });
    }

    await t.test('PERMISOS · COLLABORATOR ve la foto vigente aunque no pueda tocarla', async () => {
      await setPolicy('organization_only');
      const granted = await capabilities({
        actorId: actor.collaborator, entryId: scope.own_entry_id,
      });
      assert.equal(granted.read, true);
      assert.equal(granted.manage, false);
      assert.equal(granted.moderate, false);
    });

    await t.test('PERMISOS · OUTSIDER no ve ni la foto vigente', async () => {
      await setPolicy('roster');
      const granted = await capabilities({
        actorId: actor.outsider, entryId: scope.own_entry_id,
      });
      assert.equal(granted.read, false);
    });

    await t.test('PERMISOS · CROSS TENANT: el organization_id no es negociable', async () => {
      for (const policy of POLICIES) {
        await setPolicy(policy);
        for (const actorId of [actor.owner, actor.delegate, actor.player]) {
          const granted = await capabilities({
            actorId, entryId: scope.own_entry_id, organizationId: FOREIGN_ORGANIZATION,
          });
          assert.equal(granted.manage, false, `gestionar · ${policy}`);
          assert.equal(granted.moderate, false, `moderar · ${policy}`);
          assert.equal(granted.read, false, `leer · ${policy}`);
        }
      }
    });

    await t.test('PERMISOS · un jugador de un plantel histórico deja de gestionar', async () => {
      await setPolicy('roster');
      const row = await asActorWith(client, actor.player, [[
        `update public.tournament_rosters set status = 'superseded',
           submitted_at = coalesce(submitted_at, now()),
           approved_at = coalesce(approved_at, now())
         where team_entry_id = $1`,
        [scope.own_entry_id],
      ]], () => one(client, `
        select public.can_manage_tournament_team_visual_assets_as($1, $2, $3, $4) as manage
      `, [scope.organization_id, scope.own_entry_id, actor.player, CAPABILITY]));
      assert.equal(row.manage, false);
    });

    await t.test('PERMISOS · un jugador removido deja de gestionar', async () => {
      await setPolicy('roster');
      const row = await asActorWith(client, actor.player, [[
        `update public.tournament_roster_players set status = 'removed', removed_at = now()
         where team_entry_id = $1 and arma2_user_id = $2`,
        [scope.own_entry_id, actor.player],
      ]], () => one(client, `
        select public.can_manage_tournament_team_visual_assets_as($1, $2, $3, $4) as manage
      `, [scope.organization_id, scope.own_entry_id, actor.player, CAPABILITY]));
      assert.equal(row.manage, false);
    });

    await t.test('PERMISOS · una inscripción archivada es inmutable incluso para la organización', async () => {
      await setPolicy('roster');
      const archived = [[
        `update public.tournament_team_entries
         set status = 'archived', archived_at = now()
         where id = $1`,
        [scope.own_entry_id],
      ]];
      for (const [label, actorId] of [
        ['owner', actor.owner], ['delegate', actor.delegate], ['player', actor.player],
      ]) {
        const row = await asActorWith(client, actorId, archived, () => one(client, `
          select public.can_manage_tournament_team_visual_assets_as($1, $2, $3, $4) as manage,
                 public.can_moderate_tournament_team_visual_assets_as($1, $2, $3, $4) as moderate,
                 public.can_read_tournament_team_photo_as($1, $2, $3) as read
        `, [scope.organization_id, scope.own_entry_id, actorId, CAPABILITY]));
        assert.equal(row.manage, false, `gestionar · ${label}`);
        assert.equal(row.moderate, false, `moderar · ${label}`);
        assert.equal(row.read, false, `leer · ${label}`);
      }
    });

    await t.test('PERMISOS · los helpers con actor explícito no son ejecutables por authenticated', async () => {
      const grants = await client.query(`
        select proname,
               has_function_privilege('authenticated', oid, 'execute') as authenticated,
               has_function_privilege('anon', oid, 'execute') as anon
        from pg_proc
        where proname in (
          'can_read_tournament_team_photo_as',
          'request_tournament_team_photo_upload',
          'finalize_tournament_team_photo_upload',
          'fail_tournament_team_photo_upload',
          'authorize_tournament_team_photo_read',
          'begin_tournament_team_photo_delete',
          'complete_tournament_team_photo_delete'
        )
      `);
      assert.equal(grants.rows.length, 7);
      for (const row of grants.rows) {
        assert.equal(row.authenticated, false, `${row.proname} · authenticated`);
        assert.equal(row.anon, false, `${row.proname} · anon`);
      }
    });

    await t.test('PERMISOS · la tabla no acepta escrituras directas del cliente', async () => {
      const table = await one(client, `
        select
          has_table_privilege('authenticated', 'public.tournament_team_photos', 'INSERT') as ins,
          has_table_privilege('authenticated', 'public.tournament_team_photos', 'UPDATE') as upd,
          has_table_privilege('authenticated', 'public.tournament_team_photos', 'DELETE') as del,
          has_column_privilege('authenticated', 'public.tournament_team_photos', 'object_path', 'SELECT') as path
      `);
      assert.equal(table.ins, false);
      assert.equal(table.upd, false);
      assert.equal(table.del, false);
      // El path del objeto nunca se le entrega al navegador.
      assert.equal(table.path, false);
    });

    // -----------------------------------------------------------------------
    // 19. Ciclo de vida
    // -----------------------------------------------------------------------

    await t.test('CICLO · subir crea una candidata y deja la vigente donde estaba', async () => {
      await setPolicy('delegates');
      await asActor(client, actor.owner, async () => {
        await clearSlots(scope.own_entry_id);
        const first = await upload(actor.owner, scope.own_entry_id, 'first');
        await client.query(
          "select public.set_tournament_team_photo_editorial_status($1, $2, 'approved')",
          [scope.organization_id, first],
        );
        assert.deepEqual(await slots(scope.own_entry_id), {
          current_id: first, candidate_id: null,
        });

        const second = await upload(actor.owner, scope.own_entry_id, 'second');
        const after = await slots(scope.own_entry_id);
        assert.equal(after.current_id, first, 'la vigente no se movió');
        assert.equal(after.candidate_id, second, 'la nueva quedó como candidata');
      });
    });

    await t.test('CICLO · aprobar promueve la candidata y jubila la anterior, atómicamente', async () => {
      await setPolicy('delegates');
      await asActor(client, actor.owner, async () => {
        const first = await upload(actor.owner, scope.own_entry_id, 'first');
        await client.query(
          "select public.set_tournament_team_photo_editorial_status($1, $2, 'approved')",
          [scope.organization_id, first],
        );
        const second = await upload(actor.owner, scope.own_entry_id, 'second');
        await client.query(
          "select public.set_tournament_team_photo_editorial_status($1, $2, 'approved')",
          [scope.organization_id, second],
        );
        assert.deepEqual(await slots(scope.own_entry_id), {
          current_id: second, candidate_id: null,
        });
        const retired = await one(client,
          'select lifecycle_status, replaced_by_id from public.tournament_team_photos where id = $1',
          [first]);
        assert.equal(retired.lifecycle_status, 'replaced');
        assert.equal(retired.replaced_by_id, second, 'la jubilación apunta a quien la reemplazó');
      });
    });

    await t.test('CICLO · rechazar conserva la vigente y guarda el motivo', async () => {
      await setPolicy('delegates');
      await asActor(client, actor.owner, async () => {
        await clearSlots(scope.own_entry_id);
        const first = await upload(actor.owner, scope.own_entry_id, 'first');
        await client.query(
          "select public.set_tournament_team_photo_editorial_status($1, $2, 'approved')",
          [scope.organization_id, first],
        );
        const second = await upload(actor.owner, scope.own_entry_id, 'second');
        await client.query(
          "select public.set_tournament_team_photo_editorial_status($1, $2, 'rejected', $3)",
          [scope.organization_id, second, 'No se ve el plantel completo.'],
        );
        const after = await slots(scope.own_entry_id);
        assert.equal(after.current_id, first, 'la vigente sobrevive al rechazo');
        assert.equal(after.candidate_id, second);
        const rejected = await one(client,
          'select editorial_status, review_reason, approved_at from public.tournament_team_photos where id = $1',
          [second]);
        assert.equal(rejected.editorial_status, 'rejected');
        assert.equal(rejected.review_reason, 'No se ve el plantel completo.');
        assert.equal(rejected.approved_at, null);
      });
    });

    await t.test('CICLO · retirar la vigente cae al fallback y no resucita ninguna anterior', async () => {
      await setPolicy('delegates');
      await asActor(client, actor.owner, async () => {
        await clearSlots(scope.own_entry_id);
        const first = await upload(actor.owner, scope.own_entry_id, 'first');
        await client.query(
          "select public.set_tournament_team_photo_editorial_status($1, $2, 'approved')",
          [scope.organization_id, first],
        );
        const second = await upload(actor.owner, scope.own_entry_id, 'second');
        await client.query(
          "select public.set_tournament_team_photo_editorial_status($1, $2, 'approved')",
          [scope.organization_id, second],
        );
        await client.query('select public.revoke_tournament_team_photo($1, $2)',
          [scope.organization_id, second]);
        const after = await slots(scope.own_entry_id);
        assert.equal(after.current_id, null, 'el equipo queda sin foto vigente');
        const revoked = await one(client, `
          select lifecycle_status, replaced_by_id, revoked_at, revoked_by
          from public.tournament_team_photos where id = $1`, [second]);
        assert.equal(revoked.lifecycle_status, 'replaced');
        assert.equal(revoked.replaced_by_id, null, 'nada ocupó su lugar');
        assert.ok(revoked.revoked_at);
        assert.equal(revoked.revoked_by, actor.owner);
        // Y la primera sigue jubilada: no hay restauración histórica.
        const older = await one(client,
          'select lifecycle_status from public.tournament_team_photos where id = $1', [first]);
        assert.equal(older.lifecycle_status, 'replaced');
      });
    });

    await t.test('CICLO · una carga fallida nunca se vuelve visible', async () => {
      await setPolicy('delegates');
      await asActor(client, actor.owner, async () => {
        await clearSlots(scope.own_entry_id);
        const { id } = await one(client, uploadSql,
          [actor.owner, scope.organization_id, scope.own_entry_id]);
        await client.query('select public.fail_tournament_team_photo_upload($1, $2)',
          [actor.owner, id]);
        const failed = await one(client,
          'select lifecycle_status, checksum_sha256 from public.tournament_team_photos where id = $1',
          [id]);
        assert.equal(failed.lifecycle_status, 'upload_failed');
        assert.equal(failed.checksum_sha256, null);
        assert.deepEqual(await slots(scope.own_entry_id), {
          current_id: null, candidate_id: null,
        });
        // Y no se puede firmar.
        await expectRejection(
          client,
          `select public.authorize_tournament_team_photo_read(
            $1, $2, 'original', 'authenticated_team')`,
          [actor.owner, id],
          /TORNEOS_TEAM_PHOTO_FORBIDDEN/,
          'carga fallida · firma',
        );
      });
    });

    await t.test('CICLO · sin checksum del servidor la fila no se puede activar', async () => {
      await setPolicy('delegates');
      await asActor(client, actor.owner, async () => {
        await clearSlots(scope.own_entry_id);
        const { id } = await one(client, uploadSql,
          [actor.owner, scope.organization_id, scope.own_entry_id]);
        for (const bad of [null, '', 'no-es-un-sha', checksum('x').slice(0, 63)]) {
          await expectRejection(
            client, finalizeSql, [actor.owner, id, bad],
            /TORNEOS_TEAM_PHOTO_CHECKSUM_INVALID/,
            `checksum ${JSON.stringify(bad)}`,
          );
        }
      });
    });

    await t.test('CICLO · un estado desconocido no existe: los CHECK lo impiden', async () => {
      await asActor(client, actor.owner, async () => {
        await clearSlots(scope.own_entry_id);
        const id = await upload(actor.owner, scope.own_entry_id, 'unknown');
        for (const [column, value] of [
          ['editorial_status', 'quizas'],
          ['lifecycle_status', 'publicada'],
        ]) {
          await expectRejection(
            client,
            `update public.tournament_team_photos set ${column} = $2 where id = $1`,
            [id, value],
            /violates check constraint/,
            column,
          );
        }
      });
    });

    await t.test('CICLO · dos vigentes a la vez son imposibles', async () => {
      await asActor(client, actor.owner, async () => {
        await clearSlots(scope.own_entry_id);
        const first = await upload(actor.owner, scope.own_entry_id, 'first');
        await client.query(
          "select public.set_tournament_team_photo_editorial_status($1, $2, 'approved')",
          [scope.organization_id, first],
        );
        const second = await upload(actor.owner, scope.own_entry_id, 'second');
        await expectRejection(
          client,
          `update public.tournament_team_photos
             set editorial_status = 'approved', reviewed_by = $2, reviewed_at = now(),
                 approved_at = now()
             where id = $1`,
          [second, actor.owner],
          /tournament_team_photos_one_current_idx/,
          'dos vigentes',
        );
      });
    });

    // -----------------------------------------------------------------------
    // Moderar no es gestionar
    // -----------------------------------------------------------------------

    await t.test('MODERACIÓN · subir la foto nunca habilita a aprobarla', async () => {
      await setPolicy('roster');
      for (const [label, actorId] of [
        ['delegate', actor.delegate], ['player', actor.player],
      ]) {
        // Sube su propia foto: eso sí lo puede hacer.
        const photoId = await asActor(client, actorId, async () => {
          await clearSlots(scope.own_entry_id);
          const id = await upload(actorId, scope.own_entry_id, label);
          const row = await one(client,
            'select editorial_status from public.tournament_team_photos where id = $1', [id]);
          assert.equal(row.editorial_status, 'pending_review', `${label} · sube`);
          // Y no la puede aprobar ni rechazar ni retirar.
          for (const [action, sql] of [
            ['aprobar', "select public.set_tournament_team_photo_editorial_status($1, $2, 'approved')"],
            ['rechazar', "select public.set_tournament_team_photo_editorial_status($1, $2, 'rejected')"],
          ]) {
            await expectRejection(
              client, sql, [scope.organization_id, id],
              /TORNEOS_TEAM_PHOTO_FORBIDDEN/,
              `${label} · ${action}`,
            );
          }
          return id;
        });
        assert.ok(photoId);
      }
    });

    await t.test('MODERACIÓN · nadie sube ni modera la foto de un equipo ajeno', async () => {
      await setPolicy('roster');
      for (const [label, actorId] of [
        ['delegate', actor.delegate], ['player', actor.player],
        ['outsider', actor.outsider], ['collaborator', actor.collaborator],
      ]) {
        await assert.rejects(
          () => asActor(client, actorId, () => client.query(uploadSql,
            [actorId, scope.organization_id, scope.other_entry_id])),
          /TORNEOS_TEAM_PHOTO_FORBIDDEN/,
          `${label} · equipo ajeno`,
        );
      }
    });

    await t.test('MODERACIÓN · sin audiencia habilitada no se firma nada', async () => {
      await asActor(client, actor.owner, async () => {
        await clearSlots(scope.own_entry_id);
        const id = await upload(actor.owner, scope.own_entry_id, 'audience');
        for (const [variant, audience] of [
          ['original', 'public_page'],
          ['original', 'social_export'],
          ['social', 'authenticated_team'],
          ['thumbnail', 'authenticated_team'],
        ]) {
          await expectRejection(
            client,
            'select public.authorize_tournament_team_photo_read($1, $2, $3, $4)',
            [actor.owner, id, variant, audience],
            /TORNEOS_TEAM_PHOTO_AUDIENCE_DISABLED/,
            `${variant} · ${audience}`,
          );
        }
      });
    });

    await t.test('MODERACIÓN · la candidata sólo se le firma a quien gestiona o modera', async () => {
      await setPolicy('organization_only');
      await asActor(client, actor.owner, async () => {
        await clearSlots(scope.own_entry_id);
        const id = await upload(actor.owner, scope.own_entry_id, 'pending');
        // El colaborador ve la inscripción y NO ve material sin moderar.
        await expectRejection(
          client,
          `select public.authorize_tournament_team_photo_read(
            $1, $2, 'original', 'authenticated_team')`,
          [actor.collaborator, id],
          /TORNEOS_TEAM_PHOTO_FORBIDDEN/,
          'colaborador · candidata',
        );
        // Una vez aprobada sí, porque ya es la foto del equipo.
        await client.query(
          "select public.set_tournament_team_photo_editorial_status($1, $2, 'approved')",
          [scope.organization_id, id],
        );
        const grant = await one(client, `select public.authorize_tournament_team_photo_read(
          $1, $2, 'original', 'authenticated_team') as grant`, [actor.collaborator, id]);
        assert.equal(grant.grant.audience, 'authenticated_team');
        assert.match(grant.grant.objectPath, /^organizations\/[0-9a-f-]{36}\/team-entries\//);
      });
    });

    // -----------------------------------------------------------------------
    // 17. Auditoría
    // -----------------------------------------------------------------------

    await t.test('AUDITORÍA · cada paso deja rastro y el log sigue siendo append-only', async () => {
      await setPolicy('delegates');
      await asActor(client, actor.owner, async () => {
        await clearSlots(scope.own_entry_id);
        // El equipo puede traer historia real de una sesión de review: lo que
        // se afirma es lo que ESTE test escribe, no el contenido del log.
        const { since } = await one(client, `
          select coalesce(max(id), 0) as since from public.tournament_audit_log
          where resource_type = 'team_photo' and team_entry_id = $1
        `, [scope.own_entry_id]);

        const first = await upload(actor.owner, scope.own_entry_id, 'first');
        await client.query(
          "select public.set_tournament_team_photo_editorial_status($1, $2, 'approved')",
          [scope.organization_id, first],
        );
        const second = await upload(actor.owner, scope.own_entry_id, 'second');
        await client.query(
          "select public.set_tournament_team_photo_editorial_status($1, $2, 'rejected', 'muy oscura')",
          [scope.organization_id, second],
        );
        await client.query('select public.revoke_tournament_team_photo($1, $2)',
          [scope.organization_id, first]);

        const actions = (await client.query(`
          select action from public.tournament_audit_log
          where resource_type = 'team_photo' and team_entry_id = $1 and id > $2
          order by id
        `, [scope.own_entry_id, since])).rows.map((row) => row.action);
        assert.deepEqual(actions, [
          'team_photo.uploaded', 'team_photo.approved',
          'team_photo.uploaded', 'team_photo.rejected', 'team_photo.revoked',
        ]);

        const entry = await one(client, `
          select actor_user_id, metadata from public.tournament_audit_log
          where resource_type = 'team_photo' and action = 'team_photo.rejected'
          order by id desc limit 1
        `);
        assert.equal(entry.actor_user_id, actor.owner);
        assert.equal(entry.metadata.reviewReason, 'muy oscura');

        // El trigger append-only sigue en pie.
        for (const sql of [
          "update public.tournament_audit_log set action = 'x' where resource_type = 'team_photo'",
          "delete from public.tournament_audit_log where resource_type = 'team_photo'",
        ]) {
          await expectRejection(client, sql, [], /TORNEOS_AUDIT_APPEND_ONLY/, sql);
        }
      });
    });

    // El dataset queda como estaba: la política es lo único que se tocó fuera
    // de transacción.
    await setPolicy(scope.original_policy);
  } finally {
    await client.end();
  }
});
