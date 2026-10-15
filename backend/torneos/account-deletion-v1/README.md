# ACCOUNT-DELETION-V1 — el borrado de cuenta llega a Torneos

Diseño, decisiones y matriz por tabla: [`docs/superpowers/specs/2026-10-15-torneos-account-deletion-design.md`](../../../docs/superpowers/specs/2026-10-15-torneos-account-deletion-design.md).

**Estado: preparado y ensayado en laboratorio local con datos ficticios. Nada aplicado en Producción ni en Staging, nada desplegado.**

## Piezas

| Pieza | Archivo | Qué hace |
|---|---|---|
| Migración Torneos 0021 | `backend/torneos/supabase/migrations/00000000000021_account_erasure.sql` | `private.erase_tournament_account(core_user_id, request_id)` (SECURITY DEFINER, sólo `torneos_core_adapter`), `private.account_erasure_label`, registro `private.tournament_account_erasures`. Una transacción, idempotente. |
| Rollback | `rollback/00000000000021_account_erasure.rollback.sql` | Quita lo que agregó 0021. **No restaura datos anonimizados.** Con filas en el registro exige `SET torneos.account_erasure_rollback_force = 'DISCARD ERASURE LEDGER'`. |
| Driver del operador | `remote/db-0021.mjs` (+ `remote/sql-catalog-0021.sql`, `remote/pin-0021.mjs`) | `observe` / `apply-0021` / `rollback-0021` con frase exacta, sha256 del archivo, estado previo y posterior pinneados y «nada más se movió». Mismo transporte que `db-0017` / `db-0020`. **Preparado, no ejecutado.** |
| Gateway | `backend/torneos/supabase/functions/torneos-gateway/account-erasure.ts` (+ `db.ts`, `index.ts`) | `POST /core/v1/account-erasure`, firmado por Core con clave derivada del secreto del contrato; sin Origin, sin bearer, sin CORS. |
| Core | `supabase/functions/_shared/torneosAccountErasure.ts`, `supabase/functions/delete-account/index.ts` | Torneos primero, fail-closed; barrido posterior. Configuración nueva: `TORNEOS_GATEWAY_URL`. |
| Web | `src/pages/AccountDeletionInfoPage.js`, `src/legal/AccountDeletionPanel.jsx`, `src/legal/accountDeletion.js`, textos de `ProfileEditor`, `PrivacyPage`, `TermsPage`, `ServiceCancellationPage`, `TorneosProfilePage` | Pedido por web (email `ELIM-…`), botón con sesión, textos fieles. |

## Pruebas

```sh
npm run test:torneos:account-deletion                 # offline + laboratorio (Docker), ver abajo
node --test scripts/edge-functions/delete-account.test.mjs
CI=true npx react-scripts test --watchAll=false src/__tests__/accountDeletion.test.jsx
# Evidencia: ACCOUNT_DELETION_EVIDENCE=1 → evidence/*.jsonl
# Sobre main + 0020 (sponsors, rama #212): ACCOUNT_DELETION_WITH_0020=<ruta al 00000000000020_premium_sponsors.sql>
```

El laboratorio es el PostgreSQL descartable de `commerce-production/lab/pg-lab.mjs` en su propio contenedor
(`arma2-account-deletion-lab-db-<checkout>`), migrado 0000 → 0019, con la topología de Producción (todo de `postgres`, no
superusuario) y los privilegios por defecto del instalador alojado (también en `private`, peor que el alojado). En un host
con los pools de Docker agotados, crear antes la red `<contenedor>-net` con `--subnet` explícita.

## Despliegue (cada paso con su GO; orden obligatorio)

1. **Torneos 0021:** `node backend/torneos/account-deletion-v1/remote/db-0021.mjs observe` → `PRE_0021` →
   `apply-0021 APPLY TORNEOS 0021 onzpwnqxnvlgsevivngf <sha12>` → `POST_0021`, `changedOutside: []`. Inerte.
   Requisito que el catálogo verifica: las tablas con guardas que la función apaga (`torneos_identity`,
   `tournament_organization_members`, `tournament_match_squad_players`, `tournament_match_operation_players`,
   `tournament_match_availability_responses`) son del instalador (`postgres`).
2. **Gateway:** nueva revisión con `account-erasure.ts`. Inerte hasta que Core firme.
3. **Core:** `TORNEOS_GATEWAY_URL` = URL pública del gateway (la misma que `TORNEOS_GATEWAY_PUBLIC_URL` del gateway) en los
   secretos de funciones de Core; desplegar `delete-account`. Prueba de humo: una cuenta de prueba **creada para eso**
   (nunca una real), con y sin Torneos.
4. **Web.** Junto con 3 o después; nunca antes.

## Recuperación

- **Torneos caído:** Core responde 503 y no borra nada; la persona reintenta. Nada que reparar.
- **Volver atrás:** web → Core (función anterior; `delete-account` vuelve a no tocar Torneos) → gateway (revisión anterior;
  sin la ruta, Core falla cerrado) → rollback 0021 (forzado si hubo erasures). Ningún paso restaura datos anonimizados.
- **Reconciliación manual** (sin cron), si el barrido posterior al borrado Core falló (log `torneos post-deletion sweep not
  confirmed`) o si llegó un pedido por email:
  1. Con el `core_user_id` (pedido por email: soporte lo obtiene en Core después de verificar la titularidad), como el
     instalador en Torneos (dueño de la función; la misma función que llama el gateway):
     `select private.erase_tournament_account('<core_user_id>', gen_random_uuid());`. Nunca con un id que no salga de Core.
  2. `outcome` = `erased` / `already_erased` / `no_identity`: los tres son finales.
  3. Retratos pendientes: `select pending_storage_objects from private.tournament_account_erasures where …` y borrarlos con el
     camino existente del store (`complete_tournament_player_portrait_delete` después de borrar el objeto). Hoy MEDIA está
     apagado y no hay retratos en Producción.
- **Organización archivada que alguien quiere seguir usando:** traspaso manual por soporte (insertar o promover un titular
  y `status = 'active'`, `archived_at = null`), con auditoría; fuera de este PR.

## Lo que este PR no hace

- No borra objetos de Storage ni habilita la purga de fotos (cron prohibido).
- No toca pagos, compras, planes ni el webhook.
- No borra el archivo de la foto de perfil de Core (`jugadores-fotos`): gap conocido (revisión §4 punto 3); los textos lo dicen.
- No revoca tokens de Sign in with Apple (revisión §4 punto 4, a verificar).
