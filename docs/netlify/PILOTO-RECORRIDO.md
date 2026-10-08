# Piloto Arma2 Torneos — recorrido capitán → inscripción → aprobación → participación → reprogramación

Fecha: 2026-10-08.

**Todo lo de este documento es LABORATORIO**, salvo donde se indica lo contrario:
- build de producción servido por el emulador de la cadena de Netlify (`netlify-lab.localhost:3131`);
- contra `arma2-promo-rehearsal`;
- con cuentas de laboratorio.

Ninguna prueba tocó Production, Mercado Pago real ni un teléfono físico. «Mobile» significa viewport de 375 px con emulación táctil en Chromium.

## Datos del piloto

| Dato | Valor |
| --- | --- |
| Organización | «Lab Liga Conectada» (organizador `b04-owner`) |
| Torneo | «Lab Copa Piloto» (`6558a0b7…`), categoría «Libre» |
| Capitán | `b04-captain` (administra los equipos de Core «Lab Halcones» y «Lab Halcones Reserva») |
| Jugadora | `b04-ana` (plantel de «Lab Halcones») |
| Cuentas ajenas | `galeria-owner` (otra organización), `b04-sin-equipos` |

## Recorrido y resultado

| Paso | Qué se hizo | Comprobación en la base o la API |
| --- | --- | --- |
| Convocatoria | El organizador cargó resumen, localidad, gratuita, requisitos, reglas y cupo 2; publicó en Explorar y abrió solicitudes | Listing `listed/open`, cupo 2 |
| Ficha | El capitán ve requisitos, reglas, «Participación gratuita» y «Quedan 2 de 2 lugares» | — |
| Equipo de Core | El selector ofrece sólo los equipos que administra; los que ya están inscriptos aparecen deshabilitados; los equipos de los que sólo es integrante no se pueden inscribir | — |
| Solicitud | «Crear solicitud» con doble clic → plantel 5/5 con arquero → «Enviar solicitud» con doble clic → recarga | 1 inscripción y 1 solicitud por equipo, 5 jugadores, estado `submitted` |
| Pedido de cambios | El organizador pide cambios; el motivo es obligatorio | `changes_requested`; el capitán ve el motivo en su aviso, en el plantel y en Inicio. Corrige y reenvía |
| Aprobación | El organizador aprueba con doble clic | `approved` (×2). El equipo queda en Participantes del fixture y el cupo baja; con 2/2, la convocatoria muestra «Cupos completos» y desaparece «Solicitar inscripción» |
| Rechazo | Con el cupo en 3, el capitán pide con un equipo nuevo («Piloto FC»); el organizador rechaza con motivo obligatorio | `rejected` |
| Cuentas ajenas | Otra organización, la jugadora y una cuenta sin equipos intentan aprobar, enviar, leer la bandeja y cerrar solicitudes | 403 `42501` en las 12 llamadas; nada cambió |
| Participante | La jugadora ve sólo accesos de participante («Gestionar» no aparece); la URL de gestión la devuelve a `/torneos` | — |
| Fixture | El organizador cierra participantes → genera el borrador v1 → publica | 1 partido en la versión publicada |
| Programación | Sede y cancha (con doble clic se crean una vez) → programa el partido el 17/10 a las 15:00 | `scheduled`, 17/10 15:00 |
| Participación | La jugadora responde «Voy» con doble toque y recarga | 1 respuesta `available`; sigue marcada después de la recarga |
| Reprogramación | El organizador reprograma **el mismo partido** al 18/10 a las 17:30, con motivo | Sigue habiendo 1 partido; historial 17/10 15:00 → 18/10 17:30 con el motivo; la jugadora (mobile) y el capitán (desktop) ven «Reprogramado · antes era el sáb, 17 oct, 03:00 p. m.» |
| Experiencia de Torneos | Revisión de enlaces en Inicio, Mis partidos, el torneo, Partidos, Avisos, Perfil, Mis torneos y Explorar | Ningún enlace sale a Core salvo «Eliminar cuenta» en el perfil, que es intencional porque la cuenta es compartida |

Los avisos generados fueron sólo de Torneos: `registration.received` / `submitted` / `changes_requested` / `approved` / `rejected`.

## Qué se corrigió y por qué

| Commit (#182) | Problema encontrado | Corrección |
| --- | --- | --- |
| `87f48f67` + `8aea5370` | Una cancha nueva nacía como «Fútbol 7» y bloqueaba un torneo de Fútbol 5 | Sin modalidad preseleccionada; «Elegí la modalidad» es obligatorio |
| `87f48f67` | «Validar» decía sólo «1 bloqueos» y «Guardar» seguía habilitado | La validación lista los motivos; «Guardar» espera a que no haya bloqueos |
| `87f48f67` | El servidor pedía confirmar las advertencias y la interfaz no tenía cómo | Se ofrece «Programar igual, con estas advertencias», con motivo |
| `87f48f67` + `8aea5370` | Decía «1 canchas» | Dice «1 cancha» |
| `228bb139` (Torneos 0015) | El participante sólo veía la hora nueva | Las dos lecturas del participante devuelven `previousScheduledAt`, sólo la hora, sin el motivo interno; Mis partidos muestra la hora anterior |

0015 es independiente de 0012–0014. En el laboratorio se aplicó, revirtió y volvió a aplicar con pre y postcondiciones por md5. Galería confirmó `db-0012` con 0015 presente y Premium lo agrega a su prueba de orden.

## Comparación acotada con Timbo

- **Anunciado** en timbo.futbol: inscripción online, app para jugadores con perfil y notificaciones, horarios, sedes y canchas, legajos, sanciones, presentismo, planillas PDF, sitio del torneo, personalización y sponsors, varios usuarios, soporte por WhatsApp.
- **Observado:** sólo la página pública y los enlaces a las tiendas. La documentación (`/docs` → `soporte.timbo.futbol`) no mostró contenido legible sin acceso. No se crearon cuentas ni se aceptaron términos.
- **No verificado:** cómo son sus estados de inscripción, aprobaciones, reprogramaciones y avisos.
- **Fricción concreta** que la comparación ayudó a ver en Arma2: Timbo anuncia avisos a jugadores. Arma2 no avisa una reprogramación. Ahora la hora anterior se ve al entrar a Mis partidos, pero no hay aviso activo; queda como decisión (ver Pendientes). No se afirma superioridad de ninguno de los dos.

## Seguridad (laboratorio)

Privacidad de Core, PR #193:
- una cuenta ajena ya no lee email, teléfono ni fecha de nacimiento;
- las coordenadas salen aproximadas (~1 km);
- `select('*')` de 1.1.21 no se rompe.

Quedan legibles el código y el plantel de los partidos que están publicados buscando jugadores. **Mientras #193 no esté en Production, el piloto no es apto para usuarios reales.**

## Netlify real

**No verificado.** El proyecto de prueba es privado para el equipo (401 sin sesión) y no generó un deploy preview para #192: no hay estado ni comentario. Además, no hay un backend de prueba alojado: Staging está pausado por el límite de 2 proyectos Free, y no se expone el laboratorio. Con la configuración actual, un deploy real sólo podría verificar el hosting, no el recorrido.

## Pendientes

| Pendiente | Tipo |
| --- | --- |
| Aviso de reprogramación a los participantes. Hoy no existe ese tipo de aviso | Decisión de producto |
| Lectura del código de los partidos abiertos (#193) | Decisión |
| Deploy real en Netlify y backend de prueba alojado | Bloqueado, requiere a Nico |
| Teléfono físico (iOS/Android) | No probado |
| Realtime | No probado: el puente del laboratorio no reenvía WebSocket y en la consola aparecen errores de conexión a `/realtime/v1`. Los datos se verificaron recargando y por la API |
| Mercado Pago real | No probado |

Las ventas siguen apagadas: en el build de Netlify, «La compra de Premium todavía no está disponible.».
