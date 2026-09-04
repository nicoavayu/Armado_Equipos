# Production-specific local rehearsal — PASS

**PRODUCTION BACKEND UPGRADE PREP PASS — READY FOR CONTROLLED DB PROMOTION**

Fecha: 2026-09-03. Resultado limitado al rehearsal LOCAL del backend, con el contrato legacy de Production como baseline. No se ejecutó una promoción.

Worktree: /Users/nicoavayu/Downloads/arma2/arma2-torneos-production-backend-upgrade-prep. Base y HEAD al certificar: f6dafb6b755f5d5337a7dc90066c849047cb6109. Al emitir el PASS, los archivos de este trabajo permanecían sin commit; el alcance de su congelación posterior en Git se detalla al final. El gate canónico y las migrations históricas permanecen byte a byte sin cambios.

## Resultado y conteos

| Validación | Resultado |
|---|---:|
| Preservación legacy, filas de catálogo y permisos efectivos | **23.103 / 23.103** |
| Torneos, contratos y comparación exacta del delta | **36.787 / 36.787** |
| Diferencias legacy esperadas en el audit canónico | **95 assertions**, inventariadas explícitamente |
| Fallos inesperados | **0** |
| Objetos/filas de catálogo originales cambiados o eliminados | **0 / 0** |
| Migration guard y resolver | **8 / 8** |
| Season-commercial sobre AFTER final | **35 / 35** |
| Safeupdate negativo, positivo y ranking determinista, authenticator real | **17 / 17** |
| Ciclo de competencia sobre AFTER final | **81 / 81** |
| Social Studio + Auto-Match SQL sobre AFTER final | **52 / 52** |
| Regresión Auto-Match, tests SQL estáticos/UI/errores | **77 / 77** |
| Gate: baseline válido y cuatro inyecciones de regresión rechazadas | **5 / 5** |
| Social Studio histórico, fixture independiente | **45 / 45** |
| Ledger original / nuevas entradas locales / total | **200 / 48 / 248** |

Los conteos del gate son comprobaciones de catálogo, no escenarios de usuario independientes: incluyen EXECUTE y grant option para los 31 roles, y presencia/contenido exacto de cada adición. Las suites históricas independientes se distinguen de las ejecutadas sobre el AFTER restaurado. Se usaron 587 filas de fixture Torneos y seis usuarios sintéticos locales; las pruebas de dominio terminan en ROLLBACK. La comparación estructural posterior a las suites sigue en cero cambios.

## BEFORE, AFTER y reproducibilidad

- Snapshot original: /Users/nicoavayu/Downloads/arma2/production-db-snapshot-20260903; SHA256SUMS 10/10 verificado. No se modificó ni se extrajeron nuevos datos remotos.
- BEFORE ampliado: **0e24527552cefd85f151d43b35e8e961687a0654c9702cac9c3a0a4e01afd728**.
- AFTER final, incluye ledger completo: **4536cecef01552e5d9ffd5fed976431812eba4ab1c26cccda4e3679453ab5ef6**.
- r3 fue el ensayo exploratorio. r4 y r5 parten de initdb nuevo y del mismo restore. BEFORE r4/r5: 23.103 filas idénticas. AFTER r4/r5: **39.369 filas idénticas**, incluyendo las 248 filas completas del ledger; cero diferencias en ambas comparaciones.
- r3 también alcanzó el mismo catálogo final; su ledger nuevo conserva las sentencias exploratorias originales y difiere del runner definitivo. No se reparó ni reescribió ese ledger para aparentar igualdad.
- Imagen fijada: public.ecr.aws/supabase/postgres:17.4.1.048, sha256:2fd1dab043d70a51022e5c1ccba009865ab8cfa5d30e1ac18d7c447a65121724. Contenedores r3/r4/r5: network=none, sin puertos publicados, cron desactivado. Las suites usaron un relay UNIX sólo en 127.0.0.1:58332.

El fingerprint cubre schemas, funciones y atributos, todos los roles y memberships, owner/ACL de base, settings por rol, extensiones, relaciones/RLS/ACL, columnas, tipos/enums, vistas, secuencias, constraints, índices, triggers, policies, default ACL, event triggers, publications y ledger completo. El dump schema-only BEFORE/AFTER y su diff sin filtrar se guardan por separado. Se añade cobertura al fingerprint anterior; sus categorías originales coinciden. Los hashes completos anteriores no son comparables con el formato ampliado.

## Contrato Production-specific

A. Cada identidad BEFORE debe existir AFTER y ser exactamente igual. No hay lista de objetos legacy que puedan cambiar. Los 67 helpers Auto-Match/availability/gestation mantienen definición, owner, ACL y privilegios efectivos. Esto incluye auto_match_required_players(text), auto_match_final_roster_capacity(text), auto_match_invitation_capacity(text), y las funciones a las que el audit canónico exige grants diferentes. La denegación legacy de auto_match_duration(text) a service_role también se preservó y se probó.

SHA-256 protegido: **88069592f5f10cad8b7f4c078b6697bff2c2f6fec428c91e35dc8954a31abcd4**.

B. El delta contiene 358 funciones, 103 tablas nuevas y sus objetos dependientes; los conteos exactos por categoría están en gate.json. Cada adición se compara con un inventario explícito y fijado por SHA. Además se verifica, independientemente, el contrato EXECUTE authenticated/anon del audit canónico y el service_role/SECURITY DEFINER/INVOKER declarado por las fuentes. Owners, RLS, PUBLIC, anon writes y grant options se verifican por objeto. Los bridges aplican únicamente las reglas canónicas a identidades ausentes del BEFORE.

C. Cambio o eliminación de un objeto BEFORE, un objeto nuevo no registrado, grants diferentes o ledger fuera del manifest bloquean. Las pruebas de mutación confirmaron el rechazo de: revocar EXECUTE Auto-Match legacy, conceder anon a una RPC Torneos, introducir una tabla no registrada y eliminar una policy preexistente. El gate nunca genera ni amplía automáticamente el inventario esperado.

Los default ACL de Production siguen intactos. Para cada función NUEVA de migrations posteriores al core canónico, el runner elimina sus permisos heredados inmediatamente después de CREATE y antes de continuar con los GRANT/REVOKE originales, todo dentro de la misma transacción. Es la adaptación local del contrato canónico de creación, sin ALTER DEFAULT PRIVILEGES ni normalización del legacy. El SQL ejecutado, incluido este paso, queda en el ledger y en los archivos ejecutables del manifest.

## Clasificación de los 126 fallos originales

| Clasificación de assertions originales | Cantidad | Resolución |
|---|---:|---|
| Gate canónico incompatible con baseline legacy exacto | 92 | Se exige preservación del BEFORE; no se cambian esos permisos ni se instalan 11 contratos del producto personal ausentes en BEFORE |
| Contratos Torneos todavía no instalados | 31 | 22 checks de existencia/EXECUTE de season + 9 grants anon canónicos de proyecciones públicas; instalados y comprobados |
| Agregados mixtos: legacy y permisos nuevos accidentales | 3 | Descompuestos por firma. Las firmas legacy se preservan; los permisos nuevos se corrigen con el contrato canónico explícito |

El audit canónico sin modificaciones sigue dando 877 checks, **95 failures esperados de legacy**; no se presenta como PASS. Sus 95 failures finales están clasificados uno por uno, con identidades BEFORE/AFTER y las 11 ausencias personales explícitas. Los tres agregados mixtos ahora sólo contienen diferencias legacy. **Ninguna regresión de Torneos se agregó a una excepción.** Véase docs/operations/production-upgrade-proposals/canonical-failure-classification.json (copia byte-identical de la clasificación final r5, sin filas de negocio ni snapshots).

## Puentes y correcciones demostradas

1. **20260903205715 — pgcrypto:** crea digest(text,text) y gen_random_bytes(integer) ausentes del BEFORE, INVOKER, search_path vacío y sin EXECUTE de API. Delegan a extensions; no se mueve la extensión.
2. **20260903213456 — ACL explícitas:** expande las reglas canónicas de tablas/secuencias/RPC únicamente en identidades creadas por las nueve migrations históricas Torneos. Cada sentencia tiene un objeto concreto. No hay GRANT/REVOKE ON ALL aplicado al schema legacy.
3. **20260903214331 — preference helper:** crea el helper canónico record_tournament_purchase_preference, necesario para FAKE checkout por temporada y sólo ejecutable por service_role. No contiene llamadas externas ni cambia constraints de proveedores.
4. **20260903213454 — season variant:** copia íntegramente la migration season-commercial salvo el REVOKE de create_tournament_purchase(uuid,uuid,text,uuid,text,text), que sólo se ejecuta si esa firma existe. No se crea una RPC ficticia para satisfacerlo. La versión histórica original no se marca aplicada; el ledger registra esta variante local.
5. **20260903214514 — FAKE activation:** el test encontró que la aprobación FAKE todavía llamaba al activador por torneo. Se reemplaza exclusivamente el adaptador creado por Torneos por el adaptador canónico hacia el activador por temporada. Se declara el permiso service_role canónico de este nuevo activador. Ninguna función del BEFORE cambia.

La explicación sentencia por sentencia y el SQL exacto están en docs/operations/production-upgrade-proposals/bridge-statements.json. Los cuerpos neutrales/FAKE extraídos de la evolución canónica mantienen su lógica; no se ejecutó su migration Mercado Pago. La tabla tournament_purchases conserva sus constraints FAKE/local/qa, comprobados por SQL. No hay configuración de proveedor, HTTP, pagos reales ni ampliación de proveedores admitidos.

El primer intento de la migration Social final revirtió por un error del runner al repetir un REVOKE sobre una firma que el mismo archivo había eliminado. El runner definitivo conserva el orden original; r4 y r5 completan sin ese fallo. El error funcional de checkout se corrigió antes de congelar el delta definitivo. Los logs exploratorios se conservan.

## Futura promoción: plan ordenado, todavía NO ejecutado

1. Obtener autorización explícita para la promoción DB y fijar una ventana de mantenimiento. Mantener deshabilitados los consumidores Torneos y los writers durante la ventana y hasta completar los gates. Este informe no autoriza Production writes ni operaciones de frontend, Vercel, Arma2Web o proveedores.
2. Obtener backup/PITR recuperable inmediatamente anterior, con ledger y datos; probar su restauración en una instancia aislada y acordar RTO/RPO. Conservar identificación del backup y procedimiento del proveedor. Sin prueba de recuperación no ejecutar la promoción.
3. Exportar un fingerprint READ-ONLY actualizado de Production. Compararlo con el BEFORE fijado: owners, ACL, roles, memberships, RLS, funciones/atributos, schema, extensiones y las 200 filas completas del ledger. Cualquier drift requiere revisión y nuevo rehearsal; no actualizar el anchor automáticamente.
4. Verificar el runtime real, en especial authenticator.session_preload_libraries=safeupdate, extensiones y supautils.policy_grants. El ensayo usó defaults de supautils de la imagen para modelar ownership de Storage; no son un export de configuración global Production. No escribir esos defaults en Production para obtener PASS.
5. Fijar el bundle por hashes de promotion-manifest.json y validar todos los hashes de fuentes/SQL ejecutable, guard de migrations y SHA Auto-Match. Role de ejecución: postgres, no superuser. Usar conexión nueva por archivo, psql -X con ON_ERROR_STOP, lock_timeout 3s y statement_timeout 60s. No usar db push, orden lexicográfico, baseline canónica ni repair del ledger.
6. Ejecutar exclusivamente los **48 pasos de la tabla siguiente, en ese orden**. Cada ejecutable ya contiene BEGIN, SQL concreto, INSERT de su nueva entrada de ledger y COMMIT. ON_ERROR_STOP implica que el fallo cierra la conexión y revierte la transacción; no reintentar sin investigar. Verificar preservación legacy entre pasos y detenerse ante cualquier delta ajeno a Torneos.
7. Capturar AFTER antes de habilitar consumidores. Ejecutar el gate Production-specific con su anchor fijo, clasificación del audit canónico, ledger validation, grants/RLS/RPC y safeupdate. Repetir pruebas sintéticas aisladas con rollback y verificar 200 filas originales intactas, 48 nuevas esperadas y cero fallos inesperados. No usar los scripts de fixture de este rehearsal contra Production sin un protocolo específico autorizado para datos sintéticos.
8. Si los gates pasan, cerrar la ventana de mantenimiento y habilitar sólo los consumidores que hayan sido autorizados para esta promoción. Mantener las exclusiones actuales hasta autorización separada.
9. **Recuperación:** fallo antes de COMMIT: ROLLBACK de ese paso, probado localmente. Si ya hubo commits y se decide abandonar: mantener writers/consumidores detenidos, restaurar el backup/PITR pre-upgrade mediante el procedimiento ensayado, comprobar fingerprint y ledger original y entonces reabrir. No borrar tablas Torneos ni filas de ledger como supuesto rollback. Si se admitieron nuevas escrituras, capturarlas y acordar su reconciliación antes de restaurar; no prometer reversibilidad sin pérdida después de reabrir writers.

| Orden | Versión registrada localmente | Fuente |
|---|---|---|
| 1 | 20260903205715 | 20260903205715_production_torneos_pgcrypto_compatibility.sql |
| 2 | 20260724233000 | 20260724233000_tournament_organization_workspaces.sql |
| 3 | 20260725120000 | 20260725120000_tournament_competition_core.sql |
| 4 | 20260725210000 | 20260725210000_tournament_teams_rosters.sql |
| 5 | 20260726010000 | 20260726010000_tournament_fixture_scheduling.sql |
| 6 | 20260726150000 | 20260726150000_tournament_match_operations.sql |
| 7 | 20260726200000 | 20260726200000_tournament_standings_discipline.sql |
| 8 | 20260726230000 | 20260726230000_tournament_participant_hub.sql |
| 9 | 20260727010000 | 20260727010000_tournament_communications.sql |
| 10 | 20260727060000 | 20260727060000_tournament_media_galleries.sql |
| 11 | 20260903213456 | 20260903213456_production_torneos_explicit_acl_contract.sql |
| 12 | 20260801090000 | 20260801090000_tournament_context_reads_are_pure.sql |
| 13 | 20260802090000 | 20260802090000_tournament_media_upload_pipeline.sql |
| 14 | 20260802120000 | 20260802120000_tournament_media_trusted_processing.sql |
| 15 | 20260803090000 | 20260803090000_tournament_social_studio.sql |
| 16 | 20260809232508 | 20260809232508_tournament_media_free_mvp.sql |
| 17 | 20260810160355 | 20260810160355_tournament_entitlements_foundation.sql |
| 18 | 20260810215224 | 20260810215224_tournament_public_pages.sql |
| 19 | 20260812120000 | 20260812120000_tournament_competition_lifecycle.sql |
| 20 | 20260813120000 | 20260813120000_rank_standings_safeupdate_guard.sql |
| 21 | 20260813121000 | 20260813121000_match_open_window_is_a_client_error.sql |
| 22 | 20260813122000 | 20260813122000_lifecycle_business_rules_are_client_errors.sql |
| 23 | 20260813123000 | 20260813123000_match_already_official_is_a_client_error.sql |
| 24 | 20260813124000 | 20260813124000_core_flow_business_rules_are_client_errors.sql |
| 25 | 20260814053900 | 20260814053900_fix_tournament_social_snapshot_nullable_round.sql |
| 26 | 20260815234340 | 20260815234340_tournament_media_storage_readiness_and_delete.sql |
| 27 | 20260817062612 | 20260817062612_tournament_branding_assets.sql |
| 28 | 20260817220554 | 20260817220554_tournament_player_portraits_foundation.sql |
| 29 | 20260818120000 | 20260818120000_tournament_player_portrait_ux.sql |
| 30 | 20260818210000 | 20260818210000_tournament_team_visual_self_management.sql |
| 31 | 20260820120000 | 20260820120000_tournament_media_publication_is_processing_aware.sql |
| 32 | 20260821120000 | 20260821120000_media_restore_respects_closed_galleries.sql |
| 33 | 20260821180000 | 20260821180000_tournament_team_photo_moderated_lifecycle.sql |
| 34 | 20260821213918 | 20260821213918_plans_entitlements_foundation_v2.sql |
| 35 | 20260821230000 | 20260821230000_active_tournament_phase_append.sql |
| 36 | 20260823120000 | 20260823120000_tournament_social_team_contract.sql |
| 37 | 20260825194025 | 20260825194025_tournament_commercial_checkout_foundation.sql |
| 38 | 20260827012000 | 20260827012000_align_tournament_premium_catalog.sql |
| 39 | 20260903214331 | 20260903214331_production_fake_purchase_preference_dependency.sql |
| 40 | 20260903213454 | 20260903213454_production_season_optional_legacy_purchase_revoke.sql |
| 41 | 20260828163328 | 20260828163328_tournament_season_member_scope.sql |
| 42 | 20260828163329 | 20260828163329_tournament_season_media_social_branding.sql |
| 43 | 20260828165314 | 20260828165314_remove_legacy_media_subquotas.sql |
| 44 | 20260828172000 | 20260828172000_prune_legacy_media_subquota_work.sql |
| 45 | 20260828174500 | 20260828174500_harden_season_rpc_execute_grants.sql |
| 46 | 20260831163520 | 20260831163520_fix_tournament_media_session_reuse.sql |
| 47 | 20260901120000 | 20260901120000_social_studio_theme_export_contract.sql |
| 48 | 20260903214514 | 20260903214514_production_fake_activation_season_dispatch.sql |

El manifest JSON contiene el path del ejecutable y SHA-256 de fuente y ejecución para cada fila. Este plan describe una futura operación controlada; los scripts actuales sólo permiten contenedores locales concretos.

## Límites y evidencia

El snapshot contiene schema y ledger, no datos reales de negocio: no certifica preservación de filas reales, locks bajo carga, tiempos de producción, concurrencia de tráfico, HTTP/JWT/Auth, push, Storage HTTP ni recuperación con datos reales. Schema y ledger se exportaron por separado. Se preserva exactamente el contrato capturado, con los límites de runtime indicados. No se afirma certificación de Mercado Pago, del frontend ni del producto personal canónico completo.

La suite Social histórica necesitó restituir symlinks faltantes de librerías ya incluidas en node_modules/embedded-postgres; no se cambiaron versiones ni archivos rastreados. Sus 45 tests son complementarios: las 52 verificaciones SQL y las 35 season-commercial sí corren sobre el AFTER final PostgreSQL 17.4.

Evidencia principal: artifacts/production-specific-r5/{before.json,after.json,gate.json,canonical-failure-classification.json,source-contracts.json,reproducibility-before.json,reproducibility-after.json,post-test-structural-diff.json,schema-before.sql,schema-after.sql,schema-full.diff,automatch-preservation.json} y logs de suites. El inventario exacto del delta y el anchor están en docs/operations/production-upgrade-proposals. Se conservan r3/r4 como evidencia separada.

Durante el rehearsal no se hicieron conexiones ni escrituras Production; no se consultó ni modificó QA, no se ejecutaron Vercel, Mercado Pago, Arma2Web, commit, push, PR ni cambios de Auto-Match/históricos. Los contenedores y el relay del rehearsal se detienen al cierre, conservando sus datos locales.


## Congelación Git del camino certificado r4/r5

La autorización posterior al PASS permite únicamente commits locales de estos artefactos. No autoriza push, PR, merge, conexiones o escrituras Production, promoción, deploy ni habilitación de Torneos. Esta fase no modifica contenido funcional ni repite el rehearsal; contrasta los 48 hashes de fuente y ejecución contra r4 y r5, sus fingerprints y la evidencia final conservada localmente.

### Artefactos funcionales conservados

- `scripts/production-specific-rehearsal.mjs`: runner definitivo de los 48 pasos r4/r5. Su rama r3 fue usada para preparar el bridge; r4/r5 exigen que ese bridge congelado coincida exactamente. r3 no es el procedimiento definitivo.
- `scripts/production-specific-catalog.mjs`, `scripts/production-specific-sql.mjs`, `scripts/production-specific-contracts.mjs` y `scripts/production-specific-gate.mjs`: captura, separación SQL, resolver de contratos y gate final.
- `scripts/production-upgrade-local.mjs`, `scripts/production-upgrade-relay.mjs` y `scripts/production-upgrade-test-target.cjs`: restore y adaptadores locales usados por el rehearsal y las suites existentes. Los destinos, rutas locales y guards originales se conservan intactos; no constituyen un runner remoto de promoción.
- `scripts/production-specific-fixture.mjs` y `scripts/production-specific-live.mjs`: generador sintético y checks Social/Auto-Match del AFTER final. Los identificadores del código son fixtures; no son datos exportados de Production.
- `scripts/production-specific-classify.mjs`: clasificador que produjo la evidencia final. Para regenerar la comparación histórica necesita el log parcial original, conservado fuera de Git; ese log no es una entrada del runner ni del gate definitivo.
- Los cinco SQL `20260903205715`, `20260903213454`, `20260903213456`, `20260903214331` y `20260903214514` de `docs/operations/production-upgrade-proposals/`: puentes exactos del manifest. Los comentarios originales de propuesta/local se mantienen para preservar sus hashes; la certificación es local y no concede autorización Production.
- `docs/operations/production-upgrade-proposals/production-specific-baseline.json` y `expected-torneos-delta.json`: hashes de referencia e inventario explícito de las adiciones autorizadas. El inventario sólo contiene definiciones de objetos y privilegios esperados; no contiene BEFORE, ledger restaurado, filas de negocio, passwords ni secretos.
- `artifacts/production-upgrade-20260903/fingerprint-queries.json` y `migration-classification.json`: entradas exactas que consumieron r4/r5, incorporadas expresamente pese al ignore general de `artifacts/`. La primera contiene consultas SQL, no sus resultados. La segunda contiene clasificación, orden, hashes y sentencias de fuentes del repositorio, no filas del restore. Sus rutas históricas se mantienen para no cambiar código certificado. La selección `rehearse` más los puentes/sustituciones del runner coincide con los 48 pasos del manifest; no se usa el ejecutor exploratorio.

### Evidencia documental conservada

Este informe, `bridge-statements.json`, `promotion-manifest.json` y `canonical-failure-classification.json`, estos tres bajo `docs/operations/production-upgrade-proposals/`. La clasificación se copia sin alterar bytes desde r5. El manifest conserva referencias y hashes de ejecutables locales; los ejecutables y outputs se regeneran mediante el rehearsal y no se incorporan al repositorio.

### Inventario excluido

Los siguientes seis archivos nuevos quedan locales y sin commit, sin eliminarlos:

- `docs/operations/torneos-production-backend-upgrade-prep-blocked.md`
- `docs/operations/torneos-production-backend-upgrade-prep-local-rehearsal.md`
- `docs/operations/torneos-production-backend-upgrade-prep-resume-database-metadata.md`
- `docs/operations/torneos-production-backend-upgrade-prep-resume-memberships.md`
- `scripts/production-upgrade-plan.mjs`: generador exploratorio con ejecutor bloqueado/deshabilitado; se conserva únicamente su clasificación exacta consumida por r4/r5.
- `scripts/production-specific-gate.test.mjs`: cinco comprobaciones auxiliares que apuntan a evidencia r3. Se mantiene el resultado histórico declarado arriba, pero este archivo no se presenta como un test r4/r5 reproducible desde Git.

Todos los demás outputs ignorados de `artifacts/` siguen fuera de Git: BEFORE/AFTER, dumps, schema dumps/diffs, restores, ledger, bootstrap, fixtures materializados, logs, ejecutables generados y datos de containers. El snapshot externo `/Users/nicoavayu/Downloads/arma2/production-db-snapshot-20260903` permanece fuera de Git y no se modifica. Un checkout por sí solo no incluye ese material local: repetir el rehearsal exige disponer del snapshot autorizado por separado y preparar el entorno aislado descrito en este informe. La certificación y sus límites no cambian por estos commits.
