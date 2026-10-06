# Avisos y notificaciones entre Core y Torneos — auditoría (cierre de #182)

Fecha: 2026-10-06. Alcance: app móvil (Capacitor) y web, con Core y Torneos en la misma cuenta. Torneos no tiene push,
web push ni email. Ninguna prueba envió mensajes reales: los push de la validación nativa se inyectaron en el simulador
con `xcrun simctl push` (no pasan por APNs ni por el servidor) y los avisos in-app se crearon en la base LOCAL para
cuentas QA y se borraron al terminar.

## Cómo funciona (código)

| Pieza | Dónde corre | Qué hace |
| --- | --- | --- |
| `NativePushTapBootstrap` (`src/App.js`) | toda la app, también en `/torneos` | escucha `pushNotificationActionPerformed` y deja el destino pendiente + evento `native-push-redirect`. Sólo el toque. |
| `NativePushBootstrap` → `initNativePushNotifications` | sólo Core | **único lugar que pide el permiso**; registra, sincroniza el token y muestra el aviso en primer plano. |
| `CorePushRegistrationKeeper` (`src/App.js`) | sólo dentro de `/torneos`, nativo, con Core disponible | si el permiso **ya** está concedido (`checkPermissions`, nunca `requestPermissions`): `register()` + `flushPendingPushToken` al entrar a Torneos, al cambiar de cuenta y al volver a primer plano. Así un token rotado llega a la cuenta aunque la app sólo se use en Torneos. Sin permiso no hace nada. |
| `CorePushFromTorneosBridge` | sólo dentro de `/torneos` | un toque pendiente de un push de Core lleva a Core (`/`), que consume el destino con sus chequeos. En web Production (sin Core) no hace nada. |
| Restauración de apertura (`SpaceNavigationContext`) | toda la app | último producto y pantalla válidos de la cuenta (rutas en allowlist; la query sólo con claves reproducibles como `?categoria=`). Un toque pendiente, un enlace explícito o el destino del login ganan. |
| Bandejas | separadas | `NotificationProvider`/`BadgeProvider`/`GlobalNoticeModal` no se montan en `/torneos`; la bandeja de Torneos nunca muestra avisos de Core ni al revés. |
| Indicador entre productos (`crossProductUnread`) | encabezado y selector | punto chico junto al logo (abajo a la derecha, sin taparlo) y en la opción del selector. Es lectura de no leídos, **no** una suscripción push. Clave por cuenta; un fallo es «desconocido», nunca «sin avisos». |
| Preferencia de push de Core | servidor (`20261008120000`) | `usuarios.push_enabled` de la cuenta, leída/cambiada con `get_my_push_preference`/`set_my_push_preference` (sólo `auth.uid()`). Un trigger `BEFORE INSERT` en `notification_delivery_log` marca `skipped/push_disabled` toda fila push nueva de una cuenta con la preferencia apagada, venga del flujo que venga; al apagarla también se saltan las pendientes. No toca avisos in-app, la bandeja de Torneos, los tokens ni la sesión. |
| Control en Torneos | `Mi perfil de Torneos` → «Cuenta Arma2» | casilla «Recibir notificaciones de Arma2 en el teléfono» con su explicación. Si la RPC aún no existe (frontend antes que la migración), no se muestra. |
| Cerrar sesión desde Torneos | `signOutWithPushDeactivation` | el mismo cierre de Core: desactiva el token del dispositivo antes de salir. |

## Casos

1. **Usuario sólo de Torneos.** Nunca se le pide permiso desde Torneos; sin permiso, el keeper no registra nada.
2. **Ambos productos, abre en Core.** Igual que siempre.
3. **Ambos productos, la app restaura en Torneos.** El token sigue activo y se refresca desde Torneos si el permiso ya
   estaba concedido (rotación cubierta). El aviso en primer plano lo muestra el sistema (banner) y, al tocarlo, Core.
4. **Toque en un push de Core con la app en Torneos (frío, segundo plano o primer plano).** Abre el destino en Core; la
   restauración no lo pisa.
5. **Cambio de cuenta.** Cerrar sesión desactiva el token; la nueva cuenta abre con su propia preferencia de producto y
   pantalla, y sus propios indicadores (nada se hereda).
6. **Apagar los avisos de Core.** Desde Torneos o (cuando exista) desde Core: el servidor deja de encolar push para esa
   cuenta. La bandeja de Torneos, los avisos in-app de Core y la sesión no cambian.

## Verificado

- **Jest:** `torneosCorePushRegistration.test.js` (sin permiso no registra ni pide; con permiso refresca sin pedir; un
  solo listener), `corePushPreferenceService.test.js`, `torneosConnectedProduct.test.jsx` (control de preferencia, error
  y ausencia de contrato), `spaceNavigationProvider.test.jsx` (pantalla con `?categoria=`, query fuera de allowlist,
  toque pendiente, otra cuenta), `torneosRuntimeIsolation.test.jsx`, `crossProductUnread.test.js`, `globalHeader*.test.*`.
- **Postgres real** (`scripts/db-integration/torneos-connected-product.mjs`, sección 9): get/set sólo de la propia cuenta,
  `anon` sin acceso, fila push nueva con la preferencia apagada ⇒ `skipped/push_disabled`, pendientes saltadas al apagar,
  avisos in-app intactos, volver a encender ⇒ las nuevas se encolan.
- **Simulador iOS** — iPhone 17 Pro (iOS 26.3, Xcode 26.3, UDID `E8357201-…`), build Debug de esta rama contra el stack
  LOCAL `arma2-torneos-qa-seed`, firma ad-hoc con `aps-environment=development`, cuentas `qa-connected-dual` y
  `qa-connected-applicant`. Ver la matriz abajo.

### Matriz nativa (iOS Simulator)

| Caso | Resultado |
| --- | --- |
| Cerrar en Core (Desafíos) y reabrir en frío | PASS: reabre en Desafíos |
| Cerrar en Torneos (Avisos) y reabrir en frío | PASS: reabre en Avisos de Torneos |
| Restaurar pantalla válida (centro del torneo con `?categoria=`) | **FAIL → corregido**: reabría en el inicio de Torneos porque el proveedor no guardaba rutas con query. Tras la corrección, PASS (reabre en Partidos de la categoría); también el plantel de una solicitud |
| Push de Core tocado con la app en segundo plano dentro de Torneos | PASS: abre Desafíos en Core |
| Push de Core tocado con la app cerrada (última pantalla: Torneos) | PASS: abre Desafíos; la restauración no lo pisa |
| Push de Core con la app abierta en Torneos | PASS: banner del sistema; al tocarlo abre Desafíos (Core muestra además su aviso «Entendido», comportamiento propio de Core) |
| Cambio de cuenta (dual → applicant) | PASS: el applicant abre en Core Inicio (no en la pantalla de la cuenta anterior); en Torneos abre en su Inicio, contador 2 (el dual tenía 4), sin «Gestionar» porque no gestiona organizaciones |
| Encabezado y safe areas (Dynamic Island, indicador de inicio) | PASS en Core y Torneos; barra inferior por encima del indicador |
| Solicitud y navegación | PASS: Explorar → ficha → solicitud (equipo ya inscripto bloqueado, «Sos integrante: no podés inscribirlo», faltantes listados) → «Solicitud creada y guardada» → plantel vacío con su explicación; se conserva al reabrir |
| Preferencia de push de Core desde Torneos | PASS: apagar ⇒ `usuarios.push_enabled=false` en la base, bandeja de Torneos (4) y sesión intactas; volver a encender ⇒ `true` |
| Punto entre productos | PASS tras dos ajustes pedidos en revisión: ya no tapa el «2» de Arma2 ni la «S» de Torneos; chico, junto al logo abajo a la derecha, también en el selector |
| Pedido de permiso desde Torneos | No observado: el permiso del simulador ya estaba concedido desde Core al iniciar la prueba; cubierto por Jest |

## Pendiente (no certificado)

Nada de lo siguiente se probó; no se certifica ningún dispositivo físico ni canal real.

1. **Token APNs real y rotación:** la build ad-hoc sin equipo de firma no obtuvo token de APNs (el evento `registration`
   no llegó), así que el envío real desde el servidor y la rotación no se pudieron observar. Cómo probarlo: build firmada
   con el equipo de Apple (perfil de desarrollo con Push) en un iPhone físico o un simulador firmado, sesión con una
   cuenta QA, verificar que el token se guarda para esa cuenta, forzar rotación (reinstalar) y abrir la app directo en
   Torneos: el token nuevo debe llegar sin pasar por Core. Envío de prueba sólo a esa cuenta QA.
2. **Android:** no se ejecutó (emuladores Pixel_7 / Medium_Phone_API_36.1 disponibles, sin build de esta rama). Repetir
   la matriz con una build debug firmada con la keystore de debug y `google-services.json` de un proyecto de prueba.
3. **Deep links universales** (`https://…/votar`, invitaciones): requieren la entitlement de Associated Domains del
   equipo de Apple; en la build ad-hoc no se pueden abrir en la app. La prioridad del toque de push sí se probó.
4. **Primer pedido de permiso** en una instalación limpia de un usuario sólo de Torneos (confirmar que no aparece).
