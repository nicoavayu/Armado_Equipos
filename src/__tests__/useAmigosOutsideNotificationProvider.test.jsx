import React from 'react';
import { render, screen } from '@testing-library/react';

import { useAmigos } from '../hooks/useAmigos';

jest.mock('../supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
  getAmigos: jest.fn(async () => []),
}));

// Public web routes (e.g. /partido/:id/invitacion) render player cards, whose friend
// actions use useAmigos, without a NotificationProvider above them.
function Probe() {
  const { amigos } = useAmigos('user-1');
  return <span data-testid="friends">{amigos.length}</span>;
}

test('useAmigos works on routes that have no NotificationProvider', () => {
  render(<Probe />);
  expect(screen.getByTestId('friends')).toHaveTextContent('0');
});
