# SOCIAL STUDIO V2 — MASTER SPEC

**Estado:** implementación final aprobada.

**Scope comercial:** temporada (`season`).

**Capability autoritativa:** `social_studio.premium`.

Este documento define el contrato canónico de Social Studio V2. Describe el
estado final del producto y no funciona como changelog, roadmap ni registro de
decisiones históricas.

## 1. Catálogo

### 1.1 Themes

Social Studio ofrece cinco themes:

| ID | Nombre | Tier visual | Branding admitido |
|---|---|---|---|
| `base` | Base | Free | `arma2_visible`, `white_label` |
| `heritage` | Heritage | Premium | `white_label` |
| `street` | Street | Premium | `white_label` |
| `scoreboard` | Scoreboard | Premium | `white_label` |
| `editorial` | Editorial | Premium | `white_label` |

Heritage, Street, Scoreboard y Editorial son themes Premium completos y
siempre white-label. Base puede renderizarse con o sin branding sólo cuando el
entitlement efectivo lo permite.

### 1.2 Familias

El catálogo completo tiene once familias:

1. `round_results`
2. `standings`
3. `next_fixture`
4. `scorers`
5. `discipline`
6. `best_eleven`
7. `mvp`
8. `round_summary`
9. `semifinals`
10. `final`
11. `champion`

### 1.3 Formatos

Cada familia Premium está implementada en dos composiciones independientes:

- 4:5 / Portrait: 1080 × 1350 px;
- 9:16 / Story: 1080 × 1920 px.

9:16 no es un crop, stretch ni wrapper de 4:5. Ambos formatos son layouts
hermanos y deben preservar su propia composición, jerarquía y safe area.

## 2. Acceso y branding

La autorización se resuelve con la capability `social_studio.premium` sobre el
scope `season`. No se usan entitlements sociales históricos como autoridades
alternativas.

| Entitlement efectivo | Theme | Familias exportables | Preview | Branding |
|---|---|---|---|---|
| FREE | Base | `round_results`, `standings`, `next_fixture` | habilitada | Arma2 obligatorio |
| FREE | Heritage, Street, Scoreboard, Editorial | ninguna | habilitada, locked | white-label |
| PREMIUM | Base | las 11 | habilitada | Arma2 opcional |
| PREMIUM | Heritage, Street, Scoreboard, Editorial | las 11 | habilitada | white-label obligatorio |

Para FREE, las ocho familias Base no incluidas en el cupo gratuito y los cuatro
themes Premium permanecen visibles y previewables, pero locked y no
exportables. El lock pertenece a la interfaz: nunca forma parte del arte.

En `FREE + Base`, el branding Arma2 es obligatorio y no puede desactivarse. En
`PREMIUM + Base`, el usuario puede elegir entre `arma2_visible` y
`white_label`. Los cuatro themes Premium no muestran toggle de branding y nunca
incluyen logos, copy, CTA, dominios, footer ni metadata promocional de Arma2.

Preview, export y autorización de backend deben resolver la misma policy. La
visibilidad del catálogo o de una preview locked no concede permiso de export.

## 3. Contrato de render

Cada combinación de theme, familia y formato tiene un layout registrado. La
preview y el PNG se generan desde la misma composición y consumen el mismo
snapshot normalizado, branding efectivo, assets, selección y estado editorial.

La salida debe ser determinística para una misma entrada. El render no decide
entitlements: recibe una decisión de acceso ya resuelta y no puede convertir
una preview locked en un export autorizado.

Los contenidos variables deben mantenerse dentro de sus cajas mediante las
reglas de autofit y truncamiento aprobadas, sin modificar el layout general.
Escudos, fotos o datos opcionales ausentes usan el fallback definido por el
theme y no rompen la composición.

## 4. Figura

La familia `mvp` permite:

- subir una foto;
- arrastrar el punto focal en ambos ejes;
- ajustar zoom;
- restablecer encuadre;
- obtener exactamente el mismo crop en preview y export.

El encuadre se guarda como datos editoriales normalizados y se aplica en el
mismo orden en ambos pipelines. Si no hay foto válida, cada theme usa su propio
fallback sin foto; la ausencia de imagen no bloquea el render ni el export.

## 5. Equipo Ideal

La familia `best_eleven` admite selecciones manuales de 5, 6, 7, 8, 9 u 11
jugadores.

Cada jugador seleccionado puede tener un `selectedLine` editorial propio. Esa
línea seleccionada es la autoridad de ubicación; el perfil o posición original
del jugador se usa únicamente como fallback cuando `selectedLine` no está
definido.

El layout es adaptativo: distribuye la cantidad elegida por líneas y preserva
legibilidad, jerarquía y límites del campo en 4:5 y 9:16.

## 6. Standings

Los standings respetan el orden oficial del snapshot y mantienen la columna de
puntos legible en todos los themes y formatos.

Editorial usa paginación cuando la tabla supera quince equipos:

- máximo 15 equipos por página;
- la página 2 y siguientes continúan desde el equipo posterior al último de la
  página anterior;
- todas las continuaciones quedan ancladas al borde superior del área de
  contenido, sin centrado vertical por tener menos filas;
- la preview permite recorrer las páginas;
- el export genera todas las páginas, en orden;
- los archivos usan filenames paginados inequívocos para evitar sobrescrituras.

La paginación de Editorial forma parte del contrato tanto para 4:5 como para
9:16. Ninguna fila puede duplicarse, omitirse o cambiar de posición relativa
entre páginas.

## 7. Export y nombres de archivo

El export respeta dimensiones exactas, fuentes cargadas, imágenes resueltas y
la misma geometría visible en preview. Antes de capturar se espera la carga de
fonts y assets; un fallo real no se oculta degradando assertions o sustituyendo
la composición aprobada.

Un export simple produce un PNG con theme, familia y formato identificables.
Cuando una pieza produce varias páginas, el nombre incorpora el número de
página de forma estable y cada página se descarga una sola vez.

## 8. Límites de la integración

La implementación V2 convive con compatibilidad legacy. Los módulos
`resultsThemeLayouts.js`, `socialTemplates.js` y los helpers legacy de
`premiumRenderer.js` no forman parte del contrato visual nuevo y permanecen sin
refactor en esta integración.

La evidencia de QA, los PNGs de revisión y los scripts temporales de captura o
comparación no forman parte del producto ni del plan de commits.

## 9. Criterios de aceptación

Social Studio V2 se considera completo cuando se mantienen simultáneamente los
siguientes contratos:

- cinco themes registrados: Base, Heritage, Street, Scoreboard y Editorial;
- las once familias Premium disponibles en 4:5 y 9:16;
- FREE limitado a tres familias Base exportables con branding Arma2 obligatorio;
- catálogo Premium visible y previewable para FREE, pero locked para export;
- Base con branding opcional para PREMIUM;
- todos los themes Premium siempre white-label;
- upload, focal drag, zoom, reset y paridad preview/export para Figura;
- fallback sin foto específico por theme;
- Equipo Ideal con `selectedLine`, fallback de perfil, seis tamaños de plantel y
  layout adaptativo;
- Editorial standings multipágina, con hasta 15 equipos por página,
  continuaciones top-anchored y filenames paginados;
- enforcement backend del acceso mediante `social_studio.premium` con scope
  `season`;
- suites de Social Studio, migration guard, gates DB, lint y build en verde.
