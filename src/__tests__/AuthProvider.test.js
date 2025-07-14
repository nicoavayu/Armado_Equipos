import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import AuthProvider, { useAuth } from '../components/AuthProvider';
import { supabase } from '../supabase';

// Mock Supabase
jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn()
    }
  },
  getProfile: jest.fn()
}));

const TestComponent = () => {
  const { user, loading } = useAuth();
  
  if (loading) return <div>Loading...</div>;
  return <div>{user ? `User: ${user.email}` : 'No user'}</div>;
};

describe('AuthProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('shows loading state initially', () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    supabase.auth.onAuthStateChange.mockReturnValue({ 
      data: { subscription: { unsubscribe: jest.fn() } } 
    });

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    expect(screen.getByText('Cargando autenticación...')).toBeInTheDocument();
  });

  test('provides user context when authenticated', async () => {
    const mockUser = { id: '123', email: 'test@example.com' };
    const mockSession = { user: mockUser };
    
    supabase.auth.getSession.mockResolvedValue({ data: { session: mockSession } });
    supabase.auth.onAuthStateChange.mockReturnValue({ 
      data: { subscription: { unsubscribe: jest.fn() } } 
    });

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('User: test@example.com')).toBeInTheDocument();
    });
  });

  test('shows no user when not authenticated', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    supabase.auth.onAuthStateChange.mockReturnValue({ 
      data: { subscription: { unsubscribe: jest.fn() } } 
    });

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('No user')).toBeInTheDocument();
    });
  });
});