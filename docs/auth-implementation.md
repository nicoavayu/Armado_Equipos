# Implementación de Autenticación con Email y Contraseña

Este documento describe la implementación de autenticación con email y contraseña en Team Balancer.

## Componentes Creados

1. **EmailAuth.js**
   - Componente principal para autenticación con email y contraseña
   - Incluye formularios de registro y login con pestañas
   - Maneja recuperación de contraseña
   - Muestra mensajes de éxito y error

2. **EmailAuth.css**
   - Estilos para el componente EmailAuth
   - Diseño responsive para móviles

3. **AuthPage.js**
   - Página que integra autenticación con email y Google
   - Muestra información del usuario autenticado
   - Incluye botón de cierre de sesión

4. **AuthPage.css**
   - Estilos para la página de autenticación

5. **ResetPassword.js**
   - Componente para restablecer contraseña
   - Verifica el token de restablecimiento
   - Permite al usuario ingresar una nueva contraseña

## Componentes Modificados

1. **GoogleAuth.js**
   - Actualizado para usar toast para mensajes de error
   - Traducido al español

2. **GlobalHeader.js**
   - Agregado botón de inicio de sesión cuando no hay usuario autenticado

3. **GlobalHeader.css**
   - Agregados estilos para el botón de inicio de sesión

4. **TabBar.js**
   - Agregada pestaña de "Cuenta" para acceder a la autenticación

5. **App.js**
   - Agregadas rutas para la página de autenticación y restablecimiento de contraseña
   - Agregado modo 'auth' para mostrar la página de autenticación

## Flujos de Usuario

### Registro
1. Usuario ingresa email y contraseña
2. Se llama a `supabase.auth.signUp()`
3. Se muestra mensaje de confirmación de correo
4. Usuario confirma su correo haciendo clic en el enlace recibido

### Inicio de Sesión
1. Usuario ingresa email y contraseña
2. Se llama a `supabase.auth.signInWithPassword()`
3. Si el correo no está confirmado, se muestra mensaje de error
4. Si las credenciales son correctas, se inicia sesión

### Recuperación de Contraseña
1. Usuario hace clic en "¿Olvidaste tu contraseña?"
2. Ingresa su email
3. Se llama a `supabase.auth.resetPasswordForEmail()`
4. Usuario recibe correo con enlace para restablecer contraseña
5. Al hacer clic en el enlace, se redirige a la página de restablecimiento
6. Usuario ingresa nueva contraseña
7. Se llama a `supabase.auth.updateUser()`

### Cierre de Sesión
1. Usuario hace clic en "Cerrar Sesión"
2. Se llama a `supabase.auth.signOut()`

## Integración con Sistema Existente

- Se mantiene la compatibilidad con el sistema de autenticación con Google
- Se utiliza el mismo contexto de autenticación (`AuthProvider`)
- Se reutiliza la lógica de creación/actualización de perfiles

## Consideraciones de Seguridad

- Las contraseñas deben tener al menos 6 caracteres
- Se verifica que las contraseñas coincidan al restablecerlas
- Se muestran mensajes de error específicos para ayudar al usuario
- No se almacenan contraseñas en el frontend

## Mejoras Futuras

- Implementar validación más robusta de contraseñas
- Agregar opción para cambiar contraseña desde el perfil
- Implementar autenticación con otros proveedores sociales
- Agregar opción para eliminar cuenta