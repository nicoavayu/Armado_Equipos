# Arma2 Torneos — producto conectado (CONNECTED-V1)

Estado: implementación local + laboratorio híbrido. **Nada aplicado en remoto, nada desplegado.**

## Base

Rama `claude/torneos-connected-product`, creada desde `30f6e429` =
`codex/torneos-full-redesign-preview`: `main` (`ffaf131c`) + las cabezas actuales de
#179 (`45018c0d`), #180 (`e9b690bb`), #181 (`4d851810`) y #178 (`d7eb31b2`), mergeadas
localmente. Ninguna de esas PR está mergeada en GitHub. Este trabajo se apoya en ellas
porque toca las mismas superficies (Inicio/landing, estados vacíos, densidad); se
revisa como diff sobre esa integración.

## Problema

Dentro de Torneos el encabezado global era el de Core: disponibilidad de invitaciones
de Core, premios/historias, «Ver perfil» → `/profile` y campana → `/notifications`
cambiando de espacio. El regreso de esa pantalla terminaba en el inicio de Core. Un
participante sin gestión no tenía navegación propia y no había forma de descubrir
torneos ni de pedir una inscripción: todo equipo entraba por el organizador.

## Fronteras Core ↔ Torneos

| Superficie | Antes | Ahora |
| --- | --- | --- |
| Avatar | disponibilidad Core, premios, perfil Core | nombre de Torneos, «Mi perfil de Torneos», «Avisos de Torneos»; sin disponibilidad ni premios |
| Campana | `switchSpace(ARMA2,'/notifications')`, contador 0 | `/torneos/avisos`, contador = no leídos de la bandeja de Torneos (comunicados + actividad) |
| Cambiar a Core | implícito (perfil, campana) | sólo explícito en el selector de producto |
| Navbar / onboarding Core | no montados en `/torneos` (se conserva) | idem |
| Core | — | sin cambios de comportamiento; una única entrada discreta «Explorar torneos» |

`GlobalHeader` recibe una variante de espacio. En Core el componente es idéntico.

## Experiencia por relación

La experiencia se deriva de relaciones revalidadas en backend
(`get_tournament_workspace_context`, `get_my_tournament_memberships`, nuevas RPC de
solicitudes). La preferencia de vista («Mis torneos» / «Gestionar») es sólo visual:
ninguna ruta, RPC ni permiso la lee.

- **Participante**: Inicio centrado en su próximo partido y sus torneos; navegación
  personal Inicio · Explorar · Mis torneos · Avisos · Perfil. Sin planes, ajustes ni
  asistentes de creación en el flujo normal.
- **Capitán/delegado**: lo anterior + su equipo (inscripción/plantel) en rutas
  personales `/torneos/mis-equipos/...`, no dentro del shell de la organización.
- **Gestor**: Inicio con sus organizaciones; no exige perfil deportivo.
- **Ambos**: conmutador «Mis torneos / Gestionar».

## Explorar torneos — tres conceptos separados

1. **Página pública** (existente, `tournament_public_pages`).
2. **Aparición en el catálogo** (`tournament_catalog_listings.status = listed`).
   Requiere página pública publicada: la ficha del catálogo **es** la página pública
   con un bloque «Convocatoria»; no hay una segunda ficha.
3. **Recepción de solicitudes** (`applications_state = open | paused | closed`).
   Además exige torneo en `registration` y ventana de inscripción vigente.

Crear un torneo no activa ninguno. El catálogo publica una proyección segura: nombre,
organizador, localidad (y sede de la organización si se eligió), deporte/modalidad,
formato, género, categorías con requisitos de edad, fechas, cierre de inscripción,
cupos (si se definieron), costo y qué incluye (texto; Arma2 no cobra), requisitos,
resumen de reglas y estado de inscripción. Nunca planteles, contactos, auditoría ni
borradores.

Orden explícito: «Cierre más próximo» (default), «Inicio más próximo», «Publicados
recientemente». Filtros: texto, localidad, deporte, género, sólo abiertas, rango de
fechas de inicio. Paginación de 12. Una fila por torneo. Retirados, eliminados por la
plataforma, borradores, finalizados y archivados nunca aparecen.

Moderación: no existe administración de plataforma en Torneos. Se agrega sólo una
palanca operativa `platform_remove_tournament_catalog_listing` (EXECUTE sólo para
`service_role`, fuera de toda allowlist): retira y bloquea el re-listado. No hay UI
ni se afirma verificación institucional.

## Solicitud de inscripción

Reutiliza el dominio existente (`tournament_team_entries`, roster, revisión):

```
Explorar → ficha → «Solicitar inscripción» → categoría → equipo autorizado
  → condiciones → solicitud en preparación (entry in_progress, solicitante = capitán)
  → plantel (requisitos actuales: validate_tournament_roster) → enviar (submitted)
  → revisión del organizador (approved | changes_requested | rejected)
  → aprobada = inscripción confirmada (ocupa cupo) → plantel aprobado
  → acceso privado sólo para responsables activos y jugadores vinculados del plantel
```

- **Autoridad sobre el equipo**: equipo de Core sólo si el usuario es owner/admin en
  Core. LOCAL: `team_user_is_admin_or_owner` en la misma base. Híbrido: contrato Core
  `team_snapshot` atestado por el gateway (el `teamId` del cliente nunca autoriza).
  Búsqueda de equipos propios: contrato `directory_teams` (sólo devuelve equipos que el
  usuario administra). Equipo nuevo: nombre explícito; el creador sólo es capitán de
  esa inscripción, nunca miembro de la organización.
- Importar no toca Core ni inscribe miembros: el plantel se arma a mano.
- Enviar no da acceso privado: `get_my_tournament_memberships` y el hub exigen
  `approved`.
- **Cupo**: lo consume una inscripción `approved`. Pendientes no. Capacidad opcional
  por categoría (`tournament_category_capacities`); se valida al enviar y al aprobar
  con el mismo advisory lock (tournament, category) de la revisión.
- **Guardas en backend** (triggers, cubren todo camino de escritura): solicitud
  enviada con catálogo retirado / solicitudes cerradas o pausadas / ventana vencida →
  `TORNEOS_APPLICATIONS_CLOSED`; aprobar sobre cupo lleno → `TORNEOS_CATEGORY_FULL`;
  duplicados por equipo Core (índice único existente), nombre repetido en categoría,
  máximo 3 solicitudes abiertas por persona y torneo, idempotencia por clave.

## Perfil de Torneos

`tournament_user_profiles`: nombre de presentación y una preferencia que la bandeja
cumple de verdad (avisos de nuevas solicitudes para gestores). Fallback de lectura:
nombre de Core; nunca se escribe en Core. Planteles y actas conservan sus nombres
oficiales. Cuenta común (email, sesión, eliminación) en un bloque separado.

## Avisos de Torneos

Bandeja = comunicados existentes (deliveries, audiencias, leído/confirmado,
paginación sin cambios) + actividad de inscripción (`tournament_user_notifications`):

- solicitante/responsables: solicitud enviada, aprobada, cambios solicitados,
  rechazada (con motivo);
- gestores con `team_entries.review` y acceso a la temporada: solicitud recibida
  (revalidado al leer).

Contador = no leídos de esas dos fuentes. Canales: sólo bandeja interna. Torneos no
tiene push, web push ni email; la UI lo dice y no ofrece controles para canales
inexistentes. Los toggles por torneo existentes («Qué querés destacar») no tenían
efecto y se reemplazan por esa explicación.

## Composición

| | LOCAL (`legacy-local`) | Production (`hybrid`) |
| --- | --- | --- |
| Migración | `supabase/migrations/20261006120000_torneos_connected_product_v1.sql` | `backend/torneos/supabase/migrations/00000000000009_connected_product_v1.sql` |
| Identidad | `auth.uid()` | `private.current_identity_id()` |
| Autoridad Core | misma base | gateway: `team_snapshot` / `directory_teams` atestados |
| Transporte | supabase-js | gateway; RPC autenticadas + 3 públicas (anon) |
| Activación | siempre | `TORNEOS_CONNECTED_MODE=on` (gateway) + `REACT_APP_TORNEOS_CONNECTED_MODE=on` (build) |

Sin los dos flags, Production queda exactamente como hoy (las fronteras de encabezado
sí aplican siempre).

## QA y verificación

- **LOCAL** (stack `arma2-torneos-qa-seed`): `scripts/qa/seed-torneos-connected-fixtures.mjs --apply-local`
  crea, con las RPC del producto y en una sola transacción, cuatro identidades QA
  (`qa-connected-{organizer,applicant,dual,revoked}@localhost.invalid`, `qa_seed_key = torneos-connected-v1`),
  «QA Liga Conectada» con tres torneos (convocatoria abierta, convocatoria cerrada, página pública sin
  convocatoria), equipos de Core para el capitán y el dual, una solicitud aprobada y otra pendiente, y la
  membresía revocada. No toca a las seis identidades QA existentes. `--retire-local` retira convocatorias y
  páginas QA con las RPC del organizador (el dominio no borra organizaciones). El selector `/qa/rol` suma los
  cuatro roles cuando existen; `QA_TORNEOS_REVIEW_PORT` permite una segunda revisión en paralelo.
- **Híbrido** (laboratorio `integration/torneos-core-contracts`, gateway con `TORNEOS_CONNECTED_MODE=on`):
  `connected.test.mjs` (Node y Edge) y, para el navegador,
  `B04_LAB_APP_PORT=3103 node scripts/torneos-frontend/start-hybrid-lab-app.mjs --start --connected` +
  `lab-fixtures.mjs connected-call` (el organizador publica la convocatoria por el gateway).
- **Postgres real**: `scripts/db-integration/torneos-connected-product.mjs` sobre un clon descartable
  `torneos_connected_test*`.

## Decisiones y límites conocidos

- «Mis torneos» conserva el comportamiento de la base: lista también las membresías de organización
  (rol «Propietario», etc.). La separación participación/gestión está en Inicio («Mis torneos / Gestionar»).
- La bandeja de solicitudes muestra el nombre de Torneos vigente del responsable (fallback: el del plantel).
- Sin push, web push ni email: sólo bandeja interna. No se ofrecen controles para canales inexistentes.
- Sin UI de administración de plataforma: sólo la palanca `service_role` descripta arriba.
- La sede publicada es opcional; la localidad es texto normalizado (sin geocodificación).
