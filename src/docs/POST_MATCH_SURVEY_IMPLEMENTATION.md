# Implementación de Encuesta Post-Partido

## Resumen

Se ha implementado la lógica completa para procesar encuestas post-partido y actualizar automáticamente los badges MVP, tarjetas rojas y ratings de los jugadores según los criterios especificados.

## Características Implementadas

### 1. Asignación de Badges por Partido

- **MVP**: Solo 1 MVP por partido (el más votado entre ambos equipos)
- **Tarjeta Roja**: Solo 1 tarjeta roja por partido (el más votado como violento)
- **Resolución de empates**: Selección aleatoria en caso de empate
- **Campos actualizados**: `mvps` y `tarjetas_rojas` en tabla `usuarios`

### 2. Cálculo de Rating por Ausencia

- **Penalización**: -0.5 puntos solo si:
  - El jugador faltó al partido
  - No avisó al menos 4 horas antes
  - No buscó ni propuso reemplazo
- **Campo actualizado**: `rating` en tabla `usuarios` (mínimo 1.0)

### 3. Integración con Encuesta Post-Partido

- Procesamiento automático al completar encuestas
- Actualización en tiempo real de estadísticas
- Visualización actualizada en Profile Cards y vistas de usuario

## Archivos Modificados/Creados

### Archivos Principales
- `src/supabase.js` - Función `processPostMatchSurveys` actualizada
- `src/QuieroJugar.js` - Badges actualizados para usar campos correctos
- `src/components/ProfileCard.js` - Badges actualizados

### Nuevos Servicios
- `src/services/absenceService.js` - Manejo de ausencias y reemplazos
- `src/components/AbsenceNotification.js` - Modal para notificar ausencias
- `src/components/AbsenceNotification.css` - Estilos del modal
- `src/components/MatchPlayerActions.js` - Ejemplo de integración

### Scripts de Base de Datos
- `src/db/update_usuarios_table.sql` - Agregar columnas necesarias
- `src/db/player_absences_table.sql` - Crear tabla de ausencias

## Instalación

### 1. Ejecutar Scripts SQL

Ejecuta estos scripts en tu base de datos Supabase:

```sql
-- 1. Agregar columnas a tabla usuarios
-- Ejecutar: src/db/update_usuarios_table.sql

-- 2. Crear tabla de ausencias
-- Ejecutar: src/db/player_absences_table.sql
```

### 2. Importar Componentes

```javascript
// Para usar el modal de ausencias
import AbsenceNotification from './components/AbsenceNotification';
import MatchPlayerActions from './components/MatchPlayerActions';
```

## Uso

### 1. Procesamiento Automático

El procesamiento se ejecuta automáticamente cuando:
- Se completa una encuesta post-partido
- Se tienen al menos 3 respuestas
- Las encuestas no han sido procesadas previamente

### 2. Notificación de Ausencias

```javascript
// Ejemplo de uso del componente
<MatchPlayerActions 
  partidoId={partidoId}
  onPlayerRemoved={(userId) => {
    // Manejar remoción del jugador
  }}
/>
```

### 3. Visualización de Badges

Los badges se muestran automáticamente en:
- ProfileCard
- QuieroJugar (jugadores libres)
- Todas las vistas de usuario

## Lógica de Negocio

### MVP y Tarjetas Rojas

```javascript
// Solo se asigna si hay votos
if (mvpPlayerId && maxMvpVotes > 0) {
  // Incrementar mvps en tabla usuarios
}

if (violentPlayerId && maxViolentVotes > 0) {
  // Incrementar tarjetas_rojas en tabla usuarios
}
```

### Penalización por Ausencia

```javascript
// Solo se aplica si:
const shouldApplyPenalty = !notifiedInTime && !foundReplacement;

if (shouldApplyPenalty) {
  // rating = GREATEST(rating - 0.5, 1.0)
}
```

## Campos de Base de Datos

### Tabla `usuarios`
- `mvps` (INTEGER) - Contador de MVPs
- `tarjetas_rojas` (INTEGER) - Contador de tarjetas rojas
- `rating` (DECIMAL 3,1) - Rating del jugador (1.0-10.0)

### Tabla `partidos`
- `surveys_processed` (BOOLEAN) - Si las encuestas fueron procesadas

### Tabla `player_absences`
- `user_id` - ID del usuario ausente
- `partido_id` - ID del partido
- `reason` - Motivo de ausencia
- `found_replacement` - Si encontró reemplazo
- `notified_in_time` - Si avisó 4+ horas antes
- `hours_before_match` - Horas de anticipación

## Testing

Para probar la implementación:

1. Crear un partido de prueba
2. Agregar jugadores
3. Completar encuestas post-partido
4. Verificar que se actualicen los badges y ratings
5. Probar notificaciones de ausencia

## Consideraciones

- Los badges solo se muestran si el valor es > 0
- El rating mínimo es 1.0
- Las encuestas se procesan una sola vez por partido
- La notificación de ausencia debe hacerse antes del partido para evitar penalización

## Próximos Pasos

1. Integrar el componente `MatchPlayerActions` en las vistas de partido
2. Agregar notificaciones push para recordar completar encuestas
3. Implementar dashboard de estadísticas para administradores
4. Agregar más tipos de badges (mejor arquero, fair play, etc.)