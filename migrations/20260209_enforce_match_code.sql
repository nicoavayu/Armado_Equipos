-- ============================================================================
-- ENFORCE MATCH CODE: non-null + unique + auto-generate
-- Date: 2026-02-09
-- ============================================================================

BEGIN;

-- 1) Safe generator (uppercase, no ambiguous chars)
CREATE OR REPLACE FUNCTION public.safe_generate_match_code()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (random() * 31)::int + 1, 1), '')
  FROM generate_series(1, 6);
$$;

-- 2) Trigger function to ensure code is always present and normalized
CREATE OR REPLACE FUNCTION public.set_partido_codigo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  attempts int := 0;
  new_code text;
BEGIN
  -- Keep provided code but normalize
  IF NEW.codigo IS NOT NULL AND length(trim(NEW.codigo)) > 0 THEN
    NEW.codigo := upper(trim(NEW.codigo));
    RETURN NEW;
  END IF;

  LOOP
    attempts := attempts + 1;
    new_code := public.safe_generate_match_code();

    IF NOT EXISTS (
      SELECT 1 FROM public.partidos p
      WHERE upper(trim(p.codigo)) = upper(trim(new_code))
        AND (TG_OP <> 'UPDATE' OR p.id <> NEW.id)
    ) THEN
      NEW.codigo := upper(trim(new_code));
      RETURN NEW;
    END IF;

    IF attempts >= 10 THEN
      NEW.codigo := upper(substring(md5(clock_timestamp()::text || random()::text) from 1 for 6));
      RETURN NEW;
    END IF;
  END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_partido_codigo ON public.partidos;
CREATE TRIGGER trg_set_partido_codigo
BEFORE INSERT OR UPDATE OF codigo ON public.partidos
FOR EACH ROW
EXECUTE FUNCTION public.set_partido_codigo();

-- 3) Normalize existing codes
UPDATE public.partidos
SET codigo = upper(trim(codigo))
WHERE codigo IS NOT NULL;

-- 4) Null/blank codes -> regenerate uniquely
DO $$
DECLARE
  r RECORD;
  generated text;
BEGIN
  FOR r IN
    SELECT id
    FROM public.partidos
    WHERE codigo IS NULL OR length(trim(codigo)) = 0
  LOOP
    LOOP
      generated := public.safe_generate_match_code();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.partidos WHERE upper(trim(codigo)) = generated);
    END LOOP;

    UPDATE public.partidos
    SET codigo = generated
    WHERE id = r.id;
  END LOOP;
END $$;

-- 5) Resolve duplicates by regenerating all but the first row
DO $$
DECLARE
  r RECORD;
  generated text;
BEGIN
  FOR r IN
    WITH ranked AS (
      SELECT id,
             row_number() OVER (PARTITION BY upper(trim(codigo)) ORDER BY id) AS rn
      FROM public.partidos
      WHERE codigo IS NOT NULL AND length(trim(codigo)) > 0
    )
    SELECT id FROM ranked WHERE rn > 1
  LOOP
    LOOP
      generated := public.safe_generate_match_code();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.partidos WHERE upper(trim(codigo)) = generated);
    END LOOP;

    UPDATE public.partidos
    SET codigo = generated
    WHERE id = r.id;
  END LOOP;
END $$;

-- 6) Enforce non-null at schema level
ALTER TABLE public.partidos
  ALTER COLUMN codigo SET NOT NULL;

COMMIT;

-- 7) Enforce uniqueness case-insensitive
CREATE UNIQUE INDEX IF NOT EXISTS idx_partidos_codigo_unique_ci
ON public.partidos ((upper(trim(codigo))));
