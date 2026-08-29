# Matriz manual de QA — Torneos

Base: `3de01b435fcdb4a63c6b92ba8b5dc934c1bb3a4c`.

Roles: `owner`, `admin`, `delegate`, `player`, `outsider`, `collaborator`.
Viewports: `D` = 1440x900, `T` = 768x1024, `M1` = 320x700,
`M2` = 375x812, `M3` = 430x932.

La evidencia `S` es screenshot, `V` es video, `T` es trace, `C` es consola y
`N` es log de requests fallidos. Para P0/P1 se exige `S+C+N`; ante un fallo
automatizado se conservan además `V+T`.

## Acceso, autenticación y aislamiento

| Módulo | Ruta | Rol | Precondición | Pasos | Resultado esperado | Prioridad | Viewport | Evidencia necesaria |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Auth | `/torneos` | Sin sesión | Storage/cookies vacíos | Abrir la ruta | Redirige a `/login?returnTo=%2Ftorneos` | P0 | D,T,M1,M2,M3 | S+C+N |
| Auth | `/torneos?source=qa#access` | Sin sesión | Storage/cookies vacíos | Abrir la ruta | Login conserva `/torneos?source=qa#access` completo en `returnTo` | P0 | D,M1 | S+C |
| Auth | `/torneos/mis-torneos` | Sin sesión | Storage/cookies vacíos | Abrir deep link | Login conserva el deep link y no renderiza datos | P0 | D,M1 | S+C+N |
| Auth | `/torneos/organizacion/:organizationId/inicio` | Sin sesión | Storage/cookies vacíos | Abrir deep link | Login conserva el deep link; no hay flash de contenido privado | P0 | D,M1 | V+C+N |
| Auth | `/torneos` | owner/admin/delegate/player/outsider/collaborator | Sesión real del rol | Abrir la ruta | No vuelve a login; resuelve landing según membresías reales | P0 | D,T,M1,M2,M3 | S+C+N |
| Aislamiento | Cualquier ruta | Todos | Guard de QA activo | Inspeccionar requests y navegación | Ningún request llega a `app.arma2.com.ar` ni a Supabase remoto no allowlisteado | P0 | D,T,M1,M2,M3 | C+N |
| Aislamiento | Cualquier ruta | Todos | Ref de Production configurado sólo por entorno | Forzar el ref en URL o consola en una ejecución controlada | El test falla y aborta la solicitud | P0 | D | C+N |
| Aislamiento | Seed dry-run | N/A | Sin target remoto | Ejecutar `npm run qa:torneos:seed:dry-run` | Valida 8 equipos/7 fechas/playoffs y no abre conexiones | P0 | N/A | Log CLI |
| Aislamiento | Seed | N/A | `--apply` o `--execute` | Intentar ejecución | Falla; no escribe local ni remotamente | P0 | N/A | Log CLI |

## Landing y superficies personales

| Módulo | Ruta | Rol | Precondición | Pasos | Resultado esperado | Prioridad | Viewport | Evidencia necesaria |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Landing | `/torneos` | owner/admin/delegate/collaborator | Una o más membresías organizacionales | Abrir landing; elegir workspace | Lista sólo membresías autorizadas y abre la organización elegida | P0 | D,T,M1,M2,M3 | S+C+N |
| Landing | `/torneos` | player | Membresía de participante, sin rol organizacional | Abrir landing; usar “Ver mis torneos” | No expone administración; permite entrar a superficies personales | P0 | D,M1,M2,M3 | S+C+N |
| Landing | `/torneos` | outsider | Sin membresías | Abrir landing | Estado vacío seguro; no enumera organizaciones ni torneos ajenos | P0 | D,M1 | S+C+N |
| Organización | `/torneos/nueva-organizacion` | owner/admin/delegate/player/outsider/collaborator | Sesión real | Abrir y enviar sólo datos válidos en entorno autorizado | La capacidad se aplica server-side; sin capacidad no crea ni filtra datos | P0 | D,M1 | S+C+N |
| Personal | `/torneos/mis-torneos` | player/delegate/collaborator | Membresías mixtas | Abrir; cambiar filtros | Muestra sólo torneos relacionados, sin duplicados y con rol correcto | P0 | D,T,M1,M2,M3 | S+C+N |
| Personal | `/torneos/mis-torneos` | outsider | Sin membresías | Abrir | Estado vacío, sin IDs o nombres de terceros | P0 | D,M1 | S+C+N |
| Personal | `/torneos/mis-partidos` | player/delegate | Partidos pasados y próximos | Abrir lista | Partidos autorizados, estados y acciones correctas | P0 | D,T,M1,M2,M3 | S+C+N |
| Personal | `/torneos/mis-partidos/:matchId` | player/delegate/collaborator/outsider | Partido real | Abrir detalle | Sólo miembros autorizados ven detalle; el resto vuelve a superficie segura | P0 | D,M1 | S+C+N |
| Convocatoria | `/torneos/mis-partidos/:matchId/convocatoria` | delegate/player/outsider | Convocatoria publicada | Abrir; responder si corresponde | Sólo el actor habilitado responde; outsider no accede | P0 | D,M1,M2,M3 | S+C+N |
| Comunicados | `/torneos/comunicados` | owner/admin/delegate/player/collaborator | Comunicados con audiencias distintas | Abrir; marcar uno leído | Sólo aparecen audiencias correspondientes; lectura no publica ni edita | P1 | D,T,M1,M2,M3 | S+C+N |
| Invitación | `/torneos/invitacion/equipo/:token` | delegate/player/outsider | Tokens válido, vencido, usado e inválido | Abrir cada token | Estado y CTA correctos; token no se filtra en logs; no hay doble aceptación | P0 | D,M1,M2,M3 | S+C+N |

## Shell organizacional y RBAC

| Módulo | Ruta | Rol | Precondición | Pasos | Resultado esperado | Prioridad | Viewport | Evidencia necesaria |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Shell | `/torneos/organizacion/:organizationId` | owner/admin/delegate/collaborator | Membresía activa | Abrir | Redirige a `/inicio`; sidebar/topbar muestran workspace correcto | P0 | D,T,M1,M2,M3 | S+C |
| Shell | `/torneos/organizacion/:organizationId/*` | player/outsider | Sin membresía organizacional | Abrir cada deep link administrativo | Deniega y vuelve a `/torneos`; no hay flash ni requests de datos privados | P0 | D,M1 | V+C+N |
| Shell | `/torneos/organizacion/:otherOrganizationId/*` | owner/admin/delegate/collaborator | Membresía sólo en otra organización | Abrir ID ajeno | Deniega cross-tenant y limpia la selección activa insegura | P0 | D,M1 | S+C+N |
| Navegación | `/torneos/organizacion/:organizationId/inicio` | owner/admin/delegate/collaborator | Membresía activa | Recorrer navegación principal | Inicio, Torneos, Equipos, Fixture, Partidos, Competencia, Comunicaciones, Multimedia y Configuración resuelven sin 404 | P0 | D,T | S+C+N |
| Navegación móvil | `/torneos/organizacion/:organizationId/inicio` | owner/admin/delegate/collaborator | Membresía activa | Recorrer barra móvil; abrir teclado | Barra visible, targets utilizables y oculta con teclado sin tapar controles | P1 | M1,M2,M3 | V+S |
| Workspace | `/torneos/organizacion/:organizationId/inicio` | owner/admin/delegate/collaborator | Dos workspaces autorizados | Cambiar workspace | Contexto, URL, datos y capacidades cambian juntos; no se mezcla caché | P0 | D,T,M1,M2,M3 | V+C+N |

## Organización, temporadas y torneos

| Módulo | Ruta | Rol | Precondición | Pasos | Resultado esperado | Prioridad | Viewport | Evidencia necesaria |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Dashboard | `/torneos/organizacion/:organizationId/inicio` | owner/admin/delegate/collaborator | Dataset demo disponible | Abrir | KPIs, torneo activo y próximos partidos reflejan el dataset sin overflow | P1 | D,T,M1,M2,M3 | S+C |
| Temporadas | `/torneos/organizacion/:organizationId/temporadas` | owner/admin/delegate/collaborator | Membresía activa | Abrir alias | Redirige a `../torneos` conservando organización | P1 | D,M1 | S |
| Temporadas | `/torneos/organizacion/:organizationId/temporadas/nueva` | owner/admin/delegate/collaborator | Probar con/sin capacidad de creación | Abrir; completar; cancelar | Sólo capacidad autorizada crea; cancelar no persiste | P0 | D,M1 | S+C+N |
| Temporadas | `/torneos/organizacion/:organizationId/temporadas/:seasonId` | owner/admin/delegate/collaborator | Temporada activa y archivada | Editar nombre/fechas | Validaciones y permisos correctos; archivada respeta restricciones | P0 | D,M1 | S+C+N |
| Torneos | `/torneos/organizacion/:organizationId/torneos` | owner/admin/delegate/collaborator | Estados draft/in_progress/completed/archived | Abrir; filtrar; abrir tarjeta | Orden, estados, conteos y acciones por capacidad correctos | P0 | D,T,M1,M2,M3 | S+C+N |
| Torneo wizard | `/torneos/organizacion/:organizationId/torneos/nuevo` | owner/admin/delegate/collaborator | Catálogos cargados | Recorrer pasos sin guardar y cancelar | Navegación consistente; cancelar no crea datos | P1 | D,T,M1,M2,M3 | V+C+N |
| Torneo config | `/torneos/organizacion/:organizationId/torneos/:tournamentId/configuracion` | owner/admin/delegate/collaborator | Torneo en cada estado | Abrir y editar según capacidad | Bloqueos por estado/capacidad; no muta otro tenant | P0 | D,T,M1 | S+C+N |
| Torneo alias | `/torneos/organizacion/:organizationId/torneos/:tournamentId` | Todos los roles organizacionales | Torneo accesible | Abrir | Redirige a configuración sin perder IDs | P1 | D,M1 | S |
| Categorías | `/torneos/organizacion/:organizationId/torneos/:tournamentId/categorias` | owner/admin/delegate/collaborator | Torneo editable | Abrir alias; agregar/quitar borrador | Abre paso 4; valida nombre largo, modalidad y límites | P1 | D,T,M1 | S+C+N |

## Equipos y planteles

| Módulo | Ruta | Rol | Precondición | Pasos | Resultado esperado | Prioridad | Viewport | Evidencia necesaria |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Equipos | `/torneos/organizacion/:organizationId/equipos` | owner/admin/delegate/collaborator | 8 equipos; 2 sin escudo | Abrir; buscar; filtrar | Ocho equipos correctos; fallback de escudo y nombre largo sin romper layout | P0 | D,T,M1,M2,M3 | S+C+N |
| Equipos | `/torneos/organizacion/:organizationId/equipos/nuevo` | owner/admin/delegate/collaborator | Capacidad variable | Abrir; validar formulario; cancelar | Sólo capacidad autorizada crea; cancelar no escribe | P0 | D,M1 | S+C+N |
| Inscripción | `/torneos/organizacion/:organizationId/equipos/:teamEntryId/inscripcion` | owner/admin/delegate/collaborator | Equipo draft/submitted/approved | Abrir; editar cuando corresponde | Permisos y bloqueos por estado correctos | P0 | D,T,M1,M2,M3 | S+C+N |
| Plantel | `/torneos/organizacion/:organizationId/equipos/:teamEntryId/plantel` | owner/admin/delegate/collaborator | Plantel con perfiles/provisionales/sin avatar | Abrir; buscar; intentar cambios no autorizados | Fallbacks correctos; no hay fotos específicas nuevas; RBAC server-side | P0 | D,T,M1,M2,M3 | S+C+N |
| Revisión | `/torneos/organizacion/:organizationId/equipos/:teamEntryId/revision` | owner/admin/delegate/collaborator | Solicitud submitted | Aprobar/rechazar sólo en entorno autorizado | Sólo revisor habilitado decide; queda auditoría | P0 | D,M1 | S+C+N |
| Equipo alias | `/torneos/organizacion/:organizationId/equipos/:teamEntryId` | Roles autorizados | Equipo accesible | Abrir | Redirige a inscripción sin perder IDs | P2 | D,M1 | S |

## Fixture, programación y sedes

| Módulo | Ruta | Rol | Precondición | Pasos | Resultado esperado | Prioridad | Viewport | Evidencia necesaria |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Fixture | `/torneos/organizacion/:organizationId/fixture` | owner/admin/delegate/collaborator | Torneo activo | Abrir resumen | Estado de participantes, sorteo, versión y publicación coherentes | P0 | D,T,M1,M2,M3 | S+C+N |
| Participantes | `/torneos/organizacion/:organizationId/fixture/participantes` | owner/admin/delegate/collaborator | 8 equipos aprobados | Abrir; congelar/reabrir si autorizado | Conteo correcto y permisos por capacidad | P0 | D,M1 | S+C+N |
| Bombos | `/torneos/organizacion/:organizationId/fixture/bombos` | owner/admin/delegate/collaborator | Participantes congelados | Distribuir; cancelar | Sin duplicados/omisiones; cancelar no guarda | P1 | D,T,M1 | S+C+N |
| Sorteo | `/torneos/organizacion/:organizationId/fixture/sorteo` | owner/admin/delegate/collaborator | Bombos válidos | Ejecutar sólo en entorno autorizado | Resultado íntegro e idempotencia visible | P0 | D,M1 | V+C+N |
| Grupos | `/torneos/organizacion/:organizationId/fixture/grupos` | owner/admin/delegate/collaborator | Sorteo existente | Revisar grupos y nombres largos | Todos los equipos una vez; layout estable | P1 | D,T,M1,M2,M3 | S |
| Generación | `/torneos/organizacion/:organizationId/fixture/generar` | owner/admin/delegate/collaborator | Participantes válidos | Generar preview; cancelar | Preview no publica ni reemplaza versión vigente | P0 | D,M1 | S+C+N |
| Jornadas | `/torneos/organizacion/:organizationId/fixture/version/:fixtureVersionId` | owner/admin/delegate/collaborator | Siete fechas + playoffs | Recorrer fechas | 7 fechas, semifinales y final; estados especiales visibles | P0 | D,T,M1,M2,M3 | S+C+N |
| Jornadas | `/torneos/organizacion/:organizationId/fixture/jornadas` y `/:roundId` | owner/admin/delegate/collaborator | Fixture publicado | Abrir lista y detalle | Navegación y conteos correctos; deep link estable | P0 | D,T,M1,M2,M3 | S+C+N |
| Partido fixture | `/torneos/organizacion/:organizationId/fixture/partidos/:matchId` | owner/admin/delegate/collaborator | Casos normal/postergado/suspendido | Abrir cada caso | Estado, resultado y acciones disponibles son coherentes | P0 | D,M1,M2,M3 | S+C+N |
| Llave | `/torneos/organizacion/:organizationId/fixture/llave` | owner/admin/delegate/collaborator | Semis, penales y final | Abrir llave | Avance por penales correcto; sin overflow horizontal no controlado | P0 | D,T,M1,M2,M3 | S |
| Programación | `/torneos/organizacion/:organizationId/programacion` | owner/admin/delegate/collaborator | Sedes/canchas/ventanas | Programar y reprogramar sólo si autorizado | Conflictos visibles; cambios auditables; cancelar no escribe | P0 | D,T,M1 | S+C+N |
| Sedes | `/torneos/organizacion/:organizationId/sedes` y `/:venueId` | owner/admin/delegate/collaborator | Sede con nombre largo y varias canchas | Abrir lista/detalle | Datos y modalidades correctos; RBAC aplicado | P1 | D,T,M1,M2,M3 | S+C+N |

## Operación, competencia, comunicaciones y multimedia

| Módulo | Ruta | Rol | Precondición | Pasos | Resultado esperado | Prioridad | Viewport | Evidencia necesaria |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Partidos | `/torneos/organizacion/:organizationId/partidos` | owner/admin/delegate/collaborator | Todos los estados del dataset | Buscar/filtrar/abrir | Estados, scores y acciones correctos; resultado bajo revisión destacado | P0 | D,T,M1,M2,M3 | S+C+N |
| Partido | `/torneos/organizacion/:organizationId/partidos/:matchId` | owner/admin/delegate/collaborator | Partido asignado/no asignado | Abrir ambos | Sólo actor autorizado opera; demás sólo lectura o denegación | P0 | D,T,M1,M2,M3 | S+C+N |
| Convocatorias admin | `/torneos/organizacion/:organizationId/partidos/:matchId/convocatorias` | owner/admin/delegate/collaborator | Planteles cargados | Abrir; seleccionar; cancelar | Cambios permitidos por rol; cancelar no persiste | P0 | D,M1 | S+C+N |
| Acta | `/torneos/organizacion/:organizationId/partidos/:matchId/acta` | owner/admin/delegate/collaborator | Goles/asistencias/tarjetas | Abrir; revisar; guardar sólo autorizado | Eventos y totales coherentes; auditoría e idempotencia | P0 | D,T,M1 | S+C+N |
| Revisión | `/torneos/organizacion/:organizationId/partidos/:matchId/revision` | owner/admin/delegate/collaborator | Resultado under_review | Aprobar/corregir según capacidad | Sólo revisor habilitado cambia estado; tabla no publica antes | P0 | D,M1 | S+C+N |
| Historial | `/torneos/organizacion/:organizationId/partidos/:matchId/historial` | owner/admin/delegate/collaborator | Varias revisiones | Abrir | Secuencia inmutable, actor/fecha/acción claros | P1 | D,T,M1 | S+C+N |
| Competencia alias | `/torneos/organizacion/:organizationId/competencia` | Roles organizacionales | Torneo activo | Abrir | Redirige a `competencia/tabla` | P1 | D,M1 | S |
| Tabla | `/torneos/organizacion/:organizationId/competencia/tabla` | owner/admin/delegate/collaborator | 7 fechas; walkover; revisión | Abrir; cambiar fecha/categoría | Cálculo respeta estados oficiales; revisión no contamina tabla | P0 | D,T,M1,M2,M3 | S+C+N |
| Estadísticas | `/torneos/organizacion/:organizationId/competencia/estadisticas` | owner/admin/delegate/collaborator | Goles/asistencias/tarjetas | Abrir rankings y detalle modal | Totales correctos; modal abre/cierra por botón, Escape y backdrop | P0 | D,T,M1,M2,M3 | V+S+C |
| Clasificación | `/torneos/organizacion/:organizationId/competencia/clasificacion` | owner/admin/delegate/collaborator | Reglas configuradas | Abrir; resolver sólo si autorizado | Clasificados correctos y acción protegida | P0 | D,M1 | S+C+N |
| Disciplina | `/torneos/organizacion/:organizationId/competencia/disciplina` | owner/admin/delegate/collaborator | Sanción activa y cumplida | Filtrar; abrir detalle modal | Sancionados/estado correctos; modal accesible | P0 | D,T,M1,M2,M3 | V+S+C |
| Comunicaciones | `/torneos/organizacion/:organizationId/comunicaciones` | owner/admin/delegate/collaborator | Draft/publicado; varias audiencias | Crear draft, previsualizar; no publicar en smoke | Audiencia no se filtra; permisos correctos; ninguna red social externa | P0 | D,T,M1,M2,M3 | S+C+N |
| Multimedia | `/torneos/organizacion/:organizationId/multimedia` | owner/admin/delegate/collaborator | Upload flag desactivado | Abrir | Galerías existentes visibles según rol; carga bloqueada; sin fotos específicas de jugadores | P0 | D,T,M1,M2,M3 | S+C+N |
| Configuración | `/torneos/organizacion/:organizationId/configuracion` | owner/admin/delegate/collaborator/player/outsider | Probar cada rol | Abrir; intentar editar | Owner/admin según capability; demás denegados; no filtra valores privados | P0 | D,T,M1 | S+C+N |
| Miembros | `/torneos/organizacion/:organizationId/miembros` | owner/admin/delegate/collaborator/player/outsider | Probar cada rol | Abrir; buscar; intentar cambio | Lista y mutaciones sólo para capacidades explícitas | P0 | D,T,M1 | S+C+N |

## Hub de participante

| Módulo | Ruta | Rol | Precondición | Pasos | Resultado esperado | Prioridad | Viewport | Evidencia necesaria |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Hub | `/torneos/torneo/:tournamentId` | player/delegate/collaborator/outsider | Torneo accesible/no accesible | Abrir | Miembros ven hub; outsider no obtiene contenido privado | P0 | D,T,M1,M2,M3 | S+C+N |
| Novedades | `/torneos/torneo/:tournamentId/novedades` | player/delegate/collaborator | Comunicados publicados | Abrir | Sólo publicaciones para su audiencia | P1 | D,T,M1,M2,M3 | S+C+N |
| Partidos | `/torneos/torneo/:tournamentId/partidos` y `/:matchId` | player/delegate/collaborator | Fixture publicado | Abrir lista/detalle | Sólo datos publicados; estados especiales legibles | P0 | D,T,M1,M2,M3 | S+C+N |
| Tabla pública privada | `/torneos/torneo/:tournamentId/tabla` | player/delegate/collaborator/outsider | Flag y membresía variables | Abrir | Acceso respeta publicación y membresía; números coinciden con admin | P0 | D,T,M1,M2,M3 | S+C+N |
| Estadísticas hub | `/torneos/torneo/:tournamentId/estadisticas` | player/delegate/collaborator | Datos oficiales | Abrir | Goles/asistencias correctos; sin ranking inventado para equipo ideal | P0 | D,T,M1,M2,M3 | S+C |
| Equipos hub | `/torneos/torneo/:tournamentId/equipos` | player/delegate/collaborator | 8 equipos | Abrir | Escudos/initials fallback; nombres largos; no datos privados de plantel | P1 | D,T,M1,M2,M3 | S+C |
| Fotos hub | `/torneos/torneo/:tournamentId/fotos` | player/delegate/collaborator | Galería publicada | Abrir; abrir/cerrar lightbox | Sólo galerías autorizadas; no fotos específicas de menores/jugadores provisionales | P0 | D,T,M1,M2,M3 | V+S+C+N |
| Disciplina hub | `/torneos/torneo/:tournamentId/disciplina` | player/delegate/collaborator | Sanciones publicables | Abrir | Sólo datos autorizados; estado activo/cumplido correcto | P0 | D,T,M1,M2,M3 | S+C+N |

## Calidad transversal

| Módulo | Ruta | Rol | Precondición | Pasos | Resultado esperado | Prioridad | Viewport | Evidencia necesaria |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Responsive | Todas las rutas anteriores | Todos | Dataset con nombres largos/fallbacks | Medir `scrollWidth` y recorrer pantallas | Sin overflow horizontal del documento; componentes scrollables son explícitos | P0 | D,T,M1,M2,M3 | S+C |
| Modales | Rutas con dialog | Roles autorizados | Modal real disponible | Abrir, tabular, Escape, backdrop, reabrir | Foco contenido/restaurado; cierre consistente; `role=dialog` y nombre accesible | P1 | D,T,M1,M2,M3 | V+S |
| Accesibilidad | Todas | Todos | UI cargada | Navegar sólo con teclado; activar skip link | Orden lógico, foco visible y contenido principal alcanzable | P1 | D,T | V+S |
| Consola | Todas | Todos | Captura activa | Completar smoke de ruta | Sin errores inesperados, warnings de React Router nuevos ni `act()` atribuibles al cambio | P1 | D,T,M1,M2,M3 | C |
| Requests | Todas | Todos | Captura activa | Completar smoke de ruta | 4xx/5xx quedan registrados y justificados; cero llamadas a Production | P0 | D,T,M1,M2,M3 | N |
