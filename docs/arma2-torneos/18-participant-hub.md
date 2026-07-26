# Participant Hub

## Objetivo y alcance

El Participant Hub es la experiencia web autenticada para jugadores, capitanes,
delegados, asistentes y miembros activos de una organización. Reúne competencias
relacionadas en `/torneos/mis-torneos` y ofrece un centro unificado por torneo en
`/torneos/torneo/:tournamentId`.

Incluye resumen, partidos, tabla, estadísticas, equipos, disciplina y detalle de
partido. No incluye página pública anónima, chat, comentarios, reclamos,
apelaciones, notificaciones, exportaciones, streaming, sponsors, contenido
social, perfiles públicos ni edición administrativa nueva.

## Rutas

| Ruta | Propósito |
|---|---|
| `/torneos/mis-torneos` | competencias relacionadas, paginadas |
| `/torneos/torneo/:tournamentId` | resumen personal y publicado |
| `/partidos` | fixture publicado de la categoría |
| `/partidos/:matchId` | resultado, acta y contexto propio |
| `/tabla` | última revisión publicada |
| `/estadisticas` | rankings de la revisión publicada |
| `/equipos` | participantes y roster publicable |
| `/disciplina` | disciplina derivada y publicada |

Las secciones internas conservan `categoria` en la URL. La preferencia real se
persiste en backend y se revalida en cada carga; el query string no autoriza.

## Autorización y privacidad

`can_read_tournament_participant_hub` permite acceso únicamente a:

- miembro activo de la organización;
- manager activo de una inscripción aprobada; o
- jugador Arma2 activo de un roster aprobado.

La relación y la categoría se revalidan en PostgreSQL en cada RPC. Usuario
eliminado, manager suspendido, inscripción no aprobada, categoría ajena,
UUID inválido, sesión vencida y anónimo fallan cerrados. Un torneo
completado/archivado permanece disponible sólo como historial de lectura.

Los RPCs SECURITY DEFINER tienen `search_path = ''`, grants mínimos y no aceptan
`user_id` del cliente. No devuelven notas internas, disponibilidad rival,
actores, auditoría, fingerprints, drafts ni perfiles privados. El directorio de
equipos publica únicamente nombre, dorsal, posición y condición de arquero; no
publica avatar porque el dominio actual no registra consentimiento específico.

## Contratos de lectura

La migración `20260726230000_tournament_participant_hub.sql` agrega:

- `get_my_tournament_memberships(limit, offset)`;
- `get_tournament_participant_hub(tournament, category)`;
- `set_my_tournament_hub_category(tournament, category)`;
- `get_published_tournament_matches(...)`;
- `get_tournament_participant_match(match)`;
- `get_published_tournament_teams(...)`.

El resumen limita próximos partidos, resultados, tabla y goleadores. Partidos,
equipos y membresías tienen paginación acotada. Cada RPC compone un payload
específico para evitar N+1 y evita entregar filas base amplias al navegador.
Tabla, estadísticas y disciplina consumen exclusivamente la revisión publicada;
si sólo existe draft se muestra vacío.

## Estados por rol

- Jugador: próximo partido, disponibilidad propia, convocatoria publicada,
  estadísticas propias, equipo, sanciones y alertas propias.
- Capitán/delegado/asistente: lo anterior más acceso a su flujo existente de
  convocatoria y conteos agregados de disponibilidad de su equipo.
- Owner/admin/collaborator: lectura transversal de categorías autorizadas; el
  enlace al gestor sólo aparece con capability `tournaments.update`.

Un usuario con varios roles usa el mismo componente y recibe la composición de
capacidades calculada en servidor. No existen variantes visuales que amplíen
permisos por sí mismas.

## UX, accesibilidad y responsive

El diseño conserva el lenguaje oscuro violeta de Torneos con rieles numéricos,
acentos por equipo, jerarquía editorial y navegación interna compacta. Contempla
skeleton, vacío, error, offline, sin fixture, sin publicación, lectura histórica
y carreras entre cambios de categoría. Los datos anteriores se limpian mientras
se revalida el nuevo contexto.

Los controles interactivos tienen foco visible y targets de al menos 44 px. Hay
soporte para teclado, nombres largos, scroll contenido en tablas y
`prefers-reduced-motion`. La tabla móvil conserva Posición, Equipo, PJ, DG y
Puntos; G/E/P se ocultan debajo de 680 px.

## Performance e índices

Las consultas parten de scope compuesto e índices sobre fixture/estado/fecha.
La migración agrega índices para roster activo por usuario, feed de partidos por
fixture y preferencia por categoría. Los límites máximos son 50 partidos, 50
membresías y 32 equipos por llamada. No se agregan Storage, sockets, jobs ni
consultas por tarjeta.

## Pruebas y rollout

`torneos-participant-hub.mjs` ensaya migraciones desde cero y cubre grants, RLS,
anónimo, roles relacionales, categorías cruzadas, borradores, archivo, remoción,
suspensión y ausencia de datos privados. Jest cubre contratos de servicio,
estados personales, jugador, capitán/admin, carreras, error, responsive y
accesibilidad estructural.

No se ejecutan migraciones remotas ni deploys. La experiencia permanece detrás
de las flags existentes de Torneos, apagadas en producción. El rollout futuro
requiere staging aislado, sesión de cada rol, dataset volumétrico, auditoría de
payloads en red y QA física en 320 × 700, 390 × 844, 768 × 1024 y 1440 × 900.
