import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import test from 'node:test';

import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const enabled = process.env.TOURNAMENT_PLAYER_PORTRAITS_LOCAL_TEST === 'true';
const apiUrl = process.env.SUPABASE_URL || '';
const databaseUrl = process.env.SUPABASE_DB_URL || '';
const anonKey = process.env.SUPABASE_ANON_KEY || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const bucket = 'tournament-player-portraits';
const functionUrl = `${apiUrl}/functions/v1/tournament-player-portraits`;
const loopback = new Set(['127.0.0.1', 'localhost', '::1']);

function assertLocal(raw, protocols) {
  const parsed = new URL(raw);
  assert.ok(protocols.includes(parsed.protocol));
  assert.ok(loopback.has(parsed.hostname));
}

async function authenticatedClient(admin, email) {
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  assert.ifError(link.error);
  const client = createClient(apiUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const verified = await client.auth.verifyOtp({
    type: 'magiclink', token_hash: link.data.properties.hashed_token,
  });
  assert.ifError(verified.error);
  return client;
}

async function invoke(client, { action, body, bytes, mime = 'image/png', width = 1, height = 1 }) {
  const session = await client.auth.getSession();
  assert.ifError(session.error);
  const token = session.data.session?.access_token;
  assert.ok(token);
  const isUpload = action === 'upload';
  const url = isUpload
    ? `${functionUrl}?action=upload&organizationId=${body.organizationId}&rosterPlayerId=${body.rosterPlayerId}`
    : functionUrl;
  const response = await fetch(url, {
    method: isUpload ? 'PUT' : 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': isUpload ? mime : 'application/json',
      ...(isUpload ? { 'x-image-width': String(width), 'x-image-height': String(height) } : {}),
    },
    body: isUpload ? bytes : JSON.stringify({ action, ...body }),
  });
  return { status: response.status, payload: await response.json() };
}

test('player portraits enforce DB, tenant, private resolver and Storage lifecycle', {
  skip: !enabled,
  timeout: 120_000,
}, async () => {
  assertLocal(apiUrl, ['http:', 'https:']);
  assertLocal(databaseUrl, ['postgres:', 'postgresql:']);
  assert.ok(anonKey && serviceKey);
  const database = new pg.Client({ connectionString: databaseUrl });
  const service = createClient(apiUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await database.connect();
  const objectPaths = new Set();
  const originalPortraitIds = new Set();
  let rosterPlayerId = null;
  let originalVisualPolicy = null;
  let visualPolicyTournamentId = null;
  /** Cambia la política del torneo QA; el `finally` restituye el valor previo. */
  const setVisualPolicy = async (policy) => {
    await database.query(
      'update public.tournaments set team_visual_management_policy = $2 where id = $1',
      [visualPolicyTournamentId, policy],
    );
  };
  try {
    const { rows } = await database.query(
      `select organization.id as organization_id,
              bno.id as bno_team_id,
              hor.id as hor_team_id,
              bno_provisional.id as bno_provisional_id,
              bno_player.id as bno_player_id,
              hor_player.id as hor_player_id,
              owner.email as owner_email,
              admin.email as admin_email,
              delegate.email as delegate_email,
              player.email as player_email,
              collaborator.email as collaborator_email,
              outsider.email as outsider_email
       from public.tournament_organizations organization
       join public.tournament_team_entries bno
         on bno.organization_id = organization.id and bno.short_name = 'BNO'
       join public.tournament_team_entries hor
         on hor.organization_id = organization.id and hor.short_name = 'HOR'
       join lateral (
         select roster_player.id from public.tournament_roster_players roster_player
         where roster_player.team_entry_id = bno.id
           and roster_player.provisional_player_id is not null limit 1
       ) bno_provisional on true
       join lateral (
         select roster_player.id from public.tournament_roster_players roster_player
         where roster_player.team_entry_id = bno.id
           and roster_player.arma2_user_id is not null limit 1
       ) bno_player on true
       join lateral (
         select roster_player.id from public.tournament_roster_players roster_player
         where roster_player.team_entry_id = hor.id limit 1
       ) hor_player on true
       join auth.users owner on owner.raw_app_meta_data->>'qa_role' = 'owner'
       join auth.users admin on admin.raw_app_meta_data->>'qa_role' = 'admin'
       join auth.users delegate on delegate.raw_app_meta_data->>'qa_role' = 'delegate'
       join auth.users player on player.raw_app_meta_data->>'qa_role' = 'player'
       join auth.users collaborator on collaborator.raw_app_meta_data->>'qa_role' = 'collaborator'
       join auth.users outsider on outsider.raw_app_meta_data->>'qa_role' = 'outsider'
       limit 1`,
    );
    assert.equal(rows.length, 1, 'Canonical V4 QA data is required.');
    const qa = rows[0];
    rosterPlayerId = qa.bno_provisional_id;
    const visualPolicy = await database.query(
      `select tournament.id, tournament.team_visual_management_policy as policy
       from public.tournaments tournament
       join public.tournament_team_entries entry
         on entry.tournament_id = tournament.id
       where entry.id = $1`,
      [qa.bno_team_id],
    );
    visualPolicyTournamentId = visualPolicy.rows[0].id;
    originalVisualPolicy = visualPolicy.rows[0].policy;
    const originalPortraits = await database.query(
      'select id from public.tournament_player_portraits where roster_player_id = $1',
      [rosterPlayerId],
    );
    for (const row of originalPortraits.rows) originalPortraitIds.add(row.id);
    const clients = Object.fromEntries(await Promise.all(
      ['owner', 'admin', 'delegate', 'player', 'collaborator', 'outsider'].map(async (role) => (
        [role, await authenticatedClient(service, qa[`${role}_email`])]
      )),
    ));
    const png = await readFile('scripts/edge-functions/fixtures/tournament-media/probe-1x1.png');

    const beforeVersioning = await database.query(
      `select count(*)::integer as rows,
              count(*) filter (where lifecycle_status = 'active')::integer as active,
              count(*) filter (where lifecycle_status = 'replaced')::integer as replaced
       from public.tournament_player_portraits where roster_player_id = $1`,
      [qa.bno_provisional_id],
    );

    // Desde 1C.3A el acceso del delegado al retrato lo concede la política de
    // autogestión del torneo, no su rol: con el valor cerrado —el default— el
    // capitán/delegado no gestiona nada, y la organización sí. Se mide la misma
    // pregunta en los dos valores, contra la RPC real y no contra el rol.
    const readPermissions = async () => Object.fromEntries(
      await Promise.all(Object.entries(clients).map(async ([role, client]) => {
        const response = await client.rpc('can_manage_tournament_player_portrait', {
          p_organization_id: qa.organization_id,
          p_roster_player_id: qa.bno_provisional_id,
        });
        assert.ifError(response.error);
        return [role, response.data];
      })),
    );

    await setVisualPolicy('organization_only');
    assert.deepEqual(await readPermissions(), {
      owner: true, admin: true, delegate: false,
      player: false, collaborator: false, outsider: false,
    }, 'organization_only: la autogestión está cerrada');

    await setVisualPolicy('delegates');
    assert.deepEqual(await readPermissions(), {
      owner: true, admin: true, delegate: true,
      player: false, collaborator: false, outsider: false,
    }, 'delegates: se amplía al responsable del propio equipo');
    const spoofAttempt = await clients.outsider.rpc('can_manage_tournament_player_portrait_as', {
      p_organization_id: qa.organization_id,
      p_roster_player_id: qa.bno_provisional_id,
      p_actor_user_id: (await clients.owner.auth.getSession()).data.session.user.id,
    });
    assert.ok(spoofAttempt.error, 'Actor-parameter authorization helpers must be service-only.');

    for (const role of ['owner', 'admin', 'delegate']) {
      const uploaded = await invoke(clients[role], {
        action: 'upload', body: {
          organizationId: qa.organization_id, rosterPlayerId: qa.bno_provisional_id,
        }, bytes: png,
      });
      assert.equal(uploaded.status, 201, `${role}: ${JSON.stringify(uploaded.payload)}`);
      assert.equal(uploaded.payload.imageRef.kind, 'player_portrait');
      assert.equal(uploaded.payload.imageRef.variant, 'original');
      if (uploaded.payload.replacedPortraitId) {
        const previous = await database.query(
          'select object_path from public.tournament_player_portraits where id = $1',
          [uploaded.payload.replacedPortraitId],
        );
        objectPaths.add(previous.rows[0].object_path);
      }
      const current = await database.query(
        `select object_path from public.tournament_player_portraits
         where id = $1 and lifecycle_status = 'active'`,
        [uploaded.payload.imageRef.id],
      );
      objectPaths.add(current.rows[0].object_path);
    }

    const versioned = await database.query(
      `select count(*)::integer as rows, count(distinct object_path)::integer as paths,
              count(*) filter (where lifecycle_status = 'active')::integer as active,
              count(*) filter (where lifecycle_status = 'replaced')::integer as replaced
       from public.tournament_player_portraits where roster_player_id = $1`,
      [qa.bno_provisional_id],
    );
    assert.equal(versioned.rows[0].rows, beforeVersioning.rows[0].rows + 3);
    assert.equal(versioned.rows[0].paths, beforeVersioning.rows[0].rows + 3);
    assert.equal(versioned.rows[0].active, 1);
    assert.equal(
      versioned.rows[0].replaced,
      beforeVersioning.rows[0].replaced + beforeVersioning.rows[0].active + 2,
    );

    for (const role of ['player', 'outsider']) {
      const denied = await invoke(clients[role], {
        action: 'upload', body: {
          organizationId: qa.organization_id, rosterPlayerId: qa.bno_provisional_id,
        }, bytes: png,
      });
      assert.equal(denied.status, 403);
    }
    const foreignRoster = await invoke(clients.delegate, {
      action: 'upload', body: {
        organizationId: qa.organization_id, rosterPlayerId: qa.hor_player_id,
      }, bytes: png,
    });
    assert.equal(foreignRoster.status, 403);
    const crossTenant = await clients.owner.rpc('can_manage_tournament_player_portrait', {
      p_organization_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      p_roster_player_id: qa.bno_provisional_id,
    });
    assert.ifError(crossTenant.error);
    assert.equal(crossTenant.data, false);

    const invalidMime = await invoke(clients.owner, {
      action: 'upload', body: {
        organizationId: qa.organization_id, rosterPlayerId: qa.bno_player_id,
      }, bytes: png, mime: 'image/svg+xml',
    });
    assert.equal(invalidMime.status, 422);
    const ownerSession = await clients.owner.auth.getSession();
    const tooLarge = await service.rpc('request_tournament_player_portrait_upload', {
      p_actor_user_id: ownerSession.data.session.user.id,
      p_organization_id: qa.organization_id,
      p_roster_player_id: qa.bno_player_id,
      p_mime_type: 'image/png',
      p_byte_size: 8 * 1024 * 1024 + 1,
      p_width: 1,
      p_height: 1,
    });
    assert.ok(tooLarge.error);
    assert.match(tooLarge.error.message, /TORNEOS_PORTRAIT_FILE_INVALID/);
    const bucketLimit = await database.query(
      `select file_size_limit from storage.buckets where id = $1`, [bucket],
    );
    assert.equal(Number(bucketLimit.rows[0].file_size_limit), 8 * 1024 * 1024);

    const active = await database.query(
      `select id, object_path from public.tournament_player_portraits
       where roster_player_id = $1 and lifecycle_status = 'active'`,
      [qa.bno_provisional_id],
    );
    const ref = { kind: 'player_portrait', id: active.rows[0].id, variant: 'original' };
    const ownerMetadata = await clients.owner.from('tournament_player_portraits')
      .select('id,editorial_status,publication_consent,lifecycle_status')
      .eq('id', ref.id);
    assert.ifError(ownerMetadata.error);
    assert.equal(ownerMetadata.data.length, 1);
    const outsiderMetadata = await clients.outsider.from('tournament_player_portraits')
      .select('id,editorial_status').eq('id', ref.id);
    assert.ifError(outsiderMetadata.error);
    assert.deepEqual(outsiderMetadata.data, []);
    const leakedPath = await clients.owner.from('tournament_player_portraits')
      .select('id,object_path').eq('id', ref.id);
    assert.ok(leakedPath.error, 'Authenticated clients must not select internal object paths.');
    const directMetadataWrite = await clients.owner.from('tournament_player_portraits')
      .update({ focal_x: 0.1 }).eq('id', ref.id);
    assert.ok(directMetadataWrite.error, 'Portrait metadata writes are RPC-only.');
    const resolved = await invoke(clients.owner, {
      action: 'resolve', body: { ref, audience: 'authenticated_roster' },
    });
    assert.equal(resolved.status, 200, JSON.stringify(resolved.payload));
    assert.equal(resolved.payload.ttlSeconds, 300);
    assert.match(resolved.payload.url, /\/storage\/v1\/object\/sign\//);
    const signedFetch = await fetch(new URL(resolved.payload.url, apiUrl));
    assert.equal(signedFetch.status, 200);

    for (const audience of ['public_page', 'social_export']) {
      const disabled = await invoke(clients.owner, {
        action: 'resolve', body: { ref, audience },
      });
      assert.equal(disabled.status, 403);
      assert.equal(disabled.payload.error, 'audience_disabled');
    }
    const outsiderRead = await invoke(clients.outsider, {
      action: 'resolve', body: { ref, audience: 'authenticated_roster' },
    });
    assert.equal(outsiderRead.status, 403);

    const directUpload = await clients.owner.storage.from(bucket).upload(
      `organizations/${qa.organization_id}/roster-players/${qa.bno_player_id}/00000000-0000-4000-8000-000000000001.png`,
      png, { contentType: 'image/png', upsert: false },
    );
    assert.ok(directUpload.error);
    const publicUrl = service.storage.from(bucket).getPublicUrl(active.rows[0].object_path);
    const publicFetch = await fetch(publicUrl.data.publicUrl);
    assert.ok(publicFetch.status >= 400);

    const approved = await clients.owner.rpc('set_tournament_player_portrait_editorial_status', {
      p_organization_id: qa.organization_id,
      p_portrait_id: ref.id,
      p_editorial_status: 'approved',
    });
    assert.ifError(approved.error);
    const revoked = await clients.owner.rpc('revoke_tournament_player_portrait_publication', {
      p_organization_id: qa.organization_id, p_portrait_id: ref.id,
    });
    assert.ifError(revoked.error);
    assert.equal(revoked.data.publicationConsent, 'revoked');

    const outsiderDelete = await invoke(clients.outsider, {
      action: 'delete', body: { portraitId: ref.id },
    });
    assert.equal(outsiderDelete.status, 403);
    const removed = await invoke(clients.owner, {
      action: 'delete', body: { portraitId: ref.id },
    });
    assert.equal(removed.status, 200, JSON.stringify(removed.payload));
    objectPaths.delete(active.rows[0].object_path);
    const afterDelete = await invoke(clients.owner, {
      action: 'resolve', body: { ref, audience: 'authenticated_roster' },
    });
    assert.equal(afterDelete.status, 403);

    const durable = await database.query(
      `select count(*)::integer as forbidden_columns
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'tournament_player_portraits'
         and column_name in ('signed_url', 'url', 'base64', 'blob')`,
    );
    assert.equal(durable.rows[0].forbidden_columns, 0);
    const audits = await database.query(
      `select action from public.tournament_audit_log
       where resource_id = $1 order by id`, [ref.id],
    );
    assert.deepEqual(audits.rows.map((row) => row.action), [
      'portrait.replaced', 'portrait.reviewed',
      'portrait.publication_revoked', 'portrait.removed',
    ]);
  } finally {
    if (visualPolicyTournamentId && originalVisualPolicy) {
      await database.query(
        'update public.tournaments set team_visual_management_policy = $2 where id = $1',
        [visualPolicyTournamentId, originalVisualPolicy],
      ).catch(() => {});
    }
    let createdPortraitIds = [];
    if (rosterPlayerId) {
      const currentPortraits = await database.query(
        `select id, object_path from public.tournament_player_portraits
         where roster_player_id = $1`,
        [rosterPlayerId],
      );
      const createdPortraits = currentPortraits.rows.filter(
        (row) => !originalPortraitIds.has(row.id),
      );
      createdPortraitIds = createdPortraits.map((row) => row.id);
      for (const row of createdPortraits) objectPaths.add(row.object_path);
    }
    if (objectPaths.size) {
      const removed = await service.storage.from(bucket).remove([...objectPaths]);
      assert.ifError(removed.error);
    }
    if (createdPortraitIds.length) {
      await database.query('begin');
      try {
        await database.query(
          'alter table public.tournament_audit_log disable trigger tournament_audit_append_only',
        );
        await database.query(
          `delete from public.tournament_audit_log
           where resource_type = 'player_portrait' and resource_id = any($1::uuid[])`,
          [createdPortraitIds],
        );
        await database.query(
          'delete from public.tournament_player_portraits where id = any($1::uuid[])',
          [createdPortraitIds],
        );
        await database.query(
          'alter table public.tournament_audit_log enable trigger tournament_audit_append_only',
        );
        await database.query('commit');
      } catch (error) {
        await database.query('rollback');
        throw error;
      }
    }
    await database.end();
  }
});
