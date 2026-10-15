# Torneos: reportar contenido, moderación y bloqueo (0022) — diseño

Fecha: 2026-10-15. Base: `origin/main` = `b4fb150a`. Migración Torneos `00000000000022_content_moderation.sql`.
Motivo: Apple App Review 1.2 (UGC: filtro, reporte con respuesta a tiempo, bloqueo, contacto) y la política de
Google Play sobre UGC (términos que definan lo objetable, reporte y bloqueo dentro de la app, moderación continua),
para el build nativo de fase 1 (gestión + CONNECTED + BRANDING; sin MEDIA / SOCIAL / PLAN_READ) y la web.
Hallazgos de partida: `arma2-torneos-rediseno/movil/REVISION-CUENTA-MODERACION-TIENDAS.md` §2 y `evidencia/09c`, `09d`.

**Nada de esto se aplicó ni se desplegó.** La migración se ensayó sólo en un PostgreSQL local descartable con datos
ficticios.

---

## 0. Resumen de decisiones

| # | Tema | Decisión | Por qué |
|---|---|---|---|
| 1 | Quién puede reportar | **Sólo con sesión** (cuenta Arma2). Un visitante anónimo de la web ve «Reportar» y el diálogo le ofrece iniciar sesión o escribir a `arma2app@gmail.com` (link `mailto:` con una referencia sin datos personales). | La app nativa exige sesión: todo usuario de la app puede reportar. Una ruta pública de escritura abriría spam anónimo y obligaría a guardar o hashear IPs (dato personal) con un secreto nuevo en el gateway. No hace falta para Apple/Google: el requisito es «in-app», y en la app siempre hay sesión. |
| 2 | Qué se reporta | Organización, torneo (nombre, descripción, logo, página pública), convocatoria del catálogo, comunicado recibido, equipo (nombre / escudo) y jugador (nombre) de la página pública, y la solicitud de inscripción que ve el organizador. | Son todas las superficies de fase 1 con contenido de un usuario visible para otros (§2.1 del informe). La galería conserva su «Reportar foto» (MEDIA, fuera de fase 1). |
| 3 | Motivos | `offensive` «Contenido ofensivo», `impersonation` «Suplantación de identidad», `personal_data` «Datos personales expuestos», `spam` «Spam o engaño», `other` «Otro». Detalle libre opcional de 3 a 500 caracteres; el formulario pide no incluir datos personales. | Cubre los ejemplos de Apple 1.2 y Google; el texto libre es corto y opcional. |
| 4 | Dónde se guarda | Tabla nueva `tournament_content_reports` + `tournament_content_report_events` (auditoría). RLS activado, **ningún grant** a roles de API: sólo RPC `SECURITY DEFINER`. | Igual que el resto del dominio (patrón 0020). |
| 5 | Qué se copia del contenido | El servidor guarda una **foto del contenido reportado** (`content_snapshot`, ≤ 4 KB): el nombre, el título y el resumen del comunicado, el mensaje de la solicitud… nunca lo que manda el cliente. | El revisor ve lo que se reportó aunque después cambie, y el cliente no puede inyectar texto arbitrario como «contenido». |
| 6 | Duplicados | Un mismo usuario no puede tener dos reportes abiertos sobre el mismo objetivo: el segundo devuelve el existente (`alreadyReported: true`). Reintentos con la misma clave de idempotencia devuelven el mismo reporte. | Evita inflar la cola. |
| 7 | Límite | 10 reportes por hora y 30 por día por usuario → `PT429 TORNEOS_REPORT_RATE_LIMITED` (HTTP 429). Sin IPs. | Abuso acotado sin datos de red. |
| 8 | Quién revisa | **(a) La organización** (dueños y administradores) revisa los nombres de equipos y jugadores de sus torneos. **(b) La plataforma** (operadores de Arma2) revisa organización, torneo, logos, página pública, catálogo, comunicados y solicitudes, y todo lo que la organización escale. | La organización ya controla planteles y equipos y puede actuar en minutos. Lo que escribe la propia organización (nombres, logos, comunicados) no lo puede moderar ella misma. |
| 9 | Privacidad del reporte | La organización **nunca** ve quién reportó. Quien reporta no ve reportes ajenos. Organización A nunca ve reportes de B. | Evita represalias. |
| 10 | Herramientas de la organización | Al resolver: «Ocultar nombre del equipo» (nombre neutro `Equipo XXXX` en la inscripción y en el fixture congelado), «Quitar escudo», «Ocultar nombre del jugador» (`Jugador XXXX` en todos los planteles del torneo con ese nombre). También «Escalar a Arma2». | Son exactamente los textos que muestra la página pública (fixture congelado + planteles). Reusan los datos existentes; no tocan ninguna función existente. |
| 11 | Herramientas de la plataforma | Funciones `platform_*` **sin grant a ningún rol de API** (ni siquiera `service_role`), ejecutadas por el operador como instalador con el driver `db-0022.mjs`: bandeja (`inbox`, sólo lectura) y `act` (con frase exacta). Acciones: dar de baja la página pública **con retención** (el organizador no puede volver a publicarla hasta que Arma2 la libere) + quitar del catálogo (palanca existente), dar de baja toda la organización, quitar logo de organización o torneo, revocar un comunicado, las tres de la organización, y liberar la retención. | No hay panel de administración. Un panel nuevo es superficie de ataque; una RPC operada por instalador con frase y sha es lo más seguro y ya es el método certificado del equipo. El gateway rechaza por construcción todo nombre `platform_*`. |
| 12 | Aviso a la plataforma | **No hay envío de email** en Torneos (las entregas de comunicados son sólo internas) y no se agrega un servicio pago. El aviso es la bandeja del driver (`inbox`) más una rutina diaria documentada. | Requisito del pedido. |
| 13 | Plazos | Objetivo: primera revisión ≤ 24 h y acción ≤ 48 h (organización y plataforma). Se dice en los Términos como objetivo, no como garantía. | Apple pide «timely». |
| 14 | Bloqueo | **(a) Jugador → organización:** «Silenciar comunicados de esta organización». Los comunicados nuevos llegan archivados (no aparecen en la bandeja ni suman no leídos) y los actuales se archivan; los de tipo `emergency` siguen llegando. Se puede deshacer. **(b) Organización → solicitante:** «Bloquear solicitante» desde la bandeja de solicitudes: esa persona no puede volver a pedir lugar en ningún torneo de la organización. Se puede deshacer. **(c) Plataforma → usuario:** el baneo existente de Core Auth corta Torneos (el gateway exige sesión Core activa); queda documentado en el runbook. | Son las únicas interacciones usuario→usuario de Torneos: comunicados (incluido el destinatario `specific_user`) y solicitudes con mensaje. No hay chat ni comentarios. |
| 15 | Filtro automático | **No** en esta PR. Queda la aprobación previa del organizador (inscripciones y planteles) y la moderación posterior. | Una lista de palabras en castellano rioplatense con falsos positivos merece su propio diseño; se informa como gap. |
| 16 | Gateway | Las RPC nuevas se suman al contrato **CONNECTED-V1** (`TORNEOS_CONNECTED_MODE=on`), grupos `content_reports`, `content_moderation` y `user_blocks`. Ninguna ruta pública nueva. | La fase 1 nativa ya exige CONNECTED; no hace falta otra variable de entorno ni otra palanca de despliegue. |
| 17 | Orden respecto de 0020 / 0021 | 0022 **no reemplaza ninguna función existente**: sólo crea tablas, funciones y tres triggers nuevos sobre tablas existentes. Pinnea por md5 las funciones de las que depende. Aplica sobre `main` (0000→0019) y sobre `main + 0020 + 0021` en cualquier orden. | 0020 pinnea cuerpos y cuenta funciones dentro de su propia transacción; 0021 (borrado de cuenta) no está publicado. |

---

## 1. Entradas «Reportar»

| Superficie | Componente | Objetivo | Cómo se identifica |
|---|---|---|---|
| Página pública del torneo | `PublicTournamentPage.jsx` (pie del encabezado, lista de equipos, tabla de goleadores) | `tournament`, `organization`, `team`, `player` | `p_public_slug` + para equipo/jugador el **texto visible** (`p_target_label`), que el servidor busca en ese torneo (inscripción o participante por nombre exacto; jugador activo por nombre exacto). Si no existe → `TORNEOS_REPORT_TARGET_INVALID`. La página pública no expone IDs y no se cambia. |
| Convocatoria del catálogo | bloque de la convocatoria en la misma página | `catalog_listing` | `p_public_slug` |
| Comunicado recibido | `MyCommunicationsPage.jsx` (detalle) | `announcement` | `p_target_id` = id del comunicado; quien reporta debe tener una entrega. |
| Solicitud de inscripción | `ApplicationInboxPage.jsx` | `application` | `p_target_id` = id de la inscripción; quien reporta debe ser dueño/admin de la organización. |

Sin sesión (sólo web): el diálogo dice «Para reportar necesitás iniciar sesión» con «Iniciar sesión» (vuelve a la
misma página) y «o escribinos a arma2app@gmail.com». El `mailto:` lleva sólo el tipo y la dirección pública de la página.

Copia honesta tras enviar: «Recibimos tu reporte. Lo revisa la organización del torneo» (equipo/jugador) o «Lo revisa
el equipo de Arma2» (resto), «en general dentro de las 24 a 48 horas. No le mostramos a nadie quién lo envió.» Si ya
había uno abierto: «Ya habías reportado esto; sigue en revisión.»

## 2. Datos

`public.tournament_content_reports` — `organization_id` (FK, cascade), `tournament_id` (null para organización),
`target_kind`, `target_id`, `target_label` (≤ 200), `content_snapshot` (jsonb ≤ 4 KB), `review_scope`
(`organization` | `platform`), `reporter_user_id` (FK identidad, **ON DELETE SET NULL**: compatible con el borrado de
cuenta), `reason`, `detail`, `status` (`open` → `under_review` → `resolved` | `dismissed`), `action_taken`,
`resolution_note`, `handled_by` / `handled_by_platform` / `handled_at`, `escalated_at`, `idempotency_key`, fechas.
Índice único parcial (reporter, kind, target) mientras está abierto o en revisión.

`public.tournament_content_report_events` — auditoría por reporte (creado, cambio de estado, escalado, acción), con
actor (`user` | `platform`). Además cada acción sobre contenido se registra en `tournament_audit_log`.

`public.tournament_communication_mutes` (identidad, organización) y `public.tournament_applicant_blocks`
(organización, identidad bloqueada, motivo, quién, cuándo, liberado). `private.tournament_moderation_holds`
(retención de página pública por la plataforma).

Todas con RLS activado y sin grants de API.

Triggers nuevos (funciones nuevas, tablas existentes):
- `tournament_public_pages` BEFORE INSERT/UPDATE: publicar con una retención activa → `TORNEOS_PUBLIC_PAGE_MODERATION_HOLD`.
- `tournament_team_applications` BEFORE INSERT: solicitante bloqueado por esa organización → `TORNEOS_APPLICATION_BLOCKED`.
- `tournament_announcement_deliveries` BEFORE INSERT: destinatario que silenció la organización y comunicado que no es
  `emergency` → la entrega nace `archived`.

## 3. RPC (authenticated, por el gateway CONNECTED-V1)

| RPC | Quién | Resultado |
|---|---|---|
| `report_tournament_content(kind, public_slug, target_id, target_label, reason, detail, idempotency_key)` | cualquier identidad | `{ reportId, status, alreadyReported, reviewScope }` |
| `get_tournament_content_reports(organization_id, status)` | dueño/admin | reportes `organization` de esa organización (sin quién reportó) + bloqueos de solicitantes |
| `handle_tournament_content_report(report_id, status, action, note)` | dueño/admin, sólo reportes `organization` | aplica la acción y el estado en una transacción; `escalate` lo pasa a la plataforma |
| `block_tournament_applicant(organization_id, team_entry_id, reason)` / `unblock_tournament_applicant(organization_id, block_id)` | dueño/admin | bloqueo de solicitante |
| `set_tournament_communications_muted(organization_id, announcement_id, muted)` / `get_my_tournament_communication_mutes()` | destinatario de comunicados | silenciar / ver silenciadas |

Plataforma (sin grant de API): `platform_list_tournament_content_reports(status, limit)` y
`platform_handle_tournament_content_report(report_id, status, action, note)`.

Errores: `42501 TORNEOS_AUTH_REQUIRED`, `22023 TORNEOS_REPORT_INVALID`
(detalle: campo), `22023 TORNEOS_REPORT_TARGET_INVALID`, `PT429 TORNEOS_REPORT_RATE_LIMITED`,
`PT409 TORNEOS_REPORT_NOT_FOUND`, `PT409 TORNEOS_REPORT_ALREADY_CLOSED`, `22023 TORNEOS_REPORT_ACTION_INVALID`,
`42501 TORNEOS_MODERATION_FORBIDDEN`, `42501 TORNEOS_APPLICATION_BLOCKED`,
`42501 TORNEOS_PUBLIC_PAGE_MODERATION_HOLD`, `42501 TORNEOS_COMMUNICATIONS_MUTE_FORBIDDEN`.
Un objetivo de otra organización es indistinguible de uno inexistente.

## 4. Cliente

- Híbrido: alias nuevos en `stagingV1WorkspaceService` (`CONNECTED_METHODS`) y un servicio liviano de reporte para la
  página pública (`stagingV1/contentReportService.js`) que usa la misma sesión Core + exchange sólo si hay sesión.
- LOCAL: los mismos alias en `tournamentWorkspaceService.js` (`supabase.rpc`). El stack LOCAL de un solo proyecto
  **no** recibe una migración Core en esta PR: allí la base contesta «función inexistente», el diálogo muestra
  «No pudimos enviar el reporte» y ofrece el email.
- UI: `ContentReportDialog` (motivos, detalle, copia honesta), «Moderación» en la configuración de la organización
  (`OrganizationModerationPage`), «Silenciar comunicados» en el detalle del comunicado y «Bloquear solicitante» /
  «Reportar a Arma2» en la bandeja de solicitudes.
- Nativo (fase 1: CONNECTED + BRANDING): todo vive bajo CONNECTED; no depende de MEDIA, SOCIAL ni PLAN_READ.

## 5. Términos

`TermsPage.js` suma «Contenido prohibido y moderación»: qué está prohibido, cómo reportar (botón «Reportar» y
`arma2app@gmail.com`), quién revisa, plazo objetivo, qué puede pasar (ocultar nombres o escudos, dar de baja la página
pública y el catálogo, revocar comunicados, bloquear solicitantes, suspender la cuenta) y que no hay filtro automático:
se revisa después de publicado y con la aprobación previa del organizador en inscripciones.

## 6. Operación de la plataforma (runbook)

`backend/torneos/moderation-v1/README.md`: rutina diaria `node …/db-0022.mjs inbox` (sólo lectura), acción con
`act <reportId> <status> <action> <nota>` y frase `ACT TORNEOS 0022 <ref> <reportId-8>`; baneo de cuenta en Core Auth
(corta Torneos); baja de catálogo existente. Objetivo 24/48 h.

## 7. Despliegue y recuperación (cada paso con su GO)

1. Migración 0022 (driver `apply-0022`, frase + sha). Rollback `rollback-0022`: se niega si hay reportes, bloqueos,
   silencios o retenciones, salvo frase de fuerza `DISCARD MODERATION ROWS`.
2. Gateway con el allowlist CONNECTED-V1 ampliado (antes de 0022 las RPC nuevas darían 404 de PostgREST).
3. Web y build nativo.
Recuperación: web → deploy anterior; gateway → revisión anterior; base → rollback (sólo sin filas o con fuerza).

## 8. Gaps que quedan

- Sin filtro automático de palabras (Apple 1.2 «a method for filtering»): se cubre con aprobación previa del
  organizador + reporte + moderación; riesgo de que el revisor lo pida.
- El aviso a la plataforma no es push/email: depende de la rutina diaria del operador.
- El stack LOCAL no tiene las tablas.
- La página de equipo del hub del participante no tiene «Reportar» (sólo la pública).
