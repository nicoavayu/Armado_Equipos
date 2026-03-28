// Supabase client is created at module load; ensure Jest has a valid URL/key
// before any test file imports code that pulls in supabaseClient.js.
if (!process.env.REACT_APP_SUPABASE_URL) {
  process.env.REACT_APP_SUPABASE_URL = 'https://example.supabase.co';
}
if (!process.env.REACT_APP_SUPABASE_ANON_KEY) {
  process.env.REACT_APP_SUPABASE_ANON_KEY = 'jest-anon-key-placeholder';
}

// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
// Use require (not import) so env assignments above run before module load ordering issues.
require('@testing-library/jest-dom');
