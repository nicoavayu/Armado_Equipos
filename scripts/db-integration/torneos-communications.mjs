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

async function createDraft(client, scope, suffix, overrides = {}) {
  return value(
    client,
    `select public.create_tournament_announcement_draft(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
    )`,
    [
      scope.organizationId,
      scope.tournamentId,
      overrides.categoryId ?? scope.categoryId,
      overrides.type || 'general',
      overrides.title || `Comunicado oficial ${suffix}`,
      overrides.summary || `Resumen oficial ${suffix}`,
      overrides.body || `Contenido seguro del comunicado ${suffix}.`,
      overrides.priority || 'normal',
      overrides.acknowledgementMode || 'read',
      overrides.scheduledFor || null,
      overrides.supersedesId || null,
      overrides.correctionReason || null,
      overrides.idempotencyKey || `95000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
    ],
  );
}

async function run() {
  console.log('Arma2 Torneos · communications PostgreSQL/RLS');
  try {
    const admin = await setup([
      '20260726200000_tournament_standings_discipline.sql',
      '20260726230000_tournament_participant_hub.sql',
      '20260727010000_tournament_communications.sql',
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

    const rlsTables = Number(await value(
      admin,
      `select count(*) from pg_class
       where oid = any($1::regclass[]) and relrowsecurity`,
      [[
        'public.tournament_announcements',
        'public.tournament_announcement_audiences',
        'public.tournament_announcement_links',
        'public.tournament_announcement_deliveries',
        'public.tournament_documents',
        'public.tournament_document_versions',
        'public.tournament_document_acknowledgements',
        'public.tournament_notification_preferences',
      ]],
    ));
    eq(rlsTables, 8, 'todas las tablas del dominio tienen RLS');
    const directGrants = Number(await value(
      admin,
      `select count(*) from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name like 'tournament_%'
         and table_name in (
           'tournament_announcements','tournament_announcement_audiences',
           'tournament_announcement_links','tournament_announcement_deliveries',
           'tournament_documents','tournament_document_versions',
           'tournament_document_acknowledgements',
           'tournament_notification_preferences'
         )
         and grantee in ('anon','authenticated')`,
    ));
    eq(directGrants, 0, 'el cliente no tiene mutaciones directas');
    await expectError(
      () => anonymous.query('select public.get_tournament_communications_inbox()'),
      /permission denied/,
      'anon no abre el inbox',
    );

    const collaboratorDraft = await createDraft(collaborator, scope, '1');
    ok(collaboratorDraft, 'collaborator puede crear un draft');
    await expectError(
      () => collaborator.query(
        'select public.publish_tournament_announcement($1,null)',
        [collaboratorDraft],
      ),
      /TORNEOS_COMMUNICATION_FORBIDDEN/,
      'collaborator no publica sin capability',
    );
    await expectError(
      () => createDraft(playerHome, scope, '2'),
      /TORNEOS_COMMUNICATION_FORBIDDEN/,
      'jugador no crea comunicados',
    );
    await expectError(
      () => createDraft(owner, scope, '9', {
        title: 'Contenido HTML bloqueado',
        summary: 'El contenido inseguro debe rechazarse.',
        body: '<script>alert(1)</script>',
      }),
      /tournament_announcements_content_check|violates check/i,
      'HTML arbitrario se rechaza por constraint',
    );

    const announcementId = await createDraft(owner, scope, '3', {
      type: 'match_update',
      title: 'Cambio de horario confirmado',
      summary: 'El próximo partido comienza una hora más tarde.',
      body: 'Revisá el horario actualizado y llegá con anticipación.',
      priority: 'urgent',
      acknowledgementMode: 'explicit',
    });
    const duplicateId = await createDraft(owner, scope, '3', {
      type: 'match_update',
      title: 'Cambio de horario confirmado',
      summary: 'El próximo partido comienza una hora más tarde.',
      body: 'Revisá el horario actualizado y llegá con anticipación.',
      priority: 'urgent',
      acknowledgementMode: 'explicit',
    });
    eq(duplicateId, announcementId, 'crear draft es idempotente');
    await value(
      owner,
      `select public.set_tournament_announcement_audience(
        $1,'tournament',null,null,null,null
      )`,
      [announcementId],
    );
    await value(
      owner,
      `select public.set_tournament_announcement_audience(
        $1,'captains',null,null,null,null
      )`,
      [announcementId],
    );
    const preview = await value(
      owner,
      'select public.preview_tournament_announcement_audience($1)',
      [announcementId],
    );
    ok(preview.estimatedRecipients >= 4, 'preview resuelve relaciones autoritativas');
    eq(
      new Set(preview.roles).size,
      preview.roles.length,
      'preview resume roles sin datos de contacto',
    );
    ok(
      !JSON.stringify(preview).match(/email|phone/i),
      'preview no filtra emails ni teléfonos',
    );

    const [publishA, publishB] = await Promise.all([
      value(
        owner,
        'select public.publish_tournament_announcement($1,$2)',
        [announcementId, preview.estimatedRecipients],
      ),
      value(
        adminUser,
        'select public.publish_tournament_announcement($1,$2)',
        [announcementId, preview.estimatedRecipients],
      ),
    ]);
    eq(publishA.status, 'published', 'publicación concurrente completa atómicamente');
    eq(publishB.status, 'published', 'reintento concurrente es idempotente');
    eq(
      Number(await value(
        admin,
        `select count(*) from public.tournament_announcement_deliveries
         where announcement_id = $1`,
        [announcementId],
      )),
      publishA.recipientCount,
      'entregas deduplicadas coinciden con snapshot final',
    );

    const inbox = await value(
      playerHome,
      `select public.get_tournament_communications_inbox($1,'all',20,0)`,
      [scope.tournamentId],
    );
    eq(inbox.items.length, 1, 'jugador recibe su notificación interna');
    eq(inbox.items[0].priority, 'urgent', 'inbox conserva prioridad explícita');
    ok(
      !JSON.stringify(inbox).match(/authorUser|recipientUser|email|phone/i),
      'inbox usa un payload allowlistado',
    );
    const detail = await value(
      playerHome,
      'select public.get_tournament_announcement($1)',
      [announcementId],
    );
    eq(detail.body.includes('anticipación'), true, 'detalle entrega el contenido completo');
    await expectError(
      () => outsider.query(
        'select public.get_tournament_announcement($1)',
        [announcementId],
      ),
      /TORNEOS_COMMUNICATION_FORBIDDEN/,
      'UUID conocido no concede lectura al outsider',
    );
    const confirmed = await value(
      playerHome,
      'select public.mark_tournament_announcement_read($1,true)',
      [announcementId],
    );
    eq(confirmed.status, 'confirmed', 'participante confirma que leyó');
    eq(
      confirmed.confirmationIsLegalAcceptance,
      false,
      'confirmación no se presenta como aceptación legal',
    );
    const captainRead = await value(
      captainHome,
      'select public.mark_tournament_announcement_read($1,false)',
      [announcementId],
    );
    eq(captainRead.status, 'read', 'capitán marca como leído');

    const preferences = await value(
      playerHome,
      `select public.update_my_tournament_notification_preferences(
        $1,false,true,true,true,false,false
      )`,
      [scope.tournamentId],
    );
    eq(preferences.general, false, 'preferencias propias se actualizan por RPC');
    eq(preferences.channels.push, false, 'push permanece deshabilitado');
    eq(preferences.channels.email, false, 'email permanece deshabilitado');
    await expectError(
      () => outsider.query(
        'select public.get_my_tournament_notification_preferences($1)',
        [scope.tournamentId],
      ),
      /TORNEOS_COMMUNICATION_FORBIDDEN/,
      'preferencias no crean autorización',
    );

    const document = await value(
      owner,
      `select public.create_tournament_document(
        $1,$2,$3,'regulation','Reglamento oficial',
        'Reglas vigentes de la competencia.',
        'Este reglamento define las reglas deportivas de la competencia.',
        'explicit','2030-01-01T00:00:00Z',$4
      )`,
      [
        scope.organizationId,
        scope.tournamentId,
        scope.categoryId,
        '96000000-0000-4000-8000-000000000001',
      ],
    );
    const duplicateDocument = await value(
      owner,
      `select public.create_tournament_document(
        $1,$2,$3,'regulation','Reglamento oficial',
        'Reglas vigentes de la competencia.',
        'Este reglamento define las reglas deportivas de la competencia.',
        'explicit','2030-01-01T00:00:00Z',$4
      )`,
      [
        scope.organizationId,
        scope.tournamentId,
        scope.categoryId,
        '96000000-0000-4000-8000-000000000001',
      ],
    );
    eq(
      duplicateDocument.versionId,
      document.versionId,
      'doble click de documento devuelve la misma versión inicial',
    );
    await expectError(
      () => owner.query(
        `select public.create_tournament_document(
          $1,$2,$3,'regulation','Otro reglamento',
          'Reglas vigentes de la competencia.',
          'Este reglamento define las reglas deportivas de la competencia.',
          'explicit','2030-01-01T00:00:00Z',$4
        )`,
        [
          scope.organizationId,
          scope.tournamentId,
          scope.categoryId,
          '96000000-0000-4000-8000-000000000001',
        ],
      ),
      /TORNEOS_IDEMPOTENCY_CONFLICT/,
      'reusar la clave de documento con otro payload falla cerrado',
    );
    const publishedDocument = await value(
      owner,
      'select public.publish_tournament_document_version($1)',
      [document.versionId],
    );
    eq(publishedDocument.status, 'published', 'documento oficial publica una versión');
    const documents = await value(
      playerHome,
      'select public.get_published_tournament_documents($1,$2)',
      [scope.tournamentId, scope.categoryId],
    );
    eq(documents.items.length, 1, 'jugador ve documento publicado de su categoría');
    ok(
      !JSON.stringify(documents).match(/createdBy|publishedBy|userId/i),
      'documentos omiten actores internos',
    );
    const acknowledgement = await value(
      playerHome,
      'select public.acknowledge_tournament_document($1,true)',
      [document.versionId],
    );
    eq(acknowledgement.status, 'confirmed', 'documento registra confirmación explícita');
    eq(
      acknowledgement.confirmationIsLegalAcceptance,
      false,
      'documento tampoco simula aceptación legal',
    );
    await expectError(
      () => admin.query(
        `update public.tournament_document_versions
         set body = 'Cambio silencioso' where id = $1`,
        [document.versionId],
      ),
      /TORNEOS_DOCUMENT_VERSION_IMMUTABLE/,
      'versión publicada es inmutable incluso para escritura privilegiada',
    );

    const version2 = await value(
      owner,
      `select public.create_tournament_document_version(
        $1,'Reglas actualizadas de la competencia.',
        'Nueva versión completa del reglamento deportivo.',
        '2030-02-01T00:00:00Z','Se aclaró el criterio de desempate'
      )`,
      [document.documentId],
    );
    await value(
      owner,
      'select public.publish_tournament_document_version($1)',
      [version2],
    );
    eq(
      await value(
        admin,
        `select status from public.tournament_document_versions where id = $1`,
        [document.versionId],
      ),
      'superseded',
      'nueva versión conserva la anterior como histórica',
    );
    eq(
      Number(await value(
        admin,
        `select count(*) from public.tournament_document_acknowledgements
         where version_id = $1`,
        [document.versionId],
      )),
      1,
      'actualización no borra confirmaciones previas',
    );

    const correctionId = await createDraft(owner, scope, '4', {
      type: 'match_update',
      title: 'Horario corregido oficialmente',
      summary: 'Se corrigió la hora informada anteriormente.',
      body: 'La nueva hora oficial figura en el detalle del partido.',
      priority: 'urgent',
      acknowledgementMode: 'read',
      supersedesId: announcementId,
      correctionReason: 'Se informó una hora equivocada',
    });
    await value(
      owner,
      `select public.set_tournament_announcement_audience(
        $1,'tournament',null,null,null,null
      )`,
      [correctionId],
    );
    const competingCorrectionId = await createDraft(owner, scope, '10', {
      type: 'match_update',
      title: 'Corrección alternativa no publicable',
      summary: 'Una segunda rama no puede reemplazar el mismo comunicado.',
      body: 'Sólo una corrección puede convertirse en la versión vigente.',
      priority: 'urgent',
      acknowledgementMode: 'read',
      supersedesId: announcementId,
      correctionReason: 'Se preparó una alternativa concurrente',
    });
    await value(
      owner,
      `select public.set_tournament_announcement_audience(
        $1,'tournament',null,null,null,null
      )`,
      [competingCorrectionId],
    );
    await value(
      owner,
      'select public.publish_tournament_announcement($1,null)',
      [correctionId],
    );
    await expectError(
      () => owner.query(
        'select public.publish_tournament_announcement($1,null)',
        [competingCorrectionId],
      ),
      /TORNEOS_CORRECTION_ALREADY_SUPERSEDED/,
      'dos correcciones no pueden quedar publicadas sobre la misma versión',
    );
    eq(
      await value(
        admin,
        'select status from public.tournament_announcements where id = $1',
        [announcementId],
      ),
      'superseded',
      'corrección supersede sin reescribir el comunicado previo',
    );
    await value(
      playerHome,
      'select public.mark_tournament_announcement_read($1,true)',
      [correctionId],
    );
    const teamPrivateId = await createDraft(owner, scope, '8', {
      title: 'Información privada para Napoli',
      summary: 'Este aviso corresponde únicamente al plantel de Napoli.',
      body: 'La información del equipo no debe seguir a una relación revocada.',
    });
    await value(
      owner,
      `select public.set_tournament_announcement_audience(
        $1,'team',null,$2,null,null
      )`,
      [teamPrivateId, scope.entries[0]],
    );
    await value(
      owner,
      'select public.publish_tournament_announcement($1,null)',
      [teamPrivateId],
    );
    await value(
      admin,
      `insert into public.tournament_team_managers(
        organization_id,team_entry_id,user_id,display_name,role,status,
        invited_by,accepted_at
      ) values ($1,$2,$3,'Delegado alternativo','delegate','active',$4,now())`,
      [
        scope.organizationId,
        scope.entries[1],
        USERS.playerHome,
        USERS.owner,
      ],
    );
    await value(
      admin,
      `update public.tournament_roster_players
       set status = 'removed',removed_at = now()
       where organization_id = $1 and arma2_user_id = $2`,
      [scope.organizationId, USERS.playerHome],
    );
    await expectError(
      () => playerHome.query(
        'select public.get_tournament_announcement($1)',
        [teamPrivateId],
      ),
      /TORNEOS_COMMUNICATION_FORBIDDEN/,
      'otra relación del torneo no conserva el aviso privado del equipo anterior',
    );
    await expectError(
      () => playerHome.query(
        'select public.mark_tournament_announcement_read($1,true)',
        [teamPrivateId],
      ),
      /TORNEOS_COMMUNICATION_FORBIDDEN/,
      'la lectura revalida la audiencia exacta y no sólo el torneo',
    );
    const stillRelatedDetail = await value(
      playerHome,
      'select public.get_tournament_announcement($1)',
      [correctionId],
    );
    eq(
      stillRelatedDetail.id,
      correctionId,
      'una relación actual distinta conserva comunicados dirigidos a todo el torneo',
    );
    await admin.query(
      `update public.tournament_team_managers
       set status = 'revoked',revoked_at = now()
       where organization_id = $1 and team_entry_id = $2 and user_id = $3`,
      [scope.organizationId, scope.entries[1], USERS.playerHome],
    );
    await expectError(
      () => playerHome.query(
        'select public.get_tournament_announcement($1)',
        [correctionId],
      ),
      /TORNEOS_COMMUNICATION_FORBIDDEN/,
      'entrega histórica no reemplaza una relación actual revocada',
    );
    await expectError(
      () => playerHome.query(
        'select public.mark_tournament_announcement_read($1,true)',
        [correctionId],
      ),
      /TORNEOS_COMMUNICATION_FORBIDDEN/,
      'sin relación vigente tampoco puede confirmar una lectura',
    );
    await value(
      admin,
      `update public.tournament_roster_players
       set status = 'active',removed_at = null
       where organization_id = $1 and arma2_user_id = $2
       returning id`,
      [scope.organizationId, USERS.playerHome],
    );
    await value(
      owner,
      `select public.revoke_tournament_announcement(
        $1,'La corrección dejó de corresponder'
      )`,
      [correctionId],
    );
    eq(
      await value(
        admin,
        'select status from public.tournament_announcements where id = $1',
        [correctionId],
      ),
      'revoked',
      'revocación conserva el hecho y el motivo',
    );
    eq(
      await value(
        admin,
        `select status from public.tournament_announcement_deliveries
         where announcement_id = $1 and recipient_user_id = $2`,
        [correctionId, USERS.playerHome],
      ),
      'revoked',
      'revocar preserva lecturas previas y retira la entrega',
    );

    const scheduledId = await createDraft(owner, scope, '5', {
      scheduledFor: '2031-01-01T00:00:00Z',
      title: 'Publicación preparada para una fecha futura',
      summary: 'La infraestructura automática todavía no está habilitada.',
      body: 'Este comunicado permanece programado hasta una acción explícita.',
    });
    eq(
      await value(
        admin,
        'select status from public.tournament_announcements where id = $1',
        [scheduledId],
      ),
      'scheduled',
      'programación futura queda fail-closed sin cron',
    );
    await expectError(
      () => collaborator.query(
        `select public.update_tournament_announcement_draft(
          $1,'Título ajeno','Resumen ajeno','Contenido ajeno',
          'normal','none',null
        )`,
        [scheduledId],
      ),
      /TORNEOS_COMMUNICATION_FORBIDDEN/,
      'collaborator no edita drafts ajenos',
    );
    await expectError(
      () => owner.query(
        `select public.set_tournament_announcement_link(
          $1,'external',null,'javascript:alert(1)','Enlace inseguro',0
        )`,
        [scheduledId],
      ),
      /TORNEOS_INVALID_COMMUNICATION_LINK/,
      'enlaces con esquema inseguro se rechazan',
    );

    const organizationDraft = await createDraft(owner, scope, '6', {
      title: 'Información para miembros de la organización',
      summary: 'El conteo final se revalida antes de publicar.',
      body: 'Sólo memberships activas integran esta audiencia.',
    });
    await value(
      owner,
      `select public.set_tournament_announcement_audience(
        $1,'organization',null,null,null,null
      )`,
      [organizationDraft],
    );
    const organizationPreview = await value(
      owner,
      'select public.preview_tournament_announcement_audience($1)',
      [organizationDraft],
    );
    await admin.query(
      `update public.tournament_organization_members
       set status = 'suspended'
       where organization_id = $1 and user_id = $2`,
      [scope.organizationId, USERS.collaborator],
    );
    const changedPreview = await value(
      owner,
      'select public.preview_tournament_announcement_audience($1)',
      [organizationDraft],
    );
    eq(
      changedPreview.estimatedRecipients,
      organizationPreview.estimatedRecipients - 1,
      'membership suspendida sale de la audiencia revalidada',
    );
    await admin.query(
      `update public.tournament_organization_members
       set status = 'active'
       where organization_id = $1 and user_id = $2`,
      [scope.organizationId, USERS.collaborator],
    );

    const teamDraft = await createDraft(owner, scope, '7', {
      title: 'Información para un equipo inscripto',
      summary: 'El equipo debe conservar una inscripción vigente.',
      body: 'Una inscripción retirada no puede recibir nuevos comunicados.',
    });
    await value(
      owner,
      `select public.set_tournament_announcement_audience(
        $1,'team',null,$2,null,null
      )`,
      [teamDraft, scope.entries[0]],
    );
    await admin.query(
      `update public.tournament_team_entries
       set status = 'withdrawn',withdrawn_at = now()
       where id = $1`,
      [scope.entries[0]],
    );
    const withdrawnPreview = await value(
      owner,
      'select public.preview_tournament_announcement_audience($1)',
      [teamDraft],
    );
    eq(
      withdrawnPreview.estimatedRecipients,
      0,
      'equipo retirado no resuelve destinatarios',
    );
    await admin.query(
      `update public.tournament_team_entries
       set status = 'approved',withdrawn_at = null
       where id = $1`,
      [scope.entries[0]],
    );
    await admin.query(
      `update public.tournament_categories
       set status = 'archived',archived_at = now()
       where id = $1`,
      [scope.categoryId],
    );
    const archivedCategoryPreview = await value(
      owner,
      'select public.preview_tournament_announcement_audience($1)',
      [teamDraft],
    );
    eq(
      archivedCategoryPreview.estimatedRecipients,
      0,
      'categoría archivada deja de resolver destinatarios actuales',
    );
    await admin.query(
      `update public.tournament_categories
       set status = 'active',archived_at = null
       where id = $1`,
      [scope.categoryId],
    );
    const replacementDraft = await createDraft(owner, scope, '12', {
      title: 'Audiencia reemplazable del compositor',
      summary: 'La edición no debe acumular criterios anteriores.',
      body: 'El criterio actual reemplaza atómicamente el preview anterior.',
    });
    await value(
      owner,
      `select public.set_tournament_announcement_audience(
        $1,'tournament',null,null,null,null
      )`,
      [replacementDraft],
    );
    await value(
      owner,
      `select public.replace_tournament_announcement_audience(
        $1,'team',null,$2,null,null
      )`,
      [replacementDraft, scope.entries[1]],
    );
    eq(
      Number(await value(
        admin,
        `select count(*) from public.tournament_announcement_audiences
         where announcement_id = $1 and audience_type = 'team'
           and team_entry_id = $2`,
        [replacementDraft, scope.entries[1]],
      )),
      1,
      'editar el compositor reemplaza la audiencia sin acumular criterios',
    );
    await value(
      owner,
      `select public.set_tournament_announcement_link(
        $1,'category',$2,null,'Ver categoría',0
      )`,
      [replacementDraft, scope.categoryId],
    );
    await admin.query(
      `update public.tournament_categories
       set status = 'archived',archived_at = now()
       where id = $1`,
      [scope.categoryId],
    );
    await expectError(
      () => owner.query(
        'select public.publish_tournament_announcement($1,null)',
        [replacementDraft],
      ),
      /TORNEOS_INVALID_COMMUNICATION_LINK/,
      'publicar revalida el recurso del CTA contra el scope vigente',
    );
    await admin.query(
      `update public.tournament_categories
       set status = 'active',archived_at = null
       where id = $1`,
      [scope.categoryId],
    );

    await value(
      owner,
      `select public.set_tournament_announcement_audience(
        $1,'tournament',null,null,null,null
      )`,
      [scheduledId],
    );
    await admin.query(
      `insert into public.tournament_announcements(
        organization_id,season_id,tournament_id,author_user_id,status,
        announcement_type,title,summary,body,priority,acknowledgement_mode,
        published_at,idempotency_key
      )
      select
        $1,tournament.season_id,$2,$3,'published','general',
        'Comunicado de límite ' || series,
        'Resumen para verificar el límite.',
        'Contenido publicado para verificar concurrencia y abuso.',
        'normal','none',now(),gen_random_uuid()
      from public.tournaments tournament
      cross join generate_series(1,18) series
      where tournament.id = $2`,
      [scope.organizationId, scope.tournamentId, USERS.owner],
    );
    await expectError(
      () => owner.query(
        'select public.publish_tournament_announcement($1,null)',
        [scheduledId],
      ),
      /TORNEOS_PUBLISH_RATE_LIMITED/,
      'rate limit bloquea spam aunque exista un scheduled válido',
    );
    const adminContext = await value(
      owner,
      'select public.get_tournament_communications_admin_context($1,$2)',
      [scope.organizationId, scope.tournamentId],
    );
    eq(
      adminContext.scheduledPublishingEnabled,
      false,
      'UI recibe explícitamente que no hay publicación automática',
    );
    ok(
      adminContext.capabilities.includes('announcements.publish'),
      'contexto organizador resuelve capabilities en backend',
    );

    const auditActions = Number(await value(
      admin,
      `select count(*) from public.tournament_audit_log
       where resource_type in ('announcement','tournament_document')
         and action like 'communications.%'`,
    ));
    ok(auditActions >= 8, 'acciones sensibles quedan auditadas');
  } catch (error) {
    failures += 1;
    console.error(error);
  } finally {
    await cleanupMatchOperationsHarness();
  }
  console.log(`\n${checks - failures}/${checks} verificaciones aprobadas`);
  if (failures) process.exitCode = 1;
}

await run();
