#!/usr/bin/env node

import {
  USERS,
  cleanupMatchOperationsHarness,
  connect,
  seedOperationalMatch,
  setup,
  value,
} from './torneos-match-operations.mjs';

const PUBLIC_MIGRATION = '../migrations/20260810215224_tournament_public_pages.sql';
let checks = 0;
let failures = 0;

function check(condition, label, detail = '') {
  checks += 1;
  if (condition) console.log(`  ✔ ${label}`);
  else {
    failures += 1;
    console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function equal(actual, expected, label) {
  check(
    JSON.stringify(actual) === JSON.stringify(expected),
    label,
    `esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`,
  );
}

async function expectError(action, pattern, label) {
  try {
    await action();
    check(false, label, 'la operación no fue rechazada');
  } catch (error) {
    const message = String(error?.message || error);
    check(pattern.test(message), label, message);
  }
}

function collectKeys(valueToInspect, keys = new Set()) {
  if (Array.isArray(valueToInspect)) {
    for (const item of valueToInspect) collectKeys(item, keys);
    return keys;
  }
  if (!valueToInspect || typeof valueToInspect !== 'object') return keys;
  for (const [key, child] of Object.entries(valueToInspect)) {
    keys.add(key);
    collectKeys(child, keys);
  }
  return keys;
}

async function createDraftFixtureMatch(admin, scope) {
  const source = (await admin.query(
    `select fixture.*
     from public.tournament_fixture_versions fixture
     where fixture.tournament_id = $1 and fixture.status = 'published'`,
    [scope.tournamentId],
  )).rows[0];
  const fixtureId = await value(
    admin,
    `insert into public.tournament_fixture_versions(
      organization_id,season_id,tournament_id,category_id,participant_set_id,
      version_number,status,generation_method,seed,participant_fingerprint,
      configuration_snapshot,created_by,idempotency_key
    ) values ($1,$2,$3,$4,$5,$6,'draft','manual','draft-hidden',$7,'{}',$8,gen_random_uuid())
    returning id`,
    [
      source.organization_id,
      source.season_id,
      source.tournament_id,
      source.category_id,
      source.participant_set_id,
      source.version_number + 1,
      source.participant_fingerprint,
      USERS.owner,
    ],
  );
  const phaseId = await value(
    admin,
    `insert into public.tournament_phases(
      organization_id,tournament_id,category_id,fixture_version_id,name,
      phase_type,sequence_number,status,configuration
    ) values ($1,$2,$3,$4,'Fase borrador','league',99,'draft','{}') returning id`,
    [scope.organizationId, scope.tournamentId, scope.categoryId, fixtureId],
  );
  const roundId = await value(
    admin,
    `insert into public.tournament_rounds(
      organization_id,tournament_id,category_id,fixture_version_id,phase_id,
      round_number,name,status,sort_order
    ) values ($1,$2,$3,$4,$5,99,'Jornada secreta','draft',99) returning id`,
    [scope.organizationId, scope.tournamentId, scope.categoryId, fixtureId, phaseId],
  );
  const participants = (await admin.query(
    `select id from public.tournament_competition_participants
     where participant_set_id = $1 order by snapshot_name limit 2`,
    [source.participant_set_id],
  )).rows;
  await admin.query(
    `insert into public.tournament_matches(
      organization_id,season_id,tournament_id,category_id,participant_set_id,
      fixture_version_id,phase_id,round_id,match_number,home_participant_id,
      away_participant_id,status,created_by
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,999,$9,$10,'draft',$11)`,
    [
      scope.organizationId,
      source.season_id,
      scope.tournamentId,
      scope.categoryId,
      source.participant_set_id,
      fixtureId,
      phaseId,
      roundId,
      participants[0].id,
      participants[1].id,
      USERS.owner,
    ],
  );
}

async function publishOfficialProjection(admin, scope) {
  const match = (await admin.query(
    `select match_row.*, home.team_entry_id home_entry_id,
      away.team_entry_id away_entry_id
     from public.tournament_matches match_row
     join public.tournament_competition_participants home
       on home.id = match_row.home_participant_id
     join public.tournament_competition_participants away
       on away.id = match_row.away_participant_id
     where match_row.id = $1`,
    [scope.matchId],
  )).rows[0];
  const operationId = await value(
    admin,
    `insert into public.tournament_match_operations(
      organization_id,season_id,tournament_id,category_id,fixture_version_id,
      phase_id,round_id,match_id,home_team_entry_id,away_team_entry_id,status,
      match_status,operation_version,match_snapshot,home_team_snapshot,
      away_team_snapshot,opened_by
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft','ready',1,'{}','{}','{}',$11
    ) returning id`,
    [
      scope.organizationId,
      match.season_id,
      scope.tournamentId,
      scope.categoryId,
      match.fixture_version_id,
      match.phase_id,
      match.round_id,
      scope.matchId,
      match.home_entry_id,
      match.away_entry_id,
      USERS.owner,
    ],
  );
  await admin.query(
    `insert into public.tournament_match_outcomes(
      match_operation_id,organization_id,match_id,outcome_type,started_at,ended_at,
      counts_for_standings,counts_for_player_stats
    ) values ($1,$2,$3,'played',now() - interval '1 hour',now(),true,true)`,
    [operationId, scope.organizationId, scope.matchId],
  );
  await admin.query(
    `insert into public.tournament_match_scores(
      match_operation_id,organization_id,match_id,home_score,away_score,score_type
    ) values ($1,$2,$3,2,1,'played')`,
    [operationId, scope.organizationId, scope.matchId],
  );

  const homeIndex = scope.entries.indexOf(match.home_entry_id);
  const awayIndex = scope.entries.indexOf(match.away_entry_id);
  for (const [teamEntryId, rosterPlayerId, displayName] of [
    [match.home_entry_id, scope.rosterPlayers[homeIndex][0], 'Jugador Napoli'],
    [match.away_entry_id, scope.rosterPlayers[awayIndex][0], 'Jugador Belgrano'],
  ]) {
    await admin.query(
      `insert into public.tournament_match_operation_players(
        organization_id,match_operation_id,match_id,team_entry_id,roster_player_id,
        display_name_snapshot,shirt_number_snapshot,position_snapshot,
        lineup_status,attendance_status,is_goalkeeper
      ) values ($1,$2,$3,$4,$5,$6,1,'ARQ','starter','present',true)`,
      [scope.organizationId, operationId, scope.matchId, teamEntryId, rosterPlayerId, displayName],
    );
  }
  await admin.query(
    `insert into public.tournament_match_events(
      organization_id,match_operation_id,match_id,team_entry_id,roster_player_id,
      event_type,minute,period,sequence_number,created_by
    ) values
      ($1,$2,$3,$4,$5,'goal',12,'first_half',1,$8),
      ($1,$2,$3,$4,$5,'yellow_card',37,'second_half',2,$8),
      ($1,$2,$3,$6,$7,'goal',51,'second_half',3,$8)`,
    [
      scope.organizationId,
      operationId,
      scope.matchId,
      match.home_entry_id,
      scope.rosterPlayers[homeIndex][0],
      match.away_entry_id,
      scope.rosterPlayers[awayIndex][0],
      USERS.owner,
    ],
  );
  await admin.query(
    `update public.tournament_match_operations
     set status = 'official', match_status = 'official',
       submitted_by = $2, submitted_at = now(),
       validated_by = $3, validated_at = now(),
       official_by = $2, official_at = now(), closed_at = now()
     where id = $1`,
    [operationId, USERS.owner, USERS.admin],
  );

  const revisionId = await value(
    scope.owner,
    `select public.rebuild_tournament_standings(
      $1,$2,$3,$4,null,'Publicación pública QA',$5::uuid
    )`,
    [
      scope.organizationId,
      scope.tournamentId,
      scope.categoryId,
      match.phase_id,
      '94000000-0000-4000-8000-000000000091',
    ],
  );
  await value(
    scope.owner,
    'select public.publish_tournament_standings_revision($1,$2)',
    [revisionId, 'Publicación pública QA'],
  );
  await admin.query(
    `insert into public.tournament_player_suspensions(
      revision_id,organization_id,tournament_id,category_id,phase_id,
      roster_player_id,team_entry_id,source_type,source_key,rule_snapshot,
      total_matches,served_matches,status,reason
    ) values (
      $1,$2,$3,$4,$5,$6,$7,'manual','public-pages-contract',
      '{}'::jsonb,3,1,'active','Detalle disciplinario interno QA'
    )`,
    [
      revisionId,
      scope.organizationId,
      scope.tournamentId,
      scope.categoryId,
      match.phase_id,
      scope.rosterPlayers[homeIndex][0],
      match.home_entry_id,
    ],
  );
}

async function run() {
  console.log('Arma2 Torneos · public pages PostgreSQL/RLS');
  try {
    const admin = await setup([
      '20260726200000_tournament_standings_discipline.sql',
      '20260726230000_tournament_participant_hub.sql',
      PUBLIC_MIGRATION,
    ]);
    const scope = await seedOperationalMatch(admin);
    const anon = await connect({ role: 'anon' });
    const adminUser = await connect({ role: 'authenticated', userId: USERS.admin });
    const collaborator = await connect({ role: 'authenticated', userId: USERS.collaborator });
    const player = await connect({ role: 'authenticated', userId: USERS.playerHome });
    const outsider = await connect({ role: 'authenticated', userId: USERS.outsider });

    equal(
      await value(anon, 'select public.get_public_tournament_page($1,null)', [
        'liga-operaciones-qa-copa-operaciones-deadbeef00',
      ]),
      null,
      'torneo no publicado devuelve not found seguro a anon',
    );
    equal(
      await value(anon, 'select public.get_public_tournament_page($1,null)', ['INVALID/']),
      null,
      'slug inválido devuelve not found seguro',
    );
    equal(
      await value(anon, 'select public.get_public_tournament_page($1,null)', [
        'torneo-inexistente-0123456789',
      ]),
      null,
      'torneo inexistente devuelve not found seguro',
    );

    await expectError(
      () => value(anon, 'select public.set_tournament_public_page_published($1,$2,true)', [
        scope.organizationId,
        scope.tournamentId,
      ]),
      /permission denied/,
      'anon no ejecuta el RPC administrativo nuevo',
    );
    await expectError(
      () => value(collaborator, 'select public.set_tournament_public_page_published($1,$2,true)', [
        scope.organizationId,
        scope.tournamentId,
      ]),
      /TORNEOS_PUBLIC_PAGE_FORBIDDEN/,
      'collaborator no puede publicar',
    );
    await expectError(
      () => value(outsider, 'select public.set_tournament_public_page_published($1,$2,true)', [
        scope.organizationId,
        scope.tournamentId,
      ]),
      /TORNEOS_PUBLIC_PAGE_FORBIDDEN/,
      'participant común no puede publicar',
    );
    await expectError(
      () => anon.query("insert into public.tournament_public_pages(tournament_id,organization_id,public_slug,status,published_by,published_at) values (gen_random_uuid(),gen_random_uuid(),'forged-page','published',gen_random_uuid(),now())"),
      /permission denied/,
      'anon no puede escribir la tabla de publicación',
    );
    await expectError(
      () => value(anon, 'select public.get_tournament_participant_hub($1,$2)', [
        scope.tournamentId,
        scope.categoryId,
      ]),
      /TORNEOS_AUTH_REQUIRED|permission denied/,
      'la nueva feature no abre el participant hub a anon',
    );

    const initialSettings = await value(
      scope.owner,
      'select public.get_tournament_public_page_settings($1,$2)',
      [scope.organizationId, scope.tournamentId],
    );
    check(initialSettings.eligible && !initialSettings.published, 'owner ve estado inicial no publicado');

    const published = await value(
      adminUser,
      'select public.set_tournament_public_page_published($1,$2,true)',
      [scope.organizationId, scope.tournamentId],
    );
    check(published.published && /^[a-z0-9-]+$/.test(published.publicSlug), 'admin publica con slug server-side');
    check(!published.publicSlug.includes(scope.tournamentId), 'slug no revela el UUID del torneo');
    await createDraftFixtureMatch(admin, scope);

    let page = await value(
      anon,
      'select public.get_public_tournament_page($1,$2)',
      [published.publicSlug, 'primera'],
    );
    equal(page.organization, { name: 'Liga Operaciones QA' }, 'anon recibe identidad pública mínima');
    check(page.matches.length === 1 && page.matches[0].matchNumber !== 999, 'fixture draft no aparece');
    equal(page.matches[0].result, null, 'resultado no oficial no aparece como final');
    check(!JSON.stringify(page).includes('Calle QA 123'), 'la dirección de sede no se publica');
    check(!JSON.stringify(page).includes('@match-operations.local'), 'la proyección no contiene emails');

    const publishedFixtureId = await value(
      admin,
      `select id from public.tournament_fixture_versions
       where tournament_id = $1 and status = 'published'`,
      [scope.tournamentId],
    );
    await admin.query(
      'update public.tournament_fixture_versions set invalidated_at = now() where id = $1',
      [publishedFixtureId],
    );
    const invalidated = await value(
      anon,
      'select public.get_public_tournament_page($1,$2)',
      [published.publicSlug, 'primera'],
    );
    check(!invalidated.hasPublishedFixture && invalidated.matches.length === 0, 'fixture invalidado queda fuera');
    await admin.query(
      'update public.tournament_fixture_versions set invalidated_at = null where id = $1',
      [publishedFixtureId],
    );

    await publishOfficialProjection(admin, scope);
    page = await value(
      anon,
      'select public.get_public_tournament_page($1,$2)',
      [published.publicSlug, 'primera'],
    );
    equal(
      [page.matches[0].result.home, page.matches[0].result.away],
      [2, 1],
      'resultado oficial aparece',
    );
    check(page.competition[0].standings.length === 2, 'tabla usa revisión canónica publicada');
    check(page.competition[0].players.some((item) => item.goals > 0), 'goleadores usan estadística oficial');
    check(page.competition[0].discipline.some((item) => item.yellowCards > 0), 'disciplina pública usa ledger publicado');
    const publicSuspension = page.competition[0].discipline
      .flatMap((item) => item.suspensions)[0];
    equal(
      publicSuspension,
      { remainingMatches: 2 },
      'suspensión pública expone exclusivamente las fechas pendientes calculadas server-side',
    );
    check(
      !('totalMatches' in publicSuspension)
        && !('servedMatches' in publicSuspension)
        && !('status' in publicSuspension),
      'objeto discipline[].suspensions[] no expone totalMatches, servedMatches ni status',
    );
    check(page.teams.length === 2 && page.teams.every((team) => !('roster' in team)), 'equipos no exponen planteles');

    const forbiddenKeys = new Set([
      'userId', 'user_id', 'email', 'phone', 'document', 'token', 'createdBy',
      'updatedBy', 'internalPath', 'bucket', 'notes', 'reason', 'capabilities',
      'entitlements', 'billing', 'rosterPlayerId', 'teamEntryId', 'participantId',
      'revisionId', 'operationId', 'matchId', 'organizationId', 'tournamentId',
    ]);
    const leakedKeys = [...collectKeys(page)].filter((key) => forbiddenKeys.has(key));
    equal(leakedKeys, [], 'contrato público excluye IDs internos, PII y metadata administrativa');

    const authenticatedPage = await value(
      player,
      'select public.get_public_tournament_page($1,$2)',
      [published.publicSlug, 'primera'],
    );
    equal(authenticatedPage.publicSlug, page.publicSlug, 'usuario autenticado consume la misma lectura pública');
    equal(
      await value(anon, 'select public.get_public_tournament_page($1,$2)', [published.publicSlug, 'inexistente']),
      null,
      'categoría ajena o inexistente falla cerrada',
    );

    await value(
      scope.owner,
      'select public.set_tournament_public_page_published($1,$2,false)',
      [scope.organizationId, scope.tournamentId],
    );
    equal(
      await value(anon, 'select public.get_public_tournament_page($1,null)', [published.publicSlug]),
      null,
      'despublicar corta acceso anon inmediatamente',
    );
    const republished = await value(
      scope.owner,
      'select public.set_tournament_public_page_published($1,$2,true)',
      [scope.organizationId, scope.tournamentId],
    );
    equal(republished.publicSlug, published.publicSlug, 'URL pública permanece estable al republicar');

    const otherOrganization = await value(
      outsider,
      'select public.create_tournament_organization($1,$2,$3::uuid)',
      [
        'Liga Segundo Tenant',
        'liga-segundo-tenant',
        '95000000-0000-4000-8000-000000000001',
      ],
    );
    const otherSeason = await value(
      outsider,
      'select public.create_tournament_season($1,$2,$3,null,null,$4::uuid)',
      [
        otherOrganization.organization.id,
        'Temporada Segundo Tenant',
        'temporada-segundo-tenant',
        '95000000-0000-4000-8000-000000000002',
      ],
    );
    const otherTournament = await value(
      outsider,
      `select public.create_tournament_with_defaults(
        $1,$2,'Copa Segundo Tenant','copa-segundo-tenant',null,
        'football_5','league','open',null,null,$3::uuid
      )`,
      [
        otherOrganization.organization.id,
        otherSeason.id,
        '95000000-0000-4000-8000-000000000003',
      ],
    );
    await value(
      outsider,
      `select public.save_tournament_category(
        $1,$2,null,'Primera','primera',null,0,null,null,null,
        'football_5',5::smallint,'active'
      )`,
      [otherOrganization.organization.id, otherTournament.id],
    );
    await value(
      outsider,
      'select public.change_tournament_status($1,$2,$3)',
      [otherOrganization.organization.id, otherTournament.id, 'registration'],
    );
    const otherPublished = await value(
      outsider,
      'select public.set_tournament_public_page_published($1,$2,true)',
      [otherOrganization.organization.id, otherTournament.id],
    );
    const otherPage = await value(
      anon,
      'select public.get_public_tournament_page($1,null)',
      [otherPublished.publicSlug],
    );
    equal(otherPage.organization.name, 'Liga Segundo Tenant', 'cada slug resuelve un único tenant');
    check(
      !JSON.stringify(page).includes('Liga Segundo Tenant')
        && !JSON.stringify(otherPage).includes('Liga Operaciones QA'),
      'la proyección no mezcla datos entre tenants',
    );

    await admin.query(
      `update public.tournament_organizations
       set status = 'archived', archived_at = now()
       where id = $1`,
      [scope.organizationId],
    );
    equal(
      await value(anon, 'select public.get_public_tournament_page($1,null)', [published.publicSlug]),
      null,
      'organización archivada invalida la página server-side',
    );

    const anonGrants = (await admin.query(
      `select routine_name
       from information_schema.routine_privileges
       where routine_schema = 'public'
         and grantee = 'anon'
         and routine_name like '%public%tournament%page%'
       order by routine_name`,
    )).rows.map((row) => row.routine_name);
    equal(anonGrants, ['get_public_tournament_page'], 'grant anon nuevo es único y mínimo');
    const authenticatedGrants = (await admin.query(
      `select routine_name
       from information_schema.routine_privileges
       where routine_schema = 'public'
         and grantee = 'authenticated'
         and routine_name in (
           'get_public_tournament_page',
           'get_tournament_public_page_settings',
           'set_tournament_public_page_published'
         )
       order by routine_name`,
    )).rows.map((row) => row.routine_name);
    equal(authenticatedGrants, [
      'get_public_tournament_page',
      'get_tournament_public_page_settings',
      'set_tournament_public_page_published',
    ], 'authenticated recibe exactamente los tres contratos públicos nuevos');
    check(
      await value(admin, "select relrowsecurity from pg_class where oid = 'public.tournament_public_pages'::regclass"),
      'tabla de opt-in tiene RLS habilitado',
    );
    check(
      Number(await value(
        admin,
        `select count(*) from public.tournament_audit_log
         where tournament_id = $1
           and action in ('public_page.published','public_page.unpublished')`,
        [scope.tournamentId],
      )) >= 3,
      'publicar y despublicar quedan auditados',
    );

    console.log(`\nPublic pages: ${checks - failures}/${checks} checks OK`);
    if (failures) throw new Error(`${failures} public pages checks failed`);
  } finally {
    await cleanupMatchOperationsHarness();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
