# Historial de Partidos y Fichas de Partido

Esta funcionalidad permite visualizar el historial de partidos jugados para un partido frecuente, mostrando detalles, estadísticas y jugadores destacados de cada fecha.

## Estructura de archivos

```
src/components/historial/
├── HistorialDePartidosButton.js - Botón para mostrar el historial
├── HistorialDePartidosButton.css - Estilos del botón
├── ListaDeFechasModal.js - Modal con lista de fechas jugadas
├── ListaDeFechasModal.css - Estilos del modal de fechas
├── FichaDePartido.js - Detalle completo de un partido
├── FichaDePartido.css - Estilos de la ficha de partido
├── JugadorDestacadoCard.js - Tarjeta para MVP, arquero y tarjeta negra
├── JugadorDestacadoCard.css - Estilos de la tarjeta de jugador destacado
├── EstadisticasPartido.js - Estadísticas basadas en encuestas
├── EstadisticasPartido.css - Estilos de las estadísticas
└── index.js - Exporta todos los componentes
```

## Integración

Para integrar esta funcionalidad en la aplicación:

1. **Importar el botón de historial**:
   ```jsx
   import { HistorialDePartidosButton } from '../components/historial';
   ```

2. **Agregar el botón en la vista de detalles del partido frecuente**:
   ```jsx
   <HistorialDePartidosButton partidoFrecuente={partidoFrecuente} />
   ```

## Ejemplo de integración completo

```jsx
import React from 'react';
import { HistorialDePartidosButton } from '../components/historial';

const PartidoFrecuenteDetalle = ({ partido }) => {
  return (
    <div className="partido-detalle">
      <h1>{partido.nombre}</h1>
      <div className="partido-info">
        <p>Lugar: {partido.lugar}</p>
        <p>Día: {partido.dia_semana}</p>
        <p>Hora: {partido.hora}</p>
      </div>
      
      {/* Botón de historial - Solo aparece si es partido frecuente */}
      <HistorialDePartidosButton partidoFrecuente={partido} />
      
      {/* Resto del contenido... */}
    </div>
  );
};

export default PartidoFrecuenteDetalle;
```

## Flujo de la funcionalidad

1. El usuario ve el botón "Historial de partidos" en la pantalla de un partido frecuente
2. Al hacer clic, se abre un modal con todas las fechas en las que se jugó ese partido
3. El usuario selecciona una fecha específica
4. Se muestra la ficha completa del partido con:
   - Información básica (fecha, lugar, resultado)
   - Jugadores destacados (MVP, mejor arquero, tarjeta negra)
   - Lista de ausentes
   - Estadísticas basadas en las encuestas

## Requisitos de base de datos

Esta funcionalidad utiliza las siguientes tablas de Supabase:

- `partidos`: Información básica de cada partido
  - Debe tener un campo `partido_frecuente_id` para relacionar con el partido frecuente

- `equipos_partidos`: Equipos que participaron en cada partido

- `jugadores_equipos`: Jugadores que formaron parte de cada equipo

- `post_match_surveys`: Encuestas completadas después de cada partido
  - Debe incluir campos como `se_jugo`, `asistieron_todos`, `jugadores_ausentes`, `partido_limpio`, `jugadores_violentos`

- `player_awards`: Premios otorgados a jugadores
  - Debe incluir campos como `jugador_id`, `partido_id`, `award_type` (mvp, goalkeeper, negative_fair_play)

## Notas de implementación

- El botón "Historial de partidos" solo aparece si el partido es frecuente (`es_frecuente: true`)
- Si se borra un partido frecuente, las fichas y la reputación previa se mantienen
- La funcionalidad es completamente responsive y adaptada para móviles
- Todos los textos están en español
- Se incluye manejo de estados de carga y error
- Las animaciones mejoran la experiencia de usuario