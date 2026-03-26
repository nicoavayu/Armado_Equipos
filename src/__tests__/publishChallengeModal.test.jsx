import { fireEvent, render, screen } from '@testing-library/react';
import PublishChallengeModal from '../features/equipos/components/PublishChallengeModal';

jest.mock('../features/equipos/components/NeighborhoodAutocomplete', () => function MockNeighborhoodAutocomplete({
  value,
  onChange,
  placeholder,
  inputClassName,
}) {
  return (
    <input
      aria-label="Barrio (opcional)"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={inputClassName}
    />
  );
});

const baseTeams = [
  {
    id: 'team-a',
    name: 'Napoli',
    format: 5,
    skill_level: 'intermedio',
    mode: 'Masculino',
    base_zone: 'Palermo',
  },
];

describe('PublishChallengeModal', () => {
  test('mantiene los datos escritos si la lista de equipos se refresca mientras el modal esta abierto', () => {
    const { rerender } = render(
      <PublishChallengeModal
        isOpen
        teams={baseTeams}
        onClose={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Fecha y hora/i), {
      target: { value: '2026-03-26T21:30' },
    });
    fireEvent.change(screen.getByLabelText(/Barrio \(opcional\)/i), {
      target: { value: 'Palermo' },
    });
    fireEvent.change(screen.getByLabelText(/Precio cancha \(opcional\)/i), {
      target: { value: '24000' },
    });

    rerender(
      <PublishChallengeModal
        isOpen
        teams={[
          ...baseTeams.map((team) => ({ ...team })),
          {
            id: 'team-b',
            name: 'Roma',
            format: 5,
            skill_level: 'avanzado',
            mode: 'Masculino',
            base_zone: 'Belgrano',
          },
        ]}
        onClose={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    expect(screen.getByLabelText(/Fecha y hora/i)).toHaveValue('2026-03-26T21:30');
    expect(screen.getByLabelText(/Barrio \(opcional\)/i)).toHaveValue('Palermo');
    expect(screen.getByLabelText(/Precio cancha \(opcional\)/i)).toHaveValue('24000');
  });
});
