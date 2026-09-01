# Arma2 Torneos — QA exploratorio autónomo con foco en owner

Fecha: 2026-08-12  
Estado: **REVIEW**  
Branch observada: `feature/torneos-space-switcher` (`e1068460`)  
Entorno: React LOCAL `http://127.0.0.1:3000` + Supabase LOCAL `http://127.0.0.1:57321`  
Identidad manual validada: `qa-owner`  
Viewport manual efectivo: desktop, 1440 × 900  

## Dictamen

**No todavía.** Si mañana se entrega Arma2 Torneos a una persona que organiza
una liga amateur pero nunca vio la plataforma, no podría administrarla sola de
punta a punta en el entorno observado.

El cambio Arma2 ↔ Torneos, el wizard de torneo, la página pública y gran parte
del lenguaje futbolístico constituyen una base prometedora. El recorrido deja
claro que existe un producto separado para gestionar competencias y que se puede
volver a Arma2.

Sin embargo, el owner se bloquea en el primer alta, no encuentra una acción para
crear o inscribir equipos, no puede abrir un plantel de forma confiable y no
puede alcanzar fixture, partidos, miembros ni comunicaciones con continuidad.
Además, la vista privada y la pública se contradicen sobre el estado real del
mismo torneo. La inestabilidad de PostgREST LOCAL agrava el problema, pero la UI
también presenta degradaciones incompletas: carga infinita, contenido vacío y
overlay de error de desarrollo.

## Resumen ejecutivo

1. **¿Una persona nueva puede crear y poner en marcha un torneo sin ayuda externa?** No. El alta de organización quedó bloqueada y el camino de equipos no ofrece CTA de creación/inscripción.
2. **¿Dónde se traba?** Alta de organización; creación/inscripción de equipos; apertura de plantel; fixture; miembros; comunicaciones; programación/resultados/actas.
3. **¿Un owner puede operar cotidianamente sin conocer la arquitectura?** No todavía. Las superficies principales existen, pero hay contradicciones, términos internos y fallas de carga.
4. **¿Un jugador entiende rápidamente su torneo?** La página pública sí permite entender torneo, fixture, resultados, tabla y goleadores, pero muestra términos internos y una disciplina excesivamente larga. La identidad `qa-player` no pudo recorrerse manualmente.
5. **¿Mobile es realmente utilizable para gestión?** No evaluable con rigor en esta pasada: el control de viewport aceptó 390/430 pero la página continuó renderizando a 1280/1440. No se presentan recortes desktop como evidencia mobile.
6. **¿Cuáles son los 10 problemas de mayor impacto?** Ver “Top 10”.
7. **¿Qué funciones importantes todavía no existen?** No hay acción visible para crear/inscribir equipos en la pantalla correspondiente; el dashboard declara Partidos, Tabla, Disciplina y Comunicaciones como “Próximamente”, aunque otras superficies exponen parte de esos datos. La existencia real requiere reconciliación de producto.
8. **¿Qué requiere Preview/Staging?** Storage/uploads, social, notificaciones push/email, URL pública real, checkout/pagos e integraciones; además, una repetición integral estable de todos los roles.
9. **¿Está listo para beta cerrada?** No en el estado observado. Una beta asistida interna podría servir después de estabilizar backend y P1 de navegación/carga.
10. **¿Qué falta antes de Production?** Estabilidad, contrato único entre dashboard y datos públicos, recuperación uniforme de errores, flujos completos de owner, permisos manuales por rol, mobile real y validación remota aislada de servicios externos.

## Top 10 por impacto real

1. PostgREST LOCAL responde con timeouts/500 y bloquea rutas autenticadas.
2. Dashboard privado dice `0 partidos / Fixture pendiente`, pero la página pública muestra 28 partidos oficiales.
3. Crear organización puede quedar permanentemente en “Creando de forma segura…”.
4. El detalle de equipo/plantel queda en carga sin error ni reintento.
5. Comunicaciones puede terminar con el `<main>` vacío.
6. Equipos no muestra una acción para crear o inscribir un equipo.
7. El dashboard declara módulos “Próximamente” que ya aparecen en navegación o página pública.
8. La UI pública expone `football_5`, `league_and_playoffs`, `in_progress` y `PUBLIC`.
9. “Torneo” y “competencia” se alternan sin explicar la diferencia.
10. Disciplina pública lista decenas de jugadores sin sanción y sin búsqueda/filtro.

## Hallazgos

### QA-EXP-001 — Supabase LOCAL no sostiene el recorrido autenticado

- Tipo / severidad: **ENVIRONMENT · P1**
- Rol: owner; impacto transversal a los demás roles.
- Pantalla / viewport: rutas privadas de Torneos; desktop 1440.
- Tarea: reingresar a Torneos y recorrer equipos, fixture, miembros, plan, comunicaciones y multimedia.
- Esperado: cargas consistentes o errores recuperables en tiempo razonable.
- Ocurrido: PostgREST devolvió `500` con `57014 canceling statement due to statement timeout`, y también permaneció sin respuesta durante 10 s. La UI alternó timeouts recuperables, loaders y contenido vacío.
- Impacto: impide distinguir con confianza problemas de producto de fallas del entorno y bloquea el uso cotidiano.
- Reproducción mínima: abrir Torneos con `qa-owner`; navegar entre una ruta privada y otra; repetir o refrescar.
- Evidencia: `04-space-reentry-timeout.png`, medición directa a `/rest/v1/` y múltiples loaders registrados.

### QA-EXP-002 — Alta de organización queda bloqueada después de fallar la disponibilidad

- Tipo / severidad: **BUG · P1**
- Rol: owner nuevo.
- Pantalla / viewport: Nueva organización; desktop 1440.
- Tarea: crear la primera organización.
- Esperado: alta exitosa o error con reintento/cancelación y CTA nuevamente habilitado.
- Ocurrido: el identificador pasó a “No pudimos comprobarlo todavía”, mientras el CTA quedó deshabilitado en “Creando de forma segura…” por más de 12 s.
- Impacto: bloquea el primer paso del onboarding del organizador.
- Reproducción mínima: `/torneos/nueva-organizacion`; completar nombre e identificador; crear bajo timeout de LOCAL.
- Evidencia: `06-create-organization-stuck.png`.

### QA-EXP-003 — Detalle de equipo queda en loading sin salida

- Tipo / severidad: **BUG · P1**
- Rol: owner.
- Pantalla / viewport: Equipos > Barrio Norte FC; desktop 1440.
- Tarea: revisar plantel y responsable.
- Esperado: detalle o error recuperable con reintento.
- Ocurrido: “Confirmando acceso a la organización…” permaneció visible más de 12 s, sin timeout ni acción.
- Impacto: el owner localiza el equipo pero no puede gestionarlo.
- Reproducción mínima: Equipos; abrir Barrio Norte FC; esperar.
- Evidencia: `11-team-detail-infinite-loading.png`.

### QA-EXP-004 — Comunicaciones resuelve el shell y deja el contenido vacío

- Tipo / severidad: **BUG · P1**
- Rol: owner.
- Pantalla / viewport: Comunicaciones; desktop 1440.
- Tarea: publicar o comunicar una novedad.
- Esperado: listado/editor, empty state útil o error recuperable.
- Ocurrido: tras validar el workspace apareció sidebar/header, pero `<main>` quedó vacío.
- Impacto: no existe explicación ni próximo paso; parece una pantalla rota.
- Reproducción mínima: abrir la ruta de Comunicaciones y esperar la resolución inicial.
- Evidencia: `17-communications-blank-main.png`.

### QA-EXP-005 — Vista privada y página pública no coinciden sobre fixture y módulos

- Tipo / severidad: **BUG · P1**
- Rol: owner y público/jugador.
- Pantalla / viewport: Inicio privado y página pública; desktop 1440.
- Tarea: entender el estado real de Torneo Apertura QA 2026.
- Esperado: una única verdad sobre partidos, fixture y módulos disponibles.
- Ocurrido: Inicio privado informa “Fixture Pendiente · 0 partidos · 0 programados” y marca Partidos/Tabla/Disciplina/Comunicaciones como “Próximamente”. La página pública del mismo torneo muestra 28 partidos oficiales, resultados, tabla, goleadores y disciplina.
- Impacto: el owner no puede confiar en su tablero para decidir el próximo paso.
- Reproducción mínima: abrir Inicio con el torneo QA 2026; luego abrir su enlace público.
- Evidencia: `08-owner-dashboard-desktop.png` y `16-public-page-technical-terms.png`.

### QA-EXP-006 — No hay CTA visible para crear o inscribir equipos

- Tipo / severidad: **MISSING · P1**
- Rol: owner nuevo/experimentado.
- Pantalla / viewport: Equipos; desktop 1440.
- Tarea: crear equipos e incorporarlos a la competencia.
- Esperado: acción primaria o empty/next state que conduzca al alta/inscripción.
- Ocurrido: la pantalla ofrece resumen, filtros y “Abrir” para equipos existentes, pero no una acción de alta o inscripción.
- Impacto: rompe el recorrido “torneo → equipos → fixture” y obliga a pedir ayuda.
- Reproducción mínima: abrir Equipos como owner y buscar el CTA de alta.
- Evidencia: `10-teams-list-no-add-cta.png`.

### QA-EXP-007 — Términos internos visibles en la página pública

- Tipo / severidad: **COPY · P2**
- Rol: público, jugador y owner.
- Pantalla / viewport: página pública y bloque Página pública; desktop 1440.
- Tarea: comprender y compartir el torneo.
- Esperado: modalidad, formato y estado expresados en lenguaje natural.
- Ocurrido: aparecen `football_5`, `league_and_playoffs`, `Dataset torneos-demo-v3: in_progress.` y `PUBLIC`.
- Impacto: reduce credibilidad y presupone conocimiento del modelo interno.
- Reproducción mínima: abrir el enlace público de Torneo Apertura QA 2026.
- Evidencia: `16-public-page-technical-terms.png`.

### QA-EXP-008 — Terminología de implementación en flujos de owner

- Tipo / severidad: **COPY · P2**
- Rol: owner nuevo.
- Pantalla / viewport: landing, alta de organización, configuración; desktop 1440.
- Tarea: entender qué se crea y qué efecto tiene.
- Esperado: lenguaje de organización de torneos.
- Ocurrido: `workspace`, `active`, `slug`, “la autorización no depende del slug”, “una única operación”, “inscripciones persistidas”, “validación real” y `qa-metropolitana` quedan visibles.
- Impacto: obliga a interpretar conceptos técnicos que no ayudan a organizar la liga.
- Reproducción mínima: recorrer `/torneos`, Nueva organización, Inicio y Configuración.
- Evidencia: `05-torneos-landing-owner-desktop.png` y DOM capturado durante la pasada.

### QA-EXP-009 — “Torneo” y “competencia” cambian de significado aparente

- Tipo / severidad: **UX · P2**
- Rol: owner nuevo.
- Pantalla / viewport: sidebar, listado, wizard y dashboard; desktop 1440.
- Tarea: crear y administrar el campeonato.
- Esperado: relación explícita entre organización, temporada, torneo, competencia y categoría.
- Ocurrido: el sidebar ofrece “Torneos” y “Competencia” como destinos distintos; el CTA “Crear torneo” abre “Diseñá la competencia”; el listado se titula “Competencias configuradas”.
- Impacto: no queda claro si se está creando una entidad diferente o nombrando la misma de otra manera.
- Reproducción mínima: abrir Torneos; iniciar Crear torneo; comparar sidebar y encabezados.

### QA-EXP-010 — La tarjeta de cada torneo siempre invita a “Continuar configuración”

- Tipo / severidad: **UX · P2**
- Rol: owner.
- Pantalla / viewport: Temporadas y torneos; desktop 1440.
- Tarea: elegir qué hacer con un torneo borrador, activo o finalizado.
- Esperado: CTA contextual según estado.
- Ocurrido: borrador, en juego y finalizado comparten “Continuar configuración”.
- Impacto: no anticipa si corresponde completar, operar, revisar o consultar; también suaviza demasiado el riesgo de editar un torneo en juego/finalizado.
- Reproducción mínima: comparar las cuatro tarjetas del dataset.

### QA-EXP-011 — Cambios de estado no explican consecuencias antes de editar

- Tipo / severidad: **UX · P2**
- Rol: owner.
- Pantalla / viewport: configuración de torneo activo; desktop 1440.
- Tarea: revisar/editar un torneo “En juego”.
- Esperado: explicación clara de qué está bloqueado y qué impacto tendrá guardar.
- Ocurrido: Temporada aparece deshabilitada sin explicación; el resto mantiene CTAs de guardado, pero no se informa qué cambios son seguros ni sus consecuencias sobre fixture/planteles/publicación.
- Impacto: aumenta el temor a modificar o el riesgo de hacerlo sin comprender el efecto.
- Reproducción mínima: abrir configuración de Torneo Apertura QA 2026 en Paso 1.

### QA-EXP-012 — Disciplina pública prioriza volumen en vez de sancionados

- Tipo / severidad: **UX · P2**
- Rol: jugador, delegado, owner y público.
- Pantalla / viewport: página pública > Disciplina; desktop 1440.
- Tarea: localizar sancionados.
- Esperado: sancionados/casos relevantes primero, búsqueda o filtros.
- Ocurrido: se listan decenas de jugadores con 0 amarillas, 0 rojas y 0 fechas pendientes, sin encabezado contextual ni búsqueda.
- Impacto: encontrar a la persona sancionada exige recorrer una lista extensa.
- Reproducción mínima: abrir página pública; seleccionar Disciplina.

### QA-EXP-013 — El cambio Arma2 ↔ Torneos puede fallar al restaurar contexto

- Tipo / severidad: **BUG · P2** (amplificado por QA-EXP-001)
- Rol: owner.
- Pantalla / viewport: selector global; desktop 1440.
- Tarea: entrar, volver a Arma2 y reingresar.
- Esperado: cambio reversible y restauración de la organización activa.
- Ocurrido: la segunda entrada quedó ~12 s en “Validando tu espacio…” y finalizó en “No pudimos abrir Torneos”; el reintento volvió a fallar. En otra pestaña limpia, `/torneos` sí abrió.
- Impacto: una acción básica se siente intermitente y hace dudar si se perdió el contexto.
- Reproducción mínima: Arma2 → Torneos → Arma2 → Torneos.
- Evidencia: `04-space-reentry-timeout.png`.

### QA-EXP-014 — Overlay de desarrollo expone stack/archivo al usuario

- Tipo / severidad: **BUG · P2**
- Rol: owner.
- Pantalla / viewport: landing/selectores bajo timeout; desktop 1440.
- Tarea: abrir el workspace activo.
- Esperado: error de producto en español, sin detalles internos.
- Ocurrido: apareció “Uncaught runtime errors”, `OperationTimeoutError` y referencia a `static/js/bundle.js`.
- Impacto: no es accionable, rompe inmersión y expone detalles técnicos.
- Reproducción mínima: abrir el workspace durante timeout de LOCAL.
- Evidencia: `07-active-workspace-runtime-error.png`.

### QA-EXP-015 — Cobertura manual de roles no accesible desde el navegador disponible

- Tipo / severidad: **ENVIRONMENT · P2**
- Rol: admin, collaborator, delegate, player, outsider.
- Pantalla / viewport: transversal.
- Tarea: cambiar entre identidades QA existentes sin modificar Auth.
- Esperado: sesiones/tablas ya abiertas o selector QA seguro provisto por el entorno.
- Ocurrido: sólo había una sesión conectada (`qa-owner`) y la UI no ofrece cambio de identidad. Los storage states existen para automatización, pero no se manipularon desde esta pasada visual.
- Impacto: las diferencias de rol no pudieron validarse como experiencia humana; no se infieren desde tests.
- Reproducción mínima: abrir menú de usuario; no existe cerrar/cambiar cuenta dentro del harness conectado.

### QA-EXP-016 — Viewport solicitado no se aplicó en el navegador de QA

- Tipo / severidad: **ENVIRONMENT · P2**
- Rol: owner apurado/mobile.
- Pantalla / viewport: intento 390 y 430.
- Tarea: administrar desde teléfono.
- Esperado: `window.innerWidth` 390/430.
- Ocurrido: el navegador informó 1280/1440 aun después de aceptar el override y abrir una pestaña nueva.
- Impacto: no se puede emitir un dictamen móvil visual honesto en esta pasada.
- Reproducción mínima: fijar 390 × 844; abrir una pestaña; consultar `window.innerWidth`.
- Nota de evidencia: las capturas 12–15 son calibraciones fallidas y quedan explícitamente excluidas del análisis mobile.

## Momentos de confusión

- Al tocar el selector por primera vez apareció el onboarding general de Arma2, no el selector; fue necesario descartarlo y volver a tocar.
- En `/torneos`, tocar una organización no llevó a su dashboard ni mostró confirmación visible; el contexto cambió silenciosamente.
- “Workspace Torneos” no es lenguaje esperado por un organizador y no se entiende si es organización, cuenta o torneo.
- No fue evidente por qué existen simultáneamente “Torneos” y “Competencia” en el sidebar.
- El wizard dice “Crear torneo” y luego “Diseñá la competencia”, lo que hace dudar si son entidades distintas.
- Un torneo “En juego” conserva “Continuar configuración” y “Guardar borrador”; no se sabe qué se puede cambiar con seguridad.
- El dashboard afirma que el fixture está pendiente aunque la página pública muestra 28 partidos.
- En Equipos no hay pista de cómo agregar el noveno equipo.
- El detalle de equipo no indica cuánto esperar ni cómo reintentar.
- Comunicaciones queda vacío: no se sabe si todavía no hay comunicados, si falta elegir torneo o si falló.
- En Disciplina pública no queda claro si se muestran sancionados o todo el padrón.
- El bloque Página pública muestra simultáneamente “Publicada” y `PUBLIC`, sin valor adicional.

## Inconsistencias de vocabulario

| Términos | Observación |
|---|---|
| torneo / competencia | Parecen la misma entidad en el wizard, pero dos destinos distintos en navegación. |
| workspace / organización / espacio | Se usan para el mismo alcance sin explicación. |
| temporada activa / selector | “Activa” puede significar estado de negocio o selección actual. |
| fixture / cruces / partidos | Se alternan sin explicar generación, publicación y programación. |
| fecha / jornada | El producto usa jornada en fixture y fecha como fecha calendario; la distinción debería ser explícita. |
| responsable / delegado / capitán | Equipos muestra un nombre, pero no el rol ni su alcance. |
| Publicada / PUBLIC | Duplicación español + estado interno. |
| En juego / in_progress | Estado visible y estado interno coexisten en la página pública. |
| Fútbol 5 / football_5 | Modalidad humana vs. enum técnico. |
| Liga y playoffs / league_and_playoffs | Formato humano vs. enum técnico. |

## Auditoría “sin manual” del owner

| Tarea | Resultado | Punto de pérdida |
|---|---|---|
| Crear organización | **No** | El CTA queda bloqueado tras fallar disponibilidad. |
| Crear temporada | **Sí, con pequeñas dudas** | Formulario claro; `Identificador` no explica valor para el owner. |
| Crear competencia/torneo | **Sí, con pequeñas dudas** | Wizard claro, pero vocabulario torneo/competencia y efectos de estados son ambiguos. |
| Cargar equipos | **No** | No hay CTA visible. |
| Completar planteles | **No** | El detalle queda cargando sin salida. |
| Generar fixture | **No** | Rutas privadas no cargaron y el dashboard contradice datos existentes. |
| Programar partidos | **No** | No se alcanzó una superficie operable. |
| Cargar resultado | **No** | No se alcanzó una superficie operable. |
| Completar acta | **No** | No se alcanzó una superficie operable. |
| Consultar tabla | **Sí** | La página pública la hace encontrable y legible. |
| Administrar disciplina | **No** | Sólo se validó consulta pública; administración privada no fue alcanzable. |
| Publicar | **Sí, con pequeñas dudas** | El estado existente se entiende; `PUBLIC` y consecuencias de despublicar sobran/faltan. |
| Gestionar roles | **No** | Miembros terminó en timeout; no se pudieron comparar roles manualmente. |
| Configuración general | **Sí, con pequeñas dudas** | Guardar es claro; `workspace`, slug y campos deshabilitados sin explicación generan dudas. |

## Owner Experience Audit

### Las 10 cosas más confusas

1. Dashboard con 0 partidos frente a página pública con 28.
2. Torneo vs. competencia.
3. Organización vs. workspace vs. espacio.
4. Qué hace tocar una organización en `/torneos`.
5. Cómo crear/inscribir un equipo.
6. Qué se puede editar cuando el torneo está “En juego”.
7. Por qué Partidos/Tabla/Disciplina figuran “Próximamente” si ya hay datos públicos.
8. Si “Disciplina” muestra sancionados o todos los jugadores.
9. Qué significa “validación real” o “persistidas”.
10. Qué hacer cuando una pantalla queda cargando o vacía.

### Los 10 términos que más deberían simplificarse

`workspace`, `active`, `slug`, `PUBLIC`, `in_progress`, `football_5`,
`league_and_playoffs`, “operación única”, “inscripciones persistidas” y
“validación real”.

### Los 10 flujos con mayor fricción

Crear organización; elegir/abrir organización; reingresar a Torneos; crear o
inscribir equipo; abrir plantel; generar/revisar fixture; programar; cargar
resultado/acta; abrir miembros; publicar una comunicación.

### Pantallas que necesitan ayuda contextual

- Selector de organización: qué cambia al elegir una.
- Temporadas: diferencia entre estado activo y contexto seleccionado.
- Configuración de torneo: consecuencias de editar cada bloque según estado.
- Fixture: diferencia entre generar, revisar, publicar y programar.
- Reglas de disciplina: cuándo generan sanciones y cuándo sólo configuran umbrales.
- Roles: alcance concreto por organización/equipo.

### Pantallas que necesitan un próximo paso más evidente

- Organización recién creada.
- Torneo recién creado.
- Equipos (CTA de alta/inscripción).
- Equipo/plantel incompleto.
- Torneo sin fixture.
- Fixture sin programación.
- Comunicaciones vacía.
- Miembros sin invitaciones/roles.

### Información técnica que debería desaparecer de la UI

Enums internos, referencias a dataset, slug/autorización, “workspace”,
`active`, `PUBLIC`, `development`, “persistidas”, “operación única”, overlay de
runtime y referencias a `bundle.js`.

### Acciones importantes demasiado escondidas o ausentes

Crear/inscribir equipo; gestionar responsable/delegado; abrir el workspace desde
la tarjeta de organización; buscar sancionados; recuperación de comunicaciones;
reintento del detalle de equipo.

### Lugares donde el owner probablemente pediría ayuda

Relación temporada/torneo/competencia; alta de equipo; planteles; efectos de
“En juego”; generación/publicación del fixture; carga de acta; disciplina;
roles; mensajes vacíos o loaders prolongados.

## Clasificación LOCAL / Preview-Staging

### A — Funciona completamente en LOCAL observado

- Home tradicional y selector Arma2 ↔ Torneos (cuando el backend no interviene).
- Formularios y validaciones de cliente de temporada/torneo.
- Lectura del wizard de configuración existente.
- Página pública básica: inicio, resultados, tabla, goleadores, equipos y disciplina.

### B — Validación parcial en LOCAL

- Creación de organización y persistencia de formularios.
- Navegación privada y permisos.
- Fixture, programación, resultados y actas.
- Miembros/roles y plan.
- Comunicaciones y multimedia con flags locales.
- Publicación mediante URL loopback.

### C — Requiere Preview/Staging aislado

- Subida real de imágenes y Storage.
- Multimedia de extremo a extremo.
- Generación social.
- Push y email.
- URLs públicas reales y metadatos de sharing.
- Checkout/pagos y cambios de plan reales.
- Integraciones externas.

## Cobertura y límites

- Se ejecutó exploración visual manual, no un crawler.
- Se recorrió primer contacto, ida/vuelta de espacios, landing, alta de
  organización, temporadas, creación/configuración de torneo, dashboard,
  equipos, detalle de equipo, configuración, plan, miembros, comunicaciones,
  multimedia y página pública.
- Se probaron formularios vacíos, identificador inválido, nombre largo,
  cancelación/volver, reentrada de espacio, rutas directas, pestañas consecutivas
  y reintentos.
- No se modificó código productivo, Auth, RLS, migraciones, Staging ni Production.
- No se hizo commit, stage, push, PR, merge ni cambio de rama.
- Los roles no-owner y mobile real quedan pendientes de una repetición manual por
  las limitaciones QA-EXP-015/016; no se presentan resultados automatizados como
  sustituto de experiencia humana.
- `01-first-contact-environment-block.png` fue una captura de calibración previa
  al arranque correcto con flags LOCAL y también queda excluida de los hallazgos.

## Recomendación de salida

Mantener **REVIEW**. Antes de una beta cerrada:

1. estabilizar Supabase/PostgREST LOCAL o repetir en Preview aislado estable;
2. cerrar QA-EXP-002/003/004/005/006;
3. unificar términos y eliminar enums/copy técnico público;
4. repetir owner de punta a punta con persistencia real;
5. hacer pasada manual de admin, collaborator, delegate, player y outsider;
6. repetir owner apurado en dispositivos/viewport móviles reales;
7. validar Storage, comunicaciones, publicación, push/email y pagos en Preview.

Evidencia visual: `docs/qa/evidence/owner-exploratory-2026-08-12/`.
