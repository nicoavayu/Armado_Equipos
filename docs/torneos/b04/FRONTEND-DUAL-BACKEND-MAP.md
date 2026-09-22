# B04 — Foundation frontend dual-backend

> **Estado 2026-09-21:** documento de la foundation (pre-R4). La integración B04 está implementada y verificada; la referencia vigente es [B04-FRONTEND-INTEGRATION-REPORT.md](B04-FRONTEND-INTEGRATION-REPORT.md). Lo que abajo dice «futuro», «reservado» o «desactivado» ya no aplica.

**Estado: foundation local desactivada, pendiente de revisión. No B04 PASS.**

Base exacta: `2058da039a2a5eaaed22d87d01946bc596ae5f50`.
Branch: `codex/torneos-b04-dual-backend-foundation`.
Worktree: `/Users/nicoavayu/Downloads/arma2/arma2-b04-dual-backend-foundation`.

## Fuente y auditoría

Los seis documentos solicitados no existían en la base. Estos documentos son nuevos y reconstruyen sólo lo necesario a partir del frontend y la allowlist Phase 2D existente. No atribuyen conclusiones a auditorías ausentes.

Fuente de scope, leída sin modificar: `backend/torneos/phase2d/staging-v1-rpc-allowlist.json`. La snapshot frontend tiene exactamente sus 43 operaciones. El guard comprueba igualdad; el inventario legacy se verifica contra objetos Git de la base exacta.

Resultado: 160 sitios RPC / 160 nombres distintos; 34 nombres migrables por scope, 126 bloqueados en la foundation y 9 permitidos por contrato sin uso frontend actual. Listas completas, funciones y líneas: [TORNEOS-CALL-MAP.md](TORNEOS-CALL-MAP.md).

## Arquitectura resultante

```text
Runtime actual (sin cambios)
  Login / AuthProvider / servicios Core
    -> lib/supabaseClient.js (singleton existente)
  lib/coreSupabaseClient.js
    -> reexport del MISMO singleton (sin nuevo createClient)
  /torneos legacy
    -> servicios legacy -> wrapper services/api/supabase -> singleton Core
  laboratorio isolated/ existente
    -> prueba SSO loopback previa; NO se reutiliza ni activa para B04

Foundation nueva (no importada por el runtime)
  config -> nombres de destinos separados, enabled: false
  stagingV1Service -> métodos agrupados de 8 features aprobadas
    -> torneosClient.execute
       fuera de scope -> TORNEOS_OUTSIDE_STAGING_V1
       dentro de scope -> TORNEOS_TRANSPORT_NOT_CONNECTED
       SIN transporte, SDK Supabase, sesión, token, storage o fallback
```

Las garantías de separación nuevas corresponden a la foundation. El legacy sigue usando Core; afirmar aislamiento global de `/torneos` sería incorrecto. No se cambian rutas ni flags existentes ni se inyecta esta interfaz incompleta en el provider legacy. Configurar envs o pasar un transporte como argumento no puede activarla.

No se construye un cliente Supabase Torneos. El futuro adapter HTTP gateway y, cuando corresponda, Data API, ocuparán la frontera `torneosClient`; no se define ni se prueba un endpoint real en B04. La foundation no presupone rutas de exchange, TTLs, CORS, bearer o contratos de error de R2/R3/R4.

## Mapa de cambios

| Archivos | Cambio |
| --- | --- |
| `src/lib/coreSupabaseClient.js` | Alias explícito del singleton actual. |
| `src/features/torneos/foundation/config.js` | Resolver puro reservado; rechaza aliases Core parciales/conflictivos, credenciales en URL y colisión de origen Core/Torneos. No se conecta al runtime. |
| `src/features/torneos/foundation/stagingV1Scope.js` | Snapshot congelada exacta de las 43 operaciones. |
| `src/features/torneos/foundation/torneosClient.js` | Cliente inerte con errores tipados por código; no tiene auth ni transporte. |
| `src/features/torneos/foundation/stagingV1Service.js` | Métodos explícitos por operación, agrupados por feature; recibe parámetros RPC existentes sin reinterpretarlos. |
| `config/frontend-dual-backend.env.example` | Nombres vacíos, sin endpoints ni credenciales. |
| `scripts/torneos-frontend/audit.mjs` | Auditoría AST, grafo de imports y lectura de objetos Git de la base. |
| `scripts/torneos-frontend/guards.mjs` | Guards estáticos y de crecimiento de accesos legacy/transitivos. |
| `scripts/torneos-frontend/foundation.test.mjs` | Tests offline de cliente, sesión, scope, configuración y mutaciones negativas. |
| `scripts/torneos-frontend/report.mjs` | Reproduce mapa e inventario desde la base exacta. |
| `package.json` | Script `test:torneos:frontend-foundation`, incluido al inicio de `test:ci`. |
| `docs/torneos/b04/*.md`, `legacy-audit.json` | Entrega, inventario verificable, matrices y plan de integración/tests. |

## Diff resumido y límites

Implementación aditiva; sólo `package.json` cambia entre archivos preexistentes. Se conserva byte por byte `src/lib/supabaseClient.js`. No se migró ninguna de las 160 RPC ni se cambiaron tablas, backend, migrations o allowlists existentes. No se modificaron dependencias ni lockfile; se usaron dependencias locales mediante symlink ignorado `node_modules`.

El gating es efectivo en la frontera nueva: ninguna operación puede emitir tráfico. Los flujos legacy fuera de scope están inventariados, no habilitados para staging-v1 ni reescritos. No se deben montar sus pantallas en la futura composición staging-v1.

## Lecturas

- [Configuración](FRONTEND-ENV-MATRIX.md)
- [Sesión y auth](FRONTEND-AUTH-FLOW.md)
- [Integración después de R2/R3/R4 y riesgos](FRONTEND-MIGRATION-PLAN.md)
- [Tests y resultados](FRONTEND-TEST-PLAN.md)
