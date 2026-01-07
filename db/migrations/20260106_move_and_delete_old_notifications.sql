-- Migration: Move and delete notifications older than 5 days
-- Creates an archive table and a function to move+delete old rows.
-- Run manually or schedule with pg_cron / Supabase Scheduled Jobs.

BEGIN;

-- 1) Archive table (keeps same structure, including defaults)
CREATE TABLE IF NOT EXISTS public.notifications_archive (
  LIKE public.notifications INCLUDING ALL
);

-- 2) Function to move old notifications to archive and delete them from main table
CREATE OR REPLACE FUNCTION public.move_and_delete_old_notifications()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Copy to archive first (atomic within single transaction when called)
  INSERT INTO public.notifications_archive
  SELECT * FROM public.notifications
  WHERE created_at < now() - INTERVAL '5 days';

  -- Delete the moved rows
  DELETE FROM public.notifications
  WHERE created_at < now() - INTERVAL '5 days';
END;
$$;

COMMIT;

-- Usage:
-- 1) Run manually to perform cleanup now:
--    SELECT public.move_and_delete_old_notifications();
-- 2) To schedule daily (example using pg_cron), run as a superuser:
--    -- install extension if needed
--    CREATE EXTENSION IF NOT EXISTS pg_cron;
--    -- schedule cron job to run at 03:00 UTC every day
--    SELECT cron.schedule('cleanup_old_notifications', '0 3 * * *', $$SELECT public.move_and_delete_old_notifications();$$);

-- If you use Supabase Scheduled Jobs instead of pg_cron, create a scheduled SQL job that runs:
--    SELECT public.move_and_delete_old_notifications();
-- daily at your preferred time.
