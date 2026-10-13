# Publicación y recuperación de #204 (temporada comercial)

**Candidato definitivo:** el head de #204 que trae este archivo. Su CI está en `HANDOFF-CODEX.md`.

**Qué se probó y qué cambió después:**
- P10 pasó contra el sandbox real de Mercado Pago sobre **45ea110a** (`P10_PASS`, `certifies: true`).
- Después de 45ea110a sólo cambió esto:
  - la web: el reintento compatible al completar una temporada (§3);
  - documentos y evidencia.
- No cambió nada de lo que P10 ejercita: base 0000→0019, runtime de pagos y fetcher.

**Este documento no autoriza nada.** Cada bloque marcado **GO** necesita su GO concreto.

**Fuera de este plan:**
- migraciones comerciales, cobros y borrado real (§5–§7);
- tocar el cron de Core.

**Hasta esos GO, se mantiene:**
- checkout apagado: 0013 no está en Producción, así que no existe checkout;
- runner con la purga inactiva;
- la web sin flag de billing, que no muestra precio ni compra;
- la UX en «Próximamente».

## 0. Credenciales mínimas, por paso

Nada se pasa por chat. Lo que se pide, se pide oculto en la terminal.

| Paso | Qué hace falta | De dónde |
|---|---|---|
| Función (#203 y #204) | Token **temporal** de Supabase con estos permisos: Project Settings Read, Edge Functions Read+Write, Edge Function Secrets Read. Se revoca al terminar. | supabase.com → Account → Access Tokens |
| Gateway (imagen en Cloud Run) | La sesión `gcloud` del dueño, que ya existe en esta Mac | — |
| Web (Netlify) | Push a la rama `netlify-production`. No hay token nuevo. | git |
| Backup y drivers de base | Contraseña del instalador de Torneos (Keychain `arma2-torneos-dataplane-db/postgres`) y passphrase del backup | Keychain y prompt oculto |
| **Mercado Pago** | **Nada hasta el GO de pagos (§6).** En ese GO: Access Token de **producción** de la app, clave secreta del webhook (modo productivo) y seller id; la URL del webhook se carga en el panel productivo. | Tus integraciones → la app → Credenciales de producción / Webhooks |

## 1. Prerrequisito: publicar #203 (ya aprobado por Nico)

#203 está mergeado (54036f59) y #204 lo contiene.

| # | Paso | Quién | Recuperación |
|---|---|---|---|
| 1 | **Función** `torneos-media-store`, artefacto `1290d3c3…`: `~/Arma2Backups/stab-203-run.sh function` | **Nico** (token de Supabase, §0) | `stab-203-run.sh function-rollback` → `694907f4…` |
| 2 | **Gateway:** imagen desde 54036f59, en una revisión con tag sin tráfico; se verifica y se pasa al 100 % | Claude/Codex | Volver al 100 % en `00025-naw` |
| 3 | **Web:** `netlify-production` → 54036f59 | Claude/Codex | Deploy `6accedce` |

**El orden es función → gateway → web.** El gateway nuevo lee el 404 `NOT_REMOVED` de la función nueva.

**Al terminar se anotan** la revisión del gateway y el deploy de Netlify: son los puntos de vuelta de §4.

**Estado (2026-10-13):**
- **Función hecha:** Nico la desplegó a las 18:24Z, con un token temporal restringido a Torneos.
  - `REDEPLOY_DONE`, artefacto `1290d3c3…`, `torneos-media-store` ACTIVE de v1 a v2.
  - La prueba sin firma devuelve 401 y el proyecto está `ACTIVE_HEALTHY` (sa-east-1).
  - El 403 de `api_keys` corresponde al permiso mínimo del token.
  - Evidencia: `~/Arma2Backups/stab203-20261013T182428Z-function.json`, sin token.
- **Gateway y web: preparados, sin ejecutar.** El clasificador de modo automático de Claude rechazó preparar la build de la imagen de Producción, así que los ejecuta un humano con `~/Arma2Backups/stab-203-gateway-web.sh`:
  1. `build`: Cloud Build con la misma mecánica que la imagen viva `main-c8678c54` (build f2b4be82). Son 32 archivos y sólo cambia `media-store-client.ts`. Imprime el digest.
  2. `tag <digest>`: revisión nueva al 0 % con tag `g11stab203`, la misma configuración que `00025-naw` (sólo cambia la imagen). Prueba el tag y la revisión viva sin autenticación; las dos líneas tienen que decir `OK`.
  3. `promote <revisión>`: 100 % y prueba el host público.
  4. `web`: fast-forward de `netlify-production` a 54036f59; espera hasta que cambie el bundle (hoy `main.64cfbb6d.js`).
- **Recuperación:**
  - gateway: `stab-203-gateway-web.sh rollback`, que vuelve a `00025-naw`;
  - web: Netlify → Deploys → `6accedce…` → Publish deploy;
  - función: `stab-203-run.sh function-rollback`.
- **Pruebas sin autenticación de la revisión viva** (host público, prefijo `/functions/v1/torneos-gateway`): `200 200 200 401 401 401 404`. Un 503 aislado de `/health` en el minuto :30 pasó al reintentar.
- **Para la vuelta atrás de #204:** al terminar, la revisión nueva del gateway y el deploy nuevo de Netlify se anotan acá. Pasan a ser los puntos de vuelta de §4.

## 2. GO: merge de #204

**Antes del merge:** revisión de Codex y aprobación de Nico.

**Después del merge, Claude:**
- crea `~/Downloads/arma2/arma2-season-204` limpio en el commit del merge;
- fija ese commit en `~/Arma2Backups/season-204-run.sh`. Hasta entonces el script dice `STOP … PENDING_MERGE`.

## 3. Backup nuevo (sólo lectura en Producción)

```bash
~/Arma2Backups/season-204-run.sh backup
```

- Hace `backup-db` y `restore-check` de Torneos, igual que el backup post-0017.
- Termina en `PRE-204 TORNEOS BACKUP VERIFIED`.
- Sirve **24 h** como requisito de cada migración: el script lo verifica antes de `apply-0018`, `apply-0013` y `apply-0019`.

## 4. GO: código de #204, sin migraciones

**Orden: web → función → gateway.** Es distinto de #203 porque **los topes bajan de 4 MB a 500 KB** en la función, el gateway y (con 0018) la base. La web nueva genera fotos de 500 KB como máximo, y el servidor viejo también las acepta. Al revés, una web vieja con una foto de 1 a 4 MB chocaría con el servidor nuevo.

| # | Paso | Quién | Recuperación |
|---|---|---|---|
| 1 | **Web:** `netlify-production` → merge de #204 | Claude/Codex | El deploy de §1.3 |
| 2 | **Función:** `season-204-run.sh deploy-function`, artefacto `b8f2f8a9…`, **sin** secreto de purga, así que `media-purge` responde 404 | **Nico** (token de Supabase) | `season-204-run.sh function-rollback`, que vuelve a `1290d3c3…` (#203) |
| 3 | **Gateway:** imagen del merge; tag, verificación y 100 % | Claude/Codex | La revisión de §1.2 |

**Compatibilidad verificada mientras la base no tiene 0018:**
- **Vigencia:** sin `seasonLifecycle` en las respuestas, la web no muestra vigencia ni textos de borrado.
- **Precio:** sin flag de billing no hay panel de compra ni precio. Se ve «La compra de Premium todavía no está disponible».
- **Completar temporada:** la web manda `p_confirm_media_deletion`.
  - Sin 0018, PostgREST responde PGRST202 (no existe esa firma), el gateway lo pasa tal cual y la web reintenta **una vez** sin el parámetro, como la web actual. Sin 0018 no se borra nada al terminar.
  - Con 0018 ese error no puede ocurrir, y cualquier otro rechazo se mantiene.
  - Prueba: `torneosSeasonCompleteCompat.test.js`, 4/4.
- **Purga:** la función sin `TORNEOS_MEDIA_PURGE_SECRET` no tiene ruta de purga, y el resto funciona igual.

**Ventana conocida.** Entre el paso 1 y el 2, una pestaña que quedó abierta con la web vieja sube con el tope viejo, y el servidor viejo lo acepta. Después del paso 2 esa pestaña recibe «foto muy grande» hasta recargar. No se pierde nada.

## 5. GO por migración (cada una con su frase; el script lo controla)

| # | Comando | Efecto | Recuperación |
|---|---|---|---|
| a | `season-204-run.sh apply-0018` | Temporadas existentes: 6 meses desde ahora, con aviso de vencimiento. Topes de 25/100 fotos y 500 KB en la base. Avisos 7d/1d. **No borra nada:** la purga no existe todavía. | `rollback-0018`: no recupera fotos purgadas (hasta §7 no hay ninguna). Reaplicarlo reinicia los 6 meses. |
| b | `season-204-run.sh apply-runner` | Habilita pg_cron y pg_net en el proyecto. Job de ciclo de vida activo en :03/:18/:33/:48 (cierra temporadas vencidas, avisa, marca fotos). Purga **inactiva**. | `rollback-runner`, sólo con la purga apagada |
| c | `season-204-run.sh apply-0013` | Objetos de pagos de producción. El checkout queda `off` por defecto. Sin login de pagos. | `rollback-0013`, sólo sin compras de producción |
| d | `season-204-run.sh apply-0019` | Precio de lanzamiento 20.000, sin precio tachado. El driver **exige el checkout en `off`**. | `rollback-0019`, también con checkout `off` |

**Orden de vuelta:** 0019 → (`disable-purge`) → runner → 0013 → 0018.

**Evidencia:** cada paso deja `s204-<ts>-<paso>.json` en `~/Arma2Backups`, con el estado antes y después y `changedOutside` vacío.

## 6. GO de pagos (posterior y separado)

Sigue `docs/torneos/commerce-production/DEPLOY.md` §4 y §6. En resumen:
1. Login de pagos: la contraseña la genera la Keychain.
2. Función `torneos-payments-production` con las credenciales MP de producción (§0).
3. Configuración de commerce en el gateway.
4. Flag de billing en la web.
5. Checkout `allowlist` → primer cobro real → `open`.

**UX** pasa de «Próximamente» a la compra recién en ese GO.

**Apagar:** `db-0013.mjs scope off`, que preserva las compras y el historial (DEPLOY.md §9).

## 7. GO de borrado real (posterior y separado)

1. Secretos en Vault (`torneos_media_purge_secret`, `torneos_media_store_purge_url`), cargados por el operador desde la TTY.
2. La función con `TORNEOS_MEDIA_PURGE_SECRET`.
   - `deploy-media-store` **todavía no** carga ese secreto: la herramienta se prepara para ese GO.
3. `db-season.mjs enable-purge`, frase `ENABLE TORNEOS PURGE onzpwnqxnvlgsevivngf cc1385d6b36d`.

**Apagar:** `season-204-run.sh disable-purge`. **Las fotos ya borradas no se recuperan.**

## GO concreto para #204 (a pedir cuando #203 esté entero)

1. **GO merge #204.**
   - Requisitos: #203 publicado (función, gateway y web); este PR con CI verde; P10 `P10_PASS` (ya está).
   - Después, Claude fija el commit del merge en `season-204-run.sh` y prepara el script de gateway y web de #204, derivado de `stab-203-gateway-web.sh`: mismo grafo y misma mecánica, con tag `main-<merge>`.
2. **GO código #204** (sin migraciones). Orden web → función → gateway (§4).
   - La función pide **un** token temporal de Supabase con los permisos de §0.
3. **GO por migración:** 0018 → runner → 0013 → 0019 (§5), cada uno con su frase y con el backup de §3.
4. **Pagos (§6) y borrado real (§7):** GO separados y posteriores.

## Próximo comando humano indispensable

Gateway de #203, en este orden. La sesión `gcloud` del dueño ya está abierta y no hace falta ningún token.

```
~/Arma2Backups/stab-203-gateway-web.sh build
~/Arma2Backups/stab-203-gateway-web.sh tag <digest que imprime build>
~/Arma2Backups/stab-203-gateway-web.sh promote <revisión que imprime tag>
~/Arma2Backups/stab-203-gateway-web.sh web
```
