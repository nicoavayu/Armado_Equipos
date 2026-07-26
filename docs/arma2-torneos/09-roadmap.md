# Roadmap de entrega

Cada fase produce un PR pequeño hacia `epic/arma2-torneos`; ninguna apunta a `main`.

## 0. Blueprint y foundation — completada

Documentación, shell aislado, flags fail-closed, contexto ficticio y pruebas. Sin datos ni deploy.

Salida: navegación responsive demostrable sólo con opt-in local.

## 1. Workspaces, organizaciones y permisos — completada

Proyecto Supabase staging, organizaciones, memberships, capabilities, selector no productivo, revocación y tests cross-tenant.

Gate: auditoría RLS antes de avanzar.

## 2. Temporadas y competencia — completada en esta rama

Temporadas, torneos, categorías, estados, reglas y configuración base.

Gate: creación atómica, edición progresiva, checklist y ciclo
`draft ⇄ registration` validados con RLS.

## 3. Equipos y planteles — implementada en rama de feature

Inscripción, equipos existentes/provisionales, planteles versionados, revisión,
capitanes, jugadores sin cuenta, RLS y auditoría append-only.

Gate técnico cubierto en PostgreSQL embebido. Pendiente auditoría del PR,
staging Supabase dedicado y autorización; producción continúa apagada.

## 4. Fixture y programación — completada

Liga primero; luego copa, grupos y mixto. Versiones, validaciones, sedes/canchas y agenda.

Gate: fixtures reproducibles y auditables.

## 5. Operación de partidos — implementada en rama de feature

Disponibilidad, convocatorias, snapshots, actas, eventos, ausencias,
walkovers, suspensiones, doble control y correcciones versionadas.

Gate PostgreSQL/RLS y auditoría final del PR #98 cubiertos localmente, sin
hallazgos críticos ni altos. Quedan pendientes staging Supabase dedicado y QA
físico antes de cualquier integración a `main`. Árbitros, evidencia, reclamos
formales y recálculo pertenecen a fases posteriores.

## 6. Tabla, estadísticas y disciplina — implementada en rama de feature

Reglas ordenables, snapshots, rankings, fair play, tribunal y elegibilidad.

Gate PostgreSQL/RLS local: reconstrucción versionada desde actas oficiales,
publicación atómica, privacidad y concurrencia cubiertas. Pendientes staging
aislado, mejores terceros/series configurables y torneo sintético completo.

## 7. Comunicación y público

Avisos, noticias, galería, proyecciones públicas, deep links y push sandbox.

Gate: revisión de privacidad y enlaces.

## 8. Contenido automático

Templates, equipo de la fecha, render server-side, share/download y stale tracking.

Gate: QA visual determinista.

## 8.5 Participant Hub autenticado

Mis torneos, resumen, partidos, tabla, estadísticas, equipos, disciplina,
detalle y contexto propio por relación. Implementado sobre datos publicados,
sin comunicación ni superficie anónima.

Gate pendiente: staging aislado con sesiones jugador/capitán/organización,
dataset volumétrico, auditoría de payloads de red y QA en dispositivos físicos.

## 9. Documentos y exportación

PDF, QR seguro, Excel/CSV, trabajos grandes e historial.

Gate: autorización doble (crear/descargar) y retención.

## 10. Integración Arma2

Perfiles, equipos, historial oficial, estadísticas compatibles, navegación cruzada y notificaciones.

Gate: reglas actuales de Arma2 intactas y regresión completa.

## 11. Hardening y lanzamiento controlado

Seguridad, performance, accesibilidad, móviles físicos, torneo completo, runbooks, rollback y soporte.

## Estrategia Git

- `epic/arma2-torneos` nació de `origin/main` en `5659d2d...`.
- `feature/torneos-foundation` nació de la epic.
- Las features siguientes se crean desde la epic actualizada.
- Integrar `origin/main` periódicamente en la epic, resolver temprano y ejecutar regresión.
- Commits por intención; nunca un único commit para todo el producto.

## Calidad por fase

Unit, integración, permisos/RLS, rutas, responsive, lint, build, suite relevante y `git diff --check`. Typecheck se reporta como no disponible mientras el frontend siga en JavaScript, salvo que la fase introduzca una herramienta formal.
