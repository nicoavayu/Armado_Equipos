# Detección de Fin de Partido y Gestión de Encuestas

## Descripción

Esta funcionalidad implementa la detección automática del fin de un partido y la gestión de encuestas post-partido, incluyendo notificaciones automáticas y la opción de limpiar partidos de la lista.

## Características Implementadas

### 1. Detección Automática de Partidos Finalizados

- **Hook personalizado**: `useMatchFinishDetection`
- **Monitoreo continuo**: Verifica cada minuto si algún partido ha finalizado
- **Notificación automática**: Envía notificación cuando un partido termina
- **Prevención de duplicados**: Evita enviar múltiples notificaciones para el mismo partido

### 2. Notificaciones de Encuesta

- **Mensaje personalizado**: "La encuesta ya está lista para completar sobre el partido [nombre o fecha del partido]"
- **Datos del partido**: Incluye nombre, fecha, hora y sede del partido
- **Integración con sistema existente**: Utiliza el contexto de notificaciones ya implementado

### 3. Botón "Limpiar Partido"

- **Ubicación**: Al lado del botón "Completar Encuesta" para partidos finalizados
- **Funcionalidad**: Marca que el usuario no completará la encuesta
- **Efecto**: Hace que el partido desaparezca de la lista de Próximos Partidos
- **Persistencia**: El estado se guarda en la base de datos

## Archivos Modificados/Creados

### Nuevos Archivos

1. **`src/services/matchFinishService.js`**
   - Servicio para detectar partidos finalizados
   - Funciones para limpiar partidos de la lista
   - Verificación de estado de partidos limpiados

2. **`src/hooks/useMatchFinishDetection.js`**
   - Hook personalizado para detección automática
   - Manejo de notificaciones
   - Prevención de duplicados

3. **`src/db/cleared_matches_table.sql`**
   - Tabla para almacenar partidos limpiados por usuario
   - Políticas RLS para seguridad
   - Índices para rendimiento

4. **`src/scripts/setupClearedMatches.js`**
   - Script para configurar la tabla en la base de datos

5. **`src/docs/MATCH_FINISH_DETECTION.md`**
   - Documentación de la funcionalidad

### Archivos Modificados

1. **`src/components/ProximosPartidos.js`**
   - Integración del hook de detección
   - Botón "Limpiar Partido"
   - Filtrado de partidos limpiados
   - Manejo de estado de partidos limpiados

2. **`src/components/ProximosPartidos.css`**
   - Estilos para el botón "Limpiar Partido"

## Estructura de Base de Datos

### Tabla `cleared_matches`

```sql
CREATE TABLE public.cleared_matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  partido_id INTEGER NOT NULL REFERENCES public.partidos(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, partido_id)
);
```

## Flujo de Funcionamiento

### 1. Detección de Partido Finalizado

1. El hook `useMatchFinishDetection` monitorea los partidos cada minuto
2. Cuando detecta que un partido terminó (hora actual >= hora del partido)
3. Envía una notificación automática a todos los jugadores del partido
4. Marca el partido como notificado para evitar duplicados

### 2. Visualización en Próximos Partidos

1. Los partidos finalizados muestran el botón "Completar Encuesta"
2. Se agrega el botón "Limpiar Partido" al lado
3. Los partidos limpiados se filtran de la lista

### 3. Limpiar Partido

1. Usuario presiona "Limpiar Partido"
2. Se crea un registro en `cleared_matches`
3. El partido desaparece inmediatamente de la lista
4. El estado persiste entre sesiones

## Configuración

### 1. Base de Datos

Ejecutar el script de configuración:

```bash
node src/scripts/setupClearedMatches.js
```

O ejecutar manualmente el SQL en `src/db/cleared_matches_table.sql`

### 2. Integración

La funcionalidad se integra automáticamente al importar el componente `ProximosPartidos`.

## Consideraciones Técnicas

### Rendimiento

- **Monitoreo eficiente**: Solo verifica partidos una vez por minuto
- **Filtrado optimizado**: Usa índices en la base de datos
- **Prevención de duplicados**: Mantiene estado local de partidos notificados

### Seguridad

- **RLS habilitado**: Solo usuarios pueden ver/modificar sus propios registros
- **Validación**: Verificación de permisos en todas las operaciones
- **Limpieza automática**: Los registros se eliminan cuando se borra el partido o usuario

### Escalabilidad

- **Índices optimizados**: Para consultas rápidas por usuario y partido
- **Limpieza automática**: Previene acumulación de datos obsoletos
- **Diseño modular**: Fácil de extender o modificar

## Posibles Mejoras Futuras

1. **Notificaciones push**: Integrar con servicio de notificaciones push
2. **Configuración de tiempo**: Permitir personalizar cuándo se considera "finalizado" un partido
3. **Estadísticas**: Tracking de cuántos usuarios completan vs limpian encuestas
4. **Recordatorios**: Notificaciones de seguimiento para encuestas no completadas