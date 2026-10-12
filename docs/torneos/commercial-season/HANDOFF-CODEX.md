# Handoff a Codex: temporada comercial, galería y Mercado Pago (2026-10-12)

**No hay notificación directa a Codex.** Este archivo y la sesión de Claude «Arma2 Torneos como producto conectado» son el canal.

## Dónde está

| Qué | Dónde |
|---|---|
| Rama | `claude/torneos-season-commercial-gallery`, base `main` 54036f59 (incluye #203). Subida, **sin PR**. |
| Head | Ver `git log` de la rama; el último commit de este handoff lo actualiza. |
| Inventario y semántica | `docs/torneos/commercial-season/INVENTARIO-Y-SEMANTICA.md` |
| Planificador y almacenamiento | `docs/torneos/commercial-season/EVALUACION-PLANIFICADOR-Y-ALMACENAMIENTO.md` |
| Runbook de Mercado Pago | `docs/torneos/commerce-production/DEPLOY.md` (Netlify, 20.000, orden 0018 → 0013 → 0019) |

## Qué contiene (todo preparado, nada publicado ni aplicado)

### 0018: ciclo de vida de la temporada y sus fotos

- Archivo: `backend/torneos/supabase/migrations/00000000000018_season_media_lifecycle.sql`
- Vuelta atrás: `backend/torneos/season-lifecycle/rollback/`
- No depende de pagos.

**Activación y plazo:**
- Columnas `activated_at`, `media_deadline_at` (6 meses en calendario de Buenos Aires) y `activation_basis`.
- Las temporadas existentes que no son borrador reciben 6 meses desde la migración (decisión de Nico).

**Cierre:**
- `update_tournament_season` suma `p_confirm_media_deletion`: cerrar antes de tiempo exige confirmación.
- Al completar o archivar una temporada, sus fotos quedan marcadas para borrar.

**Lecturas, subidas y límites:**
- Subidas y lecturas firmadas se cortan si la temporada está cerrada o vencida, aunque ningún job haya corrido.
- Premium tiene 100 fotos.
- La sesión de subida acepta como máximo 500.000 bytes.

**Avisos:** a 7 días y a 1 día del vencimiento. Uno por torneo con fotos y por revisor, sin repetirse.

**RPC de servicio:**
- `run_tournament_season_media_lifecycle`;
- `claim_tournament_media_purge` / `complete_tournament_media_purge`: lease de 5 minutos, huérfanos, nunca el bucket de logos.

**Límite global:** se reutiliza el de 0012 (`tournament_media_storage_budget`). No hay un límite nuevo.

**Fijación:** cada cuerpo reemplazado se fija por md5 antes y después. La vuelta atrás se genera desde los cuerpos exactos anteriores y **no promete recuperar fotos borradas**.

### 0019: comercio de temporada (después de 0013 y 0018)

**Oferta:**
- `launch` v2, 20000/20000, «Precio de lanzamiento»; la v1 queda cerrada.
- `pricing_config` alineado.
- Se puede volver a aplicar después de su propia vuelta atrás.

**Checkout:** rechaza una temporada cerrada con `TORNEOS_SEASON_NOT_PURCHASABLE`.

**Activación:**
- Un pago aprobado tarde queda `approved` + `season_closed`.
- Sin grant, con un evento y una auditoría, y con devolución manual.
- Un webhook repetido no cambia nada; otro pago es un `TORNEOS_PAYMENT_CONFLICT`.

**Mi plan:** `get_tournament_season_purchases` proyecta `activationErrorCode` y pone `checkoutAvailable` en false si la temporada está cerrada.

### Función `torneos-media-store`

- Operación nueva `media-purge`, con su propio secreto `TORNEOS_MEDIA_PURGE_SECRET`.
  - Tiene que ser distinto del secreto del gateway; si falta, la ruta no existe.
- Tope de 500.000 bytes para la foto y la miniatura.
- Artefacto `dac25c2d…`.
- **#203 en `main` lleva otro artefacto, 1290d3c3.** Esta rama necesitará su propio `redeploy` cuando se publique.

### Web

- Mi plan:
  - «ARS finales · por temporada», fecha de vencimiento antes de pagar y regla de fotos;
  - no se ofrece comprar una temporada cerrada;
  - estado «pago fuera de plazo».
- Multimedia: fecha antes de subir, «Descargar» por foto y estado de temporada cerrada.
- Temporada: confirmación al activar y al cerrar antes de tiempo.
- Bandeja de avisos: los avisos de borrado llevan a Multimedia.
- Comparación de planes: 25 / 100.
- Tope de 500 KB en la compresión del navegador.

### Hallazgos de la revisión de Codex, atendidos

| Archivo | Cambio |
|---|---|
| `commerce-production-db.test.mjs` | :132 → 20000/20000 (v2); :406 → 100; casos nuevos de temporada cerrada, pago tardío, webhook repetido, otro pago y compra que no extiende el plazo |
| `gateway-commerce-production.test.mjs` | :134 → 20000 |
| `payments-production.test.mjs` | :97 y :132 → 20000 |
| `planComparison.js` | 100 fotos, atado al catálogo como lo dejan las migraciones |

## Pruebas

**Pasan:**
- Jest 3722/3722;
- frontend-foundation 109/109 (auditoría B04 regenerada: se movió una línea);
- media-store 21/21, media 36/36, branding 18/18;
- payments-production 9/9.

**Pendientes porque Docker Desktop está cerrado en la Mac** (no lo abro yo; es compartido):
- `backend/torneos/season-lifecycle/season-lifecycle-db.test.mjs` (P1 y P3–P8 sobre Postgres real);
- `commerce-production-db.test.mjs` y `gateway-commerce-production.test.mjs` con 0018 y 0019;
- P2: 0013 sobre 0018 y 0019.

**Consecuencias:**
- Los md5 que fijan 0018 y 0019 se calcularon sin base de datos, a partir de los archivos. El método se validó contra el md5 que fija 0007; falta confirmarlos en el laboratorio.
- **No se aplicó 0018 ni 0019 en ningún Postgres todavía.**

## Pedidos de revisión

1. **Semántica y decisiones:** S1–S7 y A1–A5 del inventario.
2. **SQL de 0018 y 0019:** concurrencia (locks de temporada `FOR UPDATE` / `FOR SHARE`), idempotencia de la limpieza y de los avisos, condiciones previas y posteriores, vueltas atrás.
3. **Firma del webhook de MP.** La página oficial actual no muestra la plantilla del manifest en texto: la pestaña «Sin SDKs» no se renderiza al leerla.
   - La implementación de `torneos-payments/webhook-signature.ts` ya validó webhooks reales de TEST (`PAYMENTS_REMOTE_TEST_CERTIFIED`, 2026-09-26).
   - Pido confirmarla contra el SDK oficial: plantilla `id:…;request-id:…;ts:…;`, normalización de `data.id` y tolerancia de `ts`.
4. **Orden de vuelta atrás:** primero 0019, después 0013. El driver de 0013 aplica sólo desde `PRE_0013`, así que nunca reaplica sobre 0019.
5. **Netlify:** confirmar que el plan gratuito permite uso comercial (D1 del runbook).

## Pendientes y bloqueos

| Qué | Estado |
|---|---|
| **Docker Desktop** | Cerrado. Bloquea todos los ensayos P1–P9. Necesita que Nico lo abra. |
| **Publicación de #203** | Preparada (`~/Arma2Backups/stab-203-run.sh function`). Espera el token temporal de Supabase de Nico. Después siguen el gateway y la web. |
| **Drivers de operador para 0018 y 0019** | Con estados, frase y hash, como `db-0015-0016.mjs`. Se escriben después del ensayo P1. |
| **Sandbox real de MP (P10)** | Necesita el acceso de Nico al panel de Mercado Pago. |
| **Texto «Precio de lanzamiento»** | La sesión de Rediseño UX tenía una nota anterior de Nico que decía que no hay precio de lanzamiento. Se lo consulto a Nico; el sitio público no cambia hasta que lo confirme. |
| **Nada en Producción** | Ninguna migración, cobro, borrado ni cambio de flags. Premium y pagos siguen apagados. |
