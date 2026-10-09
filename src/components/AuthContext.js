import { createContext, useContext } from 'react';

// The session context object, apart from AuthProvider so that surfaces which only READ the shared identity (Torneos)
// do not load the native sign-in modules AuthProvider brings with it.
export const AuthContext = createContext();

// The shared identity when there is one, null otherwise (tests, isolated compositions). Read-only.
export const useOptionalAuth = () => useContext(AuthContext) || null;
