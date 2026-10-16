# Gateway de Torneos: orígenes nativos y compatibilidad con binarios publicados

**Estado (2026-10-15):** el código que admite `capacitor://localhost` está en un PR draft. **No está desplegado.**
Cloud Run, el env y los secretos de Producción no se tocaron.

Este documento no forma parte de la imagen del gateway. La imagen se arma con una lista explícita de 33 archivos
(`.ts` y `.json`: los 32 de `main` `b4fb150a` más `account-erasure.ts` de #217), y este `.md` no está en esa lista.

---

## 1. Orígenes admitidos

El gateway compara el header `Origin` del request contra una lista congelada. Esa lista depende de la topología:

| Origen | Cliente | Dónde se fija | Medición |
|---|---|---|---|
| `https://app.arma2.com.ar` | la web | env `TORNEOS_ALLOWED_ORIGIN`. En Producción, `topology.ts` exige que sea exactamente `PRODUCTION.allowedOrigin` | origen certificado de la web |
| `https://localhost` | app Android (Capacitor 7: `androidScheme` por defecto `https`, hostname `localhost`) | `topology.ts` → `PRODUCTION.nativeAppOrigin`, en código | **medido en el cable** el 2026-09-29 (Capacitor 7.4.5, Android 16, WebView 134) contra el gateway de Deno. Está en `main` desde `f7efe18f`. Hay que re-medirlo contra Cloud Run SP en el smoke de Android |
| `capacitor://localhost` | app iOS (Capacitor 7: sin `server.iosScheme` el esquema es `capacitor`, hostname `localhost`) | `topology.ts` → `PRODUCTION.nativeIosOrigin`, en código (este PR) | **PENDIENTE.** Se mide antes del deploy (§5). No se da por supuesto |

- **Fuera de Producción** (lab, topologías no productivas): sólo el origen del env. Nunca un origen nativo.
- **Los orígenes nativos no son configurables.** No hay variable de env nueva. Si `TORNEOS_ALLOWED_ORIGIN` apunta a
  `capacitor://localhost` (o a `https://localhost`), el gateway no arranca.

### Por qué hace falta cada origen

Capacitor sirve el bundle desde un esquema local dentro del binario. Las llamadas `fetch` al gateway son cross-origin
y el WebView manda su origen. Sin el permiso CORS exacto, el WebView descarta la respuesta, y Torneos no anda en la app.

Para iOS se eligió fijar `capacitor://localhost`. Las alternativas se descartaron (detalle en `PLAN-RELEASE-MOVIL.md` §3):

- **`server.iosScheme` propio:** cambia el origen del WebView. La sesión de Supabase y las preferencias viven en
  `localStorage`, que es por origen, así que **se desloguearían todos los usuarios de iOS**. Además igual habría que
  agregar ese origen nuevo al gateway.
- **`server.url` remoto** (cargar la web): activaría la compra, que se decide por hostname (`config.js:96,151`). Eso
  viola la guía 3.1.1 y suma riesgo por la 4.2.
- **`CapacitorHttp`:** parchea todo `fetch` de la app, Core incluido.

### El origen no es autenticación

Cualquier app Capacitor de iOS manda `capacitor://localhost`, igual que cualquier app Android manda `https://localhost`.
CORS sólo decide qué página de un navegador puede leer la respuesta.

La protección real es otra:

- el JWT de Core verificado en línea;
- `/exchange` y el bearer del gateway (RS256, TTL corto);
- la sesión de Core activa en cada RPC;
- RLS.

No hay cookies ni `access-control-allow-credentials`. Es el mismo riesgo que se aceptó para Android.

---

## 2. Garantías de comparación exacta

1. El header se lee **una sola vez**: `index.ts:251`, `req.headers.get("origin")`.
2. Se compara con `Array.prototype.includes` contra la lista congelada (`config.ts:136`), en dos lugares:
   - `index.ts:145`: el permiso CORS;
   - `index.ts:258`: el gate.

   Es igualdad estricta de strings. La API `Headers` de Fetch sólo quita los espacios de los bordes, que según HTTP no
   son parte del valor.
3. **Nunca** se usa `new URL(x).origin`. Para un esquema no especial como `capacitor:`, eso da `"null"`, y admitir
   `"null"` abriría el gateway a iframes sandbox y a `file:`.

   Tampoco hay `toLowerCase`, regex ni prefijos. Un test de fuente lo verifica.
4. **Se rechazan con `403 {"error":"origin rejected"}`**, sin header CORS, antes de cualquier autenticación o llamada
   a Core, Torneos REST, Storage o pagos:
   - con barra final: `capacitor://localhost/`;
   - en otra caja: `CAPACITOR://localhost`, `capacitor://LOCALHOST`;
   - con otro host: `capacitor://evil`, `capacitor://evil.localhost`, `capacitor://localhost.evil.example`;
   - con otro puerto: `capacitor://localhost:8080`;
   - con usuario: `capacitor://user@localhost`;
   - `null` y `*`;
   - con otro esquema: `http://localhost`, `ionic://localhost`, `arma2://localhost`, `file://`;
   - listas de orígenes.
5. **Respuesta para un origen admitido:**
   - `access-control-allow-origin` es exactamente el origen que coincidió (eco del valor de la lista);
   - `vary: origin`;
   - nunca `allow-credentials`;
   - métodos y headers iguales a los de la web.
6. **Sin `Origin`** (cliente que no es navegador): se sirve sin permiso CORS. Esto no cambia.
7. **El `Referer` nunca se lee.** El gateway responde `referrer-policy: no-referrer`, pero eso es un header de
   respuesta, no un chequeo.

---

## 3. Inventario: dónde se valida o refleja Origin/Referer

| Sitio | Qué hace | Tratamiento en este PR |
|---|---|---|
| `torneos-gateway/topology.ts:35` | `PRODUCTION.allowedOrigin = "https://app.arma2.com.ar"` | sin cambios |
| `torneos-gateway/topology.ts:38` | `PRODUCTION.nativeAppOrigin = "https://localhost"` (Android) | sin cambios |
| `torneos-gateway/topology.ts:43` | `PRODUCTION.nativeIosOrigin = "capacitor://localhost"` | **nuevo**: literal único, en código |
| `torneos-gateway/topology.ts:108,125` | `TORNEOS_ALLOWED_ORIGIN` es https y, en Producción, exactamente el origen web | sin cambios: el env no puede ser un origen nativo |
| `torneos-gateway/config.ts:97` | `TORNEOS_ALLOWED_ORIGIN` es un origen pelado | sin cambios |
| `torneos-gateway/config.ts:136` | `allowedOrigins` congelada: `[web, Android, iOS]` en Producción; `[env]` fuera de Producción | **cambia**: se agrega `PRODUCTION.nativeIosOrigin` |
| `torneos-gateway/index.ts:144-153` | `corsHeaders`: permiso sólo si `allowedOrigins.includes(origin)`, eco exacto, `vary: origin` | sin cambios |
| `torneos-gateway/index.ts:251,258` | lectura única del header y gate de host + origen **antes de cualquier ruta** | sin cambios |
| `torneos-gateway/index.ts:262-264` | preflight `OPTIONS`: 204 sólo con permiso; si no, 403 | sin cambios: cubre todas las rutas |
| `torneos-gateway/index.ts:108` | `cfg.allowedOrigin` (sólo la web) va a `commerce.ts` como URL de dependencia, para exigir https en la configuración | sin cambios: los orígenes nativos no se pasan ahí |
| `index.ts:300` (commerce), `:314` (ruta pública), `:345` (objetos de branding), `:361` (media), `:384` (REST/RPC) | no tienen chequeo de origen propio: todas están detrás del gate de `:258` | consistentes por construcción. El test recorre cada ruta |
| `index.ts:286-296` + `account-erasure.ts:112` (borrado de cuenta, #217) | además del gate de `:258`, rechaza **cualquier** request con `Origin` (403), también los orígenes admitidos | sin cambios: ningún navegador (web o nativo) llega al borrado |
| `commerce.ts` | no lee `Origin`. Las URLs de retorno de la compra no dependen del origen | sin cambios |
| `torneos-payments-production/handler.ts:276,374` y `torneos-payments/handler.ts:183,261` | rechazan **cualquier** request con `Origin`: la ruta interna con 403 y el webhook con 400 | sin cambios: ningún navegador (web o nativo) llega a pagos |
| `torneos-media-store` | sin manejo de origen: es de servidor a servidor, lo llama sólo el gateway con su secreto | sin cambios |
| `integration/torneos-core-contracts/gateway.mjs:222-223` (espejo Node del lab) | mismo origen en loopback, comparación exacta con `publicOrigin`, sin CORS | sin cambios: el lab no es Producción y nunca admite un origen nativo (lo verifica un test de fuente) |
| Storage de Torneos (URLs firmadas de logos) | responde `access-control-allow-origin: *` | nada que hacer. Verificar en el smoke que las imágenes se ven en iOS |

---

## 4. Commerce y pagos: nativo no recibe nada nuevo

- **Rutas `/commerce/v1/season-checkout` y `/commerce/v1/purchase-refresh` del gateway:**
  - pasan por el mismo gate;
  - para `capacitor://localhost` dan exactamente las mismas respuestas y las mismas llamadas aguas arriba que para la
    web y Android (lo verifica el test, con commerce apagado y con commerce en modo `production`);
  - exigen el bearer del gateway, la sesión de Core y la identidad. El origen nunca concede nada.
- **En la app:**
  - la compra sólo se habilita si `appHostname === 'app.arma2.com.ar'` (`src/features/torneos/foundation/config.js:96,151`),
    así que en nativo nunca aparece ni arranca un checkout;
  - el script de release nativo prohíbe las claves `BILLING`, `COMMERCE`, `PAYMENT` y `MERCADO`.
- **Las funciones de pagos** rechazan todo request con `Origin`.
- **Opción para más adelante (no implementada):** cerrar las rutas `/commerce/*` a los orígenes nativos en el gateway,
  como defensa en profundidad. Cambiaría el comportamiento de Android y necesita su propia decisión.

---

## 5. Medición del origen iOS: obligatoria ANTES del deploy

El literal `capacitor://localhost` sale del valor por defecto de Capacitor 7.4.5:
`CAPInstanceDescriptor.swift`, `scheme = "capacitor"`, hostname `localhost`, y `capacitor.config.ts` no define
`server`. **Igual hay que observarlo en el cable**, como se hizo con Android.

1. **Build.** Build de iOS con el set de claves de la fase 1. Puede ser **Debug**: Capacitor deja el WebView
   inspeccionable sólo en Debug. **No** activar `ios.webContentsDebuggingEnabled` en el build de tienda.
2. **Simulador.** Correrlo en el Simulador de iOS desde Xcode.
   - En Safari del Mac: **Desarrollo → Simulator → la página de la app** (Web Inspector) → pestaña **Red**.
3. **Disparar una llamada al gateway.** Entrar a Torneos: hay un `POST /exchange` y su preflight `OPTIONS`.
   - Antes del deploy el gateway responde **403 `origin rejected`**, y eso es lo esperado.
   - El Web Inspector igual muestra los headers **del request**.
4. **Copiar el valor exacto** del header `Origin` del request (preflight y POST).
   - Tiene que ser, byte a byte, `capacitor://localhost`: sin barra final, en minúsculas, sin puerto.
5. **Repetir en un iPhone real** con un build Debug (cable + Safari → Desarrollo → el dispositivo).
   - Opcional: un build interno de TestFlight, si se hizo inspeccionable **sólo** para esa prueba.
6. **Evidencia** (sin tokens ni datos personales; tapar el header `authorization`):
   - capturas o texto de los headers;
   - versión de iOS, del simulador o del dispositivo, y de Capacitor;
   - commit del build.

   Va a `backend/torneos/ios-origin/evidence/`.

**Criterio de STOP:** si el valor medido no es exactamente `capacitor://localhost`, **no se despliega**. Se corrige el
literal en un PR nuevo, con sus tests, y se vuelve a medir.

En el smoke de Android se re-mide `https://localhost` contra el Cloud Run actual, de la misma forma
(`chrome://inspect`).

---

## 6. Plan de deploy (sólo con GO) y rollback

**Prerrequisitos:**
- PR mergeado con GO. El merge **no** despliega nada.
- Medición del §5 registrada.
- **Confirmar en modo read-only, antes de desplegar,** qué revisión sirve el 100 %.
  - Última verificación: 2026-10-15 00:28Z, con `~/Arma2Backups/go4-run.sh status`.
  - Revisión viva: `torneos-gateway-00033-wow` al 100 %, imagen `e36ff1ce`, commerce `production`.
  - `torneos-gateway-00029-sav` es la revisión de **rollback de esa promoción**. Sirve sólo si no hay compras abiertas,
    y **no** es el punto de vuelta de este deploy.

1. **Imagen.**
   - Se arma desde la **fuente de la imagen viva actual** (`e36ff1ce`, commerce production, linaje de `main`
     `b4fb150a`) más este PR, como en el runbook de `docs/torneos/commercial-season/PUBLICACION.md`.
   - Usa la lista de 33 archivos: los 32 de la imagen viva más `account-erasure.ts` (#217), si #217 entra antes o junto con este PR.
   - Comparar los sha256 con los de la imagen viva `e36ff1ce`: sólo cambian `torneos-gateway/topology.ts` y
     `torneos-gateway/config.ts`.
   - En el merge conjunto (rama de integración), la imagen es la de `pins/gateway-graph.json` de
     `backend/torneos/infra/torneos-gateway-remote/` (33 archivos, sha256 por archivo y digest). Contra el árbol
     anterior a este PR (`601723dc`) cambian sólo `topology.ts` y `config.ts`; contra `main` `b4fb150a` cambian además
     los archivos de #212/#216/#217 (`branding.ts`, `branding-v1-rpc-allowlist.json`, `connected-v1-rpc-allowlist.json`,
     `db.ts`, `index.ts`) y se agrega `account-erasure.ts`.
   - Si cambia algo más, **STOP** y revisar. Por ejemplo, si `main` avanzó con otros cambios del gateway, esta
     imagen ya no es «la viva + el origen iOS».
2. **Revisión nueva sin tráfico:**

   ```
   gcloud run deploy torneos-gateway --image <imagen>@<digest> --no-traffic --tag iosorigin
   ```

   - Sin `--set-env-vars`, `--update-env-vars` ni `--update-secrets`.
   - La revisión hereda el env y los secretos de `00033-wow`, incluida la configuración de commerce `production`:
     **sólo cambia la imagen**.
3. **Probes contra la URL del tag**, con `x-forwarded-host` = el host público, sin autenticación:
   - las respuestas sin `Origin` son iguales a las de la revisión viva (`00033-wow`);
   - para la web y `https://localhost` no cambia nada;
   - preflight con `Origin: capacitor://localhost` → **204** con `access-control-allow-origin: capacitor://localhost`
     y `vary: origin`;
   - `capacitor://localhost/`, `CAPACITOR://localhost`, `null` e `ionic://localhost` → **403** sin CORS.
4. **Promover.**

   ```
   gcloud run services update-traffic torneos-gateway --to-revisions <nueva>=100
   ```

   - Un split de tráfico no aporta nada: la web y Android reciben respuestas idénticas (lo prueba el test diferencial).
     Si se prefiere, 10 % → 100 %.
   - Anotar la revisión nueva y la anterior (`00033-wow`).
5. **Rollback** (segundos, sin rebuild): volver el tráfico a la revisión que servía antes, `torneos-gateway-00033-wow`
   (confirmada en el paso de prerrequisitos). **No** volver a `00029-sav`.

   ```
   gcloud run services update-traffic torneos-gateway --to-revisions torneos-gateway-00033-wow=100
   ```

   - Efecto: Torneos se apaga **sólo en iOS** (kill switch). La web, Android y commerce `production` no cambian,
     porque `00033-wow` tiene el mismo env.
   - Antes de que se publique la app de iOS no rompe nada.
6. **Orden respecto de la app.**
   - Este deploy va **antes** de mandar el build de iOS a revisión: la cuenta demo del revisor necesita Torneos andando.
   - No depende de la release de Android.
7. **Costo:** una imagen más en Artifact Registry. Cloud Run no agrega costo fijo por la revisión nueva.

---

## 7. Compatibilidad con binarios publicados

### 7.1 Los binarios quedan congelados

- `capacitor.config.ts` no usa `server.url`: la app sirve el `build/` empaquetado en el binario.
  - No hay hot reload ni live update.
  - Los `REACT_APP_*` se compilan en el build: la URL del gateway, los flags de producto y el modo de datos.
- Cada usuario actualiza cuando quiere, y una versión vieja puede seguir viva meses.
  - Play (producción escalonada) y App Store (phased release) **no permiten downgrade**. Un arreglo es siempre otra
    versión.
  - El gateway y las RPC tienen que servir **a la vez** a la web de hoy y a cada binario soportado.
- **Hoy:**
  - Las versiones de tienda en producción son la 1.1.21, que no tiene Torneos y no llama al gateway.
  - Play Internal 1.1.22 (42) compiló Torneos cerrado.
  - **El contrato empieza con el primer binario publicado con Torneos** (previsto: 1.1.23, Android e iOS). Desde ese
    momento, todo lo del §7.3 queda congelado.

### 7.2 Reglas para cambios futuros del gateway, de las RPC y de las migraciones de Torneos

1. **Nunca quitar ni renombrar** algo que use un binario soportado, salvo con ventana de deprecación:
   - una ruta;
   - una RPC;
   - un parámetro;
   - un campo de respuesta;
   - una columna de las tablas leídas por ruta de tabla.

   **Ventana propuesta:** hasta que la versión mínima soportada (§7.4) excluya a todos los binarios que lo usan, y
   **nunca menos de 90 días** desde que el reemplazo está publicado en las dos tiendas.
2. **Sólo cambios aditivos:**
   - RPC nuevas;
   - parámetros nuevos **con `DEFAULT`** (cuidado con los overloads: PostgREST resuelve por nombre, y dos firmas
     compatibles dan `PGRST203`);
   - campos de respuesta nuevos: el cliente ignora los que no conoce.

   **Rompen un binario viejo:**
   - cambiar un tipo;
   - agregar un parámetro obligatorio;
   - endurecer la validación de un cuerpo (por ejemplo `PUBLIC_PARAMS` de la ruta pública);
   - bajar un tope de tamaño. Ejemplos: los 2 MiB de logos que valida el cliente; para la galería, que no está en la
     fase 1, la bajada de topes de #204, que en la web exigió el orden web → función → gateway.
3. **Contrato de errores estable.** El transporte nativo lee estos estados y textos, y sólo se pueden **agregar**
   códigos nuevos:
   - `401` → un re-exchange;
   - `403` `rpc not enabled` → `TORNEOS_FORBIDDEN`;
   - `400`, `429`;
   - `503` `CORE_UNAVAILABLE` o `access denied`;
   - 409/422/429 de ERROR-CONTRACT-V1;
   - el cuerpo de PostgREST `{ message, code, details, hint }`;
   - los códigos de dominio `PTxxx` / `TORNEOS_*`.
4. **Los flags se fijan al compilar.** Los modos del gateway con los que se compiló un binario soportado tienen que
   seguir **encendidos** mientras ese binario esté soportado:
   - los 43 de staging-v1, COMPETITION y OFFICIALIZATION, siempre;
   - `CONNECTED` y `BRANDING` en la fase 1.

   Si se apaga un modo, esas pantallas pasan a error (`403 rpc not enabled`) en la app, y no hay forma de ocultarlas
   hasta que el usuario actualice.

   `BRANDING_MODE` además cambia la **forma** de la respuesta de las RPC firmadas (campos de URL firmada).

   Los modos son globales: apagarlos afecta también a la web.
5. **URL y orígenes fijos en el binario:**
   - El host de `REACT_APP_TORNEOS_GATEWAY_URL` (Cloud Run São Paulo) tiene que seguir sirviendo. Si un día hay dominio
     propio, la URL `run.app` se mantiene viva.
   - No se quitan `https://localhost` ni `capacitor://localhost` mientras haya un binario soportado, salvo como kill
     switch deliberado.
   - Nunca se cambian `androidScheme`, `iosScheme` ni hostname: además de romper CORS, deslogueaba a todos.
6. **Exchange:**
   - `POST /exchange` con el bearer de Core y cuerpo vacío o `{}` devuelve `{ access_token, token_type: "Bearer", expires_in }`.
   - El cliente trata el token como opaco y renueva con otro exchange: no hay endpoint de refresh.
   - Rotar claves RS256 o cambiar el TTL es compatible. Cambiar la forma de la respuesta no lo es.
7. **CORS:**
   - Los headers que el binario manda tienen que seguir en `access-control-allow-headers`. Hoy son `authorization`,
     `content-type`, `accept`, `prefer`, `range`, `apikey`, `x-client-info` y `x-supabase-api-version`.
   - Si un binario futuro manda un header nuevo, **el gateway lo admite primero** (deploy) y **después** sale ese
     binario. Si no, falla el preflight.
8. **Antes de cada PR del gateway o de una migración de Torneos:** contrastar con la lista del §7.3.

   **Propuesta (no implementada):** un test de CI que congele esa lista, rutas + RPC + columnas, y falle si algo
   desaparece mientras su versión mínima siga soportada.

### 7.3 Qué tiene que quedar estable (lo que llama un binario de la fase 1)

**Fuentes:**
- El mapa B04 (`docs/torneos/b04/TORNEOS-CALL-MAP.md`): los 108 sitios legacy encaminados por el adapter híbrido
  (staging v1 + COMPETITION-V1).
- Las instantáneas de scope del cliente (`src/features/torneos/foundation/*Scope.js`). Sus guardas verifican que sean
  iguales a los allowlists del gateway.

**Set de claves nativo:**
- El script de Android de hoy (`scripts/build-android-release.mjs`, 8 claves, perfil 1.1.22) usa el subconjunto
  **sin** CONNECTED ni BRANDING.
- La fase 1 propuesta (Android e iOS) son esas 8 claves **+ `CONNECTED_MODE` + `BRANDING_MODE`**.

**Rutas:**

| Ruta | Set 8 claves | Fase 1 (+CONNECTED +BRANDING) |
|---|---|---|
| `OPTIONS` (preflight) de cada ruta de abajo | ✅ | ✅ |
| `POST /exchange` | ✅ | ✅ |
| `POST /torneos/rest/v1/rpc/<name>` (RPC de la tabla siguiente) | ✅ | ✅ |
| `GET /torneos/rest/v1/tournament_organization_members?select=id,user_id,role,status,joined_at,created_at` | ✅ | ✅ |
| `GET /torneos/rest/v1/tournament_venues?select=id,name,address,place_id,latitude,longitude,locality,timezone,status,notes` | ✅ | ✅ |
| `GET /torneos/rest/v1/tournament_courts?select=id,venue_id,name,sport_modality,status,notes` | ✅ | ✅ |
| `POST /torneos/public/v1/rpc/<name>` (públicas, sin credencial) | ✅ | ✅ |
| `POST /torneos/branding/v1/object/<org>/<kind>/<entity>` (subir) y `DELETE …/<uuid>.<jpg/png/webp>` (quitar) | — | ✅ |
| `/torneos/media/v1/*`, `/commerce/v1/*`, lecturas de commerce, SOCIAL, PLAN_READ | — | — (prohibidas en nativo) |

**RPC** (149 nombres: 145 autenticadas y 4 públicas):

| Contrato | Ruta | Feature | # | RPC |
|---|---|---|---|---|
| staging-v1 | autenticada | `organizations_workspaces` | 11 | `create_tournament_organization`, `update_tournament_organization`, `is_tournament_organization_slug_available`, `is_tournament_organization_member`, `has_tournament_organization_capability`, `has_tournament_capability`, `tournament_role_capabilities`, `get_my_tournament_memberships`, `get_tournament_workspace_context`, `set_tournament_workspace_preference`, `set_active_tournament_context` |
| staging-v1 | autenticada | `collaborators` | 5 | `assign_tournament_season_member`, `remove_tournament_season_member_assignment`, `list_tournament_season_member_assignments`, `has_tournament_season_access`, `has_tournament_season_capability` |
| staging-v1 | autenticada | `seasons` | 2 | `create_tournament_season`, `update_tournament_season` |
| staging-v1 | autenticada | `tournaments` | 7 | `create_tournament_with_defaults`, `update_tournament_configuration`, `change_tournament_status`, `save_tournament_category`, `get_tournament_competition_context`, `get_tournament_creation_eligibility`, `has_organization_consumed_free_tournament` |
| staging-v1 | autenticada | `team_registration_basic_roster` | 14 | `create_tournament_team_entry`, `update_tournament_team_entry`, `submit_tournament_team_entry`, `withdraw_tournament_team_entry`, `archive_tournament_team_entry`, `get_team_registration_context`, `get_tournament_teams_context`, `can_read_tournament_team_entry`, `is_tournament_team_manager`, `add_tournament_roster_player`, `update_tournament_roster_player`, `remove_tournament_roster_player`, `create_tournament_provisional_player`, `search_tournament_players` |
| staging-v1 | autenticada | `invitations` | 2 | `invite_tournament_team_manager`, `accept_tournament_team_invitation` |
| staging-v1 | autenticada | `core_team_import` | 1 | `search_tournament_arma2_teams` |
| staging-v1 | autenticada | `team_entry_review` | 1 | `review_tournament_team_entry` |
| competition-v1 | autenticada | `fixtures` | 20 | `get_tournament_fixture_context`, `get_tournament_schedule_context`, `freeze_tournament_participants`, `reopen_tournament_participants`, `save_tournament_draw_pots`, `execute_tournament_group_draw`, `generate_tournament_fixture`, `create_manual_fixture_version`, `update_draft_fixture`, `validate_tournament_fixture`, `publish_tournament_fixture`, `append_tournament_playoff_phase`, `supersede_tournament_fixture`, `create_tournament_venue`, `create_tournament_court`, `save_tournament_schedule_windows`, `validate_tournament_match_schedule`, `schedule_tournament_match`, `reschedule_tournament_match`, `auto_schedule_tournament_matches` |
| competition-v1 | autenticada | `match_operations` | 20 | `get_player_tournament_matches`, `get_managed_tournament_matches`, `respond_match_availability`, `get_tournament_match_operations_context`, `get_tournament_match_operation_context`, `get_match_squad_context`, `get_my_managed_match_squad_context`, `save_match_squad`, `submit_match_squad`, `open_tournament_match_operation`, `set_tournament_match_outcome`, `set_tournament_match_score`, `add_tournament_match_event`, `void_tournament_match_event`, `submit_tournament_match_operation`, `review_tournament_match_operation`, `validate_tournament_match_operation`, `make_tournament_match_official`, `request_tournament_match_correction`, `create_tournament_match_correction` |
| competition-v1 | autenticada | `standings` | 5 | `get_tournament_standings_context`, `get_tournament_statistics_context`, `rebuild_tournament_standings`, `publish_tournament_standings_revision`, `resolve_tournament_qualification` |
| competition-v1 | autenticada | `lifecycle_actions` | 3 | `start_tournament_competition`, `finish_tournament_competition`, `reopen_tournament_competition` |
| competition-v1 | autenticada | `participant_withdrawal` | 1 | `withdraw_tournament_competition_participant` |
| competition-v1 | autenticada | `participant_hub` | 7 | `get_tournament_participant_hub`, `set_my_tournament_hub_category`, `get_published_tournament_matches`, `get_tournament_participant_match`, `get_published_tournament_teams`, `get_published_tournament_standings`, `get_published_tournament_statistics` |
| competition-v1 | autenticada | `communications` | 14 | `get_tournament_communications_inbox`, `get_tournament_announcement`, `mark_tournament_announcement_read`, `get_published_tournament_documents`, `acknowledge_tournament_document`, `get_tournament_communications_admin_context`, `create_tournament_announcement_draft`, `update_tournament_announcement_draft`, `replace_tournament_announcement_audience`, `set_tournament_announcement_link`, `preview_tournament_announcement_audience`, `publish_tournament_announcement`, `create_tournament_document`, `publish_tournament_document_version` |
| competition-v1 | autenticada | `notifications` | 2 | `get_my_tournament_notification_preferences`, `update_my_tournament_notification_preferences` |
| competition-v1 | autenticada | `public_pages` | 2 | `get_tournament_public_page_settings`, `set_tournament_public_page_published` |
| competition-v1 | pública | `public_pages` | 1 | `get_public_tournament_page` |
| officialization-v1 | autenticada | `organization_members` | 7 | `list_tournament_organization_members`, `list_tournament_organization_invitations`, `invite_tournament_organization_member`, `revoke_tournament_organization_invitation`, `accept_tournament_organization_invitation`, `update_tournament_organization_member_role`, `remove_tournament_organization_member` |
| officialization-v1 | autenticada | `match_dual_control` | 2 | `get_tournament_match_dual_control`, `set_tournament_match_dual_control` |
| connected-v1 (**CONNECTED**, fase 1) | autenticada | `torneos_profile` | 2 | `get_my_torneos_profile`, `update_my_torneos_profile` |
| connected-v1 (**CONNECTED**, fase 1) | autenticada | `torneos_inbox` | 3 | `get_my_torneos_notifications`, `mark_my_torneos_notifications_read`, `get_my_torneos_inbox_summary` |
| connected-v1 (**CONNECTED**, fase 1) | autenticada | `catalog_management` | 6 | `get_tournament_catalog_listing_settings`, `save_tournament_catalog_listing`, `set_tournament_catalog_listing_status`, `set_tournament_applications_state`, `save_tournament_category_capacity`, `get_tournament_application_inbox` |
| connected-v1 (**CONNECTED**, fase 1) | autenticada | `tournament_applications` | 5 | `search_my_applicable_core_teams`, `start_tournament_application`, `get_my_tournament_registrations`, `list_my_core_teams_for_application`, `get_my_tournament_participations` |
| connected-v1 (**CONNECTED**, fase 1) | pública | `tournament_catalog` | 3 | `search_tournament_catalog`, `get_tournament_catalog_facets`, `get_tournament_catalog_entry` |
| branding-v1 (**BRANDING**, fase 1) | autenticada | `branding_assets` | 2 | `set_tournament_branding_reference`, `get_tournament_branding_context` |
| branding-v1 (**BRANDING**, fase 1) | pública | `public_pages` | 1 | `get_public_tournament_branding` |

**Lo que está en el gateway pero NO llama un binario de la fase 1 (y puede cambiar sin ventana nativa):**
- las lecturas de commerce (`get_effective_tournament_season_entitlements`, `get_tournament_purchase`,
  `get_tournament_season_purchases`), el checkout y el refresh;
- SOCIAL-V1 y PLAN_READ;
- MEDIA-V1 (galería y `/torneos/media/v1/*`).

Si una fase posterior los agrega a un binario, pasan a esta lista.

### 7.4 Versión mínima soportada (propuesta, no implementada)

Hace falta poder decir «esta versión ya no está soportada, actualizá» antes de cerrar una ventana de deprecación.

**Opción A, recomendada: chequeo en Core.**
- Una fila pública de configuración en Core, por ejemplo `min_supported_version` por plataforma, con mensaje y link a
  la tienda.
- La app la lee al abrir, con `@capacitor/app` → `getInfo()` para la versión.
- Si la versión es menor, muestra una pantalla bloqueante «Actualizá la app» (o sólo en la entrada a Torneos).
- **Ventajas:**
  - no toca el gateway ni CORS;
  - sirve también para Core;
  - se cambia sin deploy.
- **Requisito:** tiene que estar en el **primer** binario con Torneos. Un binario sin ese chequeo nunca lo va a tener.

**Opción B, complementaria: header de versión hacia el gateway.**
- Un header como `x-arma2-client: ios/1.1.23 (42)`.
- El gateway podría responder `426` con `{ "error": "CLIENT_UPGRADE_REQUIRED" }` debajo de un piso.
- **Condiciones:**
  - el gateway tiene que admitir antes el header en `access-control-allow-headers` (deploy **previo** al binario);
  - nunca puede rechazar requests **sin** el header (binarios viejos y la web);
  - el piso no debería ser un env nuevo sin revisión.
- Es más intrusiva que la A. Conviene sólo si hace falta cortar en el servidor.

En los dos casos, la ventana de deprecación del §7.2 se mide contra ese piso.

---

## 8. Tests

- `backend/torneos/infra/torneos-ios-origin/ios-origin.test.mjs`: el `handle()` real de dos fuentes, comparado
  contra el árbol inmediatamente anterior a este PR (en la rama de integración, `601723dc` = `main` `b4fb150a` + #213 #212
  #217 #218 #216 #214). Cubre:
  - tres entornos: todo apagado; CONNECTED + BRANDING + MEDIA; y lo mismo + COMMERCE-PRODUCTION;
  - todas las rutas;
  - negativos;
  - preflight;
  - Referer;
  - commerce y pagos;
  - guardas de fuente;
  - el espejo Node del lab.
- `backend/torneos/infra/torneos-android-origin/android-origin.test.mjs`: la lista ahora es `[web, Android, iOS]`.
  En el diferencial contra la fuente previa a Android cambian sólo los dos orígenes nativos.
- `backend/torneos/infra/torneos-gateway-auth/offline-rehearsal.mjs`: el ensayo E2E (Docker) espera
  `capacitor://localhost` → 200 con su permiso exacto, y los casi-iguales → 403.
