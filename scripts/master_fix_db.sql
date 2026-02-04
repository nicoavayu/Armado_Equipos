-- ============================================================================
-- MASTER FIX: Match Creation 500 Error Cleanup
-- ============================================================================
-- Este script limpia TODOS los triggers y funciones que suelen causar el error 500.
-- Copia y pega todo esto en el SQL Editor de Supabase y ejecútalo.
-- ============================================================================

-- 1. LIMPIEZA DE TRIGGERS ANTIGUOS (Los que fallan porque falta la columna 'jugadores')
DROP TRIGGER IF EXISTS trg_add_creator_as_player ON public.partidos;
DROP TRIGGER IF EXISTS trg_calculate_falta_jugadores ON public.partidos;
DROP TRIGGER IF EXISTS trg_check_match_limit ON public.partidos;

-- 2. LIMPIEZA DE FUNCIONES ASOCIADAS
DROP FUNCTION IF EXISTS public.add_creator_as_player() CASCADE;
DROP FUNCTION IF EXISTS public.calculate_falta_jugadores() CASCADE;

-- 3. RECREACIÓN DE LA FUNCIÓN DE ESTADO DE JUGADORES (Versión Corregida)
-- Esta versión cuenta desde la TABLA 'jugadores', no desde la columna inexistente.
CREATE OR REPLACE FUNCTION public.calculate_falta_jugadores()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count int;
BEGIN
  -- Si el ID es nuevo, el conteo es 0
  IF NEW.id IS NULL THEN
    v_count := 0;
  ELSE
    SELECT COUNT(*) INTO v_count FROM public.jugadores WHERE partido_id = NEW.id;
  END IF;

  -- falta_jugadores es BOOLEAN
  NEW.falta_jugadores := (v_count < COALESCE(NEW.cupo_jugadores, 0));
  
  RETURN NEW;
END;
$$;

-- 4. RE-ACTIVAR EL TRIGGER DE ESTADO (Opcional, pero recomendado)
CREATE TRIGGER trg_calculate_falta_jugadores
  BEFORE INSERT OR UPDATE ON public.partidos
  FOR EACH ROW
  EXECUTE FUNCTION public.calculate_falta_jugadores();

-- 5. RE-ACTIVAR PERMISOS (Por si acaso un RLS está bloqueando)
-- Aseguramos que los autenticados puedan insertar.
ALTER TABLE public.partidos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can insert matches" ON public.partidos;
CREATE POLICY "Authenticated can insert matches" ON public.partidos
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- 6. RECARGAR SCHEMA
SELECT pg_notify('pgrst', 'reload schema');

-- ============================================================================
-- DIAGNÓSTICO FINAL (Ver resultados abajo en el editor)
-- ============================================================================
SELECT 
    t.tgname AS trigger_name,
    p.proname AS function_name
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE c.relname = 'partidos'
ORDER BY t.tgname;
