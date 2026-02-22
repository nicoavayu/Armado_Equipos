import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TermsPage from '../pages/TermsPage';
import PrivacyPage from '../pages/PrivacyPage';
import AccountDeletionInfoPage from '../pages/AccountDeletionInfoPage';

const renderInRouter = (ui) =>
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      {ui}
    </MemoryRouter>,
  );

describe('Legal pages', () => {
  let consoleErrorSpy;

  beforeAll(() => {
    const originalConsoleError = console.error;
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args) => {
      const [firstArg] = args;
      if (typeof firstArg === 'string' && firstArg.includes('ReactDOMTestUtils.act')) {
        return;
      }
      originalConsoleError(...args);
    });
  });

  afterAll(() => {
    consoleErrorSpy?.mockRestore();
  });

  test('renders Terms page', () => {
    renderInRouter(<TermsPage />);
    expect(screen.getByText(/Términos y Condiciones/i)).toBeInTheDocument();
  });

  test('renders Privacy page', () => {
    renderInRouter(<PrivacyPage />);
    expect(screen.getByText(/Política de Privacidad/i)).toBeInTheDocument();
  });

  test('renders account deletion info page', () => {
    renderInRouter(<AccountDeletionInfoPage />);
    expect(screen.getByText(/Eliminación de Cuenta/i)).toBeInTheDocument();
  });
});
