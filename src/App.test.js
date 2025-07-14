import { render, screen } from '@testing-library/react';
import App from './App';

test('renders app with loading state', () => {
  render(<App />);
  expect(screen.getByText(/cargando autenticación/i)).toBeInTheDocument();
});
