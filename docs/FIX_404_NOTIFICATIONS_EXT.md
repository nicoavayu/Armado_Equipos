# Fix 404 Error - notifications_ext View

## Problem
Getting 404 error when querying `notifications_ext` view in Supabase.

## Solution

### 1️⃣ Create the View

Run in Supabase SQL Editor:

```sql
CREATE OR REPLACE VIEW public.notifications_ext AS
SELECT
  n.*,
  (n.data->>'matchId')::text AS match_id_text,
  (n.data->>'matchCode')::text AS match_code
FROM public.notifications n;

-- Reload PostgREST schema cache
SELECT pg_notify('pgrst', 'reload schema');
```

### 2️⃣ Set Permissions

```sql
-- Enable security_invoker to use caller's permissions (respects RLS)
ALTER VIEW public.notifications_ext SET (security_invoker = on);

-- Grant permissions
GRANT SELECT ON public.notifications_ext TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.notifications_ext TO authenticated;

-- Reload schema again
SELECT pg_notify('pgrst', 'reload schema');
```

### 3️⃣ Verify View Exists

```sql
-- Check if view exists
SELECT * FROM pg_views WHERE viewname = 'notifications_ext';

-- Test query
SELECT id, match_id_text FROM public.notifications_ext LIMIT 1;
```

## Code Usage

All queries already use `notifications_ext`:

```javascript
supabase.from('notifications_ext')
  .select('id')
  .eq('user_id', userId)
  .eq('type', 'match_invite')
  .eq('read', false)
  .eq('match_id_text', String(partidoId));
```

## Why security_invoker?

- **Without it:** View uses definer's permissions (may bypass RLS)
- **With it:** View uses caller's permissions (respects RLS policies)
- **Result:** Users only see their own notifications

## Troubleshooting

### Still getting 404?

1. **Reload schema:**
   ```sql
   SELECT pg_notify('pgrst', 'reload schema');
   ```

2. **Check permissions:**
   ```sql
   SELECT grantee, privilege_type 
   FROM information_schema.role_table_grants 
   WHERE table_name = 'notifications_ext';
   ```

3. **Verify view definition:**
   ```sql
   SELECT pg_get_viewdef('public.notifications_ext', true);
   ```

### Permission denied?

Check RLS policies on base `notifications` table:
```sql
SELECT * FROM pg_policies WHERE tablename = 'notifications';
```

## Expected Result

**Request:**
```
GET /rest/v1/notifications_ext?user_id=eq.xxx&match_id_text=eq.86
```

**Response:**
```
200 OK
[
  {
    "id": 1,
    "user_id": "xxx",
    "type": "match_invite",
    "match_id_text": "86",
    ...
  }
]
```

## Files

- `migrations/create_notifications_ext_view.sql` - Updated with security_invoker

## Status

✅ View created with proper permissions  
✅ security_invoker enabled  
✅ Schema reloaded  
✅ Code uses notifications_ext  
✅ Should return 200 OK (not 404)
