# Borradores (no forman parte del stack)

Nada de esta carpeta está en `supabase/migrations` ni en `runbook/apply-193.psql`. Cada borrador
espera una decisión de Nico con evidencia del gate B.

## 20261010144000 — fila de `partidos` sólo para organizador y plantel (opción A)

**Problema (gate B, 2026-10-09).** `partidos_select_authenticated` deja leer la fila del partido,
**con `codigo`**, a toda cuenta "involucrada" (`app_private.match_involves_user`): una solicitud
pendiente o cualquier aviso sobre el partido. Cualquier cuenta puede pedir sumarse a un partido
publicado y leer su código desde la tabla. `get_match_access_codes` y `partidos_view` ya se lo
ocultan.

**Cambio.** La cláusula pasa a `app_private.match_roster_identity_visible` (143000: organizador y
plantel). Las vistas no cambian.

**Ensayo sobre el esquema real** (`20261010144000_checks.sql`, con el borrador sin aplicar y aplicado):

| Quién | Sin el borrador | Con el borrador |
|---|---|---|
| Solicitud pendiente (publicado) | tabla: 1 fila, con código | tabla: 0 filas; `partidos_view`: 1 fila, código oculto |
| Invitado, todavía fuera (privado) | tabla: 1 fila, con código | tabla: 0 filas; `partidos_view`: 1 fila, código oculto; plantel por RPC: enmascarado |
| Invitado, después de sumarse | partido y código | igual |
| Miembro / organizador | partido y código | igual |

**A verificar con 1.1.21:** la pantalla de invitación a un partido **privado** y la de una
solicitud pendiente. Si leen la fila por id desde la tabla, ahora reciben nada (sí la ven en
`partidos_view`).

**Rollback:** `20261010144000_core_partidos_row_roster_only.rollback.sql`. Vuelve exactamente a la
expresión de 137000 (verificado con `pg_get_expr`).

**Probarlo en un laboratorio**, después del stack, con el humo cargado:

```sql
\set apply_draft on
\i docs/database/core-review/drafts/20261010144000_checks.sql
```
