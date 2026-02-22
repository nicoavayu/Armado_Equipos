BEGIN;

ALTER TABLE public.challenges
  ADD COLUMN IF NOT EXISTS price_per_team numeric(10,2) NULL,
  ADD COLUMN IF NOT EXISTS field_price numeric(10,2) NULL;

ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS photo_url text NULL;

ALTER TABLE public.teams
  DROP CONSTRAINT IF EXISTS teams_skill_level_check;

UPDATE public.teams
SET skill_level = CASE skill_level
  WHEN 'easy' THEN 'inicial'
  WHEN 'normal' THEN 'intermedio'
  WHEN 'hard' THEN 'competitivo'
  WHEN 'tranqui' THEN 'inicial'
  WHEN 'metedor' THEN 'competitivo'
  WHEN 'picante' THEN 'avanzado'
  WHEN 'bueno' THEN 'elite'
  ELSE skill_level
END;

UPDATE public.teams
SET skill_level = 'sin_definir'
WHERE skill_level IS NULL
   OR btrim(skill_level) = ''
   OR skill_level NOT IN ('sin_definir', 'inicial', 'intermedio', 'competitivo', 'avanzado', 'elite');

ALTER TABLE public.teams
  ALTER COLUMN skill_level SET DEFAULT 'sin_definir';

ALTER TABLE public.teams
  ADD CONSTRAINT teams_skill_level_check
  CHECK (skill_level IN ('sin_definir', 'inicial', 'intermedio', 'competitivo', 'avanzado', 'elite'));

ALTER TABLE public.challenges
  DROP CONSTRAINT IF EXISTS challenges_skill_level_check;

UPDATE public.challenges
SET skill_level = CASE skill_level
  WHEN 'easy' THEN 'inicial'
  WHEN 'normal' THEN 'intermedio'
  WHEN 'hard' THEN 'competitivo'
  WHEN 'tranqui' THEN 'inicial'
  WHEN 'metedor' THEN 'competitivo'
  WHEN 'picante' THEN 'avanzado'
  WHEN 'bueno' THEN 'elite'
  ELSE skill_level
END;

UPDATE public.challenges
SET skill_level = 'sin_definir'
WHERE skill_level IS NULL
   OR btrim(skill_level) = ''
   OR skill_level NOT IN ('sin_definir', 'inicial', 'intermedio', 'competitivo', 'avanzado', 'elite');

ALTER TABLE public.challenges
  ALTER COLUMN skill_level SET DEFAULT 'sin_definir';

ALTER TABLE public.challenges
  ADD CONSTRAINT challenges_skill_level_check
  CHECK (skill_level IN ('sin_definir', 'inicial', 'intermedio', 'competitivo', 'avanzado', 'elite'));

ALTER TABLE public.team_members
  DROP CONSTRAINT IF EXISTS team_members_role_check;

UPDATE public.team_members
SET role = CASE role
  WHEN 'captain' THEN 'player'
  ELSE role
END;

ALTER TABLE public.team_members
  ALTER COLUMN role SET DEFAULT 'player';

ALTER TABLE public.team_members
  ADD CONSTRAINT team_members_role_check
  CHECK (role IN ('gk', 'rb', 'cb', 'lb', 'dm', 'cm', 'am', 'rw', 'lw', 'st', 'defender', 'mid', 'forward', 'player'));

ALTER TABLE public.challenges
  DROP CONSTRAINT IF EXISTS challenges_price_per_team_non_negative_check;

ALTER TABLE public.challenges
  ADD CONSTRAINT challenges_price_per_team_non_negative_check
  CHECK (price_per_team IS NULL OR price_per_team >= 0);

ALTER TABLE public.challenges
  DROP CONSTRAINT IF EXISTS challenges_field_price_non_negative_check;

ALTER TABLE public.challenges
  ADD CONSTRAINT challenges_field_price_non_negative_check
  CHECK (field_price IS NULL OR field_price >= 0);

COMMIT;
