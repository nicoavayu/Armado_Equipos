# Runbook de publicación — #193 (privacidad Core) sobre Producción

**Nada de esto se ejecutó en Producción.** Cada paso necesita el GO de Nico. Lo ejecuta Nico:
el agente no tiene acceso a Producción y la contraseña de la base sólo se tipea en la terminal.

**Producción no es el esquema del repositorio.** El precheck del 2026-10-09 lo mostró, y un
`pg_dump --schema-only` de Producción lo confirmó:
- Las migraciones canónicas de RLS y grants figuran en su ledger, pero nunca se ejecutaron.
- `partidos` no tiene `admin_id`/`uuid`; `profiles` no tiene `telefono`.
- `partidos`, `jugadores` y las tablas de votación tienen policies abiertas (`USING true`), y
  `app_private` no tiene grants.
- `partidos_view` es otra: sin filtro de borrados, con el plantel embebido.

Este runbook está ensayado sobre ese esquema **real**, aplicado como `postgres` no superusuario
(`integration/prod-schema/`, §11):
- datos sintéticos con la forma de Producción;
- 74 chequeos de humo;
- rollbacks comparados contra el catálogo original.

La evidencia está en
[`runbook/evidence/rehearsal-prod-schema-20261009.json`](runbook/evidence/rehearsal-prod-schema-20261009.json).

## 1. Qué se aplica

El ledger de Producción tiene las 43 migraciones de `main` hasta `20260915`, más `20261007`,
`20261008` y `20261009120000`. Encima van **28 migraciones, en este orden**: 118000 (el arreglo urgente, que puede haberse aplicado antes por su cuenta), 119000…143000, 145000 y 146000. `20261010144000` es un borrador aparte, en [`drafts/`](drafts/README.md), y no se aplica. 119000 y 142000
existen por las diferencias de Producción; ninguna de las dos cambia algo sobre el esquema del
repositorio. 143000 cierra lo que el gate B encontró sobre las columnas reales de `jugadores`; 145000, los avisos de partido abiertos a cualquiera; 118000 y 146000, las funciones que cualquiera podía llamar para escribir.

| # | Migración | Qué cambia | Ensayo |
|---|---|---|---|
| U | `20261010118000_core_cancel_match_organizer_only` | **arreglo urgente con GO propio** ([`CANCEL-URGENT.md`](CANCEL-URGENT.md)): sólo el organizador cancela un partido por la API; anon sin EXECUTE. Si ya se aplicó sola, `apply-193.psql` la saltea | 38 ms |
| 0 | `20261010119000_core_production_alignment` | **alinea Producción con lo que el resto da por hecho.** Agrega `partidos.admin_id` (queda null: el organizador es `creado_por`), crea los helpers `app_private.is_match_admin`/`is_match_player`/`is_public_match_visible` y da USAGE de `app_private`. En `partidos`/`jugadores` reemplaza sólo las policies `SELECT`/`INSERT` abiertas de Producción (14) por las del repositorio; sus `UPDATE`/`DELETE` y `partidos_insert_own` quedan. En `public_voters`/`votos_publicos` quita lectura e inserción abiertas (4) y deja la lectura de plantel/organizador. Las 18, con definición original, reemplazo y rollback: [`POLICIES-REPLACED.md`](POLICIES-REPLACED.md). Las otras 192 policies del esquema no cambian (digest guardado y verificado por el post-check). Todo queda registrado en `app_private.production_alignment_log` para el rollback | 45 ms |
| 1 | `20261010120000_core_trigger_helper_execute_grants` | grants de helpers de triggers | 36 ms |
| 2 | `20261010121000_core_public_voting_roster_identity` | votar por link sólo con un nombre del plantel | 44 ms |
| 3 | `20261010122000_core_notifications_ext_match_columns` | columnas `match_id_text`/`match_code` | 41 ms |
| 4 | `20261010123000_core_reset_votacion_score_default` | "Resetear votación" ya no aborta | 38 ms |
| 5 | `20261010124000_core_usuarios_profile_rpcs` | RPCs de perfil | 41 ms |
| 6 | `20261010125000_core_public_match_reads_by_code` | sin sesión: un partido sólo por su código | 39 ms |
| 7 | `20261010126000_core_team_roster_identity` | plantel de equipos sin partido | 46 ms |
| 8 | `20261010127000_core_post_match_surveys_result_columns` | `ganador`/`resultado` en encuestas | 39 ms |
| 9 | `20261010128000_core_contact_phone_and_public_profile_list` | teléfono de contacto por RPC, perfil público explícito | 45 ms |
| 10 | `20261010129000_core_survey_finalization_recovery` | encuestas vencidas del organizador | 43 ms |
| 11 | `20261010130000_core_client_build_reports` | `report_client_build` + `privacy_phase_b_readiness` | 40 ms |
| 12 | `20261010131000_core_survey_server_finalization` | cierre de encuestas desde el servidor (pg_cron, 5 min) | 45 ms |
| 13 | `20261010132000_core_friend_request_acceptance` | sólo el destinatario acepta | 38 ms |
| 14 | `20261010133000_core_match_access_code` | vistas: código sólo para admin y plantel | 46 ms |
| 15 | `20261010134000_core_partidos_template_link` | `partidos.template_id` (historial de frecuentes) | 43 ms |
| 16 | `20261010135000_core_private_profile_fields` | email, teléfono, nacimiento y ubicación exacta fuera de la fila compartida | 72 ms |
| 17 | `20261010136000_core_match_roster_visibility` | partido y plantel sólo para quien participa (+ publicados) | 44 ms |
| 18 | `20261010137000_core_match_code_never_public` | el código no llega a nadie ajeno: la tabla sólo devuelve partidos propios; los publicados se ven por las vistas, con el código oculto | 53 ms |
| 19 | `20261010138000_core_voting_photo_slot_owner` | la foto de un invitado sólo la cambia quien vota como él | 37 ms |
| 20 | `20261010139000_core_roster_added_by_private` | quién agregó a cada jugador sale de la fila de `jugadores` a `app_private.jugadores_added_by`; se elimina la columna (ningún cliente la nombra) | 49 ms |
| 21 | `20261010140000_core_published_roster_identity` | quien no participa (y anon) no recibe `usuario_id` ni `score` de ningún plantel: tabla, realtime, vistas de "Quiero jugar", código del link; RPC `get_public_match_roster` para la web. En el servidor: sumarse uno mismo sólo con invitación, solicitud aprobada o link de invitación validado; el jugador sólo edita nombre, foto y posición de su fila; solicitudes siempre pendientes, una por cuenta y partido | 48 ms |
| 22 | `20261010141000_core_organizer_approves_join_requests` | `approve_join_request` ejecutable por cuentas, no por anon. En el repositorio no lo era ("forbidden"); en Producción ya lo era, y sólo se le quita a anon. Guarda el ACL previo para el rollback | 37 ms |
| 23 | `20261010142000_core_join_request_notifications` | **arreglo de Producción.** Hoy, desde la segunda solicitud a un mismo partido, la inserción falla con 23505, porque el aviso al organizador choca con un índice único por partido. `fn_notifications_fill_partido_id` (sólo existe en Producción) deja de volver a llenar `partido_id` en los avisos de cada solicitud | 43 ms |
| 24 | `20261010143000_core_roster_identity_roster_only` | **lo que encontró el gate B sobre el esquema real.** Quién es cada jugador queda sólo para el organizador y el plantel (regla de Nico). Afuera (cuenta ajena, una cuenta que sólo pidió sumarse o recibió un aviso, y anon por el link) cada entrada de plantel va sin `usuario_id`, `score` ni `responsabilidad_score` (columna de Producción), y su `uuid` (en Producción, el id de la cuenta de un jugador registrado; el de un invitado es su clave de dispositivo) se reemplaza por una clave opaca por fila. Vistas, `get_public_match_roster`, `public_get_match_by_code` y la tabla `jugadores` (y realtime). Las filas `match_ref` sin partido de Producción siguen la misma regla | 47 ms |
| 25 | `20261010145000_core_match_notification_callers` | **avisos de partido sólo del organizador y de la gente del partido** (Nico, 2026-10-09). Hoy cualquiera, anon incluido, manda un aviso con texto propio a todo el plantel de cualquier partido. Las dos funciones originales se mueven sin cambios a `app_private.*_unchecked` y en su lugar queda un envoltorio con la misma firma que, llamado por la API, exige: organizador (todo), o involucrado (sólo `match_join_request`/`match_update` al organizador), o jugador del plantel (sólo `match_update` a todos). Las funciones SECURITY DEFINER, pg_cron y `service_role` siguen igual. anon pierde EXECUTE (también sobre `add_creator_to_match`). Detalle, llamadores y rollback: [`NOTIFICATION-FUNCTIONS.md`](NOTIFICATION-FUNCTIONS.md) | 46 ms |
| 26 | `20261010146000_core_open_definer_writers` | **las demás funciones SECURITY DEFINER que cualquiera podía llamar para escribir** (Nico, 2026-10-09). 9 sin llamador en los clientes pierden EXECUTE para PUBLIC/anon/authenticated (`service_role`, pg_cron y las funciones DEFINER siguen igual). Las 3 que llama la 1.1.21 pasan a envoltorios con control: aviso de expulsión (organizador), sincronización de partido de equipos (miembro de alguno de los dos equipos), plantel de desafío (dueño o capitán). Exige la guarda de 118000. Inventario y consumidores: [`DEFINER-WRITERS.md`](DEFINER-WRITERS.md) | 37 ms |

Tiempos del ensayo sobre el esquema real con ~1.200 cuentas, 400 partidos y 4.000 filas de
plantel (1,05 s en total). Ninguna migración usa `CONCURRENTLY` ni abre su propia transacción.

**Adaptadas al esquema real:**
- **133000, 137000, 140000:** reescriben cada vista **a partir de su definición actual**:
  - enmascaran `codigo`;
  - agregan banderas sólo si faltan;
  - pasan cada plantel embebido por `app_private.roster_entry_json`.
  `partidos_view` de Producción conserva sus columnas y sus planteles dejan de mostrar
  `usuario_id`/`score`.
- **134000:** `template_id` toma el tipo de `partidos_frecuentes.id` (en Producción, `uuid` con
  su FK, que se conserva). El dueño de la plantilla se lee de `usuario_id`, `user_id` o
  `creado_por`.
- **135000:** `profiles.telefono` sólo si existe.
- **140000:** la guarda de solicitudes no depende de `cancelled_at`; un partido privado no
  recibe solicitudes de cuentas ajenas.
- **120000/121000:** 120000 no exige que anon pierda los helpers puros; 121000 cierra
  `public_get_or_create_voter` a los clientes y guarda el ACL previo.

**Con #182:** sus migraciones de Core (`20261006…`, `20261007…`, `20261008…`) tocan otros
objetos: Torneos, el contrato Core→Torneos (lee el email de `auth.users`, no de `usuarios`) y la
preferencia de push (`usuarios.push_enabled`, que 135000 no toca). Pueden ir antes o después.
Este runbook cubre #193 solo.

## 2. Antes del día (con GO)

1. **Merges:** `main` ya contiene #183–#193 (por #192). Faltan:
   - #195 (web sobre el esquema real);
   - la PR de esta adaptación (`claude/core-prod-schema-db`).
   Cada una con el CI de calidad verde.
2. **Web a Producción primero.** La web nueva funciona con y sin estas migraciones: si una RPC no
   existe todavía, lee como antes.

   La web publicada hoy (`main`) **no** está preparada. Con 125000, sus páginas públicas sin
   sesión (votación e invitación por link) dejan de cargar el partido. Por eso la web va antes
   que la base.
3. **Elegir la ventana.** Que no haya partidos en juego ni encuestas cerrándose (por ejemplo, a
   la mañana).

   La parte de base dura segundos. Los `CREATE POLICY` y `ALTER VIEW` toman locks
   exclusivos breves sobre `partidos`, `jugadores` y las vistas. `lock_timeout = 5s` hace que
   una migración bloqueada falle y se revierta entera, en lugar de dejar consultas en cola.

## 3. Backup verificado (Nico, el mismo día)

Se usa la misma herramienta que en el mantenimiento del 2026-10-07: `scripts/ops/free-plan/`,
en la rama de #182 desde `672ece4d`, o en `main` cuando #182 esté mergeada. Pide la contraseña
de la base y la frase del backup en la terminal; nunca quedan en archivos ni en el entorno.

```bash
python3 scripts/ops/free-plan/ops_free_plan.py backup-db --target core --out ~/Arma2Backups/core-review-193-AAAAMMDD-HHMM
```

```bash
python3 scripts/ops/free-plan/ops_free_plan.py restore-check --backup ~/Arma2Backups/core-review-193-AAAAMMDD-HHMM
```

- **Qué guarda:** un `pg_dump` cifrado, más un manifiesto tomado en el mismo snapshot: filas,
  hashes por tabla, funciones, grants, policies y triggers.
- **Dónde:** en `~/Arma2Backups` (FileVault) o en un disco externo cifrado.
- **Prueba de restauración:** `restore-check` restaura en un contenedor descartable sin red y
  compara cada tabla y catálogo con el manifiesto.
- **Condiciones para seguir:**
  - veredicto **VERIFIED** estricto: `pg_restore` con exit 0, sin errores, sin diferencias;
  - backup de **menos de 24 h**.
- **Registrar** del manifiesto: cantidad de filas de `usuarios`, `profiles`, `partidos` y
  `jugadores`.

## 4. Conexión

Es la misma que usa `ops_free_plan.py`: session pooler, `verify-full` y CA fijada. La contraseña
se tipea cuando la pide psql; si `PGPASSWORD` está definida, no seguir.

```bash
export CORE_CONNINFO="host=aws-0-sa-east-1.pooler.supabase.com port=5432 user=postgres.rcyuuoaqfwcembdajcss dbname=postgres sslmode=verify-full sslrootcert=/Users/nicoavayu/Downloads/prod-ca-2021.crt"
```

Todos los comandos siguientes se corren desde la raíz del repositorio, en el commit mergeado de
la PR de esta adaptación, con `/opt/homebrew/opt/libpq/bin/psql`.

## 5. Prechecks (sólo lectura)

```bash
/opt/homebrew/opt/libpq/bin/psql "$CORE_CONNINFO" --password -X -A -t -q -v ON_ERROR_STOP=1 -f docs/database/core-review/runbook/precheck.sql
```

Cada línea es `{check, pass, value}`. **Si algún `pass` es `false`, no seguir.**

| Check | Esperado |
|---|---|
| conectado como `postgres`, con `createrole`/`bypassrls` y miembro de `authenticated` y `anon` | `true` |
| Postgres ≥ 15 | `true` (Prod: 17) |
| base escribible | `off` |
| tamaño < 350 MB | `true` (Prod ≈ 64 MiB tras el mantenimiento) |
| ledger: está `20261009120000` y ninguna de `20261010119000…146000` | `true` |
| informativo: ¿118000 ya aplicada sola? | si sí, `apply-193.psql` la saltea |
| `postgres` es dueño de tablas y vistas afectadas | `true` |
| vistas con `security_invoker=on` | `true` |
| no existe nada del stack (tablas privadas, rol lector, `added_by`) | `true` |
| `partidos.template_id` ausente o del tipo de `partidos_frecuentes.id` | `true` (Producción: `uuid` con FK) |
| informativo: qué alinea 119000 | Producción hoy: `admin_id` ausente, faltan los 3 helpers y **18 policies** a reemplazar, exactamente las de [`POLICIES-REPLACED.md`](POLICIES-REPLACED.md) §1; `untouched_policies` = 192, md5 `86fa2f8a1ac188f4bfdeff38e700364e`. Si algo difiere, parar y revisar antes de seguir |
| informativo: ¿existe `profiles.telefono`? | Producción: `false` (135000 lo saltea) |
| pg_cron disponible | `true` |
| sin transacciones largas | `true` |
| ninguna cuenta con una sola coordenada | `true`; si no es 0, esas coordenadas sueltas no se conservan (una ubicación es el par) |
| informativo: teléfonos de `profiles` distintos del de la cuenta | anotar; esa copia queda sólo en el backup |
| informativo: duplicados de solicitudes | anotar; 140000 no los toca y evita nuevos |
| informativo, cómo está Prod hoy: ¿los organizadores pueden aprobar solicitudes? | Producción: `true` (141000 sólo cierra anon) |
| línea base de valores privados | anotar `with_email`, `with_phone`, `with_birth_date`, `with_location` |

## 6. Aplicar

```bash
/opt/homebrew/opt/libpq/bin/psql "$CORE_CONNINFO" --password -X -f docs/database/core-review/runbook/apply-193.psql
```

- Aplica las 28 migraciones en orden (118000 se saltea si ya está en el ledger). Cada una va en su propia transacción, junto con su fila
  en `supabase_migrations.schema_migrations`.
- Se esperan 28 líneas `>>> 202610101xxxxx …` (27 y una `=== 20261010118000 already in the ledger: skipped` si el arreglo urgente ya estaba) y al final `>>> done`.
- Si una falla, psql se detiene: esa migración se revierte entera y las anteriores quedan
  aplicadas.
- El mismo comando retoma desde donde quedó, porque saltea lo que ya está en el ledger. Antes
  de retomar, leer el error y ver §9.

## 7. Post-checks

```bash
/opt/homebrew/opt/libpq/bin/psql "$CORE_CONNINFO" --password -X -A -t -q -v ON_ERROR_STOP=1 -f docs/database/core-review/runbook/postcheck.sql
```

No escribe nada: es una transacción que se revierte. Actúa como una cuenta nueva al azar, como
anon, como el organizador del último partido y como una cuenta con teléfono. **Todas las líneas
deben dar `pass: true`.**

- **Ledger:** 118000 y las 27 de 119000…146000 están registradas.
- **119000:**
  - `SELECT`/`INSERT` de `partidos`/`jugadores` sólo tienen las policies del repositorio
    (más `partidos_insert_own` de Producción);
  - las tablas de votación no están abiertas;
  - existen los helpers;
  - **todas las demás policies están exactamente como antes**: el digest guardado por 119000 es
    igual al actual (`UPDATE`/`DELETE` de `partidos`/`jugadores`, `profiles`, `amigos`,
    `notifications`, `post_match_surveys`, `partidos_frecuentes`, `usuarios` y el resto).
  El valor lista lo registrado en `production_alignment_log`.
- **118000 + 146000:** `cancel_partido_with_notification` tiene la guarda del organizador; ninguna de las 13 funciones es ejecutable por anon; las 3 que llama la 1.1.21 son envoltorios con control.
- **145000:** anon no ejecuta `enqueue_partido_notification`, `enqueue_match_participant_notification` ni `add_creator_to_match`; las dos primeras son los envoltorios con control (INVOKER) y las originales están en `app_private` como SECURITY DEFINER, sin anon.
- **143000:**
  - las vistas, las dos RPC de plantel y la policy de lectura de `jugadores` usan
    `match_roster_identity_visible` (organizador y plantel);
  - como cuenta nueva y como anon: ninguna entrada de plantel trae `usuario_id`, `score` ni
    `responsabilidad_score`, y todo `uuid` es la clave opaca de su fila;
  - como la cuenta de la última solicitud pendiente (fuera del plantel): entradas enmascaradas
    y ninguna fila de plantel desde la tabla.
- **142000:** los avisos de cada solicitud no llevan `partido_id`, así que puede haber varias
  solicitudes por partido.
- **134000:** `template_id` del tipo de `partidos_frecuentes.id`, con FK y trigger del dueño.
- **141000:** cuentas pueden ejecutar `approve_join_request`, anon no.
- **140000:**
  - policies, vistas, `public_get_match_by_code` y guardas en su lugar;
  - como cuenta nueva: 0 `usuario_id`/`score` en vistas, "Quiero jugar", `get_public_match_roster` y el link;
  - no puede sumarse sola a un partido publicado ni crear una solicitud ya aprobada;
  - de la tabla sólo ve filas de equipos;
  - anon: el link trae el plantel sin `usuario_id`/`score`.
- **139000:** `public.jugadores` no tiene `added_by`; quién agregó a quién está sólo en `app_private`, sin lectura para `anon`/`authenticated`, con trigger AFTER INSERT.
- **135000:**
  - cero email, teléfono o nacimiento en las filas compartidas;
  - una fila privada por cuenta;
  - `with_*` iguales a la línea base del precheck;
  - coordenadas compartidas a 2 decimales.
- **Policies:** sin cláusula de "publicado" en `partidos` y sin `USING (true)` en `jugadores`.
- **Vistas:**
  - dueño `core_match_public_reader`, que no puede loguearse, no saltea RLS y no crea objetos;
  - ninguna cuenta puede escribir a través de `partidos_view`.
- **Grants:**
  - RPCs del perfil propio sólo para cuentas; el binding de fotos sólo para el servidor;
  - anon y authenticated pueden ejecutar todas las funciones que llaman las vistas. Si no, anon
    recibiría "permission denied" en `partidos_view`. Pasa si las funciones de 136000 son de otro
    rol, como en el ensayo, donde son de `supabase_admin`.
- **pg_cron:** el job de cierre de encuestas corre cada 5 min.
- **Cuenta nueva:**
  - 0 partidos desde la tabla;
  - en `partidos_view`, exactamente los partidos publicados, con 0 códigos;
  - planteles sólo de partidos publicados y de equipos;
  - datos privados ajenos en `NULL`;
  - `get_match_access_codes` no le devuelve nada.
- **Anon:**
  - 0 filas sin error;
  - un link con código e id abre su partido.
- **Organizador:** ve todos sus partidos con su código.
- **Dueño de un teléfono:** `get_my_profile` le devuelve su teléfono; la fila compartida no.

**Prueba manual (Nico, 15 min).** Con un teléfono con **1.1.21** y con la web nueva, con una
cuenta propia y otra cuenta ajena:
- perfil propio;
- "Quiero jugar": abrir un partido publicado y pedir sumarse;
- un link de WhatsApp de invitación;
- votación por link sin sesión, eligiendo un nombre y subiendo una foto;
- un partido propio: código, plantel y armar equipos;
- Amigos.

Después, vigilar 24 h los errores de PostgREST y de Postgres en el panel.

## 8. Matriz de compatibilidad

Fuentes: replays de las 32 + 84 formas de lectura de la 1.1.21 y de sus escrituras con
`RETURNING` (lab, 353/353), Jest 3552/3552 y el dry run.

| Cliente | Con sesión | Sin sesión |
|---|---|---|
| **1.1.21 Android/iOS** (tiendas) | **Funciona sin errores nuevos en lo propio.**<br>- perfil propio: teléfono y nacimiento aparecen vacíos (no se borran; un guardado en blanco los conserva);<br>- no ve teléfonos ajenos;<br>- distancias con la ubicación aproximada;<br>- sus partidos y planteles, completos;<br>- **partido publicado ajeno** (140000): lo abre por `partidos_view` con el plantel **vacío** y cupo 0. Pedir sumarse crea una solicitud pendiente (una sola; un segundo toque se reabre por RPC) y el organizador la aprueba con el cupo verificado en el servidor;<br>- sumarse por invitación de la app o por el link de invitación de WhatsApp (código + token, que valida al abrirlo) sigue funcionando. Un link viejo con sólo el código ya no deja sumarse con cuenta;<br>- **invitado o con solicitud pendiente, todavía fuera del plantel** (143000): ve el partido, pero el plantel desde la tabla vacío hasta sumarse (en la vista y por RPC, enmascarado);<br>- no recibe en tiempo real los cambios de un partido publicado ajeno. | Desde 125000 una página pública abierta sin sesión dentro de la app vieja no carga el partido. Los links de WhatsApp abren en el navegador, o sea en la web. |
| **Web publicada hoy (`main`)** | No se probó pantalla por pantalla: va reemplazada antes (§2). Lo que lea de la tabla sobre un partido ajeno publicado vuelve vacío. | **Se rompe:** votación e invitación por link no cargan el partido. Por eso la web nueva va antes. |
| **Web nueva (#193 + #187)** | Funciona con y sin migraciones: perfil por `get_my_profile`, borrar campos con `clear_my_profile_fields`, teléfono de contacto por RPC, partidos publicados por la vista, plantel publicado por `get_public_match_roster` (nombres, fotos, cupo; sin `usuario_id`/`score`). | Votación e invitación por código (`public_get_match_by_code`, plantel sin `usuario_id`/`score`; los invitados se reconocen por `has_account`). Foto de invitado: el primero que toma un nombre es dueño de su foto. |
| **Build nativa nueva (pendiente)** | Igual que la web nueva; además recupera ver y borrar teléfono y nacimiento propios. | — |

## 9. Rollback por paso

Los rollbacks de 133000–146000, de 119000 y de 118000 son archivos probados sobre el esquema real con datos
(§11). Se aplican en orden inverso.

Hechos 146→133, el catálogo y los datos vuelven exactamente al estado previo a 133000, salvo lo
que se conserva a propósito para no perder datos:
- las tablas `app_private.usuarios_private`, `jugadores_added_by` y `match_link_access`;
- los dos índices de 136000.

Se quitan con `rollbacks/cleanup-after-verified-rollback.sql` una vez verificado el rollback.
Con eso, el catálogo es idéntico.

119000 va **último**, después de deshacer 120000–132000 (SQL en
[`PROMOTION.md` §5](PROMOTION.md)). Vuelve a dejar Producción con sus policies abiertas tal como
estaban; el catálogo queda idéntico al original.

Cada rollback borra su fila del ledger, así que `apply-193.psql` puede volver a aplicarlo.
Comando, con `<archivo>` reemplazado:

```bash
/opt/homebrew/opt/libpq/bin/psql "$CORE_CONNINFO" --password -X -1 -v ON_ERROR_STOP=1 -f docs/database/core-review/runbook/rollbacks/<archivo>
```

| Paso | Archivo / acción | Datos perdidos | Efecto |
|---|---|---|---|
| 146000 | `20261010146000_core_open_definer_writers.rollback.sql` (primero) | ninguno | vuelven las 12 funciones exactamente como estaban (cuerpo, oid y ACL): cualquiera, anon incluido, puede volver a llamarlas. No toca `cancel_partido_with_notification` |
| 145000 | `20261010145000_core_match_notification_callers.rollback.sql` | ninguno | vuelven las funciones originales a `public` (mismo cuerpo y oid) con sus permisos exactos: cualquiera, anon incluido, vuelve a poder mandar avisos a cualquier plantel |
| 143000 | `20261010143000_core_roster_identity_roster_only.rollback.sql` | ninguno | quien pidió sumarse o recibió un aviso vuelve a ver el plantel completo; afuera y anon vuelven a recibir el `uuid` (id de cuenta) y `responsabilidad_score` |
| 142000 | `20261010142000_core_join_request_notifications.rollback.sql` | ninguno | vuelve el 23505 desde el segundo solicitante de un partido |
| 141000 | `20261010141000_core_organizer_approves_join_requests.rollback.sql` | ninguno | el ACL de `approve_join_request` vuelve exactamente al previo (Producción: también authenticated y anon) |
| 140000 | `20261010140000_core_published_roster_identity.rollback.sql` | ninguno (`match_link_access` queda) | vuelven `usuario_id`/`score` en planteles publicados y los atajos de escritura |
| 139000 | `20261010139000_core_roster_added_by_private.rollback.sql` | ninguno: los valores vuelven a la columna (la tabla privada queda) | quien lee una fila de plantel ve quién agregó a ese jugador |
| 138000 | `20261010138000_core_voting_photo_slot_owner.rollback.sql` | ninguno (los claims quedan) | cualquiera con el código vuelve a poder reemplazar fotos de invitados |
| 137000 | `20261010137000_core_match_code_never_public.rollback.sql` | ninguno | la tabla vuelve a dar partidos publicados con su código; `partidos_view` vuelve exactamente a su definición previa (guardada por la migración) |
| 136000 | `20261010136000_core_match_roster_visibility.rollback.sql` | ninguno | cualquier cuenta vuelve a listar todos los partidos y planteles |
| 135000 | `20261010135000_core_private_profile_fields.rollback.sql` | ninguno de las cuentas: vuelve a la fila el último valor de cada campo (la tabla privada queda) | vuelve la exposición de email, teléfono, nacimiento y ubicación exacta |
| 134000 | `20261010134000_core_partidos_template_link.rollback.sql` | los vínculos creados desde 134000 si la columna la creó la migración; en Producción la columna `uuid` y su FK existían y **quedan con sus datos** | sin regla del dueño de la plantilla |
| 133000 | `20261010133000_core_match_access_code.rollback.sql` | ninguno | las vistas vuelven a devolver `codigo` |
| (opcional) | `cleanup-after-verified-rollback.sql` | las copias privadas (los valores ya volvieron a las filas) | catálogo idéntico al previo |
| 132000 … 120000 | SQL en [`PROMOTION.md` §5](PROMOTION.md) | ver PROMOTION.md | ver PROMOTION.md |
| 119000 | `20261010119000_core_production_alignment.rollback.sql` (último) | ninguno (`admin_id` nunca se usa en Producción) | Producción vuelve a sus policies abiertas, exactamente como estaban. Si 120000…132000 siguen aplicadas, **conserva** lo que sus funciones usan (`partidos.admin_id`, `app_private.is_match_admin`, el USAGE de `app_private`, el log): sin eso `list_my_pending_survey_finalizations` fallaba con 42703 (gate B). Deshechas 120000…132000, correrlo otra vez deja el catálogo original |
| 118000 | `20261010118000_core_cancel_match_organizer_only.rollback.sql` (independiente, cuando se decida; ver [`CANCEL-URGENT.md`](CANCEL-URGENT.md)) | ninguno | cualquiera vuelve a poder cancelar cualquier partido |
| Todo | restaurar el backup de §3 | **todo lo escrito después del backup** | último recurso; requiere otro GO |

**Si algo falla durante §6:** la migración que falló no dejó nada. Copiar el error y no
reintentar a ciegas.

- Si es un lock (`lock_timeout`), esperar y volver a correr el mismo comando.
- Cualquier otro error: parar. Las migraciones anteriores son seguras de dejar: cada una se
  probó sola y en orden. Decidir con el error en la mano.

## 10. Quién hace qué

| Nico (Producción, con su contraseña) | Agente (sin acceso a Producción) |
|---|---|
| GO de cada etapa; merges; deploy de la web | preparar, probar y documentar |
| `backup-db` + `restore-check` (§3) | revisar el `REPORT`/manifiesto que Nico pegue (sólo conteos) |
| prechecks, aplicar, post-checks (§5–7); pegar las líneas JSON (no tienen datos personales ni códigos) | leer los resultados y decir GO/NO-GO para el paso siguiente |
| prueba manual (§7) y monitoreo de 24 h | preparar el rollback que corresponda si algo falla |

## 11. Ensayo sobre el esquema real de Producción (2026-10-09)

**Entorno:**
- copia del esquema **real** de Producción (`pg_dump --schema-only` del 2026-10-09, cargado con
  `~/Arma2Backups/d3-prod-schema-lab.sh`): contenedor sin red, base de `postgres` como en
  Supabase, ledger de Producción;
- semilla sintética con su forma: `integration/prod-schema/seed.sql`, 1.200 cuentas (364 con
  teléfono), 40 plantillas `uuid`, 400 partidos (40 desde plantilla), 4.000 filas de plantel,
  solicitudes y votantes;
- herramienta: `node integration/prod-schema/rehearse.mjs A|B|C`. Cada pasada usa un contenedor
  nuevo, que se borra al terminar.

**A — por migración:**
- precheck en `true`;
- 28/28 aplicadas como `postgres` (1,09 s en total);
- postcheck en `true`;
- humo `integration/prod-schema/smoke.sql`: **74/74**;
- rollbacks 146→133: estado idéntico al previo a 133000 (policies, funciones, triggers, vistas,
  ACLs, digests de datos). Con la limpieza opcional, **catálogo completo idéntico**;
- reaplicación y postcheck en `true`; sin reinicio del servidor.

**B — archivos exactos de este runbook:**
- precheck en `true`;
- `apply-193.psql`: 28 aplicadas en 193 ms; postcheck en `true` (36/36, incluidos el digest de las policies intactas y una solicitud pendiente real de la semilla); humo 74/74;
- segunda corrida: 28 salteadas;
- rollbacks 146→133 con `-1`: ledger 14 (más 118000);
- reaplicación retomada: 13 aplicadas, 15 salteadas; postcheck en `true`.

**C — 119000 sola contra el original:** la migración cambia el catálogo; su rollback lo deja
**idéntico al original** (digest completo), con los datos iguales.

**D — recuperación que deja 120000…132000** (como la del gate B):
- se aplican las 28, se deshacen 146→133 con la limpieza, y después 119000;
- se llaman las 28 funciones de 120000…132000 (24 invocables) como una cuenta: ninguna falla por
  columna, función o tabla inexistente, y ningún cuerpo nombra una función de `app_private` que no exista;
- el rollback de 119000 conserva `partidos.admin_id` y `app_private.is_match_admin`, y correrlo
  otra vez no cambia nada;
- control negativo con el rollback anterior: `list_my_pending_survey_finalizations` → 42703
  (`match_row.admin_id`) e `is_match_admin` inexistente, lo mismo que vio el gate B.

**Policies (alcance de Nico del 2026-10-09):**
- se quitan 18 y se crean 7, todas listadas en [`POLICIES-REPLACED.md`](POLICIES-REPLACED.md);
- las otras 192 del esquema `public` no cambian;
- con las 28 aplicadas, los rollbacks 146→133 y luego 119000 dejan las policies de las 11 tablas
  involucradas idénticas a R0, campo por campo;
- las sentencias de rollback del documento, corridas a mano, dan el mismo resultado.

**Los 74 chequeos de humo** corren como anon y como cuentas concretas:
- campos privados, incluido el email que copia el trigger `auth.users → usuarios` de Producción;
- lecturas de ajeno, miembro, organizador y anon (tabla, `partidos_view` con su plantel
  embebido, "Quiero jugar", RPCs);
- crear partido propio o ajeno; plantilla propia o ajena;
- solicitudes: duplicada → 23505, aprobada → 42501, a privado → rechazada, **segundo
  solicitante OK** con un aviso por solicitud;
- sumarse sin invitación → rechazado; con invitación o link validado → OK;
- aprobación del organizador OK y de un miembro rechazada;
- la propia fila: actualizarla no da error inesperado y el puntaje no cambia (en Producción sólo el organizador actualiza filas de plantel: su policy `UPDATE` queda);
- anon: el link con código abre **sólo su** partido; voto de invitado por nombre; un código no
  vota en otro partido; nombre registrado rechazado; tablas de votación sin lectura ni escritura
  directa; helper de votantes cerrado;
- 143000: con `uuid` = id de cuenta en las filas registradas (como las escribe la app), ninguna
  entrada para un ajeno, para quien sólo pidió sumarse ni para anon trae un id de cuenta o
  `responsabilidad_score`; las claves opacas son distintas por fila; el miembro sigue viendo todo;
  un invitado no ve filas del plantel desde la tabla hasta sumarse, y después sí;
- 145000: anon no manda avisos ni llama `add_creator_to_match`; un ajeno no avisa a un partido
  que no le toca; quien pidió sumarse avisa al organizador pero no anuncia una cancelación; un
  jugador anuncia que entró; el organizador manda lo de siempre; `cancel_partido_with_notification`
  (SECURITY DEFINER) sigue avisando al plantel;
- 118000/146000: anon no llama ninguna de las 13 funciones; un ajeno no corre trabajos, ni manda
  avisos de expulsión, ni sincroniza partidos de equipos, ni arma planteles de desafío, ni cancela; el
  organizador manda el aviso de expulsión; los dueños de los dos equipos sincronizan su partido; el
  trigger del puente sigue funcionando; los trabajos corren como el dueño; `service_role` conserva
  EXECUTE. Control negativo: sin 146000 fallan los dos chequeos de "no puede";
- el job de cierre de encuestas corre.

**Esquema del repositorio:** las 28 también se aplican (base limpia `main` + `20261009120000`, 2026-10-09), y el laboratorio Core reconstruido con
las 24 anteriores pasaba **366/366**.

**Antes de este ensayo**, el dry run del 2026-10-08 sobre el esquema del repositorio había
encontrado y corregido en 137000 dos defectos:
- un `grant … to current_user` que tiraba el servidor;
- un `ALTER VIEW … OWNER` que exigía `CREATE`.
