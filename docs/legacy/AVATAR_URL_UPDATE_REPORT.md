# Informe de Cambios: Actualización de Avatar URL

## Objetivo
Asegurar que cada vez que un usuario se loguee con Google (o cualquier proveedor social), su foto de perfil se guarde automáticamente en el campo `usuarios.avatar_url` y se muestre correctamente en toda la aplicación.

## Archivos Modificados

### 1. `/src/supabase.js`
Modificación de la función `createOrUpdateProfile`:

- **Cambio principal**: Ahora siempre actualiza el campo `avatar_url` cuando hay una URL de avatar disponible en los metadatos del usuario (`user.user_metadata.picture` o `user.user_metadata.avatar_url`).
- **Comportamiento anterior**: Solo actualizaba el avatar si el usuario no tenía uno previamente guardado.
- **Comportamiento nuevo**: Siempre actualiza el avatar con la información más reciente del proveedor social.
- **Mejora adicional**: También actualiza los metadatos del usuario en Supabase Auth para mantener la consistencia.

### 2. `/src/components/AuthProvider.js`
Modificación de la función `fetchProfile`:

- **Cambio principal**: Ahora siempre actualiza el perfil con el avatar de los metadatos del usuario, sin importar si ya existe un avatar en el perfil.
- **Comportamiento anterior**: Solo actualizaba el avatar si el perfil no tenía uno.
- **Comportamiento nuevo**: Siempre actualiza el avatar con la información más reciente del proveedor social.

## Verificación
- El componente `PlayerCard.js` ya estaba correctamente configurado para usar `avatar_url` como fuente principal.
- El componente `TeamDisplay.js` ya estaba correctamente configurado para usar `avatar_url`.
- El componente `VotingView.js` ya estaba correctamente configurado para usar `avatar_url`.

## Resultado
Con estos cambios, cada vez que un usuario se loguee con Google:
1. Su foto de perfil se guardará automáticamente en `usuarios.avatar_url`
2. Si el usuario ya existe, su foto de perfil se actualizará con la más reciente
3. La foto de perfil se mostrará correctamente en todos los componentes de la aplicación

Estos cambios aseguran una experiencia de usuario consistente y mantienen la información de perfil actualizada.