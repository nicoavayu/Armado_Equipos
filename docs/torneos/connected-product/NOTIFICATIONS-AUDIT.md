# Avisos y notificaciones entre Core y Torneos — auditoría (cierre de #182)

Fecha: 2026-10-06. Alcance: app móvil (Capacitor) y web, con Core y Torneos en la misma cuenta. Nada de esto envía
mensajes: Torneos no tiene push, web push ni email, y ninguna prueba disparó envíos reales.

## Cómo funciona hoy (código)

| Pieza | Dónde corre | Qué hace |
| --- | --- | --- |
| `NativePushTapBootstrap` (`src/App.js`) | toda la app, también en `/torneos` | escucha `pushNotificationActionPerformed` y deja el destino en `sessionStorage` (`pending_native_push_redirect`) + evento `native-push-redirect`. Sólo el toque; nada de permisos ni tokens. |
| `NativePushBootstrap` → `initNativePushNotifications` | sólo Core (`PersonalRuntimeEffects`) | pide permiso, registra el dispositivo, sincroniza el token (`syncNativePushToken`) y muestra el aviso en primer plano. |
| `CorePushFromTorneosBridge` | sólo dentro de `/torneos` | si hay un toque pendiente de un push de Core y Core existe en esa plataforma, navega a `/`; Core consume el destino con su `useNotificationRedirect` (con sus chequeos de vigencia). En web Production (sin Core) no hace nada. |
| Restauración de apertura (`SpaceNavigationContext`) | toda la app | no restaura el último producto si hay un toque pendiente: el aviso gana. Prioridad: enlace/aviso explícito > destino del callback de login > restauración normal. |
| `NotificationProvider` / `BadgeProvider` / `GlobalNoticeModal` | sólo Core | no se montan en `/torneos`: la bandeja de Torneos nunca muestra avisos de Core. |
| Indicador entre productos (`crossProductUnread`) | encabezado global | Core desde Torneos: `HEAD count` acotado de no leídos (misma ventana y `send_at` que la bandeja de Core), o el total exacto que publica la bandeja de Core en esta sesión. Torneos desde Core: el resumen agregado de la bandeja de Torneos (LOCAL o gateway). Clave por cuenta; un fallo es «desconocido», nunca «sin avisos». |
| Cerrar sesión desde Torneos | `TorneosProfilePage` → `signOutWithPushDeactivation` | el mismo cierre de Core: desactiva el token del dispositivo antes de salir. |

## Casos

1. **Usuario sólo de Torneos.** Nunca monta `NativePushBootstrap`: la app no le pide permiso de notificaciones ni
   registra el dispositivo. Correcto, porque Torneos no envía push; la UI de Torneos lo dice («Torneos todavía no envía
   notificaciones push ni emails») y no ofrece controles de canal.
2. **Usuario de ambos productos, abre en Core.** Sin cambios respecto de hoy: permiso, registro, sincronización del token
   y aviso en primer plano como siempre.
3. **Usuario de ambos productos, la app restaura en Torneos.** El token ya registrado sigue activo en el servidor, así que
   los push de Core siguen llegando. Lo que no corre hasta entrar a Core: el refresco del token (evento `registration`), el
   `flushPendingPushToken` al volver de segundo plano y el aviso en primer plano de Core. Mientras tanto, el punto del
   selector avisa que hay novedades en Core (se actualiza al cambiar de producto, al volver a la pestaña y cada 60 s).
4. **Toque en un push de Core con la app en Torneos (en frío o en caliente).** El listener global guarda el destino; el
   puente lleva a Core y Core abre el destino. La restauración no lo pisa.
5. **Cambio de cuenta.** Cerrar sesión desactiva el token; el estado del indicador se descarta por cuenta.

## Verificado

- Jest: `torneosRuntimeIsolation.test.jsx` (nada de Core montado en `/torneos`; el puente lleva un toque pendiente a Core;
  sin Core no se mueve), `spaceNavigationProvider.test.jsx` (un toque pendiente no se pisa con la restauración; reglas de
  apertura), `crossProductUnread.test.js`, `globalHeader.test.jsx`, `torneosConnectedProduct.test.jsx`.
- Navegador, web, vista LOCAL (`127.0.0.1:3102`), escritorio y 375 px: punto de Arma2 en Torneos y de Torneos en Arma2 con
  nombre accesible; desaparece al leer en Core; la bandeja de Core no muestra avisos de Torneos ni la de Torneos avisos de
  Core; restauración al recargar `/` y prioridad del enlace explícito.

## Pendiente: requiere dispositivo o simulador (no se usó ninguno)

No se certifica ningún dispositivo ni canal. Falta, en iOS y Android, con una build de esta rama:

1. Usuario sólo de Torneos: confirmar que no aparece el pedido de permiso de notificaciones.
2. Usuario de ambos productos con token existente, app cerrada en Torneos: recibir un push de Core (de prueba, a una
   cuenta QA) y tocarlo en frío y en caliente → abre el destino en Core.
3. Arranque nativo: la app abre en el último producto y pantalla válidos; con un toque pendiente, gana el aviso.
4. Rotación de token mientras la app sólo se usa en Torneos (ver caso 3): decidir si `NativePushBootstrap` debe registrar
   también desde Torneos para usuarios que ya usan Core. Hoy no lo hace a propósito (Torneos no pide permisos que no usa).
