#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  USERS,
  cleanupMatchOperationsHarness,
  connect,
  setup,
  value,
} from './torneos-match-operations.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS = [
  '20260810160355_tournament_entitlements_foundation.sql',
  '20260821213918_plans_entitlements_foundation_v2.sql',
  '20260825194025_tournament_commercial_checkout_foundation.sql',
];

let checks = 0;
let failures = 0;
let sequence = 10;

function ok(condition, label, detail = '') {
  checks += 1;
  if (condition) console.log(`  ✔ ${label}`);
  else {
    failures += 1;
    console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(actual, expected, label) {
  ok(actual === expected, label, `esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`);
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

function uuid(index) {
  return `98000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

async function createOrganization(client, name, slug, key) {
  return value(client, 'select public.create_tournament_organization($1,$2,$3::uuid)', [name, slug, key]);
}

async function createSeason(client, organizationId) {
  return value(
    client,
    'select public.create_tournament_season($1,$2,$3,null,null,$4::uuid)',
    [organizationId, 'Temporada Comercial', 'temporada-comercial', uuid(2)],
  );
}

async function createTournament(client, organizationId, seasonId, label = null) {
  sequence += 1;
  const suffix = label || `edicion-${sequence}`;
  return value(
    client,
    `select public.create_tournament_with_defaults(
      $1,$2,$3,$4,null,'football_7','league','open',null,null,$5::uuid
    )`,
    [organizationId, seasonId, `Copa ${suffix}`, `copa-${suffix}`, uuid(sequence)],
  );
}

async function createPurchase(client, organizationId, tournamentId, key = uuid(++sequence)) {
  return value(
    client,
    `select public.create_fake_tournament_purchase(
      $1,$2,'torneos_premium',$3::uuid,'local'
    )`,
    [organizationId, tournamentId, key],
  );
}

async function applyFake(service, purchaseId, status, errorCode = null) {
  return value(
    service,
    'select public.apply_fake_tournament_payment_status($1,$2,null,null,$3)',
    [purchaseId, status, errorCode],
  );
}

async function effective(client, organizationId, tournamentId) {
  return value(
    client,
    'select public.get_effective_tournament_entitlements($1,$2)',
    [organizationId, tournamentId],
  );
}

async function approvedPurchase(owner, service, organizationId, seasonId, label) {
  const tournament = await createTournament(owner, organizationId, seasonId, label);
  const purchase = await createPurchase(owner, organizationId, tournament.id);
  const approved = await applyFake(service, purchase.id, 'approved');
  return { tournament, purchase: approved };
}

async function run() {
  console.log('Arma2 Torneos · checkout comercial FAKE PostgreSQL/RLS');
  try {
    const admin = await setup([
      '20260726200000_tournament_standings_discipline.sql',
      '20260726230000_tournament_participant_hub.sql',
      '20260727010000_tournament_communications.sql',
      '20260727060000_tournament_media_galleries.sql',
    ]);
    for (const migration of MIGRATIONS) {
      await admin.query(fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', migration), 'utf8'));
    }

    const owner = await connect({ role: 'authenticated', userId: USERS.outsider });
    const service = await connect({ role: 'service_role' });
    const participant = await connect({ role: 'authenticated', userId: USERS.captainHome });
    const anonymous = await connect({ role: 'anon' });
    eq(Number(await value(
      admin,
      `select count(*) from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'service_role'
         and table_name in (
           'tournament_commercial_products','tournament_commercial_offers',
           'tournament_purchases','tournament_purchase_events',
           'tournament_plan_grant_events','tournament_organization_role_capabilities',
           'tournament_plan_grants'
         ) and privilege_type <> 'SELECT'`,
    )), 0, 'service_role no conserva DML ni TRUNCATE sobre el dominio comercial');
    eq(Number(await value(
      admin,
      `select count(*) from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'service_role'
         and table_name in (
           'tournament_commercial_products','tournament_commercial_offers',
           'tournament_purchases','tournament_purchase_events',
           'tournament_plan_grant_events','tournament_organization_role_capabilities',
           'tournament_plan_grants'
         ) and privilege_type = 'SELECT'`,
    )), 7, 'service_role conserva sólo las siete lecturas necesarias');
    const organization = await createOrganization(
      owner, 'Liga Checkout QA', 'liga-checkout-qa', uuid(1),
    );
    const organizationId = organization.organization.id;
    const season = await createSeason(owner, organizationId);
    const first = await createTournament(owner, organizationId, season.id, 'primer-free');
    const second = await createTournament(owner, organizationId, season.id, 'segunda-draft');

    await expectError(
      () => service.query(
        `insert into public.tournament_plan_grants(
          organization_id,tournament_id,plan_code,source,reason
        ) values ($1,$2,'PREMIUM','purchase','Bypass directo no permitido')`,
        [organizationId, second.id],
      ),
      /permission denied/,
      'service_role no puede activar Premium insertando grants directamente',
    );

    await admin.query(
      `insert into public.tournament_organization_members(
        organization_id,user_id,role,status,invited_by,joined_at
      ) values ($1,$2,'admin','active',$4,now()),($1,$3,'collaborator','active',$4,now())`,
      [organizationId, USERS.admin, USERS.collaborator, USERS.outsider],
    );
    const orgAdmin = await connect({ role: 'authenticated', userId: USERS.admin });
    const collaborator = await connect({ role: 'authenticated', userId: USERS.collaborator });

    const firstPlan = await effective(owner, organizationId, first.id);
    const secondPlan = await effective(owner, organizationId, second.id);
    eq(firstPlan.plan, 'FREE', 'primer torneo FREE queda intacto');
    eq(firstPlan.assignmentSource, 'first_free', 'primer torneo conserva first_free');
    eq(second.status, 'draft', 'segunda edición se crea como draft');
    eq(secondPlan.plan, 'PREMIUM_REQUIRED', 'segunda edición no recibe FREE unassigned');
    eq(secondPlan.requiresPremium, true, 'segunda edición declara Premium requerido');

    const secondCategory = await value(
      owner,
      `select public.save_tournament_category(
        $1,$2,null,'Primera','primera',null,0,null,null,null,'football_7',7::smallint,'active'
      )`,
      [organizationId, second.id],
    );
    ok(Boolean(secondCategory.id), 'segunda edición permite configuración básica');
    await expectError(
      () => admin.query("update public.tournaments set status = 'registration' where id = $1", [second.id]),
      /TORNEOS_PREMIUM_REQUIRED/,
      'segunda edición bloquea activación/inscripción antes de Premium',
    );
    await expectError(
      () => admin.query(
        `insert into public.tournament_team_entries(
          organization_id,season_id,tournament_id,category_id,name,slug,status,
          registration_source,created_by,idempotency_key
        ) values ($1,$2,$3,$4,'Equipo bloqueado','equipo-bloqueado','draft','provisional',$5,$6)`,
        [organizationId, season.id, second.id, secondCategory.id, USERS.outsider, uuid(90)],
      ),
      /TORNEOS_PREMIUM_REQUIRED/,
      'segunda edición bloquea inscripción efectiva de equipos',
    );

    eq(await value(owner,
      "select public.has_tournament_organization_capability($1,'billing.manage')", [organizationId]),
    true, 'owner tiene billing.manage');
    eq(await value(orgAdmin,
      "select public.has_tournament_organization_capability($1,'billing.manage')", [organizationId]),
    true, 'admin tiene billing.manage');
    eq(await value(collaborator,
      "select public.has_tournament_organization_capability($1,'billing.manage')", [organizationId]),
    false, 'collaborator no tiene billing.manage');
    eq(await value(owner,
      "select 'billing.manage' = any(public.tournament_role_capabilities('owner'))"),
    true, 'billing.manage forma parte de la matriz organizacional explícita');

    const idempotencyKey = uuid(100);
    const ownerPurchase = await createPurchase(owner, organizationId, second.id, idempotencyKey);
    eq(ownerPurchase.amount, 39900, 'precio se resuelve sólo server-side');
    eq(ownerPurchase.listAmount, 49900, 'snapshot conserva precio de lista');
    const replay = await createPurchase(owner, organizationId, second.id, idempotencyKey);
    eq(replay.id, ownerPurchase.id, 'double click devuelve la misma purchase');
    eq(replay.idempotentReplay, true, 'double click se marca como replay');
    const existingOpen = await createPurchase(orgAdmin, organizationId, second.id, uuid(101));
    eq(existingOpen.id, ownerPurchase.id, 'una purchase abierta se reutiliza');
    eq(existingOpen.existingOpenPurchase, true, 'purchase ya abierta queda explícita');

    await expectError(
      () => createPurchase(collaborator, organizationId, second.id, uuid(102)),
      /TORNEOS_BILLING_FORBIDDEN/,
      'collaborator no puede comprar',
    );
    await expectError(
      () => createPurchase(participant, organizationId, second.id, uuid(103)),
      /TORNEOS_BILLING_FORBIDDEN/,
      'participante no puede comprar',
    );
    const foreignOrganization = await createOrganization(
      participant, 'Liga Cross Tenant', 'liga-cross-tenant', uuid(104),
    );
    ok(Boolean(foreignOrganization.organization.id), 'fixture cross-tenant tiene organización propia');
    const foreignSeason = await createSeason(participant, foreignOrganization.organization.id);
    const foreignTournament = await createTournament(
      participant, foreignOrganization.organization.id, foreignSeason.id, 'foreign-purchase',
    );
    const foreignPurchase = await createPurchase(
      participant, foreignOrganization.organization.id, foreignTournament.id, uuid(106),
    );
    await expectError(
      () => value(owner, 'select public.get_tournament_purchase($1)', [foreignPurchase.id]),
      /TORNEOS_PURCHASE_FORBIDDEN/,
      'una purchase de otro tenant no se puede consultar por UUID conocido',
    );
    await expectError(
      () => createPurchase(participant, organizationId, second.id, uuid(105)),
      /TORNEOS_BILLING_FORBIDDEN/,
      'owner de otro tenant no puede comprar',
    );

    await expectError(
      () => admin.query(
        "update public.tournament_commercial_offers set amount = 39899 where offer_code = 'launch'",
      ),
      /TORNEOS_REFERENCED_OFFER_IMMUTABLE/,
      'oferta referenciada queda inmutable',
    );
    await expectError(
      () => admin.query('update public.tournament_purchases set amount_snapshot = 1 where id = $1', [ownerPurchase.id]),
      /TORNEOS_PURCHASE_SNAPSHOT_IMMUTABLE/,
      'snapshot comercial de purchase queda inmutable',
    );

    const concurrentTournament = await createTournament(owner, organizationId, season.id, 'concurrente');
    const ownerParallel = await connect({ role: 'authenticated', userId: USERS.outsider });
    const [concurrentA, concurrentB] = await Promise.all([
      createPurchase(owner, organizationId, concurrentTournament.id, uuid(110)),
      createPurchase(ownerParallel, organizationId, concurrentTournament.id, uuid(111)),
    ]);
    eq(concurrentA.id, concurrentB.id, 'dos checkouts concurrentes convergen en una purchase');

    const pendingTournament = await createTournament(owner, organizationId, season.id, 'fake-pending');
    const pendingPurchase = await createPurchase(owner, organizationId, pendingTournament.id);
    eq((await applyFake(service, pendingPurchase.id, 'pending')).status, 'pending', 'FAKE soporta pending');
    const rejected = await applyFake(service, pendingPurchase.id, 'rejected');
    eq(rejected.status, 'rejected', 'FAKE soporta rejected');
    const retryAfterReject = await createPurchase(owner, organizationId, pendingTournament.id);
    ok(retryAfterReject.id !== pendingPurchase.id, 'rejected permite un checkout nuevo');

    const expiredTournament = await createTournament(owner, organizationId, season.id, 'fake-expired');
    const expiredPurchase = await createPurchase(owner, organizationId, expiredTournament.id);
    eq((await applyFake(service, expiredPurchase.id, 'expired')).status, 'expired', 'FAKE soporta expired');

    const cancelledTournament = await createTournament(owner, organizationId, season.id, 'cancelled');
    const cancelledPurchase = await createPurchase(owner, organizationId, cancelledTournament.id);
    const cancelled = await value(
      owner,
      'select public.cancel_tournament_purchase($1)',
      [cancelledPurchase.id],
    );
    eq(cancelled.status, 'cancelled', 'state machine soporta cancelled');
    const retryAfterCancel = await createPurchase(owner, organizationId, cancelledTournament.id);
    ok(retryAfterCancel.id !== cancelledPurchase.id, 'cancelled permite un checkout nuevo');

    const failedTournament = await createTournament(owner, organizationId, season.id, 'activation-retry');
    const failedPurchase = await createPurchase(owner, organizationId, failedTournament.id);
    const failedActivation = await applyFake(service, failedPurchase.id, 'approved', 'qa_once');
    eq(failedActivation.activationErrorCode, 'qa_once', 'fallo de activación queda registrado');
    eq(failedActivation.status, 'preference_created', 'fallo no afirma approved ni Premium');
    const recovered = await applyFake(service, failedPurchase.id, 'approved');
    eq(recovered.status, 'approved', 'retry de activación completa la compra');
    eq((await effective(owner, organizationId, failedTournament.id)).plan, 'PREMIUM',
      'FAKE approved activa Premium desde grant');
    const activationReplay = await applyFake(service, failedPurchase.id, 'approved');
    eq(activationReplay.idempotentReplay, true, 'activación es idempotente');

    const approved = await applyFake(service, ownerPurchase.id, 'approved');
    eq(approved.status, 'approved', 'owner compra y FAKE approved verifica pago');
    eq((await effective(owner, organizationId, second.id)).plan, 'PREMIUM',
      'approved habilita la segunda edición');
    await expectError(
      () => createPurchase(owner, organizationId, second.id, uuid(120)),
      /TORNEOS_ALREADY_PREMIUM/,
      'torneo ya Premium rechaza checkout',
    );

    const adminTournament = await createTournament(owner, organizationId, season.id, 'admin-compra');
    const adminPurchase = await createPurchase(orgAdmin, organizationId, adminTournament.id);
    ok(Boolean(adminPurchase.id), 'admin puede crear purchase');

    const refundCase = await approvedPurchase(owner, service, organizationId, season.id, 'refund');
    const refunded = await value(
      service,
      "select public.apply_tournament_purchase_reversal($1,'refund',$2)",
      [refundCase.purchase.id, 'Refund total confirmado por QA'],
    );
    eq(refunded.status, 'refunded', 'refund total marca la purchase');
    eq((await effective(owner, organizationId, refundCase.tournament.id)).plan, 'PREMIUM_REQUIRED',
      'refund revoca Premium sin borrar el grant');

    const chargebackCase = await approvedPurchase(owner, service, organizationId, season.id, 'chargeback');
    await value(service,
      "select public.apply_tournament_purchase_reversal($1,'chargeback_disputed',$2)",
      [chargebackCase.purchase.id, 'Chargeback abierto en disputa por QA']);
    eq((await effective(owner, organizationId, chargebackCase.tournament.id)).plan, 'PREMIUM_REQUIRED',
      'chargeback en disputa suspende Premium');
    await value(service,
      "select public.apply_tournament_purchase_reversal($1,'chargeback_restored',$2)",
      [chargebackCase.purchase.id, 'Chargeback revertido a favor de Arma2']);
    eq((await effective(owner, organizationId, chargebackCase.tournament.id)).plan, 'PREMIUM',
      'chargeback revertido restaura Premium');
    await value(service,
      "select public.apply_tournament_purchase_reversal($1,'chargeback_buyer_won',$2)",
      [chargebackCase.purchase.id, 'Chargeback firme a favor del comprador']);
    eq((await effective(owner, organizationId, chargebackCase.tournament.id)).plan, 'PREMIUM_REQUIRED',
      'chargeback firme revoca Premium');
    eq(Number(await value(admin,
      'select count(*) from public.tournament_plan_grants where origin_purchase_id = $1',
      [chargebackCase.purchase.id])), 1, 'refund/chargeback preservan el grant original');

    const catalog = await value(anonymous,
      'select public.get_public_tournament_commercial_catalog(1)');
    eq(catalog.productCode, 'torneos_premium', 'catálogo público expone producto versionado');
    eq(catalog.effectivePrice, 39900, 'catálogo público expone oferta vigente');
    const serializedCatalog = JSON.stringify(catalog);
    for (const privateField of [
      'organizationId', 'tournamentId', 'buyerUserId', 'purchaseId',
      'providerPreferenceId', 'grantId', 'metadata', 'override',
    ]) {
      ok(!serializedCatalog.includes(privateField), `catálogo público no filtra ${privateField}`);
    }
    await expectError(
      () => owner.query('select * from public.tournament_purchases'),
      /permission denied/,
      'browser no lee purchases directamente',
    );
    await expectError(
      () => admin.query('update public.tournament_purchase_events set event_type = event_type'),
      /TORNEOS_APPEND_ONLY_RESOURCE/,
      'eventos de purchase son append-only',
    );
  } catch (error) {
    failures += 1;
    console.error(error);
  } finally {
    await cleanupMatchOperationsHarness();
  }

  console.log(`\n${checks - failures}/${checks} verificaciones aprobadas`);
  if (failures) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await run();
}
