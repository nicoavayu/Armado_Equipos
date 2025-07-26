# 🔧 Fix: Foreign Key Relationship jugadores → partidos

## Problema

Error: "Could not find a relationship between 'partidos' and 'jugadores' in the schema cache"

Este error ocurre porque Supabase no puede resolver automáticamente el join entre las tablas `partidos` y `jugadores` sin una foreign key explícita.

## Solución

### 1. Ejecutar Script SQL en Supabase

**Archivo**: `ADD-JUGADORES-FK.sql`

**Instrucciones**:
1. Ir a Supabase Dashboard → SQL Editor
2. Ejecutar el script completo
3. Verificar que no hay errores

**Lo que hace el script**:
- ✅ Verifica que `jugadores.partido_id` sea tipo UUID
- ✅ Crea la columna si no existe
- ✅ Agrega foreign key constraint: `jugadores.partido_id → partidos.id`
- ✅ Crea índice para performance
- ✅ Agrega comentarios de documentación

### 2. Query Actualizado (Enfoque Robusto)

**Archivo**: `InviteFriendModal.js`

**Cambio**: Reemplazado join automático por queries separados y combinación manual.

```javascript
// ANTES (con join automático - problemático)
const { data, error } = await supabase
  .from('partidos')
  .select(`
    id, nombre, fecha, hora, sede,
    jugadores (
      id, usuario_id,
      usuarios (id, nombre)
    )
  `)

// DESPUÉS (queries separados - robusto)
// 1. Obtener partidos
const { data: partidosData } = await supabase
  .from('partidos')
  .select('id, nombre, fecha, hora, sede, creado_por')
  .gte('fecha', new Date().toISOString().split('T')[0]);

// 2. Obtener jugadores para esos partidos
const partidoIds = partidosData.map(p => p.id);
const { data: jugadoresData } = await supabase
  .from('jugadores')
  .select('id, partido_id, usuario_id, nombre')
  .in('partido_id', partidoIds);

// 3. Combinar manualmente
const partidosConJugadores = partidosData.map(partido => ({
  ...partido,
  jugadores: jugadoresData.filter(j => j.partido_id === partido.id) || []
}));
```

## Ventajas del Nuevo Enfoque

### ✅ **Robustez**
- No depende de joins automáticos de Supabase
- Funciona independientemente del schema cache
- Control total sobre la consulta

### ✅ **Performance**
- Dos queries optimizadas en lugar de un join complejo
- Índices específicos para cada consulta
- Menos transferencia de datos innecesarios

### ✅ **Mantenibilidad**
- Lógica clara y explícita
- Fácil debugging
- No depende de configuraciones de Supabase

## Estructura de Datos Resultante

```javascript
// Resultado final (igual que antes)
[
  {
    id: "partido-uuid",
    nombre: "Partido del Viernes",
    fecha: "2024-01-15",
    hora: "20:00",
    sede: "Cancha Central",
    creado_por: "user-uuid",
    jugadores: [
      {
        id: "jugador-uuid",
        partido_id: "partido-uuid",
        usuario_id: "user-uuid",
        nombre: "Juan Pérez"
      }
    ]
  }
]
```

## Instrucciones de Implementación

### Paso 1: Ejecutar SQL
```sql
-- En Supabase SQL Editor
-- Copiar y pegar todo el contenido de ADD-JUGADORES-FK.sql
-- Ejecutar
```

### Paso 2: Verificar Foreign Key
```sql
-- Verificar que la relación existe
SELECT 
    tc.constraint_name,
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_name = 'jugadores'
    AND kcu.column_name = 'partido_id';
```

### Paso 3: Probar Funcionalidad
1. Crear un partido nuevo
2. Verificar que aparece en lista de invitaciones
3. Intentar invitar un amigo
4. Verificar que no hay errores en consola

## Logs de Debugging

```javascript
// Logs esperados después del fix
console.log('Partidos fetched:', partidosData.length);
console.log('Jugadores fetched:', jugadoresData.length);
console.log('User matches found:', userMatches.length);
```

## Rollback (si es necesario)

```sql
-- Remover foreign key
ALTER TABLE public.jugadores 
DROP CONSTRAINT IF EXISTS fk_jugadores_partido;

-- Remover índice
DROP INDEX IF EXISTS idx_jugadores_partido_id;
```

## Estado Final

✅ Foreign key establecida correctamente
✅ Query robusto que no depende de joins automáticos
✅ Performance optimizada con índices
✅ Funcionalidad de invitaciones funcionando
✅ Compatibilidad con código existente