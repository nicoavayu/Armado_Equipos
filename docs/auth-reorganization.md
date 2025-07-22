# Reorganización de Autenticación

Este documento describe los cambios realizados para reorganizar la autenticación en la aplicación Team Balancer.

## Cambios Realizados

### 1. App.js

- **Cambio principal**: Control centralizado de autenticación
- **Modificaciones**:
  - Agregado `const { user } = useAuth()` para obtener el usuario autenticado del contexto
  - Modificado el renderizado principal para mostrar el formulario de login en la Home cuando no hay usuario autenticado
  - Ocultado el TabBar cuando no hay usuario autenticado
  - Implementada redirección a Home cuando se intenta acceder a otras rutas sin autenticación

### 2. GlobalHeader.js

- **Cambio principal**: Eliminación del botón de login
- **Modificaciones**:
  - Eliminado el botón de inicio de sesión del header
  - Mantenido el título "Team Balancer" cuando no hay usuario autenticado

### 3. TabBar.js

- **Cambio principal**: Eliminación de la pestaña "Cuenta"
- **Modificaciones**:
  - Eliminada la pestaña "Cuenta" del TabBar
  - Mantenidas las demás pestañas (Inicio, Armar Equipos, Quiero Jugar, Amigos, Perfil)

### 4. FifaHome.js

- **Cambio principal**: Simplificación del componente
- **Modificaciones**:
  - Eliminada la lógica de autenticación (ahora se maneja en App.js)
  - Eliminado el contenedor de autenticación con GoogleAuth
  - Siempre se muestra el contenido principal (FifaHomeContent)

## Flujo de Autenticación

1. **Usuario no autenticado**:
   - Al acceder a la aplicación, se muestra solo el formulario de login en la Home
   - No se muestra el TabBar ni se permite acceder a otras secciones
   - El GlobalHeader muestra solo el título "Team Balancer"

2. **Usuario autenticado**:
   - Se muestra el contenido normal de la aplicación
   - Se muestra el TabBar con todas las pestañas excepto "Cuenta"
   - El GlobalHeader muestra la información del usuario y las notificaciones
   - El botón de cerrar sesión sigue disponible en el menú de perfil

## Consideraciones

- La autenticación se maneja de forma centralizada en App.js
- Los formularios y flujos de login/registro se mantienen tal como estaban
- El botón de cerrar sesión sigue disponible únicamente desde el menú de perfil
- La aplicación redirige automáticamente a la Home cuando se intenta acceder a otras rutas sin autenticación