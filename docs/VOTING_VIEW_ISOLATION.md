# Voting View Isolation

## Objetivo
Al clickear notificación `call_to_vote`, navegar a `/?codigo=<matchCode>` y evitar cualquier lógica de Admin (fetch de jugadores, guards, etc.).

## ✅ Implementación

### 1. Handler de Notificación

**File:** `src/components/NotificationsModal.js`

```javascript
const handleNotificationClick = async (notification) => {
  if (!notification.read) {
    await markAsRead(notification.id);
  }
  
  onClose();
  
  // Si es llamada a votar, redirigir a la voting view
  if (notification.type === 'call_to_vote') {
    const { matchCode } = notification.data || {};
    console.debug('[NOTIFICATION_CLICK] willNavigate', { matchCode });
    if (!matchCode) {
      toast.error('Falta matchCode');
      return;
    }
    window.location.assign(`/?codigo=${matchCode}`);
    return; // impedir fallthrough
  }
  
  // ... otros tipos
};
```

**Behavior:**
- ✅ Extract `matchCode` from notification data
- ✅ Log before navigation: `[NOTIFICATION_CLICK] willNavigate`
- ✅ Validate `matchCode` exists
- ✅ Use `window.location.assign()` for clean navigation
- ✅ Early return to prevent fallthrough

### 2. Route Guard

**File:** `src/App.js` - `AppAuthWrapper`

```javascript
function AppAuthWrapper() {
  const { user } = useAuth();
  const location = useLocation();
  
  const search = new URLSearchParams(location.search);
  const isVotingView = search.has('codigo');
  
  if (isVotingView) {
    console.debug('[RouteGuard] allowVotingView');
    return <Outlet />; // Allow access without auth check
  }
  
  if (!user) {
    return <AuthPage />;
  }
  
  return <Outlet />;
}
```

**Behavior:**
- ✅ Check for `?codigo=` parameter
- ✅ Log: `[RouteGuard] allowVotingView`
- ✅ Skip auth requirement for voting view
- ✅ No redirect to `/admin`

### 3. Admin Hooks Protection

**File:** `src/hooks/useAdminPanelState.js`

```javascript
// Fetch initial data and polling
useEffect(() => {
  const search = new URLSearchParams(window.location.search);
  if (search.has('codigo')) return; // no correr en voting view
  
  async function fetchInitialData() {
    // ... admin logic
  }
  // ...
}, [partidoActual?.id]);

// Check invitation
useEffect(() => {
  const search = new URLSearchParams(window.location.search);
  if (search.has('codigo')) return; // no correr en voting view
  
  const checkInvitation = async () => {
    // ... admin logic
  }
  // ...
}, [user?.id, partidoActual?.id, jugadores]);
```

**Behavior:**
- ✅ Early return if `?codigo=` present
- ✅ Prevents fetching jugadores
- ✅ Prevents checking invitations
- ✅ Prevents polling for updates

### 4. AdminPanelPage Protection

**File:** `src/App.js` - `AdminPanelPage`

```javascript
useEffect(() => {
  const search = new URLSearchParams(window.location.search);
  if (search.has('codigo')) return; // no correr en voting view
  
  const cargarPartido = async () => {
    // ... load partido logic
  };
  
  if (partidoId) {
    cargarPartido();
  }
}, [partidoId, navigate]);
```

**Behavior:**
- ✅ Early return if `?codigo=` present
- ✅ Prevents loading partido by ID
- ✅ Prevents admin panel initialization

## 📊 Flow Diagram

```
User clicks "call_to_vote" notification
  ↓
[NOTIFICATION_CLICK] willNavigate { matchCode: 'ABC123' }
  ↓
window.location.assign('/?codigo=ABC123')
  ↓
[RouteGuard] allowVotingView
  ↓
HomePage detects ?codigo= param
  ↓
Shows VotingView (no admin logic runs)
```

## 🔍 Console Logs

### Success Flow
```
[NOTIFICATION_CLICK] willNavigate { matchCode: 'ABC123' }
[RouteGuard] allowVotingView
```

### Error Flow (missing matchCode)
```
[NOTIFICATION_CLICK] willNavigate { matchCode: undefined }
Toast: "Falta matchCode"
```

## ✅ Acceptance Criteria

- ✅ Click notification → URL changes to `/?codigo=XXXX`
- ✅ No `GET_JUGADORES_PARTIDO` requests
- ✅ No admin effects run
- ✅ No redirect to `/admin`
- ✅ VotingView renders correctly
- ✅ Logs show `[NOTIFICATION_CLICK] willNavigate` and `[RouteGuard] allowVotingView`

## 🧪 Testing

### Manual Test
1. Create notification with `type: 'call_to_vote'` and `data: { matchCode: 'ABC123' }`
2. Click notification
3. Verify URL is `/?codigo=ABC123`
4. Open DevTools Network tab
5. Verify no requests to `jugadores` table
6. Verify no requests to `partidos` by ID

### E2E Test
```javascript
test('call_to_vote navigation isolates voting view', async ({ page }) => {
  const requests = [];
  page.on('request', (req) => requests.push(req.url()));
  
  await page.click('[data-notification-type="call_to_vote"]');
  await page.waitForURL('**/codigo=ABC123');
  
  // Verify no admin requests
  expect(requests.some(url => url.includes('jugadores'))).toBe(false);
  expect(requests.some(url => url.includes('partidos') && url.includes('id='))).toBe(false);
});
```

## 📝 Files Modified

1. ✅ `src/components/NotificationsModal.js` - Updated click handler
2. ✅ `src/App.js` - Updated `AppAuthWrapper` and `AdminPanelPage`
3. ✅ `src/hooks/useAdminPanelState.js` - Added guards to effects

## 🎯 Benefits

- ✅ **Clean separation** - Voting view completely isolated from admin logic
- ✅ **Performance** - No unnecessary API calls
- ✅ **Reliability** - No race conditions or conflicting state
- ✅ **Debugging** - Clear logs show navigation intent
- ✅ **Security** - No admin data exposed in voting view

## 🔄 Related

- `docs/CALL_TO_VOTE_FIX.md` - Original notification fix
- `docs/ROUTE_GUARD_AND_TESTS.md` - Route guard implementation
- `docs/DEPLOY_NOTIFICATIONS_EXT.md` - Database view setup

## ✅ Status: COMPLETE

Voting view is now fully isolated from admin logic. Navigation works cleanly without side effects.
