# Arma2 Torneos — Owner Journey focal

Fecha: 2026-08-12  
Estado de entrega: **REVIEW**  
Branch: `feature/torneos-space-switcher`  
Entorno objetivo: Supabase LOCAL + React LOCAL  

## Dictamen

La pasada focal deja orientados y cubiertos por tests los tramos que el contrato
actual sí permite: configuración, apertura/cierre reversible de inscripción,
equipos, planteles, preparación/publicación del fixture, programación y
operación de competencias que ya estén activas.

No se simuló ninguna transición en frontend. El recorrido completo sigue
teniendo dos límites de backend: no existe una transición persistida para
`scheduled -> active` ni para `active -> completed`. Tampoco existe una
operación atómica y segura para reemplazar un equipo durante una competencia en
juego. Esos tres puntos requieren definición/autorización antes de una migración
o RPC.

La validación automatizada de componentes y dominio pasó. Se renovaron sólo los
storage states locales de los seis usuarios QA existentes, mediante el harness
que declara `authMutations: false`; no se crearon ni modificaron usuarios. El
crawler autenticado y una pasada focal confirmaron Inicio, Equipos y Fixture.
Supabase LOCAL sigue presentando timeouts intermitentes en rutas no focales, que
se detallan como limitación del entorno.

## 1. Máquina de estados real

La restricción canónica de `public.tournaments.status` admite:

| Estado persistido | Presentación owner | Significado observado |
| --- | --- | --- |
| `draft` | **Borrador** | Configuración previa a recibir equipos. |
| `registration` | **Inscripción de equipos** | Alta normal de equipos y edición normal de planteles, además limitada por las fechas de inscripción. |
| `scheduled` | **Lista para comenzar** | Fixture publicado; alta normal cerrada; programación previa al comienzo. |
| `active` | **En juego** | Operación deportiva de partidos, resultados y actas. |
| `completed` | **Finalizada** | Consulta del cierre deportivo e histórico. |
| `archived` | **Archivada** | Fuera de la operación habitual; sin retorno soportado. |

Fuentes de verdad inspeccionadas:

- constraint de estados: `supabase/migrations/20260727090000_arma2_canonical_baseline.sql:39878`;
- `change_tournament_status`: línea 3629;
- `publish_tournament_fixture`: línea 19159;
- `reopen_tournament_participants`: línea 21600;
- `withdraw_tournament_team_entry`: línea 36156;
- participantes congelados y estados `active | withdrawn | archived`: línea 37795.

### Transiciones soportadas

| Origen | Destino | Operación real | Consecuencias presentadas antes de confirmar |
| --- | --- | --- | --- |
| Borrador | Inscripción de equipos | `change_tournament_status` | Requiere checklist backend listo; habilita alta y planteles dentro de fechas; configuración sigue editable; permite volver a Borrador. |
| Borrador | Archivada | `change_tournament_status` | Sale de selección operativa, limpia el torneo activo de preferencias, conserva datos y no ofrece desarchivado. |
| Inscripción de equipos | Borrador | `change_tournament_status` | Pausa alta normal y edición normal de planteles; conserva inscripciones; planteles observados todavía pueden corregirse; puede reabrirse. |
| Inscripción de equipos | Archivada | `change_tournament_status` | Cierra inscripción, limpia selección activa, conserva lo persistido y no ofrece desarchivado. |
| Inscripción de equipos | Lista para comenzar | `publish_tournament_fixture` | Valida y publica la versión, cierra alta/edición normal, mantiene revisión de inscripciones presentadas y conserva la publicación anterior como reemplazada. |
| Lista para comenzar | Lista para comenzar | `publish_tournament_fixture` | Publica una nueva versión, conserva la anterior como reemplazada y obliga a revisar la programación sobre la versión vigente. |

`reopen_tournament_participants` sólo es válido en Inscripción o Lista para
comenzar. Reabre el conjunto congelado, archiva borradores de fixture, invalida
versiones publicadas/reemplazadas y exige regeneración. No constituye un camino
para reemplazar participantes durante una competencia en juego.

### Transiciones faltantes

- **Lista para comenzar -> En juego:** no existe RPC/transición persistida para owner.
- **En juego -> Finalizada:** no existe RPC/transición persistida para owner.
- No hay retroceso ni desarchivado soportado para estados posteriores.

Para cerrar el ciclo de vida se necesita un contrato backend explícito para
ambas transiciones, con capability, precondiciones, auditoría, concurrencia y
regla de reversibilidad. Como mínimo hay que decidir:

1. qué programación mínima permite comenzar;
2. qué se habilita/bloquea al comenzar;
3. si el comienzo puede revertirse y bajo qué condición;
4. qué partidos/resultados/sanciones pendientes impiden finalizar;
5. qué cierre de tabla/estadísticas se conserva;
6. si finalizar es reversible y cómo se audita.

## 2. Orientación del owner

Se agregó una presentación única del ciclo de vida y un bloque contextual de
**Próximo paso**. El dashboard conduce según datos reales:

1. completar configuración o abrir inscripción;
2. agregar equipos;
3. completar/revisar planteles;
4. cerrar participantes;
5. generar y publicar fixture;
6. programar partidos;
7. informar el límite backend antes de poner en juego;
8. operar partidos cuando la competencia ya está En juego;
9. consultar tabla final cuando ya está Finalizada.

Las tarjetas de competencias ahora usan acciones contextuales en lugar de
“Continuar configuración” para todos los estados. La configuración estructural
queda editable sólo en Borrador e Inscripción; en etapas posteriores explica el
modo de consulta. Las confirmaciones de estado y publicación describen efectos
concretos y reversibilidad.

No se muestran enums/slugs en estas superficies. Se retiró de los textos
tocados lenguaje como “workspace”, “seed” y “fotografía auditable”.

## 3. Flujo de equipos

- En Inscripción, y dentro de las fechas configuradas, aparece **Agregar equipo**.
- Antes de la apertura se explica que primero hay que completar la configuración y abrir Inscripción.
- Si la fecha de apertura todavía no llegó, se informa que el período aún no comenzó.
- Si venció la fecha o el torneo está Lista para comenzar, se informa que la inscripción normal está cerrada y por qué.
- En juego se explica que un retiro/reemplazo es extraordinario y debe preservar el historial; no se ofrece una UI falsa.
- Finalizada y Archivada quedan en consulta, con explicación contextual.
- El empty state sin equipos indica motivo, próximo paso y CTA real cuando está permitido.
- El alta directa también aplica el mismo guard de estado y fechas; no depende sólo de ocultar el botón.

## 4. Baja y reemplazo excepcional

### Lo que existe hoy

`withdraw_tournament_team_entry` permite marcar la inscripción original como
`withdrawn`, exige un motivo, conserva la fila y agrega auditoría. Al exigir
solamente que el torneo no esté archivado, la función puede retirar una entrada
incluso en una competencia En juego o Finalizada.

Eso **no completa un reemplazo seguro**. La RPC no actualiza el participante
congelado, el fixture, partidos futuros, tabla, estadísticas, sanciones ni
planteles, y no incorpora una nueva inscripción. Los partidos están vinculados
a participantes congelados con identidad/snapshot propio y FK restrictiva a la
entrada original; eso ayuda a conservar historia, pero impide inferir una
sustitución silenciosa.

Por lo tanto no se construyó “Reemplazar equipo”. También queda como hallazgo de
contrato que permitir una baja aislada en En juego/Finalizada puede dejar
representaciones divergentes entre entrada, participante y superficies públicas.

### Contrato backend necesario

Se necesita una RPC atómica extraordinaria —nombre a definir— que:

1. bloquee torneo, participante, fixture y partidos afectados;
2. valide estado/capability y exija motivo;
3. marque al saliente como retirado sin borrar ni renombrar historia;
4. cree una entrada y participante distintos para el entrante;
5. seleccione y reasigne sólo compromisos futuros elegibles;
6. nunca reescriba partidos jugados, eventos, actas, goles, tarjetas, estadísticas o sanciones históricas;
7. defina el efecto en tabla y desempates;
8. conserve una relación explícita de sucesión y auditoría antes/después;
9. defina reversión/idempotencia y actualización coherente de la página pública.

### Puntos y posición: decisión de producto pendiente

| Alternativa | Impacto | Evaluación |
| --- | --- | --- |
| **A. Empieza desde cero** | El entrante no hereda puntos ni estadísticas. La identidad histórica queda limpia; hay que definir cómo entra en tabla y qué sucede con compromisos pendientes. | Recomendación por integridad y comprensión, salvo que el reglamento exija continuidad deportiva. |
| **B. Hereda la situación deportiva** | Facilita continuidad operativa, pero mezcla posición acumulada con una identidad nueva. Necesita linaje explícito y un registro de totales transferidos; nunca cambiar `team_id` ni atribuir eventos viejos al entrante. | Posible sólo con decisión reglamentaria y modelado backend específico. |

El modelo actual no implementa de forma segura ninguna de las dos alternativas
para una competencia ya iniciada. La decisión requerida es: **cero vs.
continuidad deportiva**, tratamiento de los partidos pendientes y reversibilidad.

## 5. Dashboard, paridad y módulos

- La consulta de equipos y la de fixture distinguen `loading`, `ready` y `error`.
- Un resultado cargado y vacío muestra `0`; una consulta fallida muestra un error recuperable con **Reintentar**.
- El resumen de programación sólo deriva cantidades de un fixture cargado correctamente y usa `scheduled_at` como fuente de verdad, no un status ambiguo.
- La pasada autenticada encontró y corrigió una contradicción adicional: Inicio y Fixture ahora coinciden en **31 partidos · 12 programados** y el dashboard informa **19 sin horario** para el dataset activo.
- Después de publicar fixture se refresca el contexto de competencia para reflejar inmediatamente **Lista para comenzar**.
- Los módulos que decían “Próximamente” pese a tener superficies existentes se conectaron a **Partidos**, **Tabla**, **Disciplina** y **Comunicaciones**.
- No se creó ninguna feature grande nueva ni se tocó multimedia/social/push/email/pagos.

Esto elimina la causa frontend identificada de “error = 0” y la divergencia de
conteos entre superficies privadas. La pasada autenticada no registró errores de
consola en Inicio, Equipos o Fixture.

## 6. `torneosTeamsFlow`

No se reprodujo la inestabilidad reportada:

- 6/6 casos pasan en ejecución focal;
- cinco repeticiones secuenciales completas pasan;
- seis procesos Jest concurrentes bajo carga pasan;
- no aparecieron race, timeout, navegación dependiente ni guard incorrecto.

Conclusión: con el estado actual el flujo unitario es determinista. No se
agregaron retries ciegos. Persisten warnings no bloqueantes de deprecación de
`act` y future flags de React Router.

## 7. Cobertura y validaciones

| Validación | Resultado |
| --- | --- |
| Focal: ciclo, equipos, competencia, fixture context y publicación | **PASS — 5 suites, 32 tests** |
| `torneosTeamsFlow` repetido | **PASS — 5/5 secuenciales y 6/6 procesos concurrentes** |
| Suite completa React/Jest | **PASS — 272 suites, 2136 tests** |
| ESLint completo `src/` | **PASS** |
| Build producción | **PASS** |
| `git diff --check` | **PASS** |
| Guards QA estáticos | **65 pass, 5 fail, 5 skip** |
| Integración DB: competition/teams/fixture/matches/standings | **BLOQUEADA por runtime LOCAL** |

Los cinco guards fallidos comparten una sola condición del harness preexistente:
el mapa de identidad V2 es un symlink y el loader exige un archivo regular no
symlink. No se cambió ese artefacto porque no pertenece al foco y está ligado a
las identidades/dataset QA.

Los tests de integración DB no llegaron a ejecutar aserciones: el PostgreSQL
embebido no puede cargar `libicudata.77.dylib`. Algunos scripts imprimen conteos
engañosos o terminan con código 0 pese a ese fallo; se clasifican como bloqueados,
no como aprobados. `supabase status` tampoco encuentra el contenedor esperado
`supabase_db_arma2`, aunque existen listeners LOCAL.

## 8. Crawler y QA exploratorio post-fix

El primer intento mostró que el storage state existente de `qa-owner` había
expirado. Se ejecutó el preparador local ya incluido, que consulta los seis
usuarios existentes y genera JWT/storage state sin mutaciones de Auth ni del
dataset. Después se hicieron dos ejecuciones autenticadas del crawler owner
desktop (1440 × 900):

- **Ejecución 1:** 16/17 escenarios sin hallazgos; único hallazgo: loading gate
  en Miembros.
- **Ejecución final:** 15/17 escenarios sin hallazgos; Miembros cargó, pero
  `/torneos` y Temporadas mostraron el error recuperable de timeout.
- La variación entre ambas ejecuciones caracteriza inestabilidad LOCAL: el
  mismo escenario Miembros falla y luego pasa, mientras otras rutas pasan y
  luego agotan el timeout.
- La última medición directa de PostgREST respondió HTTP 200 en 0,58 s, otra
  señal de comportamiento transitorio.
- Warnings de la ejecución final: 46 future flags de React Router, 52 requests
  abortados por navegación y 5 rutas lentas; no se convirtieron en ausencia de
  datos.

La pasada focal autenticada adicional comprobó, sin escribir datos:

- Inicio muestra **En juego**, “Cargá resultados y actas”, 31 partidos, 12
  programados, 19 sin horario y enlaces a Partidos/Tabla/Disciplina/Comunicaciones;
- Equipos explica **La inscripción de equipos está cerrada** y el carácter
  extraordinario del retiro/reemplazo;
- Fixture muestra los mismos 31 partidos y 12 programados;
- las tres rutas terminaron sin errores de consola.

Evidencia:

- `artifacts/playwright/test-results/torneos-local-scenario-cra-e7a50-records-objective-anomalies-chromium-desktop-1440x900/crawler-owner.json`;
- `artifacts/playwright/test-results/torneos-local-scenario-cra-e7a50-records-objective-anomalies-chromium-desktop-1440x900/` (screenshot, video, trace y diagnósticos de la ejecución final).

No se ejecutaron altas reales de organización/temporada/competencia para no
modificar el dataset canónico sin un fixture aislado y reproducible.

### Respuestas explícitas solicitadas

| Pregunta | Resultado |
| --- | --- |
| Crear organización sin manual | **No certificable**: no se hizo un alta destructiva sobre el dataset canónico; la ruta general cargó en una de dos pasadas y agotó timeout en la otra. |
| Crear temporada y competencia | **No certificable**: no había fixture aislado para crear registros; Temporadas cargó en una pasada y agotó timeout en la otra. |
| Llegar a agregar equipos | **Sí**: Equipos cargó autenticado; el CTA aparece por contrato/test cuando Inscripción está abierta. |
| Entender por qué no puedo agregar equipos | **Sí**: en la competencia activa se leyó la explicación de inscripción cerrada y reemplazo extraordinario. |
| Llegar de equipos a fixture | **Sí**: ambas superficies cargaron autenticadas y están enlazadas. |
| Llegar de fixture a programación | **Sí**: Fixture cargó y expuso Programación con conteos coherentes. |
| Llevar la competencia a En juego | **Backend no soportado**. |
| Cargar resultado/acta | **Sí para llegar a la operación**: Inicio en En juego ofrece “Abrir partidos”; no se guardó un resultado real para preservar datos. |
| Finalizar competencia | **Backend no soportado**. |
| Dashboard distingue 0 de error | **Sí**, cubierto por tests y con timeout mostrado como error recuperable en crawler. |
| Owner entiende estado y próximo paso | **Sí**: validado en Inicio autenticado para la etapa En juego. |
| Reemplazo excepcional seguro | **Requiere decisión y backend**. |

### Claridad por tramo del journey

| Tramo | Clasificación post-fix | Motivo |
| --- | --- | --- |
| Crear organización y temporada | **Bloqueado para validar** | No hay fixture aislado para crear sin alterar el dataset; además LOCAL es intermitente. |
| Crear/configurar competencia | **Claro con pequeñas dudas** | Estado, significado y CTA quedan explícitos; no se guardó una competencia nueva. |
| Abrir inscripción | **Claro** | Guard, consecuencia y reversibilidad explícitos. |
| Agregar equipos/completar planteles | **Claro** | CTA válido, empty state y explicación de cierre compartida por lista/alta. |
| Cerrar participantes/generar fixture | **Claro** | Next step contextual y rutas existentes. |
| Publicar fixture | **Claro** | Consecuencias concretas antes de confirmar y refresh posterior. |
| Programar | **Claro** | Inicio y Fixture comparten conteos derivados de fecha/hora persistida. |
| Poner en juego | **Bloqueado** | Falta transición backend. |
| Operar resultados/actas/tabla/estadísticas/disciplina | **Claro con pequeñas dudas** | Superficies autenticadas y enlazadas; no se persistió un resultado nuevo. |
| Finalizar/histórico | **Bloqueado** | Falta transición backend; consulta de estados ya finalizados sí está orientada. |
| Baja/reemplazo excepcional | **Bloqueado** | Retiro aislado existe; reemplazo coherente y política deportiva no. |

## 9. Archivos de esta pasada focal

- `src/features/torneos/domain/competitionLifecycle.js`
- `src/features/torneos/domain/competitionCatalog.js`
- `src/features/torneos/components/TeamsPage.jsx`
- `src/features/torneos/components/NewTeamEntryPage.jsx`
- `src/features/torneos/components/TeamRegistration.module.css`
- `src/features/torneos/components/TorneosDashboard.jsx`
- `src/features/torneos/components/TorneosShell.module.css`
- `src/features/torneos/components/TournamentWizardPage.jsx`
- `src/features/torneos/components/CompetitionCore.module.css`
- `src/features/torneos/components/CompetitionOverviewPage.jsx`
- `src/features/torneos/components/FixtureWorkspacePage.jsx`
- `src/features/torneos/components/FixtureWorkspace.module.css`
- `src/features/torneos/context/TorneosFixtureContext.jsx`
- `src/__tests__/competitionLifecycle.test.js`
- `src/__tests__/torneosTeamsFlow.test.jsx`
- `src/__tests__/torneosCompetitionFlow.test.jsx`
- `src/__tests__/fixtureWorkspacePage.test.jsx`

El worktree ya contenía una pasada REVIEW amplia sin commit; esta lista separa
los archivos del foco actual del resto de cambios preexistentes. No se ejecutó
stage, commit, push, PR, merge ni deploy.

## 10. URLs LOCAL para revisión

React LOCAL continúa activo en `http://127.0.0.1:3000` (PID observado: 61796).
La organización QA inventariada es
`a5627c00-6b91-59b8-a366-455261e6e8de`.

- Entrada: `http://127.0.0.1:3000/torneos`
- Inicio owner: `http://127.0.0.1:3000/torneos/organizacion/a5627c00-6b91-59b8-a366-455261e6e8de/inicio`
- Temporadas/torneos: `http://127.0.0.1:3000/torneos/organizacion/a5627c00-6b91-59b8-a366-455261e6e8de/torneos`
- Equipos: `http://127.0.0.1:3000/torneos/organizacion/a5627c00-6b91-59b8-a366-455261e6e8de/equipos`
- Fixture: `http://127.0.0.1:3000/torneos/organizacion/a5627c00-6b91-59b8-a366-455261e6e8de/fixture`
- Programación: `http://127.0.0.1:3000/torneos/organizacion/a5627c00-6b91-59b8-a366-455261e6e8de/programacion`
- Partidos: `http://127.0.0.1:3000/torneos/organizacion/a5627c00-6b91-59b8-a366-455261e6e8de/partidos`
- Tabla: `http://127.0.0.1:3000/torneos/organizacion/a5627c00-6b91-59b8-a366-455261e6e8de/competencia/tabla`
- Estadísticas: `http://127.0.0.1:3000/torneos/organizacion/a5627c00-6b91-59b8-a366-455261e6e8de/competencia/estadisticas`
- Disciplina: `http://127.0.0.1:3000/torneos/organizacion/a5627c00-6b91-59b8-a366-455261e6e8de/competencia/disciplina`
- Comunicaciones: `http://127.0.0.1:3000/torneos/organizacion/a5627c00-6b91-59b8-a366-455261e6e8de/comunicaciones`

Las sesiones LOCAL quedaron renovadas sin mutaciones de Auth. Antes de promover
el dictamen más allá de REVIEW corresponde estabilizar los timeouts LOCAL,
preparar un fixture aislado para probar altas/operaciones con escritura y definir
los contratos backend de inicio, finalización y reemplazo.
