# Arma2 Torneos: experiencia de planes FREE / PRO

## Objetivo

Esta entrega incorpora una superficie de lectura para que una organización de
Arma2 Torneos vea su plan efectivo, lifecycle, beneficios y límites. No agrega
billing, precios, checkout ni mutaciones de suscripción.

La ruta es:

`/torneos/organizacion/:organizationId/configuracion/plan`

La navegación sigue el patrón existente `Configuración → Plan` y comparte la
misma implementación React responsive en browser, iOS y Android (Capacitor).

## Ownership del plan

El plan pertenece a `tournament_organizations`. No pertenece al usuario y no
se deriva de su sesión, nombre de rol, ruta, query string, localStorage ni flag
de frontend. Un mismo usuario puede administrar organizaciones con planes
distintos y participar en otros torneos sin que esas relaciones se mezclen.

Los roles y los entitlements son dimensiones independientes:

- owner y admin poseen `workspace.manage` en la matriz canónica y pueden abrir
  el CTA futuro, que hoy sólo muestra un modal local;
- collaborator puede consultar el plan porque es miembro, pero el CTA futuro
  permanece deshabilitado si no posee `workspace.manage`;
- participant no recibe acceso a la administración comercial: el guard de
  organización sólo monta la ruta para miembros del workspace;
- ningún rol concede PRO ni una capability comercial.

## Foundation y resolver canónicos

La única foundation continúa siendo la migration
`20260810160355_tournament_entitlements_foundation.sql`:

- `tournament_entitlement_plans` contiene la política FREE/PRO;
- `tournament_entitlement_capabilities` contiene el catálogo;
- `tournament_organization_subscriptions` contiene un lifecycle PRO por
  organización;
- `tournament_organization_entitlement_overrides` y
  `tournament_entitlement_overrides` permiten overrides server-only;
- `get_effective_tournament_entitlements(organization_id, tournament_id)` es
  la proyección pública canónica;
- `has_tournament_entitlement(...)` es el guard booleano canónico.

La pantalla llama exclusivamente a `get_effective_tournament_entitlements`
mediante `tournamentWorkspaceService.loadEntitlements`. El cliente sólo envía
el scope (`organizationId`, `tournamentId: null`); nunca envía plan,
capabilities, status ni límites.

Antes de mostrar el payload se valida:

1. `schemaVersion === 1`;
2. plan conocido (`FREE` o `PRO`);
3. `scope.organizationId` igual al workspace pedido;
4. `scope.tournamentId` igual al scope pedido;
5. capabilities conocidas y booleanas estrictas;
6. límites multimedia con tipos esperados.

Un error, schema desconocido, plan desconocido, scope cruzado o dato
incompleto falla cerrado: PLAN FREE/no verificado y capabilities desactivadas.
Al cambiar de workspace se descarta inmediatamente la proyección anterior
antes de resolver la siguiente organización.

## Lifecycle

La semántica no se reimplementa en el cliente. La migration resuelve:

- `active` vigente → PRO;
- `cancelled` antes de `current_period_end` → PRO;
- `grace_period` antes de `grace_until` → PRO;
- `past_due` → FREE en esta fase;
- `expired` → FREE;
- fila ausente, período vencido o datos inconsistentes → FREE.

La UI usa `plan` como resultado efectivo y `subscriptionStatus` sólo como
explicación del lifecycle. Así, `expired` y `past_due` nunca pintan PRO activo.
`cancelled` y `grace_period` conservan el badge PRO sólo cuando el resolver
también devuelve PRO.

El resolver v1 actual no expone `currentPeriodEnd`, `graceUntil`,
`cancelledAt` ni `source`. Por eso esta PR muestra el estado y su semántica,
pero no inventa una fecha ni un proveedor. Una evolución futura del contrato
canónico puede exponer esas fechas de lectura; esta PR no crea una segunda
consulta a la tabla privada ni una nueva foundation.

## FREE / PRO y catálogo efectivo

La pantalla no mantiene una matriz paralela de `free_enabled` / `pro_enabled`.
Presenta lenguaje amigable vinculado uno a uno con las claves ya conocidas por
el cliente y decide su estado sólo desde la proyección efectiva:

- `media.upload`;
- `media.history`;
- `media.extended_retention`;
- `social_studio.basic`;
- `social_studio.full`;
- `advanced_stats`;
- `higher_limits`.

Cada fila informa `Incluido`, `No incluido en el plan actual` o `No disponible
en este entorno`. La comparación FREE/PRO es explicativa; nunca constituye una
promesa comercial ni desbloquea una función.

## Feature flags vs entitlement

Un entitlement no enciende una superficie global. La presentación combina:

- multimedia con `mediaEnabled`;
- carga con `mediaUploadEnabled` (que ya incorpora readiness operativo);
- Social Studio con `socialContentGenerator`;
- estadísticas avanzadas con `officialStats`.

Cuando el flag relevante está apagado, la fila se marca no disponible aunque
el entitlement sea `true`. La pantalla no cambia flags. Las acciones reales de
Social Studio continúan exigiendo además sus capabilities específicas de rol
(`social.create`, `social.export`, etc.) en los RPCs existentes.

## Multimedia

Los cuatro valores se leen de `entitlements.media`:

- `maxPhotosPerMatchday`;
- `retainedMatchdays`;
- `retentionGraceDays`;
- `postExpirationRetentionDays`;
- y, cuando existe, `postProProtectedUntil`.

Un `null` PRO se presenta como `A definir`, porque el contrato indica “sin
límite comercial configurado”, no permiso operativo ilimitado. Esta PR no
modifica buckets, privacidad, upload sessions, trusted processing, purge,
retention candidates ni el pipeline multimedia. Los datos deportivos
estructurados siguen fuera de toda retención de fotos.

## Locked features

Los locks nuevos viven sólo en la explicación del catálogo de Plan. No se
agregaron guards server-side, no se cambió el catálogo y no se bloqueó ninguna
funcionalidad que hoy resuelva FREE. Las superficies existentes conservan sus
guards canónicos. En particular, participant sigue accediendo a las
capabilities participant-applicable que el backend resuelva para su torneo.

## CTA y precio

FREE muestra `Pasar a PRO` y PRO muestra `Gestionar plan`. Para un miembro con
`workspace.manage`, ambos abren un modal `Disponible próximamente`. Para un
miembro sin esa capability, el botón permanece deshabilitado con copy de rol.

El modal:

- no llama servicios;
- no crea ni actualiza filas;
- no modifica entitlements;
- no abre una URL externa;
- no persiste estado;
- no concede PRO.

No hay precio, moneda ni importe hardcodeado. La UI dice `Sin precio publicado`.

## Web / native parity

No existe una implementación web-only. La ruta está dentro de `TorneosShell`,
que se usa en browser y en el runtime Capacitor de iOS/Android. La vista usa
CSS Grid amplio en desktop, dos columnas intermedias y cards verticales con
targets táctiles en mobile/native. Respeta safe areas del shell y
`prefers-reduced-motion`.

## Estados seguros

- Organización sin subscription row: FREE / `Sin suscripción PRO`.
- PRO active: PRO / `Activo`.
- PRO cancelled vigente: PRO / `Cancelado`.
- PRO grace vigente: PRO / `Período de gracia`.
- Expired: FREE / `PRO vencido`.
- Past due: FREE / `Acceso PRO pausado`.
- Resolver error o payload incompleto: FREE no verificado, capabilities false,
  límites no verificados y reintento local.
- Usuario sin organización o participant sin membership: el guard existente no
  monta administración de Plan.
- Cambio de workspace: invalida el plan anterior antes de cargar el nuevo.

## No billing

No se agregó backend, migration, tabla, provider SDK, secret, payment intent,
provider customer, provider subscription, receipt, checkout ni webhook. No se
contactó Supabase remoto, Staging ni Production para implementar esta entrega.

## Futuro checkout web y sincronización móvil

Una etapa futura, separada y revisada, podrá implementar checkout web (por
ejemplo Mercado Pago) y validación de compras Apple/Google. Ese backend deberá
validar pagos en un entorno confiable y transicionar el lifecycle canónico; la
app sólo seguirá leyendo `get_effective_tournament_entitlements`.

La compra web futura deberá sincronizarse con iOS/Android por la misma
organización, no por una bandera del usuario. La app refrescará el resolver al
cambiar workspace, recuperar foco o recibir una señal autenticada. Ningún
receipt, token ni webhook debe convertir al cliente en fuente de verdad.
