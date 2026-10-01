# G1_MAIN_INTEGRATION_READY

Preparación local del 01/10/2026. Branch `codex/g1-main-integration`, worktree `/Users/nicoavayu/Downloads/arma2/arma2-g1-main-integration`.
Base exacta: `main` y `origin/main` locales en `46479c6470a47a43dd702f3ccf098fb8ee73b314`, coincidente con el source web aportado. No se hizo fetch ni se modificó main.

## Procedencia y alcance

- G1 localizado en `/Users/nicoavayu/Downloads/arma2/arma2/.claude/worktrees/arma2-torneos-perf-v2-f20a57`, branch `claude/arma2-torneos-perf-v2-f20a57`, HEAD `d2edf66d0043d4534148c8d18693c6bb4900264a`. Worktree de origen limpio al inspeccionarlo.
- Implementación original: `19749576835ad5ef24ea277820e675a76d9ced87`. El estado `d2edf66d` agrega documentación y otros trabajos a esa implementación.
- Se extrajeron únicamente `torneos-gateway/index.ts` y la suite G1. No se hizo cherry-pick de la rama completa. Quedan excluidos frontend, cache, G3 y las propuestas/migraciones 0007.
- Ningún conflicto con main. El archivo index.ts resultante coincide exactamente con G1. El árbol completo de funciones coincide con d2edf66d; dentro de ese árbol, contra main sólo cambia index.ts.
- El grafo alcanzable de 17 archivos coincide por SHA-256 con G1. Digest del manifiesto: `cfe5cd02e5de9703c7b2634ccea196070f3e188f9d859754f299adb0e020ccd2`. Dependencias conservadas: `npm:jose@6.2.12`, `npm:postgres@3.4.7`.

## Diff explicado

El gateway pregunta al mismo tiempo por la salud de GoTrue y la sesión en Core. Para RPCs privados, esa validación de sesión también se ejecuta al mismo tiempo que el SELECT de identidad local. Espera todos los resultados y los interpreta en el orden previo: salud, sesión, identidad. Sólo después de que todos pasan puede continuar hacia el adapter o PostgREST.

Son dos bloques `Promise.allSettled`, con 24 líneas agregadas y 8 removidas en index.ts. No cambia qué autoridades se consultan, qué claims se aceptan ni qué operaciones quedan permitidas. `/exchange` conserva `/user` primero e identity upsert después de las validaciones. La consulta anticipada de sesión e identidad ante un fallo es el comportamiento G1 ya certificado.

Archivos funcionales y de soporte:

1. `backend/torneos/supabase/functions/torneos-gateway/index.ts`: copia exacta del G1 certificado.
2. `backend/torneos/perf-v2/g1-parallel-checks.test.mjs`: suite original, fijando BEFORE al main actual para validar esta integración.
3. `backend/torneos/perf-v2/g1-main-integration.test.mjs`: identidad del grafo, alcance contra main, paquete sin cambios ajenos y secret scan.
4. `package.json`: sólo agrega `test:torneos:g1`; no cambia dependencias ni lockfiles.
5. `docs/torneos/perf/g1-main-integration/*`: este informe, manifiesto y evidencia local de validación.

## Validación

| Ejecución | Resultado |
| --- | --- |
| `npm run test:torneos:g1` | 10 tests PASS; incluye matriz de 72 combinaciones, precedencia, bearers inválidos, identidad, timeouts, concurrencia y exchange |
| Gateway auth, topology, JWKS, remote, competition, officialization y phase3b gateway-port, `node --test --test-concurrency=1` | 72 PASS, sin skips |
| `node --test integration/torneos-core-contracts/deno-runtime-hardening.test.mjs` | 30 PASS |
| `npm run test:torneos:frontend-foundation` | 89 PASS |
| Commerce suite completa | 97 PASS / 2 FAIL en ejecución combinada: un subtest histórico de scope y su padre; exige que sólo existan cambios MP-A4 contra una base antigua |
| Commerce con `--test-skip-pattern='U scope:'` | 32 PASS; no se modifica el guard original; alcance G1 validado separadamente |
| Deno suite completa, Deno 2.9.7, dependencias cacheadas | 6 PASS / 2 FAIL: aserción histórica de tipos y su padre; TypeScript 6 también detecta errores previos en payments |
| Deno suite con `--test-skip-pattern='type check:'` | 7 PASS; arranque real y rechazos en loopback, sin proveedores ni DB |
| `deno check --cached-only --no-lock` gateway, main/G1 | Los mismos 6 errores previos; comparación completa igual al normalizar rutas y posiciones |
| `deno lint --json` gateway, main/G1 | Las mismas 9 advertencias `no-explicit-any`; sin nuevas |
| `npm run lint` | PASS; aviso de antigüedad de Browserslist |
| ESLint tests con `--env node,es2020` | PASS |
| `npm run migrations:guard` | Guard PASS y 8 tests PASS |
| `npm run staging:static-guard` | `STAGING_STATIC_GUARD_OK secrets=0 unknownProjectHosts=0` |
| `git diff --check` y secretFindings sobre todos los archivos cambiados | PASS |

Los logs completos y `validation-summary.json` explican los fallos históricos; no se presenta la suite completa de Deno como verde. No se arreglan tipos ni lint del runtime para conservar exactamente el código certificado.

## Seguridad y equivalencia

Misma autoridad Core, fail closed, identidad vinculada a los claims, validación criptográfica de bearer, RPC allowlist, CORS y bridge TTL. Se conservan los errores 401/403/503 y `CORE_UNAVAILABLE`, y Commerce OFF. Los tests verifican que un bearer inválido o RPC no permitido no llega a dependencias; que adapter/PostgREST no se ejecutan antes de completar las validaciones; y que los tres checks comienzan antes de que termine el primero. No reaparece el camino serial eliminado por G1.

La equivalencia con Production se demuestra respecto del source G1 identificado en el handoff aprobado: identidad byte por byte del grafo y pruebas locales sobre el handler real. La referencia es Cloud Run `southamerica-east1`, `torneos-gateway-00001-7lw`, Deno 2.9.7, con web `app.arma2.com.ar`, Vercel `dpl_2j2NBLA747Y6ocnr9JtLLcYmEg2T` y certificación `SAO_PAULO_WEB_PRODUCTION_READY`.

Se contrastó además evidencia ya archivada en `/tmp/arma2-cloudrun-service.json`, `/tmp/ARMA2-post-cutover-Sao-Paulo.md` y dos snapshots de logs: revisión 00001-7lw, tráfico 100%, 0 HTTP 5xx y 0 CORE_UNAVAILABLE. Son snapshots anteriores, no una nueva certificación live. No se inspeccionó la imagen remota ni se ejecutaron probes de Production durante este trabajo; la asociación source G1 ↔ revisión Production proviene del handoff aprobado. Los hashes y conteos de snapshots están en `validation-summary.json`.

## Commits locales

- `15b5b1f8`: implementación G1, suite de equivalencia contra main, guard de integración y comando npm.
- Segundo commit local: informe y evidencias; identificarlo con `git log -2 --oneline`.

## Límites y siguientes autorizaciones

Sin cambios en Cloud Run, Vercel, Deno Production, Supabase, DB, Android, iOS, DNS, jwks_url, Billing, Mercado Pago, env, secrets ni shadows. Sin push, PR, merge ni deploy. Fixtures criptográficas efímeras, DB stubs y loopback; las pruebas no usan credenciales reales. Las evidencias generadas incidentalmente en directorios históricos se restauraron o trasladaron a este informe, fuera del runtime.

Deno 2.9.7 tiene compatibilidad funcional comprobada; el chequeo estricto no está limpio por deuda previa, igual que main. La resolución de npm requiere conservar la raíz de functions fuera del package.json web, tal como Production. No se incorporó Dockerfile ni configuración de infraestructura.

La branch local queda lista para revisión. Después se requiere autorización explícita para push y creación de PR, y luego para merge a main. Si main avanza, reconciliar y repetir las validaciones afectadas. Deploy y limpieza de shadows requerirían autorizaciones independientes. STOP tras entregar los commits locales.
