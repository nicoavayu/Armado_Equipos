# Revisión Core — promoción (no ejecutada)

Nada de esto se aplicó en Producción. Requiere GO, backup previo y una ventana fuera de R0–R3.

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

**Nota 125000:** con la web nueva publicada, las páginas públicas (votación por link,
invitación de invitado) ya leen por código. Una build nativa vieja abierta **sin sesión**
desde un link de votación no podría cargar el partido hasta actualizarse. Si eso importa,
aplicar 125000 junto con la fase B.

## 3. Fase B de privacidad (manual, más adelante)

`phase-b-usuarios-private-columns.sql` (no es migración): revoca la lectura de `email`,
`fecha_nacimiento`, `latitud`, `longitud`, `location_accuracy_m` de otros usuarios. Aplicar
**solo** cuando la versión mínima de Android/iOS en uso incluya el cliente de la fase A
(las builds actuales leen su propio perfil con `select('*')` y dejarían de cargarlo).
Rollback: `grant select on table public.usuarios to anon, authenticated;`

## 4. Verificación posterior

- Votar por link con un invitado del plantel → `ok`; con un nombre que no está → `invalid`.
- Organizador: "Resetear votación" → todos pueden volver a votar con el mismo link.
- Perfil propio carga y se edita; buscar amigo por nombre y por email exacto.
- Sin sesión: `/partido/<id>/invitacion?c=<código>&i=<token>` muestra el partido; listar
  `partidos` como anon devuelve 0 filas.
- Cuenta nueva acepta invitación de equipo; salir de un partido no la saca del equipo.
- Encuesta: guardar muestra la confirmación en < 1 s; el ganador queda guardado.

## 5. Rollback por migración

- 121000 / 123000: recrear las funciones desde su definición previa (baseline `20260727090000`).
- 124000: `drop function` de las cuatro RPCs (el cliente vuelve a leer la tabla).
- 125000: recrear `partidos_select_public_shared` y `jugadores_select_public_shared` (baseline).
- 126000: recrear `rpc_accept_team_invitation` previa y `drop trigger trg_keep_team_roster_on_match_player_delete`;
  `partido_id` puede quedar nullable (las filas de plantel ya creadas lo necesitan).
- 120000 / 122000 / 127000: inocuas; no requieren rollback.
