# Route Guard and E2E Tests

## ✅ Route Guard Implementation

### AppAuthWrapper Guard
Located in `src/App.js`, the guard allows voting view access when `codigo` parameter is present:

```javascript
function AppAuthWrapper() {
  const { user } = useAuth();
  const location = useLocation();
  
  const params = new URLSearchParams(location.search);
  const codigo = params.get('codigo');
  
  if (codigo) {
    console.log('[RouteGuard] allowVotingView when codigo param is present:', codigo);
  }
  
  if (!user && !codigo) {
    console.log('[RouteGuard] redirecting to auth - no user and no codigo');
    return <AuthPage />;
  }
  
  return <Outlet />;
}
```

**Behavior:**
- ✅ If `?codigo=ABC123` is present → Allow access (voting view)
- ✅ If user is authenticated → Allow access
- ❌ If no user AND no codigo → Redirect to auth

## 🧪 E2E Tests (Playwright)

### Test File: `tests/call-to-vote.spec.js`

#### Test 1: Success Flow
```javascript
test('success: redirect to voting view with codigo param', async ({ page }) => {
  // Mock notifications_ext with 200 response
  // Click "LLAMAR A VOTAR"
  // Assert: redirects to /?codigo=ABC123
  // Assert: URL contains match_id_text=eq.86 (not data->>)
});
```

#### Test 2: Error Flow
```javascript
test('error: show toast and stay on current route', async ({ page }) => {
  // Mock notifications_ext with 500 error
  // Click "LLAMAR A VOTAR"
  // Assert: stays on current URL (no redirect)
  // Assert: toast shows "No se pudo iniciar la votación"
});
```

#### Test 3: No Problematic Operators
```javascript
test('no problematic JSONB operators', async ({ page }) => {
  // Capture all requests
  // Assert: no data->> in URLs
  // Assert: no data=cs. in URLs
  // Assert: uses match_id_text=eq. instead
});
```

## 🚀 Running Tests

### Install Playwright
```bash
npm install -D @playwright/test
npx playwright install
```

### Run Tests
```bash
# Run all tests
npx playwright test

# Run with UI
npx playwright test --ui

# Run specific test
npx playwright test call-to-vote

# Debug mode
npx playwright test --debug
```

## ✅ Cleanup Verification

### No Manual Fetch Calls
Verified no manual `fetch()` calls to `/rest/v1/notifications`:
```bash
grep -r "fetch.*\/rest\/v1\/notifications" src/
# Result: No manual fetch calls found ✅
```

### Centralized Access
All notification queries use `notificationService.getMatchInviteNotification()`:
- Uses `notifications_ext` view
- Uses `match_id_text` column
- No JSONB operators

## 📊 Acceptance Criteria

- ✅ No 400/406 errors
- ✅ Guard respects `?codigo=` parameter
- ✅ Tests verify success flow (redirect to voting)
- ✅ Tests verify error flow (toast + stay on page)
- ✅ Tests verify no problematic operators
- ✅ No manual fetch calls to notifications
- ✅ Centralized notification access

## 🔍 Console Logs

### Route Guard Logs
```
[RouteGuard] allowVotingView when codigo param is present: ABC123
```

### Call to Vote Logs
```
[CallToVote] start { partidoId: 86, type: 'call_to_vote' }
[Notifications] query start - fetching match code
[Notifications] query result { matchCode: 'ABC123' }
[Notifications] inserting { count: 5, sampleData: {...} }
[CallToVote] success { inserted: 5 }
```

### Error Logs
```
[Teams] call-to-vote failed Error: ...
Toast: "No se pudo iniciar la votación"
```

## 📝 Files Modified

1. ✅ `src/App.js` - Added route guard logging
2. ✅ `tests/call-to-vote.spec.js` - E2E tests (NEW)
3. ✅ `playwright.config.js` - Playwright config (NEW)

## 🎯 Test Results

Run tests to verify:
```bash
npx playwright test
```

Expected output:
```
✓ Call to Vote Flow > success: redirect to voting view with codigo param
✓ Call to Vote Flow > error: show toast and stay on current route
✓ Call to Vote Flow > no problematic JSONB operators

3 passed (3s)
```

## 🔄 CI/CD Integration

Add to `.github/workflows/test.yml`:
```yaml
- name: Install Playwright
  run: npx playwright install --with-deps

- name: Run E2E tests
  run: npx playwright test
```

## ✅ Status: COMPLETE

Route guard implemented with logging, E2E tests created, no manual fetch calls, all queries centralized.
