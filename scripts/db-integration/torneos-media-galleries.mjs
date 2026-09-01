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

async function markVariantsReady(admin, assetId, checksumCharacter = 'e') {
  await admin.query(
    `update public.tournament_media_variants
     set status = 'ready',
         byte_size = coalesce(byte_size,1024),
         width = coalesce(width,1200),
         height = coalesce(height,675),
         checksum_sha256 = coalesce(checksum_sha256,repeat($2,64)),
         metadata_stripped = true
     where asset_id = $1`,
    [assetId, checksumCharacter],
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
    const concurrentOwner = await connect({
      role: 'authenticated',
      userId: USERS.owner,
    });
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
    const unattributedStorageService = await connect({
      role: 'service_role',
    });
    const photographerStorageService = await connect({
      role: 'service_role',
      userId: USERS.collaborator,
    });
    const concurrentStorageService = await connect({
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
      'public.tournament_media_consent_events',
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
           and grantee in ('PUBLIC','anon','authenticated')`,
      )),
      0,
      'el cliente no recibe grants directos sobre metadata privada',
    );
    eq(
      Number(await value(
        admin,
        `select count(*) from pg_policies
         where schemaname = 'public'
           and tablename like 'tournament_media_%'`,
      )),
      0,
      'las tablas privadas no dependen de policies abiertas o ambiguas',
    );
    const directActors = [
      ['owner', owner],
      ['admin', adminUser],
      ['collaborator', collaborator],
      ['capitán', captainHome],
      ['jugador', playerHome],
      ['outsider', outsider],
      ['anon', anonymous],
    ];
    for (const [actorLabel, client] of directActors) {
      for (const table of mediaTables) {
        await expectError(
          () => client.query(`select 1 from ${table} limit 1`),
          /permission denied/,
          `${actorLabel} no accede directamente a ${table.replace('public.', '')}`,
        );
      }
    }
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
    eq(
      Number(await value(
        admin,
        `select count(*)
         from information_schema.routine_privileges
         where routine_schema = 'public'
           and routine_name like '%tournament_media%'
           and grantee in ('PUBLIC','anon')`,
      )),
      0,
      'ninguna función multimedia conserva execute para PUBLIC o anon',
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
      () => createGallery(owner, scope, '1', {
        title: 'Intento distinto con la misma clave',
      }),
      /TORNEOS_MEDIA_IDEMPOTENCY_CONFLICT/,
      'crear galería rechaza una clave reutilizada con otro payload',
    );
    const concurrentGalleryResults = await Promise.all([
      createGallery(owner, scope, '17'),
      createGallery(concurrentOwner, scope, '17'),
    ]);
    eq(
      concurrentGalleryResults[0],
      concurrentGalleryResults[1],
      'doble submit concurrente devuelve la misma galería',
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
    await expectError(
      () => requestUpload(owner, galleryId, '4', { size: 4096 }),
      /TORNEOS_MEDIA_IDEMPOTENCY_CONFLICT/,
      'la sesión rechaza una clave reutilizada para otro archivo',
    );
    ok(
      !JSON.stringify(session).match(/internalPath|bucket|checksum/i),
      'la respuesta de sesión no expone path, bucket ni checksum',
    );
    await expectError(
      () => completeUpload(
        unattributedStorageService,
        session,
        'a'.repeat(64),
      ),
      /TORNEOS_AUTH_REQUIRED/,
      'service_role sin actor autenticado no finaliza una carga',
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
    eq(
      Number(await value(
        admin,
        `select count(*) from public.tournament_audit_log
         where resource_id in ($1,$2)
           and metadata::text ilike '%' || $3 || '%'`,
        [session.sessionId, asset.assetId, session.token],
      )),
      0,
      'token y hash no aparecen en auditoría',
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
        owner,
        `select public.transition_tournament_media_asset($1,'approve',null)`,
        [asset.assetId],
      ),
      /TORNEOS_MEDIA_PROCESSING_REQUIRED/,
      'no se aprueba una foto antes de completar variantes seguras',
    );
    await markVariantsReady(admin, asset.assetId, 'e');
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
    await expectError(
      () => value(
        owner,
        `select public.set_tournament_media_cover($1,$2)`,
        [galleryId, asset.assetId],
      ),
      /TORNEOS_MEDIA_GALLERY_IMMUTABLE/,
      'una galería publicada no cambia portada silenciosamente',
    );
    await expectError(
      () => value(
        owner,
        `select public.tag_tournament_media_asset($1,'team',null,$2,null)`,
        [asset.assetId, scope.homeEntryId],
      ),
      /TORNEOS_MEDIA_GALLERY_IMMUTABLE/,
      'una galería publicada no cambia relaciones silenciosamente',
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
    await expectError(
      () => value(
        playerHome,
        `select public.report_tournament_media_asset(
          $1,'other','Otro motivo con la misma clave.',false,$2
        )`,
        [asset.assetId, '96200000-0000-4000-8000-000000000001'],
      ),
      /TORNEOS_MEDIA_IDEMPOTENCY_CONFLICT/,
      'un reporte no reutiliza su clave con otro payload',
    );
    const reportContext = await value(
      owner,
      `select public.get_tournament_media_admin_context($1,$2,null,30,0)`,
      [scope.organizationId, scope.tournamentId],
    );
    ok(
      !JSON.stringify(reportContext.reports).match(/reporter|userId|email/i),
      'la identidad del denunciante queda fuera del payload de revisión',
    );
    const collaboratorReportContext = await value(
      collaborator,
      `select public.get_tournament_media_admin_context($1,$2,null,30,0)`,
      [scope.organizationId, scope.tournamentId],
    );
    eq(
      collaboratorReportContext.reports.length,
      0,
      'collaborator read-only no recibe reportes privados',
    );
    eq(
      collaboratorReportContext.galleries[0].reportCount,
      0,
      'collaborator read-only no infiere reportes por contadores',
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
    await markVariantsReady(admin, consentAsset.assetId, 'f');
    await value(
      owner,
      `select public.transition_tournament_media_asset($1,'approve',null)`,
      [consentAsset.assetId],
    );
    const consentFallbackSession = await requestUpload(owner, consentGallery, '16');
    const consentFallbackAsset = await completeUpload(
      storageService,
      consentFallbackSession,
      '0'.repeat(64),
    );
    await markVariantsReady(admin, consentFallbackAsset.assetId, '1');
    await value(
      owner,
      `select public.transition_tournament_media_asset($1,'approve',null)`,
      [consentFallbackAsset.assetId],
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
    await expectError(
      () => value(
        owner,
        `select public.manage_tournament_media_consent(
          $1,null,$2,'view_internal','allowed',null
        )`,
        [consentAsset.assetId, USERS.outsider],
      ),
      /TORNEOS_MEDIA_SCOPE_INVALID/,
      'no se registra consentimiento de una identidad ajena al asset',
    );
    await value(
      owner,
      `select public.manage_tournament_media_consent(
        $1,$2,null,'view_internal','allowed',null
      )`,
      [consentAsset.assetId, scope.rosterPlayers[0][0]],
    );
    await value(
      owner,
      `select public.manage_tournament_media_consent(
        $1,$2,null,'view_internal','allowed',null
      )`,
      [consentAsset.assetId, scope.rosterPlayers[0][0]],
    );
    await value(
      owner,
      `select public.manage_tournament_media_consent(
        $1,$2,$3,'view_internal','revoked',null
      )`,
      [consentAsset.assetId, scope.rosterPlayers[0][0], USERS.playerHome],
    );
    eq(
      Number(await value(
        admin,
        `select count(*) from public.tournament_media_consents
         where asset_id = $1 and use_scope = 'view_internal'`,
        [consentAsset.assetId],
      )),
      1,
      'roster y usuario enlazado resuelven a una única identidad de consentimiento',
    );
    await expectError(
      () => value(
        owner,
        `select public.publish_tournament_media_gallery($1)`,
        [consentGallery],
      ),
      /TORNEOS_MEDIA_CONSENT_REQUIRED/,
      'una revocación canónica prevalece sobre la decisión previa',
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
      Number(await value(
        admin,
        `select count(*) from public.tournament_media_consent_events
         where asset_id = $1`,
        [consentAsset.assetId],
      )),
      3,
      'cada cambio canónico conserva un evento append-only',
    );
    const consentPublicationRace = await Promise.allSettled([
      value(
        owner,
        `select public.publish_tournament_media_gallery($1)`,
        [consentGallery],
      ),
      value(
        adminUser,
        `select public.manage_tournament_media_consent(
          $1,$2,null,'view_internal','revoked',null
        )`,
        [consentAsset.assetId, scope.rosterPlayers[0][0]],
      ),
    ]);
    ok(
      consentPublicationRace.some((result) => result.status === 'fulfilled'),
      'publicar y revocar consentimiento concurrentemente resuelve sin deadlock',
    );
    eq(
      await value(
        admin,
        `select status from public.tournament_media_assets where id = $1`,
        [consentAsset.assetId],
      ),
      'hidden',
      'revocar visualización interna retira la foto publicada',
    );
    eq(
      await value(
        admin,
        `select status from public.tournament_media_galleries where id = $1`,
        [consentGallery],
      ),
      'published',
      'la galería publicada conserva sólo la foto de reemplazo válida',
    );
    eq(
      await value(
        admin,
        `select cover_asset_id from public.tournament_media_galleries where id = $1`,
        [consentGallery],
      ),
      consentFallbackAsset.assetId,
      'revocar la portada elige otra foto publicada de forma atómica',
    );
    await expectError(
      () => value(
        owner,
        `select public.transition_tournament_media_asset($1,'restore',null)`,
        [consentAsset.assetId],
      ),
      /TORNEOS_MEDIA_CONSENT_REQUIRED/,
      'una foto con consentimiento revocado no se restaura en una galería publicada',
    );
    eq(
      Number(await value(
        admin,
        `select count(*) from public.tournament_media_consent_events
         where asset_id = $1`,
        [consentAsset.assetId],
      )),
      4,
      'la revocación preserva el historial de consentimiento',
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

    const mixedGallery = await createGallery(owner, scope, '10');
    const mixedReadySession = await requestUpload(owner, mixedGallery, '12');
    const mixedPendingSession = await requestUpload(owner, mixedGallery, '13');
    const mixedReadyAsset = await completeUpload(
      storageService,
      mixedReadySession,
      '4'.repeat(64),
    );
    const mixedPendingAsset = await completeUpload(
      storageService,
      mixedPendingSession,
      '5'.repeat(64),
    );
    await markVariantsReady(admin, mixedReadyAsset.assetId, '3');
    await value(
      owner,
      `select public.transition_tournament_media_asset($1,'approve',null)`,
      [mixedReadyAsset.assetId],
    );
    await value(
      owner,
      `select public.set_tournament_media_cover($1,$2)`,
      [mixedGallery, mixedReadyAsset.assetId],
    );
    await expectError(
      () => value(
        owner,
        `select public.publish_tournament_media_gallery($1)`,
        [mixedGallery],
      ),
      /TORNEOS_MEDIA_GALLERY_NOT_PUBLISHABLE/,
      'una foto pendiente impide publicar parcialmente la galería',
    );
    await value(
      owner,
      `select public.transition_tournament_media_asset(
        $1,'reject','La foto no cumple los criterios editoriales.'
      )`,
      [mixedPendingAsset.assetId],
    );
    eq(
      Number(await value(
        admin,
        `select count(*) from public.tournament_media_gallery_items
         where gallery_id = $1 and asset_id = $2`,
        [mixedGallery, mixedPendingAsset.assetId],
      )),
      0,
      'rechazar preserva el asset pero retira el item inválido de la galería',
    );
    eq(
      (await value(
        owner,
        `select public.publish_tournament_media_gallery($1)`,
        [mixedGallery],
      )).status,
      'published',
      'la galería publica sólo después de resolver todos sus items',
    );

    const photographerGallery = await createGallery(owner, scope, '6');
    await value(
      owner,
      `select public.assign_tournament_media_photographer($1,$2,false)`,
      [photographerGallery, USERS.collaborator],
    );
    for (const table of mediaTables) {
      await expectError(
        () => collaborator.query(`select 1 from ${table} limit 1`),
        /permission denied/,
        `fotógrafo asignado no accede directamente a ${table.replace('public.', '')}`,
      );
    }
    const photographerSession = await requestUpload(
      collaborator,
      photographerGallery,
      '6',
    );
    ok(Boolean(photographerSession.sessionId), 'fotógrafo asignado carga sólo en su galería');
    await value(
      owner,
      `select public.assign_tournament_media_photographer($1,$2,true)`,
      [photographerGallery, USERS.collaborator],
    );
    await expectError(
      () => requestUpload(collaborator, photographerGallery, '7'),
      /TORNEOS_MEDIA_FORBIDDEN/,
      'revocar fotógrafo corta uploads inmediatamente',
    );
    await expectError(
      () => completeUpload(
        photographerStorageService,
        photographerSession,
        '9'.repeat(64),
      ),
      /TORNEOS_MEDIA_UPLOAD_SESSION_INVALID/,
      'una sesión emitida queda inutilizable después de revocar al fotógrafo',
    );
    eq(
      await value(
        admin,
        `select status from public.tournament_media_upload_sessions where id = $1`,
        [photographerSession.sessionId],
      ),
      'revoked',
      'la revocación marca sesiones pendientes sin depender de su expiración',
    );
    await value(
      owner,
      `select public.assign_tournament_media_photographer($1,$2,false)`,
      [photographerGallery, USERS.collaborator],
    );
    const photographerReviewSession = await requestUpload(
      collaborator,
      photographerGallery,
      '9',
    );
    const photographerAsset = await completeUpload(
      photographerStorageService,
      photographerReviewSession,
      '8'.repeat(64),
    );
    await markVariantsReady(admin, photographerAsset.assetId, '7');
    await expectError(
      () => value(
        collaborator,
        `select public.transition_tournament_media_asset($1,'approve',null)`,
        [photographerAsset.assetId],
      ),
      /TORNEOS_MEDIA_FORBIDDEN/,
      'fotógrafo asignado no recibe moderación sobre sus propias fotos',
    );
    await expectError(
      () => collaborator.query(
        `select 1 from public.tournament_media_assignments where gallery_id = $1`,
        [photographerGallery],
      ),
      /permission denied/,
      'fotógrafo no lee asignaciones ni auditoría interna',
    );
    const moderationRace = await Promise.allSettled([
      value(
        owner,
        `select public.transition_tournament_media_asset($1,'approve',null)`,
        [photographerAsset.assetId],
      ),
      value(
        adminUser,
        `select public.transition_tournament_media_asset(
          $1,'reject','No cumple el criterio editorial.'
        )`,
        [photographerAsset.assetId],
      ),
    ]);
    eq(
      moderationRace.filter((result) => result.status === 'fulfilled').length,
      1,
      'aprobar y rechazar concurrentemente produce una sola transición',
    );
    eq(
      Number(await value(
        admin,
        `select count(*) from public.tournament_media_moderation_actions
         where asset_id = $1`,
        [photographerAsset.assetId],
      )),
      1,
      'la carrera de moderación deja una única acción auditable',
    );

    const cancelledGallery = await createGallery(owner, scope, '8');
    const cancelledSession = await requestUpload(owner, cancelledGallery, '10');
    eq(
      (await value(
        owner,
        `select public.cancel_tournament_media_upload_session($1)`,
        [cancelledSession.sessionId],
      )).status,
      'revoked',
      'el solicitante puede cancelar una sesión pendiente',
    );
    await expectError(
      () => completeUpload(storageService, cancelledSession, '6'.repeat(64)),
      /TORNEOS_MEDIA_UPLOAD_SESSION_INVALID/,
      'una sesión cancelada no puede completarse',
    );

    const duplicateGallery = await createGallery(owner, scope, '11');
    const duplicateSessionA = await requestUpload(owner, duplicateGallery, '14');
    const duplicateSessionB = await requestUpload(owner, duplicateGallery, '15');
    const duplicateResults = await Promise.allSettled([
      completeUpload(storageService, duplicateSessionA, '2'.repeat(64)),
      completeUpload(concurrentStorageService, duplicateSessionB, '2'.repeat(64)),
    ]);
    eq(
      duplicateResults.filter((result) => result.status === 'fulfilled').length,
      1,
      'checksums duplicados concurrentes crean un único asset',
    );
    eq(
      Number(await value(
        admin,
        `select count(*) from public.tournament_media_assets
         where organization_id = $1 and checksum_sha256 = $2`,
        [scope.organizationId, '2'.repeat(64)],
      )),
      1,
      'el índice parcial certifica deduplicación activa',
    );

    const expiringGallery = await createGallery(owner, scope, '9');
    const expiredSession = await requestUpload(owner, expiringGallery, '11');
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
