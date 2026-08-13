# Arma2 Torneos — QA LOCAL post-fix de P1

Fecha: 2026-08-12  
Estado: **REVIEW**  
Branch: `feature/torneos-space-switcher`  
Commit observado: `e1068460` (worktree sin stage ni commit)  
Backend: Supabase LOCAL `arma2-torneos-qa-seed`  
Semilla: `QA_SCENARIO_SEED=20260812`

## Resultado

- `QA-TOR-P1-003` (contexto de Fixture/RPC 403 en el informe baseline): corregido.
- `QA-TOR-P1-001` (loading indefinido ante fallo/timeout en el informe baseline): corregido.
- `QA-TOR-P1-002` (collaborator en Configuración en el informe baseline): cerrado con el contrato aprobado de acceso en modo lectura.
- Hallazgos nuevos: ninguno.
- Severidades post-fix: P0 **0**, P1 corregidos **3**, P1 pendiente de decisión **0**, P2 **0**, P3 legacy **1**.

## Causas raíz y cambios

### Contexto de torneo/categoría

`TorneosFixtureContext` conservaba `categoryId` como estado independiente. Al
cambiar el torneo, React alcanzaba a renderizar el torneo nuevo con la categoría
del torneo anterior antes de que el efecto correctivo actualizara la categoría.
Ese render lanzaba `get_tournament_fixture_context` y
`get_tournament_schedule_context` con una tupla inválida. El backend rechazaba
correctamente la combinación con 403; no era un defecto de RLS.

La categoría efectiva ahora se deriva sincrónicamente de las categorías activas
del torneo actual. Una preferencia previa sólo se usa si pertenece al torneo
actual. `scopeKey`, contexto React e IDs enviados a servicios quedan atómicos.
No se cambiaron RLS, permisos, Auth, migraciones ni IDs QA.

### Loading indefinido

Los contextos ya convertían una promesa rechazada en error, pero no existía un
límite de tiempo común para una promesa que quedaba pendiente. En ese caso el
`catch/finally` nunca se ejecutaba y el estado permanecía en `loading`.

El servicio expuesto por `TorneosWorkspaceContext` ahora aplica un límite de 12 s
mediante la utilidad compartida `withTimeout`. El rechazo usa los estados de
error/retry existentes; no hay retry automático. Los helpers sincrónicos siguen
siendo sincrónicos. La interfaz de servicio actual no expone `AbortSignal`, por lo
que no se simula cancelación: las protecciones de request/scope existentes
descartan resultados tardíos.

### Contrato de collaborator cerrado

La decisión aprobada confirma como fuentes de verdad la matriz documental,
`domain/capabilities.js` y el contrato activo del backend. `collaborator` conserva
`organization.read`, `members.read` y `workspace.access`: entra a Configuración,
Plan y Miembros en modo lectura, sin capacidades de escritura. Owner y admin
conservan edición; sólo owner conserva el archivado de la organización.

El E2E dejó de aplicar la simplificación “admin vs. resto” y ahora comprueba el
contrato de cada rol mediante navegación normal, URL directa, refresh e intento
de escritura. Para collaborator valida además campos deshabilitados, ausencia de
acciones administrativas, cero RPC de mutación desde la UI y rechazo 403 de una
invocación directa al RPC de actualización. Delegate, player y outsider siguen
sin acceder a las rutas organizacionales. No se modificaron Auth, RLS,
capabilities, RPC, migraciones, IDs, enums ni fixtures.

Los nombres y descripciones visibles se centralizaron en
`domain/rolePresentation.js`; los slugs internos permanecen en inglés.

## Tests

- Red-first focal: la prueba de cambio de torneo falló antes del fix mostrando
  `tournament-b/category-a`; la prueba de timeout quedó pendiente antes del boundary.
- Focal previo: **17/17** (`FixtureContext`, `WorkspaceContext`, `promiseTimeout`).
- Focal roles/permisos/localización: **46/46**, 3 suites.
- E2E Configuración por rol: **42 pass**, **18 skips esperados** por viewport/entorno.
- Suite relevante de Torneos: **380/380**, 39 suites.
- Suite completa: **2123/2123**, 271 suites.
- ESLint: pass.
- Build de producción: pass.
- `git diff --check`: pass.

La verificación transaccional contra el backend LOCAL confirmó que owner y admin
pueden invocar la actualización y que collaborator recibe
`TORNEOS_ORGANIZATION_FORBIDDEN`; todas las transacciones se revirtieron. El
runner embebido de tests DB no pudo iniciar por una dependencia ICU local
ausente, por lo que ese comando no se contabiliza como pass.

Los casos nuevos cubren A→B→A sin categoría cruzada; 500; 504; promesa que no
resuelve; retry exitoso; retry fallido sin loop; y preservación de helpers
sincrónicos.

## Scenario matrix y crawler post-fix

- Matriz preservada: **110 escenarios definidos/materializados**.
- Crawler autenticado:
  - **42/42 tests pass**;
  - **36 combinaciones rol × viewport**;
  - **408 visitas**;
  - **34 scenario IDs** visitados directamente;
  - **23 URLs finales únicas**;
  - **408/408 navegaciones HTTP 200**;
  - findings: **0**;
  - page errors, console errors inesperados y HTTP errors inesperados: **0**.
- History (refresh, deep link, Back/Forward): **6/6 pass** dentro de los 42.
- Sin sesión/guards: **42/42 pass**.
- Focal owner post-refactor: **1/1 pass**, 15 visitas, 0 findings.

Warnings registrados (eventos repetidos, no bugs distintos): **2336**:

- 888 warnings de consola, principalmente las dos future flags v7 de React Router;
- 1325 requests abortadas por navegación rápida, clasificadas por el crawler como ruido esperado;
- 24 mensajes de consola por denegación esperada;
- 12 respuestas 403 esperadas para accesos sin permiso.
- 87 eventos externos equivalentes (29 HTTP, 29 request y 29 consola) por el
  recurso legacy de Inter, el P3 explícitamente fuera de alcance.

La primera repetición post-fix dio 36/42 porque el crawler podía declarar la
página estable en el DOM vacío previo al montaje de React y observar el loader
219–594 ms después. Se agregó un marcador estable al loader y una ventana de
400 ms sin loader; la repetición completa final pasó 42/42. No se clasificó esa
carrera del harness como regresión de producto.

El P3 legacy de la fuente Inter permanece fuera de alcance y no fue modificado.

## Evidencia

- Baseline: `docs/qa/torneos-local-qa-report-2026-08-12.md`.
- Matriz: `docs/qa/torneos-local-scenario-matrix.md`.
- Crawler final: `artifacts/playwright/post-fix-exhaustive-final/` y
  `artifacts/playwright/post-fix-exhaustive-final.json`.
- Crawler owner posterior al refactor: `artifacts/playwright/post-refactor-focused-owner/`.
- Crawler focal de roles: `artifacts/playwright/roles-crawler-final/`.
- Guards sin sesión: `artifacts/playwright/post-fix-unauthenticated/` y
  `artifacts/playwright/post-fix-unauthenticated.json`.

## Estado LOCAL

- React: `http://127.0.0.1:3000/torneos`.
- Supabase API: `http://127.0.0.1:57321`.
- Supabase Studio: `http://127.0.0.1:57323`.
- REVIEW; sin commit, stage, push, PR, merge ni deploy.
