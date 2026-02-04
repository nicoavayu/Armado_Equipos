-- ============================================================================
-- RESTAURAR TRIGGERS SEGUROS
-- ============================================================================
-- Ejecutar ESTO solo si el "INSERT limpio" funcionó.
-- Restaura la lógica de negocio necesaria pero corregida.
-- ============================================================================

-- 1. FUNCION Y TRIGGER: CÓDIGO DE PARTIDO (Versión Independiente)
CREATE OR REPLACE FUNCTION public.safe_generate_match_code()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
    SELECT string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (random() * 31)::integer + 1, 1), '') 
    FROM generate_series(1, 6);
$$;

CREATE OR REPLACE FUNCTION public.set_partido_codigo()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  attempts int := 0;
  new_code text;
BEGIN
  IF NEW.codigo IS NOT NULL AND length(trim(NEW.codigo)) > 0 THEN
    RETURN NEW;
  END IF;

  LOOP
    attempts := attempts + 1;
    new_code := public.safe_generate_match_code();

    IF NOT EXISTS (SELECT 1 FROM public.partidos WHERE codigo = new_code) THEN
      NEW.codigo := new_code;
      RETURN NEW;
    END IF;

    IF attempts >= 10 THEN
       NEW.codigo := upper(substring(md5(clock_timestamp()::text) from 1 for 6));
       RETURN NEW;
    END IF;
  END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_partido_codigo ON public.partidos;
CREATE TRIGGER trg_set_partido_codigo
  BEFORE INSERT ON public.partidos
  FOR EACH ROW
  EXECUTE FUNCTION public.set_partido_codigo();


-- 2. FUNCION Y TRIGGER: FALTA JUGADORES (Versión Segura)
CREATE OR REPLACE FUNCTION public.calculate_falta_jugadores()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count int;
BEGIN
  IF NEW.id IS NULL THEN
    v_count := 0;
  ELSE
    SELECT COUNT(*) INTO v_count FROM public.jugadores WHERE partido_id = NEW.id;
  END IF;

  NEW.falta_jugadores := (v_count < COALESCE(NEW.cupo_jugadores, 0));
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_calculate_falta_jugadores ON public.partidos;
CREATE TRIGGER trg_calculate_falta_jugadores
  BEFORE INSERT OR UPDATE ON public.partidos
  FOR EACH ROW
  EXECUTE FUNCTION public.calculate_falta_jugadores();

-- 3. NOTIFICAR CAMBIOS
SELECT pg_notify('pgrst', 'reload schema');
