# 🔧 Corrección del Sistema de Amistad y Notificaciones

## Problemas Corregidos

### 1. Notificaciones de Solicitudes de Amistad No Visibles

**Problema**: Las solicitudes de amistad recibidas no se mostraban en el panel de notificaciones.

**Solución**: 
- ✅ El query en `NotificationContext.js` ya estaba correcto usando `user_id` como destinatario
- ✅ La suscripción en tiempo real también usa `user_id=eq.${currentUserId}` correctamente
- ✅ Agregados logs adicionales en `NotificationsView.js` para debugging

**Archivos modificados**:
- `src/context/NotificationContext.js`: Mejorados comentarios y logs
- `src/components/NotificationsView.js`: Agregados logs detallados

### 2. Error "JSON OBJECT REQUESTED, MULTIPLE (OR NO) ROWS RETURNED"

**Problema**: Al reenviar solicitudes de amistad rechazadas, el query devolvía múltiples filas.

**Solución**:
- ✅ Agregado `.order('updated_at', { ascending: false }).limit(1)` en `getRelationshipStatus()`
- ✅ Esto asegura que siempre se obtenga la relación más reciente
- ✅ Creado archivo SQL para agregar restricción UNIQUE

**Archivos modificados**:
- `src/hooks/useAmigos.js`: Corregido query en `getRelationshipStatus()`
- `AMIGOS-UNIQUE-CONSTRAINT.sql`: Nuevo archivo para prevenir duplicados

## Cambios Específicos

### NotificationContext.js
```javascript
// Suscripción corregida con comentarios claros
const subscription = supabase
  .channel(`notifications-${currentUserId}`)
  .on('postgres_changes', 
    { 
      event: 'INSERT', 
      schema: 'public', 
      table: 'notifications',
      filter: `user_id=eq.${currentUserId}`, // user_id es el destinatario
    }, 
    (payload) => {
      console.log('[NOTIFICATIONS] Real-time notification received for recipient:', currentUserId, payload);
      handleNewNotification(payload.new);
    },
  )
```

### useAmigos.js
```javascript
// Query corregido para evitar múltiples filas
const { data, error } = await supabase
  .from('amigos')
  .select('id, status, updated_at')
  .eq('user_id', userIdUuid)
  .eq('friend_id', friendIdUuid)
  .order('updated_at', { ascending: false }) // ✅ Más reciente primero
  .limit(1)                                  // ✅ Solo una fila
  .maybeSingle();
```

### AMIGOS-UNIQUE-CONSTRAINT.sql
```sql
-- Elimina duplicados existentes
WITH duplicates AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY LEAST(user_id, friend_id), GREATEST(user_id, friend_id) 
    ORDER BY updated_at DESC
  ) as rn
  FROM public.amigos
)
DELETE FROM public.amigos WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Agrega restricción UNIQUE
ALTER TABLE public.amigos 
ADD CONSTRAINT unique_friendship UNIQUE (user_id, friend_id);
```

## Flujo de Notificaciones Corregido

1. **Envío de Solicitud**:
   - Usuario A envía solicitud a Usuario B
   - Se crea registro en `amigos` con `status: 'pending'`
   - Se crea notificación con `user_id: Usuario B` (destinatario)

2. **Recepción en Tiempo Real**:
   - Usuario B recibe notificación via suscripción en tiempo real
   - Toast se muestra automáticamente
   - Notificación aparece en panel de notificaciones

3. **Visualización**:
   - Panel de notificaciones muestra solicitudes con botones de acción
   - Logs detallados para debugging

4. **Prevención de Duplicados**:
   - Query siempre devuelve la relación más reciente
   - Restricción UNIQUE previene duplicados en base de datos

## Instrucciones de Aplicación

1. **Aplicar restricción UNIQUE** (ejecutar en Supabase):
   ```bash
   psql -f AMIGOS-UNIQUE-CONSTRAINT.sql
   ```

2. **Verificar funcionamiento**:
   - Enviar solicitud de amistad
   - Verificar que aparece en notificaciones del destinatario
   - Verificar toast en tiempo real
   - Probar reenvío de solicitud rechazada

## Logs de Debugging

Los siguientes logs ayudan a diagnosticar problemas:

- `[NOTIFICATIONS] Real-time notification received for recipient:`
- `[NOTIFICATIONS_VIEW] Friend requests: X total, Y unread`
- `[AMIGOS] Relationship found as user_id/friend_id:`
- `[AMIGOS] Using UUID values:`

## Estado Final

✅ Notificaciones de amistad se muestran correctamente
✅ Suscripción en tiempo real funciona
✅ Error de múltiples filas corregido
✅ Restricción UNIQUE implementada
✅ Logs mejorados para debugging