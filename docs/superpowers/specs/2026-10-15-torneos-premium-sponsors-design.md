# Sponsors Premium en el Estudio Social: spec (2026-10-15)

- **Autorización:** Nico, vía Codex, autoriza explícitamente implementar el recorrido completo. **Fuera de alcance:** aplicar a Producción y desplegar.
- **Rama:** `claude/torneos-premium-sponsors`, desde origin/main `b4fb150a`, en un worktree aislado. El commit en la rama lleva la misma spec en `docs/superpowers/specs/2026-10-15-torneos-premium-sponsors-design.md`.

**Lo que se reutiliza** (según el inventario del 2026-10-15):
- **Renderer Premium:** ya dibuja de 0 a 3 logos (`premiumDataAdapter.js:351-365`, `PremiumSponsorMark`, `premiumGeometry.withSponsors`, `socialThemes` `capabilities.sponsors`).
- **Pipeline de branding:** bucket privado `tournament-branding`. El upload pasa por el gateway hacia el media store, que valida HMAC, magic bytes, ≤ 2 MiB, ≤ 4096 px y quita la metadata. El gateway firma las lecturas en las respuestas de `SIGNED_AUTHENTICATED_RPCS`, para las claves de `URL_KEYS`. La función `collectPaths`/`attachUrls` es recursiva.
- **Entitlement `sponsors`:** ya sembrado en el baseline (`:41916`, premium=true).

## 1. Alcance funcional
1. **Alta, edición y baja** de sponsors por organización.
   - Datos: nombre (1–60 caracteres) + logo (jpg/png/webp, con las mismas validaciones que los logos actuales).
   - Hasta 20 activos por organización.
   - Dónde: Configuración de la organización → pestaña **Sponsors**.
   - Quién: propietario y administrador (`organization.update`).
2. **Selección por placa:** hasta 3 sponsors activos con logo. Se ve en la preview y se incluye en el export.
   - Sólo en los estilos Premium con `capabilities.sponsors=true`: Heritage, Street, Scoreboard y Editorial. En Base no se ofrece.
   - Aplica a todas las piezas y a los dos formatos, Feed 4:5 e Historia 9:16.
3. **Entitlement Premium (`sponsors`):**
   - **Servidor:**
     - crear y editar exige que la organización tenga al menos una temporada con `sponsors` efectivo;
     - autorizar un export con sponsors exige `sponsors` efectivo en la temporada del torneo;
     - la baja está siempre permitida.
   - **UI:** sin Premium, la pestaña muestra el gate Premium (`PremiumFeatureGate`) y el Estudio no ofrece la selección.
4. **Vencimiento o revocación de Premium** (devolución, contracargo; ver `is_tournament_season_plan_grant_effective`):
   - Los sponsors **quedan guardados**.
   - La selección se oculta.
   - El servidor rechaza el export con sponsors y también el alta y la edición.
   - Si Premium vuelve, los sponsors reaparecen.
5. **Assets reemplazados o eliminados:**
   - **Reemplazo:** se sube un objeto nuevo, la RPC devuelve la ruta anterior y el cliente la borra. El render key incluye `logoPath`, así que la preview se invalida.
   - **Baja:** archivado lógico (`archived_at`). Después de la RPC se borra el logo. Un sponsor archivado no se puede seleccionar ni exportar.
   - El borrado de objetos sigue la regla actual de «en uso» del media store, extendida a la tabla nueva.
6. **FREE:** el comportamiento no cambia. No hay selección ni pestaña operativa, y el render y el export son idénticos a hoy (test de regresión).
7. **Aislamiento:** todo se resuelve en el servidor por `organization_id`. Un sponsor de otra organización nunca se lista, edita ni autoriza (tests).

## 2. Diseño técnico
### 2.1 Base: migración `0020_premium_sponsors`
- **Tabla `public.tournament_organization_sponsors`:**
  - Columnas: `id uuid pk`, `organization_id fk`, `name text check (1..60)`, `logo_path text null`, `sort_order int`, `created_by`, `created_at`, `updated_at`, `archived_at`.
  - `logo_path` válido con `is_tournament_branding_path` y con el kind **organizations** de la misma organización (`<org>/organizations/<org>/<uuid>.ext`).
  - Se reusa el kind existente, así que **no cambia** la regex de rutas del SQL, el gateway, el media store ni el cliente.
  - RLS activado y **sin grants a la API**: el acceso es sólo por RPC SECURITY DEFINER con `private.current_identity_id()`, como en el patrón de 0009.
- **RPC** (todas `authenticated` y filtradas por organización):
  - `get_tournament_organization_sponsors(p_organization_id, p_season_id default null)` → `{ organizationId, canManage, entitled, sponsors: [{ id, name, logoPath, sortOrder }] }`. La pueden leer los miembros de la organización.
  - `upsert_tournament_organization_sponsor(p_organization_id, p_sponsor_id null, p_name, p_logo_path, p_sort_order)` → `{ sponsor, previousLogoPath }`. Exige `organization.update` y el entitlement.
  - `archive_tournament_organization_sponsor(p_organization_id, p_sponsor_id)` → `{ previousLogoPath }`. Exige `organization.update`, no el entitlement.
  - `authorize_tournament_social_sponsors(p_season_id, p_tournament_id, p_theme, p_sponsor_ids uuid[])` → `{ authorized, sponsors: [{ id, name, logoPath }] }`.
    - Exige `social.export` en la temporada, un tema distinto de base y con `sponsors`, a lo sumo 3 ids distintos, todos activos, de la misma organización y con logo, y el entitlement efectivo de la temporada.
    - Si falla, devuelve un error tipado que no filtra datos de otra organización.
    - **No se toca** `authorize_tournament_social_export` (0008: sus pins y firmas son fijos).
- **`private.tournament_branding_object_in_use`:** se extiende para que una ruta referenciada por un sponsor activo cuente como en uso.
- **Pre y post checks** al estilo de la casa: md5 de los cuerpos tocados, conteo de ACL y «nada más se movió».
- **Rollback:** `backend/torneos/sponsors-v1/rollback/00000000000020_premium_sponsors.rollback.sql`. Restaura el cuerpo exacto de `in_use` y elimina la tabla; si la tabla tiene filas, se niega salvo con `--force`.
- **Ensayo:** en un lab local, apply → tests → rollback → re-apply.
- **Driver:** `backend/torneos/sponsors-v1/remote/db-0020.mjs`, con frases, sha256 y PRE/POST como en `db-0017.mjs`. Se prepara; **nunca se ejecuta contra un remoto**.

### 2.2 Gateway: contrato BRANDING-V1, sin contrato nuevo
- Las 4 RPC entran en el allowlist de branding.
- `get_tournament_organization_sponsors` y `authorize_tournament_social_sponsors` entran en `SIGNED_AUTHENTICATED_RPCS`. Así el firmador recursivo firma `logoPath` y agrega `logoUrl`.
- Se actualizan el espejo Node del lab (`integration/torneos-core-contracts/gateway.mjs`), el scope del cliente (`brandingV1Scope.js`) y los pins y tests del contrato.

### 2.3 Cliente
- **Servicios** en las dos composiciones, híbrida y local:
  - `loadOrganizationSponsors`;
  - `saveOrganizationSponsor`: usa el `uploadBrandingAsset` existente con kind organization y después la RPC; si la RPC falla, borra el objeto subido;
  - `archiveOrganizationSponsor`: la RPC y después el borrado del logo;
  - `authorizeSocialSponsors`.
- **Configuración:** una pestaña «Sponsors» en `OrganizationSettingsNav`, con lista, alta, edición (nombre + logo, con la misma pieza de preview y carga) y baja con confirmación. Sin entitlement se muestra `PremiumFeatureGate`.
- **Estudio Social:**
  - Un selector «Sponsors (hasta 3)» junto al tema y la firma, que sólo aparece si la temporada tiene `sponsors` y el tema lo soporta.
  - La selección entra en `renderInputsKey` y en las dos llamadas a `prepareSocialRender`, como `sponsors: [{ id, name, image: logoUrl }]`. Los logos se precargan como bitmap o data URL, igual que los escudos.
  - El render key suma `logoPath`.
  - Antes de exportar se llama a `authorizeSocialSponsors` y se usa **sólo** la lista que devuelve el servidor.
- **Harness offline** (`scripts/qa/social-studio`): emula el contexto y la autorización de sponsors con logos ficticios. Suma un caso de browser-check con 0, 1 y 3 sponsors, en los 4 estilos y los 2 formatos.
- **B04:** antes de pushear, regenerar (`node scripts/torneos-frontend/report.mjs`) y correr `test:torneos:frontend-foundation`.

## 3. Verificación
- **DB, en el lab:**
  - aislamiento entre 2 organizaciones;
  - roles: owner y admin pueden, collaborator no;
  - con y sin entitlement;
  - revocación del grant: authorize y upsert rechazados, lectura y archivo permitidos;
  - un sponsor archivado no se autoriza;
  - más de 3 se rechaza; el tema base se rechaza;
  - `in_use` contempla los sponsors;
  - rollback y re-apply.
- **Gateway, en el lab:** el allowlist, la firma de `logoPath` en las 2 RPC, y el upload y delete por la ruta existente.
- **Frontend:**
  - Jest de los servicios, la pestaña y el selector;
  - FREE sin cambios: render y export idénticos.
- **Browser:** exports reales del harness en 4 estilos × 2 formatos × 0/1/3 sponsors.
- **Demo E2E en el lab aislado** (`arma2-qa-capturas`, ver `assets/pantallas/fase2/README.md`):
  - organización «Liga Primavera» con sponsors ficticios y logos sintéticos generados localmente, sin marcas reales;
  - capturas de alta, edición, selección, preview y export, más el PNG exportado.

## 4. Fuera de alcance
- Remotos y deploy (gateway, web, media store).
- Los bugs de las placas: van en `propuestas/premium-placas`, en un cambio aparte. No mezclar.
- Sponsors en la página pública o en la galería.
