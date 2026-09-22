# FRONTEND-MIGRATION-PLAN — B04

> **Estado 2026-09-21:** documento de la foundation (pre-R4). La integración B04 está implementada y verificada; la referencia vigente es [B04-FRONTEND-INTEGRATION-REPORT.md](B04-FRONTEND-INTEGRATION-REPORT.md). Lo que abajo dice «futuro», «reservado» o «desactivado» ya no aplica.

## Integración recomendada después de R2/R3/R4

1. Revisar este diff sin commit. Mantener desactivada la foundation y confirmar las evidencias de R2/R3/R4 antes de añadir transporte.
2. Alinear con los contratos certificados: destinos independientes, mecanismo de identidad, expiración/invalidation, CORS, timeouts, respuestas, roles y payloads. No copiar supuestos del laboratorio aislado ni ampliar backend/allowlists para acomodar UI.
3. Adoptar los aliases Core junto con todos los lectores de env y validadores, verificando igualdad del singleton y continuidad de la sesión. No cambiar el proyecto Core efectivo al renombrar variables.
4. Implementar el adapter de gateway detrás de `torneosClient`, con dependencia de identidad explícita en la composición de la aplicación. Habilitar Data API sólo si el contrato certificado lo contempla. Nunca un `createClient` Torneos con segunda sesión GoTrue.
5. Crear una composición de rutas/providers staging-v1 que requiera servicio explícito. No usar el default de `TorneosWorkspaceProvider` ni `service || legacy`: ante falta/error de adapter, mostrar estado no disponible. La interfaz nueva agrupada no es reemplazo directo del monolito legacy.
6. Migrar por feature: organizations/workspaces, collaborators, seasons, tournaments, inscripción/roster básico, invitations, Core team import y review. Las 34 RPC candidatas están listadas con función y línea en el mapa. Las otras 9 operaciones permitidas no justifican añadir UI nueva.
7. Excluir del árbol staging-v1 rutas/componentes que demandan cualquiera de las 126 RPC bloqueadas, storage, media, public pages, roster lock, fixtures, matches, squads, standings/stats, Social Studio, licensing, billing, cron o notifications. Separar dependencias mixtas antes de conectar una pantalla.
8. Ejecutar pruebas de sesión/cambio de usuario, ausencia de fallback, aislamiento de destinos y recorridos permitidos contra el entorno certificado autorizado. Hasta entonces no declarar B04 PASS ni activar el híbrido.

## Riesgos y pendientes concretos

- **Legacy aún llega a Core.** La garantía nueva es local a la foundation. Las 111 aristas transitivas y 160 sitios RPC auditados permiten planificar la migración; no son aislamiento runtime.
- **Contexto de competencia mezcla branding.** `loadTournamentCompetitionContext` ejecuta RPC permitida y luego `loadTournamentBrandingContext`, fuera de scope. No reutilizar el método completo.
- **Lectura directa de collaborators.** `listTournamentOrganizationMembers` lee `tournament_organization_members`; la allowlist RPC no autoriza por sí sola ese acceso Data API. Mantenerlo sin migrar hasta comprobar el contrato certificado; si falta cobertura, dejar UI no disponible.
- **Import de equipo Core.** `search_tournament_arma2_teams` y parámetros de inscripción son candidatos por scope, no permiso para leer tablas Core desde Torneos frontend. El recorrido completo requiere el contrato HTTPS certificado.
- **`change_tournament_status` permitido no equivale a habilitar cualquier transición.** El gating UI debe respetar estados/roles certificados y no abrir match operations.
- **Aliases env reservados.** Los nombres nuevos no reconfiguran todavía la app. Preparar valores no cambia runtime ni activa red.
- **API de services deliberadamente incompleta para el legacy.** Sólo nombres de operación/params; aún no adapta DTOs, errores UX, idempotencia o composición de resultados. No inyectarla en el provider antiguo.
- **Guards estáticos conservadores.** Congelan accesos backend transitivos y detectan imports relativos; no prueban ejecución de JavaScript ofuscado. Un futuro cambio legítimo debe actualizar la frontera con revisión explícita, no regenerar excepciones desde HEAD.

La foundation no requiere resolver nuevas decisiones arquitectónicas: deja cerrado el transporte. Si la evidencia posterior no determina un contrato/topología necesario, detener esa integración antes de implementarlo.
