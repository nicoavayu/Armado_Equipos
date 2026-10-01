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
| Frontend | `REACT_APP_TORNEOS_PLAN_READ_MODE` | sólo `on` en composición `hybrid` | `entitlements=true` y conserva `billing=false` |
| Billing / Commerce / MP | `TORNEOS_COMMERCE_MODE`, billing | OFF | Sin cambios. Production sigue rechazando commerce |

Ninguna variable se agrega a archivos versionados. **Mergear no activa PLAN READ.**

**Ojo:** el feature `plan` (UX informativa) ya está ON en el mapa híbrido base, por diseño aprobado y fijado por guards. Si se publica el frontend con PLAN READ OFF, se ven "Mi plan" y el badge en estado **"Lectura no disponible"**. Nunca se inventa FREE.

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
  - Fija el digest del shadow.
  - Exige que 0000–0006 queden intactas.
- `backend/torneos/infra/torneos-officialization-error-v1/oec-remote-contract.mjs` + test
  - 0007 y su rollback pasan a ser conocidos y quedan fijados por hash.
  - OEC sigue enviando sólo 0005/0006.
  - El conteo del candidato W3 se deriva, ya no está fijo en 17.
- `integration/torneos-core-contracts/exposure.test.mjs`: el lab espera 0007 después de 0006.
- `deno-runtime-hardening.test.mjs` y `remote-test-enablement.test.mjs`: `TORNEOS_PLAN_READ_MODE` queda declarado como variable del gateway, no secreta. Las listas prohibidas de MP/pagos no cambian.
- `gateway-remote.test.mjs` y `competition-remote.test.mjs`: el grafo del gateway pasa de 17 a 18 archivos y `plan-read.ts` es obligatorio.
- `src/__tests__/torneosOrganizationPermissions.test.jsx`: el fixture de cupos usa un plan read confiable, y un caso nuevo cubre el payload no confiable (`0 / —`, sin upsell).
- `docs/torneos/b04/*`: regenerado con `node scripts/torneos-frontend/report.mjs`.

## Rollout propuesto (cada paso con go explícito)

1. **Push + PR** de esta branch. CI: lint, build, test:ci, migrations guard.
2. **Merge.** Si Vercel publica `main`, el frontend sale con PLAN READ OFF: "Mi plan" queda visible en "Lectura no disponible", sin datos inventados. Opcional: gatear `plan` detrás del opt-in antes del PR (ver Pendientes).
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

- `plan` visible con PLAN READ OFF (paso 2). Si no se quiere esa ventana, hay que mover `plan` al overlay de PLAN READ y gatear `PlanContextHeader`. Eso cambia guards aprobados (`foundation.test.mjs`, `torneosStagingV1Composition`, `commerce.test.mjs`) y necesita decisión.
- El clasificador remoto OEC (`classifyState`) sigue fijado en POST_0006. Contra Production reporta `OEC_PATH_DRIFT functions.bodies_md5` por 0007. Es esperado y no se usa en este rollout.
- La rama owner de `has_tournament_season_access` sigue sin ligar el par. Queda un barrido de llamadores en tarea aparte (ver `season-scope-fix/REPORT.md`).
- `g1-main-integration` reconstruye G1 desde `d2edf66d`, un commit que sólo existe localmente (es anterior a esta integración). En un clone limpio esa suite no corre. No está en `test:ci`.
- Las suites históricas de fase (MP-A4 scope, r3/remote-test invariants: "exactamente 4 migrations") ya estaban rotas en `main` desde 0004. No se tocaron.
