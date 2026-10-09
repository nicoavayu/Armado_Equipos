# Revisión Core — promoción (no ejecutada)

Nada de esto se aplicó en Producción. Requiere GO, backup previo y una ventana fuera de R0–R3.

Procedimiento completo (backup, prechecks, aplicación, post-checks, rollbacks probados y dry
run): [RUNBOOK-193.md](RUNBOOK-193.md).

## 1. Publicar la web primero

El cliente nuevo funciona **con y sin** las migraciones: si una RPC nueva todavía no existe
(`PGRST202`), lee como antes (perfil propio, perfiles públicos, búsqueda por nombre, partido
por código, jugador sin cuenta). Por eso la web puede salir antes que la base.

## 2. Migraciones (orden normal del ledger)

| Migración | Qué cambia | En Producción |
|---|---|---|
| `20261010120000_core_trigger_helper_execute_grants` | grants de helpers de triggers | no-op (ya los tiene) |
| `20261010121000_core_public_voting_roster_identity` | votar por link solo con un nombre del plantel (invitado titular) | cambia la votación pública |
| `20261010122000_core_notifications_ext_match_columns` | columnas `match_id_text`/`match_code` | no-op si existen |
| `20261010123000_core_reset_votacion_score_default` | "Resetear votación" ya no aborta | sin cambio si `score` admite NULL |
| `20261010124000_core_usuarios_profile_rpcs` | fase A de privacidad: RPCs de perfil (aditiva) | sin riesgo para apps instaladas |
| `20261010125000_core_public_match_reads_by_code` | anon ya no lista partidos/planteles; lee un partido por su código | ver nota |
| `20261010126000_core_team_roster_identity` | equipo permanente: `jugadores.partido_id` admite NULL, trigger antes de borrar, RPC de jugador sin cuenta | aditiva para clientes viejos |
| `20261010127000_core_post_match_surveys_result_columns` | `ganador`/`resultado` en encuestas | no-op si existen |
| `20261010128000_core_contact_phone_and_public_profile_list` | lista pública explícita de `usuarios`; `get_public_profiles` sólo la devuelve; `get_match_contact_phone`; `jugadores.added_by` (trigger); `user_id`/`match_id` de solicitudes inmutables por la API | aditiva; el teléfono se sigue pudiendo leer de la tabla hasta la fase B |
| `20261010129000_core_survey_finalization_recovery` | `list_my_pending_survey_finalizations`: encuestas vencidas del organizador | aditiva |
| `20261010130000_core_client_build_reports` | `report_client_build` + `app_private.privacy_phase_b_readiness` | aditiva; tabla en `app_private` |
| `20261010131000_core_survey_server_finalization` | cierre, resultados, premios, avisos e historial de encuestas desde el servidor (pg_cron cada 5 min, mismas reglas que la app) | cierra encuestas vencidas que hoy quedan abiertas; idempotente |
| `20261010132000_core_friend_request_acceptance` | sólo el destinatario acepta una solicitud de amistad | la app ya funciona así |
| `20261010133000_core_match_access_code` | vistas y descubrimiento muestran el código sólo al admin y al plantel; `get_match_access_codes` | apps instaladas no leen códigos ajenos de esas vistas |
| `20261010134000_core_partidos_template_link` | `partidos.template_id` (FK a `partidos_frecuentes`, sólo plantilla propia): el historial de frecuentes deja de estar siempre vacío | ninguno (columna nueva y opcional); **verificar antes en Producción** que la columna no exista con otro tipo: `select column_name, data_type from information_schema.columns where table_schema='public' and table_name='partidos' and column_name in ('template_id','from_frequent_match_id');` |
| `20261010135000_core_private_profile_fields` | email, teléfono, nacimiento y ubicación exacta salen de la fila compartida de `usuarios` (y el teléfono de `profiles`) a `app_private.usuarios_private`; la fila conserva las columnas en `NULL` y la ubicación a ~1 km; `get_my_profile`, `clear_my_profile_fields`; contacto, búsqueda, auto-match y arqueros leen la tabla privada | 1.1.21 sigue funcionando: ve vacíos su teléfono y nacimiento propios y no ve teléfonos ajenos; un guardado en blanco no borra nada |
| `20261010136000_core_match_roster_visibility` | `partidos` y `jugadores` visibles sólo para quien participa (organizador, plantel, solicitud, aviso) y, mientras está publicado buscando jugadores, para cualquier cuenta; filas sin partido (equipos) visibles | ninguno nuevo: una cuenta ajena recibe filas vacías (no errores); directorios que recorrían todos los planteles quedan acotados |
| `20261010137000_core_match_code_never_public` | la tabla `partidos` devuelve un partido sólo a quien participa; `partidos_view` y "Quiero jugar" muestran los publicados leyendo como `core_match_public_reader` (sin login, sus propias policies) y con el código oculto; `partidos_view` suma `busca_arquero`, `player_invites_enabled` y `precio_cancha_por_persona` | 1.1.21 abre los publicados por la vista (ya no recurre a la tabla); no recibe en tiempo real cambios de partidos publicados ajenos |
| `20261010138000_core_voting_photo_slot_owner` | la foto de un invitado la cambia sólo la primera sesión que toma ese nombre; no se toma el de quien ya votó | ninguno: el edge function ya responde 409 |
| `20261010139000_core_roster_added_by_private` | `jugadores.added_by` pasa a `app_private.jugadores_added_by` (trigger AFTER INSERT) y la columna se elimina; `get_match_contact_phone` lee de ahí | ninguno: ni la 1.1.21 ni la web nombran la columna; `select('*')` sigue igual |
| `20261010140000_core_published_roster_identity` | `usuario_id`/`score` de planteles sólo para quien participa (tabla, realtime, vistas, link, `get_public_match_roster`); sumarse uno mismo sólo con invitación, solicitud aprobada o link validado; fila propia: sólo nombre, foto y posición; solicitudes pendientes y únicas | 1.1.21 ve vacío el plantel de un partido publicado ajeno; pedir sumarse y las invitaciones siguen; un link viejo con sólo el código no deja sumarse con cuenta |
| `20261010141000_core_organizer_approves_join_requests` | `approve_join_request` ejecutable por cuentas (no anon); sigue verificando que sea el creador y bloqueando partido y solicitud | ninguno: la 1.1.21 y la web aprueban por `approve-join-request`, que deja de responder "forbidden" |

**Nota 125000:** con la web nueva publicada, las páginas públicas (votación por link,
invitación de invitado) ya leen por código. Una build nativa vieja abierta **sin sesión**
desde un link de votación no podría cargar el partido hasta actualizarse. Si eso importa,
aplicar 125000 junto con la fase B.

## 3. Privacidad: cierre compatible (135000 + 136000) y fase B opcional

Las migraciones 135000 y 136000 cierran la exposición de datos personales, de códigos y de
planteles **sin revocar columnas**, así que la 1.1.21 (la versión en ambas tiendas) sigue
funcionando y no hace falta esperar builds nuevas. Detalle, residual y compatibilidad en
[`PHASE-B-PLAN.md`](PHASE-B-PLAN.md).

`phase-b-usuarios-private-columns.sql` y `phase-b-partidos-access-code.sql` (revocar columnas)
quedan como **refuerzo opcional** para cuando no queden apps viejas, medido con
`app_private.privacy_phase_b_readiness(<min Android>, <min iOS>, 30)` y las consolas de las
tiendas. Rompen la 1.1.21 (`select('*')` sobre `usuarios`/`partidos`) y no son necesarios para el
cierre. Rollback: `grant select on table public.usuarios, public.profiles, public.partidos to anon, authenticated;`

**Qué está distribuido hoy (evidencia, 2026-10-07):** App Store y Google Play ofrecen 1.1.21
(Play: actualización 7 ago 2026, "100+ descargas", Android 6.0+; App Store: lanzada 8 ago 2026).
No hay forma de forzar la actualización.

## 4. Verificación posterior

- Votar por link con un invitado del plantel → `ok`; con un nombre que no está → `invalid`.
- Organizador: "Resetear votación" → todos pueden volver a votar con el mismo link.
- Perfil propio carga y se edita; buscar amigo por nombre y por email exacto.
- Sin sesión: `/partido/<id>/invitacion?c=<código>&i=<token>` muestra el partido; listar
  `partidos` como anon devuelve 0 filas.
- Cuenta nueva acepta invitación de equipo; salir de un partido no la saca del equipo.
- Encuesta: guardar muestra la confirmación en < 1 s; el ganador queda guardado.
- Teléfono: el organizador lo ve sólo para quien se sumó por sí mismo, pidió sumarse o aceptó
  su invitación; invitar o agregar a alguien al plantel no lo habilita.
- Encuesta vencida (todos votaron o pasó el plazo): sin que nadie abra la app, a los ≤5 min queda
  cerrada, con resultados, premios, avisos e historial (`app_private.survey_finalization_runs`
  muestra el resultado por partido). Si el organizador abre la app antes, lo hace su app.
- Amistades: una solicitud creada como `accepted` o aceptada por quien la envió → rechazada.
- Códigos: una cuenta ajena ve el partido en "Quiero jugar" y en `partidos_view` con `codigo` vacío;
  el admin y el plantel lo ven; los enlaces de WhatsApp y de votación siguen abriendo el partido.

## 5. Rollback por migración

- 121000 / 123000: recrear las funciones desde su definición previa (baseline `20260727090000`).
- 124000: `drop function` de las cuatro RPCs (el cliente vuelve a leer la tabla).
- 125000: recrear `partidos_select_public_shared` y `jugadores_select_public_shared` (baseline).
- 126000: recrear `rpc_accept_team_invitation` previa y `drop trigger trg_keep_team_roster_on_match_player_delete`;
  `partido_id` puede quedar nullable (las filas de plantel ya creadas lo necesitan).
- 120000 / 122000 / 127000: inocuas; no requieren rollback.
- 128000: `drop function public.get_match_contact_phone(bigint, uuid)`; recrear `get_public_profiles` de 124000;
  `drop trigger trg_jugadores_added_by on public.jugadores` y `drop trigger trg_match_join_request_identity_immutable on public.match_join_requests`
  (la columna `added_by` puede quedar).
- 129000 / 130000: `drop function` de sus RPCs (y `drop table app_private.client_build_reports`); el cliente lo tolera (`PGRST202`).
- 131000: `select cron.unschedule('survey_finalization_backend_scheduler');` (las funciones pueden quedar; la app sigue cerrando como antes).
- 132000: `drop trigger trg_amigos_request_rules on public.amigos;` y recrear `amigos_insert_sender` sin `status = 'pending'`.
- 133000: recrear las tres vistas con `p.codigo` (definición previa en el baseline) y `drop function public.get_match_access_codes(bigint[])`.
- 134000: `drop trigger partidos_template_owner on public.partidos; drop function app_private.tg_partidos_template_owner(); alter table public.partidos drop column template_id;` (se pierden los vínculos creados desde entonces).
- 141000 / 140000 / 139000 / 138000 / 137000 / 136000 / 135000: archivos probados en [`runbook/rollbacks/`](runbook/rollbacks/), en ese orden (detalle abajo para 135000/136000).
- 135000 (devuelve los valores a la fila, en este orden):
  `drop trigger trg_usuarios_private_fields on public.usuarios; drop trigger trg_profiles_private_phone on public.profiles;`
  `update public.usuarios u set email = p.email, telefono = p.telefono, fecha_nacimiento = p.fecha_nacimiento, latitud = p.latitud, longitud = p.longitud, location_accuracy_m = p.location_accuracy_m from app_private.usuarios_private p where p.user_id = u.id;`
  recrear `get_my_profile` de 124000, `get_match_contact_phone` de 128000 y `search_usuarios`,
  `sync_my_auto_match_location_from_profile`, `_notify_goalkeepers_for_match` desde su definición previa;
  `drop function public.clear_my_profile_fields(text[])` (el cliente tolera `PGRST202`). La tabla privada puede quedar.
- 136000: recrear `partidos_select_authenticated` como `using ((deleted_at is null) or app_private.is_match_admin(id))` y
  `jugadores_select_authenticated` como `using (true)`. Las funciones y los índices pueden quedar.
