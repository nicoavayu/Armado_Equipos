# Fixture, grupos y programación

## Alcance

Esta fase agrega la estructura competitiva previa al partido dentro de Arma2
Torneos. No incorpora resultados, tabla de posiciones, eventos, estadísticas,
comunicaciones ni operación en vivo.

El flujo persistido es:

1. cerrar participantes aprobados;
2. definir bombos y seeds cuando el formato lo requiera;
3. ejecutar y publicar un sorteo reproducible;
4. generar o crear manualmente una versión del fixture;
5. validar y publicar esa versión;
6. configurar sedes, canchas y ventanas;
7. programar, reprogramar, posponer o cancelar partidos.

## Modelo y garantías

La migración `20260726010000_tournament_fixture_scheduling.sql` crea quince
entidades con alcance compuesto de organización, torneo y categoría:

- snapshots y participantes competitivos;
- bombos y miembros de bombos;
- versiones, fases, grupos, miembros, jornadas, partidos y fuentes;
- sedes, canchas, ventanas y reprogramaciones.

Las identidades futuras de un cruce no se guardan como texto. Cada lado usa una
fuente estructurada: participante, posición de grupo, posición de una fase de
liga, ganador/perdedor de otro partido, ganador/perdedor de una serie o bye.
Las fuentes de grupo y liga conservan la fase de origen; las series conservan
una clave inequívoca. Los triggers comprueban el alcance, el orden entre fases
y rechazan referencias cíclicas.

Un cierre de participantes conserva nombre, escudo y colores del equipo en ese
momento. Reabrirlo invalida las versiones dependientes y obliga a generar una
nueva. Las versiones publicadas no se editan: una corrección crea una versión
draft nueva y la publicación reemplaza la anterior de manera auditable.

Los RPC son `security definer`, usan `search_path` vacío, obtienen el actor desde
`auth.uid()` y verifican capacidades del lado servidor. Las tablas tienen RLS:
owner/admin administran, collaborator lee y un usuario ajeno no puede descubrir
recursos de otro tenant. La auditoría sólo se escribe desde funciones confiables.

## Generación

Se soportan los cinco formatos del núcleo competitivo:

- liga simple o ida y vuelta;
- eliminación simple, con byes, seeds, ida/vuelta y tercer puesto;
- grupos;
- grupos y playoffs;
- liga y playoffs.

La misma lista, configuración y seed produce el mismo sorteo. La generación crea
versión, fases, jornadas, partidos y fuentes en una transacción. Antes de
publicar se verifican fuentes incompletas, cruces consigo mismo, duplicados,
grupos vacíos, estructura incompleta y distribución anómala por jornada.
Los byes avanzan la fuente correspondiente sin materializar un partido
jugable. En eliminación ida/vuelta, la siguiente ronda referencia al ganador
de la serie y no a uno de sus partidos.

## Programación

Las sedes pertenecen a la organización y sus canchas declaran una modalidad. Las
ventanas pueden acotarse por torneo, categoría, sede, cancha, día semanal o fecha
específica.

La validación de una asignación distingue bloqueos y advertencias. Entre otros:

- superposición de cancha;
- cancha fuera de la sede;
- modalidad incompatible;
- horario fuera de ventana;
- torneo, temporada o categoría fuera de vigencia;
- descanso mínimo;
- más de un partido diario;
- cruces aún no resolubles.

Un bloqueo nunca admite override. Una advertencia requiere capacidad específica
y motivo explícito. Toda reprogramación agrega una fila de historial; posponer y
cancelar conservan estados distintos.

## Frontend

El shell agrega `Fixture` a la navegación de organización. Las rutas disponibles
son:

- `/fixture`, `/fixture/participantes`, `/fixture/bombos`,
  `/fixture/sorteo`, `/fixture/grupos`, `/fixture/generar`;
- `/fixture/version/:fixtureVersionId`, `/fixture/jornadas`,
  `/fixture/jornadas/:roundId`, `/fixture/partidos/:matchId`,
  `/fixture/llave`;
- `/programacion`, `/sedes`, `/sedes/:venueId`.

`TorneosFixtureProvider` descarta respuestas obsoletas cuando cambia
organización, torneo o categoría, y limpia el contexto ante errores de carga o
mutación. La interfaz usa únicamente el contexto persistido, expone un flujo
por pasos, ofrece formulario accesible como alternativa a gestos y pasa a una
llave vertical en pantallas angostas. Los puntos de quiebre contemplan 320, 390,
768 y 1440 px, con objetivos interactivos de al menos 44 px y reducción de
movimiento.

## Verificación local

```bash
npm test -- --runInBand
npm run test:db:torneos:fixture
REACT_APP_SUPABASE_URL=http://127.0.0.1:54321 \
REACT_APP_SUPABASE_ANON_KEY=local-test-key \
npm run build
```

El harness de PostgreSQL embebido aplica las cuatro migraciones de Torneos desde
cero. Sus 203 verificaciones específicas cubren los cinco formatos,
idempotencia, determinismo, carreras de congelamiento/publicación/autoschedule,
bombos, grupos, liga simple e ida/vuelta, eliminación y byes, fuentes y ciclos,
fixture manual, RLS, aislamiento entre organizaciones, ventanas, conflictos,
rollbacks, reprogramación append-only y auditoría. No requiere Supabase remoto
y no equivale a ejecutar el stack Supabase/PostgREST completo.

## Despliegue

Aplicar primero las migraciones anteriores de workspaces, núcleo competitivo y
equipos/planteles. Luego aplicar la migración de esta fase y desplegar el
frontend. La implementación no ejecuta migraciones remotas ni modifica datos de
producción automáticamente.
