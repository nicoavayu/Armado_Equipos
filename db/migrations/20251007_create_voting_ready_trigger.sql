-- Migration: Create voting_ready trigger, function, index and RLS policy
-- Run this as a privileged (service) role (supabase SQL editor or migration runner)

-- 1) Unique index to ensure only one notification per match+type
CREATE UNIQUE INDEX IF NOT EXISTS notifications_match_type_unique
  ON public.notifications (match_id, type);

-- 2) Ensure notifications table has created_at default (optional)
ALTER TABLE public.notifications
  ALTER COLUMN created_at SET DEFAULT now();

-- 3) Create a SECURITY DEFINER function that inserts a notification when 6+ distinct votes
-- Note: The function sets a tight search_path to avoid SQL injection via schema names.
-- You may need to change the function owner to a dedicated role with BYPASSRLS to ensure it can insert
-- despite RLS. See README snippet below.

CREATE OR REPLACE FUNCTION public.notify_creator_on_votes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_count integer;
  v_creator uuid; -- adjust type if creator_user_id is not uuid
  v_match_id bigint := NEW.partido_id;
BEGIN
  -- be explicit about the search_path
  PERFORM set_config('search_path', 'public, pg_catalog', true);

  -- Count distinct voters for this match
  SELECT COUNT(DISTINCT user_id) INTO v_count
  FROM public.votaciones
  WHERE partido_id = v_match_id;

  IF v_count >= 6 THEN
    -- find match creator
    SELECT creator_user_id INTO v_creator FROM public.partidos WHERE id = v_match_id LIMIT 1;

    IF v_creator IS NOT NULL THEN
      -- Insert idempotent notification
      INSERT INTO public.notifications (user_id, match_id, type, message, created_at)
      VALUES (
        v_creator,
        v_match_id,
        'voting_ready',
        '6+ votes received. You can close voting and build teams.',
        now()
      )
      ON CONFLICT (match_id, type) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$func$;

-- 4) Create trigger on votaciones AFTER INSERT
DROP TRIGGER IF EXISTS trg_notify_creator_on_votes ON public.votaciones;
CREATE TRIGGER trg_notify_creator_on_votes
AFTER INSERT ON public.votaciones
FOR EACH ROW
EXECUTE FUNCTION public.notify_creator_on_votes();

-- 5) Enable RLS on notifications and create a strict SELECT policy
-- If RLS is already enabled on notifications, these statements are idempotent
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Policy: allow users to SELECT only their own notifications
DROP POLICY IF EXISTS select_own_notifications ON public.notifications;
CREATE POLICY select_own_notifications
  ON public.notifications
  FOR SELECT
  USING (user_id = auth.uid());

-- Note: do NOT create a permissive INSERT policy here. The intent is that only the
-- SECURITY DEFINER function (owner/bypass role) inserts notifications. If you need
-- to allow server-side insertion by other roles, add a restricted INSERT policy.

-- 6) Optional: create a view / RPC to fetch unread notifications for current user
DROP VIEW IF EXISTS public.unread_notifications_view;
CREATE VIEW public.unread_notifications_view AS
SELECT id, user_id, match_id, type, message, created_at
FROM public.notifications
WHERE read = false; -- adjust field name ("read") if different

-- Grant usage on view to authenticated role (optional)
GRANT SELECT ON public.unread_notifications_view TO authenticated;

-- IMPORTANT: To ensure the trigger function can insert despite RLS you should set the function
-- owner to a role that has BYPASSRLS (Postgres >= 9.5 with BYPASSRLS available). Example:
--   ALTER FUNCTION public.notify_creator_on_votes() OWNER TO notifier;
--   ALTER ROLE notifier WITH NOLOGIN BYPASSRLS;
-- Creating roles or altering role attributes requires superuser privileges and may be
-- restricted on hosted platforms. If you cannot change owner to a BYPASSRLS role, ensure
-- the function owner (the role that creates the function) has the required privilege to
-- insert into notifications under RLS.

-- End of migration
