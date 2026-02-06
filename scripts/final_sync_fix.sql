-- ARREGLO DEFINITIVO: Sincronización de Jugadores y Solicitudes
-- Ejecutar en el SQL Editor de Supabase

-- 1. LIMPIEZA DE DUPLICADOS (Evita que falle la creación del constraint)
DELETE FROM public.jugadores j1
USING public.jugadores j2
WHERE j1.id < j2.id 
  AND j1.partido_id = j2.partido_id 
  AND j1.usuario_id = j2.usuario_id;

-- 2. CREACIÓN DEL CONSTRAINT ÚNICO (Para que funcione el ON CONFLICT)
-- Borramos cualquier índice parcial anterior para no confundir a Postgres
DROP INDEX IF EXISTS idx_jugadores_partido_usuario_unique;
ALTER TABLE public.jugadores DROP CONSTRAINT IF EXISTS jugadores_partido_usuario_unique_key;
ALTER TABLE public.jugadores ADD CONSTRAINT jugadores_partido_usuario_unique_key UNIQUE (partido_id, usuario_id);

DO $$
DECLARE
    v_match_id BIGINT := 260; -- El partido de los logs
    v_user_id UUID := '7ecef7ec-0004-4697-8d0a-48fd49c477a2'; -- Tu ID de los logs
    v_nombre TEXT;
    v_avatar TEXT;
    has_uuid_col BOOLEAN;
BEGIN
    -- 3. Verificamos si existe la columna 'uuid' en jugadores
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'jugadores' AND column_name = 'uuid'
    ) INTO has_uuid_col;

    -- 4. Buscamos tus datos de perfil
    SELECT COALESCE(nombre, 'Jugador'), avatar_url INTO v_nombre, v_avatar
    FROM public.usuarios WHERE id = v_user_id;

    -- 5. INSERT MANUAL para destrabar el partido actual
    IF has_uuid_col THEN
        EXECUTE format('
            INSERT INTO public.jugadores (partido_id, usuario_id, uuid, nombre, avatar_url, score, is_goalkeeper)
            VALUES (%L, %L, %L, %L, %L, 5, false)
            ON CONFLICT (partido_id, usuario_id) DO UPDATE SET uuid = EXCLUDED.uuid',
            v_match_id, v_user_id, v_user_id, v_nombre, v_avatar);
    ELSE
        INSERT INTO public.jugadores (partido_id, usuario_id, nombre, avatar_url, score, is_goalkeeper)
        VALUES (v_match_id, v_user_id, v_nombre, v_avatar, 5, false)
        ON CONFLICT (partido_id, usuario_id) DO NOTHING;
    END IF;

    RAISE NOTICE 'Sincronización manual completada para el usuario % en el partido %', v_user_id, v_match_id;

END $$;

-- 6. RE-CREACIÓN DE LA FUNCIÓN DE APROBACIÓN (Actualizada para usar el nuevo constraint)
CREATE OR REPLACE FUNCTION public.approve_join_request(p_request_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_match_id bigint;
  v_user_id uuid;
  v_nombre text;
  v_avatar_url text;
  has_uuid_col boolean;
BEGIN
  -- Obtener solicitud
  SELECT match_id, user_id INTO v_match_id, v_user_id
  FROM public.match_join_requests
  WHERE id = p_request_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada'; END IF;

  -- Actualizar estado
  UPDATE public.match_join_requests
  SET status = 'approved', decided_at = now(), decided_by = auth.uid()
  WHERE id = p_request_id;

  -- Obtener perfil
  SELECT COALESCE(nombre, 'Jugador'), avatar_url INTO v_nombre, v_avatar_url
  FROM public.usuarios WHERE id = v_user_id;

  -- Verificar columna uuid
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'jugadores' AND column_name = 'uuid') INTO has_uuid_col;

  -- Insertar jugador
  IF has_uuid_col THEN
    EXECUTE format('INSERT INTO public.jugadores (partido_id, usuario_id, uuid, nombre, avatar_url, score) VALUES (%L, %L, %L, %L, %L, 5) ON CONFLICT (partido_id, usuario_id) DO NOTHING', v_match_id, v_user_id, v_user_id, v_nombre, v_avatar_url);
  ELSE
    INSERT INTO public.jugadores (partido_id, usuario_id, nombre, avatar_url, score)
    VALUES (v_match_id, v_user_id, v_nombre, v_avatar_url, 5)
    ON CONFLICT (partido_id, usuario_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 7. PERMISOS DE LECTURA (RLS)
ALTER TABLE public.jugadores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Lectura publica jugadores" ON public.jugadores;
CREATE POLICY "Lectura publica jugadores" ON public.jugadores FOR SELECT USING (true);

ALTER TABLE public.partidos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Lectura publica partidos" ON public.partidos;
CREATE POLICY "Lectura publica partidos" ON public.partidos FOR SELECT USING (true);
