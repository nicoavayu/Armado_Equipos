# Privacidad de Core — cierre compatible con las apps instaladas

Estado al 2026-10-08: **la solución está preparada, probada en el laboratorio de Core y en un dry
run aplicado como `postgres` ([RUNBOOK-193.md](RUNBOOK-193.md)); no está aplicada en Producción.**
Hasta que se apliquen 20261010135000–138000, cualquier cuenta con sesión (el registro es
abierto) puede leer de las tablas:
- email, teléfono, fecha de nacimiento y ubicación exacta de todos los usuarios;
- el código de todos los partidos;
- todos los planteles.

El código es una credencial: con él se vota por link como cualquier invitado del plantel y, hasta
138000, se reemplazaba la foto de cualquier invitado.

## Qué cambió respecto del plan anterior

El plan anterior ("fase B") revocaba columnas. Eso rompe a toda app que lea con `select('*')`, y
la 1.1.21 (la versión en ambas tiendas) lo hace con `usuarios` y `partidos`, sin forma de forzar
la actualización. Ahora el cierre no revoca columnas:

| Dato | Cómo se cierra | Qué ve una cuenta ajena |
|---|---|---|
| email, teléfono, fecha de nacimiento, precisión de ubicación (`usuarios`, `profiles.telefono`) | **135000**: los valores salen de la fila compartida a `app_private.usuarios_private` (sin acceso por la API). Las columnas siguen existiendo. Un trigger captura lo que escribe cualquier app o el servidor. | `NULL` |
| ubicación exacta (`latitud`, `longitud`) | **135000**: la fila compartida guarda la aproximación a ~1 km. | coordenadas redondeadas a 2 decimales |
| partido y su código (`partidos`) | **136000** + **137000**: la tabla devuelve un partido sólo a quien participa; los publicados se ven por `partidos_view` y "Quiero jugar", que leen como `core_match_public_reader` y ocultan el código. | sus partidos; los publicados, por las vistas y sin código |
| plantel (`jugadores`) | **136000**: el plantel sigue la visibilidad del partido. Las filas sin partido (jugadores de equipos) y las propias siguen visibles. | sólo planteles de partidos en los que participa o publicados (ver "residual") |
| foto de un invitado en la votación por link | **138000**: el slot es de la primera sesión que lo toma; no se toma el de un invitado que ya votó. | no puede reemplazar la foto de otro invitado |

**Quién ve un partido y su plantel:**
- su organizador o administrador;
- quien está en el plantel;
- quien pidió sumarse;
- quien recibió un aviso sobre ese partido (invitación, llamado a votar…);
- mientras el partido está publicado buscando jugadores ("Quiero jugar"), cualquier cuenta con
  sesión, por las vistas y sin el código; el plantel también desde la tabla.

Un visitante sin sesión no lee filas (sin cambios). La votación por enlace y las invitaciones
usan RPCs del servidor y no cambian.

**El dueño** lee todo lo suyo con `get_my_profile()` y lo borra explícitamente con
`clear_my_profile_fields()`. **El servidor** lee los valores reales donde los necesita: teléfono
de contacto del organizador, búsqueda por email, ubicación de auto-match y distancia de arqueros.

## Residual (decisión de producto)

- **Planteles de partidos publicados:** mientras el partido está publicado, cualquier cuenta con
  sesión lee su plantel (nombre, foto, `usuario_id`, `score`). La 1.1.21 lo muestra en la
  página pública. Análisis campo por campo y transición en [ROSTER-FIELDS.md](ROSTER-FIELDS.md).
- **El código de un partido publicado** ya no es residual (137000): no llega a nadie ajeno ni
  desde la tabla, ni desde las vistas, ni desde el listado.
- **Metadatos de actividad** de `usuarios` (`push_enabled`, `last_seen_at`,
  `last_seen_partido_id`, `location_updated_at`) siguen legibles: no estaban en el pedido. Si se
  quieren cerrar, el mismo patrón de 135000 sirve.
- **Directorios que recorrían todos los planteles** (candidatos de Desafíos, "buscar jugador por
  nombre", avatares de respaldo en Amigos) ahora sólo ven jugadores de partidos visibles y
  jugadores de equipos. Es el cierre pedido, no un error.

## Compatibilidad

| Cliente | Qué pasa | ¿Requiere build nueva? |
|---|---|---|
| 1.1.21 Android / iOS (en las tiendas) | **Sigue funcionando sin errores nuevos.** Probado en el laboratorio contra la API real:<br>- las 32 formas en que lee `usuarios`/`profiles` y las 84 en que lee `partidos`/`jugadores`/vistas, como dueño, miembro y cuenta ajena;<br>- sus escrituras: alta de perfil con upsert, guardado del perfil, crear partido, sumar jugadores, editar, todas con `RETURNING`.<br>Cambios visibles:<br>- en su perfil, teléfono y fecha de nacimiento aparecen vacíos (no se borran: un guardado en blanco los conserva) y no puede borrarlos desde esa versión;<br>- en la ficha de otro jugador no ve el teléfono;<br>- las distancias usan la ubicación aproximada;<br>- no ve partidos ni planteles ajenos privados. | No |
| Web (detrás del gate) y builds nuevas | Leen el perfil propio con `get_my_profile()` y vacían campos con `clear_my_profile_fields()` (cambio en `profiles.js`). El teléfono de contacto pasa por `get_match_contact_phone`. | No para cerrar la exposición. Las builds nuevas sólo recuperan, en el perfil propio, ver teléfono y fecha y poder borrarlos. |

Errores que la 1.1.21 ya tiene hoy, sin relación con este cambio: pide columnas que este esquema
nunca tuvo (`usuarios.fecha_alta`, `profiles.estadisticas`, `partidos.from_frequent_match_id`,
`partidos.surveys_processed`). Con 134000, sus lecturas de `partidos.template_id` empiezan a
funcionar.

## Pasos para Producción (cada uno con GO)

1. Merge #183 → #186 → #187 → la PR de este cierre. Verificar: CI verde.
2. Web a Producción.
3. Backup verificado, prechecks, migraciones 20261010120000 a 20261010138000, post-checks:
   paso a paso en [RUNBOOK-193.md](RUNBOOK-193.md).
4. Verificar con una cuenta de prueba ajena:
   - `usuarios?select=email,telefono,fecha_nacimiento` devuelve `NULL`;
   - `partidos?select=codigo` sólo trae partidos propios; `partidos_view` lista los publicados con `codigo` vacío;
   - `jugadores` de un partido privado ajeno devuelve vacío;
   - perfil propio, Amigos, un partido, un enlace de WhatsApp y la votación por enlace funcionan.
5. Vigilar 24 h los errores en los logs de PostgREST.
6. Rollback: archivos probados en `runbook/rollbacks/` (135000–138000) y PROMOTION.md §5 (el resto).

Las builds nuevas no son prerequisito. Los archivos `phase-b-*.sql` (revocar columnas) quedan como
**refuerzo opcional** para cuando no queden apps viejas en uso, medido con
`privacy_phase_b_readiness`. Ya no son necesarios para cerrar la exposición.
