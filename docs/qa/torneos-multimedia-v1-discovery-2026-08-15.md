# Arma2 Torneos · Multimedia V1 — discovery y plan técnico

**Fecha:** 2026-08-15
**Estado:** diagnóstico y propuesta; sin implementación
**Worktree:** `arma2-torneos-multimedia-v1`
**Branch:** `feature/torneos-multimedia-v1`
**Base:** `origin/epic/arma2-torneos` @ `a679f00f5390b1ff6389384e8a464e3c48243cf5`

## 1. Alcance y límites de esta revisión

Este documento inventaría la base real de Multimedia en Arma2 Torneos y propone
un V1 incremental. Durante la revisión:

- no se implementó UI, backend, migración ni refactor;
- no se creó ni modificó ningún bucket;
- no se escribieron datos locales ni remotos;
- no se consultó ni modificó Staging o Producción;
- no se hizo commit, push ni PR;
- Social Studio permaneció en su worktree y branch independientes.

La inspección de Storage distingue deliberadamente dos fuentes:

1. **Contrato versionado:** migraciones, Edge Functions, servicios, tests y
   documentación presentes en este commit.
2. **Runtime local:** no verificable en esta máquina porque no hay Docker ni
   Podman disponible para levantar Supabase local. El CLI global (`2.84.2`)
   tampoco entiende `local_smtp`; con `supabase@2.110.0` el bloqueo pasa a ser
   únicamente la ausencia del runtime de contenedores.

Por lo tanto, toda afirmación de existencia de buckets o políticas se refiere al
contrato del repositorio, no a un catálogo SQL vivo.

## 2. Conclusión ejecutiva

Multimedia **no es un módulo vacío**. El epic ya incluye una implementación
considerable y orientada a privacidad:

- centro administrativo de galerías, cola de carga, moderación, portada, orden,
  publicación, archivo y reportes;
- galería de participantes en overview, pestaña Fotos y detalle de partido;
- once tablas del dominio, RLS, RPCs `security definer`, capabilities,
  entitlements, cuotas, retención, consentimientos y auditoría;
- bucket privado previsto, URLs firmadas de lectura y pipeline robusto o MVP
  simple, ambos fail-closed;
- integración parcial y correctamente desacoplada con Social Studio mediante
  `photoAssetId` y resolución a bitmap.

El bloqueo principal no es diseñar otra librería de archivos, sino **cerrar y
activar de forma controlada el contrato existente**. El bucket privado no forma
parte del baseline canónico, la readiness deja la carga apagada y faltan
decisiones/producto para logos, colores de torneo, retratos de jugadores —en
especial provisionales—, borrado físico y reutilización transversal.

La recomendación es conservar `tournament_media_assets` como asset canónico de
fotos de torneo, no construir carpetas genéricas ni un “Google Drive”, y separar
las identidades visuales (logos/escudos/colores) del contenido editorial de una
galería.

## 3. Superficie actual de producto

### 3.1 Navegación y administración

La ruta administrativa ya existe:

`/torneos/organizacion/:organizationId/multimedia`

`TorneosShell.jsx` la monta bajo `OrganizationRouteGuard` y muestra el acceso
“Multimedia”. `MediaAdminPage.jsx` no es un placeholder: carga
`get_tournament_media_admin_context`, deriva las acciones de capabilities y
ofrece:

- filtro por torneo y estado;
- creación de galería por torneo, categoría, fecha o partido;
- visibilidad por organización, participantes, partido, equipos relacionados o
  administración privada;
- selección por picker, drag-and-drop y cámara;
- preview, progreso real, reintento y cancelación;
- revisión: aprobar, rechazar, ocultar y restaurar;
- portada, reordenamiento, publicación y archivo;
- gestión de reportes y pedidos de ocultamiento por privacidad;
- banner read-only para colaboradores.

La navegación no consulta `mediaEnabled`. La carga sí depende del contrato
operativo y de `mediaUploadEnabled`, pero hoy la presencia del acceso lateral y
la disponibilidad general del módulo no están alineadas con el flag. Antes de
activar V1 se debe decidir si:

- el acceso se oculta cuando `mediaEnabled` es falso; o
- la ruta sigue visible como archivo de sólo lectura, con un estado vacío o
  informativo explícito.

El comportamiento no debería quedar implícito.

### 3.2 Experiencia de participantes

`ParticipantMediaGallery.jsx` está integrado en `TournamentHubPage.jsx`:

- resumen de fotos en overview;
- pestaña Fotos;
- fotos asociadas en detalle de partido;
- grilla protegida y lightbox;
- URLs firmadas por variante (`grid` / `detail`);
- reporte de foto con motivo, privacidad y pedido de ocultamiento.

Sólo se proyectan galerías publicadas que la relación del participante permite
ver. El payload no entrega bucket, path interno ni checksum.

### 3.3 Página pública

La página pública de torneo no incluye Multimedia. Publica tabla, resultados,
fixture y escudos de equipos, pero no solicita URLs de `tournament-media`.
`tournament_public_pages` sólo administra publicación y slug; no tiene hero,
banner, logo de torneo ni selección de galería.

Esto es correcto para el estado actual: exponer fotos públicas exige un contrato
adicional de publicación explícita, consentimiento, derivado seguro, revocación
y caché. No se debe convertir el bucket privado en público para resolverlo.

## 4. Flags, permisos y plan: tres controles distintos

### 4.1 Feature flags y readiness

`featureFlags.js` impone:

- todos los flags de Torneos sólo pueden abrirse fuera de Producción y en un
  host local aislado o Staging autorizado;
- `mediaEnabled` depende de `torneosEnabled`;
- `mediaUploadEnabled` depende de `mediaEnabled`, de su propio flag y de cinco
  readiness flags: signer, worker, antivirus, cleanup y observabilidad.

La configuración falla cerrada. En el estado documentado del repositorio los
colectores de observabilidad no están implementados ni desplegados, por lo cual
la carga no puede habilitarse honestamente.

### 4.2 Capabilities por rol

Owner y admin reciben las trece capabilities de media: lectura, creación y
edición de galería, carga, revisión, publicación, archivo, revocación, portada,
tag de equipo/jugador, consentimiento y reportes.

Un colaborador sólo recibe `media.read`. Delegados y jugadores no son staff de
la organización: leen únicamente lo publicado que habilita su relación con el
torneo, partido o equipo. El backend robusto contempla fotógrafos asignados a
una galería; el tier `MVP_SIMPLE` restringe la carga a owner/admin activos.

### 4.3 Entitlements

El plan se resuelve en servidor y es independiente de los permisos del rol y de
la readiness:

- `media.upload`: FREE y PRO;
- `media.history`: PRO, y participante cuando su audiencia aplica;
- `media.extended_retention`: PRO;
- FREE: máximo 20 fotos por jornada, 3 jornadas retenidas y 7 días de gracia;
- PRO: los máximos comerciales están deliberadamente pendientes; `NULL` no
  significa confianza operativa ilimitada.

Una operación sólo debe pasar si se cumplen simultáneamente:

`feature/readiness + capability + entitlement + scope/audience + estado`

## 5. Storage: inventario y postura recomendada

### 5.1 Buckets versionados

| Bucket | Contrato actual | Uso real | Evaluación |
| --- | --- | --- | --- |
| `jugadores-fotos` | Público; JPEG/PNG/WebP/GIF; 15 MiB; escrituras owner-scoped | Avatar global y snapshots clásicos | No reutilizar para fotos privadas de torneo |
| `team-crests` | Público; JPEG/PNG/WebP/SVG; 5 MiB; path por usuario | Escudos de equipos | Reutilizable sólo si se endurece y se formaliza ownership |
| `tournament-media` | Privado; 12 MiB; JPEG/PNG/WebP; policies sólo `service_role` | Galerías, derivados y lectura firmada | Previsto pero no creado por el baseline canónico |

La migración canónica declara de forma explícita que no crea
`tournament-media`. Sí predeclara cuatro policies de `storage.objects`: lectura
`service_role`, inserción con path UUID exacto y update/delete cerrados. Existe
un script local de provisioning que puede crear el bucket privado y sus
políticas, pero no fue ejecutado en esta revisión.

`team-crests` admite SVG público. No debería convertirse en bucket genérico de
branding sin definir sanitización SVG y CSP; para V1 es más simple aceptar sólo
raster en el nuevo flujo.

### 5.2 Políticas obligatorias para V1

- Fotos generales y de jugadores: bucket privado.
- Logos/escudos explícitamente públicos: dominio separado, con allowlist raster
  y paths derivados en servidor.
- Sin acceso directo `anon` o `authenticated` a objetos privados.
- `service_role` sólo en Edge/worker; nunca en cliente.
- El cliente no elige bucket, organización, path ni nombre final.
- Lectura por URL firmada breve, resuelta en servidor después de revalidar
  membresía, audiencia, publicación, estado y consentimiento.
- Nunca persistir URL firmada en DB, analytics o logs; refrescar bajo demanda.
- Una URL firmada emitida sigue utilizable hasta su vencimiento: la revocación
  no es instantánea. El TTL actual de 300 segundos es razonable como punto de
  partida y debe mantenerse corto para superficies sensibles.
- Eliminar objetos mediante la API de Storage, no manipulando filas internas de
  `storage` directamente.

Referencias oficiales contrastadas:

- [Buckets públicos y privados](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- [Control de acceso y service key](https://supabase.com/docs/guides/storage/security/access-control)
- [Descargas y URLs firmadas](https://supabase.com/docs/guides/storage/serving/downloads)
- [Ownership de objetos](https://supabase.com/docs/guides/storage/security/ownership)
- [Esquema de Storage](https://supabase.com/docs/guides/storage/schema/design)

## 6. Modelo de datos de Multimedia ya existente

No hace falta introducir otra tabla genérica `media_asset`. El dominio actual es
suficiente y más preciso:

| Tabla | Responsabilidad |
| --- | --- |
| `tournament_media_galleries` | Scope, título, ciclo, visibilidad, menores y portada |
| `tournament_media_assets` | Objeto original, MIME detectado, medidas, checksum, tier, estado lógico y retención |
| `tournament_media_gallery_items` | Inclusión, orden y caption dentro de una galería |
| `tournament_media_relations` | Relaciones tipadas con partido, equipo y jugador |
| `tournament_media_variants` | `thumbnail`, `grid`, `detail`, `original` y metadata stripped |
| `tournament_media_upload_sessions` | Token hasheado, actor, path derivado, cuotas, expiración y single-use |
| `tournament_media_processing_jobs` | Cola y estado del trabajo confiable |
| `tournament_media_moderation_actions` | Auditoría de transiciones y moderación |
| `tournament_media_consents` | Snapshot vigente por sujeto y uso |
| `tournament_media_consent_events` | Historial append-only del consentimiento |
| `tournament_media_reports` | Reportes privados y pedidos de retiro |
| `tournament_media_assignments` | Fotógrafo asignado a una galería |

Todas las tablas tienen RLS y no conceden CRUD directo a los clientes. Los RPCs
revalidan sesión, tenant, rol, capability, scope y estado. Los paths siguen:

- quarantine: `organization/gallery/.../uuid.ext` dentro del scope completo
  validado por SQL;
- processed: mismo scope, UUID y sufijo de variante;
- sin `..`, segmentos vacíos ni nombres de dispositivo.

El shape exacto incluye también torneo en el path y se valida contra una regex
UUID; se omite aquí sólo para legibilidad.

## 7. Flujo actual de carga, lectura y retiro

### 7.1 Carga

1. El navegador valida selección, cantidad, MIME, peso y dimensiones.
2. Genera un nombre sintético y pide una sesión RPC.
3. El servidor deriva bucket/path, reserva cuota y emite un token de un solo uso.
4. `tournament-media-signer` entrega el upload intent.
5. XHR hace `PUT` con progreso real.
6. `tournament-media-processor` encola el trabajo robusto o finaliza el tier
   simple.
7. El asset atraviesa upload, procesamiento, review y aprobación/publicación.

El tier robusto acepta selección HEIC/HEIF sólo si el navegador puede decodificar
y transcodificar; Storage recibe JPEG/PNG/WebP. El tier simple rechaza HEIC,
redimensiona en cliente y limita el archivo final a 4 MiB. La implementación
robusta añade antivirus, normalización confiable, metadata stripping y variantes;
es la recomendada para fotos de personas.

### 7.2 Lectura

El cliente pide `{ assetId, kind }`; el firmador resuelve el path privado y
autoriza la variante. Participantes sólo reciben derivados. El original queda
reservado a revisión o al uploader asignado en el caso acotado previsto.

### 7.3 Borrado y retención

La UI no ofrece hard delete de un asset existente. “Quitar” en la cola sólo
opera sobre selección local; para material persistido hay rechazo, ocultamiento,
revocación y archivo.

La base contempla candidatos de retención y `storage_state` (`active`, marcado,
purgado), pero no hay un flujo completo de operador/worker para borrado físico
general. El cleanup actual cubre residuos de quarantine/procesamiento, no el
ciclo de eliminación solicitado por una persona.

V1 debe definir una operación idempotente y auditable:

1. autorizar `media.revoke` o una capability de delete explícita;
2. revocar lógicamente y retirar de toda lectura nueva;
3. encolar el borrado físico mediante Storage API;
4. borrar originales y variantes;
5. marcar `storage_purged`, conservando el registro mínimo de auditoría;
6. reintentar con seguridad y alertar ante fallas.

No debe presentarse “Eliminar definitivamente” hasta que esta cadena exista.

## 8. Inventario transversal de imágenes

| Entidad | Persistencia actual | UI actual | Gap |
| --- | --- | --- | --- |
| Organización | `tournament_organizations.logo_path` | No se carga ni edita; se renderiza el path crudo en algunos lugares | Falta bucket/resolver/update RPC y fallback coherente |
| Torneo | Sin logo ni colores propios | Sin controles | Falta modelo 1:1 de branding |
| Equipo de torneo | `shield_path`, `primary_color`, `secondary_color`; snapshots públicos | Colores parciales; sin uploader de escudo | Falta flujo seguro; importar equipo clásico no copia crest |
| Usuario/jugador Arma2 | `usuarios.avatar_url`, auth metadata y snapshots `jugadores.avatar_url` | Perfil clásico permite crop/upload público | No equivale a consentimiento de torneo/promoción |
| Jugador de roster | `tournament_roster_players.avatar_url` snapshot | Sin edición de foto | Se congela una URL; no hay referencia durable ni refresh |
| Jugador provisional | Sin fuente de foto propia | Sin controles | No existe ownership ni ciclo de vida de retrato |
| Foto general | `tournament_media_assets` + gallery/relations/variants | Admin y participante ya implementados | Bucket/readiness/operación aún cerrados |
| Social Studio | `photoAssetId` en estado editorial | El renderer resuelve, pero no hay selector | Falta picker y contrato transversal; no tocar en esta fase |
| Página pública | Sin selección de imagen | Branding Arma2 + escudos | Falta contrato público deliberado |

## 9. Foto de jugador: decisión de dominio

No conviene tratar todas las fotos de una persona como el mismo dato. Se
recomiendan tres referencias distintas:

1. **Avatar global:** controlado por el usuario y actualmente público. Sirve como
   identidad general, no concede por sí solo autorización promocional.
2. **Retrato de roster:** propiedad del torneo/organización, útil también para
   jugadores provisionales, con audiencia y usos definidos.
3. **Foto de galería:** asset editorial asociado a partido/equipo/jugador, con
   consentimiento por asset y scope.

El snapshot `avatar_url` del roster no debe ser la fuente de verdad futura. Debe
migrar conceptualmente hacia una referencia estable (`playerPortraitRef`) que el
resolver convierta en una entrega válida. Para un usuario Arma2 el default puede
ser su avatar; para un provisional debe existir una carga administrada y privada
por defecto.

Usos como `view_internal`, `social_future`, `promotion_future` y `commercial`
deben seguir separados. Etiquetar a un jugador no concede consentimiento. Si el
jugador es menor, el flujo debe fallar cerrado y requerir la política/autorización
correspondiente antes de publicar o reutilizar.

## 10. Branding: logo y colores del torneo

Los colores de equipo ya existentes no representan el branding del torneo.
Tampoco corresponde guardar identidad visual en `format_settings`, cuyo dominio
es la competencia.

Se recomienda una entidad 1:1 `tournament_branding` —o columnas explícitas si se
prefiere una migración menor— con:

- `tournament_id` único y tenant derivado;
- referencia de logo, no URL arbitraria;
- `primary_color` y `accent_color` validados como hex;
- timestamps y actor de modificación;
- contraste mínimo verificado en UI;
- fallback: torneo → organización → identidad Arma2/iniciales.

Su lugar de edición es Configuración del torneo, no Multimedia. Multimedia puede
ofrecer un selector de assets existentes para otras superficies, pero no debe
ser la autoridad de colores o identidad.

Para logos explícitamente públicos, conviene un bucket o dominio de entrega
separado de `tournament-media`, con JPEG/PNG/WebP, path derivado por entidad,
capability de organización y reemplazo auditable. Si se conserva SVG, se debe
añadir sanitización y CSP antes de habilitarlo.

## 11. Reutilización del sistema clásico

Es reutilizable:

- `prepareImageForUpload`: validación, orientación EXIF, resize, reencode y
  transcodificación cuando aplica;
- `AvatarCropModal`: crop cuadrado accesible;
- patrones de preview, error y reemplazo;
- fallbacks visuales de avatar/escudo.

No es reutilizable sin cambios:

- `uploadFoto`, porque sube a un bucket público y propaga una URL pública a
  varias tablas/auth metadata;
- helpers de `team-crests` que construyen paths en cliente;
- URLs públicas como identidad canónica;
- buckets clásicos para fotos privadas o material sujeto a consentimiento.

La reutilización debe ocurrir en componentes y preflight de imagen, mientras
Storage, autorización y paths pasan por servicios de Torneos.

## 12. Contrato unificado de referencias

Los componentes no deberían saber nombres de buckets ni construir URLs. La
interfaz conceptual propuesta es:

```text
ImageRef
  kind: organization_logo | tournament_logo | team_logo |
        player_portrait | media_asset
  entityId o assetId
  variant: thumbnail | grid | detail | social | original

resolveImageRefs(refs, audience, use)
  -> ResolvedImage { ref, deliveryUrl, expiresAt?, width?, height?, mime? }
```

Reglas:

- la referencia durable se persiste; la URL de entrega no;
- el resolver elige bucket, variante, visibilidad y TTL;
- `audience` y `use` son datos de autorización, no decorativos;
- la resolución es batch, acotada y revalidada;
- en exportación Social, el servicio descarga a bitmap/blob y descarta la URL;
- `photoAssetId` existente se adapta a `media_asset`, sin admitir URL libre;
- una ausencia autorizativa produce fallback, no filtración ni crash.

Social Studio ya sigue parcialmente este patrón: `resolveSocialAssets` pide un
`detail` firmado, obtiene un bitmap y el renderer nunca recibe el path de
Storage. Falta un selector de foto y resolver logos/retratos; eso se documenta
para una fase posterior y no requiere modificar Social ahora.

## 13. Gap analysis priorizado

### Bloqueantes de activación

- `tournament-media` no está provisionado por el baseline canónico.
- Worker, antivirus, cleanup y observabilidad no tienen evidencia completa de
  implementación/despliegue; el flag correctamente permanece cerrado.
- No se verificó catálogo runtime local ni Staging.
- No existe flujo completo de retiro + borrado físico.
- La visibilidad de navegación no está alineada explícitamente con el flag.

### Incompletos de producto

- El backend soporta tags, consentimientos y fotógrafos, pero la UI no los
  expone como flujo completo.
- Existe `updateMediaGallery` en el servicio, pero el centro se concentra en
  crear/transicionar; falta edición de metadata como experiencia terminada.
- No hay uploader/resolver de logo de organización.
- No hay logo ni colores propios de torneo.
- El escudo de equipo no tiene uploader seguro dentro de Torneos.
- Jugadores provisionales no tienen retrato administrable.
- El avatar de roster es snapshot de URL, no referencia durable.
- Social Studio tiene `photoAssetId` pero no selector.
- Página pública no tiene contrato para branding o fotos, deliberadamente.

### Riesgos a evitar

- publicar el bucket privado para “simplificar” la página pública;
- guardar URLs firmadas;
- confiar en `owner_id` de Storage como autorización de organización;
- aceptar path, bucket, MIME o tenant enviados por cliente;
- interpretar `NULL` de PRO como cuota infinita;
- usar el avatar público como consentimiento promocional;
- habilitar SVG sin sanitización;
- presentar delete si sólo se revoca lógicamente.

## 14. Alcance exacto recomendado para Multimedia V1

### Incluido

- Galerías de fotos de torneo ya modeladas.
- Owner/admin: crear galería, cargar, revisar, ordenar, portada, publicar,
  ocultar/revocar y archivar.
- Colaborador: lectura administrativa.
- Participante: lectura firmada de galerías publicadas según relación.
- Reporte privado y retiro operativo.
- Límites FREE actuales y entitlements verificados en servidor.
- JPEG/PNG/WebP; variantes thumbnail/grid/detail; metadata stripped.
- Referencias de imagen unificadas como contrato interno.
- Logo de organización, logo/colores de torneo, escudo y retrato de roster como
  fase estructurada inmediatamente posterior a la activación de galería.

### Fuera de V1

- carpetas arbitrarias, file manager o documentos;
- video, audio, RAW y almacenamiento de HEIC;
- edición fotográfica avanzada;
- tagging libre, búsqueda semántica o reconocimiento facial;
- importación masiva desde servicios externos;
- galerías anónimas/públicas hasta definir su contrato;
- colaboración en tiempo real;
- billing o compra de almacenamiento;
- uso comercial/promocional automático;
- cambios a Social Studio durante este frente.

## 15. Arquitectura y secuencia propuesta

### Fase 1A — cerrar contratos y readiness

1. Confirmar el catálogo en Supabase local cuando haya Docker/Podman.
2. Elegir formalmente `PROCESSOR_EXTERNAL` como tier objetivo para fotos de
   personas. `MVP_SIMPLE` sólo sería aceptable como piloto owner/admin aislado,
   con sus controles reducidos documentados.
3. Convertir el provisioning del bucket privado en una migración/operación
   repetible y verificable, sin ejecutar aún en entornos remotos.
4. Definir retiro, purga física, retención y SLA de reportes.
5. Alinear route/nav/empty state con `mediaEnabled`.
6. Cerrar el contrato `ImageRef` y la política de buckets públicos vs privados.
7. Completar matriz automatizada de tenant, rol, audiencia, consentimiento,
   revocación, MIME, cuota, expiración y path traversal.

**Criterio de salida:** readiness verificable, modelo de amenazas aprobado y
ninguna ruta de acceso directo a Storage privado.

### Fase 1B — activar Gallery MVP

1. Provisionar primero en local/entorno autorizado.
2. Completar signer, worker, AV, cleanup y señales reales.
3. Validar carga, progreso, retry, idempotencia y cuotas.
4. Validar publicación/ocultamiento/revocación y participante.
5. Implementar purga física y auditoría antes de prometer eliminación.
6. Habilitar flags sólo durante QA controlado; rollback = flags off.

**Criterio de salida:** suite funcional y adversarial verde, observabilidad y
rollback ensayados, sin datos privados expuestos.

### Fase 1C — identidad visual estructurada

1. Logo de organización con resolver correcto.
2. Branding 1:1 de torneo: logo, color primario y accent.
3. Escudo de equipo con path server-derived y copia/snapshot coherente.
4. Retrato de roster para usuario y provisional, privado por defecto.
5. Crop/preflight reutilizado del sistema clásico.

**Criterio de salida:** ninguna vista renderiza paths internos o URLs persistidas
como autoridad; todos los fallbacks son coherentes.

### Fase 1D — consumidores

1. Configuración y switchers consumen `ImageRef`.
2. Página pública consume sólo branding y assets expresamente publicables.
3. Social Studio incorpora picker de asset y referencias de logo/retrato sin
   conocer Storage.
4. Revisar consentimientos por scope de uso antes de cada exportación.

**Criterio de salida:** los consumidores comparten el contrato, no el bucket.

## 16. UX mínima por rol

### Owner/admin

- estado de readiness visible y accionable;
- create/upload con límites antes de seleccionar;
- progreso por archivo y retry sin duplicados;
- estados humanos: procesando, listo para revisar, publicado, oculto, retirado;
- publicación bloqueada con motivo preciso (procesamiento, consentimiento,
  cuota, permisos);
- confirmación fuerte para revocar/retirar;
- auditoría y reportes accesibles.

### Colaborador

- vista read-only inequívoca;
- sin botones que fallen después por permisos;
- acceso a lo que su organización autoriza, sin paths ni originales.

### Participante

- sólo galerías publicadas relacionadas;
- skeleton/fallback cuando expira una URL;
- reporte privado simple;
- no revelar identidad del reportante ni estados administrativos.

### Errores comunes

- archivo no soportado: explicar formatos;
- exceso de tamaño/cantidad/cuota: indicar límite y remediación;
- sesión expirada: reintentar desde nueva sesión, no reutilizar token;
- procesamiento fallido: conservar contexto y ofrecer retry autorizado;
- permiso/consentimiento revocado: retirar inmediatamente de nuevas respuestas;
- servicio no ready: módulo read-only o cerrado, nunca degradación insegura.

## 17. Seguridad y privacidad: checklist de aceptación

- [ ] Tenant y path siempre derivados en servidor.
- [ ] Bucket privado para fotos de personas y fotos generales.
- [ ] Sin policies de cliente sobre objetos privados.
- [ ] MIME declarado, magic bytes, decode, dimensiones y tamaño validados.
- [ ] EXIF/metadata eliminados en derivados.
- [ ] Antivirus y worker confiable con attestations verificadas.
- [ ] Upload sessions breves, single-use, actor-bound e idempotentes.
- [ ] URLs firmadas breves, no persistidas y revalidadas por audiencia.
- [ ] Consentimiento independiente de tags y avatar global.
- [ ] Menores fallan cerrado.
- [ ] Cuotas de org/torneo/galería y rate limits atómicos.
- [ ] Revocación lógica inmediata y purga física auditable.
- [ ] Logs sin tokens, URLs firmadas, paths sensibles o PII innecesaria.
- [ ] SVG deshabilitado o sanitizado con CSP.
- [ ] Pruebas cruzadas owner/admin/collaborator/delegate/player/outsider.
- [ ] Flags cerrados en Producción y rollback ensayado.

## 18. Evidencia de baseline

En este worktree se ejecutaron sin alterar archivos de producto:

- 7 suites focales de React/Jest: **100 tests verdes**;
- ESLint focal de componentes, servicio y dominio de Multimedia: **sin errores**.

No pudieron iniciar dos grupos adicionales por dependencias ausentes/incompatibles
en el checkout compartido:

- prueba de procedimientos Storage: falta el paquete `pg`;
- pruebas Node de Edge media: runtime TypeScript incompatible
  (`ts.ModuleKind` no disponible).

Son limitaciones del baseline de herramientas de esta máquina, no fallas
funcionales observadas. Deben resolverse antes de considerar completo el gate de
Fase 1A.

## 19. Archivos clave auditados

- `src/features/torneos/components/TorneosShell.jsx`
- `src/features/torneos/components/MediaAdminPage.jsx`
- `src/features/torneos/components/MediaUploadQueue.jsx`
- `src/features/torneos/components/ParticipantMediaGallery.jsx`
- `src/features/torneos/components/TournamentHubPage.jsx`
- `src/features/torneos/api/tournamentWorkspaceService.js`
- `src/features/torneos/api/tournamentMediaUploadClient.js`
- `src/features/torneos/domain/media.js`
- `src/features/torneos/domain/mediaPipeline.js`
- `src/features/torneos/domain/capabilities.js`
- `src/features/torneos/domain/entitlements.js`
- `src/features/torneos/config/featureFlags.js`
- `src/features/torneos/social/socialStudio.js`
- `src/services/playerService.js`
- `src/utils/imagePreflight.js`
- `supabase/functions/tournament-media-signer/index.ts`
- `supabase/functions/tournament-media-processor/index.ts`
- `supabase/migrations/20260727090000_arma2_canonical_baseline.sql`
- `supabase/migrations/20260802090000_tournament_media_upload_pipeline.sql`
- `supabase/migrations/20260809232508_tournament_media_free_mvp.sql`
- `supabase/migrations/20260810160355_tournament_entitlements_foundation.sql`
- `supabase/migrations/20260810215224_tournament_public_pages.sql`

## 20. Decisiones que requieren aprobación antes de implementar

1. Tier V1: recomendar `PROCESSOR_EXTERNAL`; aceptar o descartar un piloto
   `MVP_SIMPLE` estrictamente aislado.
2. Estrategia de branding público: bucket raster dedicado o endurecimiento de
   `team-crests`.
3. Modelo de branding: tabla 1:1 versus columnas en torneo.
4. Política de retrato de jugador provisional y quién puede reemplazarlo.
5. SLA de retiro/purga y retención mínima de auditoría.
6. Comportamiento de la navegación cuando `mediaEnabled` está cerrado.
7. Si la publicación pública de fotos pertenece a V1 posterior o a V2.

Hasta resolver estas decisiones, el siguiente paso seguro es revisión de este
documento; no activar flags, provisionar entornos remotos ni tocar Social Studio.

## 21. Actualización Multimedia 1A — Storage y E2E local (2026-08-17)

### Causa confirmada

- El bloqueo operativo era real: `tournament-media` no existía y la readiness
  cerraba con `storage.bucket_absent`.
- El default `PROCESSOR_EXTERNAL` estaba funcionando como fail-closed; no fue
  bypassado ni modificado para entornos remotos.
- El primer E2E real encontró además que el Edge Runtime local devolvía URLs con
  el host interno `kong`. Las capabilities de upload/lectura ahora cruzan la
  frontera como rutas relativas y el cliente las resuelve contra el origen
  Supabase local ya validado.

### Solución 1A materializada

- El procedimiento versionado y loopback-only
  `scripts/storage/provision-tournament-media-local.mjs --activate-simple`
  crea/verifica el bucket y activa `MVP_SIMPLE` sólo para QA local. Una base
  recién migrada conserva `PROCESSOR_EXTERNAL`.
- Bucket final: privado, límite 12 MiB, sólo JPEG/PNG/WebP. Las cuatro policies
  de `storage.objects` pertenecen exclusivamente a `service_role`; no existe
  policy de cliente para read/write/update/delete.
- La migración
  `20260815234340_tournament_media_storage_readiness_and_delete.sql` agrega un
  borrado service-only en dos fases. `begin` autoriza `media.revoke`, bloquea
  nuevas firmas y devuelve únicamente paths derivados desde DB; el gateway
  borra Storage; `complete` elimina metadata relacionada y conserva auditoría
  general. Fallos de Storage o de finalize dejan un estado reintentable.
- El path permanece server-derived y tenant-scoped:
  `{organizationId}/{tournamentId}/{galleryId}/{uuid}[-kind].{jpg|png|webp}`.
  Nombre local, bucket, tenant y path no se aceptan desde el navegador.
- La UI distingue `ready`, bucket ausente, permisos, configuración, servicio no
  disponible y estado desconocido sin mostrar detalles sensibles. El borrado
  definitivo aparece sólo con `media.revoke` y exige confirmación explícita.

### Evidencia local reproducible

- Se confirmó API/DB/Studio en `127.0.0.1`, se ejecutó `supabase db reset
  --local --no-seed`, se reaplicaron todas las migraciones y se regeneraron el
  bucket, modo QA, seis identidades, dataset V4 (587/587) y auth states locales.
- Readiness efectiva final: `MVP_SIMPLE`, `uploadReady=true`,
  `storageReady=true`, `private=true`, `blockers=[]`.
- El E2E real cubrió Auth → REST → Edge → Storage privado → PostgreSQL → URL
  firmada: rechazo y cleanup de bytes inválidos, upload válido, metadata,
  preview, nueva firma tras reload, colaborador read-only, outsider/direct
  access denegados, delete físico + metadata y URL previa invalidada.
- Quedó como testigo visual local un asset QA no sensible, WebP,
  `pending_review`, en la galería `QA Multimedia 1A · flujo local`; el archivo
  y su identidad permanecen sólo en el entorno LOCAL ignorado por Git.

### Fuera de 1A

- 1B conserva como objetivo remoto `PROCESSOR_EXTERNAL` con worker, antivirus,
  observabilidad y cleanup atestiguados antes de habilitar flags fuera de local.
- 1C mantiene branding, logos, colores, escudos y retratos de roster fuera de
  este cambio. Social Studio, Staging y Production no fueron modificados.
