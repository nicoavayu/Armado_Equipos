# Encuesta Post-Partido - Flujo Actualizado

## Descripción
El componente de encuesta post-partido ha sido actualizado para seguir un flujo específico de 6 pasos principales con lógica condicional.

## Flujo de Pantallas

### Paso 0: ¿SE JUGÓ EL PARTIDO?
- **Pregunta**: "¿SE JUGÓ EL PARTIDO?"
- **Opciones**: SÍ / NO
- **Lógica**: 
  - Si SÍ → Paso 1
  - Si NO → Paso 10 (Descargo)

### Paso 1: ¿ASISTIERON TODOS?
- **Pregunta**: "¿ASISTIERON TODOS?"
- **Opciones**: SÍ / NO
- **Lógica**:
  - Si SÍ → Paso 2
  - Si NO → Paso 11 (Seleccionar ausentes)

### Paso 2: ¿QUIÉN FUE EL MEJOR JUGADOR?
- **Pregunta**: "¿QUIÉN FUE EL MEJOR JUGADOR?"
- **Opciones**: Mini-cards de todos los jugadores
- **Lógica**: Solo se puede votar por uno
- **Resultado**: El más votado recibe badge MVP (+1)

### Paso 3: ¿QUIÉN FUE EL MEJOR ARQUERO?
- **Pregunta**: "¿QUIÉN FUE EL MEJOR ARQUERO?"
- **Opciones**: 
  - Si hay arqueros → Mini-cards de arqueros
  - Si NO hay arqueros → Mini-cards de todos los jugadores
- **Botón especial**: "No hubo arqueros"
- **Resultado**: El más votado recibe badge "Guante Dorado"

### Paso 4: ¿FUE UN PARTIDO LIMPIO?
- **Pregunta**: "¿FUE UN PARTIDO LIMPIO?"
- **Opciones**: SÍ / NO
- **Lógica**:
  - Si SÍ → Paso 5
  - Si NO → Paso 12 (Seleccionar jugadores violentos)

### Paso 5: ¿QUIÉN GANÓ?
- **Pregunta**: "¿QUIÉN GANÓ?"
- **Opciones**: Equipo A / Equipo B
- **Campo opcional**: Resultado (ej: "3-2")
- **Resultado**: Se guarda en el historial del partido

## Pasos Condicionales

### Paso 10: Descargo (cuando no se jugó)
- **Campo**: Textarea para explicar por qué no se jugó
- **Botón**: "Ausencia sin aviso" → Paso 13
- **Botón**: "Siguiente" → Finalizar con solo el descargo

### Paso 11: Seleccionar ausentes (cuando se jugó pero faltaron)
- **Opciones**: Mini-cards de todos los jugadores (selección múltiple)
- **Resultado**: Cada ausente recibe -0.5 en su rating

### Paso 12: Seleccionar jugadores violentos
- **Pregunta**: "¿Qué jugador/es tuvieron actitudes violentas?"
- **Opciones**: Mini-cards de todos los jugadores (selección múltiple)
- **Resultado**: Cada seleccionado recibe badge "Tarjeta Roja"

### Paso 13: Ausencia sin aviso
- **Opciones**: Mini-cards de todos los jugadores (selección múltiple)
- **Resultado**: Cada seleccionado recibe -0.5 en su rating

### Paso 99: Pantalla de Gracias
- **Mensaje**: "¡Gracias por tu voto!"
- **Duración**: 3 segundos antes de cerrar automáticamente

## Badges y Premios

### MVP (Most Valuable Player)
- **Icono**: 🏆
- **Condición**: Jugador más votado como "mejor jugador"
- **Límite**: Solo 1 por partido

### Guante Dorado (Golden Glove)
- **Icono**: 🧤
- **Condición**: Arquero más votado
- **Límite**: Solo 1 por partido
- **Nuevo**: Badge creado específicamente para este flujo

### Tarjeta Roja (Red Card)
- **Icono**: 🟥
- **Condición**: Jugador votado como violento
- **Límite**: Solo 1 por partido aunque reciba varios votos

## Actualizaciones de Rating

### Penalizaciones (-0.5)
- Jugadores que no asistieron sin aviso
- Jugadores que faltaron cuando se jugó el partido

### Límites
- **Rating mínimo**: 1.0
- **Rating máximo**: 10.0

## Base de Datos

### Tabla: `player_awards`
```sql
CREATE TABLE player_awards (
  id BIGSERIAL PRIMARY KEY,
  jugador_id UUID NOT NULL,
  partido_id BIGINT NOT NULL,
  award_type VARCHAR(50) NOT NULL, -- 'mvp', 'guante_dorado', 'tarjeta_roja'
  otorgado_por UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Tabla: `post_match_surveys`
Campos actualizados:
- `mejor_jugador` (reemplaza mejor_jugador_eq_a y mejor_jugador_eq_b)
- `ganador` ('equipo_a' o 'equipo_b')
- `resultado` (texto opcional)

## Componentes Actualizados

### `PostMatchSurvey.js`
- Flujo completamente reescrito
- Lógica condicional implementada
- Integración con badges y ratings

### `PlayerAwards.js`
- Soporte para nuevo badge "Guante Dorado"
- Actualización de iconos y estilos

### `surveyService.js`
- Procesamiento actualizado para el nuevo flujo
- Manejo de badges unificado

## Instalación

1. Ejecutar el script SQL: `src/db/player_awards_table.sql`
2. Verificar que la tabla `player_awards` existe en Supabase
3. Configurar políticas RLS si es necesario

## Uso

El componente se usa igual que antes:

```jsx
<PostMatchSurvey 
  partido={partido} 
  onClose={handleClose} 
  onSubmit={handleSubmit} 
/>
```

## Notas Técnicas

- **Progreso**: Barra de progreso basada en 5 pasos principales
- **Navegación**: Sin botón "Atrás" para mantener flujo lineal
- **Validación**: Campos requeridos según el flujo
- **Persistencia**: Todos los datos se guardan al finalizar
- **Tiempo real**: Actualizaciones inmediatas en perfiles de jugadores