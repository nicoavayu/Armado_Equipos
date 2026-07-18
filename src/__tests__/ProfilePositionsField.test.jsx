import { render, screen, fireEvent } from '@testing-library/react';
import ProfilePositionsField from '../components/ProfilePositionsField';

const setup = (props = {}) => {
  const onPositionsChange = jest.fn();
  const onDisponibleArqueroChange = jest.fn();
  render(
    <ProfilePositionsField
      selected={props.selected || []}
      disponibleArquero={props.disponibleArquero || false}
      onPositionsChange={onPositionsChange}
      onDisponibleArqueroChange={onDisponibleArqueroChange}
      labelClass="label"
      formGroupClass="group"
    />,
  );
  return { onPositionsChange, onDisponibleArqueroChange };
};

describe('ProfilePositionsField', () => {
  test('renders the Posiciones label and the max-2 hint', () => {
    setup();
    expect(screen.getByText('Posiciones')).toBeInTheDocument();
    expect(screen.getByText(/hasta 2 posiciones/i)).toBeInTheDocument();
  });

  test('selecting a position emits the toggled array', () => {
    const { onPositionsChange } = setup({ selected: ['DEF'] });
    fireEvent.click(screen.getByRole('button', { name: 'Arquero' }));
    expect(onPositionsChange).toHaveBeenCalledWith(['DEF', 'ARQ']);
  });

  test('at two selections the remaining options are disabled', () => {
    setup({ selected: ['ARQ', 'DEF'] });
    expect(screen.getByRole('button', { name: 'Mediocampista' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delantero' })).toBeDisabled();
    // selected ones stay enabled so they can be unselected
    expect(screen.getByRole('button', { name: 'Arquero' })).not.toBeDisabled();
  });

  test('unselecting a position re-enables the others', () => {
    const { onPositionsChange } = setup({ selected: ['ARQ', 'DEF'] });
    fireEvent.click(screen.getByRole('button', { name: 'Defensor' }));
    expect(onPositionsChange).toHaveBeenCalledWith(['ARQ']);
  });

  test('goalkeeper availability toggle only appears when ARQ is selected', () => {
    const { rerender } = render(
      <ProfilePositionsField
        selected={['DEF']}
        disponibleArquero={false}
        onPositionsChange={() => {}}
        onDisponibleArqueroChange={() => {}}
        labelClass="label"
        formGroupClass="group"
      />,
    );
    expect(screen.queryByText('Disponible para atajar')).not.toBeInTheDocument();

    rerender(
      <ProfilePositionsField
        selected={['ARQ']}
        disponibleArquero={false}
        onPositionsChange={() => {}}
        onDisponibleArqueroChange={() => {}}
        labelClass="label"
        formGroupClass="group"
      />,
    );
    expect(screen.getByText('Disponible para atajar')).toBeInTheDocument();
  });

  test('availability switch reflects and toggles state', () => {
    const onDisponibleArqueroChange = jest.fn();
    render(
      <ProfilePositionsField
        selected={['ARQ']}
        disponibleArquero={false}
        onPositionsChange={() => {}}
        onDisponibleArqueroChange={onDisponibleArqueroChange}
        labelClass="label"
        formGroupClass="group"
      />,
    );
    const sw = screen.getByRole('switch', { name: 'Disponible para atajar' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(onDisponibleArqueroChange).toHaveBeenCalledWith(true);
  });
});
