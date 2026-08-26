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

## 22. Actualización Multimedia 1C.1 — Branding estructural real (2026-08-17)

- Se materializaron logo de organización, logo propio de torneo y escudo de
  equipo como referencias durables, no URLs: columnas `logo_path`/`shield_path`,
  bucket público separado `tournament-branding` y paths inmutables versionados
  por organización, tipo, entidad y UUID. `tournament-media` y `team-crests` no
  cambiaron; el último conserva sólo compatibilidad de lectura histórica.
- El bucket admite únicamente JPEG/PNG/WebP hasta 2 MiB. El cliente valida,
  decodifica, redimensiona y reencodea antes de subir; RLS vuelve a validar
  tenant, entidad y capability. No hay overwrite: reemplazar crea una ruta
  nueva, cambia la referencia por RPC auditable y elimina la versión previa.
- Un resolver central entrega URL pública sólo desde buckets conocidos y aplica
  fallback torneo → organización → iniciales. Se integró en Configuración,
  selector de workspace, dashboard, alta/configuración de torneo, inscripción y
  lista de equipos, hub participante, competencia y página pública. Los escudos
  congelados no son mutables desde el navegador y sus snapshots QA quedaron
  sincronizados durante la provisión local controlada.
- Evidencia local reproducible: reset completo, dataset V4 587/587, seis
  identidades QA canónicas, tres PNG reales, prueba Storage HTTP con owner y
  outsider (tenant, rol, path traversal, SVG/HTML, tamaño, overwrite, delete y
  lectura pública), tests de servicio/fallback, reload y build productivo.
- Retrato de jugador queda fuera de 1C.1. Hoy conviven `usuarios.avatar_url` y
  snapshots `tournament_roster_players.avatar_url`, mientras un jugador
  provisional no tiene referencia propia. Recomendación 1C.2: agregar una
  referencia durable independiente por jugador de roster, con consentimiento,
  reglas explícitas de reemplazo y sin reutilizar automáticamente el avatar
  global de Arma2; definir primero quién administra y en qué superficies puede
  publicarse.
- Social Studio no fue modificado. Sus snapshots continúan consumiendo escudos;
  una futura adopción del logo de torneo debe leer el nuevo contexto de branding
  sin acceder al bucket privado multimedia.

## 23. Multimedia 1C.2 — Player Photo · 1C.2A implementation status (2026-08-17)

### Estado real de las tres identidades

| Identidad | Contrato actual | Lifecycle y privacidad | Conclusión 1C.2 |
| --- | --- | --- | --- |
| Usuario Arma2 vinculado | `usuarios.avatar_url` y auth metadata; bucket público `jugadores-fotos` | El propio usuario lo cambia independientemente del torneo. La tabla `usuarios` requiere autenticación para leer, pero el objeto Storage es público si se conoce la URL. | Es avatar personal global, no consentimiento ni foto oficial del torneo. Puede ofrecerse para una **copia explícita** iniciada por el sujeto; nunca referenciarse o publicarse automáticamente. |
| Jugador de roster | `tournament_roster_players`, exactamente una de `arma2_user_id` o `provisional_player_id`, más `display_name` y `avatar_url` | Al agregar una cuenta, `search_tournament_players` lee `usuarios.avatar_url` y `add_tournament_roster_player` lo copia. `update_tournament_roster_player` no lo actualiza: es un snapshot de URL que hoy se renderiza en Plantel y Operación de Partido. | La membresía de roster es el dueño correcto del retrato deportivo, pero `avatar_url` debe quedar como compatibilidad, no como nueva fuente de verdad. |
| Provisional / sin cuenta | `tournament_provisional_players` con nombre/contacto, `claim_status` (`unclaimed`, `pending`, `claimed`, `rejected`) y `claimed_by_user_id`; el roster lo referencia | La RPC productiva crea sólo nombre. El claim está modelado pero no existe un flujo productivo; las pruebas lo simulan por SQL. Al quedar `claimed`, las lecturas relacionales usan `claimed_by_user_id`, pero la fila de roster sigue siendo provisional y no obtiene avatar. | Puede tener retrato porque el asset pertenece al roster, no a una cuenta. Mientras no exista claim/consentimiento verificable, sólo puede verse en superficies privadas autorizadas. |

El mismo usuario en Apertura, Clausura u otra organización produce distintas
filas de roster y, por diseño, distintos retratos/consentimientos. Esto permite
uniforme, sponsor, edad y contexto editorial diferentes. Compartir reduce
duplicación, pero acopla revocación y permisos entre torneos. V1 no comparte en
forma implícita: una acción futura "Copiar retrato anterior" debe crear una nueva
referencia dentro del torneo y pedir nuevamente autorización de publicación.

### Regla de producto y ownership

La regla propuesta encaja con el modelo actual:

```text
avatar global Arma2              retrato deportivo de roster
controlado por el usuario        administrado en el contexto del torneo
URL pública mutable              ImageRef durable y bucket privado
sin scope promocional            consentimiento por uso
        \                         /
         copia explícita opcional, nunca fallback silencioso
```

El owner funcional es `tournament_roster_players.id`, no `auth.users.id`, el
provisional organizacional ni una estadística. Es la única entidad real que
representa a esa persona en ese equipo/plantel y ya es la FK de convocatoria,
acta, estadísticas, disciplina, tags y consentimientos multimedia. Una remoción
del equipo revoca nuevas entregas, pero no borra datos competitivos históricos.

### Storage y referencia durable

Comparación:

| Opción | Ventaja | Problema |
| --- | --- | --- |
| A. Guardar en `tournament-media` | Bucket privado, signer, procesamiento y delete ya probados | El contrato actual está acoplado a `gallery_id`, paths de galería y cuatro variantes; ampliarlo sin separar el dominio mezcla retención y autorización. |
| B. Bucket privado `tournament-player-portraits` | Policies, lifecycle, cache y purga propios; nunca confunde retrato con galería o branding | Requiere provisionamiento y adaptar el pipeline/signer para un segundo contrato. |
| C. Reusar `tournament_media_assets` | Reutiliza moderación y consentimientos actuales | Obliga a crear una galería ficticia o a volver nullable/reformular muchas invariantes; convierte 1C.2 en una refactorización de galerías. |

Se recomienda **B**, privado. No se debe duplicar la infraestructura: extraer y
parametrizar preflight, procesamiento confiable, progreso, replace, signed read
y delete de Multimedia 1A para el contrato de retratos. `tournament-branding`
queda excluido porque es público y su dominio son logos/escudos.

La referencia de aplicación es conceptual y no contiene path ni URL:

```text
ImageRef { kind: "player_portrait", id: portraitId, variant: "display" }
```

El path se deriva en servidor, por ejemplo
`{organizationId}/{tournamentId}/{rosterPlayerId}/{portraitId}[-kind].webp`.
El browser nunca persiste signed URLs. Un resolver batch valida tenant,
membresía, estado, audiencia y uso antes de devolver una entrega efímera.

### Modelo y migración propuestos

Crear `tournament_player_portraits` en lugar de agregar una URL a roster:

```text
id, organization_id, tournament_id, team_entry_id, roster_player_id
provider, bucket, internal_path
status                  processing | pending_review | approved | rejected |
                        replaced | revoked
publication_status      private | public
source                   upload | explicit_global_avatar_copy
detected_mime, byte_size, width, height, checksum_sha256
focal_x, focal_y         0..1, default 0.5
uploaded_by, reviewed_by, created_at, updated_at
approved_at, published_at, replaced_at, revoked_at, storage_purged_at
```

No es un historial editorial: sólo una fila `approved` no reemplazada/revocada
puede ser el retrato activo de un roster player. Las filas anteriores sobreviven
como tombstone auditable hasta la purga física; no se ofrecen como selector.

Constraints/indices mínimos:

- FKs compuestas a roster player y team entry para impedir cruce de tenant,
  torneo o equipo; `ON DELETE RESTRICT` sobre identidad deportiva histórica;
- FK de actor nullable con `ON DELETE SET NULL`, para no agregar otro bloqueo a
  eliminación de cuenta;
- `UNIQUE (bucket, internal_path)` y parcial único por `roster_player_id` para
  el retrato aprobado vigente;
- índices en todas las FKs y en
  `(organization_id, tournament_id, publication_status, status)` para resolver
  lotes públicos sin N+1;
- checks para MIME raster, dimensiones, estados y focal point.

RLS debe estar habilitado. No se conceden escrituras directas: RPC/Edge
server-derived para request/upload/approve/replace/revoke/delete. Las lecturas
autenticadas proyectan metadata segura y nunca `internal_path`; `anon` no recibe
SELECT sobre tablas. La página pública futura usa una proyección SECURITY
DEFINER acotada, con `auth.uid()` sólo cuando corresponda y grants explícitos.

El consentimiento actual es reutilizable como **contrato**, no directamente
como tabla: `tournament_media_consents` exige `asset_id` de galería y
`manage_tournament_media_consent` sólo acepta owner/admin. 1C.2 necesita un
snapshot `tournament_player_portrait_consents` y eventos append-only equivalentes,
con `portrait_id`, `use_scope` (`view_internal`, `public_tournament`,
`social_future`), `status` existente (`unknown`, `allowed`, `denied`, `revoked`,
`not_required`), actor/legal basis y timestamps. No se debe generalizar las
tablas de galería dentro de la misma migración.

### Permisos, consentimiento y publicación

Contrato mínimo propuesto, sin crear capabilities en este discovery:

- **Owner/admin:** subir, reemplazar, quitar y moderar cualquier retrato del
  tenant. Subir o aprobar no concede consentimiento público.
- **Capitán/delegado activo:** subir/reemplazar para jugadores activos de su
  `team_entry_id`; sin publicar, declarar `not_required` ni administrar otro
  equipo. La relación se revalida en backend.
- **Jugador vinculado/claimado:** proponer o cambiar su propio retrato y
  permitir/denegar/revocar usos propios. La propuesta no se vuelve oficial ni
  pública sin moderación.
- **Collaborator:** lectura autorizada, sin mutación.
- **Outsider:** nunca.

Conviene proponer `roster_portraits.manage`,
`roster_portraits.review` y `roster_portraits.publish` para owner/admin, más una
autorización relacional de equipo y una operación self-service; no reutilizar
`team_entries.update`, porque el retrato debe poder retirarse aunque el plantel
ya esté locked o el torneo haya finalizado.

Estados separados:

```text
cargada/procesada          status = pending_review/approved
autorizada editorialmente  status = approved
publicable                 publication_status = public
                            + consentimiento vigente para el use_scope
                            + torneo/página/sujeto elegibles
```

Por lo tanto, **no** podemos mostrar públicamente una foto sólo porque un owner
la subió. Una cuenta vinculada debe consentir el uso. Un provisional unclaimed
no tiene actor capaz de consentir dentro de Arma2: su retrato queda privado
hasta que exista claim o un flujo legal explícitamente aprobado. `not_required`
no es un atajo y exige una base documentada.

El modelo actual no permite resolver menores: la base local no tiene fecha de
nacimiento en `usuarios`, roster ni provisional. Sólo existen rangos
`tournament_categories.min_age/max_age` y `minor_restriction=true` en galerías;
no hay responsable, parentesco ni consentimiento de tutor. Categoría juvenil
no demuestra la edad individual. Publicar retratos de posibles menores queda
como decisión legal/producto bloqueante y debe fallar cerrado.

### Entrega pública, fallback y revocación

El bucket permanece privado. Para página pública, un RPC/resolver anónimo batch
debe verificar que la página y el torneo sigan publicados, el retrato esté
approved/public, el consentimiento siga vigente y no aplique un bloqueo de
menores. Recién entonces firma una variante de display de TTL corto o la entrega
por un gateway revocable. No se persiste la firma ni se configura cache pública
larga; una revocación corta nuevas resoluciones inmediatamente.

Fallback:

```text
retrato deportivo autorizado
  → avatar global sólo si el propio usuario habilitó ese fallback explícitamente
  → monograma del display_name
```

Quitar, reemplazar o revocar despublica primero y purga Storage en forma
idempotente después; el tombstone/auditoría permanece. Dejar el equipo o
finalizar el torneo no borra automáticamente el retrato, pero sí puede retirarlo
de nuevas superficies según audiencia. La eliminación de cuenta debe revocar
consentimiento y desacoplar actores antes de borrar Auth. Hoy los FKs de Torneos
a `auth.users` son `RESTRICT` y `delete-account` no los trata: es un gap previo
que 1C.2 no debe agravar.

Una revocación no puede retirar PNGs ya exportados, screenshots ni copias de
terceros. Debe impedir nuevas páginas, previews, firmas y exportaciones y dejar
ese límite expresado en producto/política.

### Crop, snapshots, UX y Social Studio futuro

No guardar un único JPEG cuadrado. `AvatarCropModal` exporta 768×768 y sirve
para el avatar personal, pero perdería torso/vertical necesarios para 4:5,
stories y nuevas plantillas. Reutilizar `mediaImageClient` para orientación,
decode, resize, MIME, progreso y preview; conservar el original normalizado y
guardar `focal_x/focal_y`. Las variantes cuadrada, 4:5 y social se derivan sin
destruir la fuente. V1 puede iniciar con focal point centrado y un ajuste simple
en Plantel; no necesita agregar librerías.

Los snapshots competitivos de nombre, dorsal, posición y eventos permanecen
congelados. Hoy squad y match operation copian `avatar_url_snapshot`; no deben
recibir la nueva signed URL ni el nuevo path. Las vistas históricas pueden
resolver el retrato vigente/revocable por `roster_player_id` y caer a monograma.
Así los datos deportivos son inmutables y la identidad visual sigue siendo
mutable y revocable. Los `avatar_url_snapshot` actuales quedan como legado.

La edición primaria pertenece a **Plantel**, en cada fila: retrato, Cambiar,
Quitar y estado privado/publicable. Una ficha de jugador futura puede ofrecer el
mismo control; Multimedia no debe listar retratos como álbum. Plantel público,
goleadores, estadísticas y figura sólo muestran la foto si el resolver autoriza;
tener asset no equivale a poder publicarlo.

Social Studio permanece sin cambios. Su contrato futuro no debe pedir
`avatar_url`, path o signed URL. La selección de Figura/Equipo Ideal produciría:

```text
ImageRef { kind: "player_portrait", id: portraitId, variant: "social" }
resolveImageRefs(refs, audience="social_export", use="social_future")
```

El adaptador puede convivir con el `photoAssetId` actual para fotos de galería.
El renderer recibe un bitmap y focal point, como ya hace con signed media, y
descarta la URL antes del PNG.

### Plan implementable

1. **1C.2A — Modelo + Storage + permisos:** migración/tables/indices/RLS,
   bucket privado, pipeline y resolver `ImageRef`, replace/revoke/purge,
   consentimientos y matriz multirol. Sin superficie pública.
2. **1C.2B — Plantel:** upload/progress/preview, aprobación, Cambiar/Quitar,
   focal point, monograma y propuesta/copia explícita del avatar global.
3. **1C.2C — Consentimiento + página pública:** self-service del sujeto,
   resolver anónimo acotado y adopción gradual en plantel/goleadores/estadísticas.
   Bloqueada hasta decidir menores y provisionales unclaimed.
4. **1C.2D — Social Studio:** selector de `ImageRef`, variante social, focal
   point y revalidación de consentimiento al exportar.

La implementación mínima siguiente es 1C.2A y termina con lectura privada
autenticada y tests de owner/admin, capitán/delegado, jugador propio,
collaborator, outsider, segundo tenant, provisional, reemplazo, revocación y
purga. No debe habilitar página pública ni Social Studio todavía.

### 1C.2A materializado

- `tournament_player_portraits` pertenece a
  `tournament_roster_players.id` y conserva `organization_id`, torneo y equipo
  como scope relacional verificable. Soporta indistintamente roster players
  vinculados y provisionales. No copia `usuarios.avatar_url`, no altera
  `avatar_url` legado y no participa en snapshots competitivos.
- La fila separa `editorial_status` (`pending_review`, `approved`, `rejected`),
  `publication_consent` (`unknown`, `granted`, `revoked`) y
  `lifecycle_status` (`upload_pending`, `active`, `delete_pending`,
  `replaced`, `removed`, `upload_failed`). 1C.2A no expone ninguna operación
  que conceda `granted`: sólo conserva el estado para el futuro y permite
  revocar. Upload, aprobación y consentimiento continúan siendo hechos
  independientes.
- El bucket versionado `tournament-player-portraits` es privado, server-only,
  con límite de 8 MiB y allowlist JPEG/PNG/WebP. No existen policies directas
  para `anon`/`authenticated`. Cada reemplazo usa
  `organizations/{organizationId}/roster-players/{rosterPlayerId}/{portraitId}.{ext}`;
  el nombre original no interviene y no hay overwrite.
- La referencia durable es `{ kind: "player_portrait", id, variant }` y nunca
  contiene bucket, path o URL. El resolver server-side acepta en 1C.2A sólo
  `variant=original` y `audience=authenticated_roster`, devuelve firmas de 300
  segundos y no las persiste. `public_page` y `social_export` fallan cerrados.
  El contrato ya reserva `square`, `portrait` y `social` sin afirmar que esas
  variantes físicas existan todavía.
- Owner/admin administran mediante la capability real
  `roster_players.update`; capitán/delegado sólo mediante relación activa con el
  equipo concreto. Player no tiene self-service en 1C.2A, collaborator no
  administra y outsider/cross-tenant nunca. Las lecturas privadas admiten el
  scope real de roster y al propio jugador vinculado/claimado; la metadata
  interna de Storage no es seleccionable por clientes.
- Delete bloquea nuevas firmas antes de Storage, elimina el objeto y recién
  entonces finaliza el tombstone/auditoría; `delete_pending` conserva el punto
  de retry. Se auditan upload/reemplazo, revisión, revocación y remoción en
  `tournament_audit_log`, sin un log paralelo.
- Provisionales unclaimed y posibles menores permanecen privados y sin actor
  capaz de conceder publicación. El modelo actual carece de edad individual,
  tutor y base legal verificable; 1C.2A no intenta inferirlos.

### Hardening pre-checkpoint

- `test:qa:guards` reproduce exactamente `68 pass / 5 fail / 5 skip` tanto en
  `3a5e893ce0ea0b5627e9d26ebd4235e90b0a3ebb` detached y limpio como en este
  worktree. Los cinco fallos son la misma deuda histórica: falta el identity
  map V2 regular requerido por `replace-torneos-demo-v2-with-v3-direct`.
- `torneos-seed-local` dejó de ejecutar la baja irrelevante de un equipo en un
  torneo `active`. Seed y transición V3→V4 ahora limpian dataset, sentinels y
  usuarios QA en `finally`; pasan aislados y juntos sin estado residual.

### Sigue bloqueado fuera de 1C.2A

- **1C.2B:** UI de Plantel, selección de archivo, progreso, crop/focal point,
  Cambiar/Quitar y copia explícita del avatar global.
- **1C.2C:** consentimiento verificable del sujeto/tutor, reglas para menores y
  provisionales, resolución `public_page` e integración gradual en superficies
  públicas.
- **1C.2D:** resolución `social_export`, variantes sociales y cualquier cambio
  en Social Studio o `photoAssetId`.

## 24. Multimedia 1C.2B — Player Portrait UX (2026-08-18)

1C.2B no rediseña nada de 1C.2A: lo consume desde Plantel. Ownership por
`tournament_roster_players.id`, bucket privado, 8 MiB, JPEG/PNG/WebP, paths
tenant-scoped y versionados, un retrato activo por jugador, `ImageRef`, firmas
efímeras y `public_page`/`social_export` fail-closed siguen exactamente igual.

### Dónde se edita

La edición vive en la pestaña **Plantel** de la inscripción del equipo
(`TeamRegistrationPage`), dentro de la misma fila donde ya están el nombre, el
dorsal, la posición y el estado. No hay una sección nueva de navegación y
Multimedia no administra retratos: sigue siendo el centro de galerías.

`RosterPlayerPortrait` es el componente único de representación visual del
jugador: retrato privado si la firma resuelve, monograma (`Francisco González`
→ `FG`) en cualquier otro caso. El marco reserva su espacio siempre, así que
resolver, fallar o volver al fallback no mueve la fila; nunca se pinta una
imagen rota ni un placeholder técnico. `PlayerPortraitActions` agrega las tres
únicas acciones: `Subir foto` cuando no hay retrato, `Cambiar` y `Quitar`
cuando lo hay.

### Dos funciones aditivas en la base

1C.2A creó `focal_x`/`focal_y` con default `0.5` y **ninguna operación capaz de
escribirlas**, y no tenía lectura por equipo. `20260818120000` agrega sólo eso,
más la tercera fracción que le faltaba al encuadre: `crop_zoom`
(`numeric(6,4) NOT NULL DEFAULT 1.0`, `CHECK (crop_zoom BETWEEN 1 AND 4)`). La
columna es aditiva y su default describe correctamente toda fila existente, así
que no hay backfill.

- `set_tournament_player_portrait_crop(uuid, uuid, numeric, numeric, numeric)`:
  escribe el encuadre completo —punto focal y zoom— en una sola operación.
  Valida el focal en `0..1` y el zoom en `1..4`, exige
  `can_manage_tournament_player_portrait_as` sobre un retrato `active`,
  redondea a 4 decimales y audita `portrait.crop_updated`. No toca el objeto de
  Storage ni el estado editorial ni el consentimiento. La forma de cuatro
  argumentos `set_tournament_player_portrait_focal_point` —de la primera pasada
  de esta misma fase, nunca commiteada ni publicada— se elimina en la misma
  migración: dejarla habilitada permitiría guardar medio encuadre.
- `list_tournament_player_portrait_refs(uuid, uuid)`: por cada jugador activo
  del equipo devuelve `ImageRef`, encuadre y `canManage`, resuelto con el mismo
  predicado que después autoriza la escritura. Nunca devuelve bucket,
  `object_path` ni URL firmada.

Ninguna de las dos crea tablas, políticas ni buckets, y ninguna redefine las
operaciones de carga, reemplazo o baja de 1C.2A.

### Carga

`preparePlayerPortraitFile` reutiliza `mediaImageClient` (el mismo decode,
orientación EXIF, re-encode sin metadata y control de tamaño que usan
Multimedia 1A y Branding 1C.1). Se aceptan JPEG, PNG y WebP hasta 8 MiB; se
rechazan SVG, HTML y HEIC/HEIF con un mensaje explícito, porque no existe una
conversión HEIC real en el navegador y prometerla sería mentir. La
normalización del cliente se queda en 3000 px de arista y 9 MP, muy por debajo
del techo del contrato (12000 px / 36 MP): escala, no recorta.

Elegir archivo **no** sube nada. Se muestra la preview local, se ajusta el
encuadre y recién `Guardar foto` sube. `Cancelar` no deja nada en el servidor.

### Encuadre: contrato definitivo

No hay recorte destructivo y no se agregó ninguna librería. El original se
guarda entero y **nunca** se reescribe; el encuadre son tres fracciones que
viajan aparte de la imagen:

- **`focal_x`** — punto horizontal de la imagen que debe quedar centrado en el
  marco. Fracción `0..1` del ancho del original.
- **`focal_y`** — punto vertical de la imagen que debe quedar centrado en el
  marco. Fracción `0..1` del alto del original.
- **`crop_zoom`** — escala relativa **al mínimo necesario para cubrir el
  marco**, no al tamaño original. `1.0` = cubrir exacto, sin hueco. Rango
  `1..4`.

Medir el zoom contra ese mínimo —y no contra el original ni contra píxeles de
pantalla— es lo que hace que la misma terna reconstruya idéntico el encuadre en
el editor grande, en la preview 4:5, en el avatar chico y después de recargar.
Nunca se persiste un píxel ni un tamaño de viewport.

La UX no expone nada de esto. El usuario **arrastra la foto** dentro de un
marco 4:5 —`pointer events`, así que mouse y touch son el mismo camino, con
pinch de dos dedos— y mueve un único control de **Zoom**; el teclado cubre pan
y zoom para quien no puede apuntar. El diálogo previsualiza con CSS sobre la
misma imagen los dos encuadres que consume la app —4:5 y avatar—: no se genera
ninguna variante física.

`Cambiar` abre el mismo diálogo sobre el retrato vigente, así que el encuadre
se puede reajustar sin volver a subir la foto.

### Reemplazo y baja

Cada carga estrena su propio path versionado; no hay overwrite. La anterior
pasa a `replaced` sólo cuando el servidor da la nueva por activa, así que una
subida fallida conserva la foto vigente. `Quitar` pide confirmación nombrando
al jugador, elimina únicamente el retrato —el jugador sigue en el plantel—,
devuelve el monograma y deja la auditoría.

### Permisos

La UI refleja el contrato real: `canManage` viaja desde
`can_manage_tournament_player_portrait_as`, de modo que no puede aparecer un
botón que el servidor vaya a rechazar. Owner y admin administran por la
capability `roster_players.update`; capitán y delegado sólo sobre el equipo con
el que tienen relación activa; collaborator y player **leen** el retrato
(tienen `roster_players.read` o son el sujeto) pero no lo administran; outsider
y cross-tenant no obtienen ni refs ni firma. Los jugadores provisionales, sin
`user_id`, se administran igual que los vinculados.

### Qué permanece privado

Tener retrato no autoriza a publicarlo. Después de la carga el estado editorial
queda en `pending_review` y el consentimiento en `unknown`: 1C.2B no ofrece
aprobar, publicar, consentir ni copiar `usuarios.avatar_url`, y no expone
ninguna de esas operaciones al cliente. Las audiencias `public_page` y
`social_export` siguen fallando cerradas, la página pública no entrega
retratos y Social Studio no se tocó.

### Qué queda para 1C.2C y 1C.2D

- **1C.2C:** consentimiento verificable del sujeto o su tutor, reglas para
  menores y provisionales unclaimed, resolución `public_page` y adopción
  gradual en plantel público, goleadores y estadísticas.
- **1C.2D:** `social_export`, variantes físicas cuadrada/4:5/social derivadas
  del original más la terna `focal_x`/`focal_y`/`crop_zoom`, y el selector de
  `ImageRef` en Social Studio.
- **Avatar global:** la propuesta explícita "usar mi avatar de Arma2" sigue
  fuera de alcance; nada copia `usuarios.avatar_url`.

### Deuda encontrada, no introducida

`migrations:guard` y `test:db:grants` venían rojos desde los checkpoints de
Branding 1C.1 y Player Portrait 1C.2A: el primero no listaba esas dos
migraciones y el segundo no tenía sus RPCs en el allowlist. Se completó el
listado de migraciones (guard verde) y se agregaron al allowlist únicamente las
dos funciones nuevas de 1C.2B; las once firmas de 1C.1/1C.2A siguen fuera y son
la causa de las 4 fallas que persisten en `test:db:grants`.
