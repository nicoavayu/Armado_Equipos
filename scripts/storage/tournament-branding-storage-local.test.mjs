#!/usr/bin/env node

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import test from 'node:test';

import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const enabled = process.env.TOURNAMENT_BRANDING_LOCAL_TEST === 'true';
const apiUrl = process.env.SUPABASE_URL || '';
const databaseUrl = process.env.SUPABASE_DB_URL || '';
const anonKey = process.env.SUPABASE_ANON_KEY || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const bucket = 'tournament-branding';
const loopback = new Set(['127.0.0.1', 'localhost', '::1']);

function assertLocal(raw, protocols) {
  const parsed = new URL(raw);
  assert.ok(protocols.includes(parsed.protocol));
  assert.ok(loopback.has(parsed.hostname));
}

async function authenticatedClient(admin, email) {
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  assert.ifError(linkError);
  const client = createClient(apiUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { error: otpError } = await client.auth.verifyOtp({
    type: 'magiclink',
    token_hash: link.properties.hashed_token,
  });
  assert.ifError(otpError);
  return client;
}

test('tournament branding Storage and reference policies are tenant scoped', { skip: !enabled }, async () => {
  assertLocal(apiUrl, ['http:', 'https:']);
  assertLocal(databaseUrl, ['postgres:', 'postgresql:']);
  assert.ok(anonKey && serviceKey, 'Local Supabase keys are required in memory.');

  const database = new pg.Client({ connectionString: databaseUrl });
  const admin = createClient(apiUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const objects = [];
  const originalBrandingAuditIds = new Set();
  let qa = null;
  let originalParticipantShields = [];
  await database.connect();
  try {
    const { rows } = await database.query(
      `select organization.id as organization_id,
              tournament.id as tournament_id,
              tournament.season_id,
              category.id as category_id,
              team.id as team_id,
              team.shield_path as original_team_shield_path,
              owner.id as owner_id,
              owner.email as owner_email,
              admin.email as admin_email,
              collaborator.email as collaborator_email,
              delegate.email as delegate_email,
              outsider.email as outsider_email
       from public.tournament_organizations organization
       join public.tournaments tournament
         on tournament.organization_id = organization.id
        and tournament.status = 'active'
       join public.tournament_categories category
         on category.tournament_id = tournament.id
       join public.tournament_team_entries team
         on team.tournament_id = tournament.id
        and team.status = 'approved'
       join auth.users owner
         on owner.raw_app_meta_data->>'qa_role' = 'owner'
       join auth.users admin
         on admin.raw_app_meta_data->>'qa_role' = 'admin'
       join auth.users collaborator
         on collaborator.raw_app_meta_data->>'qa_role' = 'collaborator'
       join auth.users delegate
         on delegate.raw_app_meta_data->>'qa_role' = 'delegate'
       join auth.users outsider
         on outsider.raw_app_meta_data->>'qa_role' = 'outsider'
       where exists (
         select 1
         from public.tournament_team_managers manager
         where manager.team_entry_id = team.id
           and manager.user_id = delegate.id
           and manager.role = 'delegate'
           and manager.status = 'active'
       )
       limit 1`,
    );
    assert.equal(rows.length, 1, 'The canonical QA dataset is required.');
    qa = rows[0];
    const originalAudits = await database.query(
      `select id from public.tournament_audit_log
       where resource_id = $1 and action like 'branding.%'`,
      [qa.team_id],
    );
    for (const row of originalAudits.rows) originalBrandingAuditIds.add(row.id);
    const originalParticipants = await database.query(
      `select id, snapshot_shield_path
       from public.tournament_competition_participants
       where team_entry_id = $1`,
      [qa.team_id],
    );
    originalParticipantShields = originalParticipants.rows;
    const owner = await authenticatedClient(admin, qa.owner_email);
    const adminMember = await authenticatedClient(admin, qa.admin_email);
    const collaborator = await authenticatedClient(admin, qa.collaborator_email);
    const delegate = await authenticatedClient(admin, qa.delegate_email);
    const outsider = await authenticatedClient(admin, qa.outsider_email);
    const png = await readFile('scripts/edge-functions/fixtures/tournament-media/probe-1x1.png');

    const orgPath = `${qa.organization_id}/organizations/${qa.organization_id}/${randomUUID()}.png`;
    const tournamentPath = `${qa.organization_id}/tournaments/${qa.tournament_id}/${randomUUID()}.png`;

    for (const path of [orgPath, tournamentPath]) {
      const authorization = await owner.rpc('can_write_tournament_branding_object', {
        p_name: path,
      });
      assert.ifError(authorization.error);
      assert.equal(authorization.data, true, `Policy helper rejected ${path.split('/')[1]}.`);
      const result = await owner.storage.from(bucket).upload(path, png, {
        contentType: 'image/png', cacheControl: '31536000', upsert: false,
      });
      assert.ifError(result.error, `Storage rejected ${path.split('/')[1]}.`);
      objects.push(path);
    }

    const approvedTeamPath = `${qa.organization_id}/teams/${qa.team_id}/${randomUUID()}.png`;
    const replacementTeamPath = `${qa.organization_id}/teams/${qa.team_id}/${randomUUID()}.png`;
    for (const [client, expected, label] of [
      [owner, true, 'owner'],
      [adminMember, true, 'admin'],
      [collaborator, false, 'collaborator without update capability'],
      [delegate, true, 'active team delegate'],
      [outsider, false, 'outsider'],
    ]) {
      const authorization = await client.rpc('can_write_tournament_branding_object', {
        p_name: approvedTeamPath,
      });
      assert.ifError(authorization.error);
      assert.equal(authorization.data, expected, `Unexpected branding authorization for ${label}.`);
    }

    for (const path of [approvedTeamPath, replacementTeamPath]) {
      const upload = await owner.storage.from(bucket).upload(path, png, {
        contentType: 'image/png', cacheControl: '31536000', upsert: false,
      });
      assert.ifError(upload.error, 'Approved team branding upload was rejected.');
      objects.push(path);
    }

    const firstReference = await owner.rpc('set_tournament_branding_reference', {
      p_organization_id: qa.organization_id,
      p_entity_kind: 'team',
      p_entity_id: qa.team_id,
      p_path: approvedTeamPath,
    });
    assert.ifError(firstReference.error);
    const replacementReference = await owner.rpc('set_tournament_branding_reference', {
      p_organization_id: qa.organization_id,
      p_entity_kind: 'team',
      p_entity_id: qa.team_id,
      p_path: replacementTeamPath,
    });
    assert.ifError(replacementReference.error);
    assert.equal(replacementReference.data.previousPath, approvedTeamPath);

    const { rows: brandingRows } = await database.query(
      `select entry.status,
              entry.shield_path,
              roster.status as roster_status,
              bool_and(participant.snapshot_shield_path = $2) as snapshots_synced
       from public.tournament_team_entries entry
       join public.tournament_rosters roster on roster.team_entry_id = entry.id
       join public.tournament_competition_participants participant
         on participant.team_entry_id = entry.id
       where entry.id = $1
       group by entry.status, entry.shield_path, roster.status`,
      [qa.team_id, replacementTeamPath],
    );
    assert.equal(brandingRows[0].status, 'approved');
    assert.equal(brandingRows[0].roster_status, 'approved');
    assert.equal(brandingRows[0].shield_path, replacementTeamPath);
    assert.equal(brandingRows[0].snapshots_synced, true);

    const removedReference = await owner.rpc('set_tournament_branding_reference', {
      p_organization_id: qa.organization_id,
      p_entity_kind: 'team',
      p_entity_id: qa.team_id,
      p_path: null,
    });
    assert.ifError(removedReference.error);
    const { rows: fallbackRows } = await database.query(
      `select entry.status,
              entry.shield_path,
              bool_and(participant.snapshot_shield_path is null) as snapshots_cleared
       from public.tournament_team_entries entry
       join public.tournament_competition_participants participant
         on participant.team_entry_id = entry.id
       where entry.id = $1
       group by entry.status, entry.shield_path`,
      [qa.team_id],
    );
    assert.equal(fallbackRows[0].status, 'approved');
    assert.equal(fallbackRows[0].shield_path, null);
    assert.equal(fallbackRows[0].snapshots_cleared, true);

    const ownerRemoval = await owner.storage.from(bucket).remove([replacementTeamPath]);
    assert.ifError(ownerRemoval.error);
    assert.equal(
      ownerRemoval.data?.some((object) => object.name === replacementTeamPath),
      true,
      'Authorized immutable cleanup must return the deleted object.',
    );
    objects.splice(objects.indexOf(replacementTeamPath), 1);

    const duplicate = await owner.storage.from(bucket).upload(orgPath, png, {
      contentType: 'image/png', upsert: false,
    });
    assert.ok(duplicate.error, 'Overwrite of an immutable path must be denied.');

    const forbiddenCases = [
      outsider.storage.from(bucket).upload(
        `${qa.organization_id}/organizations/${qa.organization_id}/${randomUUID()}.png`,
        png,
        { contentType: 'image/png', upsert: false },
      ),
      owner.storage.from(bucket).upload(
        `${randomUUID()}/organizations/${randomUUID()}/${randomUUID()}.png`,
        png,
        { contentType: 'image/png', upsert: false },
      ),
      owner.storage.from(bucket).upload(
        `${qa.organization_id}/organizations/${qa.organization_id}/../${randomUUID()}.png`,
        png,
        { contentType: 'image/png', upsert: false },
      ),
      owner.storage.from(bucket).upload(
        `${qa.organization_id}/organizations/${qa.organization_id}/${randomUUID()}.svg`,
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
        { contentType: 'image/svg+xml', upsert: false },
      ),
      owner.storage.from(bucket).upload(
        `${qa.organization_id}/organizations/${qa.organization_id}/${randomUUID()}.png`,
        Buffer.from('<html>not an image</html>'),
        { contentType: 'text/html', upsert: false },
      ),
      owner.storage.from(bucket).upload(
        `${qa.organization_id}/organizations/${qa.organization_id}/${randomUUID()}.png`,
        Buffer.alloc((2 * 1024 * 1024) + 1),
        { contentType: 'image/png', upsert: false },
      ),
    ];
    for (const pending of forbiddenCases) {
      const result = await pending;
      assert.ok(result.error, 'A negative Storage case unexpectedly succeeded.');
    }

    const { data: publicData } = admin.storage.from(bucket).getPublicUrl(orgPath);
    await outsider.storage.from(bucket).remove([orgPath]);
    // Storage deliberately returns an idempotent success for an RLS-hidden
    // object; prove the denial by checking that the public object survived.
    const publicResponse = await fetch(publicData.publicUrl);
    assert.equal(publicResponse.status, 200);
    assert.equal(publicResponse.headers.get('content-type'), 'image/png');

    const deniedReference = await outsider.rpc('set_tournament_branding_reference', {
      p_organization_id: qa.organization_id,
      p_entity_kind: 'organization',
      p_entity_id: qa.organization_id,
      p_path: orgPath,
    });
    assert.ok(deniedReference.error, 'A cross-tenant reference change unexpectedly succeeded.');

    const context = await owner.rpc('get_tournament_branding_context', {
      p_organization_id: qa.organization_id,
      p_tournament_id: qa.tournament_id,
    });
    assert.ifError(context.error);
    assert.ok(context.data?.organization?.logoPath);

  } finally {
    if (qa) {
      await database.query(
        `update public.tournament_team_entries
         set shield_path = $2
         where id = $1`,
        [qa.team_id, qa.original_team_shield_path],
      );
      for (const participant of originalParticipantShields) {
        await database.query(
          `update public.tournament_competition_participants
           set snapshot_shield_path = $2
           where id = $1`,
          [participant.id, participant.snapshot_shield_path],
        );
      }
      const currentAudits = await database.query(
        `select id from public.tournament_audit_log
         where resource_id = $1 and action like 'branding.%'`,
        [qa.team_id],
      );
      const createdAuditIds = currentAudits.rows
        .map((row) => row.id)
        .filter((id) => !originalBrandingAuditIds.has(id));
      if (createdAuditIds.length) {
        await database.query('begin');
        try {
          await database.query(
            'alter table public.tournament_audit_log disable trigger tournament_audit_append_only',
          );
          await database.query(
            'delete from public.tournament_audit_log where id = any($1::bigint[])',
            [createdAuditIds],
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
    }
    if (objects.length) await admin.storage.from(bucket).remove(objects);
    await database.end();
  }
});
