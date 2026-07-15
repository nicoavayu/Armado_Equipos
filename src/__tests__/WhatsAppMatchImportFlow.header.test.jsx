import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('../components/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'user@example.com' },
    profile: { nombre: 'Nico' },
  }),
}));

jest.mock('../components/PageTitle', () => function MockPageTitle({ children }) {
  return <div>{children}</div>;
});

jest.mock('../components/VenuePicker', () => function MockVenuePicker() {
  return <div data-testid="venue-picker" />;
});

jest.mock('../supabase', () => ({
  crearPartido: jest.fn(),
}));

jest.mock('../services/db/importedMatchPlayers', () => ({
  buildImportedPlayerRows: jest.fn(),
  saveImportedPlayers: jest.fn(),
}));

const WhatsAppMatchImportFlow = require('../components/WhatsAppMatchImportFlow').default;

describe('WhatsAppMatchImportFlow import prompt', () => {
  test('removes the creation-assistant eyebrow without moving the main prompt', () => {
    const { container } = render(
      <WhatsAppMatchImportFlow onBack={jest.fn()} onCreated={jest.fn()} />,
    );

    expect(screen.queryByText('Asistente de creación')).not.toBeInTheDocument();

    const prompt = screen.getByRole('heading', { name: 'PEGÁ LA CONVERSACIÓN' });
    const spacer = prompt.previousElementSibling;

    expect(spacer).toHaveAttribute('aria-hidden', 'true');
    expect(spacer).toHaveClass('wa-import-eyebrow-spacer', 'h-[15px]');
    expect(prompt).toHaveClass('mt-1');
    expect(container.querySelectorAll('.wa-import-eyebrow-spacer')).toHaveLength(1);
  });
});
