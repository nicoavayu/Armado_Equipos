import {
  canRunLifecycleAction,
  canTransitionTournament,
  getCompetitionErrorContext,
  getCompetitionLifecycleAction,
  getLifecycleErrorMessage,
  getMatchResolutionPresentation,
  getOwnerNextStep,
  getTeamRegistrationAvailability,
  getTournamentStage,
  getTransitionConsequences,
  isWithdrawalNoteRequired,
  WITHDRAWAL_REASONS,
} from '../features/torneos/domain/competitionLifecycle';
import { TOURNAMENT_ROLES } from '../features/torneos/domain/capabilities';

const tournament = {
  id: 'tournament-a',
  status: 'registration',
  checklist: { ready: true },
};

describe('owner-facing competition lifecycle', () => {
  test('presents every canonical state in Spanish without exposing the slug', () => {
    expect(['draft', 'registration', 'scheduled', 'active', 'completed', 'archived']
      .map((status) => getTournamentStage(status).label))
      .toEqual([
        'Borrador',
        'Inscripción de equipos',
        'Lista para comenzar',
        'En juego',
        'Finalizada',
        'Archivada',
      ]);
  });

  test('characterizes only the status transitions exposed by change_tournament_status', () => {
    expect(canTransitionTournament('draft', 'registration')).toBe(true);
    expect(canTransitionTournament('registration', 'draft')).toBe(true);
    // Iniciar, finalizar y reabrir no pasan por change_tournament_status: cada
    // una tiene su propia operación transaccional.
    expect(canTransitionTournament('scheduled', 'active')).toBe(false);
    expect(canTransitionTournament('active', 'completed')).toBe(false);
  });

  test('exposes one lifecycle operation per operable stage', () => {
    expect(getCompetitionLifecycleAction('scheduled')).toMatchObject({
      id: 'start', to: 'active', requiresReason: false,
    });
    expect(getCompetitionLifecycleAction('active')).toMatchObject({
      id: 'finish', to: 'completed', requiresReason: false,
    });
    expect(getCompetitionLifecycleAction('completed')).toMatchObject({
      id: 'reopen', to: 'active', requiresReason: true,
    });
    expect(getCompetitionLifecycleAction('draft')).toBeNull();
    expect(getCompetitionLifecycleAction('archived')).toBeNull();
  });

  test('explains starting by its real consequences, not by what was already possible', () => {
    const start = getCompetitionLifecycleAction('scheduled');
    expect(start.changes).toEqual(expect.arrayContaining([
      expect.stringMatching(/inscripción normal de equipos queda cerrada/i),
      expect.stringMatching(/no tengan horario se pueden programar más adelante/i),
    ]));
    expect(start.changes.join(' ')).not.toMatch(/ahora podrás cargar resultados/i);
  });

  test('reserves reopening for the owner and lets the admin start and finish', () => {
    const owner = { role: TOURNAMENT_ROLES.OWNER };
    const admin = { role: TOURNAMENT_ROLES.ADMIN };
    const collaborator = { role: TOURNAMENT_ROLES.COLLABORATOR };
    const start = getCompetitionLifecycleAction('scheduled');
    const finish = getCompetitionLifecycleAction('active');
    const reopen = getCompetitionLifecycleAction('completed');

    expect(canRunLifecycleAction(owner, start)).toBe(true);
    expect(canRunLifecycleAction(admin, start)).toBe(true);
    expect(canRunLifecycleAction(collaborator, start)).toBe(false);

    expect(canRunLifecycleAction(owner, finish)).toBe(true);
    expect(canRunLifecycleAction(admin, finish)).toBe(true);
    expect(canRunLifecycleAction(collaborator, finish)).toBe(false);

    expect(canRunLifecycleAction(owner, reopen)).toBe(true);
    expect(canRunLifecycleAction(admin, reopen)).toBe(false);
    expect(canRunLifecycleAction(collaborator, reopen)).toBe(false);
  });

  test('only “Otro” demands an observation, and the codes stay stable', () => {
    expect(WITHDRAWAL_REASONS.map((reason) => reason.code)).toEqual([
      'voluntary_resignation',
      'sanction_exclusion',
      'regulatory_breach',
      'other',
    ]);
    expect(isWithdrawalNoteRequired('other')).toBe(true);
    expect(isWithdrawalNoteRequired('voluntary_resignation')).toBe(false);
    expect(isWithdrawalNoteRequired('sanction_exclusion')).toBe(false);
    expect(isWithdrawalNoteRequired('regulatory_breach')).toBe(false);
  });

  test('tells a bye apart from a cancellation decided by the organizer', () => {
    expect(getMatchResolutionPresentation({
      status: 'cancelled',
      cancellationReasonCode: 'withdrawal_bye',
    })).toMatchObject({
      label: 'Fecha libre',
      description: expect.stringMatching(/rival retirado/i),
    });
    expect(getMatchResolutionPresentation({
      status: 'cancelled',
      cancellationReasonCode: 'manual_cancellation',
      cancellationReasonText: 'Cancha inhabilitada',
    })).toMatchObject({ label: 'Cancelado', description: 'Cancha inhabilitada' });
    expect(getMatchResolutionPresentation({ status: 'scheduled' })).toBeNull();
  });

  test('translates backend errors instead of leaking the internal code', () => {
    expect(getLifecycleErrorMessage(
      new Error('TORNEOS_COMPETITION_HAS_PENDING_COMMITMENTS'),
    )).toMatch(/partidos por resolver/i);
    expect(getLifecycleErrorMessage(
      new Error('TORNEOS_COMPETITION_READ_ONLY'),
    )).toMatch(/finalizada/i);
    expect(getLifecycleErrorMessage(
      new Error('TORNEOS_PARTICIPANT_HAS_OPEN_OPERATIONS'),
    )).toMatch(/acta abierta/i);
    expect(getLifecycleErrorMessage(new Error('TORNEOS_UNMAPPED_CODE')))
      .toBe('No pudimos completar la operación.');
    expect(getLifecycleErrorMessage(new Error('No hay conexión.')))
      .toBe('No hay conexión.');
  });

  // Las cuatro condiciones que el backend prevé. Ninguna es una falla del
  // servidor y ninguna puede llegar a la pantalla como un código interno.
  describe('condiciones funcionales del ciclo de vida', () => {
    // Así llega el error después de que el servicio envuelve el de PostgREST:
    // el código de contrato y el dato accionable quedan en `cause`.
    const wrapped = (code, { details = undefined, message } = {}) => {
      const error = new Error(message || 'No pudimos completar la operación.');
      error.code = code;
      error.cause = {
        message: code, code: '22023', details, hint: null,
      };
      return error;
    };

    test('finalizar con pendientes dice cuántos partidos faltan', () => {
      expect(getLifecycleErrorMessage(wrapped(
        'TORNEOS_COMPETITION_HAS_PENDING_COMMITMENTS',
        { details: '4' },
      ))).toBe('Todavía quedan 4 partidos por resolver antes de finalizar la competencia.');
    });

    test('el conteo de pendientes respeta el singular', () => {
      expect(getLifecycleErrorMessage(wrapped(
        'TORNEOS_COMPETITION_HAS_PENDING_COMMITMENTS',
        { details: '1' },
      ))).toBe('Todavía queda 1 partido por resolver antes de finalizar la competencia.');
    });

    test('sin cantidad informada el mensaje sigue siendo accionable', () => {
      expect(getLifecycleErrorMessage(wrapped('TORNEOS_COMPETITION_HAS_PENDING_COMMITMENTS')))
        .toBe('Todavía quedan partidos por resolver antes de finalizar la competencia.');
    });

    test('un equipo ya retirado se explica sin ambigüedad', () => {
      expect(getLifecycleErrorMessage(wrapped('TORNEOS_PARTICIPANT_ALREADY_WITHDRAWN')))
        .toBe('Este equipo ya figura como retirado.');
    });

    test('el acta abierta explica que hay que resolverla antes de retirar', () => {
      expect(getLifecycleErrorMessage(wrapped(
        'TORNEOS_PARTICIPANT_HAS_OPEN_OPERATIONS',
        { details: '1' },
      ))).toBe('El equipo tiene 1 acta abierta. Resolvela o anulala antes de retirarlo.');
      expect(getLifecycleErrorMessage(wrapped(
        'TORNEOS_PARTICIPANT_HAS_OPEN_OPERATIONS',
        { details: '2' },
      ))).toBe('El equipo tiene 2 actas abiertas. Resolvelas o anulalas antes de retirarlo.');
    });

    test('la competencia finalizada invita a reabrirla', () => {
      expect(getLifecycleErrorMessage(wrapped('TORNEOS_COMPETITION_READ_ONLY')))
        .toBe('La competencia está finalizada y no admite cambios. Reabrila si necesitás corregir algo.');
    });

    test('ningún mensaje visible filtra RPC, SQLSTATE, UUID, código ni inglés técnico', () => {
      const messages = [
        getLifecycleErrorMessage(wrapped('TORNEOS_COMPETITION_HAS_PENDING_COMMITMENTS', { details: '4' })),
        getLifecycleErrorMessage(wrapped('TORNEOS_PARTICIPANT_ALREADY_WITHDRAWN')),
        getLifecycleErrorMessage(wrapped('TORNEOS_PARTICIPANT_HAS_OPEN_OPERATIONS', { details: '1' })),
        getLifecycleErrorMessage(wrapped('TORNEOS_COMPETITION_READ_ONLY')),
      ];
      messages.forEach((message) => {
        expect(message).not.toMatch(/TORNEOS_/);
        expect(message).not.toMatch(/tournament_|_competition\(|rpc/i);
        expect(message).not.toMatch(/\b\d{5}\b|22023|55000/);
        expect(message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
        expect(message).not.toMatch(/error|exception|stack|null|undefined/i);
      });
    });

    test('un detalle que no es una cantidad no rompe el mensaje', () => {
      expect(getLifecycleErrorMessage(wrapped(
        'TORNEOS_COMPETITION_HAS_PENDING_COMMITMENTS',
        { details: 'sin datos' },
      ))).toBe('Todavía quedan partidos por resolver antes de finalizar la competencia.');
    });

    test('un código interno escondido dentro del mensaje tampoco se muestra', () => {
      const error = new Error('falló TORNEOS_ALGO_NUEVO en el servidor');
      expect(getLifecycleErrorMessage(error)).toBe('No pudimos completar la operación.');
    });
  });

  test('explains the persisted consequences of publishing the fixture', () => {
    const consequences = getTransitionConsequences('registration', 'scheduled');
    expect(consequences.changes).toEqual(expect.arrayContaining([
      expect.stringMatching(/cierra el alta normal/i),
      expect.stringMatching(/inscripciones ya presentadas/i),
    ]));
    expect(consequences.reversible).toBe(false);
  });

  test('distinguishes a configured registration window from lifecycle closure', () => {
    expect(getTeamRegistrationAvailability({
      status: 'registration',
      registrationClosesAt: '2026-08-10T00:00:00.000Z',
    }, new Date('2026-08-12T00:00:00.000Z'))).toMatchObject({
      canAdd: false,
      title: 'La inscripción de equipos está cerrada',
    });
    expect(getTeamRegistrationAvailability({ status: 'scheduled' })).toMatchObject({
      canAdd: false,
      title: 'La inscripción de equipos está cerrada',
    });
  });

  test('never turns a dashboard query error into a zero-team next step', () => {
    const step = getOwnerNextStep({
      tournament,
      teamsSummary: { status: 'error', data: null },
      fixture: { status: 'ready', participantSet: null, versions: [], matches: [] },
      organizationPath: '/torneos/organizacion/org-a',
    });
    expect(step.title).toBe('No pudimos leer las inscripciones');
    expect(step.title).not.toMatch(/agregá los equipos/i);
  });

  test('offers starting the competition once scheduling is complete', () => {
    const step = getOwnerNextStep({
      tournament: { ...tournament, status: 'scheduled' },
      teamsSummary: { status: 'ready', data: { total: 8 } },
      fixture: {
        status: 'ready',
        matches: [{ status: 'scheduled', scheduledAt: '2026-08-20T20:00:00Z' }],
      },
      organizationPath: '/torneos/organizacion/org-a',
    });
    expect(step.blocked).toBeUndefined();
    expect(step.title).toBe('Iniciá la competencia');
    expect(step.action.id).toBe('start');
    expect(step.description).not.toMatch(/backend/i);
  });

  test('keeps a ready match without kickoff time in the programming step', () => {
    const step = getOwnerNextStep({
      tournament: { ...tournament, status: 'scheduled' },
      teamsSummary: { status: 'ready', data: { total: 8 } },
      fixture: { status: 'ready', matches: [{ status: 'ready', scheduledAt: null }] },
      organizationPath: '/torneos/organizacion/org-a',
    });
    expect(step.blocked).toBeUndefined();
    expect(step.title).toBe('Programá los partidos pendientes');
    expect(step.description).toMatch(/^1 partido necesita/);
  });
});

// Con la competencia Finalizada, la capability y RLS cortan antes que el guard
// de sólo lectura y contestan con un código de permisos. Para el propietario
// —que tiene el rol— esa explicación es falsa: lo que pasa es que la
// competencia está cerrada. El servidor sigue rechazando igual; lo que cambia
// es lo que se le dice al organizador.
describe('rechazos de una competencia cerrada', () => {
  const owner = { role: TOURNAMENT_ROLES.OWNER };
  // El admin gestiona la competencia pero no puede reabrirla: sólo el dueño.
  const admin = { role: TOURNAMENT_ROLES.ADMIN };
  const completed = { id: 'tournament-a', status: 'completed' };
  const archived = { id: 'tournament-a', status: 'archived' };
  const active = { id: 'tournament-a', status: 'active' };

  const forbidden = (code) => {
    const error = new Error('No pudimos completar la operación.');
    error.code = code;
    error.cause = { message: code, code: '42501', details: null, hint: null };
    return error;
  };

  const FORBIDDEN_CODES = [
    'TORNEOS_RESOURCE_FORBIDDEN',
    'TORNEOS_MATCH_FORBIDDEN',
    'TORNEOS_ORGANIZATION_FORBIDDEN',
    'TORNEOS_STANDINGS_FORBIDDEN',
    'TORNEOS_INVALID_TOURNAMENT_TRANSITION',
  ];

  test.each(FORBIDDEN_CODES)(
    'el propietario recibe el estado y no la falta de rol ante %s',
    (code) => {
      const message = getLifecycleErrorMessage(
        forbidden(code),
        undefined,
        getCompetitionErrorContext(owner, completed),
      );
      expect(message).toBe('La competencia está finalizada. Reabrila para realizar cambios.');
      expect(message).not.toMatch(/permiso/i);
      expect(message).not.toMatch(/rol/i);
    },
  );

  test('a quien no puede reabrir no se le ofrece reabrir', () => {
    const message = getLifecycleErrorMessage(
      forbidden('TORNEOS_RESOURCE_FORBIDDEN'),
      undefined,
      getCompetitionErrorContext(admin, completed),
    );
    expect(message).toBe('La competencia está finalizada y no admite cambios.');
    expect(message).not.toMatch(/reabri/i);
  });

  test('una competencia archivada explica que está archivada', () => {
    expect(getLifecycleErrorMessage(
      forbidden('TORNEOS_RESOURCE_FORBIDDEN'),
      undefined,
      getCompetitionErrorContext(owner, archived),
    )).toMatch(/archivada/i);
  });

  test('con la competencia En juego un rechazo por permisos sigue diciendo permisos', () => {
    expect(getLifecycleErrorMessage(
      forbidden('TORNEOS_RESOURCE_FORBIDDEN'),
      undefined,
      getCompetitionErrorContext(admin, active),
    )).toBe('No tenés permisos para hacer esto en esta organización.');
  });

  test('sin contexto de competencia el comportamiento anterior no cambia', () => {
    expect(getLifecycleErrorMessage(forbidden('TORNEOS_RESOURCE_FORBIDDEN')))
      .toBe('No tenés permisos para hacer esto en esta organización.');
  });

  // El estado no puede tapar una causa concreta que el backend sí explicó.
  test('una causa accionable del backend gana sobre el mensaje de estado', () => {
    const error = new Error('No pudimos completar la operación.');
    error.code = 'TORNEOS_PARTICIPANT_HAS_OPEN_OPERATIONS';
    error.cause = {
      message: 'TORNEOS_PARTICIPANT_HAS_OPEN_OPERATIONS',
      code: '22023',
      details: '2',
      hint: null,
    };
    expect(getLifecycleErrorMessage(
      error,
      undefined,
      getCompetitionErrorContext(owner, completed),
    )).toBe('El equipo tiene 2 actas abiertas. Resolvelas o anulalas antes de retirarlo.');
  });

  test('el mensaje de estado nunca filtra un código interno', () => {
    const message = getLifecycleErrorMessage(
      forbidden('TORNEOS_RESOURCE_FORBIDDEN'),
      undefined,
      getCompetitionErrorContext(owner, completed),
    );
    expect(message).not.toMatch(/TORNEOS_/);
    expect(message).not.toMatch(/42501|55000|22023/);
  });
});
