# Arma2 Torneos · Plans & Entitlements V1

## Unidad comercial

La licencia pertenece a `public.tournaments.id`, que en el modelo vigente es
una competencia concreta dentro de una temporada: por ejemplo, Apertura 2027 o
Clausura 2027. La organización es el tenant, `tournament_seasons` agrupa un
período institucional y `tournament_categories` subdivide deportivamente esa
competencia. Ni temporada, categoría, equipo, plantel ni jugador son unidades
facturables independientes.

Una nueva edición siempre debe tener un nuevo `tournaments.id`. Una licencia de
otra edición no se consulta ni se copia al resolver el plan.

## Modelo de asignación

`tournament_plan_grants` registra asignaciones permanentes por organización y
torneo. Distingue tres orígenes:

- `first_free`: primer torneo real de una organización nueva;
- `purchase`: futura compra, reservada a una autoridad server-side;
- `legacy_grant`: acceso preexistente preservado durante el backfill.

`tournament_organization_plan_state` registra de forma determinista si la
organización consumió su única oportunidad Free. Para una organización nueva,
el primer insert en `tournaments` toma un lock por organización, crea el grant
Free y registra el torneo que consumió la oportunidad. Después,
`get_tournament_creation_eligibility` devuelve `premium_required`; Foundation
no bloquea todavía el flujo de creación ni fabrica una compra.

La resolución efectiva usa `get_effective_tournament_entitlements(org, torneo)`.
El estado, finalización o archivado del torneo no interviene en esa resolución,
por lo que Premium permanece asociado a esa edición histórica.

## Backfill

Las organizaciones con torneos preexistentes quedan inicializadas con
`legacy_backfill` y la oportunidad Free ya consumida. Una organización previa
que todavía no creó ningún torneo conserva su primer Free. Todos los torneos
preexistentes reciben `PREMIUM / legacy_grant`, sin fechas de expiración. No se
crean purchases, transacciones ni pagos ficticios.

Las tablas del modelo temporal FREE/PRO anterior se conservan renombradas como
`tournament_legacy_subscription_plans` y
`tournament_legacy_organization_subscriptions`. Son historia no autoritativa y
no conceden acceso.

## Catálogo central

`tournament_plan_catalog` es la fuente server-side de límites y branding:

| Plan | Galería general | Staff administrativo | Branding |
| --- | ---: | ---: | --- |
| FREE | 100 assets | 1 + owner | Arma2 Torneos visible |
| PREMIUM | 10.000 assets configurables | 10 + owner | Powered by Arma2 |

La cuota de galería cuenta únicamente assets generales de
`tournament_media_assets`. Logo, portada, escudos, foto de equipo, retratos y
otros assets de identidad viven en superficies específicas y no consumen esa
cuota. El owner y los roles deportivos tampoco consumen la cuota administrativa;
sólo membresías activas `admin`/`collaborator`.

`tournament_pricing_config` es la única fuente del precio V1: ARS 49.900 de
lista, ARS 39.900 de lanzamiento, pago único y alcance por edición.

`tournament_entitlement_capabilities` mantiene el core deportivo habilitado en
FREE y PREMIUM. Las capacidades Premium son `statistics.advanced`,
`branding.advanced`, `sponsors`, `social_studio.premium` y
`exports.professional`. Registrar una capacidad no implica que la feature ya
exista; Foundation no agrega esas features.

## Seguridad

Las tablas de planes, pricing, grants y estado no exponen escrituras a `anon` ni
`authenticated`. Los usuarios leen sólo las proyecciones RPC autorizadas para
una organización/edición visible. `grant_tournament_premium` está reservado a
`service_role`; no existe una mutación de browser que permita autoasignarse
Premium. El setter de la suscripción temporal anterior queda deshabilitado.

## Riesgo de reciclaje y contrato futuro

El producto actual permite editar nombre, slug, fechas y configuración de un
torneo ya creado, y permite finalizar, reabrir o archivar. No existe todavía un
flujo formal de “duplicar edición” ni un lifecycle que determine cuándo una
edición cambió de identidad comercial. Por eso Foundation no impone bloqueos
destructivos sobre esas ediciones existentes.

El contrato para Billing/lifecycle es inequívoco: duplicar puede copiar
configuración deportiva, pero nunca un row de `tournament_plan_grants`; una
nueva edición debe crear un nuevo `tournaments.id` y obtener su propia
asignación. Cualquier futura operación de reciclaje o duplicación debe apoyarse
en `get_tournament_creation_eligibility` antes de persistir.

## QA LOCAL

El fixture `scripts/qa/seed-torneos-plan-review-fixtures.mjs` crea de forma
idempotente dos organizaciones dedicadas. `qa-planes-first-free` recibe Free
mediante el mismo trigger de producción y contiene una Liga activa con 28
resultados oficiales, tabla publicada y ninguna fase eliminatoria. Es el estado
previo para recorrer `Fixture > Versiones > Agregar fase > Playoffs`.

`qa-planes-legacy-premium` se inicializa con el mismo estado
`legacy_backfill` del modelo real y recibe un único `PREMIUM / legacy_grant`
mediante `grant_tournament_premium`. El motivo explicita que es QA LOCAL y no
representa una compra. El fixture no crea purchases, pagos ni transacciones.

El torneo canónico `qa-metropolitana / Torneo Apertura QA 2026` no se modifica
y permanece como ejemplo posterior Liga + Playoffs. `/qa/torneos` sólo muestra
los cuatro atajos si la sesión puede leerlos, el resolver server-side devuelve
FREE/PREMIUM y los fixtures conservan respectivamente los estados previo y
posterior.
