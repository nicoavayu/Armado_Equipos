import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AccountDeletionInfoPage, { ACCOUNT_DELETION_REQUEST } from '../pages/AccountDeletionInfoPage';
import AccountDeletionPanel from '../legal/AccountDeletionPanel';
import {
  ACCOUNT_DELETION_SHORT,
  ACCOUNT_DELETION_SUMMARY,
  TORNEOS_ERASURE_FAILED_MESSAGE,
  accountDeletionErrorMessage,
  requestCoreAccountDeletion,
} from '../legal/accountDeletion';
import { requestBody } from '../legal/EmailRequestForm';

const mockGetSession = jest.fn();
const mockInvoke = jest.fn();
jest.mock('../supabase', () => ({
  supabase: { auth: { getSession: (...args) => mockGetSession(...args) }, functions: { invoke: (...args) => mockInvoke(...args) } },
}));
const mockClearLocalAuthSession = jest.fn();
jest.mock('../services/authLogoutService', () => ({ clearLocalAuthSession: (...args) => mockClearLocalAuthSession(...args) }));

const inRouter = (ui) => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{ui}</MemoryRouter>);
const client = (session, invoke) => ({ auth: { getSession: async () => ({ data: { session } }) }, functions: { invoke } });

beforeEach(() => {
  mockGetSession.mockReset().mockResolvedValue({ data: { session: null } });
  mockInvoke.mockReset();
  mockClearLocalAuthSession.mockReset().mockResolvedValue({ success: true });
});

describe('requestCoreAccountDeletion (the one Core flow, Torneos first)', () => {
  test('calls delete-account with confirm only (the server takes the user from the session)', async () => {
    const invoke = jest.fn().mockResolvedValue({ data: { ok: true, message: 'account_deleted', torneos: 'erased' }, error: null });
    await expect(requestCoreAccountDeletion({ functions: { invoke } })).resolves.toEqual({ ok: true, torneos: 'erased' });
    expect(invoke).toHaveBeenCalledWith('delete-account', { body: { confirm: true } });
  });

  test('a Torneos failure says plainly that nothing was deleted and the account is still active', async () => {
    const invoke = jest.fn().mockResolvedValue({ data: null, error: { context: { json: async () => ({ ok: false, message: 'torneos_erasure_failed', code: 'torneos_erasure_unavailable' }) } } });
    await expect(requestCoreAccountDeletion({ functions: { invoke } })).rejects.toThrow(TORNEOS_ERASURE_FAILED_MESSAGE);
    expect(TORNEOS_ERASURE_FAILED_MESSAGE).toMatch(/no borramos nada: tu cuenta sigue activa/);
  });

  test('other server answers map to messages for people, never to codes', () => {
    expect(accountDeletionErrorMessage({ message: 'profile_delete_failed' })).toMatch(/Volvé a intentarlo/);
    expect(accountDeletionErrorMessage({ message: 'not_authenticated' })).toMatch(/Iniciá sesión de nuevo/);
    expect(accountDeletionErrorMessage({ message: 'whatever' })).toBeNull();
  });
});

describe('the texts say what the code does', () => {
  test('summary: deleted / anonymised / kept with the reasons; purchases kept; organizations transfer or close; no Torneos-specific promise of refunds', () => {
    const all = [...ACCOUNT_DELETION_SUMMARY.deleted, ...ACCOUNT_DELETION_SUMMARY.anonymised, ...ACCOUNT_DELETION_SUMMARY.kept,
      ACCOUNT_DELETION_SUMMARY.organizations, ACCOUNT_DELETION_SUMMARY.timing].join(' ');
    expect(all).toMatch(/Jugador eliminado/);
    expect(all).toMatch(/compras y pagos/);
    expect(all).toMatch(/defensa del consumidor/);
    expect(all).toMatch(/administrador más antiguo/);
    expect(all).toMatch(/no se reembolsa ni se modifica ninguna compra/);
    expect(all).toMatch(/foto de perfil .* no se borra automáticamente/);
    expect(ACCOUNT_DELETION_SHORT).not.toMatch(/datos asociados/);
  });
});

describe('AccountDeletionPanel (web: the same flow with the session of this browser)', () => {
  test('signed out: explains how to get here signed in, and points to the email request', async () => {
    inRouter(<AccountDeletionPanel client={client(null, jest.fn())} clearSession={jest.fn()} />);
    expect(await screen.findByText(/No tenés la sesión iniciada en este navegador/)).toBeInTheDocument();
    expect(screen.getByText(/Torneos → Perfil → Eliminar cuenta/)).toBeInTheDocument();
  });

  test('signed in: needs ELIMINAR, deletes through Core, then clears the local session', async () => {
    const invoke = jest.fn().mockResolvedValue({ data: { ok: true, torneos: 'erased' }, error: null });
    const clearSession = jest.fn().mockResolvedValue({ success: true });
    inRouter(<AccountDeletionPanel client={client({ user: { email: 'persona@example.invalid' } }, invoke)} clearSession={clearSession} />);
    const button = await screen.findByRole('button', { name: 'Eliminar mi cuenta' });
    expect(screen.getByText('persona@example.invalid')).toBeInTheDocument();
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('ELIMINAR'), { target: { value: 'eliminar' } });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(await screen.findByText(/Tu cuenta fue eliminada/)).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('delete-account', { body: { confirm: true } });
    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  test('signed in, Torneos down: the message says the account is still active; the session is NOT cleared', async () => {
    const invoke = jest.fn().mockResolvedValue({ data: null, error: { context: { json: async () => ({ message: 'torneos_erasure_failed' }) } } });
    const clearSession = jest.fn();
    inRouter(<AccountDeletionPanel client={client({ user: { email: 'persona@example.invalid' } }, invoke)} clearSession={clearSession} />);
    fireEvent.change(await screen.findByPlaceholderText('ELIMINAR'), { target: { value: 'ELIMINAR' } });
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar mi cuenta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('tu cuenta sigue activa');
    expect(clearSession).not.toHaveBeenCalled();
  });
});

describe('/account-deletion (public): the web request Google asks for', () => {
  test('renders what is deleted, kept and why, the three ways, and an email request with an ELIM reference that is NOT sent by the page', async () => {
    inRouter(<AccountDeletionInfoPage />);
    expect(screen.getByText(/Eliminación de Cuenta/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Qué se borra' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Qué se conserva y por qué' })).toBeInTheDocument();
    expect(screen.getByText(/Perfil → Eliminar cuenta, y confirmá escribiendo ELIMINAR/)).toBeInTheDocument();
    expect(await screen.findByText(/No tenés la sesión iniciada en este navegador/)).toBeInTheDocument();
    expect(screen.getByText(/no lo envía por vos/)).toBeInTheDocument();
    expect(screen.getByText(/5 días hábiles/)).toBeInTheDocument();
    const form = screen.getByRole('form', { name: 'Preparar el pedido de eliminación de cuenta' });
    expect(form).toBeInTheDocument();
    expect(screen.queryByText(/Organización y temporada/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Nombre y apellido'), { target: { value: 'Persona Ficticia' } });
    fireEvent.change(screen.getByLabelText('Email de contacto'), { target: { value: 'persona@example.invalid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preparar el correo' }));
    const status = await screen.findByText(/Tu solicitud todavía no fue enviada/);
    expect(status).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Abrir mi correo con la solicitud lista' });
    expect(link.getAttribute('href')).toMatch(/^mailto:arma2app@gmail\.com\?subject=Eliminar%20cuenta%20ELIM-\d{8}-[A-Z2-9]{6}/);
    expect(decodeURIComponent(link.getAttribute('href'))).toMatch(/Email de la cuenta Arma2: /);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test('the email body of a deletion request names the account email line, and the other requests keep the Mercado Pago line', () => {
    const form = { name: 'P', email: 'p@example.invalid', operation: 'cuenta@example.invalid', season: '', comment: '' };
    expect(requestBody(ACCOUNT_DELETION_REQUEST.intro, 'ELIM-1', form, ACCOUNT_DELETION_REQUEST.operationBodyLabel)).toMatch(/Email de la cuenta Arma2: cuenta@example\.invalid/);
    expect(requestBody('x', 'ARR-1', form)).toMatch(/Operación de Mercado Pago \(o fecha y monto\): /);
  });
});

describe('Perfil de Torneos', () => {
  test('the account action is «Eliminar cuenta» and leads to /account-deletion', () => {
    const source = require('fs').readFileSync(require('path').join(__dirname, '../features/torneos/components/connected/TorneosProfilePage.jsx'), 'utf8');
    expect(source).toContain('<Link className={styles.textAction} to="/account-deletion">Eliminar cuenta</Link>');
    expect(source).not.toContain('Cómo eliminar la cuenta');
  });
});
