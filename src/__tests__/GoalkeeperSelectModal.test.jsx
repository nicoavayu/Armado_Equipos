import { fireEvent, render, screen } from '@testing-library/react';
import GoalkeeperSelectModal from '../components/GoalkeeperSelectModal';

const players = [
  { id: 1, uuid: 'uuid-1', nombre: 'Ana' },
  { id: 2, uuid: 'uuid-2', nombre: 'Bruno' },
  { id: 3, uuid: 'uuid-3', nombre: 'Carla' },
  { id: 4, uuid: 'uuid-4', nombre: 'Diego' },
];

const renderModal = (props = {}) => render(
  <GoalkeeperSelectModal
    isOpen
    players={players}
    onDismiss={jest.fn()}
    onConfirm={jest.fn()}
    {...props}
  />,
);

describe('GoalkeeperSelectModal', () => {
  test('muestra pregunta, ayuda y todos los jugadores', () => {
    renderModal();

    expect(screen.getByText('¿Hay arqueros fijos?')).toBeInTheDocument();
    expect(screen.getByText('Seleccioná hasta 2 jugadores que van a atajar este partido.')).toBeInTheDocument();
    players.forEach((player) => {
      expect(screen.getByText(player.nombre)).toBeInTheDocument();
    });
  });

  test('permite seleccionar hasta 2 y muestra feedback al intentar un tercero', () => {
    renderModal();

    fireEvent.click(screen.getByText('Ana'));
    fireEvent.click(screen.getByText('Bruno'));
    expect(screen.getAllByText('ARQ')).toHaveLength(2);

    const hint = screen.getByText('Máximo 2 arqueros fijos.');
    expect(hint).toHaveClass('opacity-0');

    fireEvent.click(screen.getByText('Carla'));
    expect(screen.getAllByText('ARQ')).toHaveLength(2);
    expect(hint).toHaveClass('opacity-100');
  });

  test('permite deseleccionar un arquero marcado', () => {
    renderModal();

    fireEvent.click(screen.getByText('Ana'));
    expect(screen.getAllByText('ARQ')).toHaveLength(1);
    fireEvent.click(screen.getByText('Ana'));
    expect(screen.queryByText('ARQ')).not.toBeInTheDocument();
  });

  test('"No hay" confirma sin arqueros aunque haya selección', () => {
    const onConfirm = jest.fn();
    renderModal({ onConfirm });

    fireEvent.click(screen.getByText('Ana'));
    fireEvent.click(screen.getByText('No hay'));

    expect(onConfirm).toHaveBeenCalledWith([]);
  });

  test('"Continuar" con 0 seleccionados confirma vacío (comportamiento actual)', () => {
    const onConfirm = jest.fn();
    renderModal({ onConfirm });

    fireEvent.click(screen.getByText('Continuar'));

    expect(onConfirm).toHaveBeenCalledWith([]);
  });

  test('"Continuar" con 2 seleccionados devuelve los jugadores elegidos', () => {
    const onConfirm = jest.fn();
    renderModal({ onConfirm });

    fireEvent.click(screen.getByText('Bruno'));
    fireEvent.click(screen.getByText('Diego'));
    fireEvent.click(screen.getByText('Continuar'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const selected = onConfirm.mock.calls[0][0];
    expect(selected.map((p) => p.uuid).sort()).toEqual(['uuid-2', 'uuid-4']);
  });

  test('no renderiza nada cuando está cerrado', () => {
    render(
      <GoalkeeperSelectModal
        isOpen={false}
        players={players}
        onDismiss={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );

    expect(screen.queryByText('¿Hay arqueros fijos?')).not.toBeInTheDocument();
  });
});
