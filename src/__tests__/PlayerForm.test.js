import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PlayerForm from '../components/PlayerForm';

const mockProps = {
  onAddPlayer: jest.fn(),
};

describe('PlayerForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders player form with inputs and button', () => {
    render(<PlayerForm {...mockProps} />);
    
    expect(screen.getByPlaceholderText(/nombre del jugador/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/puntaje/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /agregar jugador/i })).toBeInTheDocument();
  });

  test('calls onAddPlayer when form is submitted with valid data', async () => {
    render(<PlayerForm {...mockProps} />);
    
    const nameInput = screen.getByPlaceholderText(/nombre del jugador/i);
    const scoreInput = screen.getByPlaceholderText(/puntaje/i);
    const submitButton = screen.getByRole('button', { name: /agregar jugador/i });
    
    fireEvent.change(nameInput, { target: { value: 'Juan Pérez' } });
    fireEvent.change(scoreInput, { target: { value: '8' } });
    fireEvent.click(submitButton);
    
    await waitFor(() => {
      expect(mockProps.onAddPlayer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Juan Pérez',
          score: 8,
        }),
      );
    });
  });

  test('clears form after successful submission', async () => {
    render(<PlayerForm {...mockProps} />);
    
    const nameInput = screen.getByPlaceholderText(/nombre del jugador/i);
    const scoreInput = screen.getByPlaceholderText(/puntaje/i);
    const submitButton = screen.getByRole('button', { name: /agregar jugador/i });
    
    fireEvent.change(nameInput, { target: { value: 'Juan Pérez' } });
    fireEvent.change(scoreInput, { target: { value: '8' } });
    fireEvent.click(submitButton);
    
    await waitFor(() => {
      expect(nameInput.value).toBe('');
      expect(scoreInput.value).toBe('');
    });
  });
});