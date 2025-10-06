-- ============================================
-- DEPLOY THIS IN SUPABASE SQL EDITOR NOW
-- ============================================

-- Step 1: Drop existing view if any
DROP VIEW IF EXISTS public.notifications_ext;

-- Step 2: Create view with extracted JSONB fields
CREATE VIEW public.notifications_ext AS
SELECT
  n.*, 
  (n.data->>'matchId')::text  AS match_id_text,
  (n.data->>'matchCode')::text AS match_code
FROM public.notifications n;

-- Step 3: Enable security_invoker (uses caller's permissions, respects RLS)
ALTER VIEW public.notifications_ext SET (security_invoker = on);

-- Step 4: Grant permissions
GRANT SELECT ON public.notifications_ext TO anon, authenticated;

-- Step 5: Reload PostgREST schema cache
SELECT pg_notify('pgrst', 'reload schema');

-- ============================================
-- CODE NOW USES (without public: prefix):
-- supabase.from('notifications_ext')
-- Network will show: /rest/v1/notifications_ext
-- ============================================

-- ============================================
-- VERIFICATION (run after above)
-- ============================================

-- Should return 0+ rows without error
SELECT id, match_id_text FROM public.notifications_ext LIMIT 1;

-- Should show the view exists
SELECT * FROM pg_views WHERE viewname = 'notifications_ext';

-- Should show permissions granted
SELECT grantee, privilege_type 
FROM information_schema.role_table_grants 
WHERE table_name = 'notifications_ext';
