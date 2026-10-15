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
| D7 | **Integración:** Core `delete-account` llama al gateway de Torneos **antes** de borrar nada en Core, por una ruta nueva firmada (`POST /core/v1/account-erasure`), con una clave **derivada** del secreto que ambos ya tienen (`TORNEOS_CONTRACT_SERVICE_SECRET`). El gateway ejecuta `private.erase_tournament_account` como `torneos_core_adapter`. | Reutiliza el canal servidor-a-servidor existente sin secretos nuevos ni claves de servicio en clientes. El `core_user_id` sale de la sesión que Core verificó, nunca del cliente. |
| D8 | **Fail-closed** con reintento seguro. Si Torneos no confirma, Core no borra nada y responde `503 torneos_erasure_failed` («tu cuenta sigue activa, probá de nuevo»). Todo es idempotente. Después de borrar la cuenta Core hay una segunda pasada (barrido) de mejor esfuerzo. **Sin cron nuevo.** | Si Core borrara primero y Torneos fallara, nadie podría reintentar (no hay sesión ni usuario) y haría falta reconciliar a mano. Así, la persona puede reintentar y la cuenta nunca queda borrada a medias. |
| D9 | **Una sola transacción** en Torneos. Si algo falla, no queda nada a medias; el reintento empieza de cero. Las erasures se serializan con un advisory lock. | Ensayado con un fallo inyectado a mitad (E14). |
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
| `private.tournament_account_erasures` | Nuevo registro (0021): sha256 del id Core, identidad cortada, resumen, objetos pendientes | Idempotencia («ya borrado») y trazabilidad para el operador. Ningún rol cliente lo lee. |

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

Una prueba (`db-0021.test.mjs`) recorre todas las migraciones y falla si aparece una tabla con FK a `torneos_identity` que no esté en
esta matriz. **Ojo con 0022 (moderación, otra rama):** si agrega tablas con FK a la identidad (por ejemplo, reportes), hay que sumarlas
acá y, si guardan datos personales, a la función.

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
   1. verifica la sesión (getUser) y la confirmación
   2. POST {TORNEOS_GATEWAY_URL}/core/v1/account-erasure   firmado (HMAC derivado, ±30 s)
        └─▶ gateway Torneos: verifica firma, cuerpo cerrado, sin Origin
              └─▶ SET LOCAL ROLE torneos_core_adapter; private.erase_tournament_account(core_user_id, request_id)
   3. si Torneos NO confirmó → 503 torneos_erasure_failed (nada borrado en Core; reintento seguro)
   4. limpieza Core (la de siempre) → usuarios → auth.admin.deleteUser
   5. barrido Torneos (mejor esfuerzo; si falla sólo se registra)
```

- **Clave:** `K = HMAC-SHA256(TORNEOS_CONTRACT_SERVICE_SECRET, "torneos-core-contract:account-erasure:v1")`. Es el secreto que Core ya tiene para `torneos-core-contract` y que el gateway ya tiene para firmar hacia Core. La derivación separa los sentidos: una solicitud capturada en un sentido no sirve en el otro.
- **Nonce:** no se guarda. Un replay dentro de la ventana sólo repite la misma erasure, que es idempotente.
- **Configuración nueva en Core:** `TORNEOS_GATEWAY_URL` (la URL pública del gateway; no es secreta). Sin ella, `delete-account` **falla cerrado** (`torneos_erasure_unconfigured`).
- **Rol:** `torneos_core_adapter` (el del contrato). `anon`, `authenticated`, `service_role` y `torneos_identity_writer` no pueden ejecutar la función (E1).
- **Alcance de un compromiso del gateway:** ya hoy puede emitir tokens de cualquier identidad. Ahora además puede **anonimizar** una cuenta de la que conozca el `core_user_id` (irreversible). Es un aumento real y se declara; la mitigación posible (un login dedicado sólo para esta ruta) se dejó fuera para no agregar secretos (pregunta abierta 1).
- **Respuestas:** `200 {ok, outcome: erased | already_erased | no_identity}`, `400 INVALID_REQUEST`, `401 SERVICE_AUTH_REQUIRED`, `403` (Origin u host ajeno), `405`, `503 TORNEOS_UNAVAILABLE`. El gateway no devuelve ids ni conteos; el resumen queda en el registro privado.

### Fallas parciales y reintentos

| Situación | Qué pasa | Cómo se recupera |
|---|---|---|
| Torneos caído o la erasure falla | 503 en Core; **nada** borrado ni en Core ni en Torneos (una transacción) | La persona reintenta. |
| Torneos borró, Core falla después (`profile_delete_failed`, `auth_delete_failed`) | Torneos ya está anonimizado; la cuenta Core sigue | La persona reintenta: Torneos responde `already_erased` y Core termina. |
| La persona abre Torneos entre la erasure y el borrado Core | El gateway puede crear una identidad nueva y vacía | El barrido post-borrado la borra. Si el barrido falla, queda una identidad vacía con el id del usuario borrado: runbook de reconciliación (README). |
| Usuario que nunca usó Torneos | `no_identity`, nada cambia | — |

---

## 5. Pedido por web y textos

- `/account-deletion` (`src/pages/AccountDeletionInfoPage.js`), pública: qué se borra / anonimiza / conserva y por qué, plazos, tres caminos: (1) en la app, Perfil → Eliminar cuenta; (2) en la web, con la sesión iniciada en ese navegador, el botón de la misma página (mismo flujo Core); (3) **pedido por email** sin sesión (`EmailRequestForm`, referencia `ELIM-AAAAMMDD-XXXXXX`, no se envía solo, la recepción se confirma por email; se completa dentro de los 5 días hábiles de verificar la titularidad, art. 16 Ley 25.326).
- Modal de `ProfileEditor` (`:458`), Privacidad (`PrivacyPage.js:71`), Perfil de Torneos (`TorneosProfilePage.jsx:273`), Términos y Baja del servicio: dicen exactamente lo de la matriz, con el porqué (historia deportiva, registros contables) y el plazo (inmediato en la app).
- Middleware: `/account-deletion` ya es pública; no cambia.

---

## 6. Rollback y qué no se puede deshacer

- `rollback/00000000000021_account_erasure.rollback.sql` quita la función, el seudónimo y el registro. Se niega si el registro tiene filas, salvo `SET torneos.account_erasure_rollback_force = 'DISCARD ERASURE LEDGER'`.
- **No restaura nada anonimizado** (irreversible por diseño: los originales no se guardan). Después de un rollback forzado y re-aplicado, un pedido repetido de alguien ya borrado responde `no_identity` en vez de `already_erased` (se perdió el registro; no hay nada que borrar igual).
- Ensayado: apply → re-apply rechazado → rollback rechazado con filas → rollback forzado → re-apply, con `changedOutside: []` en cada paso.

## 7. Orden de despliegue (cada paso con su GO)

1. **Torneos 0021** (`db-0021.mjs observe` → `apply-0021`). Inerte: nadie la llama.
2. **Gateway** (nueva revisión con la ruta). Inerte: sólo responde a Core firmado.
3. **Core:** secreto `TORNEOS_GATEWAY_URL` en las funciones de Core y despliegue de `delete-account`. Desde acá el borrado llega a Torneos. **Sin `TORNEOS_GATEWAY_URL` el borrado falla cerrado**: configurar antes de desplegar.
4. **Web** (textos y `/account-deletion`). Puede ir junto con 3; nunca antes de 3 (los textos prometen lo que hace 3).

Vuelta atrás: web → Core (función anterior) → gateway (revisión anterior) → rollback 0021 (forzado si ya hubo erasures; no restaura datos).

## 8. Preguntas abiertas

1. ¿Login dedicado para la ruta de erasure (separarlo de `torneos_core_adapter`)? Reduce el alcance de un compromiso del gateway; agrega un secreto. Se dejó para decidir.
2. Plazo y canal del pedido por email (24 h de acuse, 5 días hábiles de cumplimiento): confirmar con Nico.
