# PR: Route Errors Through handleError in AuthPage and EncuestaPartido

## Summary
Integrated centralized error handling in two critical flows (authentication and survey submission) by routing errors through handleError, maintaining identical UX while improving error logging and consistency.

## Changes Made

### File 1: `src/components/AuthPage.js` (Authentication Flow)

#### Added Import
```javascript
import { handleError, AppError, ERROR_CODES } from '../lib/errorHandler';
```

#### Integrated in 4 Functions

**1. handleLogout**
- Before: Manual toast.error with error.message
- After: handleError with showToast: true
- UX: Same error messages

**2. handleLogin**
- Before: Manual setError with custom messages
- After: handleError with showToast: false (preserves setError for UI)
- UX: Same error messages (Email not confirmed, Invalid credentials)

**3. handleRegister**
- Before: Manual setError with error.message
- After: handleError with showToast: false (preserves setError for UI)
- UX: Same success/error messages

**4. handleResetPassword**
- Before: Manual setError with error.message
- After: handleError with showToast: false (preserves setError for UI)
- UX: Same success/error messages

### File 2: `src/pages/EncuestaPartido.js` (Survey Flow)

#### Added Import
```javascript
import { handleError, AppError, ERROR_CODES } from '../lib/errorHandler';
```

#### Integrated in 2 Functions

**1. fetchPartidoData (useEffect)**
- Before: console.error + toast.error
- After: handleError with showToast: true + AppError for not found
- UX: Same error messages
- Improvement: Uses ERROR_CODES.NOT_FOUND for partido not found

**2. continueSubmitFlow**
- Before: console.error + toast.error with concatenated message
- After: handleError with showToast: true
- UX: Same error messages

## Implementation Details

### Error Flow Pattern
```javascript
try {
  const { error } = await supabaseOperation();
  if (error) throw error;
  // Success path
} catch (error) {
  handleError(error, { showToast: true/false });
} finally {
  setLoading(false);
}
```

### showToast Strategy
- **showToast: true**: When no UI error state exists (logout, survey submit)
- **showToast: false**: When setError() displays error in UI (login, register, reset)

### AppError Usage
- Used in EncuestaPartido for "Partido no encontrado" with ERROR_CODES.NOT_FOUND
- Provides semantic error codes for better error tracking

## Code Quality
- ✅ Only 2 files modified
- ✅ No UX changes (same messages, same timing)
- ✅ Consistent error handling pattern
- ✅ All errors now logged with [ERROR] prefix
- ✅ No new dependencies
- ✅ Preserves existing error messages

## Build Verification
```bash
npm run build
# ✅ Compiled successfully
# ✅ No errors or warnings
```

## UX Verification

### AuthPage Flows
- **Login with invalid credentials**: Same "Credenciales inválidas" message
- **Register with existing email**: Same error message
- **Reset password**: Same success toast
- **Logout**: Same success toast

### EncuestaPartido Flows
- **Load partido (not found)**: Same "Partido no encontrado" toast
- **Submit survey (error)**: Same error toast
- **Submit survey (success)**: Same success flow

## Error Logging Improvement

### Before
```
console.error('Error cargando datos del partido:', error);
```

### After
```
[ERROR] Error { message: '...', code: 'NOT_FOUND', ... }
```

All errors now have consistent [ERROR] prefix for easier log filtering.

## Testing Scenarios

### ✅ Scenario 1: Login with Invalid Credentials
- Action: Enter wrong password
- Expected: "Credenciales inválidas" in UI
- Result: Same UX, error logged with [ERROR]

### ✅ Scenario 2: Register with Weak Password
- Action: Enter short password
- Expected: Supabase error message in UI
- Result: Same UX, error logged with [ERROR]

### ✅ Scenario 3: Load Non-Existent Partido
- Action: Navigate to /encuesta/999999
- Expected: Toast error + redirect to home
- Result: Same UX, error logged with [ERROR] and NOT_FOUND code

### ✅ Scenario 4: Submit Survey with Network Error
- Action: Submit survey while offline
- Expected: Toast error message
- Result: Same UX, error logged with [ERROR]

### ✅ Scenario 5: Logout Successfully
- Action: Click logout button
- Expected: Success toast
- Result: Same UX, no error logged

## Files Modified
- `src/components/AuthPage.js` (+4 lines, -18 lines)
- `src/pages/EncuestaPartido.js` (+3 lines, -6 lines)

## Dependencies
- No new dependencies
- Uses existing: `handleError`, `AppError`, `ERROR_CODES` from `src/lib/errorHandler.js`

## Rollback Plan
```bash
git revert HEAD
npm run build
```

## Benefits
1. **Consistent Logging**: All errors logged with [ERROR] prefix
2. **Error Tracking**: Easier to grep logs for errors
3. **Semantic Codes**: ERROR_CODES provide context (NOT_FOUND, etc.)
4. **Maintainability**: Single source of truth for error handling
5. **No UX Impact**: Users see identical messages

## Next Steps (Future PRs)
- [ ] Integrate handleError in AdminPanel (match management)
- [ ] Integrate handleError in VotingView (already partially done)
- [ ] Integrate handleError in ProfileEditor (user profile updates)
- [ ] Add error tracking service integration (Sentry, etc.)

## Commit Message
```
chore(errors): route errors through handleError in AuthPage and EncuestaPartido (no UX changes)

- Integrate handleError in 4 auth functions (login, register, reset, logout)
- Integrate handleError in 2 survey functions (fetch, submit)
- Add AppError with ERROR_CODES.NOT_FOUND for partido not found
- Maintain identical UX (same messages, same timing)
- Improve error logging with consistent [ERROR] prefix
- No new dependencies, no logic changes
```
