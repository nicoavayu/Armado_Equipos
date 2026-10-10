# Arreglo urgente: sólo el organizador cancela un partido (20261010118000)

**Aplicado en Core Producción el 2026-10-09 (~23:10Z) con el GO de Nico**: antes 3/3, COMMIT, después 6/6; anon → 401 42501. Este arreglo tiene su propio GO, separado de D3. Lo
ejecuta Nico. El agente no tiene acceso a Producción, y la contraseña de la base sólo se tipea en
la terminal.

## Problema (Producción, hoy)

`public.cancel_partido_with_notification(bigint, text)`:
- es SECURITY DEFINER;
- tiene EXECUTE para PUBLIC, `anon`, `authenticated` y `service_role`;
- no mira quién la llama.

Cualquiera, **sin sesión**, puede cancelar y borrar (soft delete) **cualquier** partido
(`estado = 'cancelado'`, `deleted_at = now()`), y su plantel recibe el aviso de cancelación.

## Quién la llama (revisión del 2026-10-09)

| Origen | Uso |
|---|---|
| 1.1.21 (`dad2a0b9`) `src/services/db/matches.js:1675` | el organizador cancela su partido, con sesión |
| Web `main` | no la llama |
| Funciones edge | no la llaman |
| Otras funciones SQL, triggers, pg_cron | no la llaman |

## El cambio

- **Guarda al principio del cuerpo**, que por lo demás queda igual. Si la llama la API (rol `anon` o
  `authenticated`), quien llama tiene que ser `creado_por` del partido (o `admin_id`, donde esa
  columna exista). Si no, error 42501 y no se toca nada. `service_role`, el dueño y pg_cron no
  cambian.
- **`anon` y PUBLIC pierden EXECUTE.** `authenticated` y `service_role` quedan como estaban.
- **Sólo se cambia el cuerpo revisado** (md5 de `prosrc` `3651c2dc0a7d0543730dbb541eeaa91a`, igual
  en Producción y en el repositorio):
  - si ya tiene la guarda, no hace nada;
  - con cualquier otro cuerpo, se detiene.
- **Lo necesario para el rollback** (cuerpo original y ACL) se guarda en
  `app_private.core_function_before`.
- **No depende de nada de D3** (119000…): aplica sobre el esquema de Producción tal como está.

## Pasos (Nico, con GO)

Mismo `CORE_CONNINFO` y conexión que RUNBOOK-193 §4. Es un cambio de una función: no toca datos.
Igual conviene tener el backup del día.

1. Antes. Las líneas de `"phase": "before"` deben dar `pass: true`; las de `after` todavía no:

   ```bash
   /opt/homebrew/opt/libpq/bin/psql "$CORE_CONNINFO" --password -X -A -t -q -f docs/database/core-review/runbook/cancel-118000-check.sql
   ```

2. Aplicar:

   ```bash
   /opt/homebrew/opt/libpq/bin/psql "$CORE_CONNINFO" --password -X -f docs/database/core-review/runbook/apply-118000.psql
   ```

3. Después: correr otra vez el comando del paso 1. Las líneas `"phase": "after"` deben dar
   `pass: true`:
   - el ledger tiene 118000 y el cuerpo, la guarda;
   - `anon` no la ejecuta y `service_role` sí;
   - una cuenta que no es organizadora recibe 42501.

   El chequeo es una transacción que se revierte y nunca cancela un partido.

4. Prueba manual con 1.1.21: el organizador cancela un partido de prueba suyo; el plantel recibe el
   aviso.

## Rollback

```bash
/opt/homebrew/opt/libpq/bin/psql "$CORE_CONNINFO" --password -X -1 -v ON_ERROR_STOP=1 -f docs/database/core-review/runbook/rollbacks/20261010118000_core_cancel_match_organizer_only.rollback.sql
```

Devuelve el cuerpo original byte a byte (mismo oid) y el ACL exacto, borra la tabla de respaldo
y la fila del ledger. Datos perdidos: ninguno.

## Cómo encaja con D3 (nunca se aplica dos veces)

- La versión `20261010118000` está en la secuencia de D3 y va antes de 119000.
- `apply-193.psql` (#196) tiene un bloque para 118000 que **la saltea si ya está en el ledger**:
  - si este arreglo ya se aplicó, D3 dice `=== 20261010118000 already in the ledger: skipped`;
  - si no, D3 la aplica primero.
- Además, la migración es idempotente: si el cuerpo ya tiene la guarda, no hace nada.
- 20261010146000 (las demás funciones abiertas, D3) **se apoya en esta**: si
  `cancel_partido_with_notification` ya tiene la guarda de 118000, la deja como está. El rollback de
  146000 nunca toca esta función.
- El precheck de D3 sólo exige que no esté ninguna de `20261010119000…`; 118000 puede estar.
- **Orden de rollback:**
  1. el de 146000, si está aplicada;
  2. el resto de D3 como dice RUNBOOK-193 §9;
  3. el de 118000 cuando se decida, en cualquier momento posterior. No usa nada de 119000.
- `rehearse-118000.mjs` lo ensaya solo, sobre el esquema real. El ensayo de D3 (#196) lo incluye
  en la secuencia completa.

## Ensayo

`node integration/prod-schema/rehearse-118000.mjs`, sobre una copia nueva del esquema real de
Producción. Resultado del 2026-10-09
([`runbook/evidence/rehearsal-118000-20261009.json`](runbook/evidence/rehearsal-118000-20261009.json)):

| Paso | Resultado |
|---|---|
| Antes | `pass: true`: el cuerpo revisado y su ACL de hoy (PUBLIC, `anon`, `authenticated`, `service_role`) |
| Aplicar | sin errores; las 3 líneas `after` dan `pass: true` |
| Humo (9/9) | anon, ajeno y jugador no organizador rechazados; los rechazos no cambian nada; el organizador cancela como la 1.1.21; el partido queda cancelado; el plantel recibe el aviso; el otro partido no se toca; `service_role` sigue pudiendo |
| Volver a aplicar | no hace nada (el estado no cambia) |
| Rollback | la función queda **idéntica** a la original: oid, md5 del cuerpo, ACL (mismas entradas, mismo orden), dueño, SECURITY DEFINER, argumentos y valores por defecto. La tabla de respaldo y la fila del ledger desaparecen |
| Reaplicar | sin errores; `after` en `pass: true` |
