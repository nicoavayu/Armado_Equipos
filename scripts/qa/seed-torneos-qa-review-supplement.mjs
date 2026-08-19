#!/usr/bin/env node
//
// QA Review Seed Supplement v1 — LOCAL solamente.
//
// El dataset local ya tiene competencia, fixture, sedes, programación y
// comunicados. Lo que no tiene es todo aquello que sólo existe cuando alguien
// subió un archivo o recorrió el flujo completo del acta: escudos, retratos
// vivos, fotos de galería, una convocatoria y un partido con eventos en los dos
// tiempos. Sin eso la revisión visual se hace contra placeholders y no dice
// nada.
//
// Este suplemento cierra exactamente esos huecos, y nada más:
//
//   1. escudos para los ocho equipos del Apertura;
//   2. tres retratos vivos con recorte real y objeto real en Storage;
//   3. una galería con fotos por el tier MVP_SIMPLE;
//   4. convocatoria (titulares y suplentes) para los dos equipos de un partido;
//   5. acta completa de ese partido: primer y segundo tiempo, goles, asistencia,
//      amarillas y una roja, hasta quedar oficial;
//   6. la página pública apuntando al torneo poblado y no al vacío;
//   7. unos pocos partidos Arma2 para que el switcher no aterrice vacío.
//
// Reglas que el script respeta y verifica antes de escribir:
//
//   * sólo LOCAL, fail-closed: sin las variables de destino loopback no arranca;
//   * idempotente por `seed_key`: una segunda corrida no duplica nada;
//   * determinístico: los identificadores y los bytes de cada imagen salen de
//     un hash de su etiqueta, así que dos máquinas producen el mismo dataset;
//   * sin secretos, sin tokens y sin URLs firmadas persistidas: los objetos se
//     suben con la service-role key que vive en el proceso y nunca se guarda ni
//     se imprime nada de eso;
//   * sin consentimiento de publicación falseado: los retratos quedan con
//     `publication_consent = 'unknown'`, que es lo que corresponde para revisar
//     superficies privadas.
//
// Uso:
//   node scripts/qa/seed-torneos-qa-review-supplement.mjs                  (plan)
//   ... --report                                                          (conteos)
//   QA_ALLOW_REVIEW_SUPPLEMENT=true ... --apply-local
//   QA_ALLOW_REVIEW_SUPPLEMENT_CLEANUP=true QA_CONFIRM_REVIEW_SUPPLEMENT=true \
//     ... --cleanup-local
//
import crypto from 'node:crypto';
import process from 'node:process';

import pg from 'pg';

import productionGuard from './production-guard.js';
import { stableUuid } from './torneos-demo-dataset.mjs';
import { galleryPhotoPng, playerPortraitPng, sha256Hex, teamCrestPng } from './qa-review-images.mjs';

const { assertLocalDatabaseTarget, assertSafeQaValue, ProductionGuardError } = productionGuard;

const SEED_KEY = 'qa.review.supplement.v1';
const MARKER_ACTION = 'qa.review.supplement_applied';
const MARKER_ID = stableUuid(SEED_KEY);
const ORGANIZATION_SLUG = 'qa-metropolitana';
const ACTIVE_TOURNAMENT_NAME = 'Torneo Apertura QA 2026';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

const PORTRAIT_BUCKET = 'tournament-player-portraits';
const BRANDING_BUCKET = 'tournament-branding';
const MEDIA_BUCKET = 'tournament-media';

function uuid(label) {
  return stableUuid(`${SEED_KEY}:${label}`);
}

// ---------------------------------------------------------------------------
// Destino
// ---------------------------------------------------------------------------

function assertLocalStorageTarget(env = process.env) {
  const rawUrl = String(env.QA_SUPABASE_URL || '').trim();
  const serviceKey = String(env.QA_SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const anonKey = String(env.QA_SUPABASE_ANON_KEY || '').trim();
  const jwtSecret = String(env.QA_LOCAL_JWT_SECRET || '').trim();
  if (!rawUrl) {
    throw new ProductionGuardError('QA_SUPABASE_URL is required for storage writes.');
  }
  if (!serviceKey) {
    throw new ProductionGuardError(
      'QA_SUPABASE_SERVICE_ROLE_KEY is required in memory for storage writes.',
    );
  }
  if (!anonKey || jwtSecret.length < 32) {
    throw new ProductionGuardError(
      'QA_SUPABASE_ANON_KEY and QA_LOCAL_JWT_SECRET are required in memory: the '
      + 'MVP_SIMPLE pipeline runs through Edge Functions and needs a real actor token.',
    );
  }
  assertSafeQaValue(rawUrl, 'QA_SUPABASE_URL', env);
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new ProductionGuardError('QA_SUPABASE_URL must be a loopback HTTP origin.');
  }
  return { origin: url.origin, serviceKey, anonKey, jwtSecret };
}

function base64UrlJson(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * Token de actor firmado contra el secreto del stack LOCAL.
 *
 * No es un atajo: el tier MVP_SIMPLE valida al subir y al finalizar, y esas dos
 * puertas son Edge Functions que exigen un JWT de usuario. Los QA users no
 * tienen contraseña a propósito, así que la sesión se arma igual que en
 * `prepare-torneos-local-auth-states.mjs`. El token vive en memoria, dura lo que
 * dura el proceso y nunca se imprime ni se guarda.
 */
function localActorToken(userId, secret) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64UrlJson({ alg: 'HS256', typ: 'JWT' })}.${base64UrlJson({
    aud: 'authenticated', exp: now + 3600, iat: now, iss: 'supabase-demo',
    sub: userId, role: 'authenticated', aal: 'aal1',
  })}`;
  const signature = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

/** Cliente mínimo de Storage. La key vive sólo acá y nunca se imprime. */
function storageClient({ origin, serviceKey, anonKey, jwtSecret }) {
  const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
  const actorHeaders = (token, extra = {}) => ({
    apikey: anonKey, authorization: `Bearer ${token}`, ...extra,
  });
  return {
    origin,
    tokenFor(userId) {
      return localActorToken(userId, jwtSecret);
    },
    async rpc(token, name, args, expected = 200) {
      const response = await fetch(`${origin}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: actorHeaders(token, { 'content-type': 'application/json' }),
        body: JSON.stringify(args),
      });
      const text = await response.text();
      if (response.status !== expected) {
        throw new Error(`rpc ${name} (${response.status}): ${text}`);
      }
      return text ? JSON.parse(text) : null;
    },
    async edge(token, functionName, body, expected = 200) {
      const response = await fetch(`${origin}/functions/v1/${functionName}`, {
        method: 'POST',
        headers: actorHeaders(token, { 'content-type': 'application/json' }),
        body: JSON.stringify(body),
      });
      const text = await response.text();
      if (response.status !== expected) {
        throw new Error(`edge ${functionName} (${response.status}): ${text}`);
      }
      return text ? JSON.parse(text) : null;
    },
    async putSigned(token, uploadUrl, bytes, contentType) {
      const absolute = new URL(uploadUrl, origin);
      if (!LOOPBACK_HOSTS.has(absolute.hostname)) {
        throw new Error(`signed upload URL is not loopback: ${absolute.hostname}`);
      }
      const response = await fetch(absolute.toString(), {
        method: 'PUT',
        headers: actorHeaders(token, { 'content-type': contentType }),
        body: bytes,
      });
      if (response.status !== 201) {
        throw new Error(`signed upload (${response.status}): ${await response.text()}`);
      }
    },
    async put(bucket, objectPath, bytes, contentType) {
      const response = await fetch(
        `${origin}/storage/v1/object/${bucket}/${objectPath}`,
        {
          method: 'POST',
          headers: { ...headers, 'content-type': contentType, 'x-upsert': 'true' },
          body: bytes,
        },
      );
      if (!response.ok) {
        throw new Error(
          `storage PUT ${bucket}/${objectPath} failed (${response.status}): ${await response.text()}`,
        );
      }
    },
    async remove(bucket, objectPaths) {
      if (objectPaths.length === 0) return;
      const response = await fetch(`${origin}/storage/v1/object/${bucket}`, {
        method: 'DELETE',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: objectPaths }),
      });
      if (!response.ok && response.status !== 404) {
        throw new Error(
          `storage DELETE ${bucket} failed (${response.status}): ${await response.text()}`,
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers de base
// ---------------------------------------------------------------------------

async function value(client, text, values = []) {
  const result = await client.query(text, values);
  const row = result.rows[0] || {};
  return row[Object.keys(row)[0]];
}

async function rows(client, text, values = []) {
  return (await client.query(text, values)).rows;
}

async function actAs(client, userId) {
  await client.query('set local role authenticated');
  await client.query(
    "select set_config('request.jwt.claim.role','authenticated',true),"
    + " set_config('request.jwt.claim.sub',$1,true)",
    [userId],
  );
}

/**
 * Rol `service_role` conservando la identidad del actor.
 *
 * Los RPC de retrato y el cierre de subida simple sólo están concedidos a
 * `service_role` —en producción los llama una Edge Function, no el navegador—,
 * pero las comprobaciones de capacidad siguen leyendo `auth.uid()`. Las dos
 * cosas a la vez: el rol da el privilegio, el claim da el sujeto.
 */
async function actAsServiceFor(client, userId) {
  await client.query('set local role service_role');
  await client.query(
    "select set_config('request.jwt.claim.role','service_role',true),"
    + " set_config('request.jwt.claim.sub',$1,true)",
    [userId],
  );
}

async function resetRole(client) {
  await client.query('reset role');
}

async function resolveScope(client) {
  const result = await client.query(
    `select organization.id as organization_id,
            tournament.id as tournament_id,
            tournament.season_id,
            category.id as category_id,
            owner_user.id as owner_user_id,
            admin_user.id as admin_user_id
     from public.tournament_organizations organization
     join public.tournaments tournament
       on tournament.organization_id = organization.id
      and tournament.name = $1
     join lateral (
       select id from public.tournament_categories
       where tournament_id = tournament.id and status = 'active'
       order by created_at limit 1
     ) category on true
     join lateral (
       select member.user_id as id from public.tournament_organization_members member
       where member.organization_id = organization.id
         and member.role = 'owner' and member.status = 'active'
       order by member.created_at limit 1
     ) owner_user on true
     join lateral (
       select member.user_id as id from public.tournament_organization_members member
       where member.organization_id = organization.id
         and member.role = 'admin' and member.status = 'active'
       order by member.created_at limit 1
     ) admin_user on true
     where organization.slug = $2`,
    [ACTIVE_TOURNAMENT_NAME, ORGANIZATION_SLUG],
  );
  if (result.rowCount !== 1) {
    throw new Error(
      'Expected exactly one local QA scope with an active owner and admin. '
      + 'Run the canonical seeds first.',
    );
  }
  return result.rows[0];
}

async function markerExists(client, organizationId) {
  return Boolean(await value(
    client,
    `select exists(
       select 1 from public.tournament_audit_log
       where organization_id = $1 and action = $2 and resource_id = $3
     )`,
    [organizationId, MARKER_ACTION, MARKER_ID],
  ));
}

// ---------------------------------------------------------------------------
// 1. Escudos
// ---------------------------------------------------------------------------

async function seedBranding(client, storage, scope) {
  const teams = await rows(
    client,
    `select id, short_name, name, shield_path
     from public.tournament_team_entries
     where organization_id = $1 and tournament_id = $2 and status = 'approved'
     order by name`,
    [scope.organization_id, scope.tournament_id],
  );
  const created = [];
  for (const team of teams) {
    if (team.shield_path) continue;
    const objectId = uuid(`crest:${team.id}`);
    const objectPath = `${scope.organization_id}/teams/${team.id}/${objectId}.png`;
    await storage.put(BRANDING_BUCKET, objectPath, teamCrestPng(team.short_name || team.id), 'image/png');
    await client.query('begin');
    try {
      await actAs(client, scope.owner_user_id);
      await value(
        client,
        "select public.set_tournament_branding_reference($1,'team',$2,$3)",
        [scope.organization_id, team.id, objectPath],
      );
      await resetRole(client);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
    created.push({ teamEntryId: team.id, shortName: team.short_name, objectPath });
  }
  return { teams: teams.length, crestsCreated: created.length, created };
}

// ---------------------------------------------------------------------------
// 2. Retratos vivos
// ---------------------------------------------------------------------------

const PORTRAIT_TARGETS = [
  { teamShortName: 'VIL', shirtNumber: 1, focalX: 0.5, focalY: 0.34, zoom: 1.0 },
  { teamShortName: 'FER', shirtNumber: 7, focalX: 0.46, focalY: 0.3, zoom: 1.35 },
  { teamShortName: 'BNO', shirtNumber: 9, focalX: 0.54, focalY: 0.32, zoom: 1.8 },
];

async function seedPortraits(client, storage, scope) {
  const created = [];
  for (const target of PORTRAIT_TARGETS) {
    const player = (await rows(
      client,
      `select player.id, player.display_name, player.team_entry_id
       from public.tournament_roster_players player
       join public.tournament_team_entries entry on entry.id = player.team_entry_id
       where player.organization_id = $1 and entry.tournament_id = $2
         and entry.short_name = $3 and player.shirt_number = $4
         and player.status = 'active'
       limit 1`,
      [scope.organization_id, scope.tournament_id, target.teamShortName, target.shirtNumber],
    ))[0];
    if (!player) continue;
    const alreadyLive = await value(
      client,
      `select exists(
         select 1 from public.tournament_player_portraits
         where roster_player_id = $1 and lifecycle_status = 'active'
       )`,
      [player.id],
    );
    if (alreadyLive) continue;

    const bytes = playerPortraitPng(`${target.teamShortName}:${target.shirtNumber}`);
    await client.query('begin');
    let requested;
    try {
      await actAsServiceFor(client, scope.owner_user_id);
      requested = await value(
        client,
        'select public.request_tournament_player_portrait_upload($1,$2,$3,$4,$5,$6,$7)',
        [
          scope.owner_user_id, scope.organization_id, player.id,
          'image/png', bytes.length, 800, 1000,
        ],
      );
      await resetRole(client);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }

    // El objeto va antes del finalize: si la subida falla, el retrato queda en
    // `upload_pending` y no aparece como vivo sin bytes detrás.
    await storage.put(PORTRAIT_BUCKET, requested.objectPath, bytes, 'image/png');

    await client.query('begin');
    try {
      await actAsServiceFor(client, scope.owner_user_id);
      await value(
        client,
        'select public.finalize_tournament_player_portrait_upload($1,$2)',
        [scope.owner_user_id, requested.portraitId],
      );
      await value(
        client,
        'select public.set_tournament_player_portrait_crop($1,$2,$3,$4,$5)',
        [
          scope.organization_id, requested.portraitId,
          target.focalX, target.focalY, target.zoom,
        ],
      );
      // Aprobado en lo editorial; el consentimiento de publicación NO se toca:
      // la revisión privada no lo necesita y falsearlo sería mentirle al modelo.
      await value(
        client,
        "select public.set_tournament_player_portrait_editorial_status($1,$2,'approved')",
        [scope.organization_id, requested.portraitId],
      );
      await resetRole(client);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
    created.push({
      portraitId: requested.portraitId,
      rosterPlayerId: player.id,
      displayName: player.display_name,
      objectPath: requested.objectPath,
      checksum: sha256Hex(bytes),
    });
  }
  return { portraitsCreated: created.length, created };
}

// ---------------------------------------------------------------------------
// 3. Multimedia (tier MVP_SIMPLE)
// ---------------------------------------------------------------------------

const GALLERY_PHOTOS = ['saque-inicial', 'gol-local', 'tribuna', 'festejo-final'];

async function seedMedia(client, storage, scope) {
  const gallery = (await rows(
    client,
    `select id, status from public.tournament_media_galleries
     where organization_id = $1 and tournament_id = $2
     order by created_at limit 1`,
    [scope.organization_id, scope.tournament_id],
  ))[0];
  if (!gallery) return { galleryId: null, assetsCreated: 0, created: [] };

  const mode = await value(
    client,
    'select mode from public.tournament_media_pipeline_configuration where singleton',
  );
  if (mode !== 'MVP_SIMPLE') {
    throw new Error(
      `El pipeline multimedia debe estar en MVP_SIMPLE para este suplemento (está en ${mode}). `
      + 'Corré: npm run storage:tournament-media:local:qa',
    );
  }

  const token = storage.tokenFor(scope.owner_user_id);
  const created = [];
  for (const label of GALLERY_PHOTOS) {
    const bytes = galleryPhotoPng(label);
    const checksum = sha256Hex(bytes);
    const duplicate = await value(
      client,
      `select exists(
         select 1 from public.tournament_media_assets
         where organization_id = $1 and checksum_sha256 = $2 and status <> 'revoked'
       )`,
      [scope.organization_id, checksum],
    );
    if (duplicate) continue;

    // El recorrido es el real: RPC para pedir la sesión, el signer para emitir
    // la URL de subida, y el processor para verificar los bytes y derivar las
    // variantes. Saltearse el pipeline dejaría assets sin variantes, y una
    // galería con assets sin variantes no se puede publicar por contrato.
    const session = await storage.rpc(token, 'request_tournament_media_upload_session', {
      p_gallery_id: gallery.id,
      p_file_name: `${label}.png`,
      p_declared_mime: 'image/png',
      p_byte_size: bytes.length,
      p_idempotency_key: uuid(`media-session:${label}`),
    });
    if (session.processingTier !== 'mvp_simple' || !session.sessionId || !session.token) {
      throw new Error(`La sesión de subida no quedó en MVP_SIMPLE: ${JSON.stringify(session)}`);
    }
    const intent = await storage.edge(token, 'tournament-media-signer', {
      action: 'upload-intent', sessionId: session.sessionId, token: session.token,
    });
    await storage.putSigned(token, intent.uploadUrl, bytes, 'image/png');
    const finalized = await storage.edge(token, 'tournament-media-processor', {
      action: 'finalize-simple', sessionId: session.sessionId, token: session.token,
    }, 201);
    created.push({ assetId: finalized.assetId, label, checksum, status: finalized.status });
  }

  // El ciclo editorial va hasta el final, pero no del todo: una foto queda en
  // revisión a propósito, para que la pantalla muestre los dos estados.
  const pending = await rows(
    client,
    `select id from public.tournament_media_assets
     where gallery_id = $1 and status = 'pending_review'
     order by created_at`,
    [gallery.id],
  );
  const approved = [];
  for (const asset of pending.slice(0, Math.max(0, pending.length - 1))) {
    await client.query('begin');
    try {
      await actAs(client, scope.owner_user_id);
      await value(
        client,
        "select public.transition_tournament_media_asset($1,'approve',null)",
        [asset.id],
      );
      await resetRole(client);
      await client.query('commit');
      approved.push(asset.id);
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }

  const galleryState = await value(
    client,
    'select status from public.tournament_media_galleries where id = $1',
    [gallery.id],
  );
  // Los aprobados se leen de la base y no de esta corrida: en una segunda
  // pasada no hay nada nuevo que aprobar, pero la portada puede seguir faltando.
  const approvedInGallery = (await rows(
    client,
    `select id from public.tournament_media_assets
     where gallery_id = $1 and status in ('approved','published')
     order by created_at`,
    [gallery.id],
  )).map((asset) => asset.id);
  const hasCover = Boolean(await value(
    client,
    'select cover_asset_id from public.tournament_media_galleries where id = $1',
    [gallery.id],
  ));
  let cover = null;
  if (approvedInGallery.length > 0 && galleryState === 'draft' && !hasCover) {
    await client.query('begin');
    try {
      await actAs(client, scope.owner_user_id);
      // La portada exige un asset ya aprobado y una galería todavía editable:
      // ese es el único orden que el contrato acepta.
      await value(
        client, 'select public.set_tournament_media_cover($1,$2)', [gallery.id, approvedInGallery[0]],
      );
      cover = approvedInGallery[0];
      await resetRole(client);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }

  // La galería queda en borrador a propósito, y conviene decir por qué:
  // `publish_tournament_media_gallery` exige cuatro variantes `ready` por
  // asset, y el tier MVP_SIMPLE no deriva variantes almacenadas —normaliza un
  // único objeto de display—. O sea que en MVP_SIMPLE ninguna galería es
  // publicable. Es un hueco del producto, no del dataset: forzarlo desde acá
  // sería fabricar un estado que la app no sabe producir.
  let publishBlockedBy = null;
  if (approvedInGallery.length > 0 && galleryState === 'draft') {
    await client.query('begin');
    try {
      await actAs(client, scope.owner_user_id);
      await value(client, 'select public.publish_tournament_media_gallery($1)', [gallery.id]);
      await resetRole(client);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      publishBlockedBy = String(error.message);
    }
  }
  const finalState = await value(
    client,
    'select status from public.tournament_media_galleries where id = $1',
    [gallery.id],
  );

  return {
    galleryId: gallery.id,
    assetsCreated: created.length,
    assetsApproved: approved.length,
    coverAssetId: cover,
    galleryStatus: finalState,
    publishBlockedBy,
    created,
  };
}

// ---------------------------------------------------------------------------
// 4 y 5. Convocatoria y acta completa
// ---------------------------------------------------------------------------

/**
 * Devuelve el partido sobre el que se arma la convocatoria y el acta: el
 * primero del Apertura cuya acta todavía no es oficial y cuyo partido sigue
 * siendo abrible.
 */
async function pickActaMatch(client, scope) {
  return (await rows(
    client,
    `select match_row.id as match_id,
            match_row.match_number,
            operation.id as operation_id,
            operation.status as operation_status,
            operation.home_team_entry_id,
            operation.away_team_entry_id
     from public.tournament_matches match_row
     join public.tournament_match_operations operation
       on operation.match_id = match_row.id
     where match_row.organization_id = $1
       and match_row.tournament_id = $2
       and match_row.status in ('scheduled','ready')
       and operation.status in ('draft','submitted','under_review','validated')
     order by match_row.match_number
     limit 1`,
    [scope.organization_id, scope.tournament_id],
  ))[0] || null;
}

async function squadPayload(client, teamEntryId) {
  // Cinco titulares (con arquero y capitán) y hasta cuatro suplentes. Los
  // suspendidos quedan afuera: el modelo los rechaza y tiene razón.
  const players = await rows(
    client,
    `select player.id, player.shirt_number, player.is_goalkeeper
     from public.tournament_roster_players player
     join public.tournament_rosters roster on roster.id = player.roster_id
     where player.team_entry_id = $1
       and player.status = 'active'
       and player.eligibility_status = 'eligible'
       and roster.status in ('approved','locked')
       and not exists (
         select 1 from public.tournament_player_suspensions suspension
         where suspension.roster_player_id = player.id
           and suspension.status = 'active'
       )
     order by player.shirt_number`,
    [teamEntryId],
  );
  const starters = [];
  const substitutes = [];
  const goalkeeper = players.find((player) => player.is_goalkeeper);
  if (goalkeeper) starters.push(goalkeeper);
  for (const player of players) {
    if (starters.some((entry) => entry.id === player.id)) continue;
    if (starters.length < 5) starters.push(player);
    else if (substitutes.length < 4) substitutes.push(player);
  }
  return [
    ...starters.map((player, index) => ({
      rosterPlayerId: player.id,
      callupStatus: 'called_up',
      lineupStatus: 'starter',
      isCaptain: index === 1,
      attendanceStatus: 'present',
    })),
    ...substitutes.map((player) => ({
      rosterPlayerId: player.id,
      callupStatus: 'called_up',
      lineupStatus: 'substitute',
      attendanceStatus: 'present',
    })),
  ];
}

async function seedSquadAndActa(client, scope) {
  const target = await pickActaMatch(client, scope);
  if (!target) return { status: 'skip', reason: 'no openable match with a pending operation' };

  const existingSquads = Number(await value(
    client,
    `select count(*) from public.tournament_match_squads squad
     join public.tournament_matches match_row on match_row.id = squad.match_id
     where match_row.tournament_id = $1`,
    [scope.tournament_id],
  ));
  if (existingSquads > 0) {
    return { status: 'skip', reason: 'the tournament already has a squad-backed acta' };
  }

  await client.query('begin');
  try {
    await actAs(client, scope.owner_user_id);
    // La operación pendiente bloquea la convocatoria por contrato. Se anula
    // explícitamente: no tiene eventos ni jugadores, así que no se pierde nada.
    await value(
      client,
      'select public.void_tournament_match_operation($1,$2,$3)',
      [
        scope.organization_id, target.operation_id,
        'QA review supplement: se rehace el acta desde la convocatoria.',
      ],
    );
    for (const teamEntryId of [target.home_team_entry_id, target.away_team_entry_id]) {
      const players = await squadPayload(client, teamEntryId);
      await value(
        client,
        'select public.save_match_squad($1,$2,$3,$4::jsonb)',
        [scope.organization_id, target.match_id, teamEntryId, JSON.stringify(players)],
      );
      await value(
        client,
        'select public.submit_match_squad($1,$2,$3)',
        [scope.organization_id, target.match_id, teamEntryId],
      );
    }
    const opened = await value(
      client,
      'select public.open_tournament_match_operation($1,$2,$3)',
      [
        scope.organization_id, target.match_id,
        'QA review supplement: apertura anticipada para poblar el acta.',
      ],
    );
    const operationId = opened.operation?.id || opened.id;
    if (!operationId) throw new Error('No se pudo resolver la operación abierta.');

    const home = target.home_team_entry_id;
    const away = target.away_team_entry_id;
    const homePlayers = await rows(
      client,
      `select roster_player_id from public.tournament_match_operation_players
       where match_operation_id = $1 and team_entry_id = $2
       order by shirt_number_snapshot`,
      [operationId, home],
    );
    const awayPlayers = await rows(
      client,
      `select roster_player_id from public.tournament_match_operation_players
       where match_operation_id = $1 and team_entry_id = $2
       order by shirt_number_snapshot`,
      [operationId, away],
    );
    if (homePlayers.length < 5 || awayPlayers.length < 5) {
      throw new Error('La convocatoria no llegó a la planilla de la operación.');
    }

    const addEvent = async (event) => value(
      client,
      'select public.add_tournament_match_event($1,$2,$3::jsonb)',
      [scope.organization_id, operationId, JSON.stringify(event)],
    );

    // Un acta que recorre las dos mitades: arranque, gol con asistencia,
    // amarilla, entretiempo, gol de visitante, gol local, roja y cierre.
    await addEvent({ teamEntryId: home, eventType: 'match_started', minute: 0, period: 'pre_match' });
    const firstGoal = await addEvent({
      teamEntryId: home, rosterPlayerId: homePlayers[3].roster_player_id,
      eventType: 'goal', minute: 12, period: 'first_half',
    });
    await addEvent({
      teamEntryId: home, rosterPlayerId: homePlayers[2].roster_player_id,
      relatedEventId: firstGoal.id, eventType: 'assist', minute: 12, period: 'first_half',
    });
    await addEvent({
      teamEntryId: away, rosterPlayerId: awayPlayers[1].roster_player_id,
      eventType: 'yellow_card', minute: 21, period: 'first_half',
    });
    await addEvent({ teamEntryId: home, eventType: 'halftime', minute: 25, period: 'halftime' });
    await addEvent({
      teamEntryId: home, eventType: 'second_half_started', minute: 25, period: 'second_half',
    });
    await addEvent({
      teamEntryId: away, rosterPlayerId: awayPlayers[4].roster_player_id,
      eventType: 'goal', minute: 33, period: 'second_half',
    });
    const secondGoal = await addEvent({
      teamEntryId: home, rosterPlayerId: homePlayers[4].roster_player_id,
      eventType: 'goal', minute: 41, period: 'second_half',
    });
    await addEvent({
      teamEntryId: home, rosterPlayerId: homePlayers[1].roster_player_id,
      relatedEventId: secondGoal.id, eventType: 'assist', minute: 41, period: 'second_half',
    });
    await addEvent({
      teamEntryId: home, rosterPlayerId: homePlayers[2].roster_player_id,
      eventType: 'yellow_card', minute: 44, period: 'second_half',
    });
    await addEvent({
      teamEntryId: away, rosterPlayerId: awayPlayers[3].roster_player_id,
      eventType: 'red_card', minute: 47, period: 'second_half',
    });
    await addEvent({ teamEntryId: home, eventType: 'match_ended', minute: 50, period: 'post_match' });

    await value(
      client,
      'select public.set_tournament_match_outcome($1,$2,$3::jsonb)',
      [
        scope.organization_id, operationId,
        JSON.stringify({
          outcomeType: 'played',
          countsForStandings: true,
          countsForPlayerStats: true,
          requiresResolution: false,
        }),
      ],
    );
    await value(
      client,
      'select public.set_tournament_match_score($1,$2,$3::jsonb)',
      [
        scope.organization_id, operationId,
        JSON.stringify({ homeScore: 2, awayScore: 1, scoreType: 'played' }),
      ],
    );
    await value(
      client,
      "select public.save_tournament_match_operation_draft($1,$2,'played',$3)",
      [
        scope.organization_id, operationId,
        'Acta QA completa: dos tiempos, goles con asistencia, amarillas y una roja.',
      ],
    );
    await value(
      client,
      'select public.submit_tournament_match_operation($1,$2)',
      [scope.organization_id, operationId],
    );

    // Doble control real: quien valida no puede ser quien presentó.
    await actAs(client, scope.admin_user_id);
    await value(
      client,
      "select public.review_tournament_match_operation($1,$2,'approved',$3)",
      [scope.organization_id, operationId, 'Revisión QA: el acta coincide con la planilla.'],
    );
    await value(
      client,
      'select public.validate_tournament_match_operation($1,$2)',
      [scope.organization_id, operationId],
    );
    await value(
      client,
      'select public.make_tournament_match_official($1,$2)',
      [scope.organization_id, operationId],
    );
    await resetRole(client);
    await client.query('commit');
    return {
      status: 'created',
      matchId: target.match_id,
      matchNumber: target.match_number,
      operationId,
      squads: 2,
      events: 12,
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

// ---------------------------------------------------------------------------
// 6. Página pública
// ---------------------------------------------------------------------------

async function republishPublicPage(client, scope) {
  const current = (await rows(
    client,
    `select page.tournament_id, page.status, tournament.name
     from public.tournament_public_pages page
     join public.tournaments tournament on tournament.id = page.tournament_id
     where page.organization_id = $1 and page.status = 'published'`,
    [scope.organization_id],
  ));
  const alreadyRight = current.some((page) => page.tournament_id === scope.tournament_id);
  const unpublished = [];
  await client.query('begin');
  try {
    await actAs(client, scope.owner_user_id);
    for (const page of current) {
      if (page.tournament_id === scope.tournament_id) continue;
      await value(
        client,
        'select public.set_tournament_public_page_published($1,$2,false)',
        [scope.organization_id, page.tournament_id],
      );
      unpublished.push(page.name);
    }
    if (!alreadyRight) {
      await value(
        client,
        'select public.set_tournament_public_page_published($1,$2,true)',
        [scope.organization_id, scope.tournament_id],
      );
    }
    await resetRole(client);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
  const slug = await value(
    client,
    `select public_slug from public.tournament_public_pages
     where organization_id = $1 and tournament_id = $2`,
    [scope.organization_id, scope.tournament_id],
  );
  return { publishedTournament: ACTIVE_TOURNAMENT_NAME, publicSlug: slug, unpublished };
}

// ---------------------------------------------------------------------------
// 7. Partidos Arma2
// ---------------------------------------------------------------------------

const ARMA2_MATCHES = [
  {
    key: 'proximo-abierto',
    nombre: 'Fútbol 5 QA · Martes',
    fecha: '2026-08-25', hora: '20:00',
    sede: 'Complejo Deportivo Norte QA',
    faltaJugadores: true, estado: 'active',
  },
  {
    key: 'equipos-armados',
    nombre: 'Fútbol 5 QA · Jueves',
    fecha: '2026-08-27', hora: '21:00',
    sede: 'Polideportivo Sur QA',
    faltaJugadores: false, estado: 'active',
  },
  {
    key: 'jugado',
    nombre: 'Fútbol 5 QA · Sábado pasado',
    fecha: '2026-08-15', hora: '18:00',
    sede: 'Complejo Deportivo Norte QA',
    faltaJugadores: false, estado: 'active',
  },
];

async function seedArma2(client, scope) {
  const created = [];
  await client.query('begin');
  try {
    await resetRole(client);
    for (const spec of ARMA2_MATCHES) {
      const matchUuid = uuid(`arma2:${spec.key}`);
      const exists = await value(
        client,
        'select exists(select 1 from public.partidos where uuid = $1)',
        [matchUuid],
      );
      if (exists) continue;
      const id = await value(
        client,
        `insert into public.partidos (
           uuid, codigo, nombre, fecha, hora, sede, modalidad, tipo_partido,
           cupo_jugadores, falta_jugadores, precio_cancha, creado_por, admin_id,
           estado, player_invites_enabled
         ) values (
           $1,$2,$3,$4::date,$5,$6,'F5','manual',10,$7,32000,$8,$8,$9,true
         ) returning id`,
        [
          matchUuid,
          `QA${crypto.createHash('sha256').update(spec.key).digest('hex').slice(0, 4).toUpperCase()}`,
          spec.nombre, spec.fecha, spec.hora, spec.sede,
          spec.faltaJugadores, scope.owner_user_id, spec.estado,
        ],
      );
      created.push({ id, uuid: matchUuid, nombre: spec.nombre });
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
  return { matchesCreated: created.length, created };
}

// ---------------------------------------------------------------------------
// Informe
// ---------------------------------------------------------------------------

async function report(client, scope) {
  const result = await client.query(
    `select
       (select count(*)::integer from public.tournament_team_entries
         where tournament_id = $2 and shield_path is not null) crests,
       (select count(*)::integer from public.tournament_player_portraits
         where organization_id = $1 and lifecycle_status = 'active') live_portraits,
       (select count(*)::integer from public.tournament_media_galleries
         where organization_id = $1) galleries,
       (select count(*)::integer from public.tournament_media_assets
         where organization_id = $1) media_assets,
       (select count(*)::integer from public.tournament_media_gallery_items
         where organization_id = $1) gallery_items,
       (select count(*)::integer from public.tournament_match_squads
         where organization_id = $1) match_squads,
       (select count(*)::integer from public.tournament_match_squad_players
         where organization_id = $1) squad_players,
       (select count(*)::integer from public.tournament_match_events
         where organization_id = $1 and voided_at is null) match_events,
       (select count(*)::integer from public.tournament_match_events event
         join public.tournament_match_operations operation
           on operation.id = event.match_operation_id
         where event.organization_id = $1 and event.period = 'first_half') first_half_events,
       (select count(*)::integer from public.tournament_match_events
         where organization_id = $1 and period = 'second_half') second_half_events,
       (select count(*)::integer from public.tournament_public_pages
         where organization_id = $1 and tournament_id = $2 and status = 'published') public_page,
       (select count(*)::integer from public.tournament_organization_subscriptions
         where organization_id = $1 and status = 'active' and plan_code = 'PRO') pro_subscription,
       (select count(*)::integer from public.partidos where deleted_at is null) arma2_matches`,
    [scope.organization_id, scope.tournament_id],
  );
  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function cleanup(client, storage, scope) {
  // Todo lo que este suplemento borra se identifica de forma determinística:
  // los retratos por el jugador al que apuntan, las fotos por su checksum y los
  // partidos Arma2 por su uuid derivado. Nada se borra "por fecha".
  const targetPlayers = (await rows(
    client,
    `select player.id
     from public.tournament_roster_players player
     join public.tournament_team_entries entry on entry.id = player.team_entry_id
     where player.organization_id = $1 and entry.tournament_id = $2
       and (entry.short_name, player.shirt_number) in (
         ${PORTRAIT_TARGETS.map((_, index) => `($${index * 2 + 3}, $${index * 2 + 4})`).join(', ')}
       )`,
    [
      scope.organization_id, scope.tournament_id,
      ...PORTRAIT_TARGETS.flatMap((target) => [target.teamShortName, target.shirtNumber]),
    ],
  )).map((player) => player.id);

  const seededPortraits = targetPlayers.length === 0 ? [] : await rows(
    client,
    `select id, object_path from public.tournament_player_portraits
     where organization_id = $1 and roster_player_id = any($2::uuid[])
       and lifecycle_status = 'active'`,
    [scope.organization_id, targetPlayers],
  );
  const seededAssets = await rows(
    client,
    `select id, internal_path from public.tournament_media_assets
     where organization_id = $1 and checksum_sha256 = any($2::text[])`,
    [scope.organization_id, GALLERY_PHOTOS.map((label) => sha256Hex(galleryPhotoPng(label)))],
  );

  const removed = {};
  await client.query('begin');
  try {
    await resetRole(client);
    const assetIds = seededAssets.map((asset) => asset.id);
    await client.query(
      'update public.tournament_media_galleries set cover_asset_id = null'
      + ' where cover_asset_id = any($1::uuid[])',
      [assetIds],
    );
    await client.query(
      'delete from public.tournament_media_gallery_items where asset_id = any($1::uuid[])',
      [assetIds],
    );
    await client.query(
      'delete from public.tournament_media_upload_sessions where asset_id = any($1::uuid[])',
      [assetIds],
    );
    await client.query(
      'delete from public.tournament_media_moderation_actions where asset_id = any($1::uuid[])',
      [assetIds],
    );
    await client.query(
      'delete from public.tournament_media_variants where asset_id = any($1::uuid[])',
      [assetIds],
    );
    await client.query(
      'delete from public.tournament_media_processing_jobs where asset_id = any($1::uuid[])',
      [assetIds],
    );
    await client.query(
      'delete from public.tournament_media_assets where id = any($1::uuid[])',
      [assetIds],
    );
    removed.mediaAssets = assetIds.length;

    await client.query(
      'delete from public.tournament_player_portraits where id = any($1::uuid[])',
      [seededPortraits.map((portrait) => portrait.id)],
    );
    removed.portraits = seededPortraits.length;

    const arma2Uuids = ARMA2_MATCHES.map((spec) => uuid(`arma2:${spec.key}`));
    const arma2Deleted = await client.query(
      'delete from public.partidos where uuid = any($1::uuid[])',
      [arma2Uuids],
    );
    removed.arma2Matches = arma2Deleted.rowCount;

    // La auditoría es append-only por trigger. El único borrado permitido acá
    // es el marcador de este suplemento, y la guarda se restituye siempre.
    await client.query(
      'alter table public.tournament_audit_log disable trigger tournament_audit_append_only',
    );
    try {
      await client.query(
        'delete from public.tournament_audit_log'
        + ' where organization_id = $1 and action = $2 and resource_id = $3',
        [scope.organization_id, MARKER_ACTION, MARKER_ID],
      );
    } finally {
      await client.query(
        'alter table public.tournament_audit_log enable trigger tournament_audit_append_only',
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }

  await storage.remove(PORTRAIT_BUCKET, seededPortraits.map((portrait) => portrait.object_path));
  await storage.remove(MEDIA_BUCKET, seededAssets.map((asset) => asset.internal_path));

  // Los escudos, la convocatoria y el acta NO se revierten: son estado deportivo
  // que la organización ya considera propio, y deshacerlo desde un script de QA
  // borraría trabajo que el modelo tomó como oficial. Se dicen en el informe
  // para que quede explícito qué queda en pie.
  return {
    status: 'cleaned',
    seedKey: SEED_KEY,
    removed,
    kept: {
      crests: Number(await value(
        client,
        `select count(*) from public.tournament_team_entries
         where tournament_id = $1 and shield_path is not null`,
        [scope.tournament_id],
      )),
      matchSquads: Number(await value(
        client,
        `select count(*) from public.tournament_match_squads squad
         join public.tournament_matches match_row on match_row.id = squad.match_id
         where match_row.tournament_id = $1`,
        [scope.tournament_id],
      )),
    },
  };
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

async function apply(client, storage) {
  const scope = await resolveScope(client);
  if (await markerExists(client, scope.organization_id)) {
    return { status: 'skip', seedKey: SEED_KEY, counts: await report(client, scope) };
  }
  const branding = await seedBranding(client, storage, scope);
  const portraits = await seedPortraits(client, storage, scope);
  const media = await seedMedia(client, storage, scope);
  const acta = await seedSquadAndActa(client, scope);
  const publicPage = await republishPublicPage(client, scope);
  const arma2 = await seedArma2(client, scope);

  await client.query('begin');
  try {
    await resetRole(client);
    await client.query(
      `insert into public.tournament_audit_log (
         organization_id, actor_user_id, actor_type, action, resource_type,
         resource_id, team_entry_id, tournament_id, metadata
       ) values ($1,$2,'user',$3,'qa_review_supplement',$4,null,$5,$6::jsonb)`,
      [
        scope.organization_id, scope.owner_user_id, MARKER_ACTION, MARKER_ID,
        scope.tournament_id,
        JSON.stringify({
          seedKey: SEED_KEY,
          localOnly: true,
          crests: branding.crestsCreated,
          portraits: portraits.portraitsCreated,
          mediaAssets: media.assetsCreated,
          acta: acta.status,
          arma2Matches: arma2.matchesCreated,
        }),
      ],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
  return {
    status: 'created',
    seedKey: SEED_KEY,
    branding,
    portraits,
    media,
    acta,
    publicPage,
    arma2,
    counts: await report(client, scope),
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const doApply = args.has('--apply-local');
  const doCleanup = args.has('--cleanup-local');
  const doReport = args.has('--report');
  if ((doApply && doCleanup) || args.size > 1) {
    throw new Error('Use exactly one of --apply-local, --cleanup-local or --report.');
  }
  if (!doApply && !doCleanup && !doReport) {
    console.log(JSON.stringify({
      status: 'plan',
      writes: false,
      seedKey: SEED_KEY,
      covers: [
        'escudos de los equipos del Apertura',
        'retratos vivos con recorte y objeto real',
        'galería multimedia en tier MVP_SIMPLE',
        'convocatoria y acta completa (dos tiempos, goles, asistencia, amarillas, roja)',
        'página pública apuntando al torneo poblado',
        'partidos Arma2 de referencia',
      ],
      requires: [
        'QA_SEED_ENV=local', 'QA_SEED_PROJECT_REF=local', 'QA_SEED_DATABASE_URL=<loopback>',
        'QA_SUPABASE_URL=<loopback>', 'QA_SUPABASE_SERVICE_ROLE_KEY=<en memoria>',
      ],
      apply: 'QA_ALLOW_REVIEW_SUPPLEMENT=true node scripts/qa/seed-torneos-qa-review-supplement.mjs --apply-local',
      cleanup: 'QA_ALLOW_REVIEW_SUPPLEMENT_CLEANUP=true QA_CONFIRM_REVIEW_SUPPLEMENT=true node scripts/qa/seed-torneos-qa-review-supplement.mjs --cleanup-local',
    }, null, 2));
    return;
  }
  if (doApply && process.env.QA_ALLOW_REVIEW_SUPPLEMENT !== 'true') {
    throw new Error('QA_ALLOW_REVIEW_SUPPLEMENT=true is required.');
  }
  if (doCleanup && (
    process.env.QA_ALLOW_REVIEW_SUPPLEMENT_CLEANUP !== 'true'
    || process.env.QA_CONFIRM_REVIEW_SUPPLEMENT !== 'true'
  )) {
    throw new Error(
      'QA_ALLOW_REVIEW_SUPPLEMENT_CLEANUP=true and QA_CONFIRM_REVIEW_SUPPLEMENT=true are required.',
    );
  }

  const target = assertLocalDatabaseTarget(process.env);
  const storage = doReport ? null : storageClient(assertLocalStorageTarget(process.env));
  const client = new pg.Client({ connectionString: target.databaseUrl });
  await client.connect();
  try {
    // Un único escritor por vez: dos corridas simultáneas competirían por las
    // mismas sesiones de subida y por la misma operación de partido.
    await client.query('select pg_advisory_lock(hashtextextended($1,0))', [SEED_KEY]);
    if (doReport) {
      const scope = await resolveScope(client);
      console.log(JSON.stringify({
        status: 'report',
        seedKey: SEED_KEY,
        applied: await markerExists(client, scope.organization_id),
        counts: await report(client, scope),
      }, null, 2));
    } else if (doCleanup) {
      console.log(JSON.stringify(await cleanup(client, storage, await resolveScope(client)), null, 2));
    } else {
      console.log(JSON.stringify(await apply(client, storage), null, 2));
    }
  } finally {
    await client.query('select pg_advisory_unlock(hashtextextended($1,0))', [SEED_KEY])
      .catch(() => {});
    await client.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.message }, null, 2));
  process.exitCode = 1;
});
