export const ROLE_LABELS = Object.freeze({
  owner: 'Propietario',
  admin: 'Administrador',
  collaborator: 'Colaborador',
  delegate: 'Delegado',
  player: 'Jugador',
  outsider: 'Sin acceso',
  captain: 'Capitán',
  assistant: 'Asistente',
  team_manager: 'Responsable de equipo',
});

export const ROLE_DESCRIPTIONS = Object.freeze({
  owner: 'Control total de la organización, sus torneos y la configuración.',
  admin: 'Gestiona la operación de los torneos y la configuración, sin archivar la organización.',
  collaborator: 'Consulta información y configuración habilitadas, sin realizar cambios administrativos.',
  delegate: 'Gestiona los equipos o planteles que tiene asignados.',
  player: 'Participa en sus equipos y consulta la información publicada del torneo.',
  outsider: 'No tiene una membresía ni un acceso asignado a la organización.',
  captain: 'Gestiona el equipo o plantel que tiene asignado.',
  assistant: 'Consulta el equipo o plantel que tiene asignado, sin administrarlo.',
  team_manager: 'Gestiona el equipo o plantel que tiene asignado.',
});

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

export function getRoleLabel(role, fallback = 'Sin acceso') {
  return ROLE_LABELS[normalizeRole(role)] || fallback;
}

export function getRoleDescription(role, fallback = '') {
  return ROLE_DESCRIPTIONS[normalizeRole(role)] || fallback;
}
