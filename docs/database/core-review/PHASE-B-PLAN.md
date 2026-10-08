# Fase B de privacidad — plan de publicación y activación

Estado al 2026-10-07: **la exposición sigue abierta en Producción.** Mientras no se aplique la
fase B, cualquier cuenta con sesión (el registro es abierto) puede leer de las tablas el email,
el teléfono, la fecha de nacimiento y la ubicación exacta de todos los usuarios, y el código de
acceso de todos los partidos. La fase A (migraciones 124000, 128000, 130000, 133000) agrega los
caminos seguros y ya los usa la app nueva, pero **no cierra nada por sí sola**.

## Qué cierra la fase B

| Archivo (manual, no es migración) | Cierra | Sigue visible para otras cuentas |
|---|---|---|
| `phase-b-usuarios-private-columns.sql` | `usuarios`: todo lo que no está en la lista pública (email, teléfono, nacimiento, ubicación exacta, actividad, push y cualquier columna futura); `profiles.telefono` | Lista pública explícita (`app_private.usuarios_public_columns()`): nombre, foto, ciudad, posición, estadísticas, `lesion_activa`, etc. |
| `phase-b-partidos-access-code.sql` | `partidos.codigo` desde la tabla | Todo el resto del partido (descubrimiento); el código sólo lo ven su admin y su plantel (vistas y `get_match_access_codes`); los enlaces con código siguen funcionando |

Se aplican **juntos**, en la misma ventana: rompen lo mismo y necesitan la misma evidencia.

**Lo que la fase B no cierra:** el plantel de cualquier partido (`jugadores`: nombre, foto y
`usuario_id` de cada anotado) sigue legible por cualquier cuenta con sesión, porque
`jugadores_select_authenticated` es `USING (true)` y el descubrimiento y las invitaciones lo usan.
Decidir qué parte del plantel es pública es una regla aparte (pendiente).

`lesion_activa` queda pública a propósito (la tarjeta del jugador y Amigos muestran "lesionado");
el detalle de la lesión (`lesiones`) ya es sólo del dueño. Si se prefiere privada, es un cambio de
una línea en la lista y en `PUBLIC_PROFILE_FIELDS` (decisión de producto).

## Quiénes quedarían afectados

| Cliente | Qué pasa después de la fase B |
|---|---|
| Web (Vercel) | Nada: se publica con el cliente nuevo antes de la fase B. |
| Android / iOS 1.1.21 (la versión en ambas tiendas hoy) y anteriores | **Deja de funcionar lo principal**: su propio perfil no carga (`usuarios select('*')`), no abre partidos ni el panel de admin (`partidos select('*')`), no puede crear partidos (`insert().select()`), y fallan tarjeta de jugador (teléfono), Amigos y Quiero jugar (email/coordenadas), resultados (`profiles select('*')`) y búsqueda. Tiene que actualizar la app. |
| Android / iOS con la build mínima o posterior | Nada. Probado en el laboratorio con ambas fases B aplicadas: perfil, Amigos, Notificaciones, encuesta, panel de admin, enlace de WhatsApp (cuenta ajena), votación por enlace sin sesión, sin errores. |
| Cuentas que no abren la app | No ven nada roto hasta abrirla; al abrirla con 1.1.21, lo de arriba. |

No hay mecanismo de actualización obligatoria en la app: una 1.1.21 no se puede forzar. La
única forma de no romper a nadie es esperar a que esas instalaciones dejen de usarse (o aceptar
explícitamente el residuo).

## Evidencia que hay y evidencia que falta

| Dato | Estado |
|---|---|
| Versión ofrecida en las tiendas | **Hay**: 1.1.21 en App Store (8 ago 2026) y Google Play (7 ago 2026, "100+ descargas", Android 6.0+). |
| Builds sin publicar en el repo | **Hay**: Android 1.1.22 (versionCode 44), iOS 1.1.21 (build 41). |
| Cuántas instalaciones activas usan cada versión | **Falta**: sólo lo dicen Play Console (Estadísticas → versión de la app) y App Store Connect (Analytics → versión). No se consultaron. |
| Qué build usa cada cuenta activa | **Falta hasta publicar 130000 + la app nueva**: `report_client_build` lo registra al abrir la app; `device_tokens.app_version` siempre estuvo vacío. |
| Cuentas activas que todavía usan 1.1.21 | **Falta**: `privacy_phase_b_readiness` lo estima como "sesión renovada sin ningún reporte", una vez que el reporte lleve ≥30 días publicado. |
| Lecturas `select('*')` en la API | Opcional: logs de PostgREST (dashboard de Supabase) filtrando `usuarios?select=*` y `partidos?select=*`. |

## Pasos (cada uno con su verificación)

1. **GO + merge** de #183 y #186 (y #184/#185 si se decide). Verificar: CI verde en `main`.
2. **Web** a Producción. Verificar: `main.*.js` nuevo en el dominio; abrir perfil, Amigos, un partido, compartir votación; ningún 4xx en la consola.
3. **Migraciones** 20261010120000–20261010134000 en Producción (GO, backup, fuera de R0–R3).
   Verificar: los chequeos de cada migración pasan; `select * from cron.job where jobname = 'survey_finalization_backend_scheduler'` existe;
   `select count(*) from app_private.client_build_reports` empieza a crecer con la web.
4. **Builds nativas** con el cliente de fase A: Android versionCode ≥ 45 e iOS build ≥ 42 (anotar los números reales:
   son la **versión mínima**). Verificar en las consolas que quedaron en revisión/publicadas.
5. **Esperar y medir** al menos 30 días desde que ambas builds estén publicadas. Cada semana:
   `select * from app_private.privacy_phase_b_readiness(<min Android>, <min iOS>, 30);`
   más el reparto por versión de Play Console y App Store Connect.
6. **Decisión de GO para la fase B** cuando `native_below_minimum = 0` y `active_without_any_report = 0`,
   o cuando el dueño acepte el residuo por escrito (con la cifra).
7. **Aplicar** `phase-b-usuarios-private-columns.sql` y `phase-b-partidos-access-code.sql` (sus chequeos fallan si algo quedó legible).
   Verificar con una cuenta de prueba: `usuarios?select=email` → 401/403; `partidos?select=codigo` → 401/403;
   perfil propio, Amigos, un partido, un enlace de WhatsApp y la votación por enlace funcionan.
8. **Vigilar 24 h**: errores `permission denied` en los logs de PostgREST y reportes de builds viejas.
   Rollback inmediato: `grant select on table public.usuarios, public.profiles, public.partidos to anon, authenticated;`

Recién después del paso 7 puede decirse que la exposición está cerrada.
