# 🔧 Fix Completo: Modelo de Datos jugadores.partido_id

## Problema Identificado

La tabla `jugadores` necesita una relación consistente con `partidos` usando `partido_id` como foreign key UUID.

## Solución Implementada

### 1. Script SQL de Migración

**Archivo**: `FIX-JUGADORES-PARTIDO-ID.sql`

**Ejecutar en Supabase SQL Editor**:

```sql
-- El script completo hace:
1. Verifica estructura actual de jugadores
2. Agrega columna partido_id si no existe (UUID)
3. Convierte partido_id a UUID si tiene otro tipo
4. Crea foreign key constraint a partidos.id
5. Crea índices para performance
6. Verifica estructura final
```

### 2. Función crearPartido() Actualizada

**Cambios en supabase.js**:

```javascript
// Logs detallados agregados
console.log('[CREAR_PARTIDO] Adding creator as player to match:', { 
  userId: user.id, 
  matchId: data.id,
  matchType: typeof data.id 
});

// Datos del jugador con partido_id correcto
const playerData = {
  partido_id: data.id,  // ✅ CLAVE: partido_id como UUID
  usuario_id: user.id,
  nombre: userProfile?.nombre || user.email?.split('@')[0] || 'Creador',
  avatar_url: userProfile?.avatar_url || null,
  uuid: user.id,
};

// Insert con logs de error detallados
const { data: insertedPlayer, error: playerError } = await supabase
  .from('jugadores')
  .insert([playerData])
  .select()
  .single();
```

### 3. InviteFriendModal Actualizado

**Cambios en fetchUserMatches()**:

```javascript
// Query con logs detallados
const { data: jugadoresData, error: jugadoresError } = await supabase
  .from('jugadores')
  .select('id, partido_id, usuario_id, nombre, avatar_url')
  .in('partido_id', partidoIds);  // ✅ Usa partido_id

// Logs de verificación
console.log('[INVITE_MODAL] Jugadores fetched:', {
  total: jugadoresData.length,
  byPartido: jugadoresData.reduce((acc, j) => {
    acc[j.partido_id] = (acc[j.partido_id] || 0) + 1;
    return acc;
  }, {}),
  sampleData: jugadoresData.slice(0, 3)
});

// Filtrado usando partido_id
const jugadoresDelPartido = jugadoresData.filter((j) => j.partido_id === partido.id);
```

## Logs de Verificación

### Al Crear Partido:
```
[CREAR_PARTIDO] Adding creator as player to match: { userId: "...", matchId: "...", matchType: "string" }
[CREAR_PARTIDO] User profile fetched: { nombre: "...", hasAvatar: true }
[CREAR_PARTIDO] Inserting player data: { partido_id: "...", usuario_id: "...", nombre: "..." }
[CREAR_PARTIDO] Creator added as player successfully: { playerId: "...", partidoId: "...", usuarioId: "..." }
```

### Al Cargar Modal de Invitaciones:
```
[INVITE_MODAL] Fetching matches for user: ...
[INVITE_MODAL] Partidos fetched: 3
[INVITE_MODAL] Fetching jugadores for partido IDs: { count: 3, sampleIds: [...] }
[INVITE_MODAL] Jugadores fetched: { total: 5, byPartido: { "partido-1": 2, "partido-2": 3 } }
[INVITE_MODAL] Partido partido-1 has 2 jugadores
[INVITE_MODAL] Match partido-1 (Partido del Viernes): { isCreator: true, isPlayer: true, included: true }
[INVITE_MODAL] User matches found: { total: 2, matches: [...] }
```

## Estructura de Datos Final

### Tabla jugadores:
```sql
CREATE TABLE jugadores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partido_id UUID REFERENCES partidos(id) ON DELETE CASCADE,  -- ✅ FK
  usuario_id UUID,
  nombre TEXT,
  avatar_url TEXT,
  uuid UUID,
  -- otros campos...
);

-- Índices
CREATE INDEX idx_jugadores_partido_id ON jugadores(partido_id);
CREATE INDEX idx_jugadores_usuario_id ON jugadores(usuario_id);
```

### Insert de Jugador:
```javascript
{
  partido_id: "uuid-del-partido",  // ✅ FK a partidos.id
  usuario_id: "uuid-del-usuario",
  nombre: "Nombre del Usuario",
  avatar_url: "https://...",
  uuid: "uuid-del-usuario"
}
```

### Query de Jugadores por Partido:
```javascript
// ✅ Correcto
.from('jugadores')
.select('id, partido_id, usuario_id, nombre, avatar_url')
.in('partido_id', partidoIds)

// ❌ Incorrecto (sin partido_id)
.from('jugadores')
.select('id, usuario_id, nombre')
.eq('some_other_field', value)
```

## Verificaciones Post-Implementación

### 1. Verificar Foreign Key:
```sql
SELECT 
    tc.constraint_name,
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = 'jugadores';
```

### 2. Verificar Datos:
```sql
SELECT 
    COUNT(*) as total_jugadores,
    COUNT(partido_id) as jugadores_con_partido_id,
    COUNT(*) - COUNT(partido_id) as jugadores_sin_partido_id
FROM jugadores;
```

### 3. Probar Funcionalidad:
1. **Crear partido nuevo** → Verificar logs de creación de jugador
2. **Abrir modal de invitaciones** → Verificar que aparece el partido
3. **Invitar amigo** → Verificar que funciona correctamente

## Casos de Error Manejados

### Error en Creación de Jugador:
```javascript
if (playerError) {
  console.error('[CREAR_PARTIDO] Error adding creator as player:', {
    error: playerError,
    code: playerError.code,
    message: playerError.message,
    details: playerError.details,
    playerData
  });
  // No lanza error, continúa
}
```

### Error en Query de Jugadores:
```javascript
if (jugadoresError) {
  console.error('[INVITE_MODAL] Error fetching jugadores:', jugadoresError);
  throw jugadoresError;
}
```

## Rollback (si es necesario)

```sql
-- Remover foreign key
ALTER TABLE jugadores DROP CONSTRAINT IF EXISTS fk_jugadores_partido;

-- Remover índices
DROP INDEX IF EXISTS idx_jugadores_partido_id;
DROP INDEX IF EXISTS idx_jugadores_usuario_id;

-- Remover columna (¡CUIDADO! Perderás datos)
-- ALTER TABLE jugadores DROP COLUMN IF EXISTS partido_id;
```

## Estado Final

✅ Columna `partido_id` como UUID con foreign key
✅ Índices para performance
✅ Función `crearPartido()` agrega jugador con `partido_id`
✅ Modal de invitaciones usa `partido_id` correctamente
✅ Logs detallados para debugging
✅ Manejo robusto de errores
✅ Verificaciones post-implementación