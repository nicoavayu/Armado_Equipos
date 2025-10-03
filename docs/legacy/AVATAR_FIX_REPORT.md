# Corrección de Avatar en Perfil de Usuario

## Problema Identificado
El avatar del usuario no se mostraba correctamente en el componente ProfileCard aunque el usuario se hubiera logueado con Google y tuviera una foto de perfil disponible.

## Archivos Modificados

### 1. `/src/components/ProfileEditor.js`
- **Cambio principal**: Mejorado el manejo de avatar_url para asegurar que se actualice automáticamente cuando hay una foto disponible en los metadatos del usuario.
- **Comportamiento anterior**: No actualizaba automáticamente el perfil con la foto de los metadatos.
- **Comportamiento nuevo**: Detecta cuando hay una foto en los metadatos pero no en el perfil y actualiza automáticamente el perfil.
- **Mejora adicional**: Pasa los metadatos del usuario al componente ProfileCard para asegurar acceso a todas las fuentes de la foto.

### 2. `/src/components/ProfileCard.js`
- **Cambio principal**: Mejorado el acceso a las fuentes de avatar_url para incluir todas las posibles ubicaciones.
- **Comportamiento anterior**: No accedía correctamente a todas las fuentes posibles de la foto de perfil.
- **Comportamiento nuevo**: Busca la foto en todas las ubicaciones posibles, incluyendo los metadatos del usuario anidados.
- **Mejora adicional**: Mejorado el manejo de errores al cargar la imagen para mostrar un placeholder cuando falla la carga.

## Resultado
Con estos cambios, la foto de perfil del usuario ahora se muestra correctamente en el componente ProfileCard cuando el usuario se loguea con Google, asegurando una experiencia de usuario consistente.

## Notas Técnicas
- La foto de perfil se busca en el siguiente orden:
  1. `profile.avatar_url` (tabla usuarios)
  2. `profile.user_metadata.avatar_url` (metadatos del usuario)
  3. `profile.user_metadata.picture` (formato alternativo de Google)
  4. `profile.user.user_metadata` (acceso anidado a metadatos)
- Se agregó mejor registro de información para facilitar la depuración de problemas relacionados con la foto de perfil.