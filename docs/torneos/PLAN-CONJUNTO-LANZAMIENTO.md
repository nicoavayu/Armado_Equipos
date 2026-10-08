# Plan conjunto de lanzamiento — Torneos conectado (#182), Galería (#189) y Premium (Mercado Pago)

**Estado (2026-10-08 UTC): fase B validada en el laboratorio sobre el árbol integrado `81a39063` (§5.1); falta la
revisión de producto de Nico. No se ejecuta ninguna promoción.** Siguen dos decisiones de Nico:
- **Técnica:** #182 primero; Galería y Premium después, con pasos propios.
- **De producto:** completar y validar Galería y Premium **antes** de autorizar cualquier publicación.

Este plan respeta las dos y termina con los tres frentes funcionando en Production, en Supabase Free.

## 1. Dónde está cada frente

| Frente | Rama / PR | Base | Base de datos Torneos | Gateway | Estado | Falta |
| --- | --- | --- | --- | --- | --- | --- |
| Torneos conectado | PR #182 `938d6ddd` (más commits sólo de documentación) | integración #178–#181 | `0009`–`0011` | 25 archivos | Completo y ensayado (`connected-product/DEPLOY.md`). Mantenimiento de capacidad de Core **hecho en Production** (63,6 MiB, organización al 16 %). Fase B: dos arreglos de Mi plan (§5.1) | Backups de Torneos y Storage (G0a) y GO |
| Galería (MEDIA-V1) | PR #189 borrador `34cd4c25` | #182 `938d6ddd` | `0012` (sha256 `859fa24d…`) | 29 archivos | Miniaturas y presupuesto de Storage en el servidor (450 MiB por proyecto, 400 MiB para fotos y miniaturas, 12 cargas simultáneas). Validada en el laboratorio con bytes medidos (`media-v1/REPORT.md`); `rollback-0012` probado dentro de una transacción revertida (conserva 39 fotos y 78 objetos). Fotos siempre guardadas como JPEG. Driver de operador `db-0012.mjs` (A2) ensayado en el laboratorio | GO |
| Premium (Mercado Pago producción) | PR #190 borrador `7a467827` = **árbol integrado** | #189 `34cd4c25` | `0013` (sha256 `72943492…`; exige `0012` = `859fa24d…`) + driver `db-0013.mjs` + rollback `2365a37c…` | 30 archivos (árbol integrado) + servicio `torneos-payments-production` (Deno Deploy, cron cada 15 min) | Inerte al mergear: sin env, sin app de Deno, interruptor en `off`. Sobre `81a39063`: Jest 3556/3556, commerce 78/78, media 21/21, foundation 109/109, staging guard 259/259, eslint OK. Fase B: compra, pendiente, acreditación y devolución con el emulador (§5.1) | Tope de fotos (A5) y GO |

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

**Orden resultante:** **#182 → Galería → Premium**. Los PRs están apilados: #182 ← #189 ← #190. El head de #190 (`7a467827`) es el árbol integrado de los tres. La fase B se validó sobre `81a39063`; `7a467827` sólo le suma el driver de operador de `0012`, sus tests y su documentación (nada que corra en la app ni en el gateway, y `0012`/`0013` sin cambios). El laboratorio de la revisión ya corre `7a467827`. Cada arreglo de #182 llega a los otros dos por un merge normal en la pila (sin force-push).
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
| Storage | 1 GB | 0,33 GB (fotos de Core) | **Medido** (`media-v1/REPORT.md`): ~246 KB por foto guardada (foto de 1600 px + miniatura). FREE: 25 fotos ≈ 6 MB por temporada llena. PREMIUM: 1000 fotos ≈ 0,25 GB. Logos: ≤ 2 MB cada uno | El presupuesto del servidor ya impide superar la cuota: llegado al tope, se rechazan cargas nuevas (`409 STORAGE_BUDGET_EXCEEDED`, sin bytes escritos). Pero 400 MiB alcanzan para **~1.700 fotos en todo el proyecto**: una sola temporada PREMIUM llena usaría el 60 %. **Lanzar Premium con 200 fotos por temporada** (≈ 49 MB) y alarma al 70 % de Storage. Revisar el tope o el plan cuando haya ventas reales |
| Egress | 5 GB/mes | 0,08 GB | **Medido:** grilla de una galería ≈ 0,2 MB; abrir el visor y pasar a la siguiente ≈ 0,48 MB | Del orden de 10.000 aperturas de grilla o ~20.000 fotos vistas por mes, compartido con Core. Alarma al 60 % |
| Base de datos | 500 MB por proyecto | Core 64 MiB; Torneos 37 MB | ~1–2 KB por foto; ~13 KB por solicitud | Sin acción: `inspect` semanal |
| Pausa por inactividad | 1 semana sin consultas | — | Con Galería y Premium en uso, improbable | Keep-alive opcional, con su propio GO |
| Deno Deploy Free | — | Servicio de TEST y gateway | Servicio de pagos de producción con cron cada 15 min | Confirmar los límites del plan con la sesión de Premium |

**Precio y comisiones:**
- En TEST el producto es ARS 39.900 (lista 49.900), pago único por temporada.
- Nico confirma el precio de producción y cuánto de eso se lleva Mercado Pago.

## 4. Fase A — Completar (sin tocar Production)

| # | Qué | Quién | Termina cuando |
| --- | --- | --- | --- |
| A1 | Galería: miniaturas y presupuesto del servidor; después, validación en el laboratorio (`0012`, modo `MVP_SIMPLE`, carga, revisión, publicación, vistas del participante, retiro), con bytes medidos por foto, por miniatura y por apertura. Además, prueba de que el rollback de `0012` no toca los objetos de `0013` | Sesión de Galería (permiso de Docker ya concedido, sólo para `arma2-promo-rehearsal`) | **Hecho** (`media-v1/REPORT.md`) |
| A2 | Galería: driver de operador `0012` (`POST_0011 → POST_0012`, frase, sha256, estado anterior y posterior, como `db-0009-0011.mjs`) | Sesión de Galería | **Hecho** en #189 `34cd4c25`: `media-v1/remote/db-0012.mjs` (`observe`, `apply-0012`, `rollback-0012` y `mode`, cada uno con su frase) con clasificador de `POST_0011`/`POST_0012` que reconoce `0013` aplicado y vigila lo ajeno (`changedOutside`). Pre-check de `ACTIVATION.md` corregido a la firma de 5 argumentos. Tests offline 7/7 y `test:torneos:media` 28/28. Ensayo real en el laboratorio dentro de una transacción revertida (`POST_0012` → modo apagado → rollback → `POST_0011` con el residuo → apply → `POST_0012`), con `changedOutside` vacío en cada paso y el laboratorio igual a D0 después |
| A3 | Premium: push, PR apilado sobre #189 con los 7 conflictos resueltos, grafo de 30 archivos, B04 regenerado | Sesión de Premium | **Hecho** (#190) |
| A4 | Premium: `0013` certificado desde `POST_0012` (aplicar, revertir y volver a aplicar, byte a byte), driver `POST_0012 → POST_0013` y documentación de activación y rollback | Sesión de Premium | **Hecho** |
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

### 5.1 Resultado (laboratorio `arma2-promo-rehearsal`, 2026-10-07/08 UTC)

Árbol: arrancó en `00f7692a` y terminó en **`81a39063`**; entre los dos sólo cambian frontend, tests y documentos.
Gateway Edge del preview `http://localhost:3121` (`--production-flags --connected --branding --media`, billing de
prueba). Nada salió del laboratorio.

**1–2. Base y gateway.**
- `0013` aplicado sobre `0012`, con backups verificados antes:
  - funciones de `authenticated`: 204 → 206; `anon` sin cambios (16);
  - objetos intactos: 78 de media y 9 de branding.
- Sondas B0–B3 por etapa: iguales salvo los datos.

**3. Recorridos.**

| Frente | Qué se vio |
| --- | --- |
| Galería, organizador | Tope FREE 25 con aviso; el tope pasa a 1000 con Premium y vuelve a 25 al devolverlo. Retirar una foto publicada es inmediato y se deshace con «Restaurar». La foto retirada **sigue contando** (se puede restaurar y sigue guardada); el aviso de tope lleno ya lo dice (`acba4490`) |
| Galería, participante | «Fecha 1 · mobile» con 4 fotos firmadas desde el bucket privado. Visor: flechas 1/4 → 2/4; Escape devuelve el foco a «Abrir galería»; «Original restringido» y «Reportar foto». Con una foto retirada ve 3; restaurada, 4 |
| Premium | Compra con el emulador, en la tabla de abajo. La página de estado le cree al servidor: `/pendiente` → `/exito`; después de la devolución, `/fallo` con «El pago fue reembolsado… no se borró nada». El grant se conserva con sus eventos `granted → revoked`. Al final, «Lab Temporada» quedó FREE, con el aviso de devolución y el botón de pago disponible |
| Mi plan | Con BRANDING, «Logos y escudos» pasa de Próximamente a la comparación como «Incluidos / Incluidos» (`fff76f68`, test en `9f4cdfd2`). Con los tres frentes disponibles, Próximamente desaparece en lugar de anunciar una lista vacía (`938d6ddd`; la Galería suma el caso real) |

Consola del emulador de Mercado Pago (UTC, 2026-10-08):

| # | Hora | Acción | Compra / pago | Resultado |
| --- | --- | --- | --- | --- |
| 1 | 00:26:14 | aprobar | `5385dfe9` / `1791418836748001` | `approved` |
| 2 | 00:27:54 | devolver | la misma | `reversal_applied` |
| 3 | 00:27:54 | reenviar (duplicado) | la misma | `provider_snapshot_duplicate` |
| 4 | 00:29:50 | pendiente | `a8fee852` / `1791418836748004` | `pending` |
| 5 | 00:30:28 | acreditar | la misma | `approved` |
| 6 | 00:31:07 | devolver | la misma | `reversal_applied` |

**4. Contención** (ensayo sobre el Edge del preview, apagando en orden inverso y acumulando; sonda propia de Galería
y commerce, más la sonda de etapas de `DEPLOY.md`):

| Etapa | Qué se apagó | Sonda | Qué ve la persona (frontend todavía encendido) |
| --- | --- | --- | --- |
| D0 | nada | base | — |
| D1 | interruptor de compras `off` | checkout `409`; compras 2 → 2 (no se crea nada); las otras 11 observaciones iguales | «La compra de Premium todavía no está habilitada para esta organización. No se realizó ningún cobro.», sin redirección |
| D2 | + MEDIA | las 4 llamadas de media rechazadas (`403`/`404`); el resto igual | Fotos: «No pudimos cargar las fotos · Reintentar»; el resto del torneo intacto |
| D3 | + BRANDING | contexto y lectura pública de branding `403`; el catálogo público sin logos | El logo cae a las iniciales; no se rompe nada |
| D4 | + CONNECTED | perfil conectado `403` | Explorar: «No pudimos cargar las convocatorias · Reintentar». **El Edge con todo apagado es idéntico a S0 («Production hoy»)**; las únicas diferencias son del gateway Node, que el ensayo no tocó |
| R | todo encendido de nuevo (env idéntico byte a byte, interruptor `open`) | **idéntico a D0** (11/11 y 30/30) | — |

- Rollbacks de base:
  - `rollback-0013`: certificado por la sesión de Premium (`POST_0012 → 0013 → rollback → 0013`, byte a byte);
  - `rollback-0012`: probado por la sesión de Galería dentro de una transacción revertida (`media-v1/REPORT.md`).
- PLAN READ, Social y #182 sin regresiones en ninguna etapa.
- Hallazgo del ensayo: un `TORNEOS_STORAGE_URL` mal formado (fue un error de tipeo del ensayo) deja el gateway entero
  cerrado, con `503` en todas las rutas, incluso `/exchange`. Es el cierre por error de configuración que corresponde,
  pero confirma que en C2 el cambio de env del gateway va a 0 % con tag antes de mover tráfico.

**5. Capacidad:** las cifras medidas están en el §3. El techo práctico es el presupuesto de galerías (~1.700 fotos en
todo el proyecto), y de ahí la recomendación de 200 fotos por temporada para Premium.

**Arreglos durante la fase B** (todos ya en `81a39063`):
- #182 `fff76f68` + `9f4cdfd2`: «Logos y escudos» en Mi plan.
- #182 `938d6ddd`: Próximamente vacío.
- Galería `95d9867d`: fotos siempre como JPEG; un PNG de 1600 px pasa de 2,48 MB a 95 KB. El PNG de 2,4 MB que
  todavía hay en «Fecha 1 · mobile» se cargó antes de ese arreglo.
- Galería `acba4490`: texto del tope lleno.

**Observaciones, sin bloqueo:**
- La barra de secciones del torneo no se desplaza hasta la sección activa. A 1024 px, entrar directo a Fotos deja
  «Fotos» fuera de la vista. Ya pasa en `main`.
- En la ventana gateway-apagado / frontend-encendido:
  - Explorar muestra «0 convocatorias» junto al error y repite el mensaje;
  - Configuración sigue ofreciendo «Cambiar / Quitar» el logo.

  El orden de contención de Production apaga primero el frontend, y eso evita las dos cosas.

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
4. Revisión de producto en el preview (B, punto 6). El preview `http://localhost:3121` corre `81a39063` sobre el
   laboratorio con los tres frentes encendidos. La sesión de #182 abre cada cuenta (no hay correo en el laboratorio):

   | Cuenta | Para ver |
   | --- | --- |
   | `b04-owner@lab.test` | «Lab Liga Conectada»: convocatoria publicada, logos, Estudio Social, Mi plan de «Lab Temporada» (FREE después de la devolución) y compra con el emulador |
   | `b04-captain@lab.test` | Explorar torneos y pedir la inscripción con un equipo de Core |
   | `galeria-owner@lab.test` | «Lab Galería»: Centro Multimedia con el tope FREE lleno (25/25), galería publicada, retirar y restaurar |
   | `galeria-capitan@lab.test` | Participante de «Copa Galería»: Fotos y el visor |

   Lista de verificación:
   - Mi plan dice lo mismo que la Galería permite (25 / 1000) y lo que el Estudio Social entrega.
   - El aviso de tope lleno y lo que pasa al retirar o rechazar una foto.
   - La compra: el botón, la vuelta desde el emulador, «pendiente», «aprobado» y la devolución, con sus textos.
   - Lo que ve el participante: la grilla, el visor y lo que desaparece cuando el organizador retira una foto.
   - Logos y escudos: dónde se cargan y dónde se ven.
   - Desktop y 375 px.
5. GOs separados para C1, C2 y C3.

## 8. Criterios para frenar

- Cualquier `DRIFT`, `*_FAILED` o una restauración no verificada.
- 5xx nuevos, un `bootDisabled` o una regresión en PLAN READ, Social o Core.
- Storage por encima del 70 % o egress por encima del 60 % de la cuota.
- Una compra que no se concilia en 15 minutos.
- Cualquier diferencia entre lo que Mi plan promete y lo que la Galería permite.
