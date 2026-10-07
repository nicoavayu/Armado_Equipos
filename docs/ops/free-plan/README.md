# Arma2 en el plan Free de Supabase — capacidad, backups y herramientas

**Estado (2026-10-07): diagnóstico hecho con lecturas, remediación y backups preparados y ensayados en laboratorio.
Nada se ejecutó en Production.** Decisión vigente: no contratar Pro, PITR ni adicionales. Este documento reformula la
promoción web de Torneos conectado para que funcione dentro de los límites de Free
(`docs/torneos/connected-product/DEPLOY.md`).

## 1. Qué limita Free, verificado

Fuente: documentación de Supabase ([Database size](https://supabase.com/docs/guides/platform/database-size),
[Billing FAQ](https://supabase.com/docs/guides/platform/billing-faq),
[Project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)).

| Límite | Regla | Estado 2026-10-07 (panel + SQL de sólo lectura) |
| --- | --- | --- |
| Base por proyecto | Más de 500 MB ⇒ el proyecto pasa a **sólo lectura** (`25006`). Vuelve solo cuando baja | **Core 505,45 MB**, insignia «Exceeding usage limits». Todavía no está en sólo lectura (`default_transaction_read_only = off`) |
| Base de la organización | La suma de los proyectos se compara con la cuota. Pasado un período de gracia, *Fair Use*: **todas las API responden 402** en todos los proyectos | **0,53 / 0,5 GB (106 %)**, banner «You have exceeded your Free Plan quota». Torneos (36,92 MB) suma acá |
| Disco | 1 GB por proyecto; al 95 % ⇒ sólo lectura | Por eso una limpieza no puede generar mucho WAL (§4) |
| Proyectos | 2 activos en total; los pausados no cuentan | Activos: Core y Torneos. **`arma2-torneos-staging` y «Arma2» están pausados** |
| Pausa por inactividad | Sin suficientes consultas a la base en una semana ⇒ pausa | Core tiene uso diario. Torneos depende de su tráfico (§7) |
| Backups / PITR | No incluidos | Reemplazo: §5 |
| Storage / egress / funciones / MAU | 1 GB / 5 GB / 500.000 / 50.000 | 0,33 GB / 0,08 GB / 5.863 / 11: sin presión |

**Conclusión.** Ninguna limitación impide publicar en Free. Sí hay un riesgo **actual y ajeno a Torneos**: Core ya
supera los 500 MB. Puede quedar en sólo lectura en cualquier momento, y la organización puede recibir el 402. Eso afecta
a toda Arma2. Se resuelve sin pagar y sin borrar datos de producto, porque el 85 % de lo que ocupa Core son logs y
bloat (§2). Por eso la remediación va **antes** de cualquier paso de la promoción.

## 2. Qué ocupa Core y por qué crece

Lecturas de `pg_database_size` y del catálogo, 2026-10-07. El script es `supabase/ops/free-plan-capacity/inspect*.sql`.

| Origen | Tamaño | Qué es |
| --- | --- | --- |
| `cron.job_run_details` | **277 MB** | Historial de pg_cron: 1.143.332 corridas desde 2025-10-08. Nadie lo borra nunca. Son 8 jobs, 3 de ellos cada minuto: unas 5.300 filas por día |
| `public.push_sender_scheduler_runs` | **107 MB** | Una fila por tick del despachador de push desde 2026-03-13 (296.343 filas). El 97,7 % dice «skipped_no_work». Sin retención |
| `public.notification_delivery_log` | **67 MB** | 16 filas vivas y 67 MB de índices. La retención diaria borra filas, pero los índices no devuelven las páginas |
| Resto de `public` (datos de producto) | ~23 MB | 1,5 MB `jugadores`, 1,2 MB `notifications`, el resto chico |
| Catálogo y `auth` | 24 + 14 MB | `auth.audit_log_entries` ocupa 10 MB (lo gestiona Auth) |

- **Crecimiento:** unos 1,8 MB por día (~54 MB por mes) sólo en los dos logs, más el bloat de índices que se
  acumula.
- **Hallazgo aparte:** Production tiene en `notification_delivery_log` índices que la baseline canónica no tiene
  (`unique_delivery_per_correlation`, cuatro `idx_delivery_log_*`). Es drift de esquema; el reindex no lo toca.

**Torneos:**
- 22 MiB en la base `postgres` (el panel muestra 36,9 MB porque cuenta todo el clúster);
- 15 MB son catálogo y 6 MB `public`;
- sin pg_cron y sin objetos de Storage.

## 3. Cuánto agregan la promoción y el uso inicial

**Core:**
- Las migraciones `20261007`, `20261008` y `20261009` sólo cambian catálogo: +0,1 MB medidos en la copia de
  laboratorio.
- Los registros del contrato con Torneos se borran solos: los nonces a los 61 s y los eventos de rate a los 2 minutos.
- El uso de Torneos no hace crecer Core.

**Torneos:**
- `0009`–`0011` agregan unos 0,3 MB: 35 funciones (56 KB de catálogo), 11 índices vacíos y 5 tablas.
- Uso medido por fila: aviso 0,6 KB, inscripción 1,2 KB, jugador de plantel 0,8 KB, revisión 0,6 KB.
- Una solicitud con 10 jugadores y sus avisos ocupa unos 13 KB, así que 1.000 solicitudes son unos 13 MB.
- Los logos van a Storage: cuota de 1 GB y como máximo 2 MB por archivo, por la regla del bucket.

**Después de la remediación:** Core queda en unos 77 MB y la organización en unos 114 MB de 500 (23 %). Con la retención
activa, Core deja de crecer por logs.

## 4. Remediación de capacidad — alcance para aprobar (nada ejecutado)

Orden: **R0 → R1 → R2 → R3**. Todos los pasos se ejecutan con
`python3 scripts/ops/free-plan/core_apply.py apply <paso> --phrase "<frase>"`, desde Terminal, con la contraseña de la
base escrita en el prompt.

Medidas del ensayo:
- **Herramienta:** `supabase/ops/free-plan-capacity/lab-rehearsal.sh`, con la misma imagen y sin red.
- **Volúmenes:** los de Production (1,14 M corridas, 296 k ticks, índices inflados).
- **Carga:** pg_cron escribiendo cada segundo durante todo el ensayo.
- **Evidencia:** `supabase/ops/free-plan-capacity/evidence/lab-rehearsal-20261007.json`.

| Paso | Qué hace | Qué borra | Duración y pausa medidas | WAL | Espacio |
| --- | --- | --- | --- | --- | --- |
| **R0** | Backup de Core + `restore-check` (§5) | Nada (sólo lectura) | Minutos | — | — |
| **R1** `reindex` | `REINDEX TABLE CONCURRENTLY` de `notification_delivery_log` | Nada | 0,23 s; lecturas y escrituras siguen | 0,2 MB | −67 MB |
| **R2** `migration-20261009120000` | `run_ops_log_retention()` diaria (03:41 UTC): borra lo de más de 7 días de los dos logs, **como máximo 20.000 filas por tabla y corrida**. Reindex mensual del log de entregas | Logs de más de 7 días, de a poco | Primera corrida sobre todo el atraso: 1,06 s | 11,4 MB | No devuelve espacio por sí sola |
| **R3** `compact` | Guarda los últimos 7 días, `TRUNCATE` y los vuelve a insertar. Exige el backup de R0 verificado y de menos de 24 h | ~1,1 M filas de historial de cron y ~286 k ticks. Quedan en el backup de R0 | 0,9–1,6 s; los escritores esperan ≤ 0,6 s | 11 MB | −370 MB |

Por qué así:
- Un `DELETE` de 1,4 millones de filas escribiría cientos de MB de WAL en un disco de 1 GB y podría dejar el proyecto en
  sólo lectura. `TRUNCATE` libera el espacio en el acto y apenas escribe WAL.
- El tope de R2 hace que el orden entre R2 y R3 no importe. El ensayo lo probó con R2 aplicado antes de R3.

Contención y vuelta atrás:
- **R1:** no hace falta; el índice nuevo es equivalente.
- **R2:** `cron.unschedule('ops_log_retention_scheduler')` y `cron.unschedule('ops_delivery_log_reindex')`. La función
  sin job no hace nada.
- **R3:** las filas se recuperan del backup de R0 con
  `pg_restore --data-only -t job_run_details -n cron` (y lo mismo para `push_sender_scheduler_runs`). Son logs; no hace
  falta salvo para una auditoría.

**No incluido** (cada uno requeriría su propio pedido):
- borrar los índices duplicados (drift);
- dejar de registrar los ticks «skipped_no_work», que es un cambio de código de Core;
- tocar `auth.audit_log_entries`.

## 5. Backups manuales (reemplazan los del plan pago)

Herramienta: `scripts/ops/free-plan/ops_free_plan.py`. Production sólo se **lee**.

- La contraseña de la base la piden `psql`/`pg_dump` en el prompt. La passphrase del backup y la clave `service_role`
  las pide la herramienta en la terminal.
- Nada de eso queda en argv, en el entorno, en archivos ni en logs.
- Lo descifrado nunca toca el disco: la verificación descifra dentro de un contenedor descartable y los archivos de
  Storage pasan de la memoria al tar cifrado.

```bash
python3 scripts/ops/free-plan/ops_free_plan.py backup-db --target core --out ~/Arma2Backups/core-AAAAMMDD-HHMM
```

```bash
python3 scripts/ops/free-plan/ops_free_plan.py restore-check --backup ~/Arma2Backups/core-AAAAMMDD-HHMM
```

```bash
python3 scripts/ops/free-plan/ops_free_plan.py backup-db --target torneos --out ~/Arma2Backups/torneos-AAAAMMDD-HHMM
```

```bash
python3 scripts/ops/free-plan/ops_free_plan.py backup-storage --target core --out ~/Arma2Backups/core-storage-AAAAMMDD
```

```bash
python3 scripts/ops/free-plan/ops_free_plan.py storage-check --backup ~/Arma2Backups/core-storage-AAAAMMDD
```

Qué contiene un backup de base:
- `database.dump.gpg`: `pg_dump` en formato custom de toda la base que `postgres` puede leer (también `auth`, `storage`,
  los jobs y el historial de `cron`, y el ledger), cifrado con gpg AES256.
- `MANIFEST.json`, tomado en **el mismo snapshot** que el dump:
  - filas y hash de cada tabla (sólo el conteo por encima de 300.000 filas);
  - huellas de funciones, permisos efectivos, políticas y triggers;
  - sha256 del archivo en claro y del cifrado.
- `roles.sql`: los roles propios del proyecto, **sin contraseñas**.

`restore-check`:
1. Descifra el dump dentro de un Postgres de Supabase descartable, sin red.
2. Lo restaura en una base vacía, con los jobs de pg_cron apagados.
3. Recalcula el manifest y compara.
4. Escribe `RESTORE-CHECK-*.json`, con veredicto `RESTORE VERIFIED` o `RESTORE MISMATCH`.

**Verificado en laboratorio** (`scripts/ops/free-plan/evidence/lab-20261007.json`):

| Prueba | Resultado |
| --- | --- |
| Core del laboratorio (Auth, Storage, RLS, pg_cron escribiendo durante el dump) | `RESTORE VERIFIED`: 184 tablas, 22.993 filas, 0 diferencias, 0 errores de `pg_restore` |
| Torneos del laboratorio (roles propios `torneos_*`) | `RESTORE VERIFIED`: 130 tablas, 36.969 filas, 0 diferencias, 0 errores |
| Storage (bucket privado de logos) | 9/9 archivos verificados. Restaurados a un bucket temporal: 9 subidos y releídos. Repetido sobre el bucket original: 0 subidos, 9 ya existentes (no pisa nada) |
| Pruebas negativas | Passphrase equivocada ⇒ `STOP`. Manifest alterado en una fila ⇒ `RESTORE MISMATCH` |

**Recomendaciones:**
- **Cuándo:**
  - backup de base antes de cada gate que escriba en Production (obligatorio para R3 y G4) y una vez por semana;
  - backup de Storage una vez por mes y antes de cambios en buckets, porque cada uno consume unos 0,33 GB de egress de
    los 5 GB del mes.
- **Retención:** los últimos 4 semanales más los de cada gate.
- **Dónde guardarlos:**
  - en `~/Arma2Backups` (FileVault activo) o en un disco externo cifrado;
  - nunca dentro del repo: la herramienta lo rechaza.
- **Passphrase:** en el gestor de contraseñas. Sin ella no se restaura.

**Límites conocidos (no probados de punta a punta):**
- **Restaurar en un proyecto Supabase nuevo** requiere un tercer proyecto, que Free no permite sin pausar otro. El
  procedimiento previsto es restaurar por tabla en el mismo proyecto (`pg_restore -L` / `-t`). Lo probado es la
  integridad completa en una base vacía.
- Los roles con login vuelven **sin contraseña**: hay que asignarlas de nuevo.
- Lo que haya en `vault` está cifrado con la clave del proyecto y sólo se descifra en el mismo proyecto.
- `storage-restore` en Production requiere la frase `RESTORE STORAGE <ref> <sha12>`, sube sólo lo que falta y nunca pisa.

## 6. INFRA-1.2 — escrituras de Core en Production

Herramienta: `scripts/ops/free-plan/core_apply.py`.
- Un paso por vez, con la frase exacta `APPLY CORE <paso> <ref> <sha12>`.
- Cada archivo va fijado por sha256.
- Antes de cada paso controla el estado del ledger; después, el resultado.
- Cada migración queda registrada en `supabase_migrations.schema_migrations`.

`python3 scripts/ops/free-plan/core_apply.py plan` imprime los pasos con sus frases.

**Función `torneos-core-contract`:**
- Staging está pausado y en Free no puede volver sin pausar Production. Por eso:
  - el artefacto se certifica en el laboratorio local (mismo edge-runtime; ensayo de la promoción S2/S5: `/v1/my-teams`
    sin firma ⇒ 401, `connected.test` 8/8 a través de la función);
  - y se despliega con `function-deploy`, fijado a los bytes de un commit de git (nunca del árbol de trabajo).
- Después del deploy el script registra versión y `ezbr`, prueba la ruta sin firma y espera `verify_jwt = false`. El
  harness firmado lo corre el operador con el secreto del contrato.
- **Rollback:** `function-deploy --from-ref ffaf131c`. Esos bytes son exactamente los certificados por INFRA-1; lo
  comprueba un test.

**Estado de Production leído el 2026-10-07 (precondiciones):**
- Ledger: 238 filas; las últimas son `20260914120000` y `20260915120000`.
- `push_enabled` existe y **0 cuentas** lo tienen apagado: `20261008` no cambia la experiencia de nadie hoy.
- Ningún objeto de `20261007`/`20261008`/`20261009` existe todavía.
- `postgres` es dueño de la base y del ledger y tiene CREATE en `public`.
- Torneos: el catálogo del driver `db-0009-0011` clasifica **POST_0008** sin fallas (172/12, cuerpos certificados de
  búsqueda y autorizador, sin objetos conectados ni de branding).

**Ensayo en una copia descartable de Core** (con el ledger equivalente a Production):
- **Rechazos:** frase equivocada, migración ya aplicada y `compact` sin backup verificado.
- **DONE con poschequeos y ledger:** `reindex`, `migration-20261009120000`, `compact` (con un backup verificado en el
  momento), `migration-20261007120000`, `migration-20261008120000` y `rollback-push-preference`.

Pruebas offline: `npm run test:ops:free-plan` (en `test:ci`).

## 7. Otros límites de Free que tocan a Torneos

- **Pausa por inactividad del proyecto Torneos.**
  - Si una semana no hay consultas suficientes, Supabase lo pausa y Torneos deja de responder.
  - Propuesta, sin crear (requiere GO porque es un job que toca Production todos los días): un workflow programado de
    GitHub Actions que una vez por día haga una lectura pública del catálogo a través del gateway. Costo $0.
  - Mientras no exista: revisar el estado del proyecto en el panel una vez por semana.
- **No hay tercer proyecto:** Staging de Core/Torneos queda pausado. Las certificaciones se hacen en el laboratorio local.
- **Egress:** las imágenes firmadas de logos y los backups de Storage consumen egress. Hoy se usa el 2 %.

## 8. Mantenimiento de capacidad autorizado (GO del 2026-10-07, sólo R0 → R3)

GO de Nico limitado a este mantenimiento:
- **Incluido:** backup y verificación (R0), reindex (R1), migración `20261009120000` (R2) y compactación de los dos logs
  con 7 días de historial (R3).
- **Excluido:** la promoción de Torneos, `20261007`/`20261008`, deploys, flags, planes pagos, keep-alive, borrar
  archivos, usuarios o información deportiva, y envíos reales.

Todo lo ejecuta un único script, que se frena en la primera falla:
`scripts/ops/free-plan/core-capacity-maintenance.sh`.

**Por qué lo corre Nico:** cada paso necesita la contraseña de la base de Core, escrita en una terminal real. El
agente no la tiene y no debe sortear ese mecanismo (ni con el editor SQL del panel, ni con el Keychain, ni de otra
forma).

**Ensayo general** del mismo script en una copia de Core con los volúmenes de Production y pg_cron activo
(`scripts/ops/free-plan/evidence/maintenance-dress-rehearsal-20261007.json`):

| Paso | Resultado | Salud a los 75 s |
| --- | --- | --- |
| R0 | Backup de 1.462.676 filas; `RESTORE VERIFIED` con 0 diferencias | — |
| R1 | 350,3 → 304,2 MB | Escribe; cron con 0 fallas; tick de push escribiendo |
| R2 | Jobs 8 → 10 | Igual |
| R3 | 304,2 → **35,2 MB**; 1.124.780 corridas de cron y 286.578 ticks retirados (el backup conserva todo) | Igual |

**Línea base de Production (lectura del 2026-10-07):**
- 515,04 MB y no está en sólo lectura;
- últimas 24 h: 5.329 corridas de cron, 0 fallidas, y 1.440 ticks;
- `notification_delivery_log`: 16 filas y 67 MB de índices;
- 8 jobs activos;
- extensiones `btree_gist`, `pg_cron`, `pg_net`, `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault` y
  `uuid-ossp`, todas disponibles en la imagen de verificación;
- tablas de configuración que entran al dump: `vault.secrets` (3), `cron.job` (8) y `cron.job_run_details`
  (1.143.641).

### Qué hacer (Terminal.app, una sola vez)

Antes de empezar:
1. Docker Desktop abierto.
2. Unos 2 GB libres.
3. La contraseña de la base de Core a mano. Si no la tenés, **no la resetees**: avisá. Resetearla es un cambio de
   Production que este GO no cubre.
4. Una passphrase nueva de al menos 12 caracteres, guardada **antes** en el gestor de contraseñas. Sin ella el backup
   no se puede restaurar.

```bash
cd /Users/nicoavayu/Downloads/arma2/arma2/.claude/worktrees/torneos-connected-product-c3f3a0
```

```bash
bash scripts/ops/free-plan/core-capacity-maintenance.sh ~/Arma2Backups
```

Lo que va a pedir, en orden:
1. `MANTENIMIENTO CORE` (escrito tal cual).
2. La passphrase, dos veces.
3. `Password for user postgres.rcyuuoaqfwcembdajcss` (psql) y después `Password:` (pg_dump): la de la base, dos veces.
4. La passphrase otra vez (verificación de la restauración).
5. La contraseña de la base una vez por cada paso: R1, R2 y R3.

**Duración:** entre 15 y 30 minutos. Cada paso espera 75 s y controla que Core siga escribiendo.

**Al terminar** muestra `MANTENIMIENTO COMPLETO` y la ruta de `REPORT.json`, dentro de
`~/Arma2Backups/core-maintenance-<fecha>/`. Esa carpeta es el backup y se conserva: contiene el historial completo
anterior a la limpieza.

**Si aparece `STOP en …`:**
- No se ejecutó nada posterior.
- `STOP en R0`: ninguna escritura ocurrió.
- `STOP en reindex`, `migration-…` o `compact`: el paso indicado corrió pero su control posterior falló. No se sigue y
  hay que avisar.

**Después:** avisar «listo». El agente lee `REPORT.json` en esta misma Mac. Además, en el panel:
- mira el tamaño de Core y de la organización (se actualiza dentro de una hora);
- revisa los logs de Postgres de la ventana del mantenimiento, por errores nuevos;
- confirma los 10 jobs y sus corridas, e informa.
