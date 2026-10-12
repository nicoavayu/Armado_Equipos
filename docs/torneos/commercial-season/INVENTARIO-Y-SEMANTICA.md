# Temporada comercial, galería y Mercado Pago — inventario y semántica

- **Fecha y base:** 2026-10-12, sobre `main` 54036f59, con el esquema hasta 0017.
- **Rama:** `claude/torneos-season-commercial-gallery`.
- **Estado:** documento previo a la implementación. **No es una autorización** para cobrar, aplicar migraciones comerciales ni borrar en Producción.

## 0. Reglas aprobadas por Nico (no se reabren)

| Regla | Texto aprobado |
|---|---|
| Precio | «Precio de lanzamiento: ARS 20.000 finales por temporada». Pago único, sin renovación automática. Sin precio anterior tachado, sin fecha de fin de promoción y sin descuento. |
| Plazo | La temporada dura como máximo 6 meses **desde su activación explícita** (no desde que se crea el borrador). Comprar Premium no reinicia ni extiende el plazo. |
| Cupo | FREE 25 fotos por temporada; Premium 100 (reemplaza al cupo de 1000). |
| Almacenamiento | Se guardan sólo la imagen optimizada y la miniatura, de 500 KB como máximo cada una. Un límite global configurable frena las subidas antes de agotar la capacidad, sin contratar servicios ni aumentar gastos. |
| Fin de temporada | Se eliminan fotos y miniaturas. Se conservan resultados, tablas, historial y logos compartidos. |
| Antes del fin | Se avisa 7 días y 1 día antes, con posibilidad de descargar. La fecha y la advertencia se muestran antes de pagar y antes de subir. Un cierre anticipado exige confirmar explícitamente la eliminación. |
| Límites del GO | Activar cobros, aplicar migraciones comerciales o hacer borrado real en Producción requiere otro GO sobre la evidencia. |

## 1. Inventario del estado actual

### 1.1 Temporada (`tournament_seasons`, migración base; ninguna migración posterior la redefine)

**Columnas:**
- `status`: `draft`, `active`, `completed` o `archived`;
- `start_date` y `end_date`: fechas **editables a mano**, que hoy no rigen nada;
- `archived_at`.
- **No existe `activated_at`.** El momento de la activación no queda registrado en ninguna parte: `update_tournament_season` no escribe auditoría.

**Transiciones**, todas en `update_tournament_season(p_status)`:

| Transición | Significado | Condición |
|---|---|---|
| `draft → active` | **activación explícita** | capacidad `seasons.update` |
| `draft → archived` | descartar un borrador | — |
| `active → completed` | **finalizar** la temporada | hoy sin confirmación ni efectos |
| `completed → archived` | archivar | exige que todos los torneos de la temporada estén archivados (`TORNEOS_SEASON_HAS_TOURNAMENTS`) |

### 1.2 Planes, cupo y catálogo

| Objeto | Valor actual | Lo lee… | Cambio necesario |
|---|---|---|---|
| `tournament_plan_catalog` | FREE 25 / PREMIUM **1000** | `resolve_effective_tournament_season_entitlements_at` y el trigger de cupo | PREMIUM → **100** |
| `tournament_commercial_products.public_capabilities` | `media.season_1000` «Hasta 1.000 archivos…» | Mi plan | → `media.season_100` «Hasta 100 fotos por temporada» |
| `tournament_commercial_offers` | `launch` v1: lista **49900**, importe **39900**, «Precio lanzamiento» | el resolver (pricing) y 0013 (checkout y activación) | nueva oferta v2: lista = importe = **20000**, «Precio de lanzamiento». La v1 se cierra con `valid_until`. |
| `tournament_pricing_config` | 49900 / 39900; comentario «Authoritative price: ARS 39,900» | **ninguna función** (heredada) | comentario «heredada, no se lee». Para que ninguna tabla siga anunciando el precio viejo: relajar el CHECK `launch < list` a `<=` y fijar 20000/20000. |

**Unidades:** los importes son **pesos enteros**. `provider.ts` envía `unit_price: purchase.amount`, así que 20000 = ARS 20.000.

**Cupo:** lo controla un trigger sobre las sesiones de subida, con lock por organización y temporada. Cuenta:
- los assets que no están en `rejected`, `revoked` ni `failed`, y no tienen `storage_state = 'storage_purged'`;
- más las sesiones de subida `issued` o `uploaded` vigentes.

Las fotos **retiradas** siguen contando. Las **rechazadas** no.

### 1.3 Fotos y almacenamiento

**Por foto se guardan dos objetos**, ambos en el bucket privado `tournament-media`; no hay original separado:

| Objeto | Límites hoy |
|---|---|
| Imagen | `mvp_simple`: hasta 4 MiB y 1600 px |
| Miniatura `-thumbnail.jpg` | hasta 640 px y 512 KiB |

**Compresión en el navegador** (`mediaImageClient.js`): comprime en varios intentos (calidad y escala) hasta llegar a `maxFileBytes`. Ya vuelve todo a JPEG.

**Validación en el servidor**, que vuelve a calcular el tamaño en dos lugares:
- `torneos-media-store/store.ts`: imagen dentro de MVP_SIMPLE, miniatura de 640 px y 512 KiB como máximo;
- CHECK `tournament_media_assets_mvp_limits_check`.

**Lo que falta:**
- No hay límite global de almacenamiento.
- No hay borrado de assets desde el producto. `storage_state = 'storage_purged'` existe en el esquema, pero nada lo escribe.

**Logos:** viven en otro bucket, `tournament-branding`: organización, escudos de equipo y torneo, compartidos entre temporadas. **La limpieza de temporada nunca toca ese bucket.**

### 1.4 Avisos y tareas programadas

- **Avisos:** `tournament_user_notifications` (0009 y 0016), bandeja dentro de la app, sin push ni correo.
- **Torneos no tiene `pg_cron` ni ningún otro planificador.** La única extensión instalada es `pgcrypto`. Hoy nada corre solo en la base de Torneos.

### 1.5 Mercado Pago

**0013 está preparada y no está aplicada en Producción.** Agrega:
- el entorno `production` en las compras;
- el rol de servicio de producción con 7 RPC;
- aislamiento de entornos por trigger;
- el interruptor `tournament_commerce_production_settings`, que se instala en `off`, y la lista de organizaciones habilitadas;
- el checkout, cuyo precio sale del servidor a partir de la oferta vigente;
- la activación idempotente: un webhook repetido da `idempotentReplay` y otro `payment_id` da `TORNEOS_PAYMENT_CONFLICT`;
- el orden por `date_last_updated`, las reversiones y la reconciliación.

**Función `torneos-payments-production`** (ya escrita):
- webhook con `x-signature` verificada con HMAC, ventana de tiempo y `x-request-id`;
- consulta autoritativa a `GET /v1/payments/{id}`, `/merchant_orders/{id}` y `/v1/chargebacks/{id}`;
- reconciliación por `external_reference`;
- verificación de `unit_price`, moneda e ítem contra la compra.

**Huecos frente a las reglas nuevas:**

| # | Hueco | Efecto |
|---|---|---|
| H-A | `private.activate_production_tournament_purchase` **no mira la temporada** | Un pago aprobado con la temporada completa, archivada o vencida otorgaría Premium igual. |
| H-B | `create_tournament_season_production_checkout_purchase` tampoco la mira | Se podría pagar una temporada cerrada. |
| H-C | `entitlements.js:83-87` exige `launchPrice < listPrice` | Con 20000/20000 la interfaz mostraría «No pudimos consultar el precio». |
| H-D | `PremiumPurchasePanel` muestra «Precio habitual ~~X~~» sólo si `list > launch` | Con valores iguales no lo muestra; queda bien y se conserva así. |
| H-E | `docs/torneos/commerce-production/DEPLOY.md` menciona Vercel 7 veces y 39900 3 veces | La web está en Netlify. Hay que actualizarlo. |

**Compatibilidad de 0013 con 0014–0017:** 0013 fija por md5 la cadena TEST (0000, 0002 y 0003), y ninguno de los 31 objetos que 0013 referencia está redefinido en 0012 ni en 0014–0017 (revisión estática de este documento). Se **comprueba en el laboratorio** aplicando 0013 sobre POST_0017 (paso P2 del plan).

**Valores viejos fijados en pruebas e interfaz** (hallazgo de Codex):
- `commerce-production-db.test.mjs`: :132 (39900/49900) y :406 (1000);
- `gateway-commerce-production.test.mjs:134`;
- `payments-production.test.mjs`: :97 y :132;
- `planComparison.js`: :53, :76 y :81.

## 2. Semántica propuesta

### S1. Activación y plazo
- **Columna nueva `tournament_seasons.activated_at`**, que escribe sólo la transición `draft → active`. No hay ningún RPC que la edite.
- **Vencimiento:** `media_deadline_at = activated_at + interval '6 months'`, calculado en `America/Argentina/Buenos_Aires` para conservar el día local (activada el 15/03 a las 20:00 → vence el 15/09 a las 20:00).
- El vencimiento **no depende** de compras, `start_date` ni `end_date`, que siguen siendo informativas.
- **Temporadas que ya están activas en Producción** no tienen el dato. Se propone fijarles `activated_at` en el momento de aplicar la migración, lo que les da 6 meses completos sin eliminaciones sorpresa.
  - Alternativas descartadas:
    - `created_at`, porque puede dejarlas ya vencidas y borrar al instante;
    - `start_date`, porque es editable y puede no existir.
  - **⚠ Decisión de Nico al dar el GO de la migración.**

### S2. Qué pasa al vencer o finalizar
- **Vencimiento automático:** al llegar `media_deadline_at`, la temporada pasa a `completed` (actor `system`).
- **Cierre anticipado:** el organizador hace `active → completed` antes del vencimiento. Es obligatorio `p_confirm_media_deletion = true`; sin eso, error `TORNEOS_SEASON_MEDIA_DELETION_CONFIRMATION_REQUIRED`.
- **En los dos casos:**
  - las fotos y miniaturas de la temporada quedan marcadas para borrar;
  - se rechazan nuevas subidas;
  - se dejan de firmar lecturas;
  - el borrado físico lo hace el worker (S6).
- **Protección aunque el worker se atrase:** todas las rutas de subida y lectura consideran vencida la temporada cuando `now() >= media_deadline_at`, sin esperar al proceso.
- **Se conservan:** torneos, partidos, resultados, tablas, sanciones, historial, auditoría, compras, logos y escudos. También las filas de los assets como registro, con `storage_state = 'storage_purged'`.

### S3. Archivar no es finalizar
- **Archivar una galería** cierra su ciclo y no borra nada (comportamiento actual, que se mantiene).
- **Archivar un torneo** no borra fotos.
- **Archivar una temporada** sólo es posible desde `completed`, así que sus fotos ya fueron eliminadas.
- La eliminación la dispara únicamente S2.

### S4. Compra Premium y plazo
- **Se puede comprar** si la temporada está en `draft`, o en `active` antes de su vencimiento. Se rechaza en `completed`, `archived` o vencida, con `TORNEOS_SEASON_NOT_PURCHASABLE`.
- **La compra no cambia** `activated_at` ni `media_deadline_at`.
- **Pago aprobado tarde** (temporada no comprable al momento de activar):
  - no se otorga Premium;
  - la compra queda `approved` con `activation_error_code = 'season_closed'`;
  - se registra un evento `payment.approved_season_closed` y una auditoría;
  - el pago queda para **devolución por el operador**: reembolso manual desde el panel de MP en la v1, sin automatizar escrituras hacia MP.
  - Mi plan muestra «Recibimos tu pago fuera de plazo; lo vamos a devolver».
- **Webhook repetido:** se mantiene el `idempotentReplay` de 0013, sin doble grant ni doble evento.
- **Concurrencia:** `FOR UPDATE` sobre la compra y la temporada. Una activación y un cierre de temporada simultáneos se ordenan por el lock de la temporada.
- **Acceso eterno:** el grant tiene el alcance de la temporada. Al completarse ésta no queda nada que habilitar, y no hay forma de mover el grant a otra temporada.

### S5. Avisos y descarga
- **Avisos `season.media_deletion_7d` y `season.media_deletion_1d`**:
  - destinatarios: dueños y miembros de la organización con `billing.manage` o `media.review`;
  - uno por destinatario y por tipo (clave única), así que reintentar no duplica.
  - Sólo se envían si la temporada tiene fotos sin purgar.
- **Fecha visible** («Las fotos se eliminan el …») en:
  - el panel de compra de Mi plan, antes de pagar;
  - Multimedia, antes de subir;
  - la confirmación de cierre anticipado.
- **Descarga:** un enlace «Descargar» por foto en Multimedia (URL firmada con `download`). Un ZIP con todas sería una funcionalidad nueva, fuera de alcance; se propone como mejora.

### S6. Limpieza (worker)
- **RPC de servicio** que reclama lotes idempotentes de assets de temporadas vencidas o completadas: `pending → purging → storage_purged`.
- Borra en `torneos-media-store` imagen y miniatura (ruta DELETE con HMAC).
- **Reintentable:** en un objeto que ya no está, el 404 `NOT_REMOVED` cuenta como purgado (#203); un 5xx o una caída deja el lote para el siguiente intento.
- **Objetos huérfanos:** un barrido compara el bucket con las filas y borra sólo objetos de temporadas cerradas cuya ruta corresponde a un asset purgado o inexistente. **Nunca** toca `tournament-branding`.
- **Planificador, ⚠ decisión de infraestructura para el GO:**
  1. `pg_cron` en Torneos, que es gratis y lo soporta Supabase, para avisos y marcado. El borrado físico necesita llamar a la función: con `pg_net`, o con
  2. un Cloud Scheduler hacia una ruta interna del gateway (dentro del plan gratuito de 3 jobs). Hay que confirmar cuántos jobs hay hoy.
  - Mientras tanto, **un driver de operador** sirve para el laboratorio y para correr a mano.
  - El código queda independiente del planificador que se elija.

### S7. Límite de tamaño y límite global
- **Por imagen:**
  - el cliente usa `maxFileBytes = 500000` para imagen y miniatura;
  - en el servidor, `store.ts` rechaza más de 500000 bytes;
  - un trigger exige el mismo tope en los inserts nuevos, sin tocar filas ya existentes (se agrega en lugar de cambiar el CHECK, para no invalidar datos);
  - las dimensiones siguen en 1600 px y 640 px.
- **Límite global:** tabla singleton `tournament_media_storage_budget (limit_bytes, reserve_per_session_bytes)`.
  - Valor inicial propuesto: 800 MB, frente al 1 GB del plan gratuito, a confirmar en el GO.
  - Al crear una sesión de subida se valida `uso + reservas + 1.000.000 ≤ limit_bytes`. Si no alcanza, error `TORNEOS_MEDIA_STORAGE_FULL`, con texto «El almacenamiento de fotos está lleno por ahora».
  - **Sólo el operador lo cambia**, con un rol de servicio. No hay RPC para clientes.
  - Nunca contrata ni amplía nada.

## 3. Migraciones nuevas (sin editar las aplicadas)

| Migración | Requiere | Contenido | Vuelta atrás |
|---|---|---|---|
| **0018** temporada y galería | POST_0017. **No requiere 0013.** | <ul><li>`activated_at` (con el backfill de S1) y `media_deadline_at`</li><li>nuevo `update_tournament_season` (confirmación de borrado, `activated_at`)</li><li>guardas de subida y lectura por vencimiento</li><li>PREMIUM 100 y su capability</li><li>tope de 500000 en inserts</li><li>límite global</li><li>avisos 7d/1d</li><li>RPC de servicio de limpieza</li><li>comentario y valores de `pricing_config`</li></ul> | restaura funciones, catálogo y constraints. **No recupera fotos borradas**: lo dice explícitamente y lo deja registrado. |
| **0019** comercio | 0013 y 0018 | <ul><li>oferta v2 de 20000 «Precio de lanzamiento» y cierre de la v1</li><li>guardas S4 en el checkout y en `activate_production_tournament_purchase`</li><li>`season_closed`</li><li>proyección para Mi plan</li></ul> | vuelve a la v1 de 0013. Los grants ya otorgados y los pagos no se tocan. |

**Orden en Producción**, cada paso con su propio GO: 0018 → (0013 → 0019, sólo cuando se decida activar pagos). Las funciones se despliegan después de su migración, y la web después de ambas.

## 4. Ensayo en laboratorio (antes de pedir GO)

| Paso | Qué |
|---|---|
| P1 | 0018 sobre POST_0017, aplicada y vuelta atrás, con estado igual al de Producción (205/16). |
| P2 | 0013 sobre POST_0018 y 0019, con sus pruebas de comercio actualizadas. |
| P3 | Reloj controlado (`p_as_of` / now fijado en el laboratorio): activación → T-7d → T-1d → vencimiento → limpieza. Avisos únicos. |
| P4 | Cupos concurrentes: 100 en Premium y 25 en FREE con subidas en paralelo; ninguna sesión pasa del límite. |
| P5 | Imágenes reales comprimidas por debajo de 500 KB; una de 600 KB rechazada en el servidor. |
| P6 | Limpieza idempotente: dos workers en paralelo, un 5xx de Storage a mitad de lote, reintento, huérfanos, logos intactos. |
| P7 | Límite global: lleno, rechazo, se libera lugar y vuelve a aceptar. |
| P8 | Autorización: un ajeno u otra organización no pueden cerrar temporada, leer fotos vencidas ni disparar la limpieza. |
| P9 | Pagos con el stub de MP: aprobado, rechazado, pendiente, webhook repetido, pago aprobado después del vencimiento, compra en temporada cerrada, reembolso y chargeback, reconciliación. |
| P10 | Sandbox real de MP (credenciales TEST): una compra de punta a punta. **Necesita a Nico para el acceso a MP.** |

## 5. Textos visibles (coordinados con «Rediseño UX Armados y Torneos»)

- **Precio:** «Precio de lanzamiento: ARS 20.000 finales por temporada». Pago único, no se renueva.
- **Plazo:** «La temporada dura hasta 6 meses desde que la activás. Comprar Premium no cambia esa fecha.»
- **Fotos:** «FREE: 25 fotos · Premium: 100 fotos por temporada». «Las fotos y miniaturas se eliminan al finalizar la temporada (fecha). Los resultados, tablas e historial se conservan.»
- Nada de esto se publica antes de que la regla esté implementada.

## 6. Decisiones abiertas

| # | Decisión | Quién |
|---|---|---|
| A1 | Backfill de `activated_at` para temporadas activas: el momento de aplicar la migración (recomendado) | Nico, en el GO de 0018 |
| A2 | Planificador: `pg_cron` + `pg_net`, o Cloud Scheduler | Nico, en el GO (es infraestructura) |
| A3 | Límite global inicial (propuesta 800 MB) | Nico, en el GO |
| A4 | Devolución de pagos tardíos: manual desde MP en la v1 | Codex revisa; Nico confirma |
| A5 | Descarga por foto (sin ZIP) como cumplimiento de «posibilidad de descargar» | Codex y Nico |
