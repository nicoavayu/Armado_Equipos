# Planificador y límite de almacenamiento: costos y margen (2026-10-12)

Pedido de Nico: evaluar el planificador y el límite de almacenamiento, con costos y margen disponible, **antes** de fijarlos. Nada de esto está aplicado ni contratado.

## Datos de partida

| Dato | Valor | Fuente |
|---|---|---|
| Plan gratuito de Supabase | 1 GB de archivos; 5 GB de egress más 5 GB de egress cacheado; 500.000 invocaciones de Edge Functions; 500 MB de base por proyecto; 2 proyectos activos | [supabase.com/pricing](https://supabase.com/pricing) |
| Ámbito del 1 GB de archivos | Se cuenta para **toda la organización** (Core y Torneos juntos). La página de precios no lo dice; lo afirma la nota de 0012, medida el 2026-10-07. | `00000000000012_media_gallery_v1.sql` |
| Storage de Core | ~0,33 GB, medido el 2026-10-07 | nota de 0012 |
| Presupuesto actual de Torneos (0012) | proyecto 450 MiB, fotos y miniaturas 400 MiB, 12 subidas en vuelo | `tournament_media_storage_budget` |
| Cloud Scheduler | 3 jobs gratis por mes **por cuenta de facturación**, después USD 0,10 por job y por mes. Un job pausado también cuenta; las ejecuciones no se cobran. | [cloud.google.com/scheduler/pricing](https://cloud.google.com/scheduler/pricing) |
| pg_cron en Supabase | Es el motor de Supabase Cron. Funciona en el plan gratuito: Core, en la misma organización gratuita, ya corre sus jobs con pg_cron. Supabase recomienda no más de 8 jobs concurrentes, de hasta 10 minutos cada uno. | [supabase.com/docs/guides/cron](https://supabase.com/docs/guides/cron) |

**No medido hoy.** El control automático no me deja leer Producción. El uso real actual de Storage de la organización (Core y Torneos) se mide con el observe del driver al dar el GO; la lectura la corre Nico.

## Almacenamiento

**Lo que ocupa una foto con el tope de 500 KB:**

| Caso | Imagen | Miniatura | Total |
|---|---|---|---|
| Peor caso | 0,5 MB | 0,5 MB | 1,0 MB |
| Típico (laboratorio, 1200–1600 px) | 0,3 MB | 0,05 MB | 0,35 MB |

**Lo que ocupa una temporada llena:**

| Plan | Peor caso | Típico |
|---|---|---|
| FREE (25 fotos) | 25 MB | ~9 MB |
| Premium (100 fotos) | 100 MB | ~35 MB |

**Cuántas temporadas llenas entran a la vez en los 400 MiB actuales para fotos:**

| Plan | Peor caso | Típico |
|---|---|---|
| FREE | 16 | ~45 |
| Premium | 4 | ~11 |

**Margen de la organización:** 1 GB − 0,33 GB (Core) − 450 MiB (techo de Torneos) ≈ **0,22 GB** para el crecimiento de Core, sin contar lo que Core haya crecido desde el 07/10.

**Recomendación A3:**
- **No subir el techo de 450/400 MiB.** Está bien dimensionado para el piloto: decenas de temporadas FREE o una decena de Premium llenas en simultáneo.
- Ahora que las fotos se borran al fin de cada temporada, el uso deja de crecer sin fin.
- **Antes del GO**, Nico corre la medición de Storage de la organización.
  - Si Core supera 0,45 GB, bajar el proyecto Torneos a 1 GB − Core − 150 MB de margen.
  - En ese caso, bajar las fotos en la misma medida.
- **Nunca** contratar más espacio: al llenarse, las subidas se frenan con «El almacenamiento de fotos está lleno».

**El límite que más aprieta es el egress, no el espacio.** Con 5 GB por mes y vistas sobre todo de miniaturas de ~0,05 MB, entran unas 100.000 vistas de miniatura por mes. Si se abre la imagen completa (~0,3 MB), unas 16.000. Para el piloto alcanza; hay que mirarlo si crece el uso.

## Planificador

**Qué tiene que correr:**
1. `run_tournament_season_media_lifecycle()`: cierra temporadas vencidas, manda los avisos de 7 días y 1 día y marca fotos. Es sólo SQL.
2. `media-purge` de `torneos-media-store`: borra los objetos marcados. Necesita la API de Storage, así que corre en la función.

Una corrida cada **15 minutos** alcanza:
- los avisos de 7 días y 1 día no necesitan más precisión;
- los avisos y el borrado son idempotentes;
- las lecturas y subidas de una temporada vencida ya se cierran solas, en el mismo instante, sin esperar al job.

| Opción | Costo | Ventajas | Contras |
|---|---|---|---|
| **A. pg_cron + pg_net en Torneos (recomendada)** | USD 0 | Todo queda dentro de Supabase. El secreto de purga vive en Vault de Torneos. Ya está probado en Core. Son ~2.880 invocaciones por mes de las 500.000 gratis. | Hay que habilitar dos extensiones en Torneos Producción, un cambio de configuración que necesita GO. pg_net es asíncrono: el resultado se ve en su tabla de respuestas. |
| B. Cloud Scheduler hacia una ruta interna | USD 0 si la cuenta de facturación tiene menos de 3 jobs; si no, USD 0,10 por mes | No toca extensiones de la base. | Hay que contar los jobs actuales de la cuenta, que no puedo leer. Suma una ruta interna al gateway. El secreto de purga queda en GCP. |
| C. Sólo a mano (driver de operador) | USD 0 | Sin infraestructura. | Depende de alguien. Sirve como respaldo, no como mecanismo principal. |

**Recomendación A2:** opción A, con el driver de operador como respaldo y para el laboratorio.
- **Cambios en Producción que pediría con su propio GO:**
  - habilitar `pg_cron` y `pg_net` en Torneos;
  - guardar `TORNEOS_MEDIA_PURGE_SECRET` en Vault y como secreto de la función;
  - crear 2 jobs.
- **Vuelta atrás:** borrar los jobs. Al deshabilitar pg_cron los jobs se eliminan solos, según la documentación.

## Pendiente de Nico, al dar el GO

1. Medir el Storage de la organización (Core y Torneos), con lectura y su credencial.
2. Confirmar A2 (pg_cron) y A3 (450/400 MiB, o lo que surja de la medición).
3. Si prefiere la opción B: revisar cuántos jobs de Cloud Scheduler tiene la cuenta de facturación.
