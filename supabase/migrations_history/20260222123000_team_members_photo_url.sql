BEGIN;

ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS photo_url text NULL;

COMMIT;
