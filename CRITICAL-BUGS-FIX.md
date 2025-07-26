# 🚨 Corrección de Bugs Críticos

## Bug 1: Notificaciones de Solicitudes de Amistad No Visibles

### Problema
El panel de notificaciones no mostraba las solicitudes de amistad recibidas.

### Diagnóstico Implementado
- ✅ Logs detallados en `NotificationContext.js` para verificar:
  - Si el usuario actual se obtiene correctamente
  - Si las notificaciones se consultan con el `user_id` correcto
  - Cuántas notificaciones se obtienen y cuántas son de tipo `friend_request`
- ✅ Logs en `useAmigos.js` para verificar:
  - Que la notificación se crea con el `user_id` del destinatario correcto
  - Que los datos de la notificación son correctos

### Cambios Realizados

#### NotificationContext.js
```javascript
// Logs mejorados en fetchNotifications
console.log('[NOTIFICATIONS] Fetching notifications for user:', currentUserId);
console.log('[NOTIFICATIONS] Fetched notifications:', data?.length || 0, 'total');
const friendRequests = data?.filter(n => n.type === 'friend_request') || [];
console.log('[NOTIFICATIONS] Friend request notifications:', friendRequests.length);
console.log('[NOTIFICATIONS] Friend request details:', friendRequests.map(n => ({
  id: n.id,
  user_id: n.user_id, // Debe ser el destinatario
  type: n.type,
  read: n.read,
  message: n.message,
  data: n.data
})));
```

#### useAmigos.js
```javascript
// Logs mejorados en creación de notificaciones
const notificationData = {
  user_id: friendIdUuid, // RECIPIENT (quien debe recibir la notificación)
  type: 'friend_request',
  title: 'Nueva solicitud de amistad',
  message: `${senderProfile?.nombre || 'Alguien'} te ha enviado una solicitud de amistad`,
  data: { 
    requestId: data.id, 
    senderId: userIdUuid,
    senderName: senderProfile?.nombre || 'Alguien',
  },
  read: false,
  created_at: new Date().toISOString(),
};

console.log('[AMIGOS] Creating notification with data:', notificationData);
```

### Cómo Testear
1. **Abrir consola del navegador**
2. **Usuario A envía solicitud a Usuario B**:
   ```
   Logs esperados:
   [AMIGOS] Getting sender profile for notification: [USER_A_ID]
   [AMIGOS] Creating notification with data: { user_id: [USER_B_ID], ... }
   [AMIGOS] Notification created successfully: { id: [...], user_id: [USER_B_ID] }
   ```

3. **Usuario B ve la notificación**:
   ```
   Logs esperados:
   [NOTIFICATIONS] Fetching notifications for user: [USER_B_ID]
   [NOTIFICATIONS] Fetched notifications: X total
   [NOTIFICATIONS] Friend request notifications: 1
   [NOTIFICATIONS] Friend request details: [{ user_id: [USER_B_ID], type: 'friend_request', ... }]
   ```

4. **En tiempo real**:
   ```
   [NOTIFICATIONS] Real-time notification received for recipient: [USER_B_ID] { new: { user_id: [USER_B_ID], ... } }
   ```

---

## Bug 2: Imagen de Perfil No Se Muestra

### Problema
Las imágenes de perfil dejaron de mostrarse en ProfileCard.

### Diagnóstico Implementado
- ✅ Logs detallados para verificar todos los campos posibles de imagen
- ✅ Logs de carga exitosa y errores de imagen
- ✅ Fallback mejorado con estilos inline

### Cambios Realizados

#### ProfileCard.js
```javascript
const getAvatarUrl = () => {
  console.log('[PROFILE_CARD] Getting avatar URL for profile:', {
    id: profile?.id,
    nombre: profile?.nombre,
    avatar_url: profile?.avatar_url,      // Campo principal
    foto_url: profile?.foto_url,          // Campo legacy
    user_metadata: profile?.user_metadata,
    user: profile?.user
  });
  
  // Verifica múltiples fuentes en orden de prioridad:
  // 1. profile.avatar_url
  // 2. profile.foto_url (legacy)
  // 3. profile.user.user_metadata.avatar_url
  // 4. profile.user.user_metadata.picture
  // 5. profile.user_metadata.avatar_url
  // 6. profile.user_metadata.picture
};

// Logs de carga de imagen
onLoad={() => {
  console.log('[PROFILE_CARD] Avatar loaded successfully:', playerData.avatarUrl);
}}
onError={(e) => {
  console.error('[PROFILE_CARD] Avatar failed to load:', playerData.avatarUrl);
  // Fallback mejorado con estilos
}}
```

### Cómo Testear
1. **Abrir consola del navegador**
2. **Abrir ProfileCard de cualquier usuario**:
   ```
   Logs esperados:
   [PROFILE_CARD] Getting avatar URL for profile: {
     id: "...",
     nombre: "...",
     avatar_url: "https://..." o null,
     foto_url: "https://..." o null,
     ...
   }
   [PROFILE_CARD] Found avatar_url: https://...
   [PROFILE_CARD] Using avatar_url with cache buster: https://...?t=1234567890
   [PROFILE_CARD] Final avatar URL for [NOMBRE]: https://...?t=1234567890
   ```

3. **Si la imagen carga correctamente**:
   ```
   [PROFILE_CARD] Avatar loaded successfully: https://...?t=1234567890
   ```

4. **Si la imagen falla**:
   ```
   [PROFILE_CARD] Avatar failed to load: https://...?t=1234567890
   ```
   Y debe aparecer el placeholder 👤

### Campos de Imagen Verificados
- `profile.avatar_url` (principal)
- `profile.foto_url` (legacy)
- `profile.user.user_metadata.avatar_url`
- `profile.user.user_metadata.picture`
- `profile.user_metadata.avatar_url`
- `profile.user_metadata.picture`

---

## Instrucciones de Testing

### Para Notificaciones:
1. Crear dos usuarios (A y B)
2. Usuario A envía solicitud a Usuario B
3. Verificar logs en consola de ambos usuarios
4. Usuario B debe ver la notificación en el panel
5. Verificar que el toast aparece en tiempo real

### Para Imágenes de Perfil:
1. Abrir ProfileCard de cualquier usuario
2. Verificar logs en consola
3. Si no hay imagen, debe mostrar placeholder 👤
4. Si hay imagen, debe cargar correctamente
5. Probar con diferentes tipos de usuarios (con/sin imagen)

### Comandos de Debug en Consola:
```javascript
// Ver notificaciones actuales
console.log('Current notifications:', window.notificationContext?.notifications);

// Ver usuario actual
supabase.auth.getUser().then(({data}) => console.log('Current user:', data.user?.id));

// Ver perfil completo
console.log('Profile data:', profileObject);
```

## Estado Final
✅ Logs detallados implementados para ambos bugs
✅ Diagnóstico completo de campos y queries
✅ Fallbacks mejorados para imágenes
✅ Verificación de user_id correcto en notificaciones
✅ Instrucciones de testing claras