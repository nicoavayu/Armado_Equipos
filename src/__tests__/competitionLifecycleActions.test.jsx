import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import CompetitionLifecycleActions from '../features/torneos/components/CompetitionLifecycleActions';
import TeamWithdrawalDialog from '../features/torneos/components/TeamWithdrawalDialog';
import { TOURNAMENT_ROLES } from '../features/torneos/domain/capabilities';

const mockMutations = {
  startCompetition: jest.fn(),
  finishCompetition: jest.fn(),
  reopenCompetition: jest.fn(),
  withdrawCompetitionParticipant: jest.fn(),
};

jest.mock('../features/torneos/context/TorneosCompetitionContext', () => ({
  useTorneosCompetition: () => mockMutations,
}));

const owner = { id: 'org-a', role: TOURNAMENT_ROLES.OWNER };
const admin = { id: 'org-a', role: TOURNAMENT_ROLES.ADMIN };
const collaborator = { id: 'org-a', role: TOURNAMENT_ROLES.COLLABORATOR };

const competition = (status) => ({ id: 'tournament-a', status });

beforeEach(() => {
  Object.values(mockMutations).forEach((mock) => mock.mockReset().mockResolvedValue({}));
});

describe('acciones de ciclo de vida de la competencia', () => {
  test('el propietario inicia la competencia después de leer las consecuencias', async () => {
    render(
      <CompetitionLifecycleActions
        organization={owner}
        tournament={competition('scheduled')}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /iniciar competencia/i }));

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/inscripción normal de equipos queda cerrada/i)).toBeInTheDocument();
    expect(screen.getByText(/no tengan horario se pueden programar más adelante/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Iniciar competencia' }));

    await waitFor(() => expect(mockMutations.startCompetition).toHaveBeenCalledWith({
      tournamentId: 'tournament-a',
    }));
  });

  test('finalizar explica el cierre operativo y que sólo el propietario reabre', () => {
    render(
      <CompetitionLifecycleActions
        organization={admin}
        tournament={competition('active')}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /finalizar competencia/i }));
    expect(screen.getByText(/no se podrán abrir actas nuevas/i)).toBeInTheDocument();
    expect(screen.getByText(/sólo el propietario puede reabrirla/i)).toBeInTheDocument();
  });

  test('el administrador no ve la acción de reabrir', () => {
    const { rerender } = render(
      <CompetitionLifecycleActions
        organization={admin}
        tournament={competition('completed')}
      />,
    );
    expect(screen.queryByRole('button', { name: /reabrir/i })).not.toBeInTheDocument();

    rerender(
      <CompetitionLifecycleActions
        organization={owner}
        tournament={competition('completed')}
      />,
    );
    expect(screen.getByRole('button', { name: /reabrir competencia/i })).toBeInTheDocument();
  });

  test('reabrir exige motivo antes de habilitar la confirmación', async () => {
    render(
      <CompetitionLifecycleActions
        organization={owner}
        tournament={competition('completed')}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /reabrir competencia/i }));

    const confirm = screen.getByRole('button', { name: 'Reabrir competencia' });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Se cargó mal el resultado de la última fecha' },
    });
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    await waitFor(() => expect(mockMutations.reopenCompetition).toHaveBeenCalledWith({
      tournamentId: 'tournament-a',
      reason: 'Se cargó mal el resultado de la última fecha',
    }));
  });

  test('el colaborador no ve ninguna acción de ciclo de vida', () => {
    const { container } = render(
      <CompetitionLifecycleActions
        organization={collaborator}
        tournament={competition('scheduled')}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('un error del backend se muestra como texto funcional', async () => {
    mockMutations.finishCompetition.mockRejectedValue(
      new Error('TORNEOS_COMPETITION_HAS_PENDING_COMMITMENTS'),
    );
    render(
      <CompetitionLifecycleActions
        organization={owner}
        tournament={competition('active')}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /finalizar competencia/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar competencia' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/partidos por resolver/i);
    expect(alert).not.toHaveTextContent(/TORNEOS_/);
  });

  // El backend cuenta los partidos que faltan; esa cantidad es lo único que
  // convierte el rechazo en una instrucción. Antes se calculaba y se descartaba.
  test('al finalizar con pendientes la pantalla dice cuántos partidos faltan', async () => {
    const failure = new Error('No pudimos finalizar la competencia.');
    failure.code = 'TORNEOS_COMPETITION_HAS_PENDING_COMMITMENTS';
    failure.cause = {
      message: 'TORNEOS_COMPETITION_HAS_PENDING_COMMITMENTS',
      code: '22023',
      details: '4',
      hint: null,
    };
    mockMutations.finishCompetition.mockRejectedValue(failure);
    render(
      <CompetitionLifecycleActions
        organization={owner}
        tournament={competition('active')}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /finalizar competencia/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar competencia' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Todavía quedan 4 partidos por resolver antes de finalizar la competencia.',
    );
    expect(alert).not.toHaveTextContent(/TORNEOS_|22023|rpc/i);
  });

  test('una competencia finalizada explica que hay que reabrirla', async () => {
    const failure = new Error('No pudimos finalizar la competencia.');
    failure.code = 'TORNEOS_COMPETITION_READ_ONLY';
    failure.cause = { message: 'TORNEOS_COMPETITION_READ_ONLY', code: '22023' };
    mockMutations.finishCompetition.mockRejectedValue(failure);
    render(
      <CompetitionLifecycleActions
        organization={owner}
        tournament={competition('active')}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /finalizar competencia/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar competencia' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/finalizada/i);
    expect(alert).toHaveTextContent(/reabrila/i);
  });
});

describe('retiro de un equipo', () => {
  const entry = { id: 'entry-a', name: 'Estrella del Sur', status: 'approved' };

  const renderDialog = (props = {}) => render(
    <TeamWithdrawalDialog
      tournament={competition('active')}
      entry={entry}
      onClose={jest.fn()}
      onWithdrawn={jest.fn()}
      {...props}
    />,
  );

  test('muestra qué pasa antes de confirmar, no sólo “¿estás seguro?”', () => {
    renderDialog();
    expect(screen.getByText(/Estrella del Sur/)).toBeInTheDocument();
    expect(screen.getByText(/ya disputados se conservan/i)).toBeInTheDocument();
    expect(screen.getByText(/fecha libre para sus rivales/i)).toBeInTheDocument();
    expect(screen.getByText(/marca Retirado/i)).toBeInTheDocument();
    expect(screen.getByText(/no se puede incorporar otro equipo/i)).toBeInTheDocument();
    expect(screen.queryByText(/¿estás seguro\?/i)).not.toBeInTheDocument();
  });

  test('el motivo es obligatorio y “Otro” además exige observación', () => {
    renderDialog();
    const confirm = screen.getByRole('button', { name: /retirar equipo/i });
    expect(confirm).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: 'Otro' }));
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Se fusionó con otra institución' },
    });
    expect(confirm).toBeEnabled();
  });

  test('un motivo estándar no necesita observación y envía el código estable', async () => {
    const onClose = jest.fn();
    const onWithdrawn = jest.fn();
    renderDialog({ onClose, onWithdrawn });

    fireEvent.click(screen.getByRole('radio', { name: 'Renuncia voluntaria' }));
    fireEvent.click(screen.getByRole('button', { name: /retirar equipo/i }));

    await waitFor(() => expect(mockMutations.withdrawCompetitionParticipant).toHaveBeenCalledWith({
      tournamentId: 'tournament-a',
      teamEntryId: 'entry-a',
      reasonCode: 'voluntary_resignation',
      reasonText: null,
    }));
    await waitFor(() => expect(onWithdrawn).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  test('un acta abierta se explica en castellano', async () => {
    mockMutations.withdrawCompetitionParticipant.mockRejectedValue(
      new Error('TORNEOS_PARTICIPANT_HAS_OPEN_OPERATIONS'),
    );
    renderDialog();
    fireEvent.click(screen.getByRole('radio', { name: 'Renuncia voluntaria' }));
    fireEvent.click(screen.getByRole('button', { name: /retirar equipo/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/acta abierta/i);
    expect(alert).not.toHaveTextContent(/TORNEOS_/);
  });

  test('el acta abierta dice cuántas hay que resolver antes de retirar', async () => {
    const failure = new Error('No pudimos retirar el equipo.');
    failure.code = 'TORNEOS_PARTICIPANT_HAS_OPEN_OPERATIONS';
    failure.cause = {
      message: 'TORNEOS_PARTICIPANT_HAS_OPEN_OPERATIONS',
      code: '22023',
      details: '2',
    };
    mockMutations.withdrawCompetitionParticipant.mockRejectedValue(failure);
    renderDialog();
    fireEvent.click(screen.getByRole('radio', { name: 'Renuncia voluntaria' }));
    fireEvent.click(screen.getByRole('button', { name: /retirar equipo/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'El equipo tiene 2 actas abiertas. Resolvelas o anulalas antes de retirarlo.',
    );
    expect(alert).not.toHaveTextContent(/TORNEOS_|22023/);
  });

  test('un equipo ya retirado se informa como situación prevista', async () => {
    const failure = new Error('No pudimos retirar el equipo.');
    failure.code = 'TORNEOS_PARTICIPANT_ALREADY_WITHDRAWN';
    failure.cause = { message: 'TORNEOS_PARTICIPANT_ALREADY_WITHDRAWN', code: '22023' };
    mockMutations.withdrawCompetitionParticipant.mockRejectedValue(failure);
    renderDialog();
    fireEvent.click(screen.getByRole('radio', { name: 'Renuncia voluntaria' }));
    fireEvent.click(screen.getByRole('button', { name: /retirar equipo/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Este equipo ya figura como retirado.');
    expect(alert).not.toHaveTextContent(/TORNEOS_/);
  });
});
