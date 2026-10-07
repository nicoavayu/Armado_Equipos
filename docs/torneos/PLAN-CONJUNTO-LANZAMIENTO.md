# Plan conjunto de lanzamiento — Torneos conectado (#182), Galería (#189) y Premium (Mercado Pago)

**Estado (2026-10-07): plan. No se ejecuta ninguna promoción.** Siguen dos decisiones de Nico:
- **Técnica:** #182 primero; Galería y Premium después, con pasos propios.
- **De producto:** completar y validar Galería y Premium **antes** de autorizar cualquier publicación.

Este plan respeta las dos y termina con los tres frentes funcionando en Production, en Supabase Free.

## 1. Dónde está cada frente

| Frente | Rama / PR | Base | Base de datos Torneos | Gateway | Estado | Falta |
| --- | --- | --- | --- | --- | --- | --- |
| Torneos conectado | PR #182 `672ece4d` | integración #178–#181 | `0009`–`0011` | 25 archivos | Completo y ensayado (`connected-product/DEPLOY.md`). Mantenimiento de capacidad de Core **hecho en Production** (63,6 MiB, organización al 16 %) | Backups de Torneos y Storage (G0a) y GO |
| Galería (MEDIA-V1) | PR #189 borrador `24cf615f` | #182 | `0012` | 29 archivos | Backend, frontend, documentación de activación y rollback, driver de laboratorio. **En curso:** miniaturas y presupuesto de Storage en el servidor (450 MiB por proyecto, 400 MiB para fotos y miniaturas, 12 cargas simultáneas; se ajusta al activar como 1 GB − Core − margen; se controla al pedir cada carga) | Su head final con miniaturas y presupuesto, validación en laboratorio (Nico ya dio permiso de Docker, sólo para este laboratorio), driver de operador `0012`, mediciones de costo |
| Premium (Mercado Pago producción) | rama local `claude/torneos-mercadopago-prod-c369ba` (8 commits, último `85647a57`), sin push ni PR | #182 (pasa a #189) | `0013` + driver `db-0013.mjs` | 26 archivos + servicio `torneos-payments-production` (Deno Deploy, cron de conciliación cada 15 min) | Base, servicio, modo de producción del gateway, compra en Mi plan, rollback de `0013`. Probado `0000 → 0012 → 0013` con el `0012` **anterior** (`24cf615f`): 71 casos y conflictos sólo aditivos | Repetir la prueba y los pins sobre el `0012` final (`824582c4`, sha256 `859fa24d…`), PR apilado sobre #189, `commerce-production/DEPLOY.md` y CI completo |

## 2. Dependencias

**Código:**
- Galería y Premium están apiladas sobre #182, pero no entre sí.
- Combinadas, chocan en 7 archivos (`git merge-tree`, sin escribir nada):
  - los dos tests de pins del grafo del gateway (29 + 26 ⇒ 30 archivos);
  - el audit B04;
  - `torneosTransport.js`, `StagingV1TorneosApp.jsx` y `stagingV1Features.js`.
- `index.ts` del gateway se combina solo.

**Base de datos:**
- `0012` y `0013` no dependen una de otra, pero el orden numérico es `0012 → 0013`.
- Premium certificó `POST_0011 → 0013 → rollback`. Tiene que rehacerlo desde `POST_0012`, porque `0012` cambia 3
  cuerpos, 8 funciones, 8 políticas y un bucket.

**Producto:**
- Premium vende, entre otras cosas, el límite de la Galería: FREE 25 fotos por temporada, PREMIUM 1000.
- Al comprar se emite `torneos:plan-changed` y la Galería toma el límite nuevo.
- Por eso **la Galería tiene que estar publicada antes de que Premium venda**: si no, se vende algo que no se puede
  usar.
- La Galería funciona sin Premium (con 25 fotos).

**Infraestructura:**
- La Galería reutiliza lo que habilita BRANDING de #182: Storage del proyecto Torneos aceptando el token del bridge.
  Eso se prueba en G8 de #182, así que la Galería va después de G8.
- Premium suma tres cosas:
  - el servicio de pagos en Deno Deploy (Free), igual que el de TEST ya certificado;
  - las credenciales de Mercado Pago de producción;
  - su webhook.

**Orden resultante:** **#182 → Galería → Premium**.
- En código hay **una sola integración** de los tres, resuelta una vez y validada como unidad. La sesión de Galería
  está de acuerdo.
- Recomendado: el PR de Premium apilado sobre el head **final** de #189 (con miniaturas y presupuesto).
- Cómo resolver los conflictos: grafo de 30 archivos (25 + 4 de media + 1 de commerce), B04 regenerado, y los
  overlays de transporte, app y features conservando los dos módulos.

## 3. Límites de Free que cambian el producto (decisiones de Nico)

Las cuotas son de **toda la organización**. Si se excede la de base de datos o la de egress, la organización entera
(Arma2 incluido) puede recibir 402.

| Recurso | Cuota Free | Uso hoy | Lo que agrega el lanzamiento | Recomendación |
| --- | --- | --- | --- | --- |
| Storage | 1 GB | 0,33 GB (fotos de Core) | Galería FREE: ~15 MB por temporada llena. **PREMIUM: 0,4–0,7 GB por temporada llena** (1000 fotos). Logos: ≤ 2 MB cada uno | El presupuesto del servidor ya impide superar la cuota: llegado al tope, se rechazan cargas nuevas. Pero Premium vendería «1000 fotos» que pueden no entrar. **Lanzar Premium con 200 fotos por temporada** (≈ 0,06–0,14 GB) y alarma al 70 % de Storage. Revisar el tope o el plan cuando haya ventas reales |
| Egress | 5 GB/mes | 0,08 GB | Sin miniaturas, abrir una galería descargaba ~3–5 MB (~1.000–1.500 aperturas por mes). La Galería suma miniaturas; los bytes reales por apertura (sólo la grilla, y la grilla más la foto ampliada) salen del informe de laboratorio | Alarma al 60 %. Decidir con los números medidos |
| Base de datos | 500 MB por proyecto | Core 64 MiB; Torneos 37 MB | ~1–2 KB por foto; ~13 KB por solicitud | Sin acción: `inspect` semanal |
| Pausa por inactividad | 1 semana sin consultas | — | Con Galería y Premium en uso, improbable | Keep-alive opcional, con su propio GO |
| Deno Deploy Free | — | Servicio de TEST y gateway | Servicio de pagos de producción con cron cada 15 min | Confirmar los límites del plan con la sesión de Premium |

**Precio y comisiones:**
- En TEST el producto es ARS 39.900 (lista 49.900), pago único por temporada.
- Nico confirma el precio de producción y cuánto de eso se lleva Mercado Pago.

## 4. Fase A — Completar (sin tocar Production)

| # | Qué | Quién | Termina cuando |
| --- | --- | --- | --- |
| A1 | Galería: miniaturas y presupuesto del servidor; después, validación en el laboratorio (`0012`, modo `MVP_SIMPLE`, carga, revisión, publicación, vistas del participante, retiro), con bytes medidos por foto, por miniatura y por apertura. Además, prueba de que el rollback de `0012` no toca los objetos de `0013` | Sesión de Galería (permiso de Docker ya concedido, sólo para `arma2-promo-rehearsal`) | Recorrido completo; rollback de `0012` ensayado; costos medidos |
| A2 | Galería: driver de operador `0012` (`POST_0011 → POST_0012`, frase, sha256, estado anterior y posterior, como `db-0009-0011.mjs`) | Sesión de Galería | Tests offline y una corrida en el laboratorio |
| A3 | Premium: push, PR apilado sobre #189 con los 7 conflictos resueltos, grafo de 30 archivos, B04 regenerado | Sesión de Premium | `test:ci` completo en verde |
| A4 | Premium: `0013` certificado desde `POST_0012` (aplicar, revertir y volver a aplicar, byte a byte), driver `POST_0012 → POST_0013` y documentación de activación y rollback | Sesión de Premium | Tests y laboratorio |
| A5 | Tope de fotos de Premium según la decisión del §3. Es un dato de `tournament_plan_catalog`, así que se hace en una migración o en `0013` | Premium y Galería | Mi plan y el límite de carga dicen lo mismo |

## 5. Fase B — Validar los tres juntos (laboratorio y revisión de Nico)

Sobre el árbol integrado (el head del PR de Premium), en el único laboratorio posible: `arma2-promo-rehearsal`, con
puertos fijos `58420`–`58425`.

1. **Base:** `0009 → 0010 → 0011 → 0012 → 0013` con los drivers, verificando el estado después de cada paso.
2. **Gateway Edge con todos los módulos:**
   - flags uno por uno: CONNECTED → BRANDING → MEDIA → COMMERCE (en el laboratorio, el emulador de Mercado Pago con
     forma de producción);
   - sonda por etapa (como S0–S8 de `DEPLOY.md`), comparando con la etapa anterior.
3. **Recorridos, en desktop y a 375 px:**
   - El organizador publica la convocatoria y arma la galería. Sube fotos hasta el tope FREE y ve el aviso.
   - Compra Premium (emulador): estado pendiente, aprobado y conciliado. El tope sube y sube más fotos.
   - El participante ve la galería y el organizador retira una foto.
   - Devolución o contracargo simulado: qué ve cada uno y qué pasa con las fotos ya publicadas. Esto lo decide el
     diseño de Premium; el plan exige que se vea y se documente.
4. **Contención:**
   - flags apagados en orden inverso;
   - rollback de `0013` antes de la primera compra;
   - rollback de `0012`, que conserva las fotos;
   - ninguna regresión en PLAN READ, Social, #182 ni Core.
5. **Capacidad:** con los bytes medidos, proyección del uso de la organización para N temporadas y M aperturas.
6. **Revisión de producto de Nico**, en el preview, con cuentas del laboratorio y una lista de verificación. Termina
   con **su GO de producto** o con una lista de cambios (que vuelven a A).

## 6. Fase C — Publicación (sólo con GO de cada estación, en este orden)

Es un tren con tres estaciones, y cada una termina estable antes de la siguiente. `main` contiene sólo lo que ya está
publicado: cada PR se mergea en su estación, y al final el árbol de `main` es igual al validado en B.

| Estación | Qué | Detalle |
| --- | --- | --- |
| C0 | Backups | Core (backup con restauración verificada del mantenimiento de capacidad); Torneos (base) + Storage de Core y de Torneos, con `ops_free_plan.py` y restauración verificada |
| C1 | **#182** | `connected-product/DEPLOY.md`, G1–G11: merge, Core `20261007`/`20261008` y función, Torneos `0009`–`0011`, gateway sin flags → CONNECTED → frontend → BRANDING (con la prueba de Storage a 0 %) → frontend → datos QA → seguimiento |
| C2 | **Galería** | Merge de #189 → backup de Torneos → `0012` (driver) → modo `MVP_SIMPLE` → imagen del gateway con MEDIA **apagado** → MEDIA a 0 % con tag (carga y lectura con QA1) → 100 % → frontend (`REACT_APP_TORNEOS_MEDIA_MODE` y `_ENABLED`, en un deploy propio) → recorrido QA → alarmas de Storage y egress activas |
| C3 | **Premium** | Merge → backup → `0013` (`db-0013.mjs`) → Deno Deploy `torneos-payments-production` → webhook → modo de commerce del gateway a 0 % con tag → frontend de billing → primera compra real → interruptor en `open` sólo después de revisar la evidencia (detalle abajo) |

**Detalle de C3**, tal como lo definió la sesión de Premium:

1. Backup y `0013` con `db-0013.mjs`.
2. Deploy de `torneos-payments-production` en Deno Deploy. Los secretos de producción los escribe Nico en la terminal
   del operador, sin eco.
3. En Mercado Pago, Nico activa las credenciales de producción y configura los Webhooks en modo productivo:
   - URL: `https://torneos-payments.nicoavayu.deno.net/functions/v1/torneos-payments-production/webhooks/mercadopago/v1`;
   - eventos: Pagos y Contracargos.
4. Gateway en Cloud Run: `TORNEOS_COMMERCE_MODE=production` más la clave HMAC interna en Secret Manager, a 0 % con tag
   y después al 100 %.
5. Vercel: `REACT_APP_TORNEOS_BILLING_MODE=production`.
6. Primera compra real:
   - interruptor en `allowlist`, sólo con la organización de Nico;
   - un pago real al precio de catálogo (ARS 39.900);
   - verificar que se otorga Premium y que llegan el webhook y la conciliación;
   - devolverlo desde el panel de Mercado Pago y verificar que se revoca;
   - interruptor en `off` hasta revisar la evidencia.
7. Recién entonces, `open`.

Contención: la de cada estación, en este orden:
1. frontend;
2. gateway (tráfico a la revisión anterior);
3. modos y flags;
4. el interruptor de compras;
5. SQL sólo como último recurso.

Ninguna estación borra fotos ni compras.

## 7. Lo que necesita Nico (en orden)

1. ~~Dar a la sesión de Galería el permiso de Docker para el laboratorio (A1).~~ Hecho.
2. Decidir el tope de fotos de Premium y las alarmas (§3).
3. Preparar, sólo al momento del GO de C3:
   - en Mercado Pago: credenciales de producción activas, Access Token, webhook secret, seller id y Webhooks en modo
     productivo;
   - el token de organización de Deno Deploy;
   - la contraseña del instalador de Torneos (Keychain), para `db-0013.mjs`;
   - confirmar el precio final (hoy ARS 39.900).
   - Aspectos fiscales y de facturación: fuera del alcance técnico, pero tienen que estar resueltos antes de `open`.
4. Revisión de producto en el preview (B, punto 6).
5. GOs separados para C1, C2 y C3.

## 8. Criterios para frenar

- Cualquier `DRIFT`, `*_FAILED` o una restauración no verificada.
- 5xx nuevos, un `bootDisabled` o una regresión en PLAN READ, Social o Core.
- Storage por encima del 70 % o egress por encima del 60 % de la cuota.
- Una compra que no se concilia en 15 minutos.
- Cualquier diferencia entre lo que Mi plan promete y lo que la Galería permite.
