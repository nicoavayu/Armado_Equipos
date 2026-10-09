# Funciones SECURITY DEFINER que escriben sin mirar quién llama (118000 · 145000 · 146000)

Nico lo autorizó el 2026-10-09: inventario, revisión de consumidores, control del lado del
servidor para quien lo necesita, quitar sólo lo innecesario y rollback exacto. **Nada de esto
está aplicado en Producción.**

## Inventario (esquema real de Producción, 2026-10-09)

Funciones SECURITY DEFINER de `public` (sin contar las de trigger) que **anon puede ejecutar**:

- en total: **112**;
- escriben (`insert`/`update`/`delete`): **50**;
- escriben y su cuerpo **no menciona** a quien llama (`auth.uid()`, `auth.role()`, `auth.jwt()`,
  `current_user`, `request.jwt`, `service_role`): **20**. Las cubre este trabajo:

| Función | Qué se hace |
|---|---|
| `add_creator_to_match` | 145000: anon sin EXECUTE (ningún llamador) |
| `cancel_partido_with_notification` | **118000** (urgente): sólo el organizador; anon sin EXECUTE |
| `compute_awards_for_match` | 146000: sin EXECUTE para PUBLIC/anon/authenticated |
| `debug_set_surveys_sent` | 146000: sin EXECUTE para PUBLIC/anon/authenticated |
| `enqueue_match_participant_notification` | 145000: envoltorio con control (organizador / jugador del plantel) |
| `enqueue_partido_notification` | 145000: envoltorio con control (organizador / involucrado) |
| `fanout_survey_for_match` | 146000: sin EXECUTE para PUBLIC/anon/authenticated |
| `mark_match_assumed_not_played` | 146000: sin EXECUTE para PUBLIC/anon/authenticated |
| `prepare_challenge_team_squad` | 146000: envoltorio; por la API sólo dueño o capitán de un equipo del desafío |
| `process_awards_for_matches` | 146000: sin EXECUTE para PUBLIC/anon/authenticated |
| `process_match_reminder_notifications_backend` | 146000: sin EXECUTE para PUBLIC/anon/authenticated |
| `process_survey_start_notifications_backend` | 146000: sin EXECUTE para PUBLIC/anon/authenticated |
| `public_get_or_create_voter` | 121000: sin EXECUTE para anon/authenticated (sólo la usan las RPC de votación) |
| `public_mark_voter_completed` | revisada, ya protegida: exige el código del partido y el id (votación por link de WhatsApp, sin sesión, por decisión de producto) |
| `public_submit_no_lo_conozco` | revisada, ya protegida: exige código + partido; sólo nombres de invitados del plantel (121000) |
| `public_submit_player_rating` | revisada, ya protegida: exige código + partido; sólo nombres de invitados del plantel (121000) |
| `rpc_crear_partido_debug` | 146000: sin EXECUTE para PUBLIC/anon/authenticated |
| `send_match_kicked_notification` | 146000: envoltorio; por la API sólo el organizador |
| `sync_team_match_to_partido` | 146000: envoltorio; por la API sólo un miembro de alguno de los dos equipos |
| `update_delivery_status` | 146000: sin EXECUTE para PUBLIC/anon/authenticated |

Las otras 30 que escriben sí mencionan a quien llama. **No se revisaron una por una**
en este trabajo: que mencionen `auth.uid()` no garantiza que lo exijan. Quedan para una revisión
aparte:

`admin_close_payments`, `admin_set_payment_status`, `admin_update_payment_settings`, `approve_join_request`, `cancel_own_match_join_request`, `create_guest_match_invite`, `create_invite`, `delete_my_notifications`, `ensure_match_payments`, `reopen_own_match_join_request`, `report_my_payment`, `rpc_accept_challenge`, `rpc_accept_team_invitation`, `rpc_cancel_team_match`, `rpc_complete_challenge`, `rpc_confirm_challenge`, `rpc_create_directed_challenge`, `rpc_reject_directed_challenge`, `rpc_report_challenge_result`, `rpc_send_team_invitation`, `rpc_set_challenge_availability`, `rpc_set_challenge_availability`, `rpc_transfer_team_captaincy`, `rpc_update_team_member_shirt_number`, `rpc_upsert_challenge_team_selection`, `send_call_to_vote`, `send_match_chat_message`, `send_team_chat_message`, `send_team_match_chat_message`, `set_notification_presence`.

El filtro es una heurística sobre el texto. Las 4 funciones de votación por link que aparecen en
la lista se revisaron y ya están protegidas por el código del partido: es la votación sin sesión
por decisión de producto. No hay otros falsos positivos: las 12 de 146000 y la de 118000 no
verifican a quien llama.

## Consumidores de las 13 de 118000 / 146000

Revisados: web `main`, 1.1.21 (`dad2a0b9`), funciones edge, funciones SQL y triggers del
esquema de Producción, y pg_cron. Todas las funciones SQL que las llaman son SECURITY DEFINER:
corren como el dueño, así que quitarle EXECUTE a `anon`/`authenticated` no las afecta.

| Función | Consumidores | Cambio |
|---|---|---|
| `cancel_partido_with_notification` | 1.1.21 `matches.js:1675` (organizador). Nadie más | **118000** (urgente): sólo el organizador; anon sin EXECUTE |
| `send_match_kicked_notification` | 1.1.21 `useAdminPanelState.js` (organizador que saca a un jugador); web `main` usa `*_as_admin` (no está en Producción) | 146000: envoltorio; por la API sólo el organizador |
| `sync_team_match_to_partido` | 1.1.21 `teamChallenges.js` (miembros de los equipos); trigger `trg_sync_team_match_to_partido_bridge` (DEFINER); web `main` usa `*_as_actor` | 146000: envoltorio; por la API sólo un miembro de alguno de los dos equipos |
| `prepare_challenge_team_squad` | 1.1.21 `teamChallenges.js` (capitanes); SQL (DEFINER): `rpc_accept_challenge`, `rpc_confirm_challenge`, `rpc_set_challenge_availability`, `rpc_upsert_challenge_team_selection`; web `main` usa `*_as_actor` | 146000: envoltorio; por la API sólo dueño o capitán de un equipo del desafío |
| `compute_awards_for_match` | web y 1.1.21 la llaman con `partido_id`; la firma de Producción es `p_partido_id`, así que la llamada ya falla (PGRST202) y la app calcula por su cuenta. SQL: `process_awards_for_matches` (DEFINER) | 146000: sin EXECUTE para PUBLIC/anon/authenticated |
| `debug_set_surveys_sent` | ninguno | 146000: sin EXECUTE para PUBLIC/anon/authenticated |
| `fanout_survey_for_match` | ninguno | 146000: sin EXECUTE para PUBLIC/anon/authenticated |
| `mark_match_assumed_not_played` | SQL (DEFINER): `prepare_pending_challenge_partido_for_post_match`, `process_survey_reminder_notifications_backend`, `process_survey_start_notifications_backend` | 146000: sin EXECUTE para PUBLIC/anon/authenticated |
| `process_awards_for_matches` | ninguno en clientes; pg_cron/servidor | 146000: sin EXECUTE para PUBLIC/anon/authenticated |
| `process_match_reminder_notifications_backend` | ninguno en clientes; pg_cron/servidor | 146000: sin EXECUTE para PUBLIC/anon/authenticated |
| `process_survey_start_notifications_backend` | SQL (DEFINER): `fanout_survey_start_notifications`; pg_cron/servidor | 146000: sin EXECUTE para PUBLIC/anon/authenticated |
| `rpc_crear_partido_debug` | ninguno | 146000: sin EXECUTE para PUBLIC/anon/authenticated |
| `update_delivery_status` | ninguno en el repositorio (servidor de push con `service_role`, si existe) | 146000: sin EXECUTE para PUBLIC/anon/authenticated |

## Cómo funcionan los envoltorios (145000, 146000)

- La función original se mueve **sin cambios** (mismo cuerpo y mismo oid) a
  `app_private.<nombre>_unchecked`.
- En su lugar queda una función SECURITY INVOKER con el mismo nombre, los mismos argumentos y los
  mismos valores por defecto:
  - si la llama la API (`current_user` = `anon`/`authenticated`), primero pregunta a
    `app_private.assert_api_caller_may`, que usa los mismos predicados que las variantes
    `*_as_actor`/`_as_admin` del repositorio;
  - si la llama el dueño (funciones DEFINER, triggers, pg_cron) o `service_role`, pasa directo.
- `anon` pierde EXECUTE. `authenticated` y `service_role` conservan lo que tenían.
- **Rollback**: borra el envoltorio, devuelve la original a `public` y restaura el ACL guardado,
  con las mismas entradas y en el mismo orden.

## Orden y rollback

- **Aplicar:** `apply-193.psql` aplica 118000 (o la saltea si ya se aplicó sola, ver
  [CANCEL-URGENT.md](CANCEL-URGENT.md)), luego 119000…145000 y al final 146000. 146000 exige que la
  guarda de 118000 esté.
- **Rollback:** 146000 primero, después 145000 y los demás según RUNBOOK-193 §9. El de 118000 es
  independiente, cuando se decida. El de 146000 no toca `cancel_partido_with_notification`.
