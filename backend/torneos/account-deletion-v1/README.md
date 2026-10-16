# ACCOUNT-DELETION-V1: el borrado de cuenta llega a Torneos

Diseño, decisiones y matriz por tabla: [`docs/superpowers/specs/2026-10-15-torneos-account-deletion-design.md`](../../../docs/superpowers/specs/2026-10-15-torneos-account-deletion-design.md).

**Estado:** preparado y ensayado en laboratorio local con datos ficticios. Nada se aplicó en Producción ni en Staging, nada se desplegó y no hay credenciales creadas.

## Piezas

| Pieza | Archivo | Qué hace |
|---|---|---|
| Migración Torneos 0021 | `backend/torneos/supabase/migrations/00000000000021_account_erasure.sql` | Crea dos funciones SECURITY DEFINER: `private.erase_tournament_account(core_user_id, request_id)` y `private.confirm_tournament_account_erasure(core_user_id, request_id)`. Las dos son sólo para el rol nuevo **`torneos_erasure_writer`** (NOLOGIN, NOINHERIT, sin ningún otro privilegio). También crea `private.account_erasure_label` y el registro `private.tournament_account_erasures`, con estados `torneos_erased` → `core_confirmed`. Borra en una transacción y es idempotente. Trata 0020 (sponsors) y 0022 (moderación) si existen. Suma la **tumba**: el trigger `torneos_identity_refuse_erased` rechaza con `TORNEOS_ACCOUNT_ERASED` toda identidad nueva para un Core user borrado, aunque su JWT siga valiendo. El `lock_timeout` de 5 s se fija **antes** de los locks advisory: el de la persona primero y después el global. |
| Rollback | `rollback/00000000000021_account_erasure.rollback.sql` | Quita lo que agregó 0021, incluido el rol. **No restaura datos anonimizados.** Si el registro tiene filas, exige `SET torneos.account_erasure_rollback_force = 'DISCARD ERASURE LEDGER'`. |
| Driver del operador | `remote/db-0021.mjs` (+ `remote/sql-catalog-0021.sql`, `remote/pin-0021.mjs`) | Modos `observe` / `apply-0021` / `rollback-0021`, con frase exacta, sha256 del archivo y estado previo y posterior pinneados (incluye **cada privilegio del rol de borrado, por nombre**). Verifica que no se movió nada más. Mismo transporte que `db-0017` / `db-0020`. **Preparado, no ejecutado.** |
| Login de borrado | `remote/erasure-login.mjs` | Nombres (login, variable, secreto de Secret Manager) y el único SQL que el operador manda: alta, rotación y re-grant, con verificador SCRAM. |
| Reconciliación | `remote/reconcile-0021.sql` (sólo lectura), `remote/reconcile-complete-0021.sql` (escritura, con GO) | Lista los borrados que Core nunca confirmó y completa uno verificado. **Sin cron.** |
| Gateway | `backend/torneos/supabase/functions/torneos-gateway/account-erasure.ts` (+ `db.ts`, `index.ts`, `config.ts`, `topology.ts`) | Rutas `POST /core/v1/account-erasure` y `/core/v1/account-erasure/confirm`, firmadas por Core. Corren **sólo** con `TORNEOS_DB_ERASURE_WRITER_URL`; sin esa variable responden 503. No aceptan Origin, bearer ni CORS. |
| Core | `supabase/functions/_shared/torneosAccountErasure.ts`, `supabase/functions/delete-account/index.ts` | Torneos primero (fail-closed), después Core, después la confirmación. Clave de idempotencia derivada. Deja una costura para el paso de Storage. Configuración nueva: `TORNEOS_GATEWAY_URL`. |
| Web | `src/pages/AccountDeletionInfoPage.js`, `src/legal/AccountDeletionPanel.jsx`, `src/legal/accountDeletion.js`, textos de `ProfileEditor`, `PrivacyPage`, `TermsPage`, `ServiceCancellationPage`, `TorneosProfilePage` | Pedido por web (email `ELIM-…`) y botón con sesión. Los textos son fieles: no prometen atomicidad ni plazos fijos. |

## Credencial de borrado (`torneos_edge_erasure_writer`): alta, custodia y rotación

Sigue el mismo patrón que los dos logins actuales del gateway (`infra/torneos-gateway-auth`, W2+W3): la migración crea el rol sin login y el login se crea **fuera de banda**.

- **Quién la crea:** Nico (o quien opere con su GO), después de aplicar 0021 y antes de desplegar el gateway. Nunca un agente, nunca de forma automática.
- **Cómo:**
  1. En la máquina del operador, `newCredential()` de `remote/erasure-login.mjs` genera en memoria la contraseña (40 caracteres base64url) y su verificador SCRAM-SHA-256.
  2. `renderProvisionSql(verificador)` produce el SQL; se ejecuta como el instalador (`postgres`) por el transporte de los drivers (psql `verify-full`, SQL por stdin): `CREATE ROLE torneos_edge_erasure_writer LOGIN NOINHERIT PASSWORD '<SCRAM>'` + `GRANT torneos_erasure_writer TO torneos_edge_erasure_writer`.
  3. El servidor sólo recibe el verificador. La contraseña en claro **nunca** llega al servidor, a sus logs ni a `pg_stat_statements`.
  4. Se verifica con `db-0021.mjs observe`: estado `POST_0021` y `erasure_role_logins = ["torneos_edge_erasure_writer"]`.
- **Dónde vive:** sólo en **GCP Secret Manager**, proyecto `arma2-465223`, secreto `torneos-gw-db-erasure-writer-url`.
  - El valor es la URL completa: `postgres://torneos_edge_erasure_writer.<ref>:<contraseña>@aws-N-sa-east-1.pooler.supabase.com:6543/postgres`, armada con `erasureDbUrl()`.
  - Se crea con `gcloud secrets create … --data-file=-`, con el valor **por stdin**.
  - Tiene acceso `roles/secretmanager.secretAccessor` **sólo** para `torneos-gateway-prod@arma2-465223.iam.gserviceaccount.com`, y sólo sobre ese secreto.
  - Cloud Run la monta como variable `TORNEOS_DB_ERASURE_WRITER_URL` en la revisión nueva del gateway.
- **Qué nunca pasa:** la contraseña o la URL no se escriben en archivos, argv, variables de una shell, logs, evidencia, el chat ni el repositorio. No es la contraseña de otro login ni el secreto del contrato: el gateway se niega a arrancar si la URL usa el login o la contraseña del adaptador o del escritor de identidades, o el secreto del contrato. La clave de firma derivada de Core tampoco sirve como contraseña: se compara al primer uso.
- **Rotación** (cuando haya sospecha, cuando se vaya alguien con acceso, o según la política de Nico):
  1. Generar una credencial nueva con `newCredential()`.
  2. Agregar **primero** una versión nueva del secreto en Secret Manager con la URL nueva.
  3. Ejecutar `renderRotationSql(verificador)` (`ALTER ROLE … PASSWORD '<SCRAM>'`). La contraseña vieja deja de valer al COMMIT.
  4. Desplegar una revisión nueva del gateway que lea la versión nueva (o reiniciar si apunta a `latest`).
  5. Deshabilitar la versión vieja del secreto.
  - Entre los pasos 3 y 4, los borrados responden 503 y Core falla cerrado: la cuenta sigue activa y la persona reintenta. Ensayado en el laboratorio: la contraseña vieja da `28P01` y la nueva funciona.
- **Si se hace rollback de 0021:** el `DROP ROLE` saca la membresía del login. Si se vuelve a aplicar 0021, ejecutar `REGRANT_SQL`. Si no, borrar el login (`DROP ROLE torneos_edge_erasure_writer`) y deshabilitar el secreto.

## Pruebas

```sh
npm run test:torneos:account-deletion                 # offline + laboratorio (Docker), ver abajo
node --test scripts/edge-functions/delete-account.test.mjs
CI=true npx react-scripts test --watchAll=false src/__tests__/accountDeletion.test.jsx
# Evidencia: ACCOUNT_DELETION_EVIDENCE=1 → evidence/*<variante>.jsonl
# Variantes (archivos de otras ramas, sin tocarlas):
#   ACCOUNT_DELETION_WITH_0020=<…/00000000000020_premium_sponsors.sql>   (#212)
#   ACCOUNT_DELETION_WITH_0022=<…/00000000000022_content_moderation.sql> (#216)
#   las dos juntas → main + 0020 + 0022
```

El laboratorio es el PostgreSQL descartable de `commerce-production/lab/pg-lab.mjs`. Corre en un contenedor propio por variante y por checkout (`arma2-account-deletion[-0020][-0022]-lab-db-<checkout>`):

- migrado 0000 → 0019;
- con la topología de Producción: todo es de `postgres`, que no es superusuario;
- con los privilegios por defecto del instalador alojado, también en `private` (peor que el alojado).

En un host con los pools de Docker agotados, crear antes la red `<contenedor>-net` con `--subnet` explícita.

## Despliegue (cada paso con su GO; orden obligatorio)

1. **Torneos 0021:** `node backend/torneos/account-deletion-v1/remote/db-0021.mjs observe` → `PRE_0021`. Después `apply-0021 APPLY TORNEOS 0021 onzpwnqxnvlgsevivngf <sha12>` → `POST_0021`, `changedOutside: []`. Es inerte y crea el rol sin login.
   - Requisito que verifica el catálogo: las tablas con guardas que la función apaga (`torneos_identity`, `tournament_organization_members`, `tournament_match_squad_players`, `tournament_match_operation_players`, `tournament_match_availability_responses`) son del instalador (`postgres`).
   - Después de 0021, las certificaciones de fundación y gateway-auth que cuentan roles `torneos_*` ven un rol más (`torneos_erasure_writer`) y, después del paso 2, un login más: hay que re-pinearlas cuando se corran.
2. **Credencial de borrado (Nico / ops):** ver la sección de arriba. Login con SCRAM, secreto en Secret Manager, acceso sólo para la cuenta de servicio del gateway y `observe` con el login.
3. **Gateway:** revisión nueva de Cloud Run con las rutas y `TORNEOS_DB_ERASURE_WRITER_URL` desde Secret Manager, al 0 % con tag.
   - Probar con una firma inválida: 401.
   - Después pasar a 100 %.
   - Es inerte hasta que Core firme.
4. **Core:** cargar `TORNEOS_GATEWAY_URL` = URL pública del gateway (la misma que `TORNEOS_GATEWAY_PUBLIC_URL` del gateway) en los secretos de funciones de Core y desplegar `delete-account`.
   - Prueba de humo con una cuenta de prueba **creada para eso** (nunca una real), con y sin Torneos.
   - Después correr `reconcile-0021.sql` con umbral 0: la fila de la prueba tiene que estar `core_confirmed`.
5. **Web.** Junto con 4 o después; nunca antes.

## Reconciliación (manual, sin cron)

Torneos y Core son dos bases: **no hay atomicidad entre ellas**. Lo que Torneos anonimizó no se puede revertir. El registro de Torneos deja visible lo que Core no confirmó.

- **Cuándo mirar:** después de cada log de Core `torneos confirmation not delivered: …`, después de un `profile_delete_failed` / `auth_delete_failed`, o con la revisión periódica que decida Nico.
- **Objetivo interno:** 5 días hábiles desde el pedido (art. 16 Ley 25.326). Es un **objetivo interno, pendiente de compromiso operativo de Nico**; no es una promesa pública. Los textos públicos no dan plazos.

1. **Listar** (sólo lectura). Como el instalador, en `BEGIN TRANSACTION READ ONLY`, correr `remote/reconcile-0021.sql`. Por defecto muestra las filas `torneos_erased` de más de 24 h; para cambiar el umbral, cambiar sólo el literal del intervalo.
   - Muestra `erasure_id`, `core_user_sha256`, `request_id`, antigüedad, objetos pendientes e `identity_recreated`.
   - No muestra nombres, emails ni ids de Core.
2. **Buscar en Core** (sólo lectura, editor SQL de Core): `select count(*) from auth.users where encode(sha256(convert_to(id::text, 'UTF8')), 'hex') = '<core_user_sha256>';`
3. **Si da 0:** Core terminó y sólo se perdió la confirmación. Con GO, correr `remote/reconcile-complete-0021.sql` reemplazando `<erasure_id>`.
   - Si `identity_recreated` es true, barre esa identidad. El id de Core se lee de esa fila, nunca se tipea. Con la tumba esto no debería pasar; sólo puede pasar después de un rollback forzado.
   - Marca la fila `core_confirmed` por `operator`.
   - Correrlo dos veces no cambia nada.
4. **Si da 1:** la cuenta Core sigue activa y lo de Torneos ya está anonimizado (irreversible).
   - Lo seguro es que la persona termine con el mismo botón (Perfil → Eliminar cuenta o `/account-deletion`): Torneos responde `already_erased` y Core termina y confirma.
   - Se le avisa por el email de la cuenta, sin datos de Torneos.
   - Este PR **no** agrega un borrado manual de cuentas Core. Si la persona no puede, Nico decide; queda fuera de este PR.
5. **Pedido por email (sin sesión):** soporte verifica la titularidad y obtiene el `core_user_id` en Core. Después, en este orden y con GO:
   1. En Torneos, como el instalador: `select private.erase_tournament_account('<core_user_id>', gen_random_uuid());`.
   2. El borrado en Core (fuera de este PR).
   3. `select private.confirm_tournament_account_erasure('<core_user_id>', '<el mismo request_id>');`.
   - Nunca con un id que no salga de Core.
6. **Retratos pendientes:** `select pending_storage_objects from private.tournament_account_erasures where …`. Se borran con el camino existente del store (`complete_tournament_player_portrait_delete` después de borrar el objeto). Hoy MEDIA está apagado y no hay retratos en Producción.

## Recuperación

- **Torneos caído u ocupado:** Core responde 503 y no borra nada; la persona reintenta. Un lock ocupado falla en unos 5 s con `55P03`. No hay nada que reparar.
- **Sesión o JWT de una cuenta ya borrada:** el gateway responde `403 TORNEOS_ACCOUNT_ERASED` en `/exchange` y no se crea ninguna identidad (tumba). Es lo esperado; no hay nada que reparar.
- **Rollback forzado de 0021:** descarta el registro y con él las tumbas.
- **Core falla después de Torneos:** la persona reintenta y termina. Si no lo hace, va a reconciliación (arriba).
- **Volver atrás:** web → Core (función anterior; `delete-account` vuelve a no tocar Torneos) → gateway (revisión anterior; sin las rutas, Core falla cerrado) → credencial (deshabilitar el secreto; opcionalmente borrar el login) → rollback 0021 (forzado si hubo erasures). **Ningún paso restaura datos anonimizados.**
- **Organización archivada que alguien quiere seguir usando:** traspaso manual por soporte (insertar o promover un titular y poner `status = 'active'`, `archived_at = null`), con auditoría. Queda fuera de este PR.

## Lo que este PR no hace

- No borra objetos de Storage ni habilita la purga de fotos (cron prohibido).
- No toca pagos, compras, planes ni el webhook. La app de pagos ya rechaza cualquier `TORNEOS_DB_*` en su entorno alojado.
- No borra el archivo de la foto de perfil de Core (`jugadores-fotos`). Los textos dicen «todavía no se eliminan automáticamente; se suma en una próxima actualización», sin camino por email. Queda la costura en `delete-account` para el PR siguiente.
- No revoca tokens de Sign in with Apple. Va en el mismo PR siguiente.
- No suma ningún cron.
