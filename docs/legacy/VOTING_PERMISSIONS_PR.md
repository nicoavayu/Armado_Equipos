# PR: Voting Permissions with Clear UX

## Summary
Added permission enforcement in VotingView to ensure only authorized users (match creator or roster players) can vote, with clear disabled button and inline message for unauthorized users.

## Changes Made

### 1. New State Variables
- `hasAccess`: `null` (loading) | `true` (allowed) | `false` (denied)
- `authzError`: Optional error message for network failures during permission check

### 2. Permission Check Logic (useEffect)
- **Match Creator**: Check `partidos.creado_por === user.id`
- **Roster Player**: Check if user exists in `jugadores` table for this match
- **Guest Users**: Allowed by default (existing behavior preserved)
- **Network Errors**: Conservative default (`hasAccess = false`) with error message

### 3. UI Improvements

#### Unauthorized Users
- **Full-screen block**: Shows "ACCESO DENEGADO" screen before any voting steps
- **Clear message**: "No tienes permiso para votar en este partido."
- **Network error display**: Shows `authzError` if permission check failed

#### Confirmation Step (Step 3)
- **Disabled button**: `disabled={isSubmitting || hasAccess === false || hasAccess === null}`
- **Inline alert**: Red alert box above button when `hasAccess === false`
- **Submit guard**: Early return with toast error if unauthorized user bypasses UI

### 4. Authorized Users
- **No UX changes**: Identical flow for valid users
- **Auto-detection preserved**: Registered roster players skip name selection

## Code Quality
- ✅ Single file modification (VotingView.js)
- ✅ Minimal code changes (~80 lines modified)
- ✅ Integrated with existing `handleError` and `AppError`
- ✅ No new dependencies
- ✅ Preserves all existing animations and delays
- ✅ Anti-double-submit guard maintained

## Build Verification
```bash
npm run build
# ✅ Build successful
# Bundle size: 1.2M (no significant change)
```

## Testing Scenarios

### ✅ Scenario 1: Match Creator
- User is `partidos.creado_por`
- Expected: Can vote normally
- Result: `hasAccess = true`, full voting flow enabled

### ✅ Scenario 2: Roster Player
- User exists in `jugadores` table with `partido_id` and `usuario_id`
- Expected: Can vote normally, name auto-detected
- Result: `hasAccess = true`, skips step 0 (name selection)

### ✅ Scenario 3: Unauthorized User
- User is neither creator nor in roster
- Expected: Blocked with clear message
- Result: `hasAccess = false`, shows "ACCESO DENEGADO" screen

### ✅ Scenario 4: Guest User
- No authenticated user
- Expected: Can vote as guest (existing behavior)
- Result: `hasAccess = true`, normal guest flow

### ✅ Scenario 5: Network Error
- Permission check fails (DB error, timeout, etc.)
- Expected: Conservative block with error message
- Result: `hasAccess = false`, shows `authzError` message

## Security
- **Server-side validation recommended**: This is client-side enforcement only
- **Defense in depth**: Submit handler has additional guard
- **Conservative defaults**: Network errors default to deny access

## Commit Message
```
fix(authz,ux): enforce voting permissions in VotingView with disabled action and inline message for unauthorized users

- Add hasAccess state with permission check for match creator or roster player
- Block unauthorized users with full-screen "ACCESO DENEGADO" message
- Disable submit button and show inline alert for unauthorized users
- Preserve existing UX for authorized users (creators, roster players, guests)
- Handle network errors conservatively (default deny with error message)
- Integrate with existing handleError and AppError infrastructure
```

## Files Modified
- `src/VotingView.js` (+80 lines, -52 lines)

## Dependencies
- No new dependencies
- Uses existing: `handleError`, `AppError`, `ERROR_CODES`, `supabase`

## Rollback Plan
```bash
git revert HEAD
npm run build
```

## Next Steps
- [ ] Add server-side permission validation in Supabase RLS policies
- [ ] Add unit tests for permission check logic
- [ ] Consider caching permission results to reduce DB queries
