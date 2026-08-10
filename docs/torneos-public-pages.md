# Arma2 Torneos: páginas públicas

## Alcance

Esta entrega agrega una página web pública, anónima y de sólo lectura por torneo. La publicación es opt-in: un torneo no aparece en la web pública hasta que una persona con la capability `tournaments.update` lo publica desde Configuración. Owner y admin poseen esa capability; collaborator no puede publicar ni despublicar.

La URL canónica del MVP es:

```text
/torneos/publico/:publicSlug
```

`publicSlug` se crea en servidor al publicar por primera vez. Combina slugs legibles de organización y torneo con un sufijo aleatorio corto. No contiene UUIDs completos, es único globalmente y se conserva al despublicar y volver a publicar. Cambiar nombres o slugs internos tampoco cambia el enlace público existente.

La ruta está declarada fuera de `AppAuthWrapper`, `TorneosFeatureGate`, el shell administrativo y el producto de Jugadores. Nunca redirige a login. Un slug inválido, inexistente, despublicado o fuera del ciclo de vida permitido devuelve el mismo estado seguro “Torneo no disponible”.

## Contenido público

La página ofrece:

- portada con organización, temporada, torneo, categoría y estado;
- Inicio con próximos partidos, últimos resultados, tabla y goleadores;
- fixture publicado y vigente, agrupado por fecha/ronda;
- resultados derivados exclusivamente de actas oficiales;
- tabla canónica proveniente exclusivamente de una revisión publicada;
- goleadores y estadísticas de la misma revisión publicada;
- equipos como snapshots deportivos mínimos, sin planteles;
- disciplina limitada a nombre deportivo, equipo, tarjetas y cantidad de fechas de suspensión;
- selectores de categoría y de fase/grupo cuando corresponde.

No se recalculan posiciones, goles, tarjetas ni sanciones en el cliente. El browser representa la proyección canónica que entrega el servidor.

## Frontera de privacidad

El único contrato anónimo nuevo es:

```sql
get_public_tournament_page(text, text)
```

El RPC es una proyección explícita `jsonb`; no retorna filas genéricas. Excluye IDs de usuario y recursos internos, emails, teléfonos, domicilios de sedes, planteles, disponibilidades, convocatorias, notas, motivos disciplinarios, metadata administrativa, rutas privadas y tokens. Los IDs técnicos internos tampoco se exponen en el payload.

La tabla `tournament_public_pages` tiene RLS habilitado y no otorga acceso directo a `anon` ni `authenticated`. Los RPCs administrativos requieren sesión y vuelven a verificar capabilities en servidor:

- `get_tournament_public_page_settings(uuid, uuid)`: `tournaments.read`;
- `set_tournament_public_page_published(uuid, uuid, boolean)`: `tournaments.update`.

No se concedió `anon` a ningún RPC de participantes, administradores, planteles, actas, comunicaciones o multimedia. Todas las funciones nuevas fijan un `search_path` vacío y sus grants se enumeran explícitamente.

Cada lectura anónima vuelve a comprobar que:

- la página continúe publicada;
- organización y temporada continúen activas;
- el torneo esté en `registration`, `scheduled`, `active` o `completed`;
- la categoría esté activa;
- el fixture esté publicado y no invalidado;
- los resultados tengan una operación oficial;
- las tablas/estadísticas provengan de revisiones publicadas.

Despublicar corta el acceso en la siguiente lectura. Archivar o invalidar los recursos deportivos también cierra o vacía la proyección según corresponda, aunque la fila de publicación conserve historial.

No se agregó caché CDN ni persistencia pública en el cliente. La lectura RPC se ejecuta al abrir o cambiar de categoría y no configura un TTL público prolongado; por eso el servidor sigue siendo la autoridad de despublicación. Un browser que ya recibió datos puede conservarlos en memoria hasta cerrar o recargar la vista, como cualquier respuesta ya entregada, pero una navegación o lectura nueva falla inmediatamente.

## Fotos y almacenamiento

Fotos queda deliberadamente fuera del MVP público. `tournament-media` continúa privado y el firmador actual autoriza sólo visibilidades internas con contratos de participante/organización y consentimiento. La página pública no solicita URLs firmadas, no devuelve `storage_path` y no cambia la visibilidad del bucket.

Los escudos pueden mostrarse porque usan el bucket público existente `team-crests`. El cliente rechaza paths de escudo que intenten introducir URLs HTTP arbitrarias; únicamente resuelve paths mediante ese bucket conocido.

Para habilitar fotos en el futuro hace falta un contrato adicional: visibilidad pública explícita por galería, consentimiento compatible, proyección anónima de assets aprobados, política de revocación/cache y un firmador público acotado. No debe hacerse público el bucket privado.

## Publicar y despublicar

En Configuración del torneo, la sección focal “Página pública” muestra:

1. estado Publicada/No publicada;
2. motivo si el torneo todavía no es elegible;
3. acción Publicar para owner/admin;
4. enlace estable, Copiar y Abrir página cuando está publicada;
5. acción Despublicar para owner/admin;
6. estado de sólo lectura para collaborator.

La operación usa un advisory lock y una restricción única para evitar slugs duplicados en publicaciones concurrentes. Publicar y despublicar generan eventos de auditoría `public_page.published` y `public_page.unpublished`.

## SEO y accesibilidad

El documento actualiza `title`, description y Open Graph title/description cuando recibe la proyección. La URL es legible y estable, y la selección de categoría usa `?categoria=slug`.

Esta aplicación sigue siendo un SPA: los crawlers que no ejecuten JavaScript reciben el HTML base. Metadata por torneo en el primer byte, sitemap, canonical tags y previews sociales totalmente deterministas requieren SSR, prerender o una capa web pública dedicada. Esa limitación queda aceptada para este MVP y debe resolverse antes de una campaña SEO indexable.

La UI incluye enlace para saltar al contenido, jerarquía semántica, estados vacíos, foco visible, controles táctiles, tablas con scroll localizado y soporte de movimiento reducido. Tiene cortes explícitos de tablet y móvil. El scroll horizontal queda limitado a tabs y tablas de datos.

## Fronteras de producto y runtime

La página pública es una superficie web anónima distinta del Participant Hub, que conserva sesión, relaciones de equipo, preferencias, convocatorias, disponibilidad, comunicaciones y documentos. También es distinta del Admin de Torneos, que conserva operaciones y edición, y de Arma2 Jugadores completo, que continúa native-only.

La URL pública puede abrirse en browser móvil o desktop. Al estar registrada como ruta pública antes de la compuerta autenticada, una navegación web o un app link que llegue a esa ruta no inicializa el shell de Jugadores ni el shell administrativo. Los standalone public/special flows existentes conservan su wiring y su contrato aislado.

## Migración y rollback

Migración:

```text
supabase/migrations/20260810215224_tournament_public_pages.sql
```

Rollback seguro:

```text
supabase/rollbacks/20260810215224_tournament_public_pages.safe.sql
```

El rollback despublica todas las páginas bajo lock y revoca la ejecución de los tres RPCs. Conserva filas, slugs e historial: no elimina datos ni intenta restaurar una exposición anónima previa que no existía. La migración no se aplicó a ningún proyecto remoto en esta entrega.

## Verificación

El test de integración `scripts/db-integration/torneos-public-pages.mjs` cubre publicación opt-in, slug estable, aislamiento entre tenants, lifecycle fail-closed, fixture invalidado, borradores, actas no oficiales, tabla canónica, estadísticas, disciplina segura, ausencia de PII/IDs/planteles, grants mínimos, RLS, auditoría y despublicación inmediata.

Las pruebas React cubren carga anónima, navegación, estados seguros, categorías, metadatos, controles admin y restricción de collaborator. Los contratos estáticos verifican breakpoints, movimiento reducido, scroll y tamaño táctil.

## Fuera de alcance

- La landing `arma2.com.ar/torneos` permanece en el proyecto de marketing separado.
- Billing y providers de pago no forman parte de este MVP.
- No se hace deploy, no se aplica la migración remota y no se modifica Staging ni Production.
- La preservación de las rutas standalone existentes se valida como regresión y no cambia su comportamiento.
- Mejoras futuras posibles: SSR/prerender y sitemap, dominio corto/canonical, branding público configurable, feed por RPCs paginados si el volumen crece y multimedia mediante un contrato público seguro.
