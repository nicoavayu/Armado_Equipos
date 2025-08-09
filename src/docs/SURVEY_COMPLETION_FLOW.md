# Flujo Completo Post-Partido

## Resumen de Implementación

Se ha implementado el flujo completo post-partido con los siguientes comportamientos:

1. **Limpieza inmediata**: El partido desaparece de "Próximos partidos" apenas el usuario envía su encuesta
2. **Sin animaciones al enviar**: Solo se muestra mensaje "Gracias por calificar, los resultados se publicarán en ~6 horas"
3. **Procesamiento cuando todos completan**: Se calculan promedios, se persisten resultados y se programa notificación a +6h
4. **Notificación a las 6 horas**: Se envía "Resultados listos" y recién ahí se muestran animaciones
5. **Retrocompatibilidad**: Mantiene compatibilidad con el sistema existente

## Archivos Implementados

### Base de Datos

1. **`src/db/survey_results_table.sql`**
   - Tabla `survey_results` con campos: `partido_id`, `mvp`, `golden_glove`, `red_cards`, `ready_at`, `results_ready`
   - Campos agregados a `notifications`: `type`, `send_at`, `status`

### Servicios

2. **`src/services/surveyCompletionService.js`**
   - `finalizeIfComplete()`: Verifica si todos completaron y procesa resultados
   - `computeResultsAverages()`: Calcula MVP, Guante Dorado y Tarjetas Rojas por promedios
   - Persiste con `results_ready=false` y programa notificación a +6h

3. **`src/hooks/useNotificationScheduler.js`**
   - Busca notificaciones `pending` cuyo `send_at <= now()`
   - Marca `results_ready=true` y envía notificación al panel
   - Se ejecuta cada 60 segundos

### Componentes

4. **`src/pages/ResultadosEncuestaView.js`**
   - Muestra "Gracias por calificar..." si `results_ready=false`
   - Muestra animaciones solo si `results_ready=true`

### Modificaciones

5. **`src/pages/EncuestaPartido.js`**
   - Llama `finalizeIfComplete()` después de guardar encuesta
   - NO muestra animaciones al enviar
   - Navega a `/?surveyDone=1` para forzar limpieza

6. **`src/components/ProximosPartidos.js`**
   - Suscripción realtime a `post_match_surveys` INSERT
   - Limpia partido inmediatamente cuando el usuario completa encuesta
   - Refetch al detectar `?surveyDone=1`

7. **`src/components/NotificationsView.js`**
   - Maneja clic en notificaciones `survey_results_ready`
   - Navega a `/resultados/:partidoId`

8. **`src/context/NotificationContext.js`**
   - Soporte para tipo `survey_results_ready`

9. **`src/App.js`**
   - Integra `useNotificationScheduler()`
   - Ruta `/resultados/:partidoId`

## Flujo Implementado

### 1. Usuario Envía Encuesta
- ✅ Se guarda la encuesta en `post_match_surveys`
- ✅ Se llama `finalizeIfComplete(partidoId)`
- ✅ El partido desaparece inmediatamente de "Próximos partidos" (realtime)
- ✅ NO se muestran animaciones
- ✅ Se muestra: "¡Gracias por calificar! Publicaremos los resultados en ~6 horas."
- ✅ Navega a `/?surveyDone=1`

### 2. Cuando Todos Completan (finalizeIfComplete)
- ✅ Se calculan promedios: MVP (más votado), Golden Glove, Red Cards (≥25% votos)
- ✅ Se persiste en `survey_results` con `results_ready=false` y `ready_at=now()+6h`
- ✅ Se crea notificación `survey_results_ready` con `send_at=ready_at` y `status='pending'`

### 3. A las 6 Horas (useNotificationScheduler)
- ✅ El scheduler detecta notificaciones `pending` con `send_at <= now()`
- ✅ Marca `results_ready=true` en `survey_results`
- ✅ Envía notificación "Resultados listos" al panel
- ✅ Marca notificación como `status='sent'`

### 4. Usuario Ve Resultados
- ✅ Al hacer clic en notificación, navega a `/resultados/:partidoId`
- ✅ Si `results_ready=false`: muestra "Gracias por calificar..."
- ✅ Si `results_ready=true`: muestra animaciones de premios

## Criterios de Aceptación ✅

### Tras enviar una encuesta:
- ✅ La card del partido desaparece de "Próximos partidos" (en vivo)
- ✅ La vista de encuesta no muestra animaciones; muestra solo el mensaje de gracias

### Cuando la última encuesta entra:
- ✅ Se calcula y persiste `survey_results` con `results_ready=false` y `ready_at=now()+6h`
- ✅ Se crea notificación `survey_results_ready` con `send_at=ready_at` y `status='pending'`

### A las 6h (o si adelanto el reloj / send_at):
- ✅ El scheduler marca `results_ready=true`, envía la noti y setea `status='sent'`
- ✅ Al abrir la noti, se muestra la vista con animaciones (porque `results_ready=true`)

### Retrocompatibilidad:
- ✅ Se reusa el NotificationContext y estilos actuales
- ✅ No hay regresiones en funcionalidad existente

## Configuración de Base de Datos

Ejecutar en Supabase SQL Editor:

```sql
-- Crear tabla de resultados y campos de notificaciones
\i src/db/survey_results_table.sql
```

## Consideraciones Técnicas

- **Scheduler**: Ejecuta cada 60 segundos, busca notificaciones `pending` con `send_at <= now()`
- **Realtime**: Suscripción a INSERT en `post_match_surveys` para limpieza inmediata
- **Cálculo de Premios**: MVP (más votado), Golden Glove (más votado), Red Cards (≥25% votos)
- **Retrocompatibilidad**: Mantiene toda la funcionalidad existente sin modificaciones

## Testing del Flujo

1. **Crear partido** con 2-3 jugadores para testing rápido
2. **Completar primera encuesta**: Verificar que el partido desaparezca inmediatamente de "Próximos partidos"
3. **Completar última encuesta**: Verificar que se cree registro en `survey_results` con `results_ready=false`
4. **Simular 6 horas**: Modificar `send_at` en la notificación para testing inmediato
5. **Verificar scheduler**: Confirmar que marca `results_ready=true` y envía notificación
6. **Abrir resultados**: Verificar que muestra animaciones solo cuando `results_ready=true`

