# Runbook de publicación — #193 (privacidad Core) sobre Producción

**Nada de esto se ejecutó en Producción.** Cada paso necesita el GO de Nico. Lo ejecuta Nico:
el agente no tiene acceso a Producción y la contraseña de la base sólo se tipea en la terminal.

Probado de punta a punta en un proyecto descartable (`arma2-dryrun`), aplicado como `postgres`
no superusuario, igual que en Supabase. La evidencia está en
[`runbook/evidence/dryrun-20261008.json`](runbook/evidence/dryrun-20261008.json); resumen en §11.

## 1. Qué se aplica

Producción tiene las 43 migraciones de `main` más `20261009120000_core_ops_log_retention`
(mantenimiento de capacidad del 2026-10-07). Encima van **19 migraciones, en este orden**:

| # | Migración | Qué cambia | Dry run |
|---|---|---|---|
| 1 | `20261010120000_core_trigger_helper_execute_grants` | grants de helpers de triggers | 69 ms |
| 2 | `20261010121000_core_public_voting_roster_identity` | votar por link sólo con un nombre del plantel | 68 ms |
| 3 | `20261010122000_core_notifications_ext_match_columns` | columnas `match_id_text`/`match_code` | 73 ms |
| 4 | `20261010123000_core_reset_votacion_score_default` | "Resetear votación" ya no aborta | 67 ms |
| 5 | `20261010124000_core_usuarios_profile_rpcs` | RPCs de perfil | 70 ms |
| 6 | `20261010125000_core_public_match_reads_by_code` | sin sesión: un partido sólo por su código | 69 ms |
| 7 | `20261010126000_core_team_roster_identity` | plantel de equipos sin partido | 72 ms |
| 8 | `20261010127000_core_post_match_surveys_result_columns` | `ganador`/`resultado` en encuestas | 67 ms |
| 9 | `20261010128000_core_contact_phone_and_public_profile_list` | teléfono de contacto por RPC, perfil público explícito | 65 ms |
| 10 | `20261010129000_core_survey_finalization_recovery` | encuestas vencidas del organizador | 72 ms |
| 11 | `20261010130000_core_client_build_reports` | `report_client_build` + `privacy_phase_b_readiness` | 69 ms |
| 12 | `20261010131000_core_survey_server_finalization` | cierre de encuestas desde el servidor (pg_cron, 5 min) | 75 ms |
| 13 | `20261010132000_core_friend_request_acceptance` | sólo el destinatario acepta | 69 ms |
| 14 | `20261010133000_core_match_access_code` | vistas: código sólo para admin y plantel | 70 ms |
| 15 | `20261010134000_core_partidos_template_link` | `partidos.template_id` (historial de frecuentes) | 77 ms |
| 16 | `20261010135000_core_private_profile_fields` | email, teléfono, nacimiento y ubicación exacta fuera de la fila compartida | 96 ms |
| 17 | `20261010136000_core_match_roster_visibility` | partido y plantel sólo para quien participa (+ publicados) | 73 ms |
| 18 | `20261010137000_core_match_code_never_public` | el código no llega a nadie ajeno: la tabla sólo devuelve partidos propios; los publicados se ven por las vistas, con el código oculto | 77 ms |
| 19 | `20261010138000_core_voting_photo_slot_owner` | la foto de un invitado sólo la cambia quien vota como él | 67 ms |

Tiempos del dry run con ~1.200 cuentas, 400 partidos y 4.000 filas de plantel. Ninguna
migración usa `CONCURRENTLY` ni abre su propia transacción.

**Con #182:** sus migraciones de Core (`20261006…`, `20261007…`, `20261008…`) tocan otros
objetos: Torneos, el contrato Core→Torneos (lee el email de `auth.users`, no de `usuarios`) y la
preferencia de push (`usuarios.push_enabled`, que 135000 no toca). Pueden ir antes o después.
Este runbook cubre #193 solo.

## 2. Antes del día (con GO)

1. **Merges, en orden:** #183 → #186 → #187 → #193, con el CI de calidad verde en cada uno.
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
#193, con `/opt/homebrew/opt/libpq/bin/psql`.

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
| ledger: está `20261009120000` y ninguna `20261010…` | `true` |
| `postgres` es dueño de tablas y vistas afectadas | `true` |
| vistas con `security_invoker=on` | `true` |
| no existe nada del stack (tabla privada, rol lector, `template_id`) | `true`; si `template_id` existe con otro tipo, parar y revisar |
| pg_cron disponible | `true` |
| sin transacciones largas | `true` |
| ninguna cuenta con una sola coordenada | `true`; si no es 0, esas coordenadas sueltas no se conservan (una ubicación es el par) |
| informativo: teléfonos de `profiles` distintos del de la cuenta | anotar; esa copia queda sólo en el backup |
| línea base de valores privados | anotar `with_email`, `with_phone`, `with_birth_date`, `with_location` |

## 6. Aplicar

```bash
/opt/homebrew/opt/libpq/bin/psql "$CORE_CONNINFO" --password -X -f docs/database/core-review/runbook/apply-193.psql
```

- Aplica las 19 migraciones en orden. Cada una va en su propia transacción, junto con su fila
  en `supabase_migrations.schema_migrations`.
- Se esperan 19 líneas `>>> 2026101012xxxx …` y al final `>>> done`.
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

- **Ledger:** las 19 migraciones están registradas.
- **135000:**
  - cero email, teléfono o nacimiento en las filas compartidas;
  - una fila privada por cuenta;
  - `with_*` iguales a la línea base del precheck;
  - coordenadas compartidas a 2 decimales.
- **Policies:** sin cláusula de "publicado" en `partidos` y sin `USING (true)` en `jugadores`.
- **Vistas:**
  - dueño `core_match_public_reader`, que no puede loguearse, no saltea RLS y no crea objetos;
  - ninguna cuenta puede escribir a través de `partidos_view`.
- **Grants:** RPCs del perfil propio sólo para cuentas; el binding de fotos sólo para el servidor.
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
| **1.1.21 Android/iOS** (tiendas) | **Funciona sin errores nuevos.**<br>- perfil propio: teléfono y nacimiento aparecen vacíos (no se borran; un guardado en blanco los conserva);<br>- no ve teléfonos ajenos;<br>- distancias con la ubicación aproximada;<br>- abre partidos publicados por `partidos_view` (ya trae `busca_arquero`, `player_invites_enabled` y el precio), con plantel;<br>- no ve el código de partidos ajenos;<br>- no recibe en tiempo real los cambios de un partido publicado ajeno (sí de los propios). | Desde 125000 una página pública abierta sin sesión dentro de la app vieja no carga el partido. Los links de WhatsApp abren en el navegador, o sea en la web. |
| **Web publicada hoy (`main`)** | No se probó pantalla por pantalla: va reemplazada antes (§2). Lo que lea de la tabla sobre un partido ajeno publicado vuelve vacío. | **Se rompe:** votación e invitación por link no cargan el partido. Por eso la web nueva va antes. |
| **Web nueva (#193 + #187)** | Funciona con y sin migraciones: perfil por `get_my_profile`, borrar campos con `clear_my_profile_fields`, teléfono de contacto por RPC, partidos publicados por la vista. | Votación e invitación por código (`public_get_match_by_code`). Foto de invitado: el primero que toma un nombre es dueño de su foto. |
| **Build nativa nueva (pendiente)** | Igual que la web nueva; además recupera ver y borrar teléfono y nacimiento propios. | — |

## 9. Rollback por paso

Los rollbacks de 135000–138000 son archivos probados en el dry run. Aplicados en orden inverso,
devuelven exactamente el estado previo a 135000; la única diferencia esperada es la de
`partidos_view` (ver la fila de 137000). Cada rollback borra su fila del ledger, así que
`apply-193.psql` puede volver a aplicarlo. Comando, con `<archivo>` reemplazado:

```bash
/opt/homebrew/opt/libpq/bin/psql "$CORE_CONNINFO" --password -X -1 -v ON_ERROR_STOP=1 -f docs/database/core-review/runbook/rollbacks/<archivo>
```

| Paso | Archivo / acción | Datos perdidos | Tiempo | Efecto |
|---|---|---|---|---|
| 138000 | `20261010138000_core_voting_photo_slot_owner.rollback.sql` | ninguno (los claims quedan) | < 1 s | cualquiera con el código vuelve a poder reemplazar fotos de invitados |
| 137000 | `20261010137000_core_match_code_never_public.rollback.sql` | ninguno | < 1 s | cualquier cuenta vuelve a leer de la tabla el código de los partidos publicados. `partidos_view` conserva sus 3 columnas nuevas, porque `CREATE OR REPLACE` no puede quitarlas y a ningún cliente le molestan |
| 136000 | `20261010136000_core_match_roster_visibility.rollback.sql` (después del de 137000) | ninguno | < 1 s | cualquier cuenta vuelve a listar todos los partidos, códigos y planteles |
| 135000 | `20261010135000_core_private_profile_fields.rollback.sql` (después de 137000 y 136000) | ninguno de las cuentas: vuelve a la fila el último valor de cada campo, incluidos los cambios posteriores; lo que el dueño borró sigue vacío. La única excepción es una copia de teléfono en `profiles` distinta de la de la cuenta, que queda sólo en el backup (el precheck las cuenta). La tabla privada queda | < 1 s | vuelve la exposición de email, teléfono, nacimiento y ubicación exacta |
| 134000 … 120000 | SQL en [`PROMOTION.md` §5](PROMOTION.md) | 134000: los vínculos plantilla → partido creados desde entonces; el resto, ninguno | < 1 s c/u | ver PROMOTION.md |
| Todo | restaurar el backup de §3 | **todo lo escrito después del backup** | minutos | último recurso; requiere otro GO |

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

## 11. Dry run (2026-10-08)

**Entorno:**
- proyecto descartable `arma2-dryrun`: `supabase/postgres 17.6.1.143`, GoTrue y storage-api
  reales, sin puertos publicados, destruido al terminar;
- línea base: `main` (43 migraciones) + `20261009120000`;
- semilla sintética: 1.203 cuentas, 403 partidos, 4.009 filas de plantel y un slot de foto
  compartido por dos sesiones.

**Resultados:**
- **Backup:** `pg_dump` en 0,3 s (4 MB). Restauración en otra base: todas las tablas y el digest
  de datos privados idénticos. Los 20 errores son de `pg_cron`, que sólo vive en la base
  `postgres`. En Producción la prueba estricta es `restore-check`.
- **Prechecks:** todos `true`.
- **Aplicación:** 19/19 como `postgres`, una transacción cada una, 1,4 s en total, sin reinicio
  del servidor.
- **Post-checks:** todos `true`. Valores privados movidos: 1.203 emails, 361 teléfonos,
  227 nacimientos y 478 ubicaciones, igual que la línea base.
- **Rollbacks y reaplicación:**
  - 138→135 aplicados: el estado es idéntico al previo a 135000 (policies, funciones, triggers,
    vistas, digest de `usuarios`/`profiles`, ledger), salvo las 3 columnas esperadas de
    `partidos_view`;
  - reaplicación 135→138 y post-checks de nuevo: todos `true`.
- **Con los archivos exactos de este runbook** (`apply-193.psql`, `rollbacks/*` con `-1`):
  - aplicación;
  - segunda corrida idempotente (19 salteadas);
  - rollbacks (ledger 15);
  - reaplicación retomada (4 aplicadas, 15 salteadas);
  - post-checks en `true`, sin reinicio.

**Lo que el dry run encontró y ya está corregido en 137000:**
- `grant core_match_public_reader to current_user` **tiraba el proceso del servidor**
  (signal 11) al correrlo como `postgres`, y se reiniciaban todas las conexiones. Ahora se otorga
  por nombre.
- `ALTER VIEW … OWNER TO` exige que el nuevo dueño tenga `CREATE` en `public`; un superusuario
  saltea ese chequeo. Ahora se otorga sólo durante esas tres sentencias y se revoca.

**Fuera del dry run:** el volumen real de Producción. Prod tiene un tamaño similar al del
ensayo (~1.1k cuentas), así que los tiempos deberían ser del mismo orden.
