# Fix 406 Error - Notifications Query Refactor

## Problem
HTTP 406 "Not Acceptable" errors when querying notifications table with `.contains('data', { matchId: ... })`. This happens because PostgREST doesn't support the `cs` (contains) operator on JSONB fields in certain configurations.

## Solution
Replace all `.contains()` queries with JSON path filters using the `->>` operator.

## Changes Made

### 1. InviteFriendModal.js
**Before:**
```javascript
.contains('data', { matchId: toBigIntId(match.id) })
```

**After:**
```javascript
.filter('data->>matchId', 'eq', String(toBigIntId(match.id)))
```

### 2. ChatButton.js
**Before:**
```javascript
.contains('data', { matchId: partidoId })
```

**After:**
```javascript
.filter('data->>matchId', 'eq', String(partidoId))
```

### 3. surveyService.js
**Before:**
```javascript
.contains('data', { matchId: partidoId })
```

**After:**
```javascript
.filter('data->>matchId', 'eq', String(partidoId))
```

### 4. notificationService.js - New Helper Function
Added a reusable helper function:

```javascript
/**
 * Get match invite notification for a user and match
 * @param {string} userId - User ID
 * @param {string|number} partidoId - Match ID
 * @returns {Promise<{data, error}>}
 */
export async function getMatchInviteNotification(userId, partidoId) {
  return supabase
    .from('notifications')
    .select('id')
    .eq('user_id', userId)
    .eq('type', 'match_invite')
    .eq('read', false)
    .filter('data->>matchId', 'eq', String(partidoId));
}
```

## Technical Details

### JSON Path Filter Syntax
- `data->>matchId` extracts the `matchId` field from the JSONB `data` column as text
- Always convert the comparison value to `String()` for consistency
- Use `.filter()` instead of `.contains()`

### Why This Works
1. PostgREST supports JSON path operators (`->>`, `->`, etc.)
2. Text comparison is more reliable than JSONB containment
3. No URL encoding issues with complex JSONB structures
4. Works consistently across all PostgREST versions

## Testing
1. Open browser DevTools Network tab
2. Click "LLAMAR A VOTAR" button
3. Check for notifications queries - should see `data->>matchId=eq.86` instead of `data=cs.%7B%22matchId%22%3A86%7D`
4. No 406 errors should appear
5. Notifications should be created and displayed correctly

## Files Modified
- `src/components/InviteFriendModal.js`
- `src/components/ChatButton.js`
- `src/services/surveyService.js`
- `src/services/notificationService.js` (added helper)

## Related Issues
- BF-Flow 2A: Implementar acciones botones "Armar Equipos"
- BF-Flow 2B: Arreglar redirección de notificación "call_to_vote"
- Fix 406 errors in notification queries

## Acceptance Criteria ✅
- ✅ No 406 errors in Network tab
- ✅ Notifications query using JSON path filter (`data->>matchId`)
- ✅ No URL encoding issues with `data=cs.%7B...%7D`
- ✅ Helper function available for reuse
- ✅ Build compiles successfully
