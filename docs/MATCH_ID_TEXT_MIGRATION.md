# Match ID Text Column Migration

## Problem
HTTP 406 errors when querying notifications with JSONB filters:
- `data=cs.%7B%22matchId%22%3A86%7D` (contains operator)
- `data->>matchId=eq.86` (JSON path operator)

Both cause issues with PostgREST in certain configurations.

## Solution
Add a generated column `match_id_text` that extracts `matchId` from the JSONB `data` field.

## Database Migration

Run this SQL in your Supabase SQL Editor:

```sql
-- Add generated column for matchId from JSONB data field
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS match_id_text TEXT GENERATED ALWAYS AS (data->>'matchId') STORED;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS notifications_match_id_text_idx ON notifications(match_id_text);

-- Add comment for documentation
COMMENT ON COLUMN notifications.match_id_text IS 'Generated column extracting matchId from JSONB data field for efficient querying';
```

## Code Changes

### Before (❌ Causes 406)
```javascript
.filter('data->>matchId', 'eq', String(partidoId))
```

### After (✅ Works)
```javascript
.eq('match_id_text', String(partidoId))
```

## Files Updated

1. **notificationService.js** - `getMatchInviteNotification()` helper
2. **InviteFriendModal.js** - Check for existing invitations
3. **ChatButton.js** - Verify chat access
4. **surveyService.js** - Delete duplicate notifications

## Benefits

✅ **No 406 errors** - Uses standard column equality  
✅ **Better performance** - Indexed column vs JSONB extraction  
✅ **Cleaner URLs** - `match_id_text=eq.86` instead of encoded JSONB  
✅ **Type safe** - Always text comparison  
✅ **Automatic** - Generated column updates automatically when `data` changes

## Network Tab Example

**Before:**
```
GET /rest/v1/notifications?data=cs.%7B%22matchId%22%3A86%7D
Response: 406 Not Acceptable
```

**After:**
```
GET /rest/v1/notifications?match_id_text=eq.86
Response: 200 OK
```

## Testing Checklist

1. ✅ Run SQL migration in Supabase
2. ✅ Verify column exists: `SELECT match_id_text FROM notifications LIMIT 1;`
3. ✅ Verify index exists: `\d notifications` (should show index)
4. ✅ Click "LLAMAR A VOTAR" button
5. ✅ Check Network tab - should see `match_id_text=eq.86`
6. ✅ No 406 errors
7. ✅ Notifications created successfully
8. ✅ Click notification redirects to voting view

## Rollback (if needed)

```sql
DROP INDEX IF EXISTS notifications_match_id_text_idx;
ALTER TABLE notifications DROP COLUMN IF EXISTS match_id_text;
```

## Performance Impact

- **Positive**: Indexed lookups are faster than JSONB extraction
- **Storage**: Minimal - only stores extracted text value
- **Maintenance**: Zero - automatically updated by Postgres

## Related Files

- Migration: `migrations/add_match_id_text_column.sql`
- Service: `src/services/notificationService.js`
- Components: `InviteFriendModal.js`, `ChatButton.js`
- Service: `src/services/surveyService.js`
