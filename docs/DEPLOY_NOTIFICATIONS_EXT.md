# Deploy Guide: notifications_ext View

## 🎯 Objective
Eliminate 406 errors by using a VIEW with extracted JSONB fields instead of direct JSONB queries.

## 📋 Step-by-Step Deployment

### Step 1: Create the View in Supabase

Open Supabase SQL Editor and run:

```sql
-- Create view with extracted JSONB fields
CREATE OR REPLACE VIEW notifications_ext AS
SELECT
  n.id,
  n.user_id,
  n.type,
  n.title,
  n.message,
  n.data,
  n.read,
  n.status,
  n.created_at,
  n.send_at,
  n.partido_id,
  (n.data->>'matchId')::text AS match_id_text,
  (n.data->>'matchCode')::text AS match_code
FROM public.notifications n;

-- Reload PostgREST schema cache
SELECT pg_notify('pgrst', 'reload schema');

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications_ext TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications_ext TO anon;
```

### Step 2: Test the View

In your browser console or Supabase SQL Editor:

```javascript
const { data, error } = await supabase
  .from('notifications_ext')
  .select('id, match_id_text')
  .limit(1);
console.log({ data, error });
```

**Expected result:** `{ data: [...], error: null }`

### Step 3: Deploy Code

All code has been updated to use `notifications_ext`. Deploy your build:

```bash
npm run build
# Deploy build folder to your hosting
```

### Step 4: Verify in Production

1. Open browser DevTools → Network tab
2. Click "LLAMAR A VOTAR" button
3. Look for requests to `/rest/v1/notifications_ext`
4. Verify query string shows: `match_id_text=eq.86`
5. Confirm response is `200 OK` (not 406)

## ✅ What Changed

### Before (❌ 406 Error)
```javascript
supabase.from('notifications')
  .filter('data->>matchId', 'eq', String(partidoId))
```

**Network:** `GET /rest/v1/notifications?data->>matchId=eq.86`  
**Response:** `406 Not Acceptable`

### After (✅ Works)
```javascript
supabase.from('notifications_ext')
  .eq('match_id_text', String(partidoId))
```

**Network:** `GET /rest/v1/notifications_ext?match_id_text=eq.86`  
**Response:** `200 OK`

## 📝 Files Updated (7 files)

1. ✅ `migrations/create_notifications_ext_view.sql` - NEW
2. ✅ `src/services/notificationService.js` - Uses `notifications_ext`
3. ✅ `src/components/InviteFriendModal.js` - Uses `notifications_ext`
4. ✅ `src/components/ChatButton.js` - Uses `notifications_ext`
5. ✅ `src/services/surveyService.js` - Uses `notifications_ext`
6. ✅ `src/components/InviteAmigosModal.js` - Uses `notifications_ext`
7. ✅ `src/hooks/useAdminPanelState.js` - Uses `notifications_ext`
8. ✅ `src/components/ArmarEquiposView.js` - Error handling improved

## 🔧 Error Handling Update

### "Llamar a votar" Button

**Before:**
```javascript
catch (error) {
  handleError(error, { showToast: true });
}
```

**After:**
```javascript
catch (error) {
  console.error('[Teams] call-to-vote failed', error);
  toast.error('No se pudo iniciar la votación');
  return; // Don't redirect to admin panel
}
```

## 🎯 Success Criteria

- ✅ Network shows `match_id_text=eq.86`
- ✅ No 406 errors
- ✅ No 400 errors
- ✅ No redirect to Admin panel on error
- ✅ Toast shows "No se pudo iniciar la votación" on error
- ✅ Voting view opens only on success

## 🔍 Troubleshooting

### Issue: "relation notifications_ext does not exist"

**Solution:** Run the SQL migration again and reload schema:
```sql
SELECT pg_notify('pgrst', 'reload schema');
```

### Issue: "permission denied for view notifications_ext"

**Solution:** Grant permissions:
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications_ext TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications_ext TO anon;
```

### Issue: Still getting 406 errors

**Solution:** Check that all queries use `notifications_ext` not `notifications`:
```bash
grep -r "from('notifications')" src/
```

Should return no results (except in files that INSERT notifications).

## 📊 Performance Impact

✅ **Positive:** View queries are as fast as table queries  
✅ **No overhead:** JSONB extraction happens at query time  
✅ **Indexed:** Can add indexes on the base table  

## 🔄 Rollback (if needed)

```sql
DROP VIEW IF EXISTS notifications_ext;
SELECT pg_notify('pgrst', 'reload schema');
```

Then revert code changes to use `notifications` table.

## 🎉 Status: READY TO DEPLOY

All code updated, build successful, ready for production deployment.
