# Nombres importantes en Torneos

La UI de Torneos usa un contrato compartido para nombres de equipos, torneos,
organizaciones, categorías y jugadores. El helper `importantNameProps` clasifica
el contenido como `standard`, `long` o `extra-long`; `ImportantNames.css` aplica
familia Inter, tracking progresivo, una sola línea y tamaños por contexto.

## Componentes ajustados

- Headers y contexto: dashboard, hub del torneo, página pública, fixture,
  centro de competencia, equipos, inscripción y operación de partido.
- Cards: mis torneos, próximo partido, equipos, competencia vinculada,
  organizaciones y candidatos del estudio social.
- Datos competitivos: standings, goleadores, estadísticas, disciplina,
  planteles, convocatorias e historial de partidos.
- Controles: selector global de competencia, categoría, fase, grupo, temporada
  y torneo.
- Experiencia participante: cards de partido, directorio de equipos,
  autocompletado de jugadores, comunicaciones y navegación de workspace.

Los partidos con nombres `extra-long` cambian la distribución del marcador a
dos filas antes de reducir más el texto. En 320 px, las métricas secundarias de
rankings y mini-standings se desplazan debajo del nombre extremo. Las tablas
completas conservan su contenedor horizontal cuando tienen muchas columnas.

## Mínimos tipográficos

| Contexto | Nombre largo | Nombre extra largo |
| --- | ---: | ---: |
| Hero | 1.18rem en 320–390 px | 1.35rem |
| Card | 0.80rem | 0.74rem |
| Partido | 0.74rem | 0.72rem |
| Tabla | 0.74rem | 0.72rem |
| Jugador | 0.80rem | 0.75rem |
| Compacto | 0.74rem | 0.72rem |
| Selector | 0.82rem | 0.78rem |

Los nombres importantes usan `text-overflow: ellipsis` sólo cuando el contexto
no puede crecer sin invadir controles, marcadores o escudos. En esos casos el
helper agrega `title` con el nombre completo. Antes de truncar, los partidos con
nombres extremos cambian de distribución y la metadata secundaria puede
ocultarse, desplazarse o pasar a otra fila.

## Excepciones de wrap

El wrap se habilita únicamente cuando conservar una línea volvería ilegible o
recortaría contenido: nombres `extra-long` en un hero a 390 px o menos, el
breadcrum de organización de la página pública a 560 px o menos y valores
`extra-long` de selectores a 390 px o menos. Cards, partidos, tablas, jugadores
y compactos continúan en una sola línea; sus contenedores cambian de layout o
habilitan scroll horizontal según el caso. Los nombres de equipo permanecen
siempre en una línea individual, incluso cuando un partido mueve cada equipo a
una fila visual distinta.

## Validación QA

Se verificaron 1440, 1024, 768, 390 y 320 px con nombres del dataset QA,
incluidos:

- `Los Pibes del Parque Central`
- `Los Pibes del Parque Central y Biblioteca Popular`
- `Torneo Apertura QA 2026`
- `Atlético Defensores del Sur`

En los cinco anchos, `Los Pibes del Parque Central` permaneció en una línea.
También se comprobó que `SIN HORARIO` mantiene `white-space: nowrap` en el rail
del partido. Cards, partidos, tablas y jugadores conservan una línea y aplican
ellipsis con tooltip sólo si el contenedor realmente se agota; las excepciones
de wrap son las tres condiciones mobile documentadas arriba.
