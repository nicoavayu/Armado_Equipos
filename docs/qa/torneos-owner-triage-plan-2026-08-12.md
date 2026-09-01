# Arma2 Torneos — triage y planificación de la revisión owner

**Fecha:** 2026-08-12  
**Estado:** REVIEW finalizado; no implementación autorizada  
**Fuente principal:** `torneos-owner-exploratory-review-2026-08-12.md` y evidencia visual asociada  
**Alcance:** 16 hallazgos originales, recorridos privados/públicos, flujo owner, copy, estados vacíos, cobertura automatizada y requisitos de Preview/Staging  
**Fuera de alcance:** cambios de código, staging, commit, push, PR, merge, producción, `main` y autenticación  

## Criterio de clasificación

- **A — producto real:** el problema existe por la lógica, presentación o navegación del producto y puede reproducirse sin depender de la avería LOCAL.
- **B — producto disparado o amplificado por LOCAL:** la infraestructura provoca la condición, pero la interfaz tiene que terminar en un estado recuperable, explicativo y verificable.
- **C — entorno/harness:** limitación del Supabase LOCAL, build de desarrollo o herramienta de prueba; no se debe convertir automáticamente en trabajo de producto.
- Se conservan las 16 severidades del diagnóstico. No se rebajó ningún hallazgo. En `QA-EXP-014` hay evidencia para cerrarlo como no aplicable después de validar un build de producción, pero no se cambia su P2 antes de esa comprobación.

## 1. Triage de los 16 hallazgos

| ID | Severidad | Clasificación y causa probable | Producto vs. LOCAL | ¿Backend/infra? | ¿Requiere deploy? | Cobertura existente / faltante | Decisión y área sugerida |
|---|---:|---|---|---|---|---|---|
| `QA-EXP-001` | P1 | **C.** El Supabase LOCAL acepta TCP en `57322`, pero la conexión PostgreSQL y las RPC quedan en timeout; el reporte previo también registró Auth/PostgREST 500/504 y `57014`. | Principalmente LOCAL. Los síntomas de producto derivados se cubren en 002, 003, 004 y 013. | Sí: salud de Postgres/Auth/PostgREST y compatibilidad del CLI con `supabase/config.toml`. | No para corregir producto. Sí hace falta un entorno estable —LOCAL reparado o Preview— para certificar. | El crawler E2E reprodujo la inestabilidad en la pasada inicial y luego cerró 42/42; no hay un health gate que impida comenzar la revisión sobre un backend degradado. | Mantener P1 como bloqueo de certificación LOCAL. Owner: Platform/DevEx + QA. No crear un fix de UI bajo este ID. |
| `QA-EXP-002` | P1 | **B.** La creación espera preflight de slug y RPC. Existe boundary de 12 s, pero la página no tiene una prueba propia de promesa infinita y la exploración observó el CTA bloqueado más de 12 s. | LOCAL dispara el problema; producto debe finalizar en error, permitir reintento seguro y preservar idempotencia. | Puede involucrar Auth/PostgREST, pero la recuperación visible es frontend. | No para el fix lógico; Preview para validar latencia/errores reales. | Unit cubre éxito, validación, conflicto y doble submit. El primitive de timeout y el provider están cubiertos. Falta timeout en `CreateOrganizationPage`, reintento y navegación después de recuperación. | Mantener P1. Frontend Torneos + QA; Platform si la RPC excede presupuesto en entorno estable. |
| `QA-EXP-003` | P1 | **B.** El detalle del equipo queda en “Confirmando acceso…”. El servicio está envuelto por timeout, pero el guard/contexto puede encadenar cargas y no existe prueba UI de promesa infinita para esta ruta. | LOCAL amplifica; el estado no recuperable es producto. | Backend puede ser el disparador. | No para manejo de estado; Preview para prueba de extremo a extremo. | `torneosTeamsFlow` cubre caminos con datos. La corrida focalizada actual dejó la suite inestable y atrapada en carga en escenarios de lista. Falta contrato de timeout/retry del guard y del detalle. | Mantener P1. Frontend navegación/guards + QA. |
| `QA-EXP-004` | P1 | **B.** `CommunicationsAdminPage` presenta un skeleton de tres `span` sin texto ni semántica; hasta el timeout se percibe como shell/main vacío. Después sí existe error con reintento. | LOCAL causa la espera; el “blanco” y falta de feedback son producto. | Backend sólo como disparador. | No para loading/error; Preview para publicar y entregar por canales reales. | Unit cubre carga normal, composición y publicación. Falta promesa infinita, skeleton accesible, error y retry a nivel página. | Mantener P1 mientras Comunicaciones figure en navegación principal. Frontend Comunicaciones + QA/A11y. |
| `QA-EXP-005` | P1 | **A.** El dashboard usa el torneo activo canónico, pero consume un contexto de fixture que se resetea a datos vacíos durante carga/error y no inspecciona `status/error`; por eso transforma una falla en “0 partidos / Pendiente”. Además muestra módulos reales como “Próximamente”. | Producto real; LOCAL sólo hace más frecuente el error enmascarado. | No requiere cambio de fuente de verdad. Puede requerir observabilidad del RPC para diagnosticar. | No, salvo validación posterior. | Hay pruebas separadas de dashboard y página pública, pero ninguna exige paridad del mismo torneo/categoría/fixture ni distingue error de vacío. | Mantener P1. Frontend Dashboard + Domain/API + QA contractual. |
| `QA-EXP-006` | P1 | **A.** La función existe: `/equipos/nuevo`, equipo provisional o vínculo Arma2, categoría, manager e invitación, y RPC `create_tournament_team_entry`. El CTA sólo aparece si hay capability y torneo en `registration`; en `active`, `scheduled` o `draft` se oculta sin explicación. | Producto real de orientación/estado, no feature totalmente ausente. | La regla de ciclo de vida es backend y correcta para crear inscripciones; la ausencia de explicación/next step es frontend. | No para resolver el flujo. | Unit cubre la creación durante inscripciones. Falta matriz por estado/capability y CTA o explicación cuando crear ya no está permitido. | Mantener P1 y reclasificar sólo el tipo: de “missing” a UX/navegación condicionada por estado. Frontend Equipos + Producto. |
| `QA-EXP-007` | P2 | **A.** La página pública imprime `sportModality`, `competitionFormat` y descripción del torneo sin capa de presentación. El seed aporta `football_5`, `league_and_playoffs` y `Dataset … in_progress`. | Producto real; parte del contenido viene del seed, pero la vista permite la fuga. | No. | No; Preview para verificar URL pública/SEO. | La prueba pública usa enums crudos y no exige traducción; en la práctica codifica el contrato incorrecto. `PUBLIC` no aparece en el código ni en la captura revisada: requiere reproducción puntual antes de tocarlo. | Mantener P2. Frontend Público + Content/QA. |
| `QA-EXP-008` | P2 | **A.** Copy visible escrito desde la arquitectura: “workspace”, estado `active`, slug, “única operación”, “inscripciones persistidas”, “validación real”, “resolver canónico”, “snapshot” y “atómica”. | Producto real de lenguaje y confianza. | No. | No. | `torneosUnifiedExperience` incluso espera `Colaborador · active`; no hay lint/contrato de vocabulario de producto. | Mantener P2. Product Design/Content + Frontend. |
| `QA-EXP-009` | P2 | **A.** “Torneo” se usa como entidad y “competencia” como configuración/centro operativo, pero la IA no explica la relación y alterna ambos como si fueran sinónimos. | Producto real. | No. | No. | No hay prueba de vocabulario ni journey. | Mantener P2. Product Design/Content; resolver junto con onboarding. |
| `QA-EXP-010` | P2 | **A.** Las cards usan “Continuar configuración” sin considerar estado, checklist ni siguiente tarea. | Producto real. | No. | No. | No existe contrato de CTA contextual por estado. | Mantener P2. Frontend Dashboard/Torneos + Producto. |
| `QA-EXP-011` | P2 | **A.** Cambios de estado y acciones irreversibles no explican suficiente qué habilitan, bloquean o invalidan. | Producto real y de reducción de riesgo operacional. | El backend valida transiciones, pero no puede reemplazar la explicación. | No. | Integración DB cubre transiciones válidas/inválidas; falta copy/confirmación y prueba de consecuencias visibles. | Mantener P2. Producto + Frontend + Domain. |
| `QA-EXP-012` | P2 | **A.** Disciplina pública lista muchos jugadores con cero sin búsqueda, filtro ni agrupación útil. | Producto real de escalabilidad visual. | No. | No. | La prueba pública usa una fila; no cubre volumen ni “sólo con novedades”. | Mantener P2, no bloqueante de beta. Frontend Público. |
| `QA-EXP-013` | P2 | **B.** La restauración Arma2 ↔ Torneos depende de workspace preference, guard y recarga de contexto. LOCAL dispara timeouts; una pestaña fresca funcionó, señal de carrera/recuperación de estado más que de autorización. | LOCAL amplifica; la restauración robusta es producto. | Posible latencia Auth/RPC, más estado cliente. | No para el fix; sí validar en Preview y web/mobile. | Provider cubre timeout/retry unitario; la pasada E2E inicial encontró loaders y la post-fix pasó. Falta prueba repetida de switch con backend lento/fallido y restauración. | Mantener P2, pero tratar como gate de beta por frecuencia y alcance transversal. Frontend plataforma/navegación + QA. |
| `QA-EXP-014` | P2 | **C.** Overlay de desarrollo de CRA expone stack/bundle sólo en build dev. | No es un defecto del bundle productivo si el overlay desaparece allí. | No. | Requiere Preview/build release únicamente para certificar ausencia. | E2E final no registró page errors, pero no es prueba explícita del bundle productivo. | Mantener P2 hasta verificar Preview; después cerrar como no aplicable, no implementar una máscara. Owner: Release QA. |
| `QA-EXP-015` | P2 | **C.** El browser harness no permitió fijar las sesiones de roles manuales. | Limitación de la revisión, no evidencia de fallo RBAC. | Puede requerir preparación de auth states, no cambio de autorización. | Preview no es estrictamente necesario; sirve para certificación final. | Hay suites unit/E2E/DB de capabilities y roles, pero no sustituyen toda la pasada humana. | Mantener P2 como deuda de cobertura. QA/DevEx. No cambiar auth. |
| `QA-EXP-016` | P2 | **C.** El control manual no aplicó 390/430 px. | Limitación del harness, no evidencia de responsive roto. | No. | No; Preview útil para dispositivo real. | El crawler cubrió 320/360/390/430/768/1440 y terminó 42/42 sin overflow; falta confirmación visual táctil. | Mantener P2 como cobertura manual pendiente. QA. |

### Severidades

No se cambia ninguna severidad en este REVIEW. La evidencia sí justifica dos ajustes de interpretación:

1. `QA-EXP-006` sigue P1, pero la funcionalidad no falta: está oculta por estado y carece de orientación.
2. `QA-EXP-014` puede cerrarse como no aplicable si un build Preview/release confirma que el overlay no existe; no requiere “fix” de producto.

## 2. Análisis de causa raíz

### A. Problemas reales de producto

`QA-EXP-005`, `006`, `007`, `008`, `009`, `010`, `011` y `012` son independientes de la salud de LOCAL. Los tres patrones son:

- **Verdad degradada a cero:** el dashboard no diferencia `loading/error/empty/ready` del fixture.
- **Flujos habilitados pero invisibles:** crear equipo existe, pero el CTA desaparece fuera de inscripciones y no explica la razón ni el paso siguiente.
- **Arquitectura expuesta como copy:** enums, estados, slug, atomicidad, persistencia, snapshots y nombres internos llegan al owner o al público.

### B. Producto amplificado por LOCAL

`QA-EXP-002`, `003`, `004` y `013` necesitan una condición lenta/fallida para aparecer, pero siguen siendo trabajo de producto porque una interfaz no puede quedarse indefinidamente en estado transitorio. El boundary genérico de 12 s es una buena base, no una garantía de experiencia completa: cada página y cada cadena de guard + contexto debe terminar en un error con retry, preservar la acción idempotente y no presentar datos falsos.

### C. Entorno o harness

`QA-EXP-001`, `014`, `015` y `016` no deben convertirse automáticamente en PRs funcionales:

- `001`: estabilizar o sustituir LOCAL antes de certificar.
- `014`: comprobar un build productivo.
- `015`: preparar estados de sesión manuales sin cambiar RBAC.
- `016`: usar viewport/hardware confiable y conservar el crawler como red de seguridad.

## 3. Dashboard privado vs. página pública

### Fuente de verdad y entidades

Hay una sola fuente deportiva canónica en Postgres. No hay dos torneos ni dos fixtures duplicados por arquitectura.

| Lectura | Resolución | Entidades canónicas |
|---|---|---|
| Dashboard privado | `get_tournament_competition_context(organizationId)` resuelve la preferencia owner y entrega temporada/torneo activos; `get_tournament_fixture_context(organizationId, tournamentId, categoryId)` carga fixture. | `tournaments`, `tournament_categories`, `tournament_fixture_versions`, `tournament_matches`. |
| Página pública | `get_public_tournament_page(publicSlug, categorySlug)` resuelve `tournament_public_pages.tournament_id`, exige publicación/ciclo válido y toma el último fixture publicado y revisiones publicadas. | Las mismas tablas y IDs, con una proyección anónima acotada. |

Para el dataset observado, el manifiesto determinístico identifica:

- organización `a5627c00-6b91-59b8-a366-455261e6e8de`;
- torneo activo `439fd0cf-ce9d-53b7-9d6d-d64d680dafd0`, “Torneo Apertura QA 2026”;
- categoría `6e91bbd4-db52-514e-a0b7-db44b6c91aa7`;
- fixture publicado `df29a76e-eb45-5922-a937-a94f11cf0402`, con 28 partidos.

**Conclusión sobre IDs:** por contrato SQL y por el seed, privado y público apuntan al mismo `tournament_id` y el público selecciona el fixture publicado de ese torneo/categoría. La RPC pública deliberadamente no expone UUIDs, y el Postgres LOCAL no respondió durante este REVIEW, por lo que no fue posible hacer el cross-check vivo de la fila `tournament_public_pages`; ésa queda como verificación read-only de Preview, no como duda arquitectónica.

### Por qué el privado mostró `0 / Pendiente`

La explicación más probable y respaldada por código es:

1. `TorneosFixtureContext` vacía `versions` y `matches` al cambiar alcance, cargar o fallar.
2. `TorneosDashboard` calcula el resumen sólo con esos arrays y no consume `fixture.status` ni `fixture.error`.
3. Una falla o timeout se representa como un fixture legítimamente vacío: `0 partidos` y `Pendiente`.
4. La página pública hace otra llamada, anónima y acotada, y selecciona directamente el último fixture `published`; por eso sí muestra los 28 partidos.

No es evidencia de dos bases de datos. Es **divergencia de proyecciones y manejo de errores**, con posible diferencia de categoría seleccionada como segundo chequeo. La corrección debe exigir que ambas superficies informen el mismo torneo/categoría/fixture y que `error` nunca se renderice como cero real.

### Módulos privados marcados “Próximamente”

Es un placeholder hardcodeado y desactualizado del dashboard. Las rutas privadas ya existen:

- Partidos → `MatchOperationsPage`.
- Tabla, estadísticas, clasificación y disciplina → `CompetitionCenterPage`.
- Comunicaciones → `CommunicationsAdminPage`.
- Multimedia y estudio social también tienen rutas y gates propios.

La acción correcta no es duplicar la página pública en privado. Es reemplazar el bloque “Próximamente” por accesos contextuales a los módulos reales, con estado (`sin fixture`, `pendiente de actas`, `publicado`, etc.) derivado de los RPC privados.

## 4. Creación e inscripción de equipos

### Qué existe hoy

La creación de equipos sí existe y el owner puede:

- entrar a `/equipos/nuevo`;
- crear un equipo provisional o vincular uno existente de Arma2;
- elegir categoría;
- asignar/invitar manager;
- persistir la inscripción mediante `create_tournament_team_entry`;
- completar plantel y someterlo a revisión.

El backend permite crear la inscripción sólo si el torneo está en `registration`, la ventana está abierta y la categoría está activa. La UI replica parte de esa regla: `TeamsPage` sólo muestra “Agregar equipo” cuando hay capability `team_entries.create` y el torneo activo está en inscripciones.

### Por qué el owner no vio el CTA

El torneo QA estaba `active`. En ese estado la inscripción está cerrada por contrato, así que ocultar la acción destructiva es correcto; lo incorrecto es ocultarla **sin explicación ni alternativa**. El hallazgo es una mezcla de navegación, estado vacío y onboarding, con dependencia legítima del ciclo de vida backend.

### Camino esperado y puntos de ruptura

1. Crear torneo en borrador.
2. Completar categoría, reglas y checklist.
3. Pulsar “Preparar inscripción”.
4. Recibir una confirmación que explique que se habilitará Equipos.
5. Ir directamente a Equipos mediante CTA.
6. Agregar/vincular equipos, invitar managers, completar y aprobar planteles.
7. Cerrar participantes en Fixture y publicar el fixture.

Rupturas actuales:

- el CTA de equipos no aparece hasta la transición manual a inscripciones;
- la transición no ofrece un deep link claro a Equipos;
- fuera de `registration`, Equipos no explica “inscripciones no abiertas/cerradas” ni qué puede hacer el owner;
- las cards usan “Continuar configuración” sin dirigir al próximo requisito;
- los estados vacíos de Fixture usan lenguaje técnico y no siempre enlazan a Equipos/aprobaciones.

## 5. Auditoría de terminología técnica

| Término | Dónde aparece / riesgo | Acción propuesta |
|---|---|---|
| `workspace` | Crear organización (“Nuevo workspace”), landing, dashboard, switcher, shell, ajustes y plan. Confunde entidad legal/operativa con concepto técnico. | Usar **organización** para la entidad y **espacio de gestión** sólo cuando sea necesario explicar el cambio de contexto. |
| `active` | Card de organización y test `Colaborador · active`; otros estados sí están traducidos. | Mostrar **Activa/Activo**. Para selección de contexto, preferir “temporada seleccionada” en vez de “activa” si no describe ciclo de vida. |
| `published` | No se encontró crudo en la UI actual; “Publicada/Publicado” sí es lenguaje válido. | Mantener “Publicada/Publicado” y asegurar que los fallbacks no impriman el enum. |
| `automatic` | No se encontró crudo; “Generada automáticamente” y “Programar automáticamente” son comprensibles. | Mantener traducción y agregar ayuda sobre qué decide el sistema y qué puede editarse. |
| `football_5` | Tag de página pública. | **Fútbol 5**, desde un presenter/catálogo compartido. |
| `league_and_playoffs` | Tag de página pública. | **Liga y eliminatorias**, desde el mismo catálogo que privado. |
| `in_progress` | Descripción sembrada `Dataset torneos-demo-v3: in_progress.` que la página pública imprime tal cual. | Quitar metadata de seed del contenido visible y no renderizar descripciones internas como copy público. |
| `PUBLIC` | Reportado en exploración, pero no está en la captura revisada ni como literal de UI actual. El `PUBLIC` de SQL es ACL interna y no debe tocarse. | Repro focalizada en el mismo build. Si aparece en UI, traducir según contexto; no abrir trabajo hasta localizar la fuente. |
| `seed` | Internamente es clave de sorteo; la UI ya usa “Clave del sorteo” y “Orden de sorteo”. | Mantener el término interno fuera de UI; explicar “misma clave = mismo sorteo” en ayuda contextual. |
| `snapshot` | Equipo nuevo, detalle de inscripción y Plan (“Snapshot de protección”). | “Datos guardados para este torneo”, “copia fijada” o “estado de protección”, según pantalla. |
| `atomic` / “atómica” | Comunicaciones y éxito de creación; “una única operación” en organización. | “Se publica todo junto; si algo falla, no se envía nada”, o eliminar la implementación del mensaje. |
| `version` | Fixture, documentos y planteles. Es válido para auditoría, pero excesivo en tareas rutinarias. | Mantener en historial/auditoría; en flujo diario usar “actualización”, “edición vigente” o “historial”. |
| `slug` | Ayuda de creación y valor `qa-metropolitana` visible en topbar. | “Identificador público” sólo donde el owner lo edita; explicar que forma parte del enlace. Quitar el valor técnico del encabezado habitual. |
| `draft` | Resumen de fixture puede mostrar “Draft”. | **Borrador**. |
| `persistidas` | Dashboard/Fixture: “inscripciones persistidas”. | **Equipos aprobados** o **inscripciones guardadas**, según el dato real. |
| `validación real`, `resolver canónico`, `server-side`, capabilities/flags | Dashboard/Plan y ayudas escritas desde la arquitectura. | Mover a diagnóstico interno o ayuda avanzada. En producto: “validado por el sistema”, beneficios disponibles y motivo comprensible. |

Regla recomendada: crear una capa única de presentación para estados, formatos, modalidades y razones de indisponibilidad; privado, público y tests deben consumir el mismo vocabulario de producto.

## 6. Estados vacíos y pantallas placeholder

| Área | Estado actual | Evaluación | Acción requerida |
|---|---|---|---|
| Dashboard sin temporada/torneo | Explica y ofrece CTA. | Útil. | Conservar; hacer el CTA dependiente del próximo requisito. |
| Dashboard con fixture fallido | Muestra `0 / Pendiente`. | **Datos falsos por degradación.** | Estado de error con retry y diagnóstico; sólo mostrar cero cuando la RPC respondió `ready` y vacía. |
| Dashboard “Próximamente” | Partidos/Tabla/Disciplina/Comunicaciones hardcodeados. | **Placeholder obsoleto.** | Enlaces a rutas reales y estado contextual. |
| Equipos sin torneo | Explicación básica. | Parcial. | CTA a seleccionar/crear torneo. |
| Equipos sin entradas durante inscripciones | CTA “Agregar equipo” si capability. | Útil. | Añadir pasos y vínculo entre equipo provisional vs. Arma2. |
| Equipos fuera de inscripciones | CTA oculto. | **Ambiguo/bloqueante.** | Explicar estado y consecuencia; CTA a configuración si puede abrir inscripciones, o modo consulta si están cerradas. |
| Fixture sin participantes/versiones/rondas | Tiene mensajes. | Parcial; usa “persistidas” y poca orientación. | CTA directo a Equipos/aprobaciones, o a generar/publicar según etapa. |
| Comunicaciones cargando | Skeleton visual sin label. | **Se percibe vacío y no es accesible.** | `role=status`, texto “Cargando comunicaciones…”, timeout y retry. |
| Comunicaciones sin torneos | El composer puede quedar sin selección válida. | **Falta empty state primario.** | Explicar que primero se crea/selecciona un torneo y enlazar a Torneos. |
| Comunicaciones sin publicaciones | Historial vacío, composer visible. | Útil. | Mantener; aclarar que hoy sólo existe inbox interno. |
| Tabla/estadísticas/disciplina privada vacías | Explican que dependen de actas oficiales. | Buena base. | Para quien tenga permiso, CTA a Partidos/actas o recalcular cuando corresponda. |
| Disciplina pública con ceros | Lista extensa sin herramientas. | Poco útil a escala. | Por defecto “con novedades”, con búsqueda/filtro para ver todos. |
| Multimedia sin galerías/fotos | Hay copy y CTA condicionado por capability/readiness. | Parcialmente útil. | Explicar si falta torneo, plan o pipeline; nunca etiquetar “Próximamente” cuando en realidad el runtime está incompleto. |
| Miembros | “Invitar miembro · Próximamente”; vacío sin CTA. | **Función placeholder real.** | Si invitaciones no forman parte de beta, ocultar CTA deshabilitado y explicar cómo se administrará acceso. Si forman parte, es feature pendiente. |
| Plan/checkout | “Sin checkout ni cobros”, PRO “Disponible próximamente”. | Honesto, no operativo. | Mantener fuera del camino crítico; no prometer validación de pagos hasta implementar proveedor. |

## 7. Recorrido completo del owner

| Etapa | Camino esperado | ¿Orientación actual? | Ruptura principal |
|---:|---|---|---|
| 1 | Crear organización. | Parcial. | Copy técnico y bloqueo sin recuperación observado (`002`). |
| 2 | Configurar organización y miembros. | Parcial. | Invitación de miembros es placeholder; slug/workspace expuestos. |
| 3 | Crear temporada. | Sí, mediante Torneos/configuración. | “Activa” puede mezclar selección con lifecycle. |
| 4 | Crear torneo en borrador. | Sí. | Cards genéricas y competencia/torneo ambiguos. |
| 5 | Completar categoría, formato, desempates, disciplina y fechas. | Checklist existente. | Consecuencias y lenguaje técnico insuficientes. |
| 6 | Abrir inscripciones. | Existe “Preparar inscripción”. | No explica claramente que habilita Equipos ni ofrece siguiente CTA. |
| 7 | Crear/vincular equipos, invitar managers y aprobar planteles. | Funcional en `registration`. | Fuera de ese estado desaparece sin explicación; detalle puede quedar cargando. |
| 8 | Cerrar participantes, generar y publicar fixture. | Funcional; publicar cambia `registration` a `scheduled`. | Empty states poco accionables; dashboard puede ocultar el fixture real. |
| 9 | Programar partidos. | Rutas y backend existen. | El dashboard los llama “Próximamente”. |
| 10 | Poner el torneo “En juego”. | **No resuelto.** | No existe transición owner `scheduled → active` en UI ni en `change_tournament_status`. El dataset activo llega por seed/direct data. |
| 11 | Cargar actas, resultados y resolver revisiones. | Módulo Partidos existente. | Entrada poco visible desde dashboard; necesita guía por estado. |
| 12 | Ver/publicar tabla, goleadores y disciplina. | Privado y público existen. | Paridad no contratada; privado puede degradar a vacío. |
| 13 | Comunicar y publicar página pública. | Funciones base existentes. | Comunicaciones parece vacía bajo latencia; sólo inbox interno; copy público técnico. |
| 14 | Finalizar torneo/temporada. | **Incompleto para torneo.** | No existe transición owner a `completed`; la temporada sí tiene su lifecycle separado. |

### Gap suplementario de ciclo de vida

Se registra `GAP-JOURNEY-01` fuera del conteo original: **faltan transiciones producto y backend para `scheduled → active → completed`, con precondiciones, confirmaciones, auditoría y efecto sobre inscripciones, fixture, publicación y modo read-only**. Antes de implementarlo, Producto/Domain debe decidir si el inicio/fin es manual, automático por fecha/primer-último acta, o híbrido. Es bloqueante de un recorrido owner completo, aunque no fue uno de los 16 hallazgos exploratorios.

## 8. Paquetes de trabajo pequeños y revisables

### Paquete A — Resiliencia, recuperación y verdad de carga

**Objetivo:** ninguna cadena de request queda indefinida ni convierte error en vacío.

- A1: contrato de estado `loading/error/empty/ready` en dashboard y fixture; error + retry; cubre `005`.
- A2: timeout/retry/idempotencia a nivel `CreateOrganizationPage`; cubre `002`.
- A3: guards y detalle/lista de equipos bajo request lento/fallido; cubre `003` y parte de `013`.
- A4: loading accesible y error recuperable en Comunicaciones; cubre `004`.
- A5: switch Arma2 ↔ Torneos repetido con restauración y backend lento; cubre `013`.

Cada A debe ser un PR pequeño con prueba de promesa que nunca resuelve, rechazo, retry exitoso y cambio de scope durante la request.

### Paquete B — Onboarding owner y estados vacíos

**Objetivo:** cada estado indica “qué falta, por qué y qué hago ahora”.

- CTA contextual en cards en lugar de “Continuar configuración”.
- confirmación de “Preparar inscripción” y deep link a Equipos;
- estados de Equipos por `draft/registration/scheduled/active/completed` y capability;
- CTAs Equipos → Fixture → Partidos → Tabla;
- explicación de consecuencias en transiciones y acciones que invalidan publicaciones;
- definición de alcance de invitaciones a miembros.

Cubre `006`, `009`, `010`, `011` y estados vacíos relacionados.

### Paquete C — Terminología y lenguaje de producto

**Objetivo:** ninguna pantalla owner/pública expone detalles de implementación.

- presenter compartido de modalidad, formato, estados y razones;
- reemplazo de workspace/slug/snapshot/atómica/persistidas/draft;
- retirar metadata de seed del contenido visible;
- separar copy básico de diagnóstico avanzado;
- contrato/test de vocabulario para público y owner.

Cubre `007` y `008`, y reduce `009`.

### Paquete D — Consistencia público/privado

**Objetivo:** misma entidad deportiva, proyecciones coherentes y diferencias intencionales.

- contrato de IDs interno en test DB: tournament/category/fixture privado = página pública publicada;
- paridad de conteos para fixture publicado, con diferencias explícitas de seguridad;
- dashboard enlazado a módulos privados reales;
- check de categoría activa y revisión publicada;
- disciplina pública escalable.

Cubre `005`, `007`, `012` y el placeholder del dashboard.

### Paquete E — Preview/Staging y certificación

**Objetivo:** separar fallos de producto de límites LOCAL antes de la siguiente pasada humana.

- health gate del entorno;
- build release sin overlay;
- staging Supabase aislado y datos QA desechables;
- roles manuales preparados;
- viewports/dispositivos confiables;
- smoke público, Storage/Edge y telemetría sin tocar producción.

Cubre `001`, `014`, `015`, `016` y certifica los paquetes A–D.

### Paquete F — Ciclo de vida owner (nuevo, requiere decisión de Producto)

**Objetivo:** completar `scheduled → active → completed`.

No comenzar hasta definir autoridad, precondiciones y automatismo. Después dividir en: contrato DB/auditoría, UI/confirmaciones, efectos read-only/publicación y pruebas end-to-end.

## 9. Priorización beta, producción y nueva revisión humana

| ID / gap | Bloquea beta | Bloquea producción | Debe resolverse antes de nueva pasada humana | Motivo |
|---|---|---|---|---|
| `001` | Condicional: no si hay Preview estable | No como bug; sí bloquea certificación si no hay otro entorno | Sí | No repetir una pasada sobre un backend conocido como degradado. |
| `002` | Sí | Sí | Sí | Primer paso owner no puede quedar bloqueado. |
| `003` | Sí | Sí | Sí | Equipos es parte central del recorrido. |
| `004` | Sí si Comunicaciones está en nav beta | Sí | Sí | Pantalla principal aparentemente vacía. |
| `005` | Sí | Sí | Sí | Dashboard presenta datos deportivos falsos. |
| `006` | Sí | Sí | Sí | El owner no descubre el camino de inscripción. |
| `007` | No para beta cerrada | Sí | Sí | Calidad pública y confianza; además es cambio acotado. |
| `008` | No para beta asistida | Sí para autoservicio | Sí | La próxima revisión perdería tiempo reportando copy ya localizado. |
| `009` | Sí para beta autoguiada; no para asistida | Sí para autoservicio | Sí | Afecta el modelo mental del journey completo. |
| `010` | No | No por sí solo | Sí | Impide evaluar si el onboarding nuevo funciona. |
| `011` | Sí | Sí | Sí | Operaciones de estado requieren consecuencias claras. |
| `012` | No | No para lanzamiento inicial | No | Mejora de escala; puede seguir al core. |
| `013` | Sí | Sí | Sí | Navegación transversal y restauración de contexto. |
| `014` | No | Sólo certificación del build | No si la review usa Preview | Se cierra comprobando que el overlay no se empaqueta. |
| `015` | No | Sí como cobertura de release | No para review owner; sí para review RBAC | Es deuda de validación, no bug probado. |
| `016` | No | Sí como cobertura responsive | Sí si la siguiente pasada incluye mobile | E2E pasó, pero falta inspección manual real. |
| `GAP-JOURNEY-01` | Sí para beta de journey completo | Sí | Sí después de decisión/implementación | No existe forma soportada de empezar/finalizar la competencia. |

**Conteo estricto:** si “bloqueantes” significa los seis P1 originales y se resuelven/certifican los seis, quedan **10 hallazgos originales P2**. Además queda `GAP-JOURNEY-01` como gap nuevo hasta incorporarlo formalmente. Para una beta owner autoguiada, también deben tratarse como gates los P2 `009`, `011` y `013`, aunque el conteo histórico de severidad no cambie.

## 10. Requisitos para Preview/Staging

### Base mínima

- Proyecto Supabase staging aislado; el código autoriza el ref `hhyvmhgpapyuzjgxfnqv` fuera de producción.
- Variables de Preview con `REACT_APP_DATA_ENV=staging`, URL/key de Supabase staging y flags Torneos explícitas.
- Build release, no dev server; sourcemaps/telemetría según política y sin overlay visual.
- Migraciones aplicadas por el runbook existente, datos QA reproducibles y rollback ensayado; ninguna conexión a producción.
- `REACT_APP_PUBLIC_APP_URL` con dominio Preview y routing directo para `/torneos/publico/:slug`.
- Health checks de Auth, PostgREST/RPC, DB y Storage antes de iniciar la review.
- Usuarios/estados manuales para owner/admin/collaborator/delegate/player, con datos no productivos.

### Feature flags a revisar

- Core: `REACT_APP_TORNEOS_ENABLED`, `WORKSPACES`, `SWITCHER`, `DEEP_LINKS`, `NOTIFICATIONS`, `OFFICIAL_STATS`.
- Público: `REACT_APP_TORNEOS_PUBLIC_PAGES_ENABLED`.
- Multimedia: `REACT_APP_TORNEOS_MEDIA_ENABLED`, `MEDIA_UPLOAD_ENABLED` y readiness de signer, worker, antivirus, cleanup y observabilidad.
- Social: `REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED`.
- Producción permanece forzada a off por el código actual; este REVIEW no autoriza cambiarlo.

### Qué puede validarse LOCAL

- lógica de presentación, copy, navegación, estados vacíos;
- unit/component tests de retry, timeout, idempotencia y cambio de scope;
- contratos DB en PostgreSQL embebido/sano;
- responsive automatizado y canvas básico;
- inbox interno de Comunicaciones;
- creación de equipos, fixture, actas, tabla y disciplina con datos determinísticos.

### Qué necesita Preview o servicios externos

- URLs públicas reales, refresh/deep links, CORS, assets, cache, OG/social bots y descarga desde otro dispositivo;
- Storage multimedia completo: buckets, signer, processor, secreto de attestación, antivirus, variantes, cleanup y observabilidad;
- push real: tokens de dispositivo, sender/scheduler y credenciales del proveedor;
- email real: hoy está desactivado/no implementado; primero hace falta proveedor y canal, luego sandbox, secretos y webhooks;
- checkout/pagos: hoy no existe (“Sin checkout ni cobros”); no es certificable sólo con flags. Requiere implementación posterior con proveedor sandbox, webhook, idempotencia y resolver de plan;
- social generator: la composición básica es local; Preview valida fuentes/assets remotos, CORS, descarga y entitlements reales;
- autenticación y restauración de sesión en dominio/browser/mobile reales;
- telemetría de latencia/error para distinguir timeout frontend de degradación Supabase.

### Gate propuesto antes de la siguiente review

1. Health check verde durante una ventana sostenida.
2. Smoke owner de organización → torneo → inscripciones → equipos → fixture.
3. Smoke anónimo de página pública y refresh directo.
4. Una sesión por rol preparada y verificada.
5. Build release confirmado sin overlay.
6. Viewports 390/430 y un dispositivo táctil real.

## 11. Resumen ejecutivo

**Estado:** **No todavía** para beta owner autoguiada o producción. La base funcional es amplia, pero el dashboard puede mentir sobre datos, el flujo de equipos queda oculto por estado, hay cargas no recuperables observadas y el ciclo de vida owner no permite pasar de programado a en juego/finalizado.

**Después de resolver los seis P1 originales quedarían 10 hallazgos P2 originales**, más `GAP-JOURNEY-01` pendiente de incorporación. Algunos P2 —context switch, consecuencias de estado y semántica del journey— siguen siendo gates de una beta autoguiada.

### Top 5 de trabajo inmediato

1. Corregir la verdad del dashboard: error ≠ vacío, paridad de torneo/categoría/fixture y enlaces a módulos reales.
2. Hacer explícito el camino torneo → abrir inscripciones → equipos → fixture, con CTAs y consecuencias por estado.
3. Cerrar recuperación de creación, guards/equipos, Comunicaciones y switch Arma2 ↔ Torneos con pruebas de timeout/retry.
4. Definir e implementar el ciclo `scheduled → active → completed` antes de declarar completo el journey owner.
5. Montar un Preview aislado y estable; luego limpiar enums/copy técnico antes de la nueva pasada humana.

## Verificación realizada en este REVIEW

- Lectura del reporte, matriz, capturas y reportes E2E previo/post-fix.
- Trazado estático de componentes, providers, services, feature flags, SQL/RPC, migraciones y seed determinístico.
- Confirmación de que LOCAL acepta el puerto pero PostgreSQL no responde; no se insistió después de los intentos acotados.
- Revisión focalizada de 7 suites: 6 suites pasaron y `torneosTeamsFlow` falló. La corrida conjunta informó 51/52 tests; aislada, la suite informó 4/6, con dos escenarios detenidos en carga/guard. Se considera evidencia de fragilidad/contaminación de estado de la cobertura actual, no cierre de los hallazgos.
- No se modificó código, no se cambió auth, no se ejecutó deploy, staging, commit, stage, push, PR, merge, producción ni `main`.
