# Planteles de partidos publicados — campo por campo

Estado al 2026-10-08, con 135000–138000 aplicadas.

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
| `added_by` | Si el jugador se sumó solo o lo agregó otro (y quién). | Nadie en los clientes: ni la 1.1.21 ni la web actual lo leen. Sólo el servidor (`get_match_contact_phone`: el teléfono del organizador se ve si te sumaste vos). Lo crea este mismo stack (128000), así que no existe en Producción. | **Sí, sin build.** Propuesta 139000: guardarlo en `app_private.jugadores_added_by` (lo escribe el trigger de 128000) y quitar la columna. `select('*')` sigue andando porque ningún cliente la nombra. **No implementado: espera GO.** | No |
| `uuid` | Nada personal: un identificador aleatorio de la fila. | 1.1.21: clave del jugador en `equipos_json`, votación y arrastrar entre equipos. | No hace falta. No es una credencial: ninguna función de `public` tiene un parámetro de uuid de jugador (búsqueda por nombre de parámetro en el catálogo). | No |

**Además, sin build nativa:** `public_get_match_by_code` (sólo la usa la web nueva) devuelve
las 16 columnas del plantel a quien tiene el código. Podría devolver `tiene_cuenta` en lugar
de `usuario_id`, y no devolver `score` ni `added_by`. Es un cambio coordinado de la RPC y de la
web: la votación usa `usuario_id IS NULL` para saber quiénes son invitados.

## Orden de transición propuesto

1. **Web nueva** (stack #183…#193): funciona con y sin las migraciones.
2. **Base: 120000 → 138000** (RUNBOOK-193). Cierra:
   - datos personales;
   - códigos;
   - planteles de partidos no publicados;
   - fotos de invitados.
3. **Opcional, sin build nativa:**
   - 139000 (`added_by` fuera de la fila);
   - recorte de `public_get_match_by_code` junto con la web.
4. **Build nativa nueva:**
   - lee planteles y partidos sólo por RPC/vistas que deciden columna por columna según quién
     mira;
   - informa su versión con `report_client_build` (130000).
5. **Fase B de planteles**, medida con
   `app_private.privacy_phase_b_readiness(<min Android>, <min iOS>, 30)` y las consolas de las
   tiendas. Cuando ya no queden 1.1.21 en uso, una migración nueva quita a los ajenos la
   cláusula de "publicado" en `jugadores`. Esto es distinto de los archivos `phase-b-*.sql`
   actuales, que revocan columnas de `usuarios`/`partidos`.

Hasta el paso 5 queda abierto, mientras el partido sigue publicado: los nombres, la foto, el
`usuario_id` y el `score` del plantel, visibles para cualquier cuenta con sesión. No es un
cierre total de la exposición.
