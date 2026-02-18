import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TermsPage from '../pages/TermsPage';
import PrivacyPage from '../pages/PrivacyPage';
import AccountDeletionInfoPage from '../pages/AccountDeletionInfoPage';

describe('Legal pages', () => {
  test('renders Terms page', () => {
    render(
      <MemoryRouter>
        <TermsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Términos y Condiciones/i)).toBeInTheDocument();
  });

  test('renders Privacy page', () => {
    render(
      <MemoryRouter>
        <PrivacyPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Política de Privacidad/i)).toBeInTheDocument();
  });

  test('renders account deletion info page', () => {
    render(
      <MemoryRouter>
        <AccountDeletionInfoPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Eliminación de Cuenta/i)).toBeInTheDocument();
  });
});
