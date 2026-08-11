import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import TorneosSelect from '../features/torneos/components/TorneosSelect';

function Harness() {
  const [value, setValue] = useState('apertura');
  return (
    <label>
      Torneo
      <TorneosSelect value={value} onChange={(event) => setValue(event.target.value)}>
        <option value="apertura">Torneo Apertura Metropolitana Categoría Abierta 2026</option>
        <option value="clausura">Torneo Clausura</option>
        <option value="archivado" disabled>Archivado</option>
      </TorneosSelect>
    </label>
  );
}

function RequiredHarness() {
  const [value, setValue] = useState('');
  return (
    <form data-testid="required-form">
      <label>
        Categoría
        <TorneosSelect
          name="categoryId"
          required
          value={value}
          onChange={(event) => setValue(event.target.value)}
        >
          <option value="">Seleccionar</option>
          <option value="primera">Primera</option>
        </TorneosSelect>
      </label>
    </form>
  );
}

describe('TorneosSelect', () => {
  test('exposes one accessible combobox and a dark shared popup', () => {
    render(<Harness />);
    const trigger = screen.getByRole('combobox', { name: 'Torneo' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox')).toHaveClass('menu', 'dark');
    expect(screen.getByRole('option', { name: 'Archivado' }))
      .toHaveAttribute('aria-disabled', 'true');
  });

  test('supports arrows, Enter and Escape without truncating the selected label', () => {
    render(<Harness />);
    const trigger = screen.getByRole('combobox', { name: 'Torneo' });

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(trigger).toHaveTextContent('Torneo Clausura');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('preserves native required validation and form serialization', () => {
    render(<RequiredHarness />);
    const form = screen.getByTestId('required-form');
    const trigger = screen.getByRole('combobox', { name: 'Categoría' });

    expect(form).not.toBeValid();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: 'Primera' }));

    expect(form).toBeValid();
    expect(new FormData(form).get('categoryId')).toBe('primera');
  });
});
