/**
 * Quién puede mantener los recursos visuales de cada equipo.
 *
 * La política sólo amplía permisos hacia miembros del propio equipo: en los
 * tres valores la organización conserva el control total sobre cualquier
 * recurso visual de cualquier equipo. Y en ningún valor habilita publicación:
 * el estado editorial, el consentimiento y las audiencias pública y social
 * siguen siendo decisión de la organización.
 *
 * `capitán` y `delegado` no son etiquetas de esta pantalla: son los roles
 * reales de `tournament_team_managers`.
 */
export const TEAM_VISUAL_POLICIES = Object.freeze({
  ORGANIZATION_ONLY: 'organization_only',
  DELEGATES: 'delegates',
  ROSTER: 'roster',
});

export const TEAM_VISUAL_POLICY_OPTIONS = Object.freeze([
  Object.freeze({
    value: TEAM_VISUAL_POLICIES.ORGANIZATION_ONLY,
    label: 'Sólo la organización',
    description: 'Sólo los miembros autorizados de la organización pueden gestionar escudos y fotos.',
  }),
  Object.freeze({
    value: TEAM_VISUAL_POLICIES.DELEGATES,
    label: 'Delegados y capitanes',
    description: 'Los responsables de cada equipo pueden gestionar el escudo y las fotos de su propio plantel.',
  }),
  Object.freeze({
    value: TEAM_VISUAL_POLICIES.ROSTER,
    label: 'Todo el plantel',
    description: 'Los jugadores con cuenta Arma2 vinculados al equipo también pueden gestionar sus imágenes.',
  }),
]);

export function isTeamVisualPolicy(value) {
  return TEAM_VISUAL_POLICY_OPTIONS.some((option) => option.value === value);
}

export function getTeamVisualPolicyLabel(value) {
  return TEAM_VISUAL_POLICY_OPTIONS.find((option) => option.value === value)?.label || '';
}
