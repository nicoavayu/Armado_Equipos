# Funciones de avisos de partido (20261010145000)

Nico autorizó el 2026-10-09 sumar esto al alcance del ensayo. **Nada está aplicado en Producción.**

## Qué pasa hoy en Producción

`public.enqueue_partido_notification` y `public.enqueue_match_participant_notification`:
- son SECURITY DEFINER;
- no verifican quién llama;
- las puede ejecutar cualquiera: PUBLIC, `anon`, `authenticated` y `service_role`.

Con sólo un id de partido, cualquiera (sin sesión incluido) le manda un aviso **con título y texto
a elección** a cada jugador y al organizador. Es un canal de spam o phishing hacia cualquier
plantel. Insertar avisos directamente en `notifications` sí está limitado: sólo a uno mismo
(`notifications_insert_self_only`). Así que estas dos funciones son el único camino.

`public.add_creator_to_match(uuid)` también es ejecutable por `anon`, y ningún cliente la usa.

ACL y cuerpo en el esquema real (2026-10-09):

| Función | ACL | md5 del cuerpo |
|---|---|---|
| `enqueue_partido_notification(bigint,text,text,text,jsonb)` | `{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}` | `d374c8335aa4b6ed13d9e5e2b780df72` |
| `enqueue_match_participant_notification(bigint,text,text,text,jsonb,uuid,boolean)` | igual | `6448abe425a7235a804a7484d62437f3` |
| `add_creator_to_match(uuid)` | igual | `45a0014c4831b928993f4ca22bddee47` |

## Quién las llama (revisión del 2026-10-09)

| Origen | Llamada | Rol | Tipo / caso |
|---|---|---|---|
| Web `main` | `*_as_actor` (no existen en Producción) → inserción directa | — | **no llama a estas dos** |
| 1.1.21 (`dad2a0b9`) `db/matches.js` `deletePartidoWithNotification` | `enqueue_partido_notification` | organizador | `match_deleted` (antes de borrar) |
| 1.1.21 `matchFinishService.js` | `enqueue_partido_notification` | organizador | `survey_start` |
| 1.1.21 `matchJoinNotificationService.js` `notifyAdminJoinRequest` (PartidoInvitacion) | `enqueue_partido_notification` | quien pide sumarse | `match_join_request` → organizador |
| 1.1.21 `notifyAdminPlayerJoined` (PartidoInvitacion, panel del organizador) | `enqueue_match_participant_notification` (si falla, al organizador) | jugador que entró / organizador | `match_update` |
| 1.1.21 `notifyAdminPlayerLeft` (ProximosPartidos, después de borrar su fila; panel) | `enqueue_partido_notification` | jugador que salió / organizador | `match_update` → organizador |
| Edge `join-match-guest`, `accept-invite` | ambas | `service_role` | avisos de alta |
| SQL: `cancel_partido_with_notification`, `leave_owned_match_with_transfer`, `process_match_reminder_notifications_backend`, `process_survey_reminder_notifications_backend`, `process_survey_start_notifications_backend` | ambas | dueño (SECURITY DEFINER) | cancelación, traspaso, recordatorios, encuestas |
| SQL: `init_survey_progress` (trigger INVOKER) | `enqueue_partido_notification` | — | no está asociada a ningún trigger en Producción |
| `add_creator_to_match` | — | — | ningún llamador (web, 1.1.21, edge, SQL) |

Con sesión siempre: Producción tiene apagado el inicio de sesión anónimo, y los invitados entran
por funciones edge con `service_role`.

## El cambio

- Las dos funciones originales **se mueven sin cambios** (mismo cuerpo, mismo oid) a
  `app_private.<nombre>_unchecked`. En su lugar queda un envoltorio SECURITY INVOKER con el mismo
  nombre, argumentos y valores por defecto.
- Si lo llama la API (`current_user` = `anon`/`authenticated`), pregunta a
  `app_private.assert_match_notification_allowed`:
  - el **organizador** (`creado_por`/`admin_id`) manda todo, como hoy;
  - cualquier otra cuenta sólo `match_join_request` o `match_update` **al organizador** (para esos
    tipos la función avisa sólo al organizador), y sólo si está involucrada en el partido:
    solicitud, invitación u otro aviso, plantel o link de invitado validado;
  - el aviso a todo el plantel (`enqueue_match_participant_notification`) sólo `match_update`, de
    un jugador del plantel;
  - sin sesión: rechazado (42501).
- Si lo llama el dueño (las funciones SECURITY DEFINER de arriba, pg_cron) o `service_role`, pasa
  directo, como hoy.
- `anon` pierde EXECUTE sobre las dos y sobre `add_creator_to_match`. `authenticated` y
  `service_role` conservan lo que tenían.

**Residual:** un jugador del plantel puede mandar `match_update` con texto propio a su plantel, y
alguien involucrado, al organizador. Es lo que hace la 1.1.21 al entrar o salir de un partido.

## Ensayo sobre el esquema real

Humo `integration/prod-schema/smoke.sql`, sección 145:
- anon no puede enviar avisos ni llamar `add_creator_to_match`;
- un ajeno no puede avisar a un partido que no le toca, ni una cancelación;
- quien pidió sumarse avisa al organizador (como en 1.1.21), pero no puede anunciar una
  cancelación ni avisar a todo el plantel;
- un jugador anuncia que entró al plantel, pero no otros tipos;
- el organizador manda `match_deleted` y `survey_start`;
- `cancel_partido_with_notification` (SECURITY DEFINER) sigue avisando al plantel.

Control negativo: sin 145000 fallan los 6 chequeos de "no puede".

## Rollback exacto

`runbook/rollbacks/20261010145000_core_match_notification_callers.rollback.sql`, **primero** (antes
del de 143000):
1. borra los envoltorios;
2. devuelve las originales a `public` con su nombre (mismo cuerpo y oid);
3. restaura sus ACL exactamente como estaban, incluida la de `add_creator_to_match`. Las guardó 145000
   en `app_private.production_alignment_log` (`function_acl_before`);
4. borra `assert_match_notification_allowed`.

## Fuera de este alcance (para decidir)

El mismo escaneo encontró más funciones SECURITY DEFINER ejecutables por `anon` que escriben sin
mirar quién llama. Son de Producción, no del stack, y el filtro es heurístico: alguna puede
verificar por otro camino. La más grave es `cancel_partido_with_notification(bigint,text)`:
**cualquiera puede cancelar y borrar (soft delete) cualquier partido**. La 1.1.21 la llama como
organizador. Lista completa en el informe al coordinador del 2026-10-09.
