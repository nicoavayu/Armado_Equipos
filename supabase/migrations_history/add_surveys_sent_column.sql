-- Add surveys_sent column to partidos table
ALTER TABLE public.partidos
ADD COLUMN IF NOT EXISTS surveys_sent boolean NOT NULL DEFAULT false;

-- Create unique index to prevent duplicate notifications
CREATE UNIQUE INDEX IF NOT EXISTS uniq_notif_user_match_type
ON public.notifications (user_id, (data->>'match_id'), type);
