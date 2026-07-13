import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const TARGET_ID = '00000000-0000-4000-8000-000000000002';

// Prefijo `mock` requerido por el hoisting de jest.mock (referencias externas).
let mockCurrentUser = { id: ADMIN_ID };
let mockRelationship = null; // { status, id }
const mockSendFriendRequest = jest.fn(async () => ({ ok: true }));
const mockRemoveFriend = jest.fn(async () => ({ ok: true }));

jest.mock('../components/AuthProvider', () => ({
  useAuth: () => ({ user: mockCurrentUser }),
}));

jest.mock('../hooks/useAmigos', () => ({
  useAmigos: () => ({
    getRelationshipStatus: async () => mockRelationship,
    sendFriendRequest: (...args) => mockSendFriendRequest(...args),
    removeFriend: (...args) => mockRemoveFriend(...args),
  }),
}));

jest.mock('../services/db/profiles', () => ({
  getProfile: async () => ({ nombre: 'Target', usuario_id: '00000000-0000-4000-8000-000000000002' }),
}));

jest.mock('../supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: '00000000-0000-4000-8000-000000000001' } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { telefono: null }, error: null }) }) }) }),
  },
}));

// ProfileCard arrastra árbol pesado (import.meta): se stubea.
jest.mock('../components/ProfileCard', () => () => <div data-testid="profile-card" />);
jest.mock('../components/WhatsappIcon', () => () => <span />);
jest.mock('../components/Modal', () => ({ isOpen, children }) => (isOpen ? <div data-testid="modal">{children}</div> : null));
jest.mock('../components/ConfirmModal', () => () => null);

// eslint-disable-next-line import/first
import ProfileCardModal from '../components/ProfileCardModal';

const PROFILE = { nombre: 'Target', usuario_id: TARGET_ID };
const AS_ADMIN_MATCH = { creado_por: ADMIN_ID, admins: [] };

const renderModal = (props = {}) => render(
  <ProfileCardModal
    isOpen
    onClose={() => {}}
    profile={PROFILE}
    partidoActual={AS_ADMIN_MATCH}
    onMakeAdmin={props.onMakeAdmin || (() => {})}
    initialRelationshipStatus={mockRelationship}
    {...props}
  />,
);

beforeEach(() => {
  mockCurrentUser = { id: ADMIN_ID };
  mockRelationship = null;
  mockSendFriendRequest.mockImplementation(async () => ({ ok: true }));
  mockRemoveFriend.mockImplementation(async () => ({ ok: true }));
});

describe('ProfileCard action buttons — modernized bottom row', () => {
  test('the three actions render as short, single-line labels (no two-line text)', async () => {
    renderModal();
    const modal = await screen.findByTestId('modal');
    const add = await within(modal).findByText('Agregar');
    const contact = within(modal).getByText('Contactar');
    const admin = within(modal).getByText('Dar admin');

    for (const label of [add, contact, admin]) {
      const button = label.closest('button');
      expect(button).not.toBeNull();
      // whitespace-nowrap garantiza una sola línea; radio premium (rounded-xl),
      // sin el rounded-none anterior.
      expect(button.className).toContain('whitespace-nowrap');
      expect(button.className).toContain('rounded-xl');
      expect(button.className).not.toContain('rounded-none');
      // Se eliminó el aspecto marrón anterior del botón de admin.
      expect(button.className).not.toContain('rgba(94,73,28');
    }
  });

  test('friendship states: none => Agregar, pending => Enviada (disabled), accepted => Amigos (disabled)', async () => {
    mockRelationship = null;
    const view1 = renderModal();
    let modal = await screen.findByTestId('modal');
    expect(await within(modal).findByText('Agregar')).toBeInTheDocument();
    view1.unmount();

    mockRelationship = { status: 'pending', id: 'r1' };
    const view2 = renderModal({ initialRelationshipStatus: mockRelationship });
    modal = await screen.findByTestId('modal');
    const sent = await within(modal).findByText('Enviada');
    expect(sent.closest('button')).toBeDisabled();
    view2.unmount();

    mockRelationship = { status: 'accepted', id: 'r2' };
    renderModal({ initialRelationshipStatus: mockRelationship });
    modal = await screen.findByTestId('modal');
    const friends = await within(modal).findByText('Amigos');
    expect(friends.closest('button')).toBeDisabled();
  });

  test('admin permissions: a non-admin viewer sees neither Contactar nor Dar admin', async () => {
    const NON_ADMIN_MATCH = { creado_por: '00000000-0000-4000-8000-0000000000ff', admins: [] };
    renderModal({ partidoActual: NON_ADMIN_MATCH });
    const modal = await screen.findByTestId('modal');
    expect(await within(modal).findByText('Agregar')).toBeInTheDocument();
    expect(within(modal).queryByText('Contactar')).toBeNull();
    expect(within(modal).queryByText('Dar admin')).toBeNull();
  });

  test('loading state: sending a friend request shows "Enviando…" and calls the service (no regression)', async () => {
    let resolveSend;
    mockSendFriendRequest.mockImplementation(() => new Promise((resolve) => { resolveSend = resolve; }));
    renderModal();
    const modal = await screen.findByTestId('modal');
    const addBtn = (await within(modal).findByText('Agregar')).closest('button');

    fireEvent.click(addBtn);
    expect(mockSendFriendRequest).toHaveBeenCalledWith(TARGET_ID);
    await waitFor(() => expect(within(modal).getByText('Enviando…')).toBeInTheDocument());
    resolveSend({ ok: true });
  });
});
