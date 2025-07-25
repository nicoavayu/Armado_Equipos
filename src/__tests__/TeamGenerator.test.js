import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Button from '../components/Button';

const mockProps = {
  onClick: jest.fn(),
  children: 'Test Button',
};

describe('Button Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders button with correct text', () => {
    render(<Button {...mockProps} />);
    
    expect(screen.getByRole('button', { name: /test button/i })).toBeInTheDocument();
  });

  test('calls onClick when clicked', () => {
    render(<Button {...mockProps} />);
    
    const button = screen.getByRole('button', { name: /test button/i });
    fireEvent.click(button);
    
    expect(mockProps.onClick).toHaveBeenCalledTimes(1);
  });

  test('shows loading state when loading prop is true', () => {
    render(<Button {...mockProps} loading={true} />);
    
    expect(screen.getByText(/cargando/i)).toBeInTheDocument();
  });

  test('disables button when disabled prop is true', () => {
    render(<Button {...mockProps} disabled={true} />);
    
    expect(screen.getByRole('button')).toBeDisabled();
  });
});