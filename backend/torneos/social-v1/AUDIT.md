# SOCIAL-V1 — auditoría para volver a habilitar el Estudio Social en Production

Estado: **SOCIAL_V1_AUDIT_READY** (2026-10-02). Sólo auditoría + plan: no se tocó Production DB, Cloud Run, Vercel,
Deno ni Android. Las lecturas de Production fueron read-only (Cloud Run REST y el bundle público). Billing, Commerce y MP
siguen OFF. Plan de implementación: [`PLAN.md`](PLAN.md).

Base: `main 6a489648` (PR #172). Production: DB `POST_0007`, gateway `torneos-gateway-00003-b78` (imagen `dc8049d3…`,
PLAN READ on), web `main.ae463a7d.js`.

## 1. Qué mantiene apagado el Estudio hoy (4 capas, todas cerradas)

| Capa | Dónde | Estado Production (verificado) |
|---|---|---|
| Flag web | `featureFlags.js`: `socialContentGenerator` no está en `PRODUCTION_ELIGIBLE_FLAGS` | Bundle `main.ae463a7d.js`: `REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED` sin valor; sólo aparece el nombre de la clave |
| Feature map híbrido | `stagingV1Features.js`: `social_studio: false`; el adapter híbrido no tiene alias sociales y `torneosClient` rechaza sus RPC (`TORNEOS_OUTSIDE_STAGING_V1`) | sin cambios desde COMPETITION-V1 |
| Allowlist del gateway | ninguna RPC social en `staging-v1`, `competition-v1`, `officialization-v1` ni en PLAN READ | Cloud Run `00003-b78`, digest `dc8049d3…` = grafo de `main`; sin env `TORNEOS_SOCIAL_*` |
| ACL DB | `authorize_tournament_social_export` sin EXECUTE para `authenticated` (0001; 0004/0005 verifican que siga cerrada) | evidencia remota OEC (`oec-03-w2`, 2026-09-28): `authenticated=false`, md5 `f211d9a2…` |

## 2. Las 4 RPC

El servicio legacy (`api/tournamentWorkspaceService.js:1940-1992`) define 4 llamadas. **Sólo 3 tienen consumidor en la UI**
(`SocialStudioPage.jsx`):

| RPC | Consumidor | ACL POST_0007 (lab = Prod) | Guard propio | Necesaria en SOCIAL-V1 |
|---|---|---|---|---|
| `get_tournament_social_studio_context(uuid)` | `loadSocialStudioContext` | `authenticated` ✅ desde el baseline | `social.read` (membresía activa, org activa) + filtro por acceso a la temporada | **Sí** |
| `get_tournament_social_snapshot(uuid,uuid,uuid,uuid,text,uuid,uuid)` | `loadSocialSnapshot` | `authenticated` ✅ desde el baseline | acceso a la temporada + `social.read`, fixture publicado, pieza del registro | **Sí** |
| `authorize_tournament_social_export(uuid,uuid,text,text,boolean)` | `authorizeSocialExport` (antes de cada PNG) | **cerrada** (sólo `service_role`) | `social.export` + temporada; FREE ⇒ Base + 3 piezas + firma Arma2 | **Sí** — es el único GRANT nuevo |
| `set_tournament_social_permission(uuid,uuid,boolean)` | **ninguno** (no hay pantalla que reparta permisos) | `authenticated` ✅ desde el baseline | `social.manage_permissions` (owner/admin); sólo colaboradores activos; audita | **No** — queda fuera de la allowlist |

Todas son `SECURITY DEFINER`, `search_path=''`, sin `anon` ni `PUBLIC`. Los 9 helpers (`*_legacy`, `has_/current_user_…`,
`tournament_social_*`) son `service_role` o internos y no cambian.

Recordatorio del modelo de exposición (informe OEC): un bearer del bridge (TTL 120 s) también sirve contra el PostgREST de
Torneos, así que **la ACL de la DB es la frontera final**; la allowlist del gateway es la segunda. Hoy las 3 RPC con
EXECUTE ya son alcanzables así desde el baseline (dentro de los 171), protegidas por sus guards.

Evidencia: `evidence/catalog-post0007.txt` (ACL, owner, md5 de las 13 funciones sociales), `evidence/acl-counts-post0007.txt`
(`authenticated=171 anon=12`, igual al pin remoto POST_0006/0007).

## 3. Hallazgo F1 — `authorize_tournament_social_export` autoriza con `NULL`

Reproducido en el lab (`lab/run-audit-lab.sh`, 25/25 observaciones esperadas, `evidence/sql-cases-post0007.txt`):

- `theme = NULL` ⇒ `p_theme not in (…)` es `NULL` ⇒ no levanta; el chequeo FREE (`p_theme <> 'base' or …`) también es
  `NULL` ⇒ no levanta; `if p_theme = 'base'` es `NULL` ⇒ rama Premium ⇒ **`authorized: true`, `includeArma2Branding: false`
  para un FREE** (F1a, F1c).
- `piece = NULL` ⇒ `authorized: true` con `piece: null` (F1b).
- `p_include_arma2_branding = NULL` en FREE ⇒ firma forzada `true` (correcto); en PREMIUM devolvería `null`.

Impacto: la exportación es client-side, así que un cliente modificado ya podía saltear la autorización; F1 no expone
datos. Pero la RPC es el contrato de autorización y hoy da "white-label autorizado" a un FREE. **Se corrige antes de abrir
el GRANT**, en la misma migración (ver PLAN T1).

El resto del contrato se comporta como se espera (A1–A12, R1–R8): FREE exporta `round_results`/`standings`/`next_fixture`
en Base con firma; `mvp` o un tema Premium ⇒ `TORNEOS_SOCIAL_PREMIUM_REQUIRED`; Base sin firma ⇒
`TORNEOS_BRANDING_PREMIUM_REQUIRED`; colaborador sin permiso, no miembro, org cruzada o sin claims ⇒
`TORNEOS_SOCIAL_EXPORT_FORBIDDEN`; snapshot sin fixture publicado ⇒ `TORNEOS_SOCIAL_SCOPE_UNAVAILABLE`.

## 4. Migración mínima: `00000000000008_social_v1_export_authorization.sql`

1. `CREATE OR REPLACE` del cuerpo de `authorize_tournament_social_export` (misma firma, `STABLE`, `SECURITY DEFINER`,
   `search_path=''`, owner y ACL de servicio iguales) con:
   `p_theme is null or p_theme not in (…)` ⇒ `TORNEOS_SOCIAL_THEME_UNKNOWN`; `p_piece is null or …` ⇒
   `TORNEOS_SOCIAL_PIECE_UNKNOWN`; `coalesce(p_include_arma2_branding, true)`. Nada más cambia en el cuerpo.
2. `GRANT EXECUTE … TO authenticated` sobre esa sola función.
3. Precondición fail-closed: cuerpo = `f211d9a26d99448d4069c499c7508c55` (o el de 0008: re-aplicar es no-op), ACL cerrada
   (o la de 0008), `authenticated=171 anon=12` (o 172/12). Cualquier otra cosa aborta sin cambios.
4. Postcondición en la misma transacción: `authenticated` +1 exacto (172), `anon` 12, la función con `authenticated` y
   `service_role`, sin `anon`/`PUBLIC`/roles de servidor; los otros 3 RPC y los 9 helpers idénticos (md5 + ACL).
5. Rollback documentado (no automático): restaura el cuerpo `f211d9a2…` y revoca a `authenticated` (171/12).

No hace falta: ninguna tabla, RLS, policy, ni tocar las otras 3 RPC. `set_tournament_social_permission` mantiene su
EXECUTE del baseline (sin cambio de superficie) pero **no** entra a la allowlist.

Nota: 0004/0005 verifican en su postcondición que `authorize_tournament_social_export` esté cerrada. Después de 0008 ya no
se re-aplican (son históricas), igual que 0004 tras 0005.

## 5. Gateway

- Archivo nuevo `torneos-gateway/social-v1-rpc-allowlist.json`: `{"phase":"SOCIAL-V1","features":{"social_studio":[3 RPC]}}`.
- Módulo nuevo `torneos-gateway/social.ts`, mismo patrón que `plan-read.ts`: `TORNEOS_SOCIAL_MODE` ausente/`""`/`off` ⇒
  allowlist sin cambios; `on` ⇒ +3 exactas; cualquier otro valor ⇒ `SocialConfigError` y el boot falla cerrado. Valida que
  el documento sea disjunto de todo lo anterior (staging, competition, officialization, públicas, plan, commerce).
- `index.ts`: `rpcAllowlist = withSocial(withPlanRead(effectiveRpcAllowlist(base, commerce), env), env)`.
- La ruta pública sigue rechazando las 3. `set_tournament_social_permission`, las 14 comerciales y checkout siguen 403/404.
- El grafo del gateway pasa de 18 a 20 archivos ⇒ imagen nueva; se despliega primero con `TORNEOS_SOCIAL_MODE` ausente
  (comportamiento idéntico) y después `on` en revisión nueva (mismo esquema que PLAN READ).

## 6. Frontend

| Cambio | Dónde |
|---|---|
| `PRODUCTION_ELIGIBLE_FLAGS` + `'socialContentGenerator'` | `config/featureFlags.js` |
| `resolveTorneosSocialStudio(env, {backendMode, planRead})` = híbrido **y** PLAN READ on **y** `torneosFeatureFlags.socialContentGenerator` | `foundation/config.js` |
| Overlay `stagingV1SocialOverlay = { social_studio: true }` aplicado sólo con `social: true` | `stagingV1/stagingV1Features.js` (`stagingV1FeaturesFor(mode, {planRead, social})`) |
| Scope `socialV1Scope.js` (copia de la allowlist, guard de igualdad) + `createTorneosClient({ social })` | `foundation/` |
| Alias `loadSocialStudioContext`, `loadSocialSnapshot`, `authorizeSocialExport` sólo con `social: true` (sin `setSocialPermission`, sin `signMediaReadUrls`, sin resolvers de escudo/logo) | `stagingV1/stagingV1WorkspaceService.js` |
| Mi plan: con `social_studio` on, Estudio Social pasa de "Próximamente" a la tabla FREE vs PREMIUM | `domain/planComparison.js` + `PlanExperiencePage.jsx` |

**Variable de Vercel (una sola):** `REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED=true`, production-only. Sin ella, o con
PLAN READ off, o fuera del backend productivo certificado, el Estudio no existe (ni nav, ni ruta, ni alias, ni requests).

## 7. Qué funciona sin Multimedia

- Las 3 RPC no dependen de storage ni del pipeline de medios.
- Escudos (`shieldPath`): el adapter híbrido no resuelve URLs ⇒ cada escudo cae al **monograma** en Base (test
  "a crestless team gets a monogram instead of a hole") y a las **iniciales** en Premium (`premiumDataAdapter.teamModel`).
- Logo del torneo: sin resolver ⇒ no se dibuja; queda el nombre del torneo.
- Firma Arma2: `BASE_LOCKUP_DATA_URL` embebido en el bundle, sin red.
- Foto de Figura/Campeón: sólo **archivo local** (`URL.createObjectURL`), nunca se sube. La ruta por `photoAssetId`
  (firmador de Multimedia) no es alcanzable: sin `signMediaReadUrls` falla cerrada con `ASSET_PHOTO_UNAVAILABLE`.
- Tipografías Premium: `fonts.gstatic.com` (CORS ok, sin CSP en la app). Si no cargan, `PREMIUM_FONT_UNAVAILABLE` ⇒ no hay
  render ni export (falla cerrada). Base usa Oswald/Bebas.

## 8. Placas sin fotos (11 piezas × Base + 4 Premium × 4:5 / 9:16)

| Pieza | Sin foto | Condición de datos |
|---|---|---|
| `round_results`, `next_fixture`, `standings` | ✅ (escudo ⇒ monograma) | fixture publicado; ronda para resultados; tabla publicada |
| `scorers`, `discipline`, `round_summary`, `semifinals`, `final` | ✅ | estadísticas/partidos publicados |
| `best_eleven` | ✅ placa de identidad / monograma | selección humana obligatoria (`CURATION_REQUIRED`) |
| `mvp` | ✅ variante `figuraSin` (4:5) / `mvp` (9:16) | selección humana obligatoria |
| `champion` | ✅ variante `campeon` | torneo `completed` + confirmación humana |

Con foto local opcional: `mvp` (`figuraFoto`) y `champion` (`campeonFoto`). Ninguna pieza **requiere** foto. El PLAN agrega
un test matriz 11 × 5 × 2 sin foto, sin escudos, sin logo y sin `signMediaReadUrls`.

## 9. FREE vs PREMIUM

| | FREE (todas las temporadas de Prod hoy) | PREMIUM |
|---|---|---|
| Ver el Estudio y previsualizar | 11 piezas × 5 estilos (Premium con candado fuera del arte) | igual |
| Exportar / compartir | `round_results`, `standings`, `next_fixture` en Base | 11 piezas × 5 estilos |
| Firma Arma2 | obligatoria | opcional en Base; los 4 estilos Premium son white-label |
| Upsell | botón "· Premium 🔒 · Próximamente" ⇒ Mi plan `#premium` ("la compra todavía no está disponible"), sin checkout | — |
| Autoridad | UI: `planState` de la temporada (PLAN READ); servidor: `authorize_tournament_social_export` (plan efectivo de la temporada) | ídem |

Fail-closed: si la lectura de plan no está `ready`, no es `isTrusted` o es de otra temporada, la UI trata la temporada como
no-Premium (nunca inventa PREMIUM) y la DB decide igual. Roles: owner/admin exportan; colaborador = sólo lectura (sin
`set_tournament_social_permission` no hay forma de darle export en V1).

Riesgo aceptado (documentado, no nuevo): FREE recibe datos de las 11 piezas para la vista previa y la exportación es
client-side; un cliente modificado puede generar el PNG Premium. Sólo es pérdida de valor comercial (no expone datos que el
usuario no pueda leer); se revisa cuando exista compra.

## 10. Billing / Commerce / MP

SOCIAL-V1 no agrega env, RPC ni rutas comerciales. Los tests del plan verifican que con `TORNEOS_SOCIAL_MODE=on` las 14
comerciales siguen 403, checkout 404 y que el frontend no hornea `BILLING`/`COMMERCE`.

## 11. Cloud Run sin `gcloud run` (Python 3.9)

- Diagnóstico: `gcloud` 3.9.6 de sistema (no hay otro Python en el host); `gcloud run …` muere con `CommandLoadFailure`;
  `gcloud auth print-access-token` funciona. **Gotcha extra:** el proyecto por defecto de gcloud es `ruko-493223`, no
  `arma2-465223`.
- Herramienta nueva: `backend/torneos/infra/torneos-cloudrun-readonly/cloudrun-readonly.mjs` (Node, sin deps). Sólo puede
  enviar 3 requests (GET service, GET revisions, Logging `entries:list`), exige proyecto/región/servicio explícitos, nunca
  imprime el token ni valores de env (salvo flags), y un no-2xx es error (nunca "0 líneas"). Expectativas opcionales
  (`--expect-traffic-revision`, `--expect-digest`, `--expect-env K=V|<absent>`) ⇒ exit 1 si algo difiere. Tests 6/6.
- Corrida real (read-only, `evidence/cloudrun-prod-baseline.json`): `00003-b78` 100 % por REVISION, digest `dc8049d3…`,
  14 env (4 secretos @1), `TORNEOS_PLAN_READ_MODE=on`, sin `TORNEOS_SOCIAL_MODE` ni env comercial, max 3, ingress all,
  invoker IAM deshabilitado; revisiones `00003-b78`/`00002-skw`/`00001-7lw` Ready; 24 h: 575 requests, **0 5xx**.
- Alternativa definitiva (no aplicada, requiere instalar software en la Mac): `brew install python@3.12` y
  `export CLOUDSDK_PYTHON=$(brew --prefix)/bin/python3.12`.

```bash
node backend/torneos/infra/torneos-cloudrun-readonly/cloudrun-readonly.mjs --project arma2-465223 --region southamerica-east1 --service torneos-gateway --logs-minutes 60 --expect-traffic-revision torneos-gateway-00003-b78 --expect-env TORNEOS_SOCIAL_MODE='<absent>'
```
