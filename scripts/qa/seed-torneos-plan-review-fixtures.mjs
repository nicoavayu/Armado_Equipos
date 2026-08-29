#!/usr/bin/env node
//
// Fixtures LOCAL idempotentes para la review final de Planes y append de fase.
//
// Estados que prepara, sin compras ni transacciones:
//   * una organización nueva cuyo primer torneo recibe FREE por el trigger real;
//   * ese torneo con Liga publicada, 28 resultados oficiales, tabla Top 8 y
//     ninguna fase eliminatoria, listo para Fixture > Versiones > Agregar fase;
//   * una organización legacy dedicada, inicializada como el backfill real y
//     con un único PREMIUM / legacy_grant emitido por la función server-side;
//   * el torneo canónico Liga + Playoffs queda estrictamente de sólo lectura.
//
// El script no contiene bypass de UI ni de RLS. Sólo el proceso QA local escribe
// como autoridad de seed; la aplicación abre y muta los estados con Auth/RLS
// reales. Toda escritura exige loopback y consentimiento explícito.

import { createHash } from 'node:crypto';
import process from 'node:process';

import pg from 'pg';

import productionGuard from './production-guard.js';
import { stableUuid } from './torneos-demo-dataset.mjs';

const { assertLocalDatabaseTarget, ProductionGuardError } = productionGuard;

const FIXTURE_KEY = 'qa.plans.review.v1';
const FIXED_AT = '2026-08-20T12:00:00.000Z';

const FREE_ORGANIZATION_ID = stableUuid(`${FIXTURE_KEY}:organization`);
const FREE_ORGANIZATION_CREATION_KEY = stableUuid(`${FIXTURE_KEY}:organization:create`);
const FREE_MEMBERSHIP_ID = stableUuid(`${FIXTURE_KEY}:membership`);
const FREE_SEASON_ID = stableUuid(`${FIXTURE_KEY}:season`);
const FREE_SEASON_CREATION_KEY = stableUuid(`${FIXTURE_KEY}:season:create`);
const FREE_TOURNAMENT_ID = stableUuid(`${FIXTURE_KEY}:tournament`);
const FREE_TOURNAMENT_CREATION_KEY = stableUuid(`${FIXTURE_KEY}:tournament:create`);
const FREE_CATEGORY_ID = stableUuid(`${FIXTURE_KEY}:category`);
const FREE_PARTICIPANT_SET_ID = stableUuid(`${FIXTURE_KEY}:participant-set`);
const FREE_FIXTURE_VERSION_ID = stableUuid(`${FIXTURE_KEY}:fixture-version`);
const FREE_LEAGUE_PHASE_ID = stableUuid(`${FIXTURE_KEY}:phase:league`);
const FREE_STANDINGS_REVISION_ID = stableUuid(`${FIXTURE_KEY}:standings`);
const FREE_ORGANIZATION_SLUG = 'qa-planes-first-free';
const FREE_TOURNAMENT_NAME = 'Liga Free QA · Antes de Playoffs';

const PREMIUM_ORGANIZATION_ID = stableUuid(`${FIXTURE_KEY}:premium:organization`);
const PREMIUM_ORGANIZATION_CREATION_KEY = stableUuid(`${FIXTURE_KEY}:premium:organization:create`);
const PREMIUM_MEMBERSHIP_ID = stableUuid(`${FIXTURE_KEY}:premium:membership`);
const PREMIUM_SEASON_ID = stableUuid(`${FIXTURE_KEY}:premium:season`);
const PREMIUM_SEASON_CREATION_KEY = stableUuid(`${FIXTURE_KEY}:premium:season:create`);
const PREMIUM_TOURNAMENT_ID = stableUuid(`${FIXTURE_KEY}:premium:tournament`);
const PREMIUM_TOURNAMENT_CREATION_KEY = stableUuid(`${FIXTURE_KEY}:premium:tournament:create`);
const PREMIUM_ORGANIZATION_SLUG = 'qa-planes-legacy-premium';
const PREMIUM_TOURNAMENT_NAME = 'Torneo Premium Legacy QA';

const POST_ORGANIZATION_SLUG = 'qa-metropolitana';
const POST_TOURNAMENT_NAME = 'Torneo Apertura QA 2026';

const TEAM_DEFINITIONS = Object.freeze([
  ['Atlético del Puerto', 'ADP'],
  ['Barracas Central QA', 'BCQ'],
  ['Club Horizonte QA', 'CHQ'],
  ['Deportivo Federal', 'DEF'],
  ['Estrella Metropolitana', 'EMQ'],
  ['Ferro del Oeste QA', 'FOQ'],
  ['Juventud del Parque', 'JDP'],
  ['Villa Unión QA', 'VUQ'],
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function buildLeagueFixture() {
  const teams = TEAM_DEFINITIONS.map(([name, shortName], index) => ({
    id: stableUuid(`${FIXTURE_KEY}:team:${index + 1}`),
    participantId: stableUuid(`${FIXTURE_KEY}:participant:${index + 1}`),
    name,
    shortName,
    slug: `qa-pre-playoffs-${index + 1}`,
  }));
  const stats = new Map(teams.map((team) => [team.id, {
    team,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0,
  }]));
  const rotating = [...teams];
  const rounds = [];
  const matches = [];
  for (let roundIndex = 0; roundIndex < teams.length - 1; roundIndex += 1) {
    const round = {
      id: stableUuid(`${FIXTURE_KEY}:round:${roundIndex + 1}`),
      number: roundIndex + 1,
      name: `Fecha ${roundIndex + 1}`,
    };
    rounds.push(round);
    for (let pairIndex = 0; pairIndex < teams.length / 2; pairIndex += 1) {
      const home = rotating[pairIndex];
      const away = rotating[rotating.length - 1 - pairIndex];
      const homeScore = (roundIndex + pairIndex * 2 + 1) % 4;
      const awayScore = (roundIndex * 2 + pairIndex) % 3;
      const matchNumber = matches.length + 1;
      const match = {
        id: stableUuid(`${FIXTURE_KEY}:match:${round.number}:${pairIndex + 1}`),
        operationId: stableUuid(`${FIXTURE_KEY}:operation:${round.number}:${pairIndex + 1}`),
        roundId: round.id,
        matchNumber,
        home,
        away,
        homeScore,
        awayScore,
        scheduledAt: new Date(Date.parse(FIXED_AT) - (29 - matchNumber) * 86400000).toISOString(),
      };
      matches.push(match);

      const homeStats = stats.get(home.id);
      const awayStats = stats.get(away.id);
      homeStats.played += 1;
      awayStats.played += 1;
      homeStats.goalsFor += homeScore;
      homeStats.goalsAgainst += awayScore;
      awayStats.goalsFor += awayScore;
      awayStats.goalsAgainst += homeScore;
      if (homeScore > awayScore) {
        homeStats.won += 1;
        homeStats.points += 3;
        awayStats.lost += 1;
      } else if (homeScore < awayScore) {
        awayStats.won += 1;
        awayStats.points += 3;
        homeStats.lost += 1;
      } else {
        homeStats.drawn += 1;
        awayStats.drawn += 1;
        homeStats.points += 1;
        awayStats.points += 1;
      }
    }
    rotating.splice(1, 0, rotating.pop());
  }
  const standings = [...stats.values()].sort((left, right) => (
    right.points - left.points
    || (right.goalsFor - right.goalsAgainst) - (left.goalsFor - left.goalsAgainst)
    || right.goalsFor - left.goalsFor
    || left.team.name.localeCompare(right.team.name)
  )).map((row, index) => ({ ...row, position: index + 1 }));
  return {
    teams,
    rounds,
    matches,
    standings,
    participantFingerprint: sha256(teams.map((team) => team.id).join(':')),
    standingsFingerprint: sha256(matches.map((match) => (
      `${match.id}:${match.homeScore}:${match.awayScore}`
    )).join(':')),
  };
}

async function readFixture(client) {
  const expectedFixture = buildLeagueFixture();
  const plans = await client.query(
    `select organization.slug, tournament.id tournament_id, tournament.name,
            grant_row.plan_code, grant_row.source
     from public.tournament_organizations organization
     join public.tournaments tournament on tournament.organization_id = organization.id
     join public.tournament_plan_grants grant_row
       on grant_row.organization_id = organization.id
      and grant_row.tournament_id = tournament.id
     where (organization.slug = $1 and tournament.id = $2
            and grant_row.plan_code = 'FREE' and grant_row.source = 'first_free')
        or (organization.slug = $3 and tournament.id = $4
            and grant_row.plan_code = 'PREMIUM' and grant_row.source = 'legacy_grant')
     order by grant_row.plan_code`,
    [
      FREE_ORGANIZATION_SLUG,
      FREE_TOURNAMENT_ID,
      PREMIUM_ORGANIZATION_SLUG,
      PREMIUM_TOURNAMENT_ID,
    ],
  );
  const free = plans.rows.find((row) => row.plan_code === 'FREE');
  const premium = plans.rows.find((row) => row.plan_code === 'PREMIUM');
  if (!free || !premium) return null;

  const before = (await client.query(
    `select tournament.status,
       count(distinct version.id) filter (where version.status = 'published')::int published_versions,
       count(distinct phase.id) filter (where phase.phase_type = 'league')::int league_phases,
       count(distinct phase.id) filter (where phase.phase_type <> 'league')::int playoff_phases,
       count(distinct match_row.id) filter (where phase.phase_type = 'league')::int league_matches,
       count(distinct operation.id) filter (where operation.status = 'official')::int official_results,
       count(distinct score.match_operation_id)::int official_scores,
       count(distinct standing.id)::int standings_rows,
       count(distinct grant_row.id)::int grant_count,
       count(distinct grant_row.id) filter (where grant_row.source = 'purchase')::int purchase_count
     from public.tournaments tournament
     left join public.tournament_fixture_versions version on version.tournament_id = tournament.id
     left join public.tournament_phases phase on phase.fixture_version_id = version.id
     left join public.tournament_matches match_row on match_row.phase_id = phase.id
     left join public.tournament_match_operations operation on operation.match_id = match_row.id
     left join public.tournament_match_scores score on score.match_operation_id = operation.id
     left join public.tournament_standings_revisions revision on revision.phase_id = phase.id
       and revision.status = 'published'
     left join public.tournament_team_standings standing on standing.revision_id = revision.id
     left join public.tournament_plan_grants grant_row on grant_row.tournament_id = tournament.id
     where tournament.id = $1
     group by tournament.status`,
    [FREE_TOURNAMENT_ID],
  )).rows[0];

  const actualLeague = (await client.query(
    `select match_row.id,match_row.match_number,operation.id operation_id,
            operation.status operation_status,score.home_score,score.away_score
     from public.tournament_matches match_row
     join public.tournament_phases phase on phase.id = match_row.phase_id
     join public.tournament_match_operations operation on operation.match_id = match_row.id
     join public.tournament_match_scores score on score.match_operation_id = operation.id
     where match_row.tournament_id = $1 and phase.phase_type = 'league'
     order by match_row.match_number`,
    [FREE_TOURNAMENT_ID],
  )).rows;
  const expectedLeague = expectedFixture.matches.map((match) => ({
    id: match.id,
    match_number: match.matchNumber,
    operation_id: match.operationId,
    operation_status: 'official',
    home_score: match.homeScore,
    away_score: match.awayScore,
  }));
  const actualStandings = (await client.query(
    `select standing.position,standing.team_entry_id,standing.played,standing.won,
            standing.drawn,standing.lost,standing.goals_for,standing.goals_against,
            standing.goal_difference,standing.points
     from public.tournament_team_standings standing
     where standing.revision_id = $1
     order by standing.position`,
    [FREE_STANDINGS_REVISION_ID],
  )).rows;
  const expectedStandings = expectedFixture.standings.map((row) => ({
    position: row.position,
    team_entry_id: row.team.id,
    played: row.played,
    won: row.won,
    drawn: row.drawn,
    lost: row.lost,
    goals_for: row.goalsFor,
    goals_against: row.goalsAgainst,
    goal_difference: row.goalsFor - row.goalsAgainst,
    points: row.points,
  }));
  const leagueIntegrity = JSON.stringify(actualLeague) === JSON.stringify(expectedLeague)
    && JSON.stringify(actualStandings) === JSON.stringify(expectedStandings);

  const after = (await client.query(
    `select organization.id organization_id, tournament.id tournament_id,
            category.id category_id, tournament.status,
            count(distinct phase.id) filter (where phase.phase_type = 'league')::int league_phases,
            count(distinct phase.id) filter (where phase.phase_type in (
              'round_of_32','round_of_16','quarterfinal','semifinal',
              'third_place','final','custom_knockout'
            ))::int playoff_phases
     from public.tournament_organizations organization
     join public.tournaments tournament on tournament.organization_id = organization.id
     join public.tournament_categories category on category.tournament_id = tournament.id
     join public.tournament_fixture_versions version on version.tournament_id = tournament.id
       and version.status = 'published'
     join public.tournament_phases phase on phase.fixture_version_id = version.id
     where organization.slug = $1 and tournament.name = $2
     group by organization.id,tournament.id,category.id,tournament.status`,
    [POST_ORGANIZATION_SLUG, POST_TOURNAMENT_NAME],
  )).rows[0];

  if (
    before?.status !== 'active'
    || before.published_versions !== 1
    || before.league_phases !== 1
    || ![0, 1].includes(before.playoff_phases)
    || before.league_matches !== 28
    || before.official_results !== 28
    || before.official_scores !== 28
    || before.standings_rows !== 8
    || before.grant_count !== 1
    || before.purchase_count !== 0
    || !leagueIntegrity
    || after?.status !== 'active'
    || after.league_phases < 1
    || after.playoff_phases < 1
  ) return null;

  return {
    freeOrganizationId: FREE_ORGANIZATION_ID,
    freeTournamentId: FREE_TOURNAMENT_ID,
    freeCategoryId: FREE_CATEGORY_ID,
    freePlan: free.plan_code,
    freeSource: free.source,
    premiumOrganizationId: PREMIUM_ORGANIZATION_ID,
    premiumTournamentId: PREMIUM_TOURNAMENT_ID,
    premiumPlan: premium.plan_code,
    premiumSource: premium.source,
    reviewState: before.playoff_phases === 0 ? 'before_append' : 'after_append',
    leagueIntegrity: 'exact',
    beforeAppend: before,
    afterAppend: after,
  };
}

async function seedPremiumFixture(client, ownerUserId) {
  await client.query(
    `insert into public.tournament_organizations (
       id,name,slug,status,created_by,creation_key
     ) values ($1,'QA Planes · Premium Legacy',$2,'active',$3,$4)
     on conflict (id) do nothing`,
    [
      PREMIUM_ORGANIZATION_ID,
      PREMIUM_ORGANIZATION_SLUG,
      ownerUserId,
      PREMIUM_ORGANIZATION_CREATION_KEY,
    ],
  );
  await client.query(
    `insert into public.tournament_organization_members (
       id,organization_id,user_id,role,status,joined_at
     ) values ($1,$2,$3,'owner','active',$4)
     on conflict (organization_id,user_id) do nothing`,
    [PREMIUM_MEMBERSHIP_ID, PREMIUM_ORGANIZATION_ID, ownerUserId, FIXED_AT],
  );
  await client.query(
    `insert into public.tournament_organization_plan_state (
       organization_id,first_free_consumed_at,first_free_tournament_id,initialization_source
     ) values ($1,$2,null,'legacy_backfill')
     on conflict (organization_id) do nothing`,
    [PREMIUM_ORGANIZATION_ID, FIXED_AT],
  );
  await client.query(
    `insert into public.tournament_seasons (
       id,organization_id,name,slug,status,start_date,end_date,created_by,creation_key
     ) values (
       $1,$2,'Temporada Premium QA 2026','temporada-premium-qa-2026','active',
       '2026-01-01','2026-12-31',$3,$4
     ) on conflict (id) do nothing`,
    [
      PREMIUM_SEASON_ID,
      PREMIUM_ORGANIZATION_ID,
      ownerUserId,
      PREMIUM_SEASON_CREATION_KEY,
    ],
  );
  await client.query(
    `insert into public.tournaments (
       id,organization_id,season_id,name,slug,description,status,
       sport_modality,competition_format,gender_category,team_size,
       substitutes_limit,start_date,end_date,created_by,creation_key
     ) values (
       $1,$2,$3,$4,'torneo-premium-legacy-qa',
       'Fixture LOCAL que representa un acceso legacy, no una compra.','draft',
       'football_7','league','open',7,5,'2026-09-01','2026-12-15',$5,$6
     ) on conflict (id) do nothing`,
    [
      PREMIUM_TOURNAMENT_ID,
      PREMIUM_ORGANIZATION_ID,
      PREMIUM_SEASON_ID,
      PREMIUM_TOURNAMENT_NAME,
      ownerUserId,
      PREMIUM_TOURNAMENT_CREATION_KEY,
    ],
  );
  await client.query(
    `select public.grant_tournament_premium(
       $1,$2,'legacy_grant','Grant QA LOCAL determinista; no representa una compra real'
     )`,
    [PREMIUM_ORGANIZATION_ID, PREMIUM_TOURNAMENT_ID],
  );
  await client.query(
    `insert into public.user_tournament_context_preferences (
       user_id,organization_id,active_season_id,active_tournament_id
     ) values ($1,$2,$3,$4)
     on conflict (user_id,organization_id) do update set
       active_season_id = excluded.active_season_id,
       active_tournament_id = excluded.active_tournament_id`,
    [ownerUserId, PREMIUM_ORGANIZATION_ID, PREMIUM_SEASON_ID, PREMIUM_TOURNAMENT_ID],
  );
}

async function seedFreeLeagueFixture(client, ownerUserId) {
  const fixture = buildLeagueFixture();
  await client.query(
    `insert into public.tournament_organizations (
       id,name,slug,status,created_by,creation_key
     ) values ($1,'QA Liga · Antes de Playoffs',$2,'active',$3,$4)
     on conflict (id) do nothing`,
    [
      FREE_ORGANIZATION_ID,
      FREE_ORGANIZATION_SLUG,
      ownerUserId,
      FREE_ORGANIZATION_CREATION_KEY,
    ],
  );
  await client.query(
    `insert into public.tournament_organization_members (
       id,organization_id,user_id,role,status,joined_at
     ) values ($1,$2,$3,'owner','active',$4)
     on conflict (organization_id,user_id) do nothing`,
    [FREE_MEMBERSHIP_ID, FREE_ORGANIZATION_ID, ownerUserId, FIXED_AT],
  );
  await client.query(
    `insert into public.tournament_seasons (
       id,organization_id,name,slug,status,start_date,end_date,created_by,creation_key
     ) values (
       $1,$2,'Temporada Liga QA 2026','temporada-liga-qa-2026','active',
       '2026-01-01','2026-12-31',$3,$4
     ) on conflict (id) do nothing`,
    [FREE_SEASON_ID, FREE_ORGANIZATION_ID, ownerUserId, FREE_SEASON_CREATION_KEY],
  );
  await client.query(
    `insert into public.tournaments (
       id,organization_id,season_id,name,slug,description,status,
       sport_modality,competition_format,gender_category,team_size,
       substitutes_limit,start_date,end_date,format_settings,created_by,creation_key
     ) values (
       $1,$2,$3,$4,'liga-free-qa-antes-playoffs',
       'Fixture LOCAL activo con Liga oficial completa y sin Playoffs.','registration',
       'football_5','league','open',5,5,'2026-07-01','2026-12-15',
       '{"leagueRounds":"single","qualifiers":8,"knockoutLegs":"single"}'::jsonb,$5,$6
     ) on conflict (id) do nothing`,
    [
      FREE_TOURNAMENT_ID,
      FREE_ORGANIZATION_ID,
      FREE_SEASON_ID,
      FREE_TOURNAMENT_NAME,
      ownerUserId,
      FREE_TOURNAMENT_CREATION_KEY,
    ],
  );
  await client.query(
    `update public.tournaments set
       name=$2,description='Fixture LOCAL activo con Liga oficial completa y sin Playoffs.',
       status='registration',competition_format='league',
       format_settings='{"leagueRounds":"single","qualifiers":8,"knockoutLegs":"single"}'::jsonb
     where id=$1 and status <> 'active'`,
    [FREE_TOURNAMENT_ID, FREE_TOURNAMENT_NAME],
  );
  await client.query(
    `insert into public.tournament_categories (
       id,organization_id,tournament_id,name,slug,description,status,sort_order,
       gender_category,sport_modality,team_size
     ) values (
       $1,$2,$3,'Categoría Abierta','abierta','Liga QA previa al append.',
       'active',1,'open','football_5',5
     ) on conflict (id) do nothing`,
    [FREE_CATEGORY_ID, FREE_ORGANIZATION_ID, FREE_TOURNAMENT_ID],
  );

  for (const [index, team] of fixture.teams.entries()) {
    await client.query(
      `insert into public.tournament_team_entries (
         id,organization_id,season_id,tournament_id,category_id,name,slug,short_name,
         primary_color,secondary_color,status,registration_source,created_by,
         submitted_by,submitted_at,reviewed_by,reviewed_at,approved_at,idempotency_key
       ) values (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,'#151020','approved','provisional',$10,
         $10,$11,$10,$11,$11,$12
       ) on conflict (id) do nothing`,
      [
        team.id,
        FREE_ORGANIZATION_ID,
        FREE_SEASON_ID,
        FREE_TOURNAMENT_ID,
        FREE_CATEGORY_ID,
        team.name,
        team.slug,
        team.shortName,
        `#${['7657FF', '2E86DE', 'E74C3C', '16A085'][index % 4]}`,
        ownerUserId,
        FIXED_AT,
        stableUuid(`${FIXTURE_KEY}:team:idempotency:${index + 1}`),
      ],
    );
  }

  await client.query(
    `insert into public.tournament_participant_sets (
       id,organization_id,season_id,tournament_id,category_id,version_number,status,
       participant_fingerprint,frozen_by,frozen_at,idempotency_key
     ) values ($1,$2,$3,$4,$5,1,'frozen',$6,$7,$8,$9)
     on conflict (id) do nothing`,
    [
      FREE_PARTICIPANT_SET_ID,
      FREE_ORGANIZATION_ID,
      FREE_SEASON_ID,
      FREE_TOURNAMENT_ID,
      FREE_CATEGORY_ID,
      fixture.participantFingerprint,
      ownerUserId,
      FIXED_AT,
      stableUuid(`${FIXTURE_KEY}:participant-set:idempotency`),
    ],
  );
  for (const [index, team] of fixture.teams.entries()) {
    await client.query(
      `insert into public.tournament_competition_participants (
         id,organization_id,season_id,tournament_id,category_id,participant_set_id,
         team_entry_id,seed_number,status,snapshot_name,snapshot_short_name,
         snapshot_primary_color,snapshot_secondary_color,frozen_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$10,$11,'#151020',$12)
       on conflict (id) do nothing`,
      [
        team.participantId,
        FREE_ORGANIZATION_ID,
        FREE_SEASON_ID,
        FREE_TOURNAMENT_ID,
        FREE_CATEGORY_ID,
        FREE_PARTICIPANT_SET_ID,
        team.id,
        index + 1,
        team.name,
        team.shortName,
        `#${['7657FF', '2E86DE', 'E74C3C', '16A085'][index % 4]}`,
        FIXED_AT,
      ],
    );
  }

  await client.query(
    `insert into public.tournament_fixture_versions (
       id,organization_id,season_id,tournament_id,category_id,participant_set_id,
       version_number,status,generation_method,seed,participant_fingerprint,
       configuration_snapshot,created_by,idempotency_key,published_at
     ) values (
       $1,$2,$3,$4,$5,$6,1,'published','automatic',$7,$8,
       '{"competitionFormat":"league","leagueRounds":"single","qualifiers":8}'::jsonb,
       $9,$10,$11
     ) on conflict (id) do nothing`,
    [
      FREE_FIXTURE_VERSION_ID,
      FREE_ORGANIZATION_ID,
      FREE_SEASON_ID,
      FREE_TOURNAMENT_ID,
      FREE_CATEGORY_ID,
      FREE_PARTICIPANT_SET_ID,
      FIXTURE_KEY,
      fixture.participantFingerprint,
      ownerUserId,
      stableUuid(`${FIXTURE_KEY}:fixture-version:idempotency`),
      FIXED_AT,
    ],
  );
  await client.query(
    `insert into public.tournament_phases (
       id,organization_id,tournament_id,category_id,fixture_version_id,name,
       phase_type,sequence_number,status,configuration
     ) values ($1,$2,$3,$4,$5,'Liga', 'league',1,'scheduled','{"rounds":7}'::jsonb)
     on conflict (id) do nothing`,
    [
      FREE_LEAGUE_PHASE_ID,
      FREE_ORGANIZATION_ID,
      FREE_TOURNAMENT_ID,
      FREE_CATEGORY_ID,
      FREE_FIXTURE_VERSION_ID,
    ],
  );
  for (const round of fixture.rounds) {
    await client.query(
      `insert into public.tournament_rounds (
         id,organization_id,tournament_id,category_id,fixture_version_id,phase_id,
         round_number,name,status,sort_order
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,'scheduled',$9)
       on conflict (id) do nothing`,
      [
        round.id,
        FREE_ORGANIZATION_ID,
        FREE_TOURNAMENT_ID,
        FREE_CATEGORY_ID,
        FREE_FIXTURE_VERSION_ID,
        FREE_LEAGUE_PHASE_ID,
        round.number,
        round.name,
        round.number - 1,
      ],
    );
  }
  for (const match of fixture.matches) {
    await client.query(
      `insert into public.tournament_matches (
         id,organization_id,season_id,tournament_id,category_id,participant_set_id,
         fixture_version_id,phase_id,round_id,match_number,home_participant_id,
         away_participant_id,status,scheduled_at,duration_minutes,created_by
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'ready',null,40,$13)
       on conflict (id) do nothing`,
      [
        match.id,
        FREE_ORGANIZATION_ID,
        FREE_SEASON_ID,
        FREE_TOURNAMENT_ID,
        FREE_CATEGORY_ID,
        FREE_PARTICIPANT_SET_ID,
        FREE_FIXTURE_VERSION_ID,
        FREE_LEAGUE_PHASE_ID,
        match.roundId,
        match.matchNumber,
        match.home.participantId,
        match.away.participantId,
        ownerUserId,
      ],
    );
    const matchSnapshot = JSON.stringify({
      state: 'official',
      outcome: 'played',
      seedKey: FIXTURE_KEY,
    });
    await client.query(
      `insert into public.tournament_match_operations (
         id,organization_id,season_id,tournament_id,category_id,fixture_version_id,
         phase_id,round_id,match_id,home_team_entry_id,away_team_entry_id,status,
         match_status,operation_version,match_snapshot,home_team_snapshot,
         away_team_snapshot,opened_by,opened_at,submitted_by,submitted_at,
         validated_by,validated_at,official_by,official_at,closed_at
       ) values (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft','ready',1,$12,$13,$14,
         $15,$16,null,null,null,null,null,null,null
       ) on conflict (id) do nothing`,
      [
        match.operationId,
        FREE_ORGANIZATION_ID,
        FREE_SEASON_ID,
        FREE_TOURNAMENT_ID,
        FREE_CATEGORY_ID,
        FREE_FIXTURE_VERSION_ID,
        FREE_LEAGUE_PHASE_ID,
        match.roundId,
        match.id,
        match.home.id,
        match.away.id,
        matchSnapshot,
        JSON.stringify({ id: match.home.id, name: match.home.name }),
        JSON.stringify({ id: match.away.id, name: match.away.name }),
        ownerUserId,
        match.scheduledAt,
      ],
    );
    await client.query(
      `insert into public.tournament_match_scores (
         match_operation_id,organization_id,match_id,home_score,away_score,score_type
       ) select $1,$2,$3,$4,$5,'played'
       where exists (
         select 1 from public.tournament_match_operations
         where id=$1 and status <> 'official'
       )
       on conflict (match_operation_id) do nothing`,
      [
        match.operationId,
        FREE_ORGANIZATION_ID,
        match.id,
        match.homeScore,
        match.awayScore,
      ],
    );
    await client.query(
      `insert into public.tournament_match_outcomes (
         match_operation_id,organization_id,match_id,outcome_type,started_at,ended_at,
         events_remain_valid,counts_for_standings,counts_for_player_stats,
         requires_resolution
       ) select $1,$2,$3,'played',$4,$5,true,true,true,false
       where exists (
         select 1 from public.tournament_match_operations
         where id=$1 and status <> 'official'
       )
       on conflict (match_operation_id) do nothing`,
      [
        match.operationId,
        FREE_ORGANIZATION_ID,
        match.id,
        match.scheduledAt,
        new Date(Date.parse(match.scheduledAt) + 40 * 60000).toISOString(),
      ],
    );
    await client.query(
      `update public.tournament_match_operations set
         status='official',match_status='official',
         submitted_by=$2,submitted_at=$3,validated_by=$2,validated_at=$3,
         official_by=$2,official_at=$3,closed_at=$3
       where id=$1 and status <> 'official'`,
      [match.operationId, ownerUserId, match.scheduledAt],
    );
  }

  await client.query(
    `insert into public.tournament_standings_revisions (
       id,organization_id,season_id,tournament_id,category_id,fixture_version_id,
       phase_id,revision_number,status,source_fingerprint,configuration_snapshot,
       rebuild_reason,calculated_by,idempotency_key,calculated_at,published_by,published_at
     ) values (
       $1,$2,$3,$4,$5,$6,$7,1,'published',$8,
       '{"pointsWin":3,"pointsDraw":1,"pointsLoss":0}'::jsonb,
       'Materialización determinista del fixture QA pre-Playoffs.',$9,$10,$11,$9,$11
     ) on conflict (id) do nothing`,
    [
      FREE_STANDINGS_REVISION_ID,
      FREE_ORGANIZATION_ID,
      FREE_SEASON_ID,
      FREE_TOURNAMENT_ID,
      FREE_CATEGORY_ID,
      FREE_FIXTURE_VERSION_ID,
      FREE_LEAGUE_PHASE_ID,
      fixture.standingsFingerprint,
      ownerUserId,
      stableUuid(`${FIXTURE_KEY}:standings:idempotency`),
      FIXED_AT,
    ],
  );
  for (const match of fixture.matches) {
    await client.query(
      `insert into public.tournament_projection_sources (
         revision_id,organization_id,match_operation_id,match_id,official_at
       ) values ($1,$2,$3,$4,$5)
       on conflict (revision_id,match_operation_id) do nothing`,
      [
        FREE_STANDINGS_REVISION_ID,
        FREE_ORGANIZATION_ID,
        match.operationId,
        match.id,
        match.scheduledAt,
      ],
    );
  }
  for (const row of fixture.standings) {
    const goalDifference = row.goalsFor - row.goalsAgainst;
    await client.query(
      `insert into public.tournament_team_standings (
         id,revision_id,organization_id,tournament_id,category_id,phase_id,
         participant_id,team_entry_id,position,played,won,drawn,lost,goals_for,
         goals_against,goal_difference,base_points,points_adjustment,points,
         walkovers,administrative_results,fair_play_points,classification_status,
         tiebreak_trace
       ) values (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,0,$17,
         0,0,0,'qualified','{"order":["points","goal_difference","goals_for"]}'::jsonb
       ) on conflict (id) do nothing`,
      [
        stableUuid(`${FIXTURE_KEY}:standing:${row.team.id}`),
        FREE_STANDINGS_REVISION_ID,
        FREE_ORGANIZATION_ID,
        FREE_TOURNAMENT_ID,
        FREE_CATEGORY_ID,
        FREE_LEAGUE_PHASE_ID,
        row.team.participantId,
        row.team.id,
        row.position,
        row.played,
        row.won,
        row.drawn,
        row.lost,
        row.goalsFor,
        row.goalsAgainst,
        goalDifference,
        row.points,
      ],
    );
  }
  await client.query(
    `update public.tournaments set status='active',started_at=$2 where id=$1`,
    [FREE_TOURNAMENT_ID, FIXED_AT],
  );
  await client.query(
    `insert into public.user_tournament_context_preferences (
       user_id,organization_id,active_season_id,active_tournament_id
     ) values ($1,$2,$3,$4)
     on conflict (user_id,organization_id) do update set
       active_season_id = excluded.active_season_id,
       active_tournament_id = excluded.active_tournament_id`,
    [ownerUserId, FREE_ORGANIZATION_ID, FREE_SEASON_ID, FREE_TOURNAMENT_ID],
  );
}

async function applyFixture(client) {
  await client.query('begin isolation level serializable');
  try {
    await client.query(
      'select pg_advisory_xact_lock(hashtextextended($1,0))',
      [FIXTURE_KEY],
    );
    const owner = await client.query(
      `select membership.user_id
       from public.tournament_organization_members membership
       join public.tournament_organizations organization
         on organization.id = membership.organization_id
       where organization.slug = $1
         and membership.role = 'owner'
         and membership.status = 'active'`,
      [POST_ORGANIZATION_SLUG],
    );
    const ownerUserId = owner.rows[0]?.user_id;
    if (!ownerUserId) throw new Error('No se encontró el Owner QA canónico.');

    await seedPremiumFixture(client, ownerUserId);
    await seedFreeLeagueFixture(client, ownerUserId);

    const fixture = await readFixture(client);
    if (!fixture) {
      throw new Error('Los fixtures QA no produjeron el contrato esperado.');
    }
    await client.query('commit');
    return fixture;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const doApply = args.has('--apply-local');
  const doReport = args.has('--report');
  if (args.size > 1 || (!doApply && !doReport && args.size > 0)) {
    throw new Error('Use exactly one of --apply-local or --report.');
  }
  if (!doApply && !doReport) {
    console.log(JSON.stringify({
      status: 'plan',
      writes: false,
      fixtureKey: FIXTURE_KEY,
      freeOrganizationSlug: FREE_ORGANIZATION_SLUG,
      premiumOrganizationSlug: PREMIUM_ORGANIZATION_SLUG,
      postOrganizationSlug: POST_ORGANIZATION_SLUG,
      apply: 'QA_ALLOW_PLANS_REVIEW_FIXTURE=true node scripts/qa/seed-torneos-plan-review-fixtures.mjs --apply-local',
    }, null, 2));
    return;
  }
  if (doApply && process.env.QA_ALLOW_PLANS_REVIEW_FIXTURE !== 'true') {
    throw new ProductionGuardError('QA_ALLOW_PLANS_REVIEW_FIXTURE=true is required.');
  }
  const target = assertLocalDatabaseTarget(process.env);
  const client = new pg.Client({ connectionString: target.databaseUrl });
  await client.connect();
  try {
    const fixture = doApply ? await applyFixture(client) : await readFixture(client);
    if (!fixture) throw new Error('Los fixtures de review no están aplicados o fueron modificados.');
    console.log(JSON.stringify({ status: doApply ? 'ready' : 'report', ...fixture }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof ProductionGuardError ? error.message : error);
  process.exitCode = 1;
});
