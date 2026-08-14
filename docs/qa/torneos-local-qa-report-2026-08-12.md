# Arma2 Torneos — QA LOCAL determinista

Fecha: 2026-08-12  
Estado: **REVIEW**  
Branch: `feature/torneos-space-switcher`  
Commit observado: `e1068460`  
Backend: Supabase LOCAL `arma2-torneos-qa-seed`  
Semilla: `QA_SCENARIO_SEED=20260812`  
Zona horaria de referencia: `America/Argentina/Buenos_Aires`

## Resumen ejecutivo

La pasada detectó tres problemas P1 distintos y un problema legacy P3. No se
encontraron P0, páginas blancas, error boundaries, overflow horizontal, controles
fijos fuera del viewport, loops de redirección ni redirecciones inesperadas a login.

El hallazgo dominante es intermitencia severa del backend LOCAL: Auth y PostgREST
devolvieron `500/504` por timeout de conexión/statement y la UI permaneció en un
loading gate sin una salida visible. La misma condición contaminó parte de los
resultados de permisos y navegación; esos fallos derivados se agrupan bajo un solo
bug y no se cuentan individualmente.

No se corrigió lógica productiva. No se creó commit, stage, push, PR, merge ni
deploy, y no se modificó Auth.

## Bugs nuevos detectados en esta revisión

### QA-TOR-P1-001 — loading gate indefinido ante timeout de Supabase LOCAL

- Severidad: **P1** — bloquea los flujos principales de Torneos.
- Scenario IDs: `TQ-SPACE-DEEP-LINK`, `TQ-ORG-COMPLETE`,
  `TQ-SEASON-MULTI-COMP`, `TQ-FIXTURE-COMPLETE`, `TQ-STANDINGS-TIED`,
  `TQ-MATCH-WITH-EVENTS`, `TQ-ROLE-DENIED-CONFIG` y otros recorridos derivados.
- Roles: owner, delegate, player, collaborator y outsider; admin también presentó
  cargas lentas/intermitentes.
- URLs: `/torneos`, rutas de organización y rutas del hub participante.
- Viewports observados: 768 y 1440 de forma fuerte; casos aislados en 430.
- Pasos mínimos:
  1. Abrir `/torneos` con una sesión QA preparada.
  2. Navegar repetidamente entre landing, organización y hub participante.
  3. Esperar más de 5–16 segundos.
- Esperado: datos o una pantalla de error recuperable con reintento.
- Obtenido: `Resolviendo tu experiencia de Torneos…`, `Validando tu espacio…` o
  `Cargando centro del torneo…` permanece visible; los elementos críticos de la
  pantalla destino nunca aparecen.
- Error técnico:
  - Auth: `504 request_timeout`, fallo SASL con `i/o timeout` al conectar a DB.
  - PostgREST: `PGRST003 Timed out acquiring connection from connection pool`.
  - PostgreSQL/PostgREST: `57014 canceling statement due to statement timeout`.
  - Se observaron respuestas `500/504` en `get_tournament_workspace_context`,
    `get_my_tournament_memberships`, `get_tournament_participant_hub` y lecturas
    de `usuarios`.
- Reproducibilidad: intermitente pero repetida en tres pasadas automatizadas y
  confirmada en el Browser in-app; el loading seguía activo tras 16 segundos.
- Área posible: `TorneosWorkspaceContext.jsx`, `TorneosLanding.jsx`,
  `OrganizationRouteGuard.jsx`, `TournamentHubPage.jsx`,
  `tournamentWorkspaceService.js` y/o recursos de la stack Supabase LOCAL.
- Nota: el DB respondió normalmente a consultas directas entre episodios; el
  problema se manifestó especialmente en Auth/PostgREST bajo navegación E2E.

### QA-TOR-P1-002 — collaborator accede a Configuración contra el contrato E2E vigente

- Severidad: **P1** — contrato de permisos/routing incorrecto.
- Scenario ID: `TQ-ROLE-DENIED-CONFIG`.
- Rol: collaborator.
- URL:
  `/torneos/organizacion/a5627c00-6b91-59b8-a366-455261e6e8de/configuracion`.
- Pasos mínimos:
  1. Entrar como `qa-collaborator`.
  2. Abrir directamente la URL anterior.
- Esperado: el contrato de `torneos-shell.prepared.spec.js` exige redirección a
  `/torneos` para todo rol no admin.
- Obtenido: la ruta permanece abierta y muestra datos de configuración en
  `Modo lectura · Tu rol no permite editar la organización`.
- Error técnico: no hay crash; es una divergencia explícita entre el guard y el
  contrato E2E existente.
- Reproducibilidad: consistente en 1440 y 768 cuando el workspace resolvió; el
  test preparado falló también en viewports móviles, aunque varias repeticiones
  estuvieron afectadas por QA-TOR-P1-001.
- Área posible: `OrganizationRouteGuard.jsx`, `OrganizationSettingsPage.jsx`,
  definición de capacidades y contrato `torneos-shell.prepared.spec.js`.
- Riesgo: no se comprobó bypass de escritura; la pantalla declara modo lectura.
  La exposición de datos y la divergencia de routing requieren decisión de
  producto/seguridad antes de reclasificar.

### QA-TOR-P1-003 — cambio de torneo deja contexto desalineado y los RPC de fixture responden 403

- Severidad: **P1** — el owner no puede abrir Fixture/Partidos de datasets edge.
- Scenario IDs: `TQ-COMP-ODD-5`, `TQ-TIME-NOW-PLUS-5`,
  `TQ-VOLUME-20-240-190`.
- Rol: owner.
- URLs:
  - `/torneos/organizacion/6cc3d141-1b44-5191-b74c-1a91fe81d9f1/fixture/jornadas`
  - `/torneos/organizacion/6cc3d141-1b44-5191-b74c-1a91fe81d9f1/partidos`
  - `/torneos/organizacion/a5b76624-2908-5382-aa92-c3e9b6ca3221/fixture/jornadas`
- Pasos mínimos:
  1. Entrar como owner en la organización edge/volumen.
  2. Elegir el torneo correspondiente con `Torneo activo`.
  3. Esperar que el selector quede habilitado, recargar y confirmar su valor.
  4. Abrir Fixture o Partidos.
- Esperado: el owner activo de la organización recibe fixture y programación.
- Obtenido: `get_tournament_fixture_context` y/o
  `get_tournament_schedule_context` responden `403 Forbidden`.
- Error técnico: `console.error` de red y HTTP 403. La llamada directa al RPC
  dentro de una transacción `authenticated` con el mismo `sub` devolvió el JSON
  completo, por lo que los datos y la membresía existen.
- Reproducibilidad: 5/6 viewports para temporal y 4/6 para impar; el volumen
  también quedó bloqueado cuando el selector no llegó a resolver.
- Área posible: `TorneosCompetitionContext.jsx`, `TorneosFixtureContext.jsx`,
  `CompetitionSelector.jsx`, `tournamentWorkspaceService.js`; revisar la carrera
  entre persistencia de contexto, cambio de organización y carga paralela de RPC.

## Bugs legacy

### QA-TOR-P3-L001 — recurso externo de Inter devuelve 404

- Severidad: **P3**.
- Scenario ID: transversal.
- Rol: owner/admin en la primera pasada.
- URL: recurso `.woff2` de `fonts.gstatic.com`.
- Esperado: fuente disponible o fallback sin error de consola.
- Obtenido: `404` y `net::ERR_ABORTED`; la UI usa fallback y no se rompe.
- Reproducibilidad: observado en la primera pasada; luego quedó absorbido por
  cache/fallback.
- Área posible: import de Google Fonts en `src/styles.css` y loader de
  `public/web-access.js`.

## Warnings

- React Router emitió dos future warnings v7 de forma repetida:
  `v7_startTransition` y `v7_relativeSplatPath`.
- Se registraron cancelaciones `net::ERR_ABORTED` al navegar rápido entre rutas;
  se clasificaron como ruido esperado de navegación y no como crash.
- Los 403 esperados del outsider al consultar el hub se consideran denegación
  correcta cuando aparece la pantalla segura `No pudimos abrir este torneo`.
- Tiempos de visitas completadas: mediana aproximada 201 ms; p95 observado 4.8 s.
  Diecisiete visitas superaron 5 s y coinciden mayormente con loading gates.
- Supabase informó `imgproxy` y `pooler` detenidos; API, DB, Auth, PostgREST,
  Studio, Storage, Realtime y demás servicios requeridos permanecieron activos.

## Limitaciones del fixture

- El schema no tiene campo real de árbitro en `tournament_matches`; no se inventó.
- `suspended` no es un status admitido; sí se cubrieron `postponed` y `cancelled`.
- El contrato de programación exige fecha, sede, cancha y duración juntos; no se
  insertó un partido parcialmente programado inválido.
- No existe un flujo real de transferencia/cambio de plantel; no se simuló.
- No existe un concepto separado de sanción futura compatible con el modelo
  inspeccionado; no se inventó.
- Los perfiles edge/volumen pertenecen al owner pero no convierten al owner en
  participante del hub público; por eso se probaron desde rutas administrativas.
- Parte de los escenarios visuales/data-heavy no pudo validarse hasta el contenido
  final por QA-TOR-P1-001 y QA-TOR-P1-003. Los datos quedaron creados para repetir.

## Cobertura y resultados

- Escenarios definidos en matriz: **110**, con IDs estables.
- Seed: **20260812**.
- Perfiles de datos:
  - edge: 2 organizaciones, 3 temporadas, 5 torneos, 16 equipos, 33 jugadores,
    38 partidos y 13 jornadas;
  - volumen: 1 organización, 1 temporada, 1 torneo, 20 equipos, 240 jugadores,
    190 partidos y 19 jornadas.
- Idempotencia: aplicar `edge`, `volume` y luego `all` produjo `created`, `created`
  y finalmente `skip/skip`.
- Roles recorridos: **6** — owner, admin, delegate, player, collaborator, outsider.
- Viewports: **320, 360, 390, 430, 768 y 1440**.
- Crawler autenticado final:
  - 36 combinaciones rol × viewport;
  - 344 visitas registradas;
  - 27 URLs finales únicas;
  - 26 scenario IDs de recorrido;
  - 24 combinaciones sin findings y 12 con findings;
  - suite de 42 tests: **30 pass / 12 fail**.
- Sin sesión: **42/42 pass**, incluyendo `returnTo`, guards y overflow.
- Contrato preparado existente: **12 pass / 12 skip / 24 fail**; las fallas se
  explican por QA-TOR-P1-001, QA-TOR-P1-002 y cascadas de loading, no por 24 bugs.
- Back/Forward, refresh y deep link: **6/6 pass** en el test de history.
- Crashes JS no capturados: **0**.
- Páginas blancas: **0**.
- Error boundaries: **0**.
- Redirect loops: **0**.
- Overflow horizontal: **0**.
- Dialogs/controles fijos fuera del viewport: **0**.
- Problemas de permisos distintos: **1 confirmado** y denegaciones adicionales
  inconclusas cuando el loading gate no resolvió.
- Bugs: **3 P1 + 1 P3 legacy**.
- P0: **0**. P2: **0**.

## Artefactos y reproducción

- Matriz: `docs/qa/torneos-local-scenario-matrix.md`.
- Fixture determinista: `scripts/qa/seed-torneos-scenarios.mjs`.
- Estados de sesión locales sin mutación Auth:
  `scripts/qa/prepare-torneos-local-auth-states.mjs`.
- Crawler: `tests/e2e/torneos-local-scenario-crawler.spec.js`.
- Evidencia autenticada por rol/viewport: `artifacts/playwright/test-results/`
  (JSON adjunto, screenshots, videos y traces según resultado).
- Evidencia sin sesión: `artifacts/playwright/unauthenticated-results.json`.
- Contrato preparado: `artifacts/playwright/prepared-results/` y
  `artifacts/playwright/prepared-results.json`.

Los suplementos agregados se identifican por los markers
`qa.scenarios.edge.v1` y `qa.scenarios.volume.v1`. El script exige confirmación
doble para cleanup; no se ejecutó cleanup en esta revisión para conservar la
reproducibilidad inmediata.

## Estado final

- App LOCAL disponible en `http://127.0.0.1:3000`.
- Supabase LOCAL disponible en `http://127.0.0.1:57321`.
- La pestaña del Browser in-app queda abierta en `/torneos` con la sesión QA
  existente; la pantalla observada estaba afectada por QA-TOR-P1-001.
- Worktree sin stage ni commit.
- **REVIEW**.
