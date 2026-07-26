# Baseline transversal de seguridad y UX

Estado: obligatoria para toda fase posterior de Arma2 Torneos.

Esta baseline no es una lista de mejoras futuras. Es el contrato arquitectónico
que deben respetar el modelo de datos, las RPCs, RLS, los servicios y cada
superficie de producto antes de integrar una fase a la epic.

## Autoridad y comportamiento fail-closed

El backend decide sesión, actor, rol, membresía, capability, tenant, scope,
estado oficial, identidad deportiva y transición permitida. React sólo refleja
esas decisiones y puede ocultar acciones como ayuda de UX; nunca concede acceso.

Una ausencia de sesión, membership activa, capability, relación autoritativa,
scope, recurso, estado o configuración rechaza la operación. Los errores no
deben revelar si existe un UUID de otro tenant. Durante loading, error, cambio
de organización o respuesta fuera de orden no se conserva información anterior.

## Scope multi-tenant

Toda entidad oficial enlaza claves autoritativas de organización, temporada,
torneo, categoría, fase y grupo cuando corresponda. Los límites se sostienen con:

- FKs compuestas y constraints de scope;
- índices que comienzan por las claves del tenant y el contexto deportivo;
- triggers que impiden mover filas entre scopes;
- RLS por audiencia, sin una policy universal;
- RPCs que resuelven el recurso desde el scope autorizado.

Conocer un UUID no concede lectura ni mutación. Capitán y jugador sólo obtienen
la relación derivada de su inscripción o identidad vigente; nunca envían el
tenant o actor como autoridad.

## Mutaciones oficiales y funciones privilegiadas

El cliente no escribe directamente en tablas oficiales. Las mutaciones pasan
por RPCs autenticadas, autorizadas, transaccionales, idempotentes y auditables.
Rebuild, publicación, override y resolución son operaciones separadas.

Toda función `SECURITY DEFINER`:

- valida `auth.uid()` y membership activa;
- exige la capability exacta;
- usa `set search_path = ''` y schemas explícitos;
- revoca `EXECUTE` a `PUBLIC` y `anon`, con grant mínimo a `authenticated`;
- no confía en actor, rol, tenant, resultado ni contadores enviados;
- no usa SQL dinámico inseguro;
- toma locks en el orden documentado.

Orden transversal de locks: torneo → categoría → fixture vigente → fase →
grupo → partido/acta oficial → revisión derivada. Dentro de un mismo nivel se
ordena por UUID ascendente. Publicación serializa la revisión vigente antes de
invalidar o activar otra.

## Privacidad y minimización

Los contextos de lectura devuelven únicamente datos necesarios para la
audiencia. No exponen emails, teléfonos, contactos provisionales, motivos
internos, auditoría privada, información del rival no relacionada, actas draft
ni eventos draft. Si una tabla mezcla campos públicos y privados, se prefieren
RPCs de lectura o grants por columna.

Participantes autenticados sólo ven revisiones publicadas. Los datos internos,
las resoluciones pendientes y los overrides permanecen limitados a owner/admin.
No se crea todavía una audiencia pública sin sesión.

## Auditoría, versiones e inmutabilidad

Toda acción oficial registra actor real, acción, recurso, estado anterior,
estado nuevo, motivo, timestamp del servidor y metadata allowlisted. La
auditoría es append-only.

Fixture publicado, acta oficial, resultado oficial, tabla publicada, resolución
disciplinaria y sanción cumplida no se editan silenciosamente. Una corrección
crea una revisión explícita, preserva historia y publica el reemplazo de forma
atómica. Las proyecciones son reconstruibles desde fixture vigente, actas
oficiales, eventos vigentes y reglas versionadas.

## Concurrencia y rollback

Cada operación sensible cubre doble click, dos pestañas, dos administradores,
publicación concurrente, corrección concurrente y rebuild concurrente. Un fallo
tardío revierte la transacción completa. Nunca queda una tabla parcialmente
actualizada, dos revisiones vigentes ni un resultado oficial ausente durante
una corrección.

## Gate de staging

PostgreSQL embebido valida SQL, constraints, RLS, transacciones y concurrencia,
pero no reemplaza Supabase real. La epic no puede ir a `main` sin un staging
aislado con Auth, PostgREST, RLS, RPCs, web, app móvil y un torneo sintético de
punta a punta. No se aplican migraciones de Torneos al proyecto productivo.

## Dirección visual

La experiencia continúa el sistema oscuro, violeta, deportivo y premium ya
existente. Reutiliza tokens, tipografías, bordes, sombras, cards, botones,
inputs, modales, iconos, animaciones y estados. La firma visual es una
presentación deportiva de datos —jerarquía numérica fuerte, superficies oscuras
y acento violeta— sin convertir cada bloque en un gradiente o brillo.

Cada pantalla responde de inmediato: dónde estoy, qué organización, torneo,
categoría y fase estoy viendo, qué estado tiene y cuál es la próxima acción.
Las acciones secundarias aparecen por progressive disclosure.

## Mobile-first y desktop

En móvil se usan cards, secciones, formularios por pasos, filtros compactos,
acciones sticky cuando aportan claridad y targets mínimos de 44 × 44 px. No se
requiere scroll horizontal, hover ni drag-and-drop. El teclado no tapa acciones
y los textos no se reducen para hacer entrar una tabla.

En desktop se aprovecha el ancho con comparación, columnas de contexto, tablas
ampliadas y paneles laterales. No se estira mecánicamente la versión móvil.

## Estados y prevención de errores

Toda superficie contempla loading/skeleton, vacío, sin permisos, error, offline,
datos parciales, read-only, bloqueado, archivado, desactualizado y éxito. Una
respuesta tardía no reemplaza el contexto actual.

Antes de publicar, recalcular, resolver o aplicar una sanción se muestra el
torneo, categoría, fase, jornada, equipo o partido afectado, qué cambiará y qué
impacto tendrá. Las acciones irreversibles requieren un motivo y una
confirmación específica; se ofrece undo sólo cuando sea transaccionalmente
seguro.

## Lenguaje y accesibilidad

La interfaz usa lenguaje futbolero claro: “tabla desactualizada”, “recalcular”,
“clasificado” y “fecha de suspensión”. Términos internos como tenant, RPC,
snapshot, projection o superseded quedan en documentación técnica.

Son obligatorios labels reales, foco visible, navegación por teclado, contraste
AA, mensajes asociados, ARIA cuando aporta semántica, soporte de zoom y
`prefers-reduced-motion`. Ningún estado depende únicamente del color.

## Pruebas de experiencia

Además de “renderiza”, se prueban primer uso, regreso, corrección, vacío, grandes
volúmenes, nombres largos, mala conexión, doble click, sesión expirada y cambios
de organización/torneo/categoría. La QA mínima usa 320 × 700, 390 × 844,
768 × 1024 y 1440 × 900, verificando overflow, foco, contraste, targets,
acciones sticky y ausencia de dependencia de hover.

La tabla competitiva aplica esta baseline con cinco columnas esenciales en
móvil y detalle expandible. Ninguna simplificación elimina la traza de
desempate, el estado de revisión o el motivo de una acción oficial.

El Participant Hub aplica una única composición por rol, navegación interna
compacta y preferencia de categoría autoritativa. Una carrera o error limpia el
contexto anterior; el roster publicable omite avatar sin consentimiento; los
controles tienen 44 px, foco visible, reducción de movimiento y los datos
tabulares conservan Posición, Equipo, PJ, DG y Puntos en móvil.
