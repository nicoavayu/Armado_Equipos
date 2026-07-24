# Sistema de contenido social

## Objetivo

Generar piezas consistentes y regenerables desde datos estructurados. No se basa en screenshots del cliente.

## Arquitectura propuesta

```text
datos confirmados → snapshot de contenido → plantilla versionada
→ render determinista en servidor → asset + metadata → descarga/share
```

Cada asset conserva tipo, organización, torneo, jornada, snapshot, template/version, formato, autor, sponsors, fecha y estado (`current` o `stale`). Un cambio de resultado marca como desactualizadas las piezas dependientes.

## Tipos iniciales

Fixture, resultados, tabla, goleadores, asistencias, tarjetas, próxima fecha, partido destacado, MVP, mejor arquero, equipo de la fecha, clasificados, playoffs, campeón, estadísticas de cierre y comunicados operativos.

## Formatos

- feed 1080 × 1350;
- story 1080 × 1920;
- cuadrado 1080 × 1080;
- horizontal futuro.

Una colección puede paginarse y numerarse. Las plantillas definen áreas seguras y comportamiento ante overflow.

## Branding controlado

Variables permitidas:

- logo de organización;
- colores primario/secundario con ajuste de contraste;
- sponsors en slots definidos;
- fondo autorizado;
- título/bajada;
- visibilidad de campos opcionales.

Variables fijas:

- presencia mínima Arma2 Torneos;
- grilla, jerarquía y safe areas;
- contraste mínimo;
- límites tipográficos;
- provenance/versionado.

## Equipo de la fecha

El editor recibe torneo, categoría, jornada, modalidad y formación. La búsqueda prioriza jugadores habilitados, impide duplicados y muestra equipo/escudo. Las sugerencias usan datos confirmados, pero la selección final siempre es humana y editable.

## Renderizado

Se recomienda servidor para fuentes, tamaños y assets deterministas. El cliente solicita un job idempotente, consulta estado y recibe una URL temporal/compartible. Deben existir fallbacks para escudos ausentes, textos largos y logos extremos.

## Privacidad y moderación

- sólo datos públicos/permitidos entran a una pieza;
- sanciones públicas requieren regla y revisión;
- IA puede redactar borradores, nunca publicar;
- resultados y hechos provienen de snapshots confirmados;
- fondos y sponsors pasan validación de tipo/tamaño.

## Criterios de calidad

Contraste AA para texto relevante, márgenes seguros, prueba con nombres largos, múltiples densidades, sin recortes en 4:5/9:16/1:1, render repetible y accesibilidad equivalente en el texto acompañante.

No se implementa renderizado en esta fase; sólo se reserva el flag `socialContentGenerator`.

