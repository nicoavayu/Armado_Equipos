-- ============================================================================
-- FIX: Match Code Generation Trigger
-- ============================================================================
-- Reemplaza la función del trigger 'set_partido_codigo' por una versión
-- robusta que NO depende de funciones externas que puedan fallar.
-- ============================================================================

-- 1. Crear función auxiliar segura para generar códigos
CREATE OR REPLACE FUNCTION public.safe_generate_match_code()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
    -- Genera string de 6 caracteres (letras y números sin I, O, 0, 1 para evitar confusión)
    SELECT string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (random() * 31)::integer + 1, 1), '') 
    FROM generate_series(1, 6);
$$;

-- 2. Reescribir la función del trigger para ser autónoma
CREATE OR REPLACE FUNCTION public.set_partido_codigo()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  attempts int := 0;
  new_code text;
BEGIN
  -- Si ya viene codigo, no tocarlo
  IF NEW.codigo IS NOT NULL AND length(trim(NEW.codigo)) > 0 THEN
    RETURN NEW;
  END IF;

  -- Intentar generar código único (máx 10 intentos)
  LOOP
    attempts := attempts + 1;
    new_code := public.safe_generate_match_code();

    IF NOT EXISTS (SELECT 1 FROM public.partidos WHERE codigo = new_code) THEN
      NEW.codigo := new_code;
      RETURN NEW;
    END IF;

    IF attempts >= 10 THEN
       -- Fallback de emergencia si falla la aleatoriedad (usar timestamp hex)
       NEW.codigo := upper(substring(md5(clock_timestamp()::text) from 1 for 6));
       RETURN NEW;
    END IF;
  END LOOP;
END;
$$;

-- 3. Asegurar que el trigger usa esta función
DROP TRIGGER IF EXISTS trg_set_partido_codigo ON public.partidos;

CREATE TRIGGER trg_set_partido_codigo
  BEFORE INSERT ON public.partidos
  FOR EACH ROW
  EXECUTE FUNCTION public.set_partido_codigo();

-- 4. Notificar recarga de schema
SELECT pg_notify('pgrst', 'reload schema');
