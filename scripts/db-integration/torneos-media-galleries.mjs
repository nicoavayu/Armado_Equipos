#!/usr/bin/env node

import {
  USERS,
  cleanupMatchOperationsHarness,
  connect,
  seedOperationalMatch,
  setup,
  value,
} from './torneos-match-operations.mjs';

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

async function createGallery(client, scope, suffix, overrides = {}) {
  return value(
    client,
    `select public.create_tournament_media_gallery(
      $1,$2,$3,$4,$5,$6,$7,$8,$9
    )`,
    [
      overrides.organizationId || scope.organizationId,
      overrides.tournamentId || scope.tournamentId,
      overrides.categoryId === undefined ? scope.categoryId : overrides.categoryId,
      overrides.roundId || null,
      overrides.matchId === undefined ? scope.matchId : overrides.matchId,
      overrides.title || `Galería jornada ${suffix}`,
      overrides.description || `Fotos verificadas de la jornada ${suffix}.`,
      overrides.visibility || 'tournament_participants',
      overrides.idempotencyKey
        || `96000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
    ],
  );
}

async function requestUpload(client, galleryId, suffix, overrides = {}) {
  return value(
    client,
    `select public.request_tournament_media_upload_session(
      $1,$2,$3,$4,$5
    )`,
    [
      galleryId,
      overrides.name || `foto-${suffix}.jpg`,
      overrides.mime || 'image/jpeg',
      overrides.size || 2048,
      overrides.idempotencyKey
        || `96100000-0000-4000-8000-${suffix.padStart(12, '0')}`,
    ],
  );
}

async function completeUpload(service, session, checksum) {
  return value(
    service,
    `select public.complete_tournament_media_upload(
      $1,$2,'image/jpeg',2048,1600,900,$3
    )`,
    [session.sessionId, session.token, checksum],
  );
}

async function run() {
  console.log('Arma2 Torneos · media galleries PostgreSQL/RLS');
  try {
    const admin = await setup([
      '20260726200000_tournament_standings_discipline.sql',
      '20260726230000_tournament_participant_hub.sql',
      '20260727010000_tournament_communications.sql',
      '20260727060000_tournament_media_galleries.sql',
    ]);
    const scope = await seedOperationalMatch(admin);
    const owner = scope.owner;
    const adminUser = await connect({ role: 'authenticated', userId: USERS.admin });
    const collaborator = await connect({
      role: 'authenticated',
      userId: USERS.collaborator,
    });
    const playerHome = await connect({
      role: 'authenticated',
      userId: USERS.playerHome,
    });
    const captainHome = await connect({
      role: 'authenticated',
      userId: USERS.captainHome,
    });
    const outsider = await connect({
      role: 'authenticated',
      userId: USERS.outsider,
    });
    const anonymous = await connect({ role: 'anon' });
    const storageService = await connect({
      role: 'service_role',
      userId: USERS.owner,
    });

    const mediaTables = [
      'public.tournament_media_galleries',
      'public.tournament_media_assets',
      'public.tournament_media_gallery_items',
      'public.tournament_media_relations',
      'public.tournament_media_variants',
      'public.tournament_media_upload_sessions',
      'public.tournament_media_moderation_actions',
      'public.tournament_media_consents',
      'public.tournament_media_reports',
      'public.tournament_media_assignments',
    ];
    eq(
      Number(await value(
        admin,
        `select count(*) from pg_class
         where oid = any($1::regclass[]) and relrowsecurity`,
        [mediaTables],
      )),
      mediaTables.length,
      'todas las entidades multimedia tienen RLS',
    );
    eq(
      Number(await value(
        admin,
        `select count(*) from information_schema.role_table_grants
         where table_schema = 'public'
           and table_name like 'tournament_media_%'
           and grantee in ('anon','authenticated')`,
      )),
      0,
      'el cliente no recibe grants directos sobre metadata privada',
    );
    eq(
      Number(await value(
        admin,
        `select count(*) from pg_proc procedure
         join pg_namespace namespace on namespace.oid = procedure.pronamespace
         where namespace.nspname = 'public'
           and procedure.proname like '%tournament_media%'
           and procedure.prosecdef
           and procedure.proconfig @> array['search_path=""']::text[]`,
      )) >= 17,
      true,
      'las RPCs privilegiadas fijan search_path vacío',
    );
    await expectError(
      () => anonymous.query(
        `select public.get_published_tournament_media(
          $1,null,null,20,0
        )`,
        [scope.tournamentId],
      ),
      /permission denied/,
      'anon no puede abrir galerías',
    );
    eq(
      (await value(
        admin,
        `select public.tournament_media_role_capabilities('owner')`,
      )).includes('media.handle_reports'),
      true,
      'owner recibe administración multimedia completa',
    );
    eq(
      JSON.stringify(await value(
        admin,
        `select public.tournament_media_role_capabilities('collaborator')`,
      )),
      JSON.stringify(['media.read']),
      'collaborator conserva sólo lectura por defecto',
    );

    const galleryId = await createGallery(owner, scope, '1');
    ok(Boolean(galleryId), 'owner crea una galería acotada al torneo');
    eq(
      await createGallery(owner, scope, '1'),
      galleryId,
      'crear galería es idempotente',
    );
    await expectError(
      () => createGallery(outsider, scope, '2'),
      /TORNEOS_MEDIA_FORBIDDEN/,
      'outsider no crea galerías por UUID conocido',
    );
    await expectError(
      () => createGallery(collaborator, scope, '3'),
      /TORNEOS_MEDIA_FORBIDDEN/,
      'collaborator no crea galerías sin capability explícita',
    );
    await expectError(
      () => createGallery(owner, scope, '4', {
        matchId: null,
        visibility: 'match_participants',
      }),
      /TORNEOS_MEDIA_VISIBILITY_INVALID/,
      'visibilidad de partido exige un partido válido',
    );
    const adminContext = await value(
      collaborator,
      `select public.get_tournament_media_admin_context($1,null,null,30,0)`,
      [scope.organizationId],
    );
    eq(
      JSON.stringify(adminContext.capabilities),
      JSON.stringify(['media.read']),
      'read-only se deriva en backend',
    );
    eq(adminContext.storage.private, true, 'el contrato usa bucket privado dedicado');
    eq(adminContext.storage.certified, false, 'Storage remoto queda no certificado');
    eq(adminContext.storage.uploadReady, false, 'uploads reales permanecen fail-closed');

    await expectError(
      () => requestUpload(owner, galleryId, '1', {
        name: 'vector.svg',
        mime: 'image/svg+xml',
      }),
      /TORNEOS_MEDIA_FILE_INVALID/,
      'SVG queda bloqueado',
    );
    await expectError(
      () => requestUpload(owner, galleryId, '2', {
        name: 'foto.png',
        mime: 'image/jpeg',
      }),
      /TORNEOS_MEDIA_FILE_INVALID/,
      'extensión y MIME inconsistentes se rechazan',
    );
    await expectError(
      () => requestUpload(owner, galleryId, '3', {
        size: 12582913,
      }),
      /TORNEOS_MEDIA_FILE_INVALID/,
      'archivo excesivo se rechaza antes de emitir sesión',
    );
    const session = await requestUpload(owner, galleryId, '4');
    eq(session.uploadReady, false, 'la sesión no simula un signer desplegado');
    eq(session.requiresStagingStorageSigner, true, 'staging queda como gate explícito');
    eq(session.token.length, 64, 'el token efímero contiene 32 bytes aleatorios');
    eq(
      await value(
        admin,
        `select token_hash <> $2 and token_hash = encode(digest($2,'sha256'),'hex')
         from public.tournament_media_upload_sessions where id = $1`,
        [session.sessionId, session.token],
      ),
      true,
      'la base persiste sólo el hash del token',
    );
    const replayIntent = await requestUpload(owner, galleryId, '4');
    eq(replayIntent.reused, true, 'repetir la intención es idempotente');
    eq(replayIntent.token, null, 'un replay no vuelve a exponer el secreto');
    ok(
      !JSON.stringify(session).match(/internalPath|bucket|checksum/i),
      'la respuesta de sesión no expone path, bucket ni checksum',
    );

    const asset = await completeUpload(
      storageService,
      session,
      'a'.repeat(64),
    );
    eq(asset.status, 'pending_review', 'verificación completa el asset en revisión');
    ok(
      !JSON.stringify(asset).match(/internalPath|bucket|checksum/i),
      'completar devuelve metadata allowlistada',
    );
    await expectError(
      () => completeUpload(storageService, session, 'b'.repeat(64)),
      /TORNEOS_MEDIA_UPLOAD_SESSION_INVALID/,
      'la sesión es single-use y evita replay',
    );
    eq(
      Number(await value(
        admin,
        `select count(*) from public.tournament_media_variants
         where asset_id = $1`,
        [asset.assetId],
      )),
      4,
      'se registra original y tres variantes',
    );
    eq(
      Number(await value(
        admin,
        `select count(*) from public.tournament_media_variants
         where asset_id = $1 and kind in ('thumbnail','grid','detail')
           and status = 'processing'`,
        [asset.assetId],
      )),
      3,
      'thumbnails quedan en procesamiento hasta el worker certificado',
    );
    await expectError(
      () => value(
        collaborator,
        `select public.transition_tournament_media_asset($1,'approve',null)`,
        [asset.assetId],
      ),
      /TORNEOS_MEDIA_FORBIDDEN/,
      'collaborator no modera por defecto',
    );
    const approved = await value(
      owner,
      `select public.transition_tournament_media_asset($1,'approve',null)`,
      [asset.assetId],
    );
    eq(approved.status, 'approved', 'owner aprueba un asset pendiente');
    await expectError(
      () => value(
        owner,
        `select public.transition_tournament_media_asset($1,'approve',null)`,
        [asset.assetId],
      ),
      /TORNEOS_MEDIA_TRANSITION_INVALID/,
      'una transición de moderación inválida falla cerrada',
    );
    await value(
      owner,
      `select public.set_tournament_media_cover($1,$2)`,
      [galleryId, asset.assetId],
    );
    eq(
      await value(
        admin,
        `select cover_asset_id from public.tournament_media_galleries where id = $1`,
        [galleryId],
      ),
      asset.assetId,
      'la portada sólo usa un asset aprobado de la galería',
    );
    await value(
      owner,
      `select public.tag_tournament_media_asset($1,'team',null,$2,null)`,
      [asset.assetId, scope.homeEntryId],
    );
    await expectError(
      () => value(
        outsider,
        `select public.tag_tournament_media_asset($1,'team',null,$2,null)`,
        [asset.assetId, scope.homeEntryId],
      ),
      /TORNEOS_MEDIA_FORBIDDEN/,
      'un actor cross-tenant no etiqueta equipos',
    );

    const [publicationA, publicationB] = await Promise.all([
      value(
        owner,
        `select public.publish_tournament_media_gallery($1)`,
        [galleryId],
      ),
      value(
        adminUser,
        `select public.publish_tournament_media_gallery($1)`,
        [galleryId],
      ),
    ]);
    eq(publicationA.status, 'published', 'publicación atómica completa');
    eq(publicationB.status, 'published', 'doble publicación es idempotente');
    eq(
      await value(
        admin,
        `select status from public.tournament_media_assets where id = $1`,
        [asset.assetId],
      ),
      'published',
      'publicar la galería publica sólo assets aprobados',
    );
    const participantMedia = await value(
      playerHome,
      `select public.get_published_tournament_media($1,$2,null,20,0)`,
      [scope.tournamentId, scope.categoryId],
    );
    eq(participantMedia.items.length, 1, 'jugador relacionado ve la galería publicada');
    eq(
      participantMedia.items[0].assets[0].originalAvailable,
      false,
      'el original permanece restringido',
    );
    ok(
      !JSON.stringify(participantMedia).match(/internalPath|checksum|bucket|uploadedBy/i),
      'payload participante excluye metadata sensible',
    );
    await expectError(
      () => value(
        outsider,
        `select public.get_published_tournament_media($1,$2,null,20,0)`,
        [scope.tournamentId, scope.categoryId],
      ),
      /TORNEOS_MEDIA_FORBIDDEN/,
      'outsider no enumera galerías por torneo conocido',
    );

    const report = await value(
      playerHome,
      `select public.report_tournament_media_asset(
        $1,'privacy','Prefiero que revisen esta imagen.',true,$2
      )`,
      [asset.assetId, '96200000-0000-4000-8000-000000000001'],
    );
    eq(report.status, 'open', 'jugador crea un reporte privado');
    const reportReplay = await value(
      playerHome,
      `select public.report_tournament_media_asset(
        $1,'privacy','Prefiero que revisen esta imagen.',true,$2
      )`,
      [asset.assetId, '96200000-0000-4000-8000-000000000001'],
    );
    eq(reportReplay.reportId, report.reportId, 'reportar es idempotente');
    const reportContext = await value(
      owner,
      `select public.get_tournament_media_admin_context($1,$2,null,30,0)`,
      [scope.organizationId, scope.tournamentId],
    );
    ok(
      !JSON.stringify(reportContext.reports).match(/reporter|userId|email/i),
      'la identidad del denunciante queda fuera del payload de revisión',
    );
    const handled = await value(
      owner,
      `select public.handle_tournament_media_report(
        $1,'resolved','Se ocultará si la política de privacidad lo requiere.'
      )`,
      [report.reportId],
    );
    eq(handled.status, 'resolved', 'owner resuelve reportes con motivo');

    const consentGallery = await createGallery(owner, scope, '5');
    const consentSession = await requestUpload(owner, consentGallery, '5');
    const consentAsset = await completeUpload(
      storageService,
      consentSession,
      'c'.repeat(64),
    );
    await value(
      owner,
      `select public.transition_tournament_media_asset($1,'approve',null)`,
      [consentAsset.assetId],
    );
    await value(
      owner,
      `select public.set_tournament_media_cover($1,$2)`,
      [consentGallery, consentAsset.assetId],
    );
    await value(
      owner,
      `select public.tag_tournament_media_asset($1,'player',null,$2,$3)`,
      [consentAsset.assetId, scope.entries[0], scope.rosterPlayers[0][0]],
    );
    await expectError(
      () => value(
        owner,
        `select public.publish_tournament_media_gallery($1)`,
        [consentGallery],
      ),
      /TORNEOS_MEDIA_CONSENT_REQUIRED/,
      'una relación de jugador falla cerrada sin derecho interno',
    );
    await value(
      owner,
      `select public.manage_tournament_media_consent(
        $1,$2,null,'view_internal','allowed',null
      )`,
      [consentAsset.assetId, scope.rosterPlayers[0][0]],
    );
    eq(
      (await value(
        owner,
        `select public.publish_tournament_media_gallery($1)`,
        [consentGallery],
      )).status,
      'published',
      'consentimiento interno explícito habilita la publicación restringida',
    );
    await expectError(
      () => value(
        owner,
        `select public.manage_tournament_media_consent(
          $1,$2,null,'social_future','not_required','corto'
        )`,
        [consentAsset.assetId, scope.rosterPlayers[0][0]],
      ),
      /tournament_media_consents_legal_basis_check/,
      'not_required exige fundamento documentado',
    );
    eq(
      await value(
        admin,
        `select minor_restriction from public.tournament_media_galleries where id = $1`,
        [consentGallery],
      ),
      true,
      'menores permanecen fail-closed para usos futuros',
    );
    eq(
      Number(await value(
        admin,
        `select count(*) from public.tournament_audit_log
         where resource_type in ('media_gallery','media_asset','media_report','media_upload_session')`,
      )) > 10,
      true,
      'acciones sensibles dejan auditoría append-only',
    );

    const photographerGallery = await createGallery(owner, scope, '6');
    await value(
      owner,
      `select public.assign_tournament_media_photographer($1,$2,false,false)`,
      [photographerGallery, USERS.collaborator],
    );
    const photographerSession = await requestUpload(
      collaborator,
      photographerGallery,
      '6',
    );
    ok(Boolean(photographerSession.sessionId), 'fotógrafo asignado carga sólo en su galería');
    await value(
      owner,
      `select public.assign_tournament_media_photographer($1,$2,false,true)`,
      [photographerGallery, USERS.collaborator],
    );
    await expectError(
      () => requestUpload(collaborator, photographerGallery, '7'),
      /TORNEOS_MEDIA_FORBIDDEN/,
      'revocar fotógrafo corta uploads inmediatamente',
    );

    const expiringGallery = await createGallery(owner, scope, '7');
    const expiredSession = await requestUpload(owner, expiringGallery, '8');
    await admin.query(
      `update public.tournament_media_upload_sessions
       set created_at = now() - interval '20 minutes',
           expires_at = now() - interval '10 minutes'
       where id = $1`,
      [expiredSession.sessionId],
    );
    await expectError(
      () => completeUpload(storageService, expiredSession, 'd'.repeat(64)),
      /TORNEOS_MEDIA_UPLOAD_SESSION_INVALID/,
      'sesión vencida no completa un asset',
    );

    const archiveResult = await value(
      owner,
      `select public.change_tournament_media_gallery_state(
        $1,'archive','La jornada terminó y pasa al archivo.'
      )`,
      [galleryId],
    );
    eq(archiveResult.status, 'archived', 'galería publicada se archiva sin borrado físico');
    eq(
      await value(
        admin,
        `select status from public.tournament_media_assets where id = $1`,
        [asset.assetId],
      ),
      'hidden',
      'archivar oculta assets sin eliminarlos',
    );
    eq(
      Number(await value(
        admin,
        `select count(*) from public.tournament_media_assets where id = $1`,
        [asset.assetId],
      )),
      1,
      'ninguna acción común borra físicamente el asset',
    );

    console.log(`\n${checks - failures}/${checks} verificaciones aprobadas.`);
    if (failures > 0) process.exitCode = 1;
  } finally {
    await cleanupMatchOperationsHarness();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
