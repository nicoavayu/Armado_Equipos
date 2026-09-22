# Torneos remote staging — plan pre-deploy

Fecha: 2026-09-21. Estado: **PREDEPLOY_PLAN_READY / STOP_BILLING_AND_REMOTE_GATES**.
No es `TORNEOS_REMOTE_STAGING_PASS`. No se creó ni modificó ningún recurso remoto.

Evidencia de esta inspección: [manifiesto de fuentes](remote-predeploy-evidence/source-manifest.json),
[lecturas remotas](remote-predeploy-evidence/remote-readonly-observation.json),
[foundation](remote-predeploy-evidence/foundation.txt), [Jest](remote-predeploy-evidence/jest.txt),
[backend/operators](remote-predeploy-evidence/backend.txt).

## 1. Decisión de proyecto y billing

Lecturas MCP actuales: organización `gwqrborhnqjdzzmpxulh` (`nicoavayu's Org`), plan **Free**.
Inventario: Core staging `hhyvmhgpapyuzjgxfnqv`, ACTIVE_HEALTHY, us-east-1; Production activo
(sólo apareció en el listado global, sin consultas a su proyecto); `giaeztyghmhzcngskjmw`, INACTIVE.
No existe un proyecto Torneos remoto separado en ese inventario. El nombre del Core staging
es `arma2-torneos-staging`: **el nombre no cambia su función; no se reutiliza**.

Recurso propuesto: proyecto limpio `arma2-torneos-isolated-staging`, región **us-east-1**,
compute **Micro**, sin add-ons, DB exclusiva y una Edge Function `torneos-gateway`.
Ref: **pendiente de creación**, nunca inventarlo ni sustituirlo por el ref Core.

| Opción legítima | Costo estimado mensual USD | Consecuencia |
| --- | --- | --- |
| Organización Pro separada, misma cuenta, sólo Torneos | Desde 25: suscripción 25 + Micro ~10 − crédito 10 | Recomendada para separar billing y no cambiar el plan de la organización que contiene Production. Requiere decisión explícita y crear organización/proyecto. |
| Subir organización actual a Pro, tres proyectos activos | ~45: 25 + 3 × ~10 − 10 | Cambia el plan de toda la organización, incluida Production. No ejecutar bajo la autorización actual de “0 Production”. |
| Posponer el proyecto | 0 adicional | No permite completar remote staging ahora. |

Precios sin impuestos, sobreconsumos ni hosting frontend. Compute Micro: USD 0.01344/h;
la cifra mensual varía con las horas. Compute no está cubierto por Spend Cap. No hace falta
Team. Una organización Free adicional no agrega cupo gratuito: el límite de dos aplica entre
organizaciones del mismo Owner/Administrator. Pausar Core impide el recorrido y Production
está excluido; restaurar el proyecto inactivo tampoco elimina el límite ni es bootstrap limpio.

Fuentes verificadas: [pricing](https://supabase.com/pricing),
[billing por organización](https://supabase.com/docs/guides/platform/billing-on-supabase),
[compute](https://supabase.com/docs/guides/platform/manage-your-usage/compute).
Antes de crear: elegir organización, obtener cotización específica para ella y confirmar el costo.
No se usó `confirm_cost`, no hubo upgrade, compra ni creación.

## 2. Árboles y artefactos exactos

Frontend: `/Users/nicoavayu/Downloads/arma2/arma2-b04-dual-backend-foundation`,
branch `codex/torneos-b04-dual-backend-foundation`, HEAD `2058da039a2a5eaaed22d87d01946bc596ae5f50`.
Backend: `/Users/nicoavayu/Downloads/arma2/arma2/.claude/worktrees/plan-r2-local-f7ace5`,
branch `claude/plan-r2-local-f7ace5`, HEAD `945eeac6e8aa6765abb1a4a4ce8328835052d3ff`.
Ambos contienen cambios sin commit y archivos no trackeados: **HEAD solo no identifica la entrega**.
No hubo commit, push, merge ni PR. No se encontraron AGENTS.md aplicables.

Los archivos siguientes se toman del worktree backend:

| Artefacto | SHA-256 |
| --- | --- |
| `backend/torneos/supabase/migrations/00000000000000_torneos_baseline_v1.sql` | `f857bd0939054bc1a32a3855894b7b20e14a0c7456c9d5c8c5e8432e5b8ed19f` |
| `backend/torneos/supabase/migrations/00000000000001_staging_v1_rpc_exposure.sql` | `3df4b96eecc7321eaeda84a480f089fe4bff2b28c20aa4479db92caf33457e62` |
| `backend/torneos/phase2d/staging-v1-rpc-allowlist.json` | `149c7659f27aa6d61b512c44e1b0b0fa1bff700d4a0a3f9bdb4024418227b78c` |
| `backend/torneos/phase2d/staging-v1-rpc-gate.json` | `63ad6724840e4ae89289f310047a6730868b45222d8f5c8a1668cd178af64542` |

Los cuatro archivos son byte-idénticos entre worktrees. Allowlist: **43 nombres únicos**;
gate: **33 nombres únicos**. Gateway: los **9 archivos** de
`backend/torneos/supabase/functions/torneos-gateway/`, más `supabase/config.toml` de ese backend;
los nueve coinciden con `r4-offline-deps-20260920T170508Z.json`. Incluye el fix certificado de
`core-client.ts`; no reemplazarlo por el ejemplar antiguo de B04. Desplegar sources mediante
el import walker del operator, no el wrapper Docker ni `r4/.runtime/gateway.eszip`.

Semántica fija: RS256, TTL 120 s, tolerancia 5 s. `iss=urn:arma2:local:identity-bridge` y
`aud=arma2-torneos-local` son constantes certificadas pese a sus nombres; no renombrarlas.

Frontend: construir el árbol B04 completo de app (`src`, `public`, dependencias/lockfile y
scripts de build), con configuración remota limpia. No desplegar el build del lab ni
`lab-bridge.mjs`, fixtures, compose, `.runtime`, `.env` locales o `node_modules` symlinkeado.
El manifiesto adjunto fija las fuentes actuales; debe verificarse de nuevo antes de empaquetar.

## 3. Integridad de las certificaciones

- R4 summary: `R4_HYBRID_GATEWAY_CERTIFIED`, 0 blockers. R5 summary:
  `R5_HYBRID_E2E_CERTIFIED`, 0 blockers; journey sin required faltantes, cleanup `complete=true`.
- Manifiesto R4 del preflight utilizado por R5: **13/13 sources coinciden**.
- Gateway: **9/9 coinciden** con la evidencia del sello R4.1A; no se detectó regresión del gateway.
- Los hashes de las evidencias JSON referenciadas por R4/R5 coinciden. Los dos logs terminales
  presentes **no coinciden con los hashes guardados en los summaries**. No se imprimieron ni
  modificaron esos logs. Reconciliar su procedencia antes de afirmar integridad total de evidencia.
- `r42-final-certification-source-baseline.json` es una fotografía anterior: ocho archivos
  de operator R42 difieren. No usarla para declarar drift del gateway ni invalidar R4/R5;
  congelar los operators actuales por separado. Las fuentes de producto sí coinciden.
- B04 tiene informe PASS local, sin sello completo de todos los sources de app. El nuevo
  manifiesto registra el estado inspeccionado; no inventa una certificación histórica de esos bytes.

## 4. Operators, custody y protección de destinos

Reutilizar `backend/torneos/phase3b/remote/`: `create-torneos-project.sh`,
`bootstrap-torneos.sh`, `deploy-torneos-gateway.sh`, `mgmt.mjs`, `mgmt-write.mjs`, `lib.sh`,
`keychain.py`, y los contratos de `phase3b/contracts/`. El harness R4/R5 de Docker es evidencia
y referencia semántica; no es infraestructura remota.

Custody comprobada por presencia, **sin leer valores**:
`arma2-torneos-nonprod-core / contract-secret` PRESENT;
`arma2-torneos-nonprod-db / postgres` ABSENT;
`arma2-torneos-nonprod-bridge / keys` ABSENT.
psql y certificado CA requeridos están presentes. La Mac se usa como estación de provisión;
después del deploy el servicio debe funcionar con la Mac y Docker apagados.

PAT por TTY sin eco; secretos Keychain → memoria/stdin → API de secrets del nuevo proyecto.
DB bootstrap usa PGPASSWORD del proceso, nunca argv. No .env secreto, archivos temporales con
credenciales, historial, chat ni logs de requests. No leer ni copiar Core service_role al gateway.
HMAC existente compartido exclusivamente con el contrato Core; no rotarlo ni redeployar Core.
Logins remotos nuevos, sin reutilizar contraseñas/ring del lab.

**Limitaciones que impiden afirmar hoy “Production imposible” para toda ejecución futura:**

1. Los operators rechazan el ref Production en argumentos/host/path/body; los tests pasan.
   Pero el PAT tiene privilegios de cuenta y no es una barrera IAM contra cualquier herramienta.
2. `bootstrap-torneos.sh` sólo valida “no Production”; no fija el nuevo ref ni rechaza Core
   explícitamente. `mgmt-write.mjs` comparte operaciones para ambos lados. Antes de ejecutar,
   agregar un entrypoint de remote staging con target exacto sellado: bootstrap/secrets/deploy/JWKS
   sólo al nuevo ref, rechazo de Core/Production/refs alternativos; DB pooler y username ligados
   al mismo ref. Probar rechazos offline sin enviar requests a destinos prohibidos.
3. Preferir credenciales de un operador sin acceso a Production en la organización separada.
   Si sólo hay PAT amplio, declarar ese límite y ejecutar exclusivamente la ruta restringida.
4. El gateway hosted no hereda los namespaces, /32 routes y proxy de egress de R4. Revisar
   límites efectivos de hosted y redirects antes de afirmar equivalencia de aislamiento.
   No agregar un proxy alojado en la Mac ni simular que la barrera Docker existe en Edge Functions.
5. Al desplegar con `REACT_APP_PRODUCTION_PROJECT_REF` poblada, el ref puede aparecer como
   **denylist** en el bundle. “Cero targets/requests Production” es verificable; no prometer a la vez
   cero ocurrencias literales de un ref que se pide compilar. El escaneo debe distinguir ambos.

Se mantiene el código certificado sin cambios en esta etapa de plan.

## 5. Bootstrap y ACL

Orden obligatorio: proyecto vacío verificado → baseline exacto → gate exacto → roles/login
limitados → pre-request → verificación. No replay de migraciones históricas ni datos Core.
Las dos migraciones se aplican separadamente; si falla el gate, baseline puede quedar instalado:
mantener gateway/frontend cerrados y STOP, sin reparaciones manuales ni reset automático.

Roles LOGIN: `torneos_edge_identity_writer` y `torneos_edge_core_adapter`, NOINHERIT,
miembros exclusivamente de `torneos_identity_writer` y `torneos_core_adapter` según contrato.
`authenticator`: `pgrst.db_pre_request=private.check_token` y reload config/schema.
Bootstrap usa session pooler 5432; gateway usa transaction pooler 6543, TLS verificado,
`postgres@3.4.7`, `prepare:false`, SET LOCAL ROLE por transacción.

Aplicar las 16 expectativas de `torneos-bootstrap-expect.json`: 359 funciones public,
304 SECURITY DEFINER public, execute anon 12/authenticated 147/service_role 328,
anon sequences 0, 33 gated presentes, gated anon/authenticated execute 0,
gated service_role execute 33, P0 authenticated true, identity RLS true,
foreign_servers 0, membresías exactas y pre-request exacto.
Complementar con `phase2c/acl-inventory.sql` versus `phase2d/evidence/real-image-acl-after-real.json`:
**305 SECURITY DEFINER total (304 public + 1 private)**, disposiciones 305/305,
479 objetos del inventario certificado, 0 drift de objetos aplicables, PUBLIC EXECUTE 0,
anon writes 0, sin FK a Core/DB-to-DB, Torneos auth.users 0. Los 43 de gateway no son el
conteo de grants authenticated del catálogo. No cambiar ACL para hacer coincidir esos números.

## 6. Gate B03: confianza RS256 en PostgREST hosted

Es una condición remota pendiente, no una regresión de R4/R5. El operator registra
`custom_jwks` por `POST /v1/projects/<nuevo-ref>/config/auth/third-party-auth`.
El OpenAPI actual consultado admite `custom_jwks`; eso no prueba que el bearer certificado
con sus iss/aud y sus claims sea aceptado efectivamente por REST hospedado.

Tras la provisión, validar primero exchange → RPC allowlisted autenticada 200 con RLS y
pre-request efectivos; forged/expired → deny, 33 gated → deny incluso directo a REST.
Registrar integración y versión/configuración efectiva. Si falla, STOP antes de habilitar UI:
no cambiar a HS256, no JWT secret del proyecto, no segundo login/GoTrue, no fallback a Core.
El servicio Auth incluido por Supabase no se usa para identidades Torneos; auth.users queda 0.
No confundir registrar confianza de JWT con crear un segundo sistema de login.

Referencias: [OpenAPI](https://api.supabase.com/api/v1-json),
[JWT](https://supabase.com/docs/guides/auth/jwts),
[third-party auth](https://supabase.com/docs/guides/auth/third-party/overview).

## 7. Configuración remota pendiente

Los trece nombres del gateway, cargados del lado servidor:

| Variable | Valor/fuente |
| --- | --- |
| TORNEOS_GATEWAY_PUBLIC_URL | https://<nuevo-ref>.supabase.co/functions/v1/torneos-gateway |
| TORNEOS_ALLOWED_ORIGIN | Origen HTTPS exacto y estable del frontend elegido; sin path ni wildcard |
| CORE_AUTH_URL / CORE_JWT_ISSUER | https://hhyvmhgpapyuzjgxfnqv.supabase.co/auth/v1 |
| CORE_CONTRACT_URL | https://hhyvmhgpapyuzjgxfnqv.supabase.co/functions/v1/torneos-core-contract |
| CORE_ANON_KEY | Clave pública Core staging verificada |
| TORNEOS_CONTRACT_SERVICE_SECRET | HMAC existente de Keychain, sólo memoria |
| TORNEOS_REST_URL | https://<nuevo-ref>.supabase.co/rest/v1 |
| TORNEOS_ANON_KEY | Clave pública del nuevo proyecto |
| TORNEOS_DB_IDENTITY_WRITER_URL | Login limitado en pooler del nuevo proyecto |
| TORNEOS_DB_CORE_ADAPTER_URL | Login limitado en pooler del nuevo proyecto |
| TORNEOS_DB_SSL_CA | CA validada, codificación admitida por config.ts |
| TORNEOS_BRIDGE_KEYS | Ring RS256 remoto generado/custodiado sin archivos |

Desplegar sólo `torneos-gateway`, **verify_jwt=false** (el gateway verifica ambos tipos de bearer).
Core `torneos-core-contract` se observó ACTIVE, versión 1, verify_jwt=false,
bundle `1072419517953eee8e8021f9691d1a5b1efb1f871c4d13290f644d119caded2c`.
No necesita deploy en esta fase; guardar ese estado para comparación final.

## 8. Frontend remoto

Hosting pendiente de elección. El repositorio tiene Vercel: propuesta provisional, proyecto
staging separado y origen estable. No usar el proyecto/alias productivo. Subir artefacto desde
el worktree B04, sin push y sin integración que publique Production. Cotización de hosting pendiente.
Revisar su configuración actual antes de reutilizarla: `vercel.json` ejecuta validación de acceso
privado y upload a Sentry; también contiene redirects a dominio productivo para dos hosts.
El build raíz fuerza un callback mobile. Preparar configuración web staging explícita y probar
login/redirects y rutas SPA; no heredar esos valores silenciosamente. Mantener los secretos de
acceso privado sólo en runtime servidor, nunca `REACT_APP_*`. No convertir el hosting en un
segundo login Supabase Torneos.

Env de app:

```text
REACT_APP_SUPABASE_URL=https://hhyvmhgpapyuzjgxfnqv.supabase.co
REACT_APP_SUPABASE_ANON_KEY=<clave pública Core staging>
REACT_APP_TORNEOS_GATEWAY_URL=https://<nuevo-ref>.supabase.co/functions/v1/torneos-gateway
REACT_APP_DEPLOY_ENV=staging
REACT_APP_TORNEOS_DATA_ENV=staging
REACT_APP_TORNEOS_STAGING_PROJECT_REF=hhyvmhgpapyuzjgxfnqv
REACT_APP_PRODUCTION_PROJECT_REF=rcyuuoaqfwcembdajcss
REACT_APP_TORNEOS_ENABLED=true
REACT_APP_TORNEOS_WORKSPACES_ENABLED=true
REACT_APP_TORNEOS_WORKSPACE_SWITCHER_ENABLED=true
REACT_APP_TORNEOS_DEEP_LINKS_ENABLED=true
REACT_APP_TORNEOS_PRODUCTION_ENABLED=false
REACT_APP_TORNEOS_ISOLATED_SSO=false
```

**El STAGING_PROJECT_REF de arriba es Core por la implementación actual de featureFlags.js**:
valida `REACT_APP_SUPABASE_URL`. Poner allí el nuevo ref cierra Torneos. El gateway URL es el
destino de datos Torneos, separado. Los aliases CORE_SUPABASE, si se usan, deben coincidir con
el par legacy. `stagingV1Features.js` fija los ocho grupos ON y todos los OFF; no ampliar.
Flags notifications, official stats, public pages, media, media upload, social generator y
todos los readiness media quedan false. Sin gateway → disabled.

## 9. Secuencia con puertas de aceptación

1. Aprobar este plan, organización/costo y hosting/origen; resolver guard exacto, custody y
   procedencia de logs. Congelar fuentes y ejecutar pruebas del entrypoint remoto restringido.
2. Leer de nuevo org/plan/inventario/costo; crear sólo el proyecto Torneos aprobado en us-east-1.
   Sellar ref, org, nombre y región devueltos. Rechazar colisión Core/Production.
3. Verificar vacío; aplicar baseline/gate/roles; verificar ACL completa. Registrar evidencia
   sanitizada y hashes; ningún frontend Torneos habilitado todavía.
4. Reservar origen frontend staging estable. Configurar 13 valores, desplegar nueve sources
   del gateway desde backend R4/R5, registrar JWKS y resolver B03. Secrets no aparecen en manifest.
5. Probar CORS sin lab bridge: OPTIONS correcto 204, origen incorrecto/sin Origin en OPTIONS
   403; headers de autorización y content-type permitidos, content-range expuesto, no-store.
   Verificar Host/x-forwarded-host reales de la plataforma y health/JWKS/config sin secretos.
6. Build web B04 limpio con env staging; tests, lint, build, escaneo de secretos y destinos.
   Publicar sólo al hosting staging aprobado, SPA /torneos y HTTPS. Confirmar bundle servido.
7. QA browser remota completa de la sección siguiente, con trazas sanitizadas y sin tokens/HAR
   crudos. El servicio queda accesible sin túneles, sin Docker ni procesos de la Mac.
8. Cleanup sólo fixtures del run, revocar sesiones QA, comparar Core antes/después, verificar
   43/33 y ACL sin drift; dejar URL navegable para Nico y emitir verdict sólo con todo PASS.

Los scripts viejos `certify-remote.sh` cubren smoke parcial; no sustituyen el journey R5 y
la matriz de browser B04. `deploy-torneos-gateway.sh` registra un fallo B03 sin abortar:
el nuevo entrypoint debe convertirlo en STOP efectivo. Su `--dry-run` necesita PAT/custody
y lecturas de control plane; no se lo ejecutó como si fuera un ensayo totalmente offline.

## 10. QA remota y cleanup

Journey: Core staging login → /torneos → workspace → temporada → torneo → colaboradores →
importación real Core → roster → invitación aceptada por captain → submit → review → approved.
Usar owner/admin/captain/outsider y segundo workspace/season para controles negativos.
H1 undefined→null preservado; H2 owner con invitación manager pendiente devuelve 403 esperado;
H3 StrictMode preservado. H4 no aplica: CORS real Deno, sin bridge local.

Comprobar exchange coalescido, renovación silenciosa, 401 con máximo un re-exchange,
403 sin retry, 503 preservado, TTL 120 y bearer realmente expirado a >125 s (ejemplo 128 s),
logout/revocación y logout multi-tab, sin stale cache ni reintentos ocultos. Tabla members
con content-range y aislamiento de RLS. 33 gated/OFF y RPC fuera de allowlist rechazadas;
rutas OFF sin requests on-mount. Bearer bridge sólo memoria, sin local/sessionStorage/IndexedDB,
sin refresh token Torneos, sin segundo createClient/Auth y sin requests Torneos al singleton Core.

CORE_UNAVAILABLE, falla de contrato y Torneos unavailable deben devolver error explícito,
sin escrituras/fallback y recuperación en primer intento. No pausar Core para probarlo:
preparar fault injection **remoto, acotado a un harness de QA y temporal**, con mismos módulos
de gateway y dependencias controladas; no flags de fallo públicos en el gateway entregado.
El diseño/deploy de ese harness y su evidencia aún están pendientes. Browser abort/mocks por
sí solos no certifican una caída de dependencia del gateway. Retirarlo tras QA y verificar
de nuevo el gateway final y la URL final.

Registrar IDs inmediatamente al crear QA, limpiar por esos IDs y contar residuos. Revocar
sesiones, borrar únicamente usuarios/equipos Core sintéticos del run y filas Torneos del run;
auth.users Torneos 0. No borrar datos reales. Comparar migraciones/contrato/config Core sin
cambios persistentes fuera de fixtures retiradas. Si cleanup falla, no PASS.
Rollback operativo: frontend disabled y gateway cerrado; conservar evidencia, no fallback,
no tocar Core, no eliminar proyecto pago ni datos sin la decisión correspondiente.

## 11. Validación de esta inspección

Ejecutado ahora: foundation **38/38**, Jest staging-v1 + featureFlags **44/44 (3 suites)**,
backend/operators/gateway/R4/R42/R5 offline **102/102**, 0 fail, 0 skip.
Resultados guardados junto al manifiesto. No se ejecutó el recorrido live R4/R5 ni se reinició R2.
No se repitió test:ci (deuda F2/F4 conocida), lint global ni build: el artefacto remoto con
env definitivo todavía no existe. Los 1191 tests/lint/build de B04 siguen como evidencia histórica.
Changelog revisado: cambios de logs API, versiones de extensiones, gateway self-hosted y schema
realtime no requieren alterar los dos SQL certificados inspeccionados para este plan hosted.

## 12. Entrega solicitada — estado real

| # | Elemento | Estado |
| --- | --- | --- |
| 1 | Billing/proyecto | Free confirmado; decisión Pro/organización pendiente |
| 2 | Ref Torneos | No creado |
| 3 | Región | us-east-1 propuesta y fijada por operator |
| 4 | Baseline | Hash correcto, no aplicado remoto |
| 5 | Gate | Hash correcto, no aplicado remoto |
| 6 | ACL | Contratos revisados; verificación remota pendiente |
| 7 | 43/33 | Exactos en fuentes; remoto pendiente |
| 8 | Gateway | Nueve sources certificados; deploy pendiente |
| 9 | CORS/origin | Código presente; origen/QA hospedada pendientes |
| 10 | URL frontend | Pendiente de hosting y publicación |
| 11 | Browser journey | Pendiente, sin claim de PASS |
| 12 | Tests | 38 + 44 + 102 PASS en esta revisión |
| 13 | Blockers | Billing/org, hosting/origin, guard/custody remoto, integridad logs, B03 y QA hosted |
| 14 | Costo/plan | Pro desde 25/mes en organización separada; actual ~45/mes con 3 computes; hosting por cotizar |
| 15 | Core staging | ACTIVE_HEALTHY; contrato ACTIVE v1; ninguna escritura remota en esta etapa |
| 16 | Production | Cero requests dirigidos a su proyecto y cero escrituras; sólo listado global de inventario |

**STOP antes de billing/creación o cualquier cambio remoto**, según la instrucción del usuario.
R4/R5/B04 no se reabren; no se declara remote PASS.
