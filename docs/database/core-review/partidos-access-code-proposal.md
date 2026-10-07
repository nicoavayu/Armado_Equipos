# Partidos: el código de acceso deja de ser enumerable — PROPUESTA (no aplicada)

Estado (2026-10-07, tarde): **preparada y probada localmente, no aplicada en Producción.**
Fase A = migración `20261010133000_core_match_access_code` + cliente que nunca lee `partidos` con
`*` y pide el código con `get_match_access_codes`. Fase B = `phase-b-partidos-access-code.sql`.
Pruebas: `integration/core-lab/tests/match-access-code.test.mjs` (tablas, vistas y RPC como
visitante, cuenta ajena y miembro, en fase A, fase B en transacción y fase B real por la API) y
navegador mobile con ambas fases B aplicadas (panel del admin con su código, enlace de WhatsApp
de una cuenta ajena, votación por enlace sin sesión). En la fase A el admin y el plantel siguen
viendo el código en las vistas; para todos los demás llega vacío.

## Qué pasa hoy

- `partidos_select_authenticated` es `USING (deleted_at is null or is_match_admin(id))` y
  `authenticated` tiene SELECT sobre todas las columnas. Cualquier cuenta (el registro es
  abierto) puede pedir `partidos?select=id,codigo` y recibir el código de **todos** los
  partidos no borrados. La sonda de la sesión de integración lo confirmó en su laboratorio
  (378 filas listadas por una cuenta sin relación).
- `anon` sólo ve partidos con código que no estén borrados ni cancelados
  (`is_public_match_visible`), que es el caso de los enlaces compartidos.

## Qué abre un código

| Uso | Dónde | Qué permite a quien tiene el código |
|---|---|---|
| Votación pública | `/votar-equipos?codigo=…` → `public_*` RPC | Calificar jugadores de ese partido con un nombre del plantel (influye en el armado de equipos). |
| Invitación por enlace | `/partido/<id>?codigo=…`, `public_get_match_by_code` | Ver ficha y plantel, pedir ingreso. |
| Resolver código → partido | `resolve_match_by_code`, `getPartidoPorCodigo` | Encontrar el partido desde el código. |

Enumerar códigos permite entonces votar o abrir la invitación de partidos a los que nadie
invitó a esa cuenta. Los códigos (8 caracteres hexadecimales) no se pueden adivinar por
fuerza bruta en tiempos razonables: el problema es la lectura masiva, no la longitud.

## Descubrimiento legítimo que hay que conservar

Buscar partidos publicados, ver su ficha (nombre, fecha, hora, sede, modalidad, cupo, si
faltan jugadores), verlos en el mapa y pedir ingreso. Nada de eso necesita el código.

## Regla propuesta

> **El código de un partido lo ve sólo quien ya tiene acceso a ese partido: su organizador
> y administradores, los jugadores del plantel y quien tiene una invitación o una solicitud
> de ingreso aprobada. Para cualquier otra cuenta el partido publicado sigue visible, sin el
> código. Quien recibió el código (enlace compartido) puede seguir usándolo: el servidor lo
> valida, pero nunca lo entrega a quien no lo tiene.**

## Cómo se aplicaría (dos fases, igual que los datos privados de `usuarios`)

**Fase A — aditiva, segura para apps instaladas**
1. `app_private.match_access_code(id)` (el código para su admin o un jugador del plantel, si no
   NULL) y `get_match_access_codes(ids)` para el cliente; las vistas `partidos_view` y
   `partidos_abiertos_operativos(_v2)` (y por lo tanto "Quiero jugar") lo usan en lugar de la columna.
   Quien sólo fue invitado ya tiene el código en su aviso de invitación.
2. El cliente deja de leer `partidos.codigo` directo:
   `shareVotingLink.js`, `ArmarEquiposView.js`, `notificationService.js` (llamado a votar),
   `InviteToMatchModal.jsx` (mis partidos) → la RPC; `getPartidoPorCodigo` y el fallback de
   `matchResolver.js` → `public_get_match_by_code` / `resolve_match_by_code` (ya existen).
   Las lecturas `select('*')` de `partidos` y `partidos_view` pasan a columnas explícitas.
3. Prueba de laboratorio: admin / jugador / invitado leen el código; cuenta ajena recibe
   `not_authorized`; `resolve_match_by_code` sigue funcionando con el código correcto.

**Fase B — manual, con GO, cuando la evidencia de builds lo permita**
4. `revoke select on public.partidos from authenticated` + `grant select (<todas las
   columnas menos codigo>)`. `anon` queda igual (sólo partidos compartidos).
5. Chequeo: `has_column_privilege('authenticated','public.partidos','codigo','select')`
   = false; las pruebas de fase A siguen pasando.

## Consecuencias (antes de decidir)

- **Apps instaladas 1.1.21**: leen `partidos` y `partidos_view` con `select('*')`
  (`getPartidoPorId`, `getPartidoPorCodigo`, `StatsView`, `matchResolver`). Con la fase B
  esas lecturas fallan con `permission denied` y la app deja de mostrar partidos. Por eso la
  fase B espera la misma evidencia que la de `usuarios`
  (`app_private.privacy_phase_b_readiness`, 20261010130000) y conviene aplicarlas juntas.
- Filtrar por código (`.eq('codigo', …)`) también exige SELECT sobre la columna: la
  búsqueda por código tiene que ir por RPC (paso 2).
- Un jugador que no está en el plantel ni invitado deja de poder compartir el enlace de
  votación de ese partido (es lo buscado).
- Los enlaces ya compartidos siguen funcionando; las notificaciones de invitación ya
  llevan el código en sus datos.
- Lo que sigue siendo visible por diseño: que el partido existe y su ficha pública. Si se
  quisiera ocultar partidos no publicados (privados), es otra regla: afecta historiales,
  estadísticas y planteles de otras cuentas, y requiere su propio análisis.
- Costo: una RPC más al compartir; ninguna lectura masiva nueva.

## Alternativas descartadas

- *Rotar o alargar los códigos*: no impide leerlos en masa.
- *Ocultar los partidos de terceros*: rompe el descubrimiento legítimo.
- *Sólo la fase B sin fase A*: rompe la app actual y la web al instante.
