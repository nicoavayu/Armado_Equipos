# Arma2 Torneos — producto conectado (CONNECTED-V1)

Estado: implementación local + laboratorio híbrido + validación en simulador iOS + ensayo completo de la promoción web
(laboratorio descartable). **Nada aplicado en remoto, nada desplegado.** Promoción, preflight, ensayo y rollback:
`DEPLOY.md`. Avisos y push: `NOTIFICATIONS-AUDIT.md`.

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
| Dónde se ve el encabezado | inicio y algunas pantallas | toda pantalla autenticada de `/torneos` (centro del torneo, fotos, partidos, inscripción, solicitudes, perfil, avisos), uno solo; la página pública conserva su encabezado público con «Volver» |
| Avisos del otro producto | — | punto rojo chico pegado al logo, abajo a la derecha (junto al «2» de Arma2 o la «S» de Torneos, sin taparlo), y en cada opción del selector, con texto accesible; nunca un segundo contador. Abrir el selector no marca nada como leído. No es una suscripción push |
| Al abrir la app | siempre el inicio del producto por defecto | el último producto y pantalla válidos de esa cuenta (preferencia local, nunca una autorización; se revalida al entrar; la query sólo con claves reproducibles como `?categoria=`). Gana un enlace o aviso explícito y el destino del login; sin Core en la plataforma, Torneos |

`GlobalHeader` recibe una variante de espacio. En Core el componente es idéntico salvo el punto de avisos de Torneos.

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
- **Ambos**: conmutador «Mis torneos / Gestionar», con las dos listas separadas.

La separación sale del servidor, no de filtrar en el cliente: «Mis torneos» usa
`get_my_tournament_participations` (sólo inscripciones aprobadas donde la persona es responsable activo o jugador
vinculado, paginado en el servidor) y «Gestionar» las organizaciones de `get_tournament_workspace_context`. Las
solicitudes en curso tienen su propia sección («Tus solicitudes», `get_my_tournament_registrations`). El rol de capitán
se muestra según la relación real de cada inscripción.

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
resumen de reglas, estado de inscripción y el logo del torneo (o el de la organización,
o sus iniciales: la misma regla que la página pública). Nunca planteles, contactos de
personas, auditoría ni borradores.

- **Costo**: tres estados distintos — no informado (`null`, la tarjeta no muestra nada y la
  ficha dice «Precio no informado por la organización»), gratuito (`0`, «Participación
  gratuita») e informado (monto + unidad: por equipo o por jugador). `null` nunca se
  convierte en `0`. Siempre se aclara que Arma2 no cobra ni procesa el pago.
- **WhatsApp de contacto** (opcional, por convocatoria): lo carga quien gestiona el
  catálogo, con aviso de que es público y confirmación explícita
  (`TORNEOS_CONTACT_CONSENT_REQUIRED` sin ella); se normaliza a dígitos E.164
  (`TORNEOS_CONTACT_INVALID` si no es válido), se puede quitar y queda auditado. La ficha
  ofrece «Contactar al organizador por WhatsApp» (`wa.me` con un mensaje inicial, en otra
  pestaña) sólo si existe. Consultar no es pedir la inscripción ni reserva lugar; el
  intercambio de la solicitud sigue en Torneos. Nunca se usa el teléfono de un perfil.

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
  usuario administra). **Lista sin escribir** (`list_my_core_teams_for_application`):
  LOCAL lee Core en la misma base; híbrido usa el contrato Core v1.2 `my_teams`
  (migración Core `20261007120000`, atestación de un solo uso). Devuelve los equipos
  activos del usuario con `canRegister` (dueño/admin) o sólo integrante, y en qué
  categorías de este torneo ya está cada uno. Inscribir sigue exigiendo `team_snapshot`.
- **Lo que falta, junto al botón**: crear la solicitud y enviar el plantel muestran la lista
  de pendientes (con acceso al campo); ningún botón queda deshabilitado sin explicación.
  Un equipo ya inscripto en esa categoría no se puede elegir (índice único por torneo,
  categoría y equipo de Core). Equipo nuevo: nombre explícito; el creador sólo es capitán de
  esa inscripción, nunca miembro de la organización.
- La solicitud usa el nombre y el escudo del equipo; **sus jugadores no se copian** y no se toca Core. La pantalla lo
  dice antes de crearla («Siguiente paso: armar el plantel. Lo que completes queda guardado.») y, al crearla, lleva al
  plantel, donde el estado vacío explica que cada jugador se suma con la búsqueda o sin cuenta y queda guardado. Un
  integrante sin autoridad sobre el equipo no puede inscribirlo (se lista aparte, con «Compartir convocatoria»).
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
| Autoridad Core | misma base | gateway: `team_snapshot` / `directory_teams` / `my_teams` (v1.2) atestados |
| Transporte | supabase-js | gateway; RPC autenticadas + 3 públicas (anon) |
| Activación | siempre | `TORNEOS_CONNECTED_MODE=on` (gateway) + `REACT_APP_TORNEOS_CONNECTED_MODE=on` (build) |
| Logos y escudos | Storage local (rutas → URL pública del bucket local) | BRANDING-V1: migración `00000000000010_branding_v1.sql`, `TORNEOS_BRANDING_MODE=on` (gateway) + `REACT_APP_TORNEOS_BRANDING_MODE=on` (subida) |
| Búsqueda de jugadores para el plantel | `search_tournament_players` en la misma base | `00000000000011_connected_roster_search.sql`: el responsable de una inscripción de afuera de la organización busca jugadores de Arma2 para su plantel; la guarda de temporada queda sólo para el camino de la organización (búsqueda y autorizador del contrato `directory_players`) |

Sin los dos flags, Production queda exactamente como hoy (las fronteras de encabezado
sí aplican siempre).

## QA y verificación

- **LOCAL** (stack `arma2-torneos-qa-seed`): `scripts/qa/seed-torneos-connected-fixtures.mjs --apply-local`
  crea, con las RPC del producto y en una sola transacción, cuatro identidades QA
  (`qa-connected-{organizer,applicant,dual,revoked}@localhost.invalid`, `qa_seed_key = torneos-connected-v1`),
  «QA Liga Conectada» con tres torneos (convocatoria abierta, convocatoria cerrada, página pública sin
  convocatoria), equipos de Core para el capitán y el dual, una solicitud aprobada y otra pendiente, y la
  membresía revocada. No toca a las seis identidades QA existentes. La **etapa 2** (incremental, mismo comando)
  suma: escudo QA en la Copa (subido al Storage local y asignado con la RPC del organizador), Copa con precio por
  equipo + WhatsApp de formato válido sin persona real (`+54 9 11 0000 0000`), Belgrano sin precio ni contacto, la
  convocatoria gratuita «QA Liga Gratuita Caballito» (sin logo: iniciales) y, para el capitán, «QA Vecinos FC»
  (sólo integra) y «QA Ex Capitanía» (fue admin y lo bajaron a integrante). `--retire-local` retira convocatorias y
  páginas QA con las RPC del organizador (el dominio no borra organizaciones). El selector `/qa/rol` suma los
  cuatro roles cuando existen; `QA_TORNEOS_REVIEW_PORT` permite una segunda revisión en paralelo.
- **Simulador iOS**: build Debug de la rama contra el stack LOCAL; matriz y pendientes en `NOTIFICATIONS-AUDIT.md`.
- **Híbrido** (laboratorio `integration/torneos-core-contracts`, gateway con `TORNEOS_CONNECTED_MODE=on`):
  `connected.test.mjs` (Node y Edge) y, para el navegador,
  `B04_LAB_APP_PORT=3103 node scripts/torneos-frontend/start-hybrid-lab-app.mjs --start --connected` +
  `lab-fixtures.mjs connected-call` (el organizador publica la convocatoria por el gateway, con precio por jugador y
  WhatsApp; el capitán administra «Lab Halcones», integra «Lab Vecinos» y perdió el rol en «Lab Ex Capitanía»;
  `b04-sin-equipos@lab.test` no tiene equipos). Con logos: `--connected --branding` (levanta el Storage del
  laboratorio y aplica `0010`) + `lab-fixtures.mjs connected-branding` (el organizador sube por la ruta de objeto del
  gateway el logo de la organización, el del torneo y el escudo de «Lab Halcones»); `branding.test.mjs` (Node y Edge).
- **Postgres real**: `scripts/db-integration/torneos-connected-product.mjs` sobre un clon descartable
  `torneos_connected_test*`.

## Decisiones y límites conocidos

- «Mis torneos» lista sólo participación (`get_my_tournament_participations`, paginada en el servidor): las
  organizaciones que la persona gestiona están en «Gestionar». «Tus solicitudes» son las inscripciones en curso.
- **Logos y escudos en híbrido (BRANDING-V1)** sin activar el resto de la multimedia: bucket `tournament-branding`
  **privado** en el proyecto de Torneos; lectura pública sólo de lo que ya muestra la página publicada (logo vigente del
  torneo/organización y escudos del fixture publicado); lectura autenticada para quien puede escribir y para los
  responsables activos de esa inscripción. El gateway firma en lote (una llamada por respuesta, URLs de 1 h) y el
  frontend sólo convierte en imagen una URL firmada de exactamente esa ruta (registro con TTL de 50 min); nunca arma
  URLs de storage de otro proyecto. Sin URL firmada, iniciales. La subida sigue la secuencia LOCAL (objeto → referencia →
  borrar el anterior) y las políticas de Storage reutilizan `can_write_tournament_branding_object`.
- En el selector de equipos de Core se ven iniciales cuando el equipo no tiene escudo (o su URL no es https: el
  saneador de Core la descarta).
- No existe importación de jugadores desde el equipo de Core: el plantel se arma con la búsqueda del directorio o
  jugadores sin cuenta.
- Avisos y push entre productos: ver `NOTIFICATIONS-AUDIT.md`. Torneos no pide permiso de push; con el permiso ya
  concedido en Arma2, mantiene el registro del dispositivo de Core mientras la app está en Torneos. La cuenta puede
  apagar los avisos externos de Arma2 desde «Mi perfil de Torneos»: la preferencia es de Core, se aplica a toda la
  cuenta y en todos sus dispositivos, y no toca la bandeja de Torneos ni la sesión. Si Core no tiene la RPC o revocó su
  EXECUTE (rollback seguro), el control no se muestra.
- La bandeja de solicitudes muestra el nombre de Torneos vigente del responsable (fallback: el del plantel).
- Sin push, web push ni email: sólo bandeja interna. No se ofrecen controles para canales inexistentes.
- Sin UI de administración de plataforma: sólo la palanca `service_role` descripta arriba.
- La sede publicada es opcional; la localidad es texto normalizado (sin geocodificación).
