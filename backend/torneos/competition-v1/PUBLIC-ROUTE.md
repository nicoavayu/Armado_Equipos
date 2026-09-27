# COMPETITION-V1 — ruta pública anónima `POST /torneos/public/v1/rpc/get_public_tournament_page`

Análisis previo a Production. Veredicto: **no hay DECISION_CRITICAL que bloquee.** Se agregaron dos mitigaciones stateless y
sin costo, probadas en local. Queda un riesgo residual documentado: no hay rate limit por cliente, y cerrarlo requiere costo o
un cambio de arquitectura.

## 1. Qué agrega realmente la ruta

- La función ya era ejecutable por `anon` desde el baseline. Es una de las 12 funciones anon. Está certificada en Phase 2C
  (`acl.test.mjs` "public RPCs: exactly the 12 …") y es un `SECURITY DEFINER` con `search_path=""`.
- El gateway entrega la clave publicable de Torneos en `GET /config`, por diseño (B7). Cualquiera ya puede llamar
  el PostgREST del proyecto Torneos (`https://<TORNEOS_REF>.supabase.co/rest/v1/rpc/get_public_tournament_page`) directo como `anon`.
- **Consecuencia:** la ruta del gateway no agrega privilegio de DB ni superficie de datos nueva. Agrega un segundo punto de
  entrada, más estrecho que el directo: un solo RPC, argumentos exactos y cotas.

## 2. Datos que devuelve (sólo si la página está publicada)

Se exige `status='published'`, un torneo en `registration|scheduled|active|completed`, la organización `active` y una
temporada no archivada. Si falta cualquiera de esas condiciones devuelve `null`, idéntico al de un slug inexistente.

Contenido:

- Nombres de organización, temporada, torneo y categorías.
- Descripción, formato, fechas.
- Partidos de la versión de fixture publicada, con ronda, fase, grupo, sede y cancha (sólo nombres), y resultado **oficial**
  si lo hay.
- Equipos: nombre snapshot, escudo y colores.
- Tablas publicadas.
- Estadísticas y disciplina publicadas: `display_name` del jugador + goles, asistencias, tarjetas y suspensiones restantes.

No devuelve ids internos, emails, teléfonos, datos de cuenta, planteles completos ni borradores. Branding está OFF: el
frontend anula `shieldPath`/`logoPath`.

## 3. Coste por request (medido en el lab, Postgres 17.6 de la imagen Supabase)

| caso | trabajo en DB | tiempo medido |
|---|---|---|
| slug con forma inválida | **ninguno**: el gateway lo rechaza con 400 antes de llamar a REST (nuevo, D5b) | 0 |
| slug bien formado, inexistente o no publicado | 1 lookup por índice único `tournament_public_pages_slug_unique` → `null` | 0.13–0.16 ms |
| página publicada (torneo chico, ~7 KB de JSON) | ~8 lecturas indexadas + agregaciones proporcionales a partidos, participantes, tablas y estadísticas | 4.5–9.5 ms |

Escala lineal con el tamaño del torneo. Estimación sin medir: una liga grande de 20 equipos a doble rueda (380 partidos) da
decenas de ms. Tope duro: `statement_timeout` del rol `anon`. Es 3 s en la imagen, y G1 lo lee de Production. El gateway
además corta a los 5 s.

## 4. Enumeración y scraping

- **Enumeración:** el slug lo elige el organizador (`^[a-z0-9](?:[a-z0-9-]{1,94}[a-z0-9])$`). Inexistente, no publicado,
  archivado o de organización inactiva devuelven el mismo `null`, así que no hay oráculo de borradores ni de existencia.
  Adivinar slugs sólo encuentra páginas que el organizador publicó para ser públicas.
- **Scraping:** posible por diseño. El contenido es lo que el organizador eligió publicar. El único dato personal es el
  `display_name` de jugadores con estadísticas publicadas, una decisión de producto del baseline, no de esta fase.

## 5. Abuso / DoS: límites vigentes

| límite | valor |
|---|---|
| método / content-type | sólo `POST`, `application/json` (405 / 415) |
| credenciales | cualquier `Authorization` o `apikey` → 400 (nunca se reenvían) |
| cuerpo | ≤ 2 KiB (413), JSON objeto, exactamente `p_public_slug` (+ `p_category_slug`) |
| argumentos | forma exacta de la función (**nuevo**): slug y categoría con el mismo regex que la función y el frontend |
| concurrencia | **nuevo**: ≤ 16 llamadas anónimas en vuelo por instancia del gateway; la 17ª → 503 `public route busy` inmediato, `Retry-After: 1`, sin request upstream |
| timeout upstream | 5 s (`AbortSignal.timeout`) |
| DB | `anon` `statement_timeout` (3 s en la imagen; G1 lo lee de Production) · función `STABLE`, sólo lectura |
| cache | `Cache-Control: no-store` (invariante del gateway, 793+/793+ respuestas del lab) |

**Upstream en Deno Deploy:** la app no tiene rate limit configurado. La config pineada es `install/build/predeploy = null`,
0 layers. Desde acá no se puede verificar qué protección de plataforma aplica Deno Deploy.

## 6. Mitigaciones incorporadas (stateless, sin costo, sin cambio de arquitectura)

En `torneos-gateway/competition.ts`, compartido por los gateways Edge y Node:

1. **Validación de forma antes de REST.** Basura y enumeración ingenua no generan trabajo de DB.
2. **`PublicGate` (cota de concurrencia por instancia).** Un contador en memoria: sin KV, sin store compartido, sin costo.
   Acota el trabajo de DB que una instancia genera para tráfico anónimo y evita que ese tráfico ocupe sus sockets. **No** es
   un rate limit por cliente.

Probado en local:

- `competition.test.mjs` D5b, en gateway Node y **Edge** (edge-runtime).
- Con Torneos REST congelado, 4 formas inválidas → 400 inmediato. Una ráfaga de 40 → exactamente 16 llegan a REST y 24
  reciben `busy`. Al descongelar, las 16 plazas se liberan.
- Suites de regresión completas en verde.

El frontend ya validaba la misma forma y ante un error muestra "No pudimos cargar el torneo público", así que ningún
comportamiento legítimo cambia.

## 7. Riesgo residual (no bloqueante)

- **Sin rate limit por cliente.** Un atacante distribuido puede generar hasta `instancias × 16` llamadas concurrentes vía
  gateway. Además puede ir directo a Torneos PostgREST como `anon` (§1), que el gateway no puede limitar. Cerrarlo de verdad
  exige una de estas:
  - (a) estado compartido: Deno KV u otro servicio → costo y arquitectura;
  - (b) quitar `get_public_tournament_page` de `anon` en la DB y dejar sólo el gateway (con un rol dedicado) → cambio de
    arquitectura y migración;
  - (c) controles de red de Supabase.
  
  **Las tres son DECISION_CRITICAL si se quieren. Ninguna es necesaria para abrir la competencia:** la superficie directa ya
  existe hoy en Production y la ruta del gateway es más estrecha que ella.
- **Coste por página grande:** acotado por el `statement_timeout` de `anon` y por el tamaño real de los torneos.
