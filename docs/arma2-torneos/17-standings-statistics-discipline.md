# Tabla, estadísticas, clasificación y disciplina

## Fuente de verdad y revisiones

La única entrada es el fixture publicado, sus actas `official`, outcomes,
scores, eventos no anulados y reglas vigentes fotografiadas. React no envía
posiciones, contadores, clasificados ni sanciones.

Cada revisión conserva fingerprint, actor, motivo, fecha, configuración y la
lista exacta de actas consumidas. El fingerprint v2 serializa de forma estable
fixture, actas, outcomes, scores, eventos, participantes, ajustes, overrides y
reglas; no depende de la zona horaria de la sesión. Se calcula completa como
`draft`. Un borrador obsoleto se descarta con auditoría, mientras que uno
idéntico se reutiliza de forma idempotente. La publicación vuelve a bloquear y
verificar todas las fuentes, supersede la anterior y activa las nuevas sanciones
en una transacción.

La migración `20260726200000_tournament_standings_discipline.sql` agrega
revisiones/fuentes, tabla, estadísticas de equipo/jugador, ledger disciplinario,
suspensiones/cumplimientos, overrides, ajustes de puntos, slots y resoluciones.
Las doce tablas usan RLS; `authenticated` sólo recibe `SELECT`.

## Rebuild

`rebuild_tournament_standings` toma advisory lock por
organización/torneo/categoría/fase/grupo, rechaza scopes incompletos y carreras
concurrentes, y deriva:

- PJ, G, E, P, GF, GC, DG, puntos, ajustes, walkovers, administrativos y fair play;
- convocatorias, presencias, titularidades, suplencias, goles, autogoles,
  asistencias, penales, tarjetas y capitanías;
- localías, visitas, suspendidos, forma reciente y racha;
- ledger y sanciones automáticas.

Los minutos quedan `null`: el acta no acredita intervalos con precisión. Un gol
sin autor suma al equipo, no a un jugador. Los ajustes de puntos requieren
configuración habilitada y guardan scope compuesto, actor, motivo e idempotencia.

## Desempates

Puntos es la raíz. Luego se aplica el orden configurado: diferencia, goles,
victorias, fair play y `head_to_head`.

`head_to_head` construye una mini tabla sólo entre quienes aún comparten clave:
puntos, diferencia y goles entre sí. Si separa un subconjunto, recalcula para
los que continúan empatados hasta estabilizar. Esto contempla dos o más equipos,
una o dos ruedas y subconjuntos recursivos. Compara puntos, diferencia y goles
como claves separadas, sin empaquetarlos en un número con riesgo de colisión.
Partidos no oficiales o que no cuentan para tabla no ingresan.

Si se agotan los criterios, la fila queda `manual_review`. El UUID sólo mantiene
orden visual estable mientras se resuelve playoff/sorteo/seed auditado; no se
presenta como decisión deportiva.

## Clasificación y llaves

`resolve_tournament_qualification` exige revisión publicada, fase completa,
participantes y outcomes resueltos, ausencia de correcciones/disputas abiertas y
desempate inequívoco. Resuelve `group_position`, `league_position`,
`winner_of_match` y `loser_of_match` —incluido ganador por penales—, preservando
fuente y resolución histórica. Una resolución manual no se reemplaza
automáticamente.

Si una corrección cambia el clasificado y el cruce posterior tiene acta, deja
una resolución `blocked` y no modifica el partido. Mejores terceros entre grupos
desiguales, series ida/vuelta y clasificación manual requieren configuración
que competition core todavía no modela; permanecen fail-closed. Antes de
habilitarlas se debe versionar normalización, exclusión del último y orden
cross-group.

## Disciplina

Amarillas, segunda amarilla y roja nacen de eventos oficiales. La revisión
fotografía umbral, fair play, fechas, reset por fase y doble amarilla. Cada
suspensión conserva origen, evento/partido cuando existe, regla, cantidad,
cumplidas, motivo y estado: `pending`, `active`, `served`, `reduced`, `revoked`
o `superseded`.

Publicar activa sanciones y transfiere el estado acumulado de overrides y fechas
cumplidas al reconstruir. El guard rechaza al suspendido al agregarlo a una
convocatoria u operación y vuelve a validar el plantel completo al enviar o
bloquear el acta. Una fecha sólo se cumple contra otro partido oficial que
cuente para tabla y en el cual el jugador figure ausente o justificado. Reducir,
sumar o revocar crea un override append-only. Las amarillas se arrastran entre
fases sólo cuando la regla no configura reset; el arrastre entre torneos no se
supone.

## Audiencias, RPCs y UX

Owner/Admin administran `standings.*`, `statistics.*`, `qualification.*`,
`discipline.*` y `suspensions.*`. Collaborator lee. Captain/delegate y jugador
leen publicados por relación activa, sin membership ni edición implícita. Las
tablas internas de revisiones, fuentes, sanciones, cumplimientos y resoluciones
no quedan expuestas a estas audiencias: acceden por RPCs `SECURITY DEFINER` con
payload allowlistado, sin fingerprint, notas internas ni identidad de actores.

Las RPCs separan rebuild, publicación, lectura, clasificación, ajuste,
disciplina y cumplimiento. Usan `auth.uid()`, capability, `search_path = ''`,
grants mínimos, scope revalidado y auditoría.

La UI agrupa Tabla, Estadísticas, Clasificación y Disciplina bajo
`Competencia`. Fija torneo/categoría/fase/grupo, muestra draft/publicada,
read-only, loading, vacío, error y éxito. Acciones oficiales exigen motivo. La
tabla móvil conserva posición, equipo, PJ, DG y puntos con detalle expandible;
estadísticas destaca top 3 y disciplina explica origen/fechas/estado. Los
controles tienen objetivo táctil mínimo de 44 px; el diálogo mantiene el foco,
cierra con Escape y lo devuelve al disparador.

## Verificación y límites

El harness aplica las seis migraciones Torneos desde cero y cubre schema/RLS,
grants, capabilities, scope, ajustes, rebuild/idempotencia, fuentes,
puntos/goles/forma, estadísticas sin minutos inventados, disciplina, privacidad,
cross-tenant, publicación, clasificación vacía, suspensión, override,
determinismo entre zonas horarias, historia, stale drafts, mini tabla circular de
tres equipos, arrastre/reset de amarillas y concurrencia.

PostgreSQL embebido no sustituye Supabase real. Quedan como gates staging
aislado, mejores terceros/series configurables, QA física y torneo completo
end-to-end. No se aplicaron migraciones remotas.
