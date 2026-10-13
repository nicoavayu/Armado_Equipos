# Vuelta atrás de 0013 con el instalador no superusuario

**Estado:** parche aislado, para la revisión de Codex. No se aplicó nada en Producción. 0013 sigue sin aplicar en Producción.

## Causa exacta

En Producción todo esto se leyó con consultas de sólo lectura, el 2026-10-13. El instalador es `postgres`:
- **no** es superusuario;
- tiene CREATEROLE y BYPASSRLS;
- es dueño de las 112 tablas de `public`, del schema `private` y de todas sus funciones.

El servidor es PostgreSQL **17.6**, con `createrole_self_grant = ''`. El único superusuario es `supabase_admin`, el de arranque.

Desde PostgreSQL 16, cuando un rol **no superusuario** crea otro rol, el sistema registra una **membresía implícita del creador** en el rol nuevo:
- ADMIN OPTION sí;
- INHERIT no;
- SET no;
- **otorgada por el superusuario de arranque**.

En Producción ya existe para todos los roles que creó `postgres`: `torneos_payment_service`, `torneos_payments_test`, `torneos_identity_writer`, `torneos_core_adapter` y los dos roles edge.

Cuando 0013 crea `torneos_payment_production_service` como `postgres`, aparece `postgres > torneos_payment_production_service` con `a=true i=false s=false` y otorgante `supabase_admin`. **`postgres` no puede revocarla:** el `REVOKE` no da error pero no hace nada, porque no es el otorgante.

**Antes del parche esto tenía dos efectos** (reproducidos en un laboratorio con la topología de Producción):
1. **La vuelta atrás de 0013 se rechazaba** con «a login still holds torneos_payment_production_service». La precondición contaba cualquier miembro del rol.
2. **El driver `db-0013.mjs` habría marcado `APPLY_0013_FAILED` después de un apply correcto.** Su catálogo listaba a `postgres` en `production_logins`, y `classify` lo trataba como un login ajeno, o sea DRIFT.

Las suites anteriores no lo veían porque aplicaban como `supabase_admin` (superusuario): el superusuario no recibe esa membresía.

## Parche (mínimo, sin tocar el runtime de pagos)

| Archivo | Cambio |
|---|---|
| `rollback/00000000000013_mercadopago_checkout_pro_production.rollback.sql` | La precondición ignora **sólo** la membresía con las cinco condiciones a la vez: miembro `current_user`, ADMIN, sin INHERIT, sin SET y otorgante superusuario. Cualquier otro miembro sigue rechazando: el login de producción, otro rol, u otra concesión al instalador con otras opciones. `DROP ROLE` se la lleva junto con el rol. |
| `remote/sql-catalog.sql` | `production_logins` excluye esa misma membresía. Se expone aparte como `installer_implicit_grant` (booleano). |
| `remote/db-0013.mjs` | Nuevo sha256 del archivo de rollback: `546b7d46…`. |
| `rollback-0013-hosted-installer.test.mjs` (nueva) | Laboratorio con la topología de Producción; todo se aplica como `postgres`. |

**Fuera del cambio:**
- la migración `00000000000013` (sha `72943492…`), el runtime `torneos-payments-production`, el gateway y la web;
- los privilegios de Producción: no hace falta ampliar ninguno, porque `DROP ROLE` lo puede hacer el creador con ADMIN.

## Evidencia (local, 2026-10-13)

- **`rollback-0013-hosted-installer.test.mjs`: 3/3.**
  - **Topología:** `postgres` no superusuario con CREATEROLE, todas las tablas suyas, sin 0013.
  - **Apply, rollback y reapply** por el `run()` del driver, como `postgres`:
    - se observa la membresía implícita exacta;
    - el `REVOKE` no hace nada;
    - el catálogo da `POST_0013`, con `production_logins = []` e `installer_implicit_grant = true`;
    - después del rollback, **catálogo, permisos y datos idénticos** a antes de 0013: funciones (cuerpo, ACL, dueño, definer, config), relaciones, políticas, constraints, triggers, roles, **todas** las membresías, ACL de schemas, privilegios por defecto, ofertas, precios, compras y temporadas;
    - el reapply termina en `APPLY_0013_DONE`.
  - **Rechazos, conservando todo:**
    - otro rol miembro: la membresía se conserva;
    - otra concesión al instalador (INHERIT true);
    - un login con el rol;
    - una compra de producción: la fila se conserva.

    En todos los casos el driver también se rechaza antes de escribir.
- **Ensayo completo del GO 2 con esa topología, como `postgres`:** 0018 → runner (purga inactiva) → 0013 (checkout `off`) → 0019 (20.000), y vuelta 0019 → 0013 → runner → 0018. Todo `DONE` y termina en `PRE_0018+NONE+RUNNER_OFF`. Archivo: `docs/torneos/commercial-season/evidence/go2-rehearsal-as-postgres-20261013.txt`.
- **Suites:** `test:torneos:commerce-production` **98/98** (incluye las 3 nuevas) y `test:torneos:season` **32/32**.

## Después de integrar (con GO)

- Fijar el commit del merge en `~/Arma2Backups/season-204-run.sh` y crear su checkout limpio.
- Actualizar la frase de `rollback-0013`: `ROLLBACK TORNEOS 0013 onzpwnqxnvlgsevivngf 546b7d469653`.
- Recién después: backup (24 h) y GO 2.
