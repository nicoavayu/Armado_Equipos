# TORNEOS PLAN INTEGRATION — Mi plan + PLAN READ + 0007

Fecha: 2026-10-01. Base: `origin/main` `4a8c5bbe62fc340df9308b3e3b773a98d75b6cd1` (G1 #167 + build 44 #168).
Branch: `integration/torneos-plan-read-0007`. Sólo local: sin push, PR, merge ni deploy.

## Qué entra

| Pieza | Origen | Contenido |
|---|---|---|
| UX Mi plan | `33eee168` | Navegación "Mi plan", badge de plan en el header, pantalla informativa por temporada, upsells contextuales y nada de checkout. Harness offline `scripts/qa/plan-ux/` |
| PLAN READ | `8c63e648` | Opt-in de lectura independiente de Billing, en frontend y gateway (`plan-read.ts`, sólo 2 RPC de lectura) |
| Guards G1 | `6726a07d`, `189e5d44` + esta integración | El grafo G1 sigue byte-idéntico salvo el delta de composición; el grafo completo queda fijado al candidato certificado en el shadow |
| 0007 | `23504d4c` | `00000000000007_season_entitlements_scope.sql`, el rollback, el lab desechable y `season-scope-fix/REPORT.md` |

No entran las capturas PNG (unos 10 MB), los dumps de evidencia de `plan-read-evidence/` ni los informes `*-LOCAL-READY` / `SHADOW-CERTIFICATION` de la rama UX. Tampoco los archivos sin trackear del worktree codex ni las herramientas remotas (`db7.mjs`). El código de producto es byte-idéntico a la cabeza UX certificada `ceb8e21e`.

## Flags (defaults seguros)

| Capa | Variable | Default | Efecto en ON |
|---|---|---|---|
| Gateway | `TORNEOS_PLAN_READ_MODE` | ausente/`off`: no cambia la allowlist | Agrega sólo `get_effective_tournament_season_entitlements` y `get_effective_tournament_entitlements`. Cualquier otro valor cierra el boot |
| Frontend | `REACT_APP_TORNEOS_PLAN_READ_MODE` | sólo `on` (exacto) en composición `hybrid` | `entitlements=true` + `plan=true` (overlay `stagingV1PlanReadOverlay`); conserva `billing=false` |
| Billing / Commerce / MP | `TORNEOS_COMMERCE_MODE`, billing | OFF | Sin cambios. Production sigue rechazando commerce |

Ninguna variable se agrega a archivos versionados. **Mergear no activa PLAN READ.**

**Gate visual (pre-PR hardening):** el feature `plan` volvió a OFF en el mapa híbrido base (igual que en `main`) y sólo lo enciende el overlay de PLAN READ, junto con `entitlements`. Con el flag OFF no existen la entrada "Mi plan" de la navegación ni la de Configuración, el contenedor `#torneos-plan-context` del header (que además cambia el layout del topbar), el badge del selector ni las rutas `mi-plan` / `temporada/:id/plan` (muestran "todavía no está habilitada"), y no se pide ninguna lectura de plan. Con el flag ON aparecen todos y los estados internos no cambiaron: FREE / PREMIUM confirmados por temporada, "Cargando plan…", **"Lectura no disponible"** (lectura denegada o no servida) y "Error transitorio". Nunca se inventa FREE.

Diferencia visual con `main` en OFF: `main` mostraba en el selector una píldora "Plan no verificado" con un torneo activo (la lectura nunca estaba servida en hybrid). Con el gate esa píldora tampoco aparece: con el flag OFF no hay ninguna superficie de plan.

**Discoverability mobile (2026-10-02, post-certificación web):** en mobile "Mi plan" era el ítem 8 de 9 de la barra inferior y había que scrollearla para encontrarlo. No se reordenó la barra: las cinco primeras siguen siendo Inicio, Torneos, Equipos, Fixture y Partidos, y "Mi plan" sigue en ella. Lo que cambió es la entrada del header (`#torneos-plan-context`), que ya estaba arriba en todas las pantallas de la organización pero sólo decía "FREE · Temporada". Ahora dice **Mi plan**, muestra el plan como badge (FREE / PREMIUM / estados no confirmados), luego la temporada y un chevron, y su nombre accesible es el mismo. Además, la barra inferior trae a la vista su ítem actual cuando está fuera de las cinco primeras (Mi plan en la ruta de temporada, Ajustes). Sólo se mueve la barra, nunca la página. Desktop recibe la misma entrada, con el rail sin cambios. El flag sigue igual: con PLAN READ OFF no se ve nada de esto, y Billing, Commerce y MP siguen OFF. Para verificarlo, `scripts/qa/plan-ux/browser-check.cjs` (escenarios `discoverability`, 390 y 320).

**Disponible hoy vs Próximamente (2026-10-02):** la tabla FREE vs PREMIUM de Mi plan (`domain/planComparison.js`, `PLAN_COMPARISON`) lista sólo lo que hoy se usa en Production: fixture/partidos/actas/tabla, página pública y comunicados, y colaboradores por temporada. Estudio Social, galería de fotos y logos y escudos (`social_studio`, `media` y `branding_assets` siguen en `false` en la composición híbrida) viven en una sección aparte, **Próximamente** (`PLAN_COMING_SOON`), que explica en pocas palabras cómo se van a repartir entre los planes, sin nombres internos. El sello del plan sigue centrado. `browser-check.cjs` verifica en 1440/390/320 que la tabla no mencione nada de Próximamente y que esa sección no desborde.

**Sello FREE/PREMIUM en teléfonos (2026-10-02):** hasta ahora el sello (`.planSignal`) tenía `display: none` a ≤520 px, así que en 390/320 no había sello y la medición "offset (0, 0)" medía una caja de 0×0. Ahora se ve en todos los anchos. A ≤520 px es un emblema compacto de 88–100 px (`clamp(88px, 25vw, 100px)`), centrado encima del texto, con FREE en 26–32 px y PREMIUM en 16–18 px. La tarjeta crece entre 80 y 110 px. A ≤760 px (la columna de 108 px, o sea 700 y 540) el escudo y la palabra se achican y los anillos se acercan al borde: con 48 px, FREE salía 4 px del círculo. Desktop (1440/1024) no cambia. El header "Mi plan" tampoco. El test estático (`torneosPlanExperienceResponsiveCss.test.js`) falla si alguna regla del sello lo oculta o lo colapsa. `browser-check.cjs` mide el sello en 1440/1024/700/540/390/320 con FREE y PREMIUM, usando Bebas Neue local (`plan-ux/fonts.css`). Antes de medir, falla si el sello está oculto, con opacidad 0 o con una caja de 0×0. Después mide:

- el círculo tiene al menos 88 px;
- el emblema está centrado (±1,5 px);
- la palabra entra en el círculo con 4 px de margen;
- el sello no está recortado por la tarjeta, no pisa el texto y no lo tapa nada;
- en teléfonos está centrado en la tarjeta y mide 120 px o menos.

Si otro worktree ocupa el puerto 3187, se usa `PLAN_UX_PORT`.

## 0007 = lo aplicado en Production

- Archivo: sha256 `ba0450f965f3357679e493efc8ac465eb37c836dafccdf21138ea9244d85a205`. Es el pin del gate de apply de Production.
- Cuerpo `md5(prosrc)`: `bf263acafb185ee0993117d5805bc701`. Coincide con lo observado en `onzpwnqxnvlgsevivngf` después del apply. Antes era `a533331a…`, que es el cuerpo del baseline.
- Rollback: sha256 `054985997ea06a0c7745f1e700489a9b879cbd40f0320d83d7049780f2758be3`. Restaura `a533331a…`.
- Contenido sin modificar. No se vuelve a aplicar: la pre-condición acepta `bf263aca…` y re-aplicarla no hace nada.
- Guard: `backend/torneos/season-scope-fix/season-scope.test.mjs`.

## Certificación live (shadow `tgw-sp-g1`, 2026-10-01, PLAN READ ON, Billing/Commerce/MP OFF)

- Org QA + temporada QA: 200. Lectura por torneo: 200.
- Temporada QA + otra org, org QA + temporada ajena, temporada inexistente y org inexistente: 403 `TORNEOS_ENTITLEMENTS_FORBIDDEN`.
- Plan: FREE, `default_free`, schemaVersion 4. Galería 25, 1 colaborador administrativo + owner, Social Studio Base 3.
- Sin bearer o bearer inválido: 401. RPC desconocida y las 14 RPC comerciales: 403. Checkout y MP: 404.
- El grafo del gateway de esta branch es el candidato desplegado en el shadow: 18 archivos, digest `80f94685…`.

## Guards actualizados (representan el contrato nuevo; ninguno se borró)

- `backend/torneos/perf-v2/g1-main-integration.test.mjs`
  - Mide la confinación desde la base de integración, no desde un commit local de UX.
  - Clone-clean: G1 = manifiesto versionado fijado por digest; ningún objeto Git fuera de origin.
  - Fija el digest del shadow.
  - Exige que 0000–0006 queden intactas.
- `backend/torneos/infra/torneos-officialization-error-v1/oec-remote-contract.mjs` + test
  - 0007 y su rollback pasan a ser conocidos y quedan fijados por hash.
  - OEC sigue enviando sólo 0005/0006.
  - El conteo del candidato W3 se deriva, ya no está fijo en 17.
- `integration/torneos-core-contracts/exposure.test.mjs`: el lab espera 0007 después de 0006.
- `deno-runtime-hardening.test.mjs` y `remote-test-enablement.test.mjs`: `TORNEOS_PLAN_READ_MODE` queda declarado como variable del gateway, no secreta. Las listas prohibidas de MP/pagos no cambian.
- `gateway-remote.test.mjs` y `competition-remote.test.mjs`: el grafo del gateway pasa de 17 a 18 archivos y `plan-read.ts` es obligatorio.
- `backend/torneos/plan-read/plan-read.test.mjs`: la línea de base UX `33eee168` (no está en origin) se lee de `4a8c5bbe:` con los blob ids fijados (`6abec1b1…` index.ts, `c9ceb508…` baseline SQL): son los mismos blobs, así que la comparación sigue siendo exacta y la suite es clone-clean.
- `src/__tests__/torneosOrganizationPermissions.test.jsx`: el fixture de cupos usa un plan read confiable, y un caso nuevo cubre el payload no confiable (`0 / —`, sin upsell).
- `docs/torneos/b04/*`: regenerado con `node scripts/torneos-frontend/report.mjs`.

## Rollout propuesto (cada paso con go explícito)

1. **Push + PR** de esta branch. CI: lint, build, test:ci, migrations guard.
2. **Merge.** Si Vercel publica `main`, el frontend sale con PLAN READ OFF: sin "Mi plan", sin badge y sin lectura de plan (gate visual). No hay ventana visible antes de activar.
3. **Gateway Production** (Cloud Run SP) con el código mergeado y `TORNEOS_PLAN_READ_MODE` ausente.
   - Verificar que la allowlist no cambió: los RPC de plan dan 403 `rpc not enabled` y G1 queda igual.
   - Rollback: revisión anterior.
4. **Activar PLAN READ en el gateway**: `TORNEOS_PLAN_READ_MODE=on`, sin env de commerce, billing ni MP.
   - Rollback: quitar la variable y volver a la revisión del paso 3.
5. **Certificar el gateway Production** con la misma matriz del shadow: 200/403/401, las 14 comerciales en 403 y checkout en 404. Un solo `/exchange`.
6. **Activar el frontend Production**: `REACT_APP_TORNEOS_PLAN_READ_MODE=on` en Vercel Production y redeploy. Billing sigue OFF.
   - Rollback: quitar la variable y redeploy. No toca la DB.
7. **Certificar la UX** en Production: Mi plan FREE/PREMIUM, badge, cambio de temporada, desktop/mobile y que no haya checkout.
8. **Recién después, Android**: un build nuevo que incluya este frontend y apunte al gateway con PLAN READ.

La DB no requiere más pasos: 0007 ya está aplicada. Su rollback sólo debe usarse con PLAN READ y Commerce en OFF.

## Pendientes / riesgos

- ~~`plan` visible con PLAN READ OFF~~ — resuelto: `plan` pasó al overlay de PLAN READ; `foundation.test.mjs` (T13), `torneosStagingV1Composition` y `commerce.test.mjs` (F1) volvieron a su forma de `main` (`plan` OFF en el mapa base) y F1 fija además el overlay exacto `{ entitlements, plan }`. Tests nuevos de flag OFF/ON en `torneosMpA5HybridCommerce` (nav, header, badge, FREE/PREMIUM, "Lectura no disponible", "Error transitorio") y en `torneosStagingV1Gate` (env ausente/`off`/`ON`/`true` → nada de plan, ninguna request de entitlements).
- El clasificador remoto OEC (`classifyState`) sigue fijado en POST_0006. Contra Production reporta `OEC_PATH_DRIFT functions.bodies_md5` por 0007. Es esperado y no se usa en este rollout.
- La rama owner de `has_tournament_season_access` sigue sin ligar el par. Queda un barrido de llamadores en tarea aparte (ver `season-scope-fix/REPORT.md`).
- ~~`g1-main-integration` depende de `d2edf66d`~~ — resuelto: el grafo G1 certificado sale del manifiesto versionado `docs/torneos/perf/g1-main-integration/source-manifest.json` (en `origin/main` desde #167), aceptado sólo si hashea al digest fijado en el test (`cfe5cd02…`). Un test nuevo exige que la base `4a8c5bbe` (en origin) tenga exactamente ese grafo, y el `index.ts` G1 se compara contra `BASE:index.ts` y contra el hash del manifiesto. La suite sólo lee objetos alcanzables desde origin; verificada desde un clone limpio + `npm ci`.
- Las suites históricas de fase (MP-A4 scope, r3/remote-test invariants: "exactamente 4 migrations") ya estaban rotas en `main` desde 0004. No se tocaron.
