# Call to Vote Notification Fix

## Problem
When clicking the "Call to Vote" notification, users were redirected to the admin panel instead of the voting view.

## Root Cause
In `NotificationsModal.js`, the notification click handler had multiple issues:
1. The `match_invite` handler executed first and didn't have a `return` statement
2. This caused both `match_invite` and `call_to_vote` handlers to execute
3. The navigation logic was competing, causing incorrect redirects

## Solution

### 1. Fixed NotificationsModal.js
Reorganized the `handleNotificationClick` function to:
- Check `call_to_vote` type FIRST (before other types)
- Each notification type now has its own block with explicit `return`
- Moved `onClose()` to the beginning to close modal before any navigation
- Simplified logic and removed redundant code

```javascript
const handleNotificationClick = async (notification) => {
  console.log('[NOTIFICATION_CLICK] Clicked notification:', notification);
  console.log('[NOTIFICATION_CLICK] Notification type:', notification.type);
  console.log('[NOTIFICATION_CLICK] Notification data:', notification.data);
  
  if (!notification.read) {
    await markAsRead(notification.id);
  }
  
  onClose();
  
  // Si es llamada a votar, redirigir a la voting view
  if (notification.type === 'call_to_vote') {
    console.log('[NOTIFICATION_CLICK] Call to vote - redirecting to voting view');
    if (notification.data?.matchCode) {
      console.log('[NOTIFICATION_CLICK] Using matchCode:', notification.data.matchCode);
      window.location.href = `/?codigo=${notification.data.matchCode}`;
    } else {
      console.error('[NOTIFICATION_CLICK] No matchCode in call_to_vote notification');
    }
    return;
  }
  
  // Other notification types...
};
```

### 2. Enhanced notificationService.js
Added comprehensive logging to track the notification creation flow:
- `[CallToVote] start` - When the function begins
- `[Notifications] query start/result/error` - Database queries
- `[CallToVote] success` - When notifications are sent successfully

### 3. Data Structure
Ensured notifications include both `matchId` and `matchCode`:
```javascript
data: { 
  matchId: partidoId, 
  matchCode: partido.codigo 
}
```

## Testing
1. Click "LLAMAR A VOTAR" button in ArmarEquiposView
2. Check console for logs: `[CallToVote] start`, `[Notifications] query result`, `[CallToVote] success`
3. Click the notification bell
4. Click on the "¡Hora de votar!" notification
5. Should redirect to `/?codigo={matchCode}` (voting view)
6. Should NOT redirect to `/admin/{matchId}` (admin panel)

## Console Logs to Expect
```
[CallToVote] start { partidoId: 86, type: 'call_to_vote' }
[Notifications] query start - fetching match code
[Notifications] query result { matchCode: 'ABC123' }
[Notifications] inserting { count: 5, sampleData: { matchId: 86, matchCode: 'ABC123' } }
[CallToVote] success { inserted: 5 }
```

When clicking notification:
```
[NOTIFICATION_CLICK] Clicked notification: {...}
[NOTIFICATION_CLICK] Notification type: call_to_vote
[NOTIFICATION_CLICK] Notification data: { matchId: 86, matchCode: 'ABC123' }
[NOTIFICATION_CLICK] Call to vote - redirecting to voting view
[NOTIFICATION_CLICK] Using matchCode: ABC123
```

## Files Modified
- `src/components/NotificationsModal.js` - Fixed click handler logic
- `src/services/notificationService.js` - Added logging and ensured matchCode is included

## Related Issues
- BF-Flow 2A: Implementar acciones botones "Armar Equipos"
- BF-Flow 2B: Arreglar redirección de notificación "call_to_vote"
