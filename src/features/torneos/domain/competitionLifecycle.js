import { hasScheduledTime } from './matchSchedule';
import { hasCapability, TOURNAMENT_CAPABILITIES } from './capabilities';

export const TOURNAMENT_STAGE_PRESENTATION = Object.freeze({
  draft: Object.freeze({
    label: 'Borrador',
    description: 'Completá la configuración y las categorías antes de recibir equipos.',
  }),
  registration: Object.freeze({
    label: 'Inscripción de equipos',
    description: 'Podés agregar equipos, completar planteles y aprobarlos antes de preparar el fixture.',
  }),
  scheduled: Object.freeze({
    label: 'Lista para comenzar',
    description: 'El fixture está publicado. Revisá horarios y canchas antes de iniciar la competencia.',
  }),
  active: Object.freeze({
    label: 'En juego',
    description: 'La competencia está activa y admite la operación deportiva de sus partidos.',
  }),
  completed: Object.freeze({
    label: 'Finalizada',
    description: 'La competencia terminó y sus resultados quedan disponibles para consulta.',
  }),
  archived: Object.freeze({
    label: 'Archivada',
    description: 'La competencia quedó fuera de la operación habitual y se conserva como antecedente.',
  }),
});

export const TOURNAMENT_STATUS_TRANSITIONS = Object.freeze({
  draft: Object.freeze(['registration', 'archived']),
  registration: Object.freeze(['draft', 'archived']),
  scheduled: Object.freeze([]),
  active: Object.freeze([]),
  completed: Object.freeze([]),
  archived: Object.freeze([]),
});

export const TOURNAMENT_TRANSITION_CONSEQUENCES = Object.freeze({
  'draft:registration': Object.freeze({
    title: 'Abrir la etapa de inscripción',
    description: 'El torneo quedará habilitado para incorporar equipos durante las fechas configuradas.',
    changes: Object.freeze([
      'Se habilita el alta de equipos y la preparación de sus planteles.',
      'La configuración general sigue editable mientras el torneo permanezca en esta etapa.',
      'Podés volver a borrador; las inscripciones existentes no se eliminan, pero el alta y la edición normal se cierran.',
    ]),
    confirmLabel: 'Abrir inscripción',
    reversible: true,
  }),
  'registration:draft': Object.freeze({
    title: 'Volver el torneo a borrador',
    description: 'La inscripción normal quedará pausada hasta que vuelvas a abrir esta etapa.',
    changes: Object.freeze([
      'No se podrán agregar equipos nuevos.',
      'La edición normal de planteles quedará cerrada; un plantel observado todavía puede corregirse.',
      'Las inscripciones y planteles existentes se conservan.',
    ]),
    confirmLabel: 'Volver a borrador',
    reversible: true,
  }),
  'draft:archived': Object.freeze({
    title: 'Archivar el torneo',
    description: 'El torneo dejará de aparecer como competencia seleccionable para la operación habitual.',
    changes: Object.freeze([
      'Se limpia como torneo activo de quienes lo tengan seleccionado.',
      'La información persistida se conserva.',
      'El contrato actual no ofrece una acción para desarchivarlo.',
    ]),
    confirmLabel: 'Archivar torneo',
    reversible: false,
  }),
  'registration:archived': Object.freeze({
    title: 'Archivar el torneo',
    description: 'La inscripción se cerrará y el torneo saldrá de la operación habitual.',
    changes: Object.freeze([
      'No se podrán agregar equipos ni continuar la edición normal de planteles.',
      'Se limpia como torneo activo de quienes lo tengan seleccionado.',
      'Las inscripciones existentes se conservan, pero el contrato actual no ofrece una acción para desarchivarlo.',
    ]),
    confirmLabel: 'Archivar torneo',
    reversible: false,
  }),
  'registration:scheduled': Object.freeze({
    title: 'Publicar el fixture y cerrar el alta normal',
    description: 'Publicar esta versión deja al torneo listo para programar y comenzar.',
    changes: Object.freeze([
      'Esta versión pasa a ser el fixture publicado.',
      'El torneo queda en la etapa Lista para comenzar.',
      'Se cierra el alta normal de equipos y la edición normal de planteles.',
      'Las inscripciones ya presentadas todavía pueden revisarse.',
      'Una publicación anterior se conserva como versión reemplazada.',
    ]),
    confirmLabel: 'Publicar fixture',
    reversible: false,
  }),
  'scheduled:scheduled': Object.freeze({
    title: 'Publicar una nueva versión del fixture',
    description: 'La nueva versión pasará a ser la referencia oficial de la competencia.',
    changes: Object.freeze([
      'La versión publicada actual se conserva como versión reemplazada.',
      'La competencia permanece en la etapa Lista para comenzar.',
      'El alta normal de equipos continúa cerrada.',
      'Los cambios de programación deben revisarse sobre la nueva versión.',
    ]),
    confirmLabel: 'Publicar nueva versión',
    reversible: false,
  }),
});

// Operaciones de ciclo de vida que no pasan por `change_tournament_status`:
// cada una tiene su propia RPC transaccional, su capability y su auditoría.
export const COMPETITION_LIFECYCLE_ACTIONS = Object.freeze({
  start: Object.freeze({
    id: 'start',
    from: 'scheduled',
    to: 'active',
    capability: TOURNAMENT_CAPABILITIES.TOURNAMENTS_START,
    label: 'Iniciar competencia',
    title: 'Iniciar la competencia',
    description:
      'Al iniciar la competencia se cierra la etapa de preparación y queda consolidada como En juego.',
    changes: Object.freeze([
      'La inscripción normal de equipos queda cerrada.',
      'El fixture publicado queda consolidado: no se regenera ni se vuelve a sortear.',
      'Los partidos que todavía no tengan horario se pueden programar más adelante.',
      'La operación de partidos, resultados y actas sigue igual que hasta ahora.',
    ]),
    confirmLabel: 'Iniciar competencia',
    reversible: false,
    requiresReason: false,
  }),
  finish: Object.freeze({
    id: 'finish',
    from: 'active',
    to: 'completed',
    capability: TOURNAMENT_CAPABILITIES.TOURNAMENTS_FINISH,
    label: 'Finalizar competencia',
    title: 'Finalizar la competencia',
    description:
      'Finalizar cierra la operación deportiva. Toda la información sigue disponible para consulta.',
    changes: Object.freeze([
      'No se podrán abrir actas nuevas ni modificar resultados.',
      'No se podrán cancelar, programar ni reprogramar partidos.',
      'La tabla, las estadísticas y la página pública siguen disponibles y se pueden recalcular.',
      'Sólo el propietario puede reabrirla después para corregir algo.',
    ]),
    confirmLabel: 'Finalizar competencia',
    reversible: true,
    requiresReason: false,
  }),
  reopen: Object.freeze({
    id: 'reopen',
    from: 'completed',
    to: 'active',
    capability: TOURNAMENT_CAPABILITIES.TOURNAMENTS_REOPEN,
    label: 'Reabrir competencia',
    title: 'Reabrir la competencia',
    description:
      'Reabrir devuelve la competencia a En juego para corregir algo. No reconstruye el fixture ni modifica resultados.',
    changes: Object.freeze([
      'El fixture, los partidos y los resultados quedan exactamente como están.',
      'Se vuelven a habilitar las operaciones deportivas.',
      'Queda registrado quién reabrió la competencia, cuándo y por qué.',
      'Cuando termines las correcciones podés volver a finalizarla.',
    ]),
    confirmLabel: 'Reabrir competencia',
    reversible: true,
    requiresReason: true,
    reasonLabel: 'Motivo de la reapertura',
    reasonHelp: 'Contá qué hay que corregir. Queda registrado en el historial de la competencia.',
  }),
});

export function getCompetitionLifecycleAction(status) {
  return Object.values(COMPETITION_LIFECYCLE_ACTIONS)
    .find((action) => action.from === status) || null;
}

export function canRunLifecycleAction(organization, action) {
  if (!action) return false;
  return hasCapability(organization, action.capability);
}

// Motivos de retiro. El código es el contrato técnico; la etiqueta es sólo
// presentación y nunca viaja al backend.
export const WITHDRAWAL_REASONS = Object.freeze([
  Object.freeze({
    code: 'voluntary_resignation',
    label: 'Renuncia voluntaria',
    noteRequired: false,
  }),
  Object.freeze({
    code: 'sanction_exclusion',
    label: 'Exclusión por sanción',
    noteRequired: false,
  }),
  Object.freeze({
    code: 'regulatory_breach',
    label: 'Incumplimiento reglamentario o administrativo',
    noteRequired: false,
  }),
  Object.freeze({
    code: 'other',
    label: 'Otro',
    noteRequired: true,
  }),
]);

export function getWithdrawalReason(code) {
  return WITHDRAWAL_REASONS.find((reason) => reason.code === code) || null;
}

export function isWithdrawalNoteRequired(code) {
  return getWithdrawalReason(code)?.noteRequired === true;
}

export const TEAM_WITHDRAWAL_CONSEQUENCES = Object.freeze({
  title: 'Retirar el equipo de la competencia',
  description: 'Este equipo dejará de participar en la competencia. Es una acción excepcional.',
  changes: Object.freeze([
    'Los partidos y resultados ya disputados se conservan tal como están.',
    'Los partidos futuros quedan registrados como fecha libre para sus rivales y no otorgan puntos ni estadísticas.',
    'El equipo sigue apareciendo en el historial y en la tabla con la marca Retirado.',
    'No se puede incorporar otro equipo en su lugar.',
  ]),
  confirmLabel: 'Retirar equipo',
});

export const PARTICIPANT_STATUS_LABELS = Object.freeze({
  active: 'En competencia',
  withdrawn: 'Retirado',
  archived: 'Archivado',
});

// Presentación de un partido que ya no se va a jugar. Distingue la fecha libre
// por retiro de una cancelación decidida por la organización.
export function getMatchResolutionPresentation(match) {
  if (!match || match.status !== 'cancelled') return null;
  if (match.cancellationReasonCode === 'withdrawal_bye') {
    return {
      code: 'withdrawal_bye',
      label: 'Fecha libre',
      description: 'Fecha libre — rival retirado. No otorga puntos ni estadísticas.',
    };
  }
  return {
    code: 'manual_cancellation',
    label: 'Cancelado',
    description: match.cancellationReasonText
      || 'El partido fue cancelado por la organización.',
  };
}

// Traduce los errores funcionales del backend. Nunca mostramos el nombre de la
// RPC ni el código interno al propietario.
const LIFECYCLE_ERROR_COPY = Object.freeze({
  TORNEOS_RESOURCE_FORBIDDEN: 'No tenés permisos para hacer esto en esta organización.',
  TORNEOS_AUTH_REQUIRED: 'Volvé a iniciar sesión para continuar.',
  TORNEOS_INVALID_TOURNAMENT_TRANSITION:
    'La competencia no está en la etapa que esta acción necesita. Actualizá la página y revisá su estado.',
  TORNEOS_COMPETITION_FIXTURE_NOT_PUBLISHED:
    'Todavía falta publicar el fixture de alguna categoría activa. Publicalo y volvé a intentar.',
  TORNEOS_COMPETITION_WITHOUT_CATEGORIES:
    'La competencia no tiene categorías activas.',
  TORNEOS_COMPETITION_HAS_PENDING_COMMITMENTS:
    'Todavía quedan partidos por resolver antes de finalizar la competencia.',
  TORNEOS_COMPETITION_READ_ONLY:
    'La competencia está finalizada y no admite cambios. Reabrila si necesitás corregir algo.',
  TORNEOS_REASON_REQUIRED: 'Escribí el motivo antes de confirmar.',
  TORNEOS_WITHDRAWAL_REASON_INVALID: 'Elegí uno de los motivos disponibles.',
  TORNEOS_WITHDRAWAL_NOTE_REQUIRED: 'El motivo “Otro” necesita una observación.',
  TORNEOS_WITHDRAWAL_NOTE_TOO_LONG: 'La observación es demasiado larga.',
  TORNEOS_PARTICIPANT_ALREADY_WITHDRAWN: 'Este equipo ya figura como retirado.',
  TORNEOS_PARTICIPANT_NOT_IN_COMPETITION:
    'Este equipo no forma parte de la lista de participantes de la competencia.',
  TORNEOS_PARTICIPANT_HAS_OPEN_OPERATIONS:
    'El equipo tiene un acta abierta. Resolvela o anulala antes de retirarlo.',
});

// Cuando el backend además calculó cuánto falta, decirlo es la diferencia entre
// un rechazo y una instrucción. El número llega en el `detail` del error.
const LIFECYCLE_ERROR_COUNT_COPY = Object.freeze({
  TORNEOS_COMPETITION_HAS_PENDING_COMMITMENTS: (count) => (count === 1
    ? 'Todavía queda 1 partido por resolver antes de finalizar la competencia.'
    : `Todavía quedan ${count} partidos por resolver antes de finalizar la competencia.`),
  TORNEOS_PARTICIPANT_HAS_OPEN_OPERATIONS: (count) => (count === 1
    ? 'El equipo tiene 1 acta abierta. Resolvela o anulala antes de retirarlo.'
    : `El equipo tiene ${count} actas abiertas. Resolvelas o anulalas antes de retirarlo.`),
});

// El código de contrato viaja en el mensaje, pero el dato accionable viaja en
// `details`. Al envolver el error de PostgREST el original queda en `cause`:
// hay que mirar las dos capas o el número se pierde por el camino.
function readErrorSurface(error) {
  if (typeof error === 'string') return { text: error, detail: '' };
  const layers = [error, error?.cause].filter(Boolean);
  const readable = (value) => (typeof value === 'string' && value ? value : null);
  return {
    text: layers
      .flatMap((layer) => [layer.message, layer.code, layer.details, layer.hint])
      .map(readable)
      .filter(Boolean)
      .join(' '),
    detail: layers.map((layer) => readable(layer.details)).find(Boolean) || '',
  };
}

function readErrorCount(detail) {
  const count = Number.parseInt(String(detail).trim(), 10);
  return Number.isInteger(count) && count > 0 ? count : null;
}

// Con la competencia cerrada, el rechazo que llega al cliente casi nunca es el
// del guard de sólo lectura: la capability o RLS cortan antes y contestan con un
// código de permisos. Para el propietario —que sí tiene el rol— «no tenés
// permisos» es una explicación falsa: lo que pasa es que la competencia está
// cerrada. Estos son los códigos que, en ese estado, esconden esa causa.
const STATE_MASKING_ERROR_CODES = Object.freeze([
  'TORNEOS_RESOURCE_FORBIDDEN',
  'TORNEOS_MATCH_FORBIDDEN',
  'TORNEOS_ORGANIZATION_FORBIDDEN',
  'TORNEOS_STANDINGS_FORBIDDEN',
  'TORNEOS_HUB_FORBIDDEN',
  'TORNEOS_CONTEXT_FORBIDDEN',
  'TORNEOS_INVALID_TOURNAMENT_TRANSITION',
]);

// Nada de esto relaja el servidor: la operación sigue rechazada. Cambia sólo la
// explicación, y se apoya en el estado que la pantalla ya está mostrando.
const CLOSED_COMPETITION_COPY = Object.freeze({
  completed: {
    reopenable: 'La competencia está finalizada. Reabrila para realizar cambios.',
    readOnly: 'La competencia está finalizada y no admite cambios.',
  },
  archived: {
    reopenable: 'La competencia está archivada y no admite cambios.',
    readOnly: 'La competencia está archivada y no admite cambios.',
  },
});

/**
 * El contexto que necesita `getLifecycleErrorMessage` para explicar por estado,
 * armado con lo que las pantallas de competencia ya tienen a mano.
 */
export function getCompetitionErrorContext(organization, tournament) {
  return {
    competitionStatus: tournament?.status,
    canReopen: canRunLifecycleAction(
      organization,
      COMPETITION_LIFECYCLE_ACTIONS.reopen,
    ),
  };
}

/**
 * @param {unknown} error
 * @param {string} [fallback]
 * @param {{ competitionStatus?: string, canReopen?: boolean }} [context]
 *   `competitionStatus` es el estado que la pantalla ya conoce; `canReopen`
 *   evita ofrecerle reabrir a quien no puede hacerlo.
 */
export function getLifecycleErrorMessage(
  error,
  fallback = 'No pudimos completar la operación.',
  context = {},
) {
  const { text, detail } = readErrorSurface(error);
  const known = text
    ? Object.keys(LIFECYCLE_ERROR_COPY).find((code) => text.includes(code))
    : null;

  // El estado explica mejor que el permiso, pero sólo cuando el propio backend
  // no dio ya una causa concreta y accionable.
  const closed = CLOSED_COMPETITION_COPY[context.competitionStatus];
  if (closed && text && STATE_MASKING_ERROR_CODES.some((code) => text.includes(code))) {
    return context.canReopen ? closed.reopenable : closed.readOnly;
  }

  if (known) {
    const count = readErrorCount(detail);
    const withCount = count === null ? null : LIFECYCLE_ERROR_COUNT_COPY[known];
    return withCount ? withCount(count) : LIFECYCLE_ERROR_COPY[known];
  }
  const message = typeof error === 'string' ? error : error?.message;
  if (!message) return fallback;
  // Un código interno nunca se muestra, esté donde esté dentro del mensaje.
  return message.includes('TORNEOS_') ? fallback : message;
}

export function getTournamentStage(status) {
  return TOURNAMENT_STAGE_PRESENTATION[status] || {
    label: 'Estado no disponible',
    description: 'No pudimos interpretar la etapa actual de la competencia.',
  };
}

export function getTournamentCardAction(status, canUpdate = false) {
  if (!canUpdate) return 'Consultar competencia';
  const labels = {
    draft: 'Completar configuración',
    registration: 'Revisar etapa de inscripción',
    scheduled: 'Consultar reglas y estado',
    active: 'Consultar reglas de juego',
    completed: 'Consultar configuración final',
    archived: 'Consultar archivo',
  };
  return labels[status] || 'Consultar competencia';
}

export function canTransitionTournament(fromStatus, toStatus) {
  return TOURNAMENT_STATUS_TRANSITIONS[fromStatus]?.includes(toStatus) || false;
}

export function getTransitionConsequences(fromStatus, toStatus) {
  return TOURNAMENT_TRANSITION_CONSEQUENCES[`${fromStatus}:${toStatus}`] || null;
}

function parseInstant(value) {
  if (!value) return null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

export function getTeamRegistrationAvailability(tournament, now = new Date()) {
  if (!tournament) {
    return {
      canAdd: false,
      title: 'Elegí un torneo',
      description: 'Seleccioná la competencia en la que querés administrar equipos.',
    };
  }
  if (tournament.status === 'registration') {
    const opensAt = parseInstant(tournament.registrationOpensAt);
    const closesAt = parseInstant(tournament.registrationClosesAt);
    if (opensAt && now < opensAt) {
      return {
        canAdd: false,
        title: 'La inscripción todavía no comenzó',
        description: 'El período configurado aún no está abierto. Podés revisar equipos existentes, pero no agregar uno nuevo.',
      };
    }
    if (closesAt && now > closesAt) {
      return {
        canAdd: false,
        title: 'La inscripción de equipos está cerrada',
        description: 'Terminó el período configurado. Los equipos existentes se conservan, pero el alta normal ya no está disponible.',
      };
    }
    return {
      canAdd: true,
      title: 'Inscripción de equipos habilitada',
      description: 'Podés agregar equipos y completar sus planteles antes de cerrar participantes.',
    };
  }
  const copy = {
    draft: {
      title: 'La inscripción todavía no está abierta',
      description: 'Completá la configuración y abrí la etapa de inscripción antes de agregar equipos.',
    },
    scheduled: {
      title: 'La inscripción de equipos está cerrada',
      description: 'El fixture ya fue publicado. Desde esta etapa no se pueden sumar equipos mediante el flujo normal.',
    },
    active: {
      title: 'La inscripción de equipos está cerrada',
      description: 'La competencia ya está en juego. Un equipo puede retirarse: sus partidos jugados se conservan y los futuros quedan como fecha libre. No se puede incorporar otro equipo en su lugar.',
    },
    completed: {
      title: 'La inscripción de equipos está cerrada',
      description: 'La competencia finalizó y sus equipos quedan disponibles para consulta histórica.',
    },
    archived: {
      title: 'El torneo está archivado',
      description: 'No admite nuevas inscripciones ni cambios operativos.',
    },
  };
  return { canAdd: false, ...(copy[tournament.status] || copy.archived) };
}

//
// El próximo paso del organizador incluye a dónde ir, y ese "dónde" ya no se
// arma acá con un prefijo de organización: recibe los destinos ya construidos
// por los builders de ruta. La razón es que la mitad de estas superficies son
// del torneo, y concatenar sobre el prefijo de la organización era exactamente
// la forma de perderlo.
//
export function getOwnerNextStep({
  tournament,
  teamsSummary,
  fixture,
  routes = {},
}) {
  if (!tournament) return null;
  if (tournament.status === 'draft') {
    return {
      eyebrow: 'Próximo paso',
      title: tournament.checklist?.ready ? 'Abrí la inscripción de equipos' : 'Completá la configuración',
      description: tournament.checklist?.ready
        ? 'La configuración está lista. Revisá las consecuencias y habilitá la incorporación de equipos.'
        : 'Terminá los requisitos pendientes antes de recibir equipos.',
      label: 'Revisar configuración',
      to: routes.configuration,
    };
  }
  if (tournament.status === 'registration') {
    if (teamsSummary?.status === 'error') {
      return {
        eyebrow: 'Revisión necesaria',
        title: 'No pudimos leer las inscripciones',
        description: 'Reintentá la consulta antes de decidir el siguiente paso.',
        label: 'Ver equipos',
        to: routes.teams,
      };
    }
    const teams = teamsSummary?.data;
    if (teams && teams.total === 0) {
      return {
        eyebrow: 'Próximo paso',
        title: 'Agregá los equipos participantes',
        description: 'Incorporá al menos dos equipos y completá sus planteles para poder preparar el fixture.',
        label: 'Agregar equipo',
        to: routes.teamNew,
      };
    }
    if (teams?.submitted > 0 || (teams?.incomplete ?? 0) > 0) {
      return {
        eyebrow: 'Próximo paso',
        title: teams.submitted > 0 ? 'Revisá las inscripciones presentadas' : 'Completá los planteles',
        description: 'Todos los equipos deben quedar aprobados con su plantel válido antes de cerrar participantes.',
        label: 'Revisar equipos',
        to: routes.teams,
      };
    }
    if (fixture?.status === 'error') {
      return {
        eyebrow: 'Revisión necesaria',
        title: 'No pudimos leer el fixture',
        description: 'Reintentá la consulta; un error nunca se interpreta como ausencia de partidos.',
        label: 'Abrir fixture',
        to: routes.fixture,
      };
    }
    if (fixture?.status === 'ready' && fixture.participantSet?.status !== 'frozen') {
      return {
        eyebrow: 'Próximo paso',
        title: 'Cerrá la lista de participantes',
        description: 'Confirmá qué equipos aprobados van a integrar esta versión antes de generar cruces.',
        label: 'Confirmar participantes',
        to: routes.fixtureParticipants,
      };
    }
    if (fixture?.status === 'ready' && fixture.versions.length === 0) {
      return {
        eyebrow: 'Próximo paso',
        title: 'Generá el fixture',
        description: 'Creá una versión borrador, revisala y publicala cuando esté correcta.',
        label: 'Generar fixture',
        to: routes.fixtureGenerate,
      };
    }
    return {
      eyebrow: 'Próximo paso',
      title: 'Revisá y publicá el fixture',
      description: 'La publicación cierra el alta normal de equipos y deja la competencia lista para programar.',
      label: 'Revisar versiones',
      to: routes.fixture,
    };
  }
  if (tournament.status === 'scheduled') {
    const unscheduled = fixture?.status === 'ready'
      ? fixture.matches.filter((match) => !hasScheduledTime(match)).length
      : null;
    if (unscheduled === null) {
      return {
        eyebrow: 'Revisión necesaria',
        title: 'Confirmá el estado de la programación',
        description: 'Necesitamos cargar el fixture antes de indicar si quedan partidos sin horario.',
        label: 'Abrir programación',
        to: routes.schedule,
      };
    }
    if (unscheduled > 0) {
      return {
        eyebrow: 'Próximo paso',
        title: 'Programá los partidos pendientes',
        description: `${unscheduled} ${unscheduled === 1 ? 'partido necesita' : 'partidos necesitan'} horario y cancha.`,
        label: 'Programar partidos',
        to: routes.schedule,
      };
    }
    return {
      eyebrow: 'Próximo paso',
      title: 'Iniciá la competencia',
      description: 'El fixture está publicado. Iniciar cierra la etapa de preparación; los partidos sin horario se pueden programar después.',
      label: 'Revisar partidos',
      to: routes.matches,
      action: COMPETITION_LIFECYCLE_ACTIONS.start,
    };
  }
  if (tournament.status === 'active') {
    return {
      eyebrow: 'Operación actual',
      title: 'Cargá resultados y actas',
      description: 'Operá cada partido y revisá su impacto en tabla, estadísticas y disciplina. Cuando no queden partidos por resolver vas a poder finalizarla.',
      label: 'Abrir partidos',
      to: routes.matches,
      action: COMPETITION_LIFECYCLE_ACTIONS.finish,
    };
  }
  if (tournament.status === 'completed') {
    return {
      eyebrow: 'Consulta histórica',
      title: 'Revisá el cierre de la competencia',
      description: 'Resultados, tabla, estadísticas y disciplina quedan disponibles para consulta. Si detectás un error, el propietario puede reabrirla.',
      label: 'Ver tabla final',
      to: routes.table,
      action: COMPETITION_LIFECYCLE_ACTIONS.reopen,
    };
  }
  return {
    eyebrow: 'Consulta',
    title: 'Competencia archivada',
    description: 'El contrato actual no permite devolverla a una etapa operativa.',
    label: 'Ver torneos',
    to: routes.tournaments,
    blocked: true,
  };
}
