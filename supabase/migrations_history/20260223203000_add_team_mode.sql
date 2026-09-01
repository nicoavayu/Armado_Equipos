-- Team gender/mode persistence for equipos module
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS mode text;

UPDATE public.teams
SET mode = CASE
  WHEN mode IS NULL OR btrim(mode) = '' THEN 'Masculino'
  WHEN lower(btrim(mode)) IN ('masculino', 'male', 'hombre') THEN 'Masculino'
  WHEN lower(btrim(mode)) IN ('femenino', 'female', 'mujer') THEN 'Femenino'
  WHEN lower(btrim(mode)) IN ('mixto', 'mixed', 'unisex') THEN 'Mixto'
  ELSE 'Masculino'
END;

ALTER TABLE public.teams
  ALTER COLUMN mode SET DEFAULT 'Masculino';

ALTER TABLE public.teams
  ALTER COLUMN mode SET NOT NULL;

ALTER TABLE public.teams
  DROP CONSTRAINT IF EXISTS teams_mode_check;

ALTER TABLE public.teams
  ADD CONSTRAINT teams_mode_check
  CHECK (mode IN ('Masculino', 'Femenino', 'Mixto'));
