import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AccountDeletionInfoPage, { ACCOUNT_DELETION_REQUEST } from '../pages/AccountDeletionInfoPage';
import AccountDeletionPanel from '../legal/AccountDeletionPanel';
import {
  ACCOUNT_DELETION_SHORT,
  ACCOUNT_DELETION_SUMMARY,
  APPLE_NO_REAUTH_NOTICE,
  APPLE_REAUTH_DECLINED,
  APPLE_UNLINK_MANUAL,
  CORE_DELETION_PARTIAL_MESSAGE,
  STORAGE_ERASURE_FAILED_MESSAGE,
  TORNEOS_ERASURE_FAILED_MESSAGE,
  accountDeletionErrorMessage,
  hasAppleIdentity,
  requestCoreAccountDeletion,
  runAccountDeletion,
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
    await expect(requestCoreAccountDeletion({ functions: { invoke } })).resolves.toEqual({ ok: true, torneos: 'erased', apple: null });
    expect(invoke).toHaveBeenCalledWith('delete-account', { body: { confirm: true } });
  });

  test('with a fresh Apple authorizationCode it goes in the body once; the answer carries the Apple outcome', async () => {
    const invoke = jest.fn().mockResolvedValue({ data: { ok: true, message: 'account_deleted', torneos: 'erased', apple: 'revoked' }, error: null });
    await expect(requestCoreAccountDeletion({ functions: { invoke } }, { appleAuthorizationCode: 'c-apple-code' }))
      .resolves.toEqual({ ok: true, torneos: 'erased', apple: 'revoked' });
    expect(invoke).toHaveBeenCalledWith('delete-account', { body: { confirm: true, apple_authorization_code: 'c-apple-code' } });
  });

  test('the photos step failing: honest (Torneos already anonymised, nothing deleted in Arma2, the account is still active) and retryable', async () => {
    const invoke = jest.fn().mockResolvedValue({ data: null, error: { context: { json: async () => ({ ok: false, message: 'storage_erasure_failed', code: 'storage_remove_failed', retryable: true }) } } });
    await expect(requestCoreAccountDeletion({ functions: { invoke } })).rejects.toThrow(STORAGE_ERASURE_FAILED_MESSAGE);
    expect(STORAGE_ERASURE_FAILED_MESSAGE).toMatch(/no se puede revertir/);
    expect(STORAGE_ERASURE_FAILED_MESSAGE).toMatch(/no borramos nada en Arma2: tu cuenta sigue activa/);
    expect(STORAGE_ERASURE_FAILED_MESSAGE).toMatch(/Volvé a intentarlo/);
  });

  test('a Torneos failure says plainly that nothing was deleted and the account is still active', async () => {
    const invoke = jest.fn().mockResolvedValue({ data: null, error: { context: { json: async () => ({ ok: false, message: 'torneos_erasure_failed', code: 'torneos_erasure_unavailable' }) } } });
    await expect(requestCoreAccountDeletion({ functions: { invoke } })).rejects.toThrow(TORNEOS_ERASURE_FAILED_MESSAGE);
    expect(TORNEOS_ERASURE_FAILED_MESSAGE).toMatch(/no borramos nada: tu cuenta sigue activa/);
  });

  test('Core failing AFTER Torneos: honest (Torneos already anonymised, irreversible; the Arma2 account still exists) and retryable', () => {
    for (const message of ['profile_delete_failed', 'auth_delete_failed']) {
      const text = accountDeletionErrorMessage({ message });
      expect(text).toBe(CORE_DELETION_PARTIAL_MESSAGE);
      expect(text).toMatch(/no se puede revertir/);
      expect(text).toMatch(/sigue existiendo/);
      expect(text).toMatch(/Volvé a intentarlo/);
    }
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
    expect(ACCOUNT_DELETION_SHORT).not.toMatch(/datos asociados/);
  });

  test('no atomicity is promised across Torneos and Arma2: a failed part can be retried, what Torneos anonymised cannot be reverted', () => {
    for (const text of [ACCOUNT_DELETION_SUMMARY.timing, ACCOUNT_DELETION_SHORT]) {
      expect(text).toMatch(/si falla una parte, podés reintentar/i);
      expect(text).toMatch(/lo ya anonimizado en Torneos no se puede revertir/);
    }
    expect(ACCOUNT_DELETION_SUMMARY.timing).not.toMatch(/inmediato/);
  });

  test('photos: the profile photo IS deleted now; what a team still uses is kept and said so; no email procedure anywhere', () => {
    // Exactly the buckets the Storage step erases (jugadores-fotos, avatars, unused team-crests); never «todas tus fotos».
    expect(ACCOUNT_DELETION_SUMMARY.deleted.join(' ')).toMatch(/tu foto de perfil y sus versiones anteriores \(también las del formato de avatar anterior\), tus fotos de jugador, y los escudos y fotos de plantel que subiste y que no usa ningún equipo/);
    expect(ACCOUNT_DELETION_SUMMARY.kept.join(' ')).toMatch(/escudos y fotos de plantel que siguen usando equipos con otros integrantes/);
    expect(ACCOUNT_DELETION_SUMMARY.kept.join(' ')).toMatch(/fotos que se subieron sin cuenta \(por ejemplo, la de un invitado en una votación\) y las imágenes de partidos: no están asociadas a tu cuenta/);
    expect(ACCOUNT_DELETION_SHORT).toMatch(/tu foto de perfil de Arma2/);
    const all = [...ACCOUNT_DELETION_SUMMARY.deleted, ...ACCOUNT_DELETION_SUMMARY.kept, ACCOUNT_DELETION_SUMMARY.apple, ACCOUNT_DELETION_SHORT].join(' ');
    expect(all).not.toMatch(/todavía no se eliminan|próxima actualización/);
    expect(all).not.toMatch(/pedilo|por email|por correo|formulario/i);
  });

  test('Apple: what happens on the iPhone app, on the web / Android, and the manual steps (Apple TN3194)', () => {
    expect(ACCOUNT_DELETION_SUMMARY.apple).toMatch(/desde la app en el iPhone te pedimos que confirmes con Apple y desvinculamos Arma2 de tu Apple ID/);
    expect(ACCOUNT_DELETION_SUMMARY.apple).toMatch(/desde la web o desde Android/);
    expect(APPLE_NO_REAUTH_NOTICE).toMatch(/La cuenta se elimina igual/);
    expect(APPLE_REAUTH_DECLINED).toMatch(/Podés eliminar la cuenta igual/);
    expect(APPLE_UNLINK_MANUAL).toMatch(/No pudimos desvincular Arma2 de tu Apple ID automáticamente/);
  });

  test('no fixed public deadline (24 h / 5 días hábiles): the internal target lives only in the runbook', () => {
    const all = [...ACCOUNT_DELETION_SUMMARY.deleted, ...ACCOUNT_DELETION_SUMMARY.anonymised, ...ACCOUNT_DELETION_SUMMARY.kept,
      ACCOUNT_DELETION_SUMMARY.organizations, ACCOUNT_DELETION_SUMMARY.timing, ACCOUNT_DELETION_SHORT, TORNEOS_ERASURE_FAILED_MESSAGE,
      CORE_DELETION_PARTIAL_MESSAGE].join(' ');
    expect(all).not.toMatch(/hábiles|24 ?h|horas/i);
  });
});

describe('runAccountDeletion (Apple re-authentication on the iPhone app; nothing else changes elsewhere)', () => {
  const appleUser = { id: 'u-1', identities: [{ provider: 'apple', provider_id: '000123.abc.0456' }] };
  const googleUser = { id: 'u-2', identities: [{ provider: 'google' }], app_metadata: { provider: 'google', providers: ['google'] } };
  const okClient = (apple) => ({ functions: { invoke: jest.fn().mockResolvedValue({ data: { ok: true, torneos: 'erased', apple }, error: null }) } });
  const cancelled = () => Object.assign(new Error('No se confirmó con Apple.'), { name: 'AppleReauthCancelledError' });

  test('iOS + Apple account: the Apple sheet runs BEFORE delete-account and its code goes in the body; revoked → no manual steps', async () => {
    const order = [];
    const client = okClient('revoked');
    client.functions.invoke.mockImplementation(async () => { order.push('invoke'); return { data: { ok: true, torneos: 'erased', apple: 'revoked' }, error: null }; });
    const getAppleAuthorizationCode = jest.fn(async () => { order.push('apple'); return 'c-fresh'; });
    const outcome = await runAccountDeletion({ client, user: appleUser, isIosNative: () => true, getAppleAuthorizationCode });
    expect(order).toEqual(['apple', 'invoke']);
    expect(client.functions.invoke).toHaveBeenCalledWith('delete-account', { body: { confirm: true, apple_authorization_code: 'c-fresh' } });
    expect(outcome).toEqual({ status: 'deleted', torneos: 'erased', apple: 'revoked', appleUnlinkNeeded: false });
  });

  test('the person closes the Apple sheet → NOTHING is deleted, the UI asks; «Eliminar igual» deletes without a code and shows the manual steps', async () => {
    const client = okClient('no_code');
    const outcome = await runAccountDeletion({ client, user: appleUser, isIosNative: () => true, getAppleAuthorizationCode: jest.fn().mockRejectedValue(cancelled()) });
    expect(outcome).toEqual({ status: 'apple_declined', cancelled: true });
    expect(client.functions.invoke).not.toHaveBeenCalled();
    const getAppleAuthorizationCode = jest.fn();
    const anyway = await runAccountDeletion({ client, user: appleUser, isIosNative: () => true, getAppleAuthorizationCode, withoutApple: true });
    expect(getAppleAuthorizationCode).not.toHaveBeenCalled();
    expect(client.functions.invoke).toHaveBeenCalledWith('delete-account', { body: { confirm: true } });
    expect(anyway.appleUnlinkNeeded).toBe(true);
  });

  test('an Apple sheet error that is not a cancel is treated the same way (ask; never block the deletion)', async () => {
    const client = okClient('no_code');
    const outcome = await runAccountDeletion({ client, user: appleUser, isIosNative: () => true, getAppleAuthorizationCode: jest.fn().mockRejectedValue(new Error('plugin missing')) });
    expect(outcome).toEqual({ status: 'apple_declined', cancelled: false });
    expect(client.functions.invoke).not.toHaveBeenCalled();
  });

  test('web / Android: no Apple sheet; an Apple account gets the manual steps; a non-Apple account none', async () => {
    const getAppleAuthorizationCode = jest.fn();
    const web = await runAccountDeletion({ client: okClient('no_code'), user: appleUser, isIosNative: () => false, getAppleAuthorizationCode });
    expect(getAppleAuthorizationCode).not.toHaveBeenCalled();
    expect(web.appleUnlinkNeeded).toBe(true);
    const ios = await runAccountDeletion({ client: okClient('not_apple'), user: googleUser, isIosNative: () => true, getAppleAuthorizationCode });
    expect(getAppleAuthorizationCode).not.toHaveBeenCalled();
    expect(ios.appleUnlinkNeeded).toBe(false);
  });

  test('revocation failed / not configured / sub mismatch on the server → the manual steps are shown', async () => {
    for (const apple of ['failed', 'not_configured', 'sub_mismatch', 'no_code', null]) {
      const outcome = await runAccountDeletion({ client: okClient(apple), user: appleUser, isIosNative: () => true, getAppleAuthorizationCode: async () => 'c' });
      expect(outcome.appleUnlinkNeeded).toBe(true);
    }
  });

  test('a server failure is thrown as the message for the person (the account is not deleted)', async () => {
    const client = { functions: { invoke: jest.fn().mockResolvedValue({ data: null, error: { context: { json: async () => ({ message: 'storage_erasure_failed' }) } } }) } };
    await expect(runAccountDeletion({ client, user: googleUser })).rejects.toThrow(STORAGE_ERASURE_FAILED_MESSAGE);
  });

  test('hasAppleIdentity: identities or app_metadata', () => {
    expect(hasAppleIdentity(appleUser)).toBe(true);
    expect(hasAppleIdentity({ app_metadata: { providers: ['email', 'apple'] } })).toBe(true);
    expect(hasAppleIdentity({ app_metadata: { provider: 'apple' } })).toBe(true);
    expect(hasAppleIdentity(googleUser)).toBe(false);
    expect(hasAppleIdentity(null)).toBe(false);
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

  const appleSession = { user: { email: 'persona@example.invalid', identities: [{ provider: 'apple', provider_id: '000123.abc.0456' }] } };

  test('web, Apple account: says it cannot unlink from here, deletes without a sheet, then shows the iPhone steps', async () => {
    const invoke = jest.fn().mockResolvedValue({ data: { ok: true, torneos: 'erased', apple: 'no_code' }, error: null });
    const getAppleAuthorizationCode = jest.fn();
    inRouter(<AccountDeletionPanel client={client(appleSession, invoke)} clearSession={jest.fn().mockResolvedValue({ success: true })}
      isIosNative={() => false} getAppleAuthorizationCode={getAppleAuthorizationCode} />);
    expect(await screen.findByText(APPLE_NO_REAUTH_NOTICE)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('ELIMINAR'), { target: { value: 'ELIMINAR' } });
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar mi cuenta' }));
    expect(await screen.findByText(/Tu cuenta fue eliminada/)).toBeInTheDocument();
    expect(screen.getByText(APPLE_UNLINK_MANUAL)).toBeInTheDocument();
    expect(screen.getByText(/Iniciar sesión con Apple/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ayuda de Apple' })).toHaveAttribute('href', 'https://support.apple.com/102571');
    expect(getAppleAuthorizationCode).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith('delete-account', { body: { confirm: true } });
  });

  test('Torneos inside the iPhone app, Apple account: confirms with Apple first; closing the sheet asks; «Eliminar igual» deletes', async () => {
    const invoke = jest.fn().mockResolvedValue({ data: { ok: true, torneos: 'erased', apple: 'no_code' }, error: null });
    const getAppleAuthorizationCode = jest.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AppleReauthCancelledError' }));
    const clearSession = jest.fn().mockResolvedValue({ success: true });
    inRouter(<AccountDeletionPanel client={client(appleSession, invoke)} clearSession={clearSession}
      isIosNative={() => true} getAppleAuthorizationCode={getAppleAuthorizationCode} />);
    fireEvent.change(await screen.findByPlaceholderText('ELIMINAR'), { target: { value: 'ELIMINAR' } });
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar mi cuenta' }));
    expect(await screen.findByText(APPLE_REAUTH_DECLINED)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
    expect(clearSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar igual' }));
    expect(await screen.findByText(/Tu cuenta fue eliminada/)).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('delete-account', { body: { confirm: true } });
    expect(getAppleAuthorizationCode).toHaveBeenCalledTimes(1);
    expect(screen.getByText(APPLE_UNLINK_MANUAL)).toBeInTheDocument();
  });

  test('Torneos inside the iPhone app, Apple account, revoked: no manual steps', async () => {
    const invoke = jest.fn().mockResolvedValue({ data: { ok: true, torneos: 'erased', apple: 'revoked' }, error: null });
    inRouter(<AccountDeletionPanel client={client(appleSession, invoke)} clearSession={jest.fn().mockResolvedValue({ success: true })}
      isIosNative={() => true} getAppleAuthorizationCode={async () => 'c-fresh'} />);
    fireEvent.change(await screen.findByPlaceholderText('ELIMINAR'), { target: { value: 'ELIMINAR' } });
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar mi cuenta' }));
    expect(await screen.findByText(/Tu cuenta fue eliminada/)).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('delete-account', { body: { confirm: true, apple_authorization_code: 'c-fresh' } });
    expect(screen.queryByText(APPLE_UNLINK_MANUAL)).not.toBeInTheDocument();
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
    expect(screen.getByText(/te\s+informamos cuando esté hecho/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/hábiles|24 ?h\b|24 horas/i);
    expect(document.body.textContent).toMatch(/si falla una parte, podés reintentar/i);
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
