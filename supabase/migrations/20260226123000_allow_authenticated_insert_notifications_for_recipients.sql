BEGIN;

ALTER TABLE IF EXISTS public.notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notifications'
      AND policyname = 'notifications_insert_authenticated_any_user'
  ) THEN
    CREATE POLICY notifications_insert_authenticated_any_user
      ON public.notifications
      FOR INSERT
      TO authenticated
      WITH CHECK (true);
  END IF;
END
$$;

COMMIT;
