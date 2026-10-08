# Planteles de partidos publicados — campo por campo

Estado al 2026-10-08, con 135000–139000 aplicadas.

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

## Qué permite hoy `usuario_id` + `score` (residual abierto)

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

## Cierre: opciones con fecha o condición

**A. Cerrar ya, sin build nueva.**
- Una migración "fase B de planteles" saca a las cuentas ajenas la cláusula de "publicado" en
  `jugadores` (filas sólo para quien participa) y pasa la web nueva a leer el plantel de un
  partido publicado por una RPC sin `usuario_id` ni `score`.
- **Costo:** en la 1.1.21, la página pública de un partido publicado ajeno muestra el plantel
  vacío y el cupo en 0. Falta probar en el lab qué hace la 1.1.21 al pedir sumarse con ese cupo
  falso.
- Se puede publicar junto con #193 en cuanto se pruebe.

**B. Atado a la app nueva.**
- **D0:** sale la build N en las dos tiendas, con plantel por RPC, `report_client_build` y versión
  mínima.
- **D0 + 14:** la mínima pasa a N, y quedan forzadas todas las builds que reportan.
- Cuando `privacy_phase_b_readiness(N, N, 30)` muestre `native_below_minimum = 0` y
  `active_without_any_report` en un número que Nico acepte, o al llegar a D0 + 30 (lo que pase
  primero), se aplica la misma migración de A.
- La 1.1.21 que quede degrada igual que en A.

**Recomendación:** A si Nico no acepta el residual ni siquiera por unas semanas. El único costo
lo pagan quienes sigan en 1.1.21, y sólo al mirar partidos ajenos publicados. Si no, B. Ninguna
de las dos está implementada: esperan decisión y GO.

Hasta aplicar A o B, mientras el partido sigue publicado, queda abierto: los nombres, la foto,
el `usuario_id` y el `score` del plantel, visibles para cualquier cuenta con sesión.
