# SOCIAL STUDIO PREMIUM — MASTER SPEC

**Estado del documento:** borrador consolidado para revisión.

**Fecha de consolidación:** 25 de agosto de 2026.

**Baseline técnico oficial:** `d4a6a45a7475dccc9b5aea0f0bcca5e5993f5603`.

**Branch:** `codex/plans-entitlements-foundation`.

**Estado del ZIP final:** `NOT EVALUATED`; todavía no fue recibido.

Este documento consolida decisiones y auditorías previas. No implica implementación ni modifica el baseline.

## Convención de estados

- **DECISIÓN CERRADA:** producto o arquitectura acordados.
- **PENDIENTE DE DISEÑO:** debe resolverse o aprobarse visualmente.
- **PENDIENTE TÉCNICO:** comportamiento definido, implementación pendiente.
- **FUERA DE ALCANCE POR AHORA:** no pertenece a la integración inicial o al MVP.
- **BLOCKER:** impide considerar Premium terminado o aceptar el ZIP.

---

# 1. Estado del proyecto

## 1.1 Estado ejecutivo

- Social Studio Base está aprobado, versionado y congelado.
- Premium todavía no está implementado como sistema completo.
- Existen implementaciones experimentales de `street` y `editorial`, únicamente para Resultados; deben reemplazarse internamente.
- Heritage y Scoreboard no existen en el baseline.
- El diseño 4:5 Premium continúa en revisión final.
- El diseño 9:16 todavía no está realizado/cerrado.
- No existe todavía una matriz Premium completa de 11 familias.
- White-label, Sponsors y Team Photo para exportación social tienen decisiones de producto cerradas, pero implementación técnica pendiente.
- No existen goldens definitivos de Premium.
- El ZIP final de Claude todavía no fue entregado.

## 1.2 Estado actual de diseño

**PENDIENTE DE DISEÑO:**

- 4:5 continúa en revisión final.
- Heritage necesita últimos ajustes en Final y Campeón.
- Street necesita un último ajuste en Final.
- Scoreboard requiere recalibración visual respecto de la referencia original.
- Editorial está prácticamente cerrado, con microajustes pendientes.
- Champion `team_photo` está pendiente de diseño.
- Sponsors están pendientes de demostración con logos gráficos reales de QA.
- 9:16 está pendiente.
- Después de las familias ancla faltará expandir los cuatro themes al resto de las 11 familias.

Nada de lo anterior debe marcarse como aprobado hasta cerrar su revisión.

## 1.3 Regla de completitud

Un theme sólo puede declararse completo cuando soporte:

- las 11 familias;
- Portrait y Story;
- todos los estados obligatorios;
- Champion `default` y `team_photo`;
- white-label;
- Sponsors donde el layout declare capacidad;
- fallbacks y goldens requeridos.

Nunca debe presentarse Base bajo el nombre de un theme Premium incompleto.

---

# 2. Baseline — Social Studio Base

## 2.1 Referencia oficial

**DECISIÓN CERRADA:**

- Commit: `d4a6a45a7475dccc9b5aea0f0bcca5e5993f5603`
- Branch: `codex/plans-entitlements-foundation`
- Mensaje: `fix(torneos): preserve approved social studio base polish`
- Parent: `4ea363101b5b0eb175e0dc53dbd16569736d5a6e`
- Integración inicial de Base: `797184aa feat(torneos): integrate approved social studio base`

## 2.2 Regla de congelamiento

> **NO modificar Base durante la integración inicial de Premium salvo cambios futuros aprobados y validados por separado.**

Esto incluye evitar refactors preventivos de `social/base/*`, cambios de geometría, typography, copy, fallbacks o extracción de primitives que puedan alterar píxeles.

La implementación de white-label debe realizarse como una tranche separada y explícitamente validada.

- En FREE, si el usuario elige Base, el export debe conservar el branding Arma2 visible exactamente como fue aprobado.
- En PREMIUM, si el usuario elige Base, el export debe respetar la policy Premium autoritativa `white_label`.
- Aplicar `white_label` a Base puede requerir una modificación técnica controlada de su chrome/branding, sin alterar el diseño, la geometría ni la composición aprobada.

“Base congelado” no debe interpretarse como una prohibición absoluta de aplicar la policy autoritativa de branding. El congelamiento protege el diseño visual aprobado y prohíbe refactors o rediseños durante la integración inicial; no invalida la obligación Premium de white-label.

## 2.3 Contenido aprobado de Base

Base incluye:

- branding Arma2 visible;
- lockup oficial;
- footer promocional con `arma2.com.ar/torneos`;
- renderer Canvas determinístico;
- export PNG;
- preview y export basados en el mismo canvas;
- Portrait 1080×1350;
- Story 1080×1920;
- las 11 familias;
- fallback de escudos a monograma;
- manejo de densidad, nombres largos y estados vacíos;
- identidad oscura Arma2 con violeta/azul;
- Bebas Neue, Oswald e Inter como familias tipográficas actuales.

Familias:

1. `next_fixture`
2. `round_results`
3. `standings`
4. `scorers`
5. `discipline`
6. `best_eleven`
7. `mvp`
8. `round_summary`
9. `semifinals`
10. `final`
11. `champion`

## 2.4 Polish final contenido en `d4a6a45a`

El commit preserva los siguientes ajustes aprobados:

- elimina AS/asistencias de Figura, Goleadores y Equipo Ideal;
- cambia el hero decisivo de `GRAN FINAL` a `FINAL`;
- usa Oswald condensada en títulos dominantes, Final, Tabla y Campeón;
- ajusta tracking y jerarquía de títulos;
- compacta y desplaza hacia arriba el cuerpo de Tabla;
- recupera en Goleadores el espacio antes ocupado por asistencias para nombres largos;
- extiende la revisión de Tabla densa a ambos formatos;
- espera la carga de fonts en la galería QA;
- corrige fixtures visuales de QA para evitar un falso `AS`;
- conserva la exportación PNG y el renderer Base aprobado.

## 2.5 Validación registrada

La validación realizada al preservar el baseline fue:

- 6 suites focales de Social Studio;
- 97 tests aprobados;
- ESLint focal sin errores;
- `git diff --check` limpio;
- build no ejecutado para evitar artefactos innecesarios.

Suites focales:

- `torneosSocialStudio.test.js`
- `torneosSocialStudioBase.test.js`
- `torneosSocialStudioPhase1.test.js`
- `torneosSocialStudioPhase2A.test.js`
- `torneosSocialStudioPhase2B.test.js`
- `torneosSocialStudioPremiumStyles.test.jsx`

La certificación histórica de integración también registró 22/22 renders Canvas —11 familias por dos formatos—, dimensiones exactas, equivalencia preview/PNG, nombres largos, escudos ausentes, tablas extensas, caracteres especiales, safe areas y fallback de descarga.

## 2.6 Ampliación futura de Base

**FUERA DE LA INTEGRACIÓN INICIAL:**

- agregar a Base una variante explícita Champion `team_photo`;
- conservar `default` como comportamiento histórico;
- usar el mismo Team Photo autorizado;
- volver siempre a escudo/monograma si la foto no está disponible.

Esta ampliación no debe mezclarse con el port inicial de Premium.

---

# 3. Product decisions

## 3.1 Modelo Free/Premium

**DECISIÓN CERRADA:**

### Free

- `base`

### Premium

- `base`
- `heritage`
- `street`
- `scoreboard`
- `editorial`

Premium se adquiere:

- por torneo/edición;
- mediante pago único;
- de forma permanente para esa edición.

La autoridad recomendada para desbloquear los themes Premium es:

`social_studio.premium`

No dispersar lógica mediante `plan === 'PREMIUM'`. La disponibilidad debe derivarse del entitlement efectivo, confiable y correspondiente al torneo exacto.

Los entitlements históricos `social_studio.basic` y `social_studio.full` no deben convertirse en autoridades alternativas para elegir themes Premium.

## 3.2 IDs definitivos

**DECISIÓN CERRADA:**

- `base`
- `heritage`
- `street`
- `scoreboard`
- `editorial`

Compatibilidad legacy única:

```text
classic → base
```

No crear:

- `street-v2`
- `editorial-v2`
- `heritage-sport` como ID interno.

Street y Editorial conservan sus IDs, pero su implementación experimental debe ser reemplazada internamente.

Cualquier otro ID desconocido debe fallar con error explícito. No puede resolverse silenciosamente a Base.

## 3.3 Familias

Social Studio completo tiene 11 familias:

```text
next_fixture
round_results
standings
scorers
discipline
best_eleven
mvp
round_summary
semifinals
final
champion
```

Premium puede desarrollarse primero sobre familias ancla, pero ningún theme puede declararse completo hasta cubrir las once.

## 3.4 Formatos

**DECISIÓN CERRADA:**

### Portrait

- ID: `portrait`
- Canvas: 1080×1350
- Relación: 4:5

### Story

- ID: `story`
- Canvas: 1080×1920
- Relación: 9:16

9:16 no es una escala, crop, stretch ni wrapper del 4:5. Son layouts hermanos.

Pueden compartir:

- datos;
- fonts;
- colors;
- primitives;
- assets;
- visual model;
- copy fija;
- reglas de branding.

Pueden divergir en:

- grid;
- composición;
- crop;
- densidad;
- safe areas;
- sponsors;
- jerarquía;
- tamaños tipográficos;
- ubicación de slots.

## 3.5 Variantes y estados derivados

**DECISIÓN CERRADA:**

Variantes persistibles:

- `default`
- `team_photo`, únicamente en `champion`

Estados derivados automáticamente:

- Resultados 4 u 8;
- densidad normal/dense;
- nombres largos;
- Tabla 8/18;
- Figura con/sin foto;
- con/sin escudo;
- Sponsors 0/1/3;
- fallbacks;
- layouts densos;
- hora o sede faltante.

No persistir:

- `dense`
- `long_names`
- `with_photo`
- `without_photo`
- `without_crest`
- `compact`
- `overflow`

Estos nombres pueden existir sólo como estado interno de render o identificación de QA.

## 3.6 Reglas de contenido

### Figura

No mostrar ni entregar al visual model:

- `AS`
- asistencias

### Final

Copy fijo:

```text
FINAL
```

Nunca:

```text
GRAN FINAL
```

El título no debe recibir overrides editoriales. No inventar fecha, sede, competición ni metadata para llenar espacios.

### Textos largos

Orden obligatorio de resolución:

1. redistribuir;
2. usar más líneas;
3. reducir gaps;
4. reducir información secundaria;
5. reducir font dentro de límites declarados;
6. truncar con elipsis visible sólo como último recurso.

Nunca:

- slicing silencioso;
- `line-clamp` que pierda palabras;
- ocultar palabras sin señal;
- comprimir hasta ilegibilidad.

Resultados 8 debe mostrar los 8 partidos. Tabla 18 debe mostrar los 18 equipos.

## 3.7 Fuera de alcance por ahora

- modificar Base durante el port inicial de Premium;
- Champion `team_photo` en Base dentro de la integración inicial;
- publicación automática en redes;
- campañas de Sponsors;
- analytics, clicks o tracking;
- contratos comerciales y facturación;
- scheduling complejo de Sponsors;
- proyección de Sponsors en páginas públicas;
- background removal;
- recoloreo automático;
- edición automática de marcas;
- IA generativa necesaria para reproducir themes;
- texturas runtime aleatorias;
- fixtures separados por theme;
- actualización automática de goldens en CI.

---

# 4. Theme system

## 4.1 Dirección visual

### Heritage

- crema/papel;
- negro;
- bordó;
- suplemento deportivo clásico;
- gráfica impresa;
- elegante y deportivo.

### Street

- negro;
- rojo;
- crudo;
- punk, fanzine y graffiti;
- composición fuerte;
- primitives determinísticas.

No puede depender de:

- random;
- timestamp;
- texturas IA regenerables;
- Photoshop;
- efectos irreproducibles;
- ruido procedural no determinístico.

### Scoreboard

- verde oscuro profundo;
- crema/blanco;
- score y números protagonistas;
- claridad extrema;
- afiche deportivo;
- no debe parecer web UI.

### Editorial

- publicación deportiva;
- serif editorial;
- whitespace;
- filetes;
- composición sofisticada;
- elegante y refinada.

Los cuatro deben ser inmediatamente diferenciables.

## 4.2 Registry definitivo

El registry debe declarar, como mínimo:

```js
{
  id,
  name,
  tier,
  supportedBrandingModes,
  fonts,
  fixedAssets,
  tokens,
  capabilities,
  families: {
    [familyId]: {
      layouts: {
        portrait,
        story
      },
      variants
    }
  }
}
```

Capacidades opcionales relevantes:

- `playerPhoto`
- `teamPhoto`
- `sponsors`
- `accentOverride`

La evaluación de plan/entitlement ocurre fuera del renderer. El renderer recibe un theme ya autorizado.

Errores explícitos:

| Condición | Error |
|---|---|
| ID desconocido | `THEME_UNKNOWN` |
| Familia ausente | `THEME_FAMILY_UNAVAILABLE` |
| Formato ausente | `THEME_FORMAT_UNAVAILABLE` |
| Variante inválida | `THEME_VARIANT_UNAVAILABLE` |
| Entitlement ausente | `THEME_ENTITLEMENT_REQUIRED` |
| Renderer inválido | `THEME_RENDERER_INVALID` |

La galería puede mostrar “Próximamente” o “No disponible para esta pieza”, pero nunca previsualizar Base bajo el nombre de Heritage, Street, Scoreboard o Editorial.

## 4.3 Reemplazo de Street/Editorial

- Mantener los IDs `street` y `editorial`.
- Introducir el registry estricto antes de conectar los renderers definitivos.
- Registrar una familia/formato sólo cuando su renderer exista.
- Reemplazar los layouts experimentales en una única transición.
- Eliminar imports y archivos experimentales cuando queden sin consumidores.
- No mantener dos manifests de producto con el mismo ID.
- Cualquier comparación temporal debe vivir sólo en QA, fuera del registry persistible.

---

# 5. Data contracts

## 5.1 Principio neutral

**DECISIÓN CERRADA:**

```text
Snapshot oficial
    → adapter por familia
    → visual model neutral
    → theme registry
    → renderer
```

El snapshot conserva trazabilidad y datos oficiales. El adapter elimina detalles de backend y entrega exclusivamente semántica visual.

El renderer no debe recibir:

- URLs firmadas;
- bucket names;
- object paths;
- tokens;
- entitlements crudos;
- moderation state;
- consent records;
- backend internals;
- service-role details.

Sí recibe:

- datos visuales;
- referencias sanitizadas;
- bitmaps resueltos;
- branding policy;
- assets fijos versionados.

## 5.2 Entidades compartidas

```js
TeamRef = {
  participantId: string | null,
  teamEntryId: string | null,
  name: string,
  shortName: string | null,
  crestRef: ImageRef | null,
}

Schedule = {
  date: 'YYYY-MM-DD',
  time: 'HH:mm' | null,
  timezone: string,
  venue: { name: string } | null,
}
```

Las referencias de imágenes son neutrales. Nunca contienen URL persistida.

## 5.3 Resultados

```js
{
  family: 'round_results',
  competition: {
    name: string,
    round: {
      id: string | null,
      name: string,
      number: number | null
    }
  },
  matches: [{
    id: string,
    home: TeamRef,
    away: TeamRef,
    score: {
      home: number,
      away: number,
      homePenalties: number | null,
      awayPenalties: number | null
    },
    status: 'official'
  }],
  sponsors: []
}
```

Los penales sólo se muestran si provienen del marcador oficial.

## 5.4 Próxima fecha

```js
{
  family: 'next_fixture',
  competition: {
    name,
    round
  },
  matches: [{
    id: string,
    home: TeamRef,
    away: TeamRef,
    schedule: Schedule,
    status: 'scheduled' | 'postponed'
  }],
  sponsors: []
}
```

**PENDIENTE TÉCNICO:** el backend actual no representa bien todos los estados faltantes:

- exige `scheduled_at`;
- usa un `JOIN` obligatorio con venue;
- no representa limpiamente “fecha confirmada, hora pendiente”.

El renderer puede probar esos estados con `canonical-v1`, pero producción necesita una proyección canónica que los exprese sin inventarlos.

## 5.5 Tabla

```js
{
  family: 'standings',
  rows: [{
    position: number,
    team: TeamRef,
    played: number,
    won: number,
    drawn: number,
    lost: number,
    goalsFor: number,
    goalsAgainst: number,
    goalDifference: number,
    points: number
  }],
  sponsors: []
}
```

Tabla 18 debe conservar los 18 equipos. No puede simular completitud mediante un fallback a Base ni slicing silencioso.

## 5.6 Figura

```js
{
  family: 'mvp',
  player: {
    rosterPlayerId: string,
    name: string,
    team: TeamRef,
    position: 'ARQ' | 'DEF' | 'MED' | 'DEL' | null,
    goals: number,
    matchesPlayed: number,
    photoRef: ImageRef | null
  },
  sponsors: []
}
```

Asistencias se descartan deliberadamente en el adapter.

## 5.7 Final

```js
{
  family: 'final',
  competition: {
    name: string
  },
  home: TeamRef,
  away: TeamRef,
  schedule: {
    date: 'YYYY-MM-DD',
    time: 'HH:mm',
    timezone: string,
    venue: { name: string }
  },
  sponsors: []
}
```

Reglas:

- copy fijo `FINAL`;
- no override editorial;
- no metadata inventada;
- si falta un dato obligatorio, debe existir un estado explícito de contrato incompleto, no un valor ficticio.

## 5.8 Campeón

```js
{
  family: 'champion',
  team: {
    participantId: string,
    teamEntryId: string,
    name: string,
    shortName: string | null,
    crestRef: ImageRef | null
  },
  media: {
    teamPhotoRef: ImageRef | null
  },
  sponsors: []
}
```

Variantes:

- `default`: escudo o monograma;
- `team_photo`: Team Photo autorizada;
- `team_photo` sin asset válido: volver a `default`.

**PENDIENTE TÉCNICO:** `officialChampion` pierde hoy `teamEntryId`; debe conservarse la relación canónica antes de habilitar Team Photo.

---

# 6. White-label Premium

## 6.1 Política de producto

**DECISIÓN CERRADA:**

### Free

```text
arma2_visible
```

### Premium

```text
white_label
```

Premium no muestra:

- Arma2;
- Arma2 Torneos;
- Powered by Arma2;
- `arma2.com.ar`;
- CTA Arma2;
- footer promocional;
- branding Arma2 en SVG, assets, nombres o metadata.

La política es por entitlement efectivo del torneo, no por condicionales dentro de cada renderer. Por lo tanto, también debe respetarse cuando un torneo Premium seleccione el theme `base`.

## 6.2 Estado actual

**PENDIENTE TÉCNICO / BLOCKER:**

El baseline actual modela:

- Free: `arma2_visible`
- Premium: `powered_by_arma2`

Y resuelve `arma2Visible: true` para ambos.

Además, la marca está distribuida en:

- catálogo/resolver de planes;
- normalización frontend;
- lockup Base;
- CTA/footer;
- asset plan;
- contratos editoriales legacy;
- layouts experimentales Street/Editorial.

Cambiar únicamente el catálogo no alcanza.

## 6.3 Implementación futura requerida

- Migration nueva; no editar migrations congeladas.
- Resolver autoritativo con enum estricto.
- Compatibilidad derivada desde `mode`, sin dos autoridades divergentes.
- Scope exacto organización/torneo.
- Estado inválido o cruzado: fail-closed.
- `brandingPolicy` dentro del render context.
- Policy incorporada al render key.
- Asset plan white-label sin lockup, URL ni asset Arma2.
- Chrome/footer centralizado.
- Deprecar el toggle `social.brand_toggle`.
- Free nunca puede ocultar Arma2.
- Premium nunca debe depender de que el usuario active manualmente white-label.

Esta tranche debe validarse por separado para no alterar inadvertidamente el Base Free aprobado.

---

# 7. Team Photo / Campeón

## 7.1 Producto

**DECISIÓN CERRADA:**

Champion tiene:

1. `default` con escudo;
2. fallback sin escudo mediante monograma;
3. variante explícita `team_photo`.

La fuente es el Team Photo existente. No crear galería paralela.

## 7.2 Dominio existente

Team Photo:

- pertenece a organización;
- pertenece al torneo/edición;
- pertenece a `team_entry`;
- usa bucket privado;
- tiene moderación;
- soporta pending/approved/rejected;
- mantiene una foto vigente aprobada;
- expone actualmente sólo la audiencia `authenticated_team`;
- utiliza una referencia durable, no una URL firmada persistida.

## 7.3 Gap técnico

**PENDIENTE TÉCNICO / BLOCKER:**

Se requiere:

- audiencia `social_export`;
- relación `participantId ↔ teamEntryId`;
- `ImageRef` neutral;
- autorización específica para exportación social;
- signer autoritativo;
- resolución previa al render;
- fallback fail-soft;
- inclusión de variante/asset en render key.

No reutilizar `editorial.photoAssetId`: pertenece a galerías/fotos editoriales y su fallo actualmente puede abortar el render. Team Photo necesita un slot separado y opcional.

## 7.4 Consentimiento

**DECISIÓN DE PRODUCTO CERRADA; IMPLEMENTACIÓN PENDIENTE:**

- autorización institucional explícita por foto;
- gestionada por owner/admin;
- revocable;
- sin backfill automático;
- approval editorial no equivale a autorización social;
- revocación bloquea nuevas firmas y nuevos exports;
- no puede retirar PNG ya descargados o publicados.

`approved` por sí solo no alcanza.

La implementación futura debe conservar actor, estado, timestamps y trazabilidad de la autorización social.

## 7.5 Fallback obligatorio

Si Team Photo:

- no existe;
- está pending/rejected;
- no está autorizada;
- fue revocada;
- pertenece a otro scope;
- falla la firma;
- vence la URL;
- falla Storage;
- no carga;
- no decodifica;

entonces:

```text
Champion team_photo → Champion default → escudo o monograma
```

Nunca debe romper preview ni export PNG.

---

# 8. Sponsors

## 8.1 Producto y scope

**DECISIÓN CERRADA:**

Sponsors es una entidad independiente de:

- Branding;
- Multimedia;
- Team Photo.

Pertenece a:

- organización;
- torneo/edición exactos.

Política inicial:

- hasta 20 sponsors por edición;
- límite configurable;
- 3 no es límite de dominio;
- cada layout declara capacidad visual 0, 1 o 3;
- orden estable;
- primeros N por orden;
- fail-soft;
- entitlement efectivo `sponsors`.

### Free

- no administra Sponsors;
- no proyecta Sponsors.

### Premium

- puede administrarlos si `sponsors` es efectivo.

Si pierde el entitlement:

- conservar filas y assets;
- bloquear mutaciones;
- no proyectar Sponsors en nuevos previews/exports;
- no intentar revocar PNG ya descargados.

## 8.2 Permisos

**DECISIÓN CERRADA:**

| Actor | Gestión |
|---|---:|
| Owner | Sí |
| Admin | Sí |
| Collaborator | No |
| Capitán/delegado | No |
| Participante/jugador | No |
| Externo | No |

Capabilities futuras:

- `sponsors.read`
- `sponsors.manage`

Scope obligatorio:

- organización;
- torneo/edición.

RLS y RPC deben ser autoritativos. No alcanza con ocultar botones.

## 8.3 Logos

**DECISIÓN CERRADA:**

- bucket privado propio;
- objetos inmutables/versionados;
- formatos PNG, JPEG y WebP;
- preservar aspect ratio;
- preservar alpha;
- preservar multicolor;
- dibujar con `contain`.

ImageRef conceptual:

```js
{
  kind: 'sponsor_logo',
  id,
  variant: 'display'
}
```

Nunca enviar al renderer:

- bucket;
- path;
- token;
- URL persistida.

No aplicar:

- crop obligatorio;
- deformación;
- recoloreo;
- background removal;
- IA.

## 8.4 UX de transparencia

Copy:

> PNG con fondo transparente recomendado.

Warning no bloqueante:

> Este logo no tiene fondo transparente. Puede verse con un recuadro sobre algunos diseños.

Preview futura:

- fondo claro;
- fondo oscuro.

Advertir, sin editar automáticamente:

- márgenes transparentes grandes;
- logo pequeño dentro de canvas enorme;
- posible fondo blanco incorporado;
- falta de transparencia efectiva.

La validación de browser es UX. El procesador confiable debe repetir desde bytes MIME real, dimensiones, alpha, transparencia efectiva, bounding box y checksum.

## 8.5 Proyección a Social Studio

Visual model:

```js
sponsors: [{
  id,
  name,
  order,
  logoRef
}]
```

Sólo proyectar sponsors:

- active;
- visibles;
- con scope `social_studio`;
- del torneo exacto;
- con entitlement efectivo.

Orden:

1. `sort_order`
2. `id` como tie-break

Selección:

- capacidad 0: no crear zona;
- capacidad 1: primer sponsor;
- capacidad 3: primeros tres;
- si falla uno, omitir sólo ese y recomponer;
- no promover al cuarto;
- si fallan todos, usar estado 0;
- nunca usar un logo falso o una marca sustituta.

Preview y export deben reutilizar el mismo manifest resuelto y el mismo canvas preparado.

---

# 9. Assets y fonts

## 9.1 Estado actual

| Font | Estado |
|---|---|
| Bebas Neue | Local, WOFF2, normal 400 |
| Oswald | Local, WOFF2 variable, normal 200–700 |
| Inter | Remota mediante Google Fonts 400/500/600/700 |

Riesgos:

- Inter depende de red.
- Bebas se solicita en algunos caminos con weight 700, pero sólo existe face 400; puede haber síntesis.
- No hay licencias versionadas de las fonts actuales.
- Fonts de sistema introducen métricas diferentes entre plataformas.

Hashes auditados:

- `bebas-neue-latin.woff2`: `a7c90c89240c134f7fdd33d40c000ec90b79d675ea53e8cc5a6d423c073de412`
- `bebas-neue-latin-ext.woff2`: `16c95ce45a2922f52551d38d565d14c92cf257b8f219c89613407d81fdd21a39`
- `oswald-latin.woff2`: `571f3457dab507b6f2ce5394d593ca015251b69fea81ab7a546bd2368e9fc3ed`
- `oswald-latin-ext.woff2`: `99016932b273efa7d55b3a0ae9fe4babc6dbdcd7539f58a742697054f89b1142`

## 9.2 Requisito Premium

Antes de Premium definitivo:

- todas las fonts locales;
- WOFF2;
- weights/styles reales;
- sin bold/italic sintético;
- licencias completas versionadas;
- hashes SHA-256;
- versión/origen;
- roles declarados;
- preload descriptors;
- sin Google Fonts;
- sin dependencia de fonts del sistema para aceptar una exportación.

Claude sólo puede usar fonts open source redistribuibles.

## 9.3 Clasificación de assets

### Fixed theme asset

Naming:

```text
fixed.<theme>.<role>.<name>
```

Ubicación:

```text
themes/<theme>/assets/fixed/
```

Debe declarar:

- theme;
- función;
- formato/MIME;
- dimensiones o viewBox;
- alpha;
- repeat/tile;
- recoloreable;
- SHA-256;
- licencia/procedencia;
- estrategia `primitive` o `retain`.

### QA fixture

Naming:

```text
fixture.canonical-v1.<kind>.<name>
```

Ubicación:

```text
fixtures/canonical-v1/assets/<kind>/
```

Nunca debe registrarse como fixed asset.

### User/content slot

IDs:

- `slot.tournament-logo`
- `slot.team-crest`
- `slot.player-photo`
- `slot.team-photo`
- `slot.sponsor-logo`

Los slots no poseen un archivo permanente dentro del theme.

## 9.4 Street implementability

Street sólo puede utilizar:

- primitives;
- SVG fijo;
- geometry;
- pattern fijo;
- typography;
- pequeños assets fijos.

Cada elemento debe clasificarse en `street-components.json`.

No puede utilizar:

- random;
- timestamp;
- ruido runtime no determinístico;
- IA;
- Photoshop imprescindible;
- textura que deba regenerarse.

---

# 10. Fixtures y QA

## 10.1 Fixture oficial

**DECISIÓN CERRADA:**

ID:

```text
canonical-v1
```

Debe ser el único fixture compartido por:

- galería;
- Compare Themes;
- tests;
- screenshots;
- goldens;
- pixel diff;
- browser QA.

No mantener fixtures distintos por theme.

## 10.2 Equipos

1. CENTRO
2. ATLÉTICO NORTE
3. BIBLIOTECA POPULAR CENTRAL
4. DEFENSORES DE VILLA CONSTITUCIÓN DEL NORTE
5. DEPORTIVO HORIZONTE
6. SOCIAL Y DEPORTIVO CONSTITUCIÓN
7. UNIÓN METROPOLITANA
8. FERRO CARRIL DEL SUR
9. CLUB ATLÉTICO PARQUE CENTRAL
10. JUVENTUD DE BARRIO OESTE
11. ASOCIACIÓN DEPORTIVA RÍO DE LA PLATA
12. ESTRELLA DEL NORTE
13. INDEPENDIENTE DE SAN MARTÍN
14. SPORTIVO LOS ANDES
15. ATLÉTICO BIBLIOTECA POPULAR
16. DEFENSORES DEL PUERTO
17. SOCIAL CULTURAL Y DEPORTIVO AMÉRICA
18. CENTRO RECREATIVO GENERAL BELGRANO

Cada equipo debe tener:

- ID fijo;
- `participantId`;
- `teamEntryId`;
- short name;
- SVG determinista;
- diversidad de proporciones de escudo.

## 10.3 Resultados

`results.8`:

| Local | Visitante | Score |
|---|---|---:|
| CENTRO | ATLÉTICO NORTE | 3–1 |
| BIBLIOTECA POPULAR CENTRAL | DEFENSORES DE VILLA CONSTITUCIÓN DEL NORTE | 0–2 |
| DEPORTIVO HORIZONTE | SOCIAL Y DEPORTIVO CONSTITUCIÓN | 4–4 |
| UNIÓN METROPOLITANA | FERRO CARRIL DEL SUR | 1–0 |
| CLUB ATLÉTICO PARQUE CENTRAL | JUVENTUD DE BARRIO OESTE | 7–2 |
| ASOCIACIÓN DEPORTIVA RÍO DE LA PLATA | ESTRELLA DEL NORTE | 2–1 |
| INDEPENDIENTE DE SAN MARTÍN | SPORTIVO LOS ANDES | 12–0 |
| ATLÉTICO BIBLIOTECA POPULAR | DEFENSORES DEL PUERTO | 3–5 |

Escenarios:

- `results.4`: primeros cuatro;
- `results.8`: los ocho;
- `results.long-names`: foco en partidos 2 y 6;
- ronda `FECHA 9`;
- status `official`.

## 10.4 Próxima fecha

- Fecha: `2026-09-05`
- Timezone: `America/Argentina/Buenos_Aires`

Escenarios:

- `next-fixture.complete`: 18:30, Estadio Parque Metropolitano;
- `next-fixture.missing-time`: hora null, sede presente;
- `next-fixture.missing-venue`: 20:30, sede null;
- `next-fixture.missing-time-and-venue`: ambos null.

## 10.5 Tabla

| Pos. | PJ | PG | PE | PP | GF | GC | DG | PTS |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 17 | 13 | 2 | 2 | 38 | 12 | +26 | 41 |
| 2 | 17 | 11 | 4 | 2 | 34 | 15 | +19 | 37 |
| 3 | 17 | 10 | 3 | 4 | 31 | 18 | +13 | 33 |
| 4 | 17 | 9 | 5 | 3 | 29 | 17 | +12 | 32 |
| 5 | 17 | 9 | 3 | 5 | 28 | 20 | +8 | 30 |
| 6 | 17 | 8 | 5 | 4 | 27 | 22 | +5 | 29 |
| 7 | 17 | 8 | 3 | 6 | 25 | 21 | +4 | 27 |
| 8 | 17 | 7 | 5 | 5 | 24 | 23 | +1 | 26 |
| 9 | 17 | 7 | 3 | 7 | 22 | 22 | 0 | 24 |
| 10 | 17 | 6 | 5 | 6 | 21 | 23 | −2 | 23 |
| 11 | 17 | 6 | 3 | 8 | 20 | 24 | −4 | 21 |
| 12 | 17 | 5 | 5 | 7 | 19 | 25 | −6 | 20 |
| 13 | 17 | 5 | 3 | 9 | 18 | 27 | −9 | 18 |
| 14 | 17 | 4 | 5 | 8 | 17 | 28 | −11 | 17 |
| 15 | 17 | 4 | 3 | 10 | 16 | 30 | −14 | 15 |
| 16 | 17 | 3 | 5 | 9 | 15 | 31 | −16 | 14 |
| 17 | 17 | 2 | 5 | 10 | 14 | 33 | −19 | 11 |
| 18 | 17 | 1 | 3 | 13 | 10 | 39 | −29 | 6 |

Escenarios:

- `standings.8`;
- `standings.18`;
- `standings.long-names`, con foco en posiciones 4, 11, 17 y 18.

## 10.6 Figura

`figure.with-photo-short`:

- LUZ SOSA
- CENTRO
- DEL
- 8 goles
- 9 partidos
- foto QA autorizada

`figure.without-photo-long`:

- MAXIMILIANO ALEJANDRO FERNÁNDEZ DE LA FUENTE
- DEFENSORES DE VILLA CONSTITUCIÓN DEL NORTE
- MED
- 11 goles
- 17 partidos
- foto null

Sin asistencias.

## 10.7 Final

`final.default`:

- BIBLIOTECA POPULAR CENTRAL
- DEFENSORES DE VILLA CONSTITUCIÓN DEL NORTE
- `2026-09-20`
- 20:30
- Estadio Parque Metropolitano
- Copa Horizonte 2026
- copy `FINAL`

## 10.8 Campeón

Equipo:

- DEFENSORES DE VILLA CONSTITUCIÓN DEL NORTE

Escenarios:

- `champion.default`;
- `champion.missing-crest`;
- `champion.team-photo`.

Todos con `participantId` y `teamEntryId`.

## 10.9 Sponsors

- NEXO ENERGÍA — horizontal;
- CUADRO UNO — cuadrado;
- VÉRTICE — vertical/compacto.

Escenarios:

- `sponsors.0`;
- `sponsors.1-horizontal`;
- `sponsors.3-mixed`.

## 10.10 Goldens

Estrategia:

- Playwright/Chromium canónico;
- Canvas nativo;
- no screenshot CSS escalado;
- `deviceScaleFactor: 1`;
- fonts locales;
- sin red;
- locale `es-AR`;
- timezone `America/Argentina/Buenos_Aires`;
- goldens versionados;
- contenedor CI fijado;
- actualización manual y revisada.

Estructura post-integración recomendada:

```text
tests/visual/social-studio/
  fixtures/
    canonical-v1/
  goldens/
    v1/
      <themeId>/
        <familyId>/
          <formatId>/
            <renderState>--<fixtureId>.png
```

No actualizar goldens automáticamente en CI.

---

# 11. Contrato del ZIP final de Claude

## 11.1 Contenido obligatorio

El ZIP debe incluir:

- `manifest.json`;
- `README.md`;
- `checksums.sha256`;
- fonts WOFF2;
- licencias;
- themes;
- layouts;
- tokens;
- fixed assets;
- `canonical-v1`;
- QA fixtures;
- screenshots/goldens;
- photo slots;
- sponsor slots;
- mapping de datos;
- Portrait;
- Story;
- Champion `default`;
- Champion `team_photo`.

Debe funcionar completamente offline y no contener URLs runtime.

## 11.2 Matriz mínima

- 4 themes Premium;
- 11 familias;
- 2 formatos;
- `default` para toda la matriz;
- `team_photo` para Champion.

Conteo mínimo:

- 4 × 11 × 2 = 88 layouts `default`;
- 4 × 1 × 2 = 8 layouts `team_photo`;
- total mínimo: **96 layouts**.

## 11.3 Estructura recomendada

```text
social-studio-premium/
├── manifest.json
├── README.md
├── checksums.sha256
├── preview/
├── fonts/
├── licenses/
├── themes/
│   ├── heritage/
│   ├── street/
│   ├── scoreboard/
│   └── editorial/
├── fixtures/
│   └── canonical-v1/
└── goldens/
    ├── heritage/
    ├── street/
    ├── scoreboard/
    └── editorial/
```

No incluir:

- `node_modules`;
- URLs externas runtime;
- imports remotos;
- base64 sin original/clasificación;
- estado privado de Claude;
- assets visibles sólo dentro de una sesión;
- bundle opaco sin selectors, tokens y mappings.

## 11.4 Naming de screenshots/goldens del ZIP

```text
<theme>--<family>--<format>--<variant>--<fixture>--<state>.png
```

Ejemplos:

```text
scoreboard--final--portrait--default--canonical-v1--long-names.png
heritage--champion--story--team_photo--canonical-v1--landscape-photo.png
street--round_results--portrait--default--canonical-v1--sponsors-3.png
```

Cada PNG debe tener:

- dimensiones nativas exactas;
- escala 1:1;
- fonts cargadas;
- fixture estable;
- sin UI de browser/Claude;
- mapping en manifest.

## 11.5 Gate

### ZIP ACCEPTED

- cero blockers;
- warnings registrados permitidos.

### ZIP BLOCKED

- uno o más blockers.

Principales blockers del ZIP:

- matriz menor a 96 layouts;
- falta de algún theme, familia, formato o variante;
- Story obtenida mediante scale/stretch/crop de Portrait;
- font comercial, remota, no identificada o sin licencia;
- weight/style faltante o síntesis necesaria;
- recursos externos;
- hashes inválidos;
- assets visibles sólo en screenshots;
- SVG externo/scriptable;
- random/noise runtime;
- Street sin clasificación completa;
- tokens, slots o mappings no identificables;
- fixture hardcodeada como parte del theme;
- fallback de foto, sponsor o escudo ausente;
- truncación silenciosa;
- Resultados 8 o Tabla 18 incompletos;
- branding Arma2 en Premium;
- copy distinto de `FINAL`;
- presencia de AS/asistencias;
- `canonical-v1`, manifest o goldens incompletos;
- `team_photo` incompleta o con la foto QA tratada como fixed asset;
- necesidad de medir o inferir valores desde una captura.

---

# 12. Orden de implementación futuro

Se conserva el orden acordado. No se introduce un reorder sustancial; las dependencias de fonts/assets forman parte del gate del ZIP y del port de renderers.

1. Cerrar revisión 4:5.
2. Adaptar 9:16 como layouts hermanos.
3. Revisar y aprobar 9:16.
4. Expandir los cuatro Premium a las familias restantes.
5. Cerrar Champion `team_photo`.
6. Cerrar comportamiento visual de Sponsors.
7. Entregar ZIP final de Claude.
8. Validar `ZIP ACCEPTED`, incluidas fonts, licencias, assets, mappings y goldens.
9. Resolver white-label backend/policy/render context.
10. Implementar Team Photo `social_export`, autorización y fallback.
11. Implementar dominio/backend de Sponsors.
12. Introducir registry Premium estricto.
13. Portar fonts, assets y renderers definitivos.
14. Implementar UI, selector y gating.
15. Implementar tests contractuales, determinísticos y goldens.
16. Ejecutar browser QA.
17. Realizar integración final, regresión Base y rollout controlado.

Dependencias:

- No portar renderers desde un ZIP bloqueado.
- No habilitar `team_photo` antes de `social_export` y consentimiento.
- No proyectar Sponsors antes del dominio y entitlement autoritativos.
- No habilitar Premium antes de white-label.
- No aceptar goldens mientras exista dependencia remota de fonts.
- No declarar integración final sin regresión completa de Base.

---

# 13. Riesgos y blockers abiertos

## BLOCKER

- White-label todavía no está implementado.
- Team Photo no está autorizada para `social_export`.
- La autorización/consentimiento social de Team Photo no está implementada.
- `officialChampion` pierde `teamEntryId`.
- Sponsors no está implementado.
- Inter continúa remoto.
- Las faces/licencias locales todavía no están cerradas para Premium.
- Próxima fecha no representa correctamente algunos faltantes desde backend.
- El registry actual contiene fallbacks silenciosos a Base.
- Street y Editorial actuales son implementaciones experimentales.
- Falta el 9:16 definitivo.
- Falta el ZIP final.
- Falta la matriz Premium completa de 11 familias.
- No existen goldens visuales definitivos.
- Champion `team_photo` sigue pendiente de diseño.
- El comportamiento visual de Sponsors sigue pendiente.

## IMPORTANTE

- Scoreboard necesita recalibración visual.
- Heritage Final/Campeón y Street Final siguen en revisión.
- El gate actual de themes es principalmente client-side.
- Existen varios entitlements sociales históricos; debe mantenerse una autoridad única para themes Premium.
- Los assets privados requieren timeouts, CORS, cierre de bitmaps y render keys estables.
- Los textos largos pueden volverse ilegibles aunque entren técnicamente.
- Refactorizar primitives de Base antes de contar con goldens puede introducir regresiones.
- Logos con fallos silenciosos pueden ocultar problemas de carga si QA no los registra.
- Los diseños de Sponsors deben demostrar logos horizontal, cuadrado y vertical.
- La revocación de Team Photo no puede retirar PNG ya publicados.

## MENOR

- Logos con aspect ratios extremos pueden verse pequeños bajo `contain`.
- SVG no forma parte del uploader de branding actual.
- Sponsors sin transparencia pueden mostrar recuadro.
- Márgenes transparentes o blancos grandes requieren warnings de UX.
- Nombres de archivo y copy deben probarse con acentos, `ñ` y caracteres especiales.
- Diferencias mínimas de antialias pueden necesitar la tolerancia visual documentada.

---

# 14. Decisiones abiertas

## 14.1 Pendientes de diseño

- aprobación final de 4:5;
- recalibración de Scoreboard;
- microajustes indicados en Heritage, Street y Editorial;
- layouts completos 9:16;
- Champion `team_photo`;
- comportamiento visual 0/1/2/3 de Sponsors;
- expansión a las 11 familias;
- selección final de fonts open source por theme;
- slots, crop, focal points, safe areas y overlays;
- goldens de aprobación.

## 14.2 Pendientes técnicos

El producto esperado ya está definido. Falta implementar:

- enum autoritativo `arma2_visible | white_label`;
- propagación de branding policy al render context/key;
- registry estricto;
- visual models validados por familia;
- representación backend de Próxima fecha incompleta;
- preservación de `teamEntryId` en Champion;
- consentimiento Team Photo y audiencia `social_export`;
- signer y fallback de Team Photo;
- dominio, permisos, RLS, Storage y signer de Sponsors;
- localización completa de fonts;
- pipeline de goldens;
- tests de seguridad y browser QA.

## 14.3 Sin decisión adicional de producto requerida

Ya están adoptados:

- IDs de themes;
- modelo Free/Premium;
- pago único permanente por edición;
- white-label;
- Team Photo institucional revocable;
- owner/admin como autoridad;
- Sponsors por edición;
- política inicial de hasta 20;
- capability `sponsors`;
- variantes `default` y `team_photo`;
- regla fail-soft;
- formatos y dimensiones;
- copy `FINAL`;
- exclusión de asistencias;
- prohibición de fallback silencioso.

---

# 15. Definition of Done — Premium completo

Premium sólo puede considerarse terminado cuando se cumpla todo lo siguiente:

## Themes y matriz

- [ ] Heritage, Street, Scoreboard y Editorial implementados.
- [ ] Los cuatro son visualmente diferenciables.
- [ ] Cada theme soporta las 11 familias.
- [ ] Cada familia soporta Portrait 1080×1350.
- [ ] Cada familia soporta Story 1080×1920 como layout independiente.
- [ ] Existen al menos 96 layouts Premium obligatorios.
- [ ] Ningún theme/familia/formato cae silenciosamente a Base.
- [ ] IDs desconocidos fallan explícitamente.

## Contenido y layout

- [ ] Resultados 4 y 8 completos.
- [ ] Tabla 8 y 18 completa.
- [ ] Nombres largos resueltos según la prioridad acordada.
- [ ] No hay pérdida silenciosa de palabras.
- [ ] Figura no contiene AS ni asistencias.
- [ ] Final usa exactamente `FINAL`.
- [ ] No se inventa metadata.
- [ ] Escudos ausentes usan fallback deliberado.
- [ ] Fotos ausentes tienen escena propia.

## White-label

- [ ] Free/Base mantiene branding Arma2.
- [ ] Todo export de torneo Premium es white-label.
- [ ] No aparecen logo, copy, CTA, dominio, footer ni metadata Arma2.
- [ ] La policy es autoritativa y scoped al torneo.
- [ ] Preview y PNG usan la misma policy.
- [ ] La policy forma parte del render key.

## Team Photo

- [ ] Champion tiene `default` y `team_photo`.
- [ ] Champion conserva `participantId` y `teamEntryId`.
- [ ] Team Photo proviene del dominio existente.
- [ ] Existe autorización institucional explícita y revocable.
- [ ] Existe audiencia `social_export`.
- [ ] Bucket permanece privado.
- [ ] Renderer recibe bitmap/ImageRef neutral, no URL o path.
- [ ] Todo fallo vuelve a escudo/monograma.
- [ ] Ningún fallo de Team Photo rompe el PNG.

## Sponsors

- [ ] Dominio independiente por organización/edición.
- [ ] Capabilities `sponsors.read/manage`.
- [ ] Owner/admin autorizados; demás actores denegados.
- [ ] RLS/RPC y scope exacto.
- [ ] Bucket privado propio.
- [ ] PNG/JPEG/WebP y alpha preservados.
- [ ] Logos usan `contain`.
- [ ] Layouts definen 0/1/3 y reflow de 2.
- [ ] Fallo de un logo es fail-soft.
- [ ] Pérdida de entitlement conserva datos pero bloquea mutaciones/proyección.
- [ ] Warnings de transparencia y márgenes implementados.

## Fonts y assets

- [ ] Todas las fonts son locales y WOFF2.
- [ ] No existe dependencia de Google Fonts.
- [ ] Cada weight/style usado tiene face real.
- [ ] No existe síntesis obligatoria.
- [ ] Licencias, origen, versión y SHA-256 están versionados.
- [ ] Street es completamente determinístico.
- [ ] Fixed assets, QA fixtures y user slots están separados.
- [ ] No existen recursos runtime externos.

## Export, QA y seguridad

- [ ] Export PNG exacto para ambos formatos.
- [ ] Preview y export reutilizan el mismo canvas preparado.
- [ ] Render keys incluyen theme, formato, variante, branding, assets y Sponsors.
- [ ] `canonical-v1` es el único fixture oficial.
- [ ] Existe al menos un golden aprobado por cada uno de los 96 layouts.
- [ ] Goldens usan Chromium/Canvas canónico, locale es-AR y timezone Buenos Aires.
- [ ] CI nunca actualiza goldens automáticamente.
- [ ] Entitlements son fail-closed y scoped al torneo.
- [ ] Tests cross-tenant/cross-tournament aprobados.
- [ ] Buckets privados, signers y RLS aprobados.
- [ ] Browser QA cubre fonts, ImageBitmap, CORS, fallos, preview y descarga.
- [ ] `ZIP ACCEPTED` fue alcanzado antes del port.
- [ ] Base Free conserva sus 11 familias, dos formatos y export PNG sin regresiones.
- [ ] La integración no altera los píxeles aprobados de Base fuera de tranches separadas y autorizadas.

## Milestones intermedios / rollout progresivo

El producto puede desplegarse por etapas únicamente si ese rollout se aprueba de forma explícita. Por ejemplo:

- habilitar themes Premium antes de Sponsors;
- habilitar un subset funcional antes de Premium completo;
- mantener capabilities detrás de feature flags y/o entitlements autoritativos.

Un milestone intermedio no debe marcarse ni comunicarse como “Premium completo”. Debe declarar claramente qué capabilities están habilitadas y cuáles todavía no lo están. Esta posibilidad técnica no define ni reemplaza el roadmap comercial.

---
