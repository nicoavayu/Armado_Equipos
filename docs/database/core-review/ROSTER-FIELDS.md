# Planteles de partidos publicados — campo por campo

Estado al 2026-10-09, con 135000–140000 aplicadas. **El residual de `usuario_id` y `score` quedó cerrado en 140000** (opción A, decidida por Nico el 2026-10-09).

**Quién ve una fila de `jugadores` de un partido ajeno** sólo mientras ese partido está
publicado buscando jugadores ("Quiero jugar"):
- cualquier cuenta con sesión, desde la tabla;
- quien tiene el link con el código, por `public_get_match_by_code`.

**Por qué no se cierra hoy:** la 1.1.21 muestra ese plantel en la página pública del partido.
Lee la tabla con `select('*')` y `count`, y con eso arma la lista y el cupo. Si la tabla
devolviera filas vacías, la app vieja mostraría "0 jugadores" y un cupo falso.

## Campo por campo

| Campo | Qué revela a una cuenta ajena | Quién lo usa | ¿Se puede sacar como 135000 sin romper la 1.1.21? | ¿Build nativa? |
|---|---|---|---|---|
| `usuario_id` | Qué cuenta está detrás de cada nombre. Con eso se llega a su perfil público (nombre, foto, posiciones, ranking: la lista de 128000) y se sabe que esa cuenta juega en esa cancha a esa hora. | 1.1.21, en todo el plantel: "ya estás en este partido", sumarse/salir, tocar un jugador para ver su tarjeta, armar equipos, encuesta. Lo usan el organizador y el plantel, que siguen necesitándolo. | **No.** RLS filtra filas, no columnas. Vaciarlo en la fila (como 135000) lo vacía también para el organizador y el plantel, y les rompe la app. | **Sí**: el plantel por RPC/vista, con `usuario_id` sólo para quien participa y un `tiene_cuenta` para el resto. |
| `score` | El puntaje con que se arman equipos. Se copia de la plantilla (promedio de votaciones anteriores) o es 5. Es la valoración de cada jugador. | 1.1.21: el organizador lo lee del plantel para balancear (`TeamDisplay`, `teamBalancer`) y lo escribe al cerrar la votación. | **No.** Moverlo deja al organizador de la 1.1.21 balanceando con todos iguales. | **Sí**: el plantel por RPC, con `score` sólo para admin/organizador. |
| `added_by` | Si el jugador se sumó solo o lo agregó otro (y quién). | Sólo el servidor (`get_match_contact_phone`). | **Hecho en 139000:** pasa a `app_private.jugadores_added_by` (trigger AFTER INSERT) y la columna se elimina. Probado: `select('*')` de la 1.1.21 y de la web sigue igual; pedir `added_by` da 400; ninguna cuenta ni anon lee la tabla privada. | No |
| `uuid` | Nada personal: un identificador aleatorio de la fila. | 1.1.21: clave del jugador en `equipos_json`, votación y arrastrar entre equipos. | No hace falta. No es una credencial: ninguna función de `public` tiene un parámetro de uuid de jugador (búsqueda por nombre de parámetro en el catálogo). | No |

**Además, sin build nativa:** `public_get_match_by_code` (sólo la usa la web nueva) devuelve
las 16 columnas del plantel a quien tiene el código. Podría devolver `tiene_cuenta` en lugar
de `usuario_id`, y no devolver `score` ni `added_by`. Es un cambio coordinado de la RPC y de la
web: la votación usa `usuario_id IS NULL` para saber quiénes son invitados.

## Qué permitían `usuario_id` + `score` hasta 140000

Sólo sobre partidos **publicados buscando jugadores** (antes del inicio y con lugar). La lectura
está al alcance de cualquier cuenta con sesión, y el registro es abierto. Con eso, alguien puede:

1. **Saber dónde y cuándo va a estar una persona concreta.** El partido publicado trae sede,
   fecha y hora. `usuario_id` dice qué cuenta es cada nombre del plantel.
2. **Pasar de ese nombre a su perfil público** (la lista explícita de 128000):
   - nombre y foto;
   - ciudad, localidad y etiquetas de ubicación;
   - las coordenadas aproximadas de la fila (~1 km, 135000);
   - posiciones, nivel, número, bio, nacionalidad, lesión activa;
   - estadísticas y premios.
   Es decir, juntar "esta persona" + "vive por esta zona" + "va a estar en tal cancha a tal
   hora".
3. **Armar un historial de asistencia.** Mirando los partidos publicados día a día, se puede
   seguir a una cuenta en el tiempo, porque `usuario_id` es estable aunque cambie el nombre.
4. **Ver cómo la valoran.** `score` es la nota de 1 a 10 con que se arman equipos. Suele venir
   del promedio de votaciones anteriores (la plantilla la copia). Es un juicio de pares sobre una
   persona identificable.

**Qué no permite:** ninguno de los dos es una credencial.
- No da acceso a la cuenta, ni teléfono, email o nacimiento (135000).
- No da el código del partido (137000) ni sirve para votar.
- Invitar o mandar solicitud de amistad ya se puede buscando por nombre.
- El nombre y la foto del plantel seguirían visibles aunque se ocultaran estos dos campos: la
  página pública los muestra.

## Versión mínima / actualización forzada: qué existe hoy

- **Ninguna build publicada tiene un control de versión mínima ni de actualización forzada.** Se
  buscó en `src`, `android` e `ios`: no hay chequeo al iniciar, no hay pantalla de "actualizá",
  y no está el plugin de In-App Updates de Google Play.
- **La 1.1.21 no se puede forzar a actualizar** por ningún medio de la app. Tampoco se puede
  reconocer del lado del servidor: no manda su versión.
- **Lo que sí existe, sólo en el código nuevo (#183, sin publicar):**
  - `report_client_build` (130000): cada app nueva informa plataforma, versión y build por
    cuenta, una vez por inicio;
  - `app_private.privacy_phase_b_readiness(<min Android>, <min iOS>, días)` cuenta:
    - cuentas activas;
    - cuentas en la build mínima o más nueva;
    - cuentas por debajo de la mínima;
    - cuentas activas **sin ningún reporte**, que son las que siguen en 1.1.21 o anterior.

**Para que la próxima build sea forzable, tiene que traer:**
- un valor de versión mínima en el servidor (una RPC o un ajuste en `app_private`);
- un chequeo al iniciar que bloquee con "Actualizá la app" y el link a la tienda. En Android
  puede usar el flujo inmediato de In-App Updates.

Eso alcanza para forzar a las builds futuras. La 1.1.21 sólo se cierra del lado del servidor.

## Cierre: 140000 (opción A)

**Para una cuenta que no participa en el partido, y para anon**, ningún plantel trae `usuario_id`
ni `score`:
- la tabla no devuelve filas de partidos publicados, y realtime sigue esa regla;
- en las vistas de "Quiero jugar" y en `get_open_matches_for_quiero_jugar_v2`, cada entrada viene
  sin esos campos y con `has_account` / `is_me`;
- `public_get_match_by_code` (votación e invitación por link) arma las entradas de la misma
  forma;
- la web lee el plantel publicado con `get_public_match_roster`: nombres, fotos, puesto, cupo.

Organizador, administrador y plantel siguen viendo todo. La votación por link funciona igual:
"¿Quién sos?" lista a quienes tienen `has_account` falso, y su foto y su voto pasan.

**No hace falta build nativa.** La 1.1.21 muestra vacío el plantel de un partido publicado ajeno
y cupo 0. Lo que puede **hacer** lo decide el servidor:

| Camino de escritura de la 1.1.21 sobre un partido publicado ajeno | Qué devuelve ahora |
|---|---|
| "Pedir sumarse" (`match_join_requests` insert `pending`) | 201: solicitud pendiente |
| Segundo toque / reintento | 409 `23505`; la app lo resuelve con `reopen_own_match_join_request` → `pending`. Nunca dos solicitudes |
| Solicitud creada ya `approved` (cliente modificado) | 403 `42501` |
| Solicitud a un partido borrado o cancelado | error `match_not_available` |
| Cancelar la propia solicitud | RPC `cancel_own_match_join_request` (sin cambios) |
| Sumarse insertándose en `jugadores` sin invitación, solicitud aprobada ni link validado | 403 (RLS) |
| Sumarse con invitación de la app (notificación `match_invite` no superada por una expulsión) | 201; titular o suplente según el cupo |
| Sumarse con el link de invitación de WhatsApp (código + token: la app lo valida al abrirlo y eso queda registrado 24 h) | 201; titular o suplente según el cupo |
| Sumarse con un link viejo de sólo código, con cuenta | 403. Nico aceptó que los links viejos dejen de andar |
| Invitado sin cuenta por link (`join-match-guest`, token) | sin cambios; cupo verificado |
| Organizador aprueba (`approve-join-request` → `approve_join_request`, 141000) | bloquea solicitud y partido (`FOR UPDATE`): nunca pasa de `cupo` titulares + 4 suplentes; el excedente → "El partido está completo" |
| Editar la propia fila: nombre, foto, posición | 200 |
| Editar la propia fila: pasar de suplente a titular, cambiar de partido, cambiarse el puntaje | 403 `42501` |
| Salir del partido (borrar la propia fila) | sin cambios; el primer suplente sube por trigger del servidor |

**Cupo bajo concurrencia.** Toda alta pasa por `assign_substitute_slot`, que bloquea la fila del
partido (`FOR UPDATE`) y cuenta. Probado en el laboratorio:
- dos aprobaciones simultáneas por el último lugar: entra una;
- dos invitados que se suman a la vez por el último lugar: entra uno, el otro recibe
  `MATCH_FULL_WITH_SUBSTITUTES`.

**Aprobar solicitudes (141000).** En el esquema canónico de `main`, `authenticated` no podía
ejecutar `approve_join_request`, así que `approve-join-request` respondía "forbidden" a todo
organizador. Desde 140000, aprobar es el camino normal para que entre alguien de afuera, así que
141000 se lo permite a las cuentas. La función mantiene su verificación (sólo el creador) y el
bloqueo. El precheck muestra cómo está Producción hoy.
