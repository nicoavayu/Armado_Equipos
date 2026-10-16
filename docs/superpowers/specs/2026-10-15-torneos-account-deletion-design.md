# Borrado de cuenta que llega a Torneos — diseño

Fecha: 2026-10-15. Rama `claude/torneos-account-deletion` sobre `origin/main` = `b4fb150a`.
Estado: **borrador para revisión**. Nada aplicado ni desplegado. Ensayado sólo en laboratorio local con datos ficticios.

Origen: `movil/REVISION-CUENTA-MODERACION-TIENDAS.md` §1 y `movil/evidencia/09a`, `09b`. En `main`, `delete-account` borra la cuenta Core
pero nada llega a Torneos (proyecto Supabase aparte): quedan la identidad, el perfil, la bandeja, las membresías, organizaciones
sin dueño que pueda entrar y los nombres de jugadores publicados. 78 de las 91 FKs hacia `torneos_identity` son `RESTRICT`.

---

## 1. Decisiones (resumen)

| # | Decisión | Por qué |
|---|---|---|
| D1 | **No se borra la fila de identidad: se corta.** `torneos_identity.core_user_id` pasa a un UUID aleatorio. Toda la historia sigue apuntando a la misma fila, que ya no se puede vincular con nadie (Core borra el usuario; Torneos no guarda el id original, sólo su sha256 en un registro privado). | 78 FKs `RESTRICT` y la historia compartida (actas, goles, tarjetas, tablas, compras, auditoría) necesitan una referencia estable. Borrar la fila obligaría a reescribir o perder historia de otras personas. Un identificador interno aleatorio sin vínculo con la persona es un seudónimo sin clave. |
| D2 | **Se borra** lo que sólo le sirve a la persona; **se anonimiza** el contenido personal dentro de registros compartidos; **se da de baja** todo acceso; **se conserva** el resto sin tocar números ni estados. | Apple 5.1.1(v) y Google piden borrar los datos asociados; desactivar no alcanza. La historia deportiva es de las organizaciones y de los demás participantes. |
| D3 | Nombre de reemplazo: **«Jugador eliminado ABC123»** / **«Responsable eliminado ABC123»**, estable dentro de una organización y distinto entre organizaciones (`md5(identidad:organización)`, 6 hex). | Las tablas y planillas siguen siendo legibles y coherentes (el mismo jugador sigue siendo «el mismo» en esa liga), sin permitir cruzar a la persona entre ligas en las páginas públicas. |
| D4 | **Organizaciones del titular:** se transfieren al **admin activo más antiguo** (`joined_at`, `created_at`, `id`). Si no hay admin activo (sólo colaboradores, o nadie), la organización se **archiva**: sus páginas públicas se despublican y sus publicaciones en «Explorar torneos» se retiran, con el WhatsApp de contacto borrado. **Un colaborador no se asciende.** | Un admin ya tenía casi todos los poderes; un colaborador no: ascenderlo le daría control de compras, miembros y publicación que el titular nunca le dio. Una página pública o una convocatoria abierta sin nadie que responda puede inducir a error a terceros (inscripciones, pagos, contacto) y es contenido del titular. Los datos no se destruyen: quedan internos y un traspaso manual por soporte puede reactivarla. |
| D5 | **Compras: intactas.** Ni montos, ni estados, ni eventos, ni planes, ni temporadas. Sólo cambia, indirectamente, que el comprador es la identidad cortada. | Contabilidad, Ley 24.240 (arrepentimiento, contracargos) y la Privacidad ya lo dicen. La lógica de pagos no se toca. |
| D6 | **Fotos (MEDIA, apagado en fase 1):** los retratos de la persona entran al borrado en dos fases ya existente (`delete_pending` + consentimiento revocado); los objetos quedan listados en el registro para el operador. **No se borra ningún objeto de Storage ni se habilita ningún cron.** Las fotos de galería que subió como staff son de la organización y se conservan (sin vínculo con ella). | El borrado real de objetos lo hace el store con sus guardas, y el cron de purga está prohibido en este trabajo. `delete_pending` ya oculta el retrato en todas las lecturas. |
| D7 | **Integración:** Core `delete-account` llama al gateway de Torneos **antes** de borrar nada en Core (`POST /core/v1/account-erasure`) y, **después** de borrar su cuenta, le confirma que terminó (`POST /core/v1/account-erasure/confirm`). Las dos rutas van firmadas con una clave **derivada** del secreto que ambos ya tienen (`TORNEOS_CONTRACT_SERVICE_SECRET`): autentica a Core, no es una credencial de base. El gateway ejecuta las funciones con un **login dedicado y de mínimo privilegio** (`torneos_edge_erasure_writer`, miembro NOINHERIT de `torneos_erasure_writer`), con su propia contraseña en Secret Manager; **nunca** con `torneos_core_adapter`. | Core no suma secretos. Un compromiso de la credencial del adaptador (o del canal del contrato) ya no alcanza para anonimizar cuentas: hace falta además la credencial de borrado, que sólo puede ejecutar estas dos funciones. El `core_user_id` sale de la sesión que Core verificó, nunca del cliente. |
| D8 | **Fail-closed antes de Torneos, reintento después.** Si Torneos no confirma el borrado, Core no borra nada y responde `503 torneos_erasure_failed` («tu cuenta sigue activa, probá de nuevo»). **Torneos y Core son dos bases: no hay atomicidad entre ellas.** Lo que Torneos anonimiza es irreversible. Si Core falla después, el registro de Torneos queda en `torneos_erased`; la persona reintenta con el mismo botón (Torneos responde `already_erased`, sin cambios) y Core termina. Si nadie reintenta, la consulta de reconciliación (sólo lectura) lo muestra al operador. Clave de idempotencia por cuenta (derivada del id de Core). **Sin cron nuevo.** | Si Core borrara primero y Torneos fallara, nadie podría reintentar (no hay sesión ni usuario). En este orden siempre queda un camino: reintentar o reconciliar. Ninguno «deshace» lo de Torneos. |
| D9 | **Una sola transacción dentro de Torneos.** Si algo falla en Torneos, no queda nada a medias ahí; el reintento empieza de cero. Las erasures toman, con `lock_timeout` de 5 s fijado antes, el lock de la persona y después el global: no esperan sin límite y se serializan. La atomicidad termina en el borde de Torneos (D8). | Ensayado con un fallo inyectado a mitad (E14, E21) y con un lock tomado por otro (E25). |
| D12 | **Tumba.** El registro es autoritativo: nunca se vuelve a crear una identidad para un Core user borrado (`TORNEOS_ACCOUNT_ERASED`), aunque su JWT siga valiendo o aunque una sesión compita con la erasure. | Supabase Auth no revoca los JWT emitidos. Sin tumba, el barrido post-borrado no alcanzaba (E24). |
| D10 | Los guardas que hacen inmutable la historia oficial se **desactivan y reactivan dentro de la misma transacción**, sólo alrededor de los `UPDATE` de nombres. La función se niega a empezar si alguno no está activo y verifica al final que todos lo estén. Ningún cuerpo de función existente cambia. | Cambiar los cuerpos de los guardas movería pines de otros drivers (OEC, 0020). `ALTER TABLE … DISABLE TRIGGER` es transaccional: si algo falla vuelve solo; nadie más ve el estado intermedio (bloqueo `SHARE ROW EXCLUSIVE`, las lecturas siguen). |
| D11 | **Web:** `/account-deletion` permite **pedir** el borrado sin sesión (formulario honesto con `EmailRequestForm`, referencia `ELIM-…`) y, con sesión iniciada en ese navegador, **eliminar la cuenta ahí mismo** con el mismo flujo Core. «Eliminar cuenta» de Torneos lleva ahí. | Google exige un recurso web para pedir el borrado; en la web `/profile` redirige a `/torneos`. Una sola cuenta, un solo flujo. |

---

## 2. Matriz por tabla

Leyenda: **BORRA** (filas eliminadas) · **ANONIMIZA** (campos personales reemplazados) · **BAJA** (cambio de estado que corta acceso o publicación) · **CONSERVA** (sin cambios; la referencia apunta a la identidad cortada).

### 2.1 Identidad y lo que sólo sirve a la persona

| Tabla | Qué pasa | Por qué |
|---|---|---|
| `torneos_identity` | ANONIMIZA: `core_user_id` → UUID aleatorio. La fila queda. | D1. |
| `tournament_user_profiles` | BORRA | Perfil propio (nombre visible, preferencias). |
| `tournament_user_notifications` | BORRA las que recibió | Bandeja personal. |
| `tournament_notification_preferences` | BORRA | Preferencias propias. |
| `tournament_participant_hub_preferences` | BORRA | Preferencias propias. |
| `user_tournament_context_preferences` | BORRA | Preferencias propias. |
| `user_workspace_preferences` | BORRA | Preferencias propias. |
| `private.core_contract_attestations` | BORRA las suyas y las que lo mencionan | Copias efímeras de respuestas de Core (pueden contener su nombre). |
| `private.tournament_team_entry_core_snapshots` | ANONIMIZA: se quita su elemento de `players` | Copia congelada de su nombre y avatar de Core. Nadie lee esa lista después de crear el plantel. El equipo queda. |
| `private.tournament_account_erasures` | Nuevo registro (0021): sha256 del id Core, identidad cortada, clave del pedido (`request_id`), estado `torneos_erased` → `core_confirmed`, resumen, objetos pendientes | Idempotencia («ya borrado»), reconciliación con Core y trazabilidad para el operador. Ningún rol cliente (ni el de borrado) lo lee. |

### 2.2 Organizaciones y accesos

| Tabla | Qué pasa | Por qué |
|---|---|---|
| `tournament_organization_members` | BAJA: todas sus membresías → `removed`. Si era titular: el admin activo más antiguo pasa a `owner`; si no hay, la organización se archiva | D4. Sin huérfanas (postcondición). |
| `tournament_organizations` | BAJA (`archived`) sólo si era titular sin admin activo. `created_by` CONSERVA | D4. Una organización archivada no la sirve ninguna lectura pública ni de miembros. |
| `tournament_public_pages` | BAJA (`unpublished`) en las organizaciones archivadas. `published_by` CONSERVA | D4. |
| `tournament_catalog_listings` | BAJA (`withdrawn`, inscripciones `closed`) y ANONIMIZA `contact_whatsapp` en las organizaciones archivadas | El WhatsApp puede ser personal; nadie atiende una convocatoria cerrada. En una organización transferida el contacto es de la organización y lo administra el nuevo titular. |
| `tournament_season_member_assignments` | BORRA las de sus membresías | Puestos de temporada (acceso). |
| `tournament_organization_invitations` | ANONIMIZA el email de las que aceptó (`eliminado-…@cuenta-eliminada.invalid`) | Era su email. Las pendientes dirigidas a su email no se pueden identificar (Torneos no conoce el email de la cuenta) y vencen solas. |
| `tournament_organization_sponsors` (0020, si existe) | ANONIMIZA `created_by` → `null` | El auspiciante es contenido de la organización. |
| `tournament_media_assignments` | BAJA (`revoked`) | Acceso de fotógrafo. |
| `tournament_media_upload_sessions` | BAJA (`revoked`) las abiertas | Acceso de subida. |

### 2.3 Equipos, planteles y partidos

| Tabla | Qué pasa | Por qué |
|---|---|---|
| `tournament_roster_players` | ANONIMIZA `display_name` (seudónimo) y `avatar_url` (null) en sus filas (cuenta Arma2 o jugador provisional reclamado). Dorsal, posición y estado CONSERVA. `arma2_user_id` sigue apuntando a la identidad cortada | Su nombre se publica en las estadísticas. Se decidió **no** pasar a `provisional` (sugerido en el pedido): un provisional sin reclamar puede ser reclamado por otra cuenta, que heredaría la historia de la persona borrada. |
| `tournament_match_squad_players` | ANONIMIZA `display_name_snapshot`, `avatar_url_snapshot` (con los guardas apagados sólo en esa sentencia) | Planilla de convocados. |
| `tournament_match_operation_players` | ANONIMIZA `display_name_snapshot`, `avatar_url_snapshot` (ídem, aunque el acta sea oficial y el torneo esté finalizado) | Acta del partido. |
| `tournament_provisional_players` | ANONIMIZA los que reclamó: nombre, nombre normalizado, email y teléfono | Datos que el organizador cargó de esa persona. Los que creó como organizador son de otros: CONSERVA. |
| `tournament_team_managers` | ANONIMIZA nombre (seudónimo) y email (null); BAJA (`revoked`) | Capitán / delegado / asistente. El equipo queda sin ese responsable; el organizador puede invitar otro. |
| `tournament_team_invitations` | ANONIMIZA el email de las de sus roles; las pendientes → `revoked` | Era su email. |
| `tournament_team_applications` | ANONIMIZA `message` (null). La solicitud CONSERVA | Texto libre suyo (puede tener teléfono). La inscripción es historia del torneo; si estaba pendiente, la resuelve el organizador. |
| `tournament_match_availability_responses` | ANONIMIZA `comment` (null) y, si la cargó el staff, `manual_reason` («Dato eliminado con la cuenta») | Texto libre sobre la persona (puede ser de salud). La respuesta (disponible / no) CONSERVA. |
| `tournament_team_entries` | CONSERVA | Inscripción del equipo. |
| `tournament_rosters` | CONSERVA | Versión del plantel. |
| `tournament_team_reviews` | CONSERVA | Revisión del organizador. |
| `tournament_team_photos` | CONSERVA | Foto del equipo (no de la persona). |
| `tournament_match_squads` | CONSERVA | Estado de la convocatoria. |
| `tournament_matches` | CONSERVA | Fixture. |
| `tournament_match_operations` | CONSERVA | Acta: equipos y horario (sin nombres de personas). |
| `tournament_match_events` | CONSERVA | Goles, tarjetas, incidencias: la historia. `metadata` no lleva nombres (la app no los escribe). |
| `tournament_match_outcomes` | CONSERVA | Resultado. |
| `tournament_match_reschedules` | CONSERVA | Reprogramaciones. |
| `tournament_match_resumptions` | CONSERVA | Reanudaciones. |
| `tournament_match_reviews` | CONSERVA | Revisiones del acta. |
| `tournament_competition_participants` | CONSERVA | Participantes (equipos). |
| `tournament_participant_sets` | CONSERVA | Congelamiento de participantes. |
| `tournament_fixture_versions` | CONSERVA | Versiones del fixture. |
| `tournament_standings_revisions` | CONSERVA | Tablas. |
| `tournament_points_adjustments` | CONSERVA | Ajustes de puntos. |
| `tournament_disciplinary_overrides` | CONSERVA | Decisiones disciplinarias. |
| `tournament_suspension_served_matches` | CONSERVA | Cumplimiento de sanciones. |
| `tournament_qualification_resolutions` | CONSERVA | Clasificaciones. |
| `tournament_category_capacities` | CONSERVA | Cupos. |
| `tournaments` | CONSERVA | — |
| `tournament_seasons` | CONSERVA | — |
| (sin FK) `tournament_player_statistics`, `tournament_team_standings`, `tournament_discipline_ledgers` | CONSERVA, idénticas byte a byte | Proyecciones numéricas; el nombre visible sale de `tournament_roster_players`. |

### 2.4 Comunicaciones, documentos, auditoría, compras, fotos

| Tabla | Qué pasa | Por qué |
|---|---|---|
| `tournament_announcements` | CONSERVA (texto y autor) | Comunicación de la organización; el autor queda como identidad cortada. |
| `tournament_announcement_audiences` | CONSERVA | Destinatarios (referencia cortada). |
| `tournament_announcement_deliveries` | CONSERVA | Constancia de entrega y lectura de la organización (referencia cortada). |
| `tournament_documents`, `tournament_document_versions` | CONSERVA | Reglamentos. |
| `tournament_document_acknowledgements` | CONSERVA | Constancia de aceptación del reglamento (referencia cortada). |
| `tournament_audit_log` | CONSERVA (append-only) + nuevas filas `organization.owner_transferred` / `organization.archived` con actor `system` | Auditoría. Su `metadata` no lleva nombres ni emails (revisado en todas las escrituras). |
| `tournament_purchases` | CONSERVA byte a byte | D5. |
| `tournament_purchase_events` | CONSERVA | D5. |
| `tournament_plan_grant_events`, `tournament_season_plan_grant_events` | CONSERVA | D5. |
| `tournament_player_portraits` | BAJA: `delete_pending` + consentimiento `revoked`; objeto listado para el operador | D6. |
| `tournament_media_consents` | BAJA: `revoked` (base legal borrada) | La persona ya no puede administrar su consentimiento; lo protector es retirarlo. |
| `tournament_media_consent_events` | CONSERVA | Historia de consentimientos. |
| `tournament_media_relations` | BORRA las etiquetas `player` de sus filas de plantel | Desvincula a la persona de las fotos. |
| `tournament_media_assets`, `tournament_media_galleries`, `tournament_media_gallery_items` | CONSERVA | Galería de la organización (D6). |
| `tournament_media_moderation_actions`, `tournament_media_reports` | CONSERVA | Moderación (referencia cortada). |

### 2.5 Moderación (0022, si existe; SQL dinámico como 0020, cualquier orden de aplicación)

0021 no borra la fila de identidad (D1): los `ON DELETE SET NULL / CASCADE` de 0022 nunca se disparan. Por eso 0021 lo hace explícito.

| Tabla | Qué pasa | Por qué |
|---|---|---|
| `tournament_content_reports`: los que **hizo** la persona | CONSERVA el reporte y su estado. ANONIMIZA `reporter_user_id` → `null` y `detail` → `null`. | El reporte es historia de moderación de la organización y de la plataforma. Quién reportó y su texto libre (puede tener un teléfono) son de la persona. |
| `tournament_content_reports`: los que son **sobre** su contenido | ANONIMIZA. Reporte de `player` sobre sus filas de plantel: `target_label` y `content_snapshot.playerName` pasan al seudónimo. Reporte de `application` sobre su solicitud: `content_snapshot.message` pasa a `null`. | La copia del reporte sigue al contenido: el plantel ya muestra el seudónimo y la solicitud ya perdió el mensaje (§2.3). |
| `tournament_content_reports`: `handled_by`, `resolution_note`, acción tomada | CONSERVA (referencia cortada) | Es un acto de la organización. |
| `tournament_content_report_events` | ANONIMIZA `actor_user_id` → `null` en los eventos `created` de sus propios reportes. El resto CONSERVA (referencia cortada). | Sin esto, el evento de creación volvería a vincular el reporte con la identidad. Los actos del staff quedan, como en `tournament_audit_log`. |
| `tournament_communication_mutes` | BORRA las suyas | Preferencia propia (como las de §2.1). |
| `tournament_applicant_blocks`: donde la persona es la **bloqueada** | BORRA | La identidad cortada nunca vuelve a solicitar (una cuenta nueva es otra identidad), así que el bloqueo queda inerte. Su `reason` es texto sobre la persona. La constancia queda en `tournament_audit_log`. |
| `tournament_applicant_blocks`: `created_by` / `released_by` de la persona (staff) | CONSERVA (referencia cortada) | Es un acto de la organización. |
| `private.tournament_moderation_holds` | No aplica (no tiene columna de identidad) | Retención de la plataforma sobre una página. |

Una prueba (`db-0021.test.mjs`) recorre todas las migraciones y falla si aparece una tabla con FK a `torneos_identity` que no esté en esta matriz.
Con `ACCOUNT_DELETION_WITH_0020` / `ACCOUNT_DELETION_WITH_0022` suma los archivos de esas ramas. Pasa en main, main+0020, main+0022 y main+0020+0022.

---

## 3. Organizaciones, temporadas e inscripciones en curso

- **Titular con admins:** traspaso automático al admin activo más antiguo. Auditoría `organization.owner_transferred`. Todo lo demás sigue igual (temporadas, compras, páginas).
- **Titular sin admins (sólo colaboradores o nadie):** archivo. Las temporadas y torneos en curso quedan como estaban, pero ya nadie los ve (una organización archivada no se sirve a nadie). Los colaboradores conservan su membresía en una organización archivada. Los equipos y jugadores de otros pierden el acceso a esa historia: es la consecuencia de que el organizador se fue. **Soporte** puede reactivarla con un titular nuevo (traspaso manual, runbook) si alguien lo pide.
- **Premium activo:** nunca se reembolsa ni se altera. Si la organización se archiva, el plan sigue registrado tal cual.
- **Inscripciones pendientes de la persona:** quedan para que el organizador las resuelva, sin el mensaje.
- **Invitaciones pendientes:** las vinculadas a sus roles se revocan. Las dirigidas a su email que nunca aceptó no se pueden identificar (Torneos no conoce el email de la cuenta; mandarlo cruzaría el límite del contrato) y vencen solas.
- **Equipos de los que era capitán:** quedan sin ese responsable. El organizador puede invitar a otro.

Para no perder una organización, el texto del modal y de `/account-deletion` le dice a la persona que antes de borrar la cuenta sume un admin (o pida el traspaso por email).

---

## 4. Integración Core → Torneos

```
App / web ──(sesión del usuario)──▶ Core delete-account
   1. verifica la sesión (getUser) y la confirmación; request_id = clave de idempotencia derivada del id de Core
   2. POST {TORNEOS_GATEWAY_URL}/core/v1/account-erasure            firmado (HMAC derivado, ±30 s)
        └─▶ gateway: verifica firma, cuerpo cerrado, sin Origin
              └─▶ login torneos_edge_erasure_writer; SET LOCAL ROLE torneos_erasure_writer;
                  private.erase_tournament_account(core_user_id, request_id)        → registro: torneos_erased
   3. si Torneos NO confirmó → 503 torneos_erasure_failed (nada borrado en ningún lado; reintento seguro)
   ── Storage (PR apilado claude/core-deletion-storage-apple): fotos de la persona en jugadores-fotos y subidas sin
      uso en team-crests, fail-closed → 503 storage_erasure_failed antes de tocar filas de Core
   4. limpieza Core (la de siempre) → usuarios → [Apple: revocación best-effort, mismo PR apilado] → auth.admin.deleteUser
        └─ si falla: 500 profile_delete_failed / auth_delete_failed, retryable. Torneos ya quedó anonimizado
           (irreversible) y SIN confirmar; el reintento de la persona recibe already_erased y Core termina.
   5. POST …/core/v1/account-erasure/confirm (mismo request_id)       → registro: core_confirmed
        └─▶ private.confirm_tournament_account_erasure: barre una identidad re-creada en el medio y confirma.
            Mejor esfuerzo: si falla sólo se registra; la consulta de reconciliación muestra la fila.
```

### Seguridad

- **Clave de firma:** `K = HMAC-SHA256(TORNEOS_CONTRACT_SERVICE_SECRET, "torneos-core-contract:account-erasure:v1")`.
  - Es el secreto que Core ya tiene para `torneos-core-contract` y que el gateway ya tiene para firmar hacia Core.
  - La derivación separa los sentidos: una solicitud capturada en un sentido no sirve en el otro.
  - El path está firmado: una firma de `erase` no sirve como `confirm`, ni al revés.
  - Autentica a Core. No es una credencial de base de datos.
- **Credencial de base, aparte:** el login `torneos_edge_erasure_writer`.
  - Su URL completa vive sólo en Secret Manager (`torneos-gw-db-erasure-writer-url`) y Cloud Run la monta como `TORNEOS_DB_ERASURE_WRITER_URL`.
  - El gateway exige que sea su propio login y su propia contraseña: distinta de la del adaptador y de la del escritor de identidades, y que no sea ni contenga el secreto del contrato. La comparación con la clave derivada se hace al primer uso.
  - Sin ella, las dos rutas responden 503 después de autenticar la firma (falla cerrado) y el resto del gateway sigue igual.
- **Rol `torneos_erasure_writer` (0021):**
  - Es NOLOGIN, NOINHERIT y no es miembro de ningún rol.
  - Sus privilegios son exactamente `USAGE` en `private` y `EXECUTE` en las dos funciones de borrado. Nada en tablas, vistas, secuencias ni otras funciones; lo verifica la postcondición de 0021, el catálogo del operador y E1b.
  - `anon`, `authenticated`, `service_role`, `torneos_identity_writer`, `torneos_core_adapter` y el rol de pagos no pueden ejecutar ninguna de las dos funciones (E1).
- **Tumba (tombstone):** el registro es autoritativo.
  - Borrar un usuario de Supabase Auth **no revoca** los JWT que ya emitió, y una sesión puede competir con la erasure.
  - Por eso un trigger `BEFORE INSERT` sobre `torneos_identity` (`private.refuse_erased_identity`) rechaza con `TORNEOS_ACCOUNT_ERASED` (42501) toda identidad nueva para un Core user que figura en el registro. Rechaza la de `/exchange` y también cualquier otra.
  - Antes de leer el registro espera el lock de esa persona (compartido). Así, un exchange que corre durante la erasure ve la tumba cuando la erasure confirma, y no queda ninguna identidad.
  - El gateway lo responde como `403 TORNEOS_ACCOUNT_ERASED`.
  - Un token puente emitido antes no resuelve a nadie: `current_identity_id` exige que coincida `(id, core_user_id)`, y la erasure lo cortó.
  - Una cuenta Core **nueva** (otro `core_user_id`) es otra persona y obtiene su identidad como siempre (E24).
- **Locks acotados:** la erasure fija `lock_timeout = 5 s` **antes** de tomar los locks, en este orden: el de la persona (exclusivo) y después el global (las erasures siguen en serie por el traspaso de organizaciones).
  - En el laboratorio se midió que `lock_timeout` acota también los locks advisory (E25): con el lock tomado por otro, la erasure falla en unos 5 s con `55P03`, el gateway responde 503 y Core responde `torneos_erasure_failed` (la cuenta sigue).
  - Los límites se anidan: lock 5 s < sentencia 15 s < request de Core 20 s (A12).
  - Los exchanges de otras personas no esperan el lock global. Mientras una erasure está abierta (menos de un segundo), los INSERT de identidades esperan el `SHARE ROW EXCLUSIVE` de sus guardas (D10), con su propio límite de 2 s.
- **Nonce:** no se guarda. Un replay dentro de la ventana sólo repite la misma llamada, que es idempotente.
- **Configuración nueva en Core:** `TORNEOS_GATEWAY_URL` (la URL pública del gateway; no es secreta). Sin ella, `delete-account` **falla cerrado** (`torneos_erasure_unconfigured`).
- **Alcance de un compromiso:** emitir tokens sigue dependiendo de los logins del bridge y del adaptador. Para anonimizar cuentas hace falta además la credencial de borrado (que no sirve para otra cosa) y la clave de firma de Core.
- **Respuestas:**
  - `erase`: `200 {ok, outcome: erased | already_erased | no_identity}`.
  - `confirm`: `200 {ok, outcome: core_confirmed | no_ledger}`.
  - Errores: `400 INVALID_REQUEST`, `401 SERVICE_AUTH_REQUIRED`, `403` (Origin u host ajeno), `405`, `503 TORNEOS_UNAVAILABLE`.
  - Nunca devuelve ids ni conteos.

### Estados, idempotencia y reconciliación

- **Registro** (`private.tournament_account_erasures`): una fila por identidad cortada. La clave es `sha256(core_user_id)` + `request_id`. Los estados son:
  - `torneos_erased`: Torneos hizo su parte. Toda fila nace así, en la misma transacción que el borrado.
  - `core_confirmed`: Core avisó que borró su cuenta (`core_confirmed_by = 'core'`), o el operador lo verificó (`'operator'`).
  - No hay estado «requested»: el borrado de Torneos es una sola transacción. O no quedó nada (no hay fila), o quedó `torneos_erased`.
- **Clave de idempotencia de Core:** `request_id = UUIDv8(HMAC(K, "account-deletion-request:v1:" + core_user_id))`.
  - Es la misma en cada intento, en un pedido doble y en la confirmación.
  - Core no guarda nada y el valor no revela el id.
- **Reconciliación (sin cron):** `remote/reconcile-0021.sql` es de sólo lectura.
  - Lista las filas `torneos_erased` más viejas que N horas (por defecto 24).
  - Muestra el id de la fila, el hash, el `request_id`, la antigüedad y si la identidad fue re-creada. No muestra nombres, emails ni ids de Core.
  - El operador busca el hash en Core (`auth.users`, sólo lectura). Si el usuario ya no existe, `remote/reconcile-complete-0021.sql` (con GO) barre y confirma con `core_confirmed_by = 'operator'`.
  - Si el usuario todavía existe, la cuenta Core sigue activa y lo de Torneos ya está anonimizado. Lo seguro es que la persona reintente con el mismo botón; el operador no borra cuentas Core a mano en este PR.

### Fallas parciales y reintentos

| Situación | Qué pasa | Cómo se recupera |
|---|---|---|
| Torneos caído o la erasure falla | 503 en Core. **Nada** se borra ni en Core ni en Torneos (una transacción); no queda fila en el registro. | La persona reintenta (E21a). |
| Torneos borró y Core falla después (`profile_delete_failed`, `auth_delete_failed`) | Torneos ya está anonimizado, **irreversible**. La fila queda en `torneos_erased`. La cuenta Core sigue, quizá sin parte de sus datos (la limpieza Core corre antes de borrar `usuarios`). | La persona reintenta: Torneos responde `already_erased` (no-op), Core termina y confirma (E18, test de Core). Si nadie reintenta, la reconciliación la muestra (E19). |
| Core borró y la confirmación no llegó | La fila queda en `torneos_erased`. | La reconciliación la muestra y el operador la completa (E19, E21b). |
| La persona abre Torneos entre la erasure y el borrado Core, o después con un JWT que todavía vale | La tumba lo rechaza: `403 TORNEOS_ACCOUNT_ERASED` y no se crea ninguna identidad, ni compitiendo con la erasure (E24). | Nada que reparar. El barrido de la confirmación queda como defensa idempotente (E22). `identity_recreated` de la reconciliación sólo puede dar true después de un rollback forzado que descartó las tumbas. |
| Pedido doble | El advisory lock serializa: uno sale `erased` y el otro `already_erased`; queda una sola fila. | — (E20). |
| Usuario que nunca usó Torneos | `no_identity` / `no_ledger`. Nada cambia. | — |

**No se dice en ningún lado que «si falla, no se borra nada»** salvo para el caso en que falla Torneos, que es el único en que es cierto.

---

## 5. Pedido por web y textos

- **`/account-deletion`** (`src/pages/AccountDeletionInfoPage.js`), pública.
  - Dice qué se borra, qué se anonimiza, qué se conserva y por qué.
  - Ofrece tres caminos:
    1. En la app: Perfil → Eliminar cuenta.
    2. En la web, con la sesión iniciada en ese navegador: el botón de la misma página (mismo flujo de Core).
    3. **Pedido por email** sin sesión (`EmailRequestForm`, referencia `ELIM-AAAAMMDD-XXXXXX`). La página no lo envía.
  - Para el pedido por email, el texto público es neutro y **sin plazos fijos**: «te confirmamos por email la recepción y te informamos cuando esté hecho».
  - El objetivo legal (art. 16 Ley 25.326, 5 días hábiles) vive sólo en el runbook interno, como objetivo interno pendiente de compromiso operativo de Nico.
- **Textos fieles a la no-atomicidad:** el modal de `ProfileEditor`, `/account-deletion`, Privacidad y Términos dicen «si falla una parte, podés reintentar; lo ya anonimizado en Torneos no se puede revertir».
  - El error de Core después de Torneos lo dice así, sin prometer que «no se borró nada».
  - El error de Torneos dice que no se borró nada, que es cierto en ese caso.
- **Fotos de perfil de Core:** **sin** procedimiento por email (Apple no acepta completar el borrado por soporte).
  - El PR apilado `claude/core-deletion-storage-apple` agrega el paso de Storage en la costura de `delete-account` (después de Torneos, antes de las filas de Core) y la revocación de Sign in with Apple, y cambia el texto: la foto de perfil **se borra**; se conservan sólo los escudos y fotos de plantel que un equipo sigue usando.
- **Middleware:** `/account-deletion` ya es pública; no cambia.

---

## 6. Rollback y qué no se puede deshacer

- `rollback/00000000000021_account_erasure.rollback.sql` quita las dos funciones de borrado, el trigger de la tumba y su función, el seudónimo, el registro y el rol `torneos_erasure_writer`.
  - Con el registro se van las tumbas: después de un rollback forzado, alguien ya borrado que todavía tenga una sesión válida podría obtener una identidad nueva y vacía.
  - El `DROP ROLE` también saca al login de esa membresía.
  - El login queda: el operador decide si lo borra.
  - Si después se re-aplica 0021, hay que volver a darle la membresía (`REGRANT_SQL`, ensayado en el laboratorio).
- Se niega si el registro tiene filas, salvo con `SET torneos.account_erasure_rollback_force = 'DISCARD ERASURE LEDGER'`.
- **No restaura nada anonimizado** (irreversible por diseño: los originales no se guardan).
- Después de un rollback forzado y re-aplicado, un pedido repetido de alguien ya borrado responde `no_identity` en vez de `already_erased`: se perdió el registro, y de todas formas no hay nada que borrar.
- Ensayado, con `changedOutside: []` en cada paso:
  - apply, credencial provista y rotada;
  - re-apply rechazado;
  - rollback rechazado con filas;
  - rollback forzado;
  - re-apply, login rechazado hasta el re-grant, y después funciona.

## 7. Orden de despliegue (cada paso con su GO)

1. **Torneos 0021** (`db-0021.mjs observe` → `apply-0021`). Inerte: nadie la llama. Crea el rol sin login.
2. **Credencial de borrado (Nico / ops):** crear el login con `remote/erasure-login.mjs` (verificador SCRAM, la contraseña nunca llega al servidor). Después:
   - guardar la URL en Secret Manager `torneos-gw-db-erasure-writer-url`;
   - darle acceso de lectura sólo a la cuenta de servicio del gateway;
   - verificar con `observe` (`erasure_role_logins = ['torneos_edge_erasure_writer']`).
   Procedimiento y rotación en el README.
3. **Gateway:** nueva revisión con las dos rutas y `TORNEOS_DB_ERASURE_WRITER_URL` montada desde Secret Manager, al 0 % con tag; probar con firma inválida (401). Después 100 %. Sin la credencial, las rutas responden 503 y Core falla cerrado.
4. **Core:** secreto `TORNEOS_GATEWAY_URL` en las funciones de Core y despliegue de `delete-account`. Desde acá el borrado llega a Torneos. **Sin `TORNEOS_GATEWAY_URL` el borrado falla cerrado**: configurarlo antes de desplegar.
5. **Web** (textos y `/account-deletion`). Puede ir junto con 4; nunca antes de 4 (los textos prometen lo que hace 4).

Vuelta atrás: web → Core (función anterior) → gateway (revisión anterior) → credencial (deshabilitar el secreto; opcionalmente `DROP ROLE torneos_edge_erasure_writer`) → rollback 0021 (forzado si ya hubo erasures; no restaura datos).

## 8. Decisiones tomadas en la revisión (antes preguntas abiertas)

1. **Login dedicado:** sí. Rol y credencial propios, de mínimo privilegio (D7).
2. **Plazos públicos:** ninguno. El texto es neutro. El objetivo legal interno (5 días hábiles, art. 16 Ley 25.326) vive sólo en el runbook, «pendiente de compromiso operativo de Nico».
3. **Atomicidad:** no se promete entre bases. Hay estados, idempotencia y reconciliación sin cron (§4).
