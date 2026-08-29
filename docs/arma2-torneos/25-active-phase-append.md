# Fases posteriores sobre una competencia activa

## Contrato de producto

Una fase deportiva no es una edición comercial. `append_tournament_playoff_phase`
trabaja siempre sobre el mismo `tournament_id`, la misma categoría, el mismo
`participant_set_id` y la misma `tournament_fixture_versions.id`. No consulta
elegibilidad de creación, no crea grants y no llama funciones de Billing.

## Por qué el append vive en la versión publicada

`tournament_match_sources.source_phase_id` tiene una clave foránea compuesta que
exige que la fase fuente y el partido destino pertenezcan a la misma versión de
fixture. Copiar el fixture oficial a una revisión nueva cambiaría las identidades
de fases, jornadas y partidos y desacoplaría actas y resultados existentes.

La operación segura es, por lo tanto, una mutación aditiva y transaccional de la
versión publicada:

1. toma un lock por torneo y categoría;
2. valida Owner/Admin mediante `fixture.publish`;
3. exige una versión publicada vigente y una fase `league` de esa versión;
4. inserta una fase `custom_knockout` posterior;
5. reutiliza el generador knockout existente para agregar jornadas, partidos y
   fuentes estructuradas;
6. audita los conteos anteriores y los rows agregados.

No se actualiza ni elimina ninguna fase, jornada, partido, fuente, acta, evento,
marcador, sanción o estadística anterior. La reejecución con la misma clave es
idempotente.

## Clasificación y seeding

Los primeros cruces usan fuentes `league_position`; no materializan equipos ni
inventan resultados. La resolución existente de clasificación completa esas
fuentes desde una revisión de tabla publicada una vez que la Liga no tiene
compromisos pendientes.

Las cantidades V1 son 2, 4, 8 y 16, limitadas por los participantes activos. La
distribución conserva `1-N`, `2-(N-1)` y así sucesivamente. Las rondas posteriores
siguen usando `winner_of_match` o `winner_of_tie`, según partido único o ida y
vuelta.

## Lifecycle

- `registration`: permitido si ya existe un fixture oficial;
- `scheduled`: permitido;
- `active`: permitido, incluso con partidos y resultados oficiales de Liga;
- `completed` y `archived`: rechazado con `TORNEOS_COMPETITION_READ_ONLY`.

Los drafts normales continúan publicándose sólo en `registration` o `scheduled`.
Una guardia adicional impide modificarlos después de pasar a `active`, cerrando
el caso en que `update_draft_fixture/create_phase` dejaba una revisión sin salida.
El draft todavía puede archivarse mediante el flujo existente.

## UI

En `Fixture > Versiones`, la versión oficial ofrece **Agregar fase** cuando tiene
una Liga y todavía no tiene fase eliminatoria. El Owner elige origen (si hay más
de una Liga), clasificados y partido único o ida y vuelta. Una confirmación
separada explica que la historia anterior no cambia. Al publicar, la navegación
abre `Fixture > Llave` dentro del mismo torneo y conserva `?categoria=`.
