> Phase 2A follow-up: see [phase2a/REPORT.md](phase2a/REPORT.md) for the current partial implementation, season-access fix and explicit remaining certification gates. Status remains BLOCKED.

# Phase 2 — Clean baseline foundation

**Conclusión binaria: B) BLOCKED.** Hay un baseline candidato instalado y probado localmente. No hay equivalencia funcional completa ni aprobación para usarlo como release. No se creó Supabase Production, no se conectó a Production Core/Torneos, no hubo deploy ni Phase 3.

El bloqueo concreto es que el contrato SSO aprobado acredita identidad/sesión; no acredita email verificado para aceptar invitaciones, directorio de jugadores ni autorización/importación de equipos Core. Sustituir esas dependencias por datos supuestos o por respuestas vacías hubiera escondido pérdida de funcionalidad. El candidato devuelve un error explícito para esos caminos. Esa pérdida temporal **no satisface** la condición del pedido “No perder funcionalidad final existente”.

## Base, branch y archivos

- Base aprobada: `2cd3512e5129f1a8ec50ea4d27db8e1e70be4b20`, Phase 1.5.
- Branch: `codex/torneos-clean-baseline-phase2`.
- Worktree: `/Users/nicoavayu/Downloads/arma2/arma2-torneos-clean-baseline-phase2`.
- Cambios confinados a `backend/torneos/`; app, landing, servidor SSO y migrations Core no se modificaron.
- El HEAD final es el commit de entrega indicado en la respuesta y verificable con `git rev-parse HEAD` en este worktree. El manifiesto `evidence/manifest.sha256` sella los archivos entregados sin autorreferenciar el hash Git.

Archivos principales:

| Entregable | Archivo |
|---|---|
| Baseline SQL candidato | `supabase/migrations/00000000000000_torneos_baseline_v1.sql` |
| Inventario final completo, columnas/constraints/ACL/RLS/functions/triggers/indexes | `INVENTORY.md`, `evidence/history-catalog.json`, `evidence/baseline-catalog.json` |
| Descartes, renombres y reemplazos | `HISTORY.md`, `evidence/history-transitions.json` |
| Trazabilidad de las 48 fuentes | `contracts/history-manifest.json`, `evidence/history-applied.json` |
| Permisos de ejecutables certificados | `evidence/executable-acl-provenance.json`, `tools/history-acl.sql` |
| Diferencias de identidad | `contracts/identity.sql`, `evidence/intentional-function-differences.json` |
| Comparación | `evidence/equivalence.json`, `evidence/seed-equivalence.json` |
| Tests reproducibles | `tools/test.py`, `evidence/tests.json`, `evidence/tests.txt` |
| Análisis de funciones | `tools/check-functions.py`, `evidence/function-analysis.json`, `evidence/security-definer-review.json` |
| Storage inactivo | `contracts/storage-history.json`, `contracts/storage-policies.inactive.sql` |
| Cron inactivo | `contracts/cron.json` |
| Construcción/instalación local | `tools/lab.py`, `tools/build.py`, `tools/install-local.py`, `README.md` |

## Reconstrucción del estado final

Se verificaron **48/48 hashes de fuentes y 48/48 hashes de ejecutables** contra el manifiesto sellado. Se leyeron las fuentes y sus dependencias para preparar una referencia estructural local; después se aplicaron en su orden explícito sobre esa referencia y se capturó introspección después de cada paso. No se ejecutaron operadores de promoción ni se escribieron sus receipts/ledger.

La referencia contiene sustitutos vacíos de `auth.users`, `public.usuarios`, `public.jugadores`, `public.teams`, `public.team_members` y las columnas Storage usadas por SQL. El helper de permisos Core es un sustituto que devuelve false. Por eso esta referencia certifica **derivación de objetos**, no comportamiento de APIs Core. No se recreó la DB Core real ni se ejecutaron pasos 37–48 sobre ningún Core.

Los ejecutables desde el paso 12 revocan permisos por defecto de cada nueva función. Se reprodujo exclusivamente ese efecto con un event trigger local de referencia; no se arrastró al baseline. Omitirlo habría dejado privilegios de API que las fuentes aisladas no revocan por sí solas.

El baseline se construyó desde las definiciones **finales**: tablas, tipos de columnas, constraints finales, índices, funciones, triggers, RLS, ACL y catálogos semilla. No incluye replay de renombres, backfills, reemplazos ni 48 entradas de historial. Es un único SQL transaccional. `check_function_bodies=off` permite ordenar funciones con dependencias mutuas como en un dump; la instalación por sí sola no sustituye el análisis/ejercicio posterior de funciones.

La nueva instalación usó una segunda DB creada desde `template0`, con `public` vacío y sin tablas Auth/Core/Storage. Recibió únicamente el baseline nuevo. La imagen fue Supabase Postgres `17.6.1.143` (PostgreSQL 17.6), con ID de imagen registrado en `evidence/install.json`. El contenedor tiene `network=none`, sin puertos publicados, y sólo acepta comandos por el socket Docker local. No se usó configuración remota del repo. El contenedor del laboratorio quedó detenido al entregar; se conserva para reproducibilidad y `start()` lo reanuda localmente.

## Objetos conservados y descartados

El candidato contiene **104 tablas**: las **103 tablas finales Torneos** más `torneos_identity`. Hay **369 índices**, **63 políticas RLS**, **111 triggers** y **362 funciones**, de las cuales **304 son SECURITY DEFINER**. No hay enums de usuario ni vistas finales. El inventario enumera cada objeto y todas sus columnas, PK/FK, checks, uniques, índices y grants.

Los dos renombres del paso 34 quedan resueltos a `tournament_legacy_subscription_plans` y `tournament_legacy_organization_subscriptions`. Se conservan para compatibilidad/auditoría; `first_free` no vuelve a ser autoridad. Se descartan los nombres anteriores, sus reemplazos transitorios, el trigger `tournaments_assign_first_free_plan`, las políticas sustituidas por scope de temporada, índices de idempotencia/compra reemplazados y firmas antiguas. El registro de 1.402 transiciones hace explícitas las remociones y cambios; una remoción por renombre no implica borrado de la funcionalidad final.

La comparación de índices exactos encontró **cero pares duplicados** en el estado final. No se eliminaron índices por semejanza de prefijo. No se agregaron índices de optimización especulativos; el rendimiento a escala y cobertura adicional de FKs quedan para validación con cargas representativas.

## Boundary Core / Torneos

- `torneos_identity.id` es el UUID local que viaja en `sub`; `core_user_id` es único y mantiene la correspondencia con Core. No existe FK física a Core ni a `auth.users`.
- **89 FKs históricas de identidad** apuntan ahora a `torneos_identity(id)`. Se conserva su acción ON DELETE original. Los nombres de columnas históricas permanecen por compatibilidad de schema, pero sus valores de usuario ahora son UUID locales, también en `arma2_user_id`.
- Las referencias a `auth.uid()` se sustituyen por `private.current_identity_id()`: valida correspondencia de identidad, issuer/audience locales, role, lifetime 120 s y presencia de claims de sesión; la firma JWT y la revocación de sesión Core siguen siendo responsabilidad del gateway/JWKS.
- Identity shadow tiene RLS/FORCE RLS; el cliente sólo lee su fila. `torneos_identity_writer` es NOLOGIN y tiene SELECT/INSERT y UPDATE únicamente sobre `core_user_id`. El trigger de inmutabilidad permite el upsert idempotente exacto de Phase 1.5 y rechaza reasignaciones.
- Se elimina la FK `tournament_team_entries_arma2_team_id_fkey`; `arma2_team_id` conserva el UUID externo opaco. La importación no se habilita sin permiso Core certificado.
- Se mantienen nombres y firmas de RPC. Tres funciones fallan con `0A000 / TORNEOS_CORE_BRIDGE_CONTRACT_PENDING`: `accept_tournament_team_invitation`, `search_tournament_players`, `search_tournament_arma2_teams`. `create_tournament_team_entry` conserva alta manual/provisional y rechaza sólo importación Core con `TORNEOS_CORE_TEAM_IMPORT_CONTRACT_PENDING`.

No se inventó email, perfil, búsqueda ni autorización de equipo. Tampoco se cambió el gateway Phase 1.5, cuya allowlist de HTTP sólo cubre probes/identity. Ampliar sus rutas de forma segura y recertificar app/SSO contra este backend completo sigue pendiente; los 13/13 y 41/41 de Phase 1.5 no se presentan como resultados nuevos.

## RLS, roles, funciones y grants

Las 104 tablas expuestas tienen RLS. Las tablas internas sin políticas quedan cerradas a roles normales; las RPC privilegiadas aplican sus controles históricos. Se preservan permisos owner/admin/collaborator y la asignación por temporada: owner no consume asiento; admin/collaborator requieren asignación para acceder a esa temporada. No se inventa un rol de organización `member`: el histórico usa `collaborator`; otros roles de participantes/equipos conservan sus checks originales.

Todas las 304 SECURITY DEFINER tienen search_path vacío y ninguna conserva EXECUTE para PUBLIC. Sus ACL explícitas están inventariadas; los endpoints anónimos de publicación conservan los checks históricos de visibilidad. No se movieron indiscriminadamente las RPC públicas a `private` porque cambiaría el contrato API. El registro de revisión distingue comprobación mecánica de revisión semántica, que **no está completada** para las 304 funciones.

Se revoca CREATE de schema a roles cliente y el default global de EXECUTE del instalador para funciones futuras. Un REVOKE limitado al schema no elimina el default global de PostgreSQL; la prueba detectó esto y la foundation lo corrige. No hay grants de escritura para anon. El rol servicio conserva sólo el estado final explícito de las fuentes/ACL históricas, no supuestos de defaults Core.

`plpgsql_check` produjo **81 diagnósticos, 26 de nivel error**: 20 sobre tablas temporales creadas en ejecución (rank/standings), 2 sobre Storage no provisionado y 4 sobre campos distintos de triggers compartidos. Son diagnósticos estáticos cuya clasificación es consistente con esos contextos, **no una demostración de inocuidad ni fallos funcionales confirmados**. El archivo completo conserva línea, función, contexto y mensaje. No se suprimieron para producir un PASS.

## Storage y cron: contratos sin activación

Se conservaron contratos SQL de datos/media/Social Studio dentro del dominio. No se crearon buckets ni conexiones Storage en la DB candidata. La diferencia está permitida por el alcance de foundation y queda fuera de la comparación del schema `public`.

La referencia histórica creó tres buckets: `tournament-branding` (público, 2 MiB), `tournament-player-portraits` (privado, 8 MiB) y `tournament-team-photos` (privado, 8 MiB), con MIME JPEG/PNG/WebP. El bucket `tournament-media` se esperaba por provisión externa y no fue creado por estas fuentes en la referencia. Su readiness exige bucket privado y servicios atestados; la DB candidata devuelve `uploadReady=false`.

Las **8 políticas Storage históricas** se conservan como contrato inactivo separado: cuatro de media service y cuatro de branding. No se aplican en esta fase. La política UPDATE/DELETE de media es denegatoria; las autorizaciones del rol servicio real dependen también de su bypass RLS y del backend, por lo que esos nombres de policy no equivalen a certificar todo el servicio. No se inventó un bucket Social export ni de documentos.

Las 48 fuentes no instalan jobs propios `cron.schedule`. El candidato no instala extensión pg_cron ni jobs. Polling, cleanup multimedia y renovación de atestaciones son contratos de runtime futuro, no schedulers activados. No se tocan cron Core, push, media ni flags Production.

## Pruebas y equivalencia

**58/58 tests SQL locales PASS** en la última instalación limpia. Cubren instalación vacía, rechazo atómico de segunda ejecución, PK/FK, identidad/mapping inmutable y upsert, claims inválidos, RLS, workspaces, roles, asignación de temporadas, aislamiento de torneos, visibilidad pública/privada y despublicación, alta manual de equipo/roster, grants, defaults futuros, ausencia de dependencias Core, ausencia de endpoints Production/tokens incrustados, storage/cron inactivos y rechazo explícito de contratos Core pendientes.

Los tests incluyen assertions de rechazo de caminos no soportados. Por eso 58/58 no significa que esos caminos funcionen ni que el baseline total esté certificado. No se ejecutaron todas las suites de fixture/match/stats/Social históricas contra el nuevo baseline, ni se recertificó navegador/SSO completo. Las suites antiguas construyen sus propios históricos/harness; correrlas sin adaptarlas no habría certificado este SQL.

| Comparación histórica → candidato | Resultado |
|---|---|
| Tablas de dominio | 103/103 conservadas; 102 iguales tras normalizar identidad; 1 elimina FK física Core |
| Índices de dominio | 367/367 iguales |
| Políticas public históricas | 61/61 iguales tras normalizar identidad |
| Triggers históricos | 110/110 iguales |
| Funciones de dominio | 358/358 presentes; 354 iguales tras normalizar identidad; 4 diferencias explícitas |
| Catálogos semilla | 10/10 equivalentes, excluyendo timestamps de auditoría generados |
| Nuevos objetos | Identity shadow, 2 índices, 2 políticas, 1 trigger, 3 helpers privados y wrapper UUID |
| Storage | Contratos separados/inactivos: 3 buckets y 8 policies históricas, más expectativa externa de media |
| Cron | 0 jobs Torneos históricos / 0 instalados |

La comparación incluye tipo/nullability/default de columnas, constraints, ACL y definición de funciones. Se normaliza representación de ACL del owner y el AST de CHECK (paréntesis y agrupación asociativa AND/OR), sin borrar expresiones para forzar coincidencia. Se preservan los catálogos raw para revisar esa normalización. No hay divergencias de objetos sin documentar en la comparación `public`; esto no prueba equivalencia funcional de todos los flujos.

## Commercial/billing y Mercado Pago

La foundation conserva tablas/catálogos finales de licensing, entitlements, grants por temporada y contratos FAKE que sí pertenecen a las 48 fuentes. FREE: 25 assets y 1 colaborador; PREMIUM: 1.000 assets y 10 colaboradores; branding optional en PREMIUM. Se preservan valores semilla históricos, no se certifican como oferta comercial vigente.

**Mercado Pago real queda explícitamente fuera de Phase 2.** No se incorporó la migration provider test excluida de las 48, no se crearon los RPC faltantes de provider, no se configuraron pagos, credenciales, webhooks ni activaciones reales. `get_provider_tournament_purchase`, `apply_verified_tournament_payment_status` y `apply_verified_tournament_payment_reversal` permanecen ausentes. La auditoría previa de contratos comerciales incompletos no se “resuelve” inventando schema.

## Gaps y recomendación para Phase 3

1. **Bloqueante funcional:** certificar extensión del bridge/API Core para email verificado, búsqueda y permisos/snapshot de equipos; restaurar los cuatro caminos afectados con pruebas positivas y negativas. Decidir un contrato de producto reducido sería un cambio de alcance, no equivalencia.
2. **Bloqueante de certificación:** completar revisión semántica de las SECURITY DEFINER y adaptar/ejecutar las suites de fixtures, operaciones, standings/stats y Social sobre esta foundation; resolver con fixtures los diagnósticos de contexto temporal/trigger.
3. **Bloqueante de integración:** conectar este candidato al gateway local con allowlist de RPC/recursos y recertificar identidad, sesión, logout/revocación, renovación y navegador sin modificar Production.
4. **Pendiente deliberado:** certificar Storage/runtime local antes de cualquier habilitación; mantener cron/push/media/flags fuera. Contratos provider/billing comercial requieren una fase separada.

Recomendación: **no iniciar Phase 3 todavía**. Cerrar estos puntos dentro de la certificación local Phase 2 y recién entonces emitir CLEAN TORNEOS BASELINE PASS. Una eventual Phase 3 podrá evaluar un Supabase Torneos nuevo y aislado bajo autorización explícita. No se ejecutó esa fase ni se creó un proyecto.

Referencia técnica consultada: [Supabase RLS y grants](https://supabase.com/docs/guides/database/postgres/row-level-security). Se revisó el changelog; la deprecación de pinning de extensiones no afecta este SQL, que no fija su versión. Las conclusiones del producto y los resultados provienen de los archivos/evidencia local.
