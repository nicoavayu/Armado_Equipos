# Fix: Hide Friend Request Button for Unregistered Players

## Problem
When trying to request friendship from a player who is NOT registered in the app (only in match roster), the system would:
1. Show the "Solicitar amistad" button
2. Fail with error when clicking it (because the player has no valid UUID)
3. Potentially cause 400 errors from Supabase

## Root Cause
Players can exist in two states:
- **Registered**: Has `usuario_id` (valid UUID) → Can receive friend requests
- **Unregistered**: Only has numeric `id` → NOT in usuarios table, no UUID

The button was showing for both cases, causing errors when attempting to send friend requests to unregistered players.

## Solution

### Added UUID Validation in ProfileCardModal.js

**New function: `isValidUUID()`**
```javascript
const isValidUUID = (value) => {
  if (!value || typeof value !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
};
```

**Updated: `renderFriendActionButton()`**
- Validates that `profileUserId` is a valid UUID before rendering action buttons
- If NOT a valid UUID (player not registered): Shows disabled "No registrado" button with tooltip
- If valid UUID: Shows normal friend action button logic
- Logs clearly when skipping button render

### Button States Now

| State | Condition | Display |
|-------|-----------|---------|
| "Solicitar amistad" (active) | Valid UUID, no relationship | Purple, clickable |
| "Solicitud Pendiente" | Valid UUID, pending status | Purple disabled |
| "✓ Amigos" | Valid UUID, accepted status | Purple disabled |
| "No registrado" | Invalid/no UUID | Gray disabled, tooltip |

## Visual Comparison

### Before
```
[Player without app]
Button: "Solicitar amistad" ← Can click → Error 400!
```

### After
```
[Player without app]
Button: "No registrado" ← Disabled, gray, with tooltip
```

## Files Changed
- `src/components/ProfileCardModal.js`
  - Added `isValidUUID()` helper (lines 11-16)
  - Updated `renderFriendActionButton()` (lines 281-355)

## Testing

### Test Case 1: Player with app (has UUID)
✅ See "Solicitar amistad" button
✅ Click button → request sent successfully
✅ Button updates to "Solicitud Pendiente"

### Test Case 2: Player without app (no UUID)
✅ See "No registrado" button
✅ Button is disabled/grayed out
✅ Hover shows tooltip: "Este jugador no está registrado en la aplicación"
✅ Cannot click the button

### Test Case 3: Current user
✅ Button doesn't appear (same user check)

## Build Status
✅ Compilation successful
✅ No errors or warnings
✅ File size minimal change (+17 B CSS, +97 B JS)

## Behavior Details

When button shows "No registrado":
- Disabled state prevents clicks
- Gray color (slate-700) indicates unavailable action
- Title attribute provides explanation on hover
- Console logs: "[PROFILE_MODAL] Player not registered in app - no valid UUID"

## Deployment Notes

This fix is safe to deploy:
- No database changes needed
- Backward compatible
- Prevents user-facing errors
- Improves UX by clarifying why button is unavailable

## User Experience Improvement

**Before**: Users would see a clickable button that fails → confusion and error messages

**After**: Users see a clearly disabled button with explanation → understands that player isn't registered in the app
