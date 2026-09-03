# Arma2 Torneos · Plan por temporada

## Unidad comercial

La licencia pertenece a `public.tournament_seasons.id`. Una temporada agrupa
todas sus competencias hijas (`public.tournaments`), categorías y fases. Cada
temporada nueva comienza en FREE, puede permanecer FREE para siempre y puede
subir una sola vez a PREMIUM. Premium es permanente para esa temporada y no se
hereda a la siguiente.

## Resolución y compatibilidad histórica

`tournament_season_plan_grants` es la fuente autoritativa nueva. El resolver
`get_effective_tournament_season_entitlements(organization_id, season_id)`
proyecta schema 4, scope `season`, precio y límites. El resolver compatible por
torneo obtiene primero la temporada del hijo y devuelve el mismo plan.

Las tablas históricas de purchases, grants y events no se borran. Toda purchase
histórica recibe `season_id` por backfill, y cualquier grant Premium efectivo de
un torneo hijo promueve un grant efectivo de su temporada. Si existían varias
compras, todas permanecen auditables; las compras nuevas usan únicamente
`season_id` y un índice parcial evita duplicar una compra abierta o comprar una
temporada que ya es Premium.

`first_free` queda sólo como fuente histórica/compatibilidad. Ya no decide
elegibilidad, no bloquea nuevas temporadas, no fuerza `premium_required` y no se
presenta en la UI. El origen normal de toda temporada FREE nueva es
`default_free`.

## Catálogo central

| Plan | Multimedia agregada por temporada | Colaboradores administrativos | Placas | Branding |
| --- | ---: | ---: | --- | --- |
| FREE | 25 archivos | owner + 1 | 3 familias Base utilizables; 8 Base y 4 themes Premium visibles pero bloqueados | Base con Arma2 obligatorio; themes Premium en preview white-label |
| PREMIUM | 1.000 archivos | owner + 10 | 11 familias; Base + Heritage/Street/Scoreboard/Editorial | Base con Arma2 ON/OFF; themes Premium white-label |

El precio autoritativo es ARS 49.900 de lista y ARS 39.900 de lanzamiento,
pago único, scope `season`. Todos los torneos hijos consumen el mismo límite
agregado y heredan las mismas capabilities.

FREE permite utilizar y exportar únicamente Resultados (`round_results`), Tabla
(`standings`) y Próxima fecha (`next_fixture`) con Base. Las otras ocho familias
Base permanecen visibles pero bloqueadas; `baseFamilyLimit` continúa siendo 3.
FREE también puede inspeccionar la preview real de Heritage, Street, Scoreboard
y Editorial, siempre white-label, pero no puede exportarlos. Candado, badge y CTA
Premium pertenecen a la interfaz del Studio y nunca al arte.

PREMIUM habilita las once familias y Base, Heritage, Street, Scoreboard y
Editorial. En Base, el usuario Premium puede activar o desactivar `Branding
Arma2`. Los cuatro themes Premium son white-label por definición y no muestran
toggle de branding.

El servidor vuelve a autorizar familia, theme y branding antes de exportar:
FREE + Base fuerza branding ON; PREMIUM + Base admite ON/OFF; PREMIUM + theme
Premium fuerza branding OFF; FREE + theme Premium no exporta. Un render
white-label no dibuja logo, textos, URL, “Powered by Arma2”, CTA ni espacio
reservado de Arma2.

## Membresía y scope administrativo

`tournament_organization_members` conserva identidad, ownership, rol e
invitaciones. `tournament_season_member_assignments` agrega el scope por
temporada para miembros activos `admin` y `collaborator`.

- El owner accede a todas las temporadas sin assignment y no consume cupo.
- Admin/collaborator sólo acceden a temporadas asignadas.
- Una persona asignada a dos temporadas consume un cupo en cada una.
- El trigger de límite serializa por organización/temporada y aplica 1 o 10
  según el plan efectivo.

La UI de Miembros permite seleccionar temporada, ver uso/límite y asignar o
quitar miembros. El enforcement real vive en RLS, triggers y
`has_tournament_season_capability`; no depende del estado visual.

## Funnel y Plan

El intent Premium conserva la secuencia landing → auth → organización →
temporada → Plan → checkout. Con cero temporadas se crea una; con una se abre
su Plan directamente; con varias se muestra el selector de temporadas. Nunca
se elige un torneo hijo para comprar.

La ruta canónica es
`/torneos/organizacion/:organizationId/temporada/:seasonId/plan`. Las rutas de
Plan históricas por torneo redirigen a la temporada padre.

## Seguridad

Las operaciones ligadas a temporada o torneo resuelven membership → owner o
assignment de temporada → capability. Las operaciones genuinamente
organizacionales conservan `has_tournament_organization_capability`. RLS filtra
temporadas, torneos y raíces deportivas; los RPC de checkout, multimedia,
Social y asignaciones reautorizan el scope server-side.

## QA LOCAL

`npm run test:db:torneos:season-commercial` crea transaccionalmente `EDEBA QA`,
`Apertura 2027`, `Clausura 2027` y `Apertura 2028`. Apertura contiene `+35`,
`+40`, `Liga`, `Copa Argentina` y `Copa de Plata`. El harness compra Premium
FAKE una sola vez para Apertura, comprueba herencia en las cinco competencias,
aislamiento de Clausura, assignments, límites 25/1.000, gates Social/branding y
preservación histórica. Al terminar revierte el fixture para mantener la base
local determinista.
