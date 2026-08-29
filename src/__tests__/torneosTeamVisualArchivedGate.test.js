import fs from 'fs';
import path from 'path';

/**
 * 1C.3A.1 — dónde queda `archived` en la autogestión visual.
 *
 * El informe de la pasada anterior dejaba una lectura ambigua: decía que
 * `rejected`, `withdrawn` y `archived` quedan fuera, y mostraba como evidencia
 * una condición que sólo nombra dos de los tres. No es una inconsistencia: son
 * DOS gates distintos, a distinta altura del mismo predicado, y esa diferencia
 * de altura es justamente el contrato.
 *
 *   * `entry.status <> 'archived'` vive en el WHERE compartido, antes de que se
 *     abra la disyunción de ramas. Alcanza a las tres, incluida la de
 *     organización: una inscripción archivada es historia cerrada y ni el owner
 *     le toca el escudo o el retrato. Por eso `archived` NO aparece en la lista
 *     de la rama de autogestión —ya quedó afuera arriba—.
 *   * `entry.status NOT IN ('rejected', 'withdrawn')` vive DENTRO de la rama de
 *     autogestión. Ahí la organización conserva el alcance que ya tenía.
 *
 * Este test lee el SQL de la migración y afirma la altura, no la presencia:
 * mover el gate de `archived` adentro de la rama —que es la regresión que haría
 * al override de organización saltárselo— rompe acá.
 */

const MIGRATION = 'supabase/migrations/20260818210000_tournament_team_visual_self_management.sql';

const sql = fs.readFileSync(path.join(process.cwd(), MIGRATION), 'utf8');

/** El cuerpo `$$ … $$` de una función, sin los comentarios de línea. */
function functionBody(name) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  const open = sql.indexOf('AS $$', start);
  const close = sql.indexOf('$$;', open);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return sql
    .slice(open + 'AS $$'.length, close)
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

/** Profundidad de paréntesis de un offset, contada desde el `WHERE` del EXISTS. */
function depthAt(body, needle) {
  const where = body.indexOf('WHERE entry.id = p_team_entry_id');
  expect(where).toBeGreaterThan(-1);
  const at = body.indexOf(needle);
  expect(at).toBeGreaterThan(where);
  let depth = 0;
  for (const char of body.slice(where, at)) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
  }
  return depth;
}

describe('`archived` cierra la inscripción por encima de las ramas', () => {
  const ARCHIVED = "entry.status <> 'archived'";
  const SELF_SERVICE = "entry.status NOT IN ('rejected', 'withdrawn')";

  test('el gate de gestión está en el WHERE compartido, no dentro de una rama', () => {
    const body = functionBody('can_manage_tournament_team_visual_assets_as');
    expect(body).toContain(ARCHIVED);
    // Profundidad 0 = misma altura que el WHERE: corre antes de abrir ramas.
    expect(depthAt(body, ARCHIVED)).toBe(0);
    // Y la rama de autogestión sí está anidada.
    expect(depthAt(body, SELF_SERVICE)).toBeGreaterThan(0);
  });

  test('la rama de organización queda por debajo del gate de `archived`', () => {
    const body = functionBody('can_manage_tournament_team_visual_assets_as');
    // El override de organización aparece DESPUÉS del gate: está adentro de la
    // disyunción que el gate ya condicionó.
    expect(body.indexOf(ARCHIVED)).toBeLessThan(body.indexOf('tournament_organization_members'));
    // Y la restricción de autogestión aparece después del override, así que no
    // lo alcanza.
    expect(body.indexOf('tournament_organization_members')).toBeLessThan(body.indexOf(SELF_SERVICE));
  });

  test('`archived` no está en la lista de la rama porque ya quedó afuera arriba', () => {
    const body = functionBody('can_manage_tournament_team_visual_assets_as');
    const list = body.slice(body.indexOf(SELF_SERVICE), body.indexOf(SELF_SERVICE) + SELF_SERVICE.length);
    expect(list).not.toContain('archived');
  });

  test('la moderación tiene el mismo gate y con el mismo alcance', () => {
    const body = functionBody('can_moderate_tournament_team_visual_assets_as');
    expect(body).toContain(ARCHIVED);
    expect(depthAt(body, ARCHIVED)).toBe(0);
    // La moderación no tiene rama de autogestión: es organización y nada más.
    expect(body).not.toContain(SELF_SERVICE);
  });
});
