-- Enforce strict one-vote-per-person policy for public voting

-- 1. Helper function for consistent normalization
CREATE OR REPLACE FUNCTION public.public_normalize_voter_name(p_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS 1082
BEGIN
  RETURN lower(regexp_replace(trim(p_name), '\s+', ' ', 'g'));
END;
1082;

-- 2. Strict check function
CREATE OR REPLACE FUNCTION public.public_has_voter_already_voted(
  p_partido_id bigint,
  p_codigo text,
  p_votante_nombre text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS 1082
DECLARE
  v_norm text;
BEGIN
  v_norm := public.public_normalize_voter_name(p_votante_nombre);

  -- 1. Check in public_voters (marked completed or exists)
  IF EXISTS (
    SELECT 1 FROM public.public_voters
    WHERE partido_id = p_partido_id
      AND (votante_nombre_norm = v_norm OR nombre_norm = v_norm)
  ) AND EXISTS (
    SELECT 1 FROM public.votos_publicos
    WHERE partido_id = p_partido_id
      AND votante_nombre_norm = v_norm
  ) THEN
    RETURN true;
  END IF;

  -- 2. Check in regular votos (authenticated)
  -- Match by normalized name
  IF EXISTS (
    SELECT 1 FROM public.votos
    WHERE partido_id = p_partido_id
      AND public.public_normalize_voter_name(jugador_nombre) = v_norm
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
1082;

-- 3. Update public_submit_player_rating
CREATE OR REPLACE FUNCTION public.public_submit_player_rating(
  p_partido_id bigint,
  p_codigo text,
  p_votante_nombre text,
  p_votado_jugador_id bigint,
  p_puntaje integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS 1082
declare
  v_voter_id bigint;
  v_norm text;
begin
  if p_partido_id is null or p_votante_nombre is null or trim(p_votante_nombre) = '' or p_puntaje is null then
    return 'invalid';
  end if;

  v_norm := public.public_normalize_voter_name(p_votante_nombre);

  -- STRICT CHECK
  if public.public_has_voter_already_voted(p_partido_id, p_codigo, p_votante_nombre) then
    return 'already_voted_for_match';
  end if;

  -- Code validation
  if not exists (select 1 from public.partidos where id = p_partido_id and codigo = trim(p_codigo)) then
    return 'invalid';
  end if;

  -- Get or create voter record
  v_voter_id := public.public_get_or_create_voter(p_partido_id, trim(p_codigo), p_votante_nombre);

  -- Record vote
  insert into public.votos_publicos(
    partido_id,
    public_voter_id,
    votado_jugador_id,
    puntaje,
    votante_nombre,
    votante_nombre_norm
  )
  values (
    p_partido_id,
    v_voter_id,
    p_votado_jugador_id,
    p_puntaje,
    trim(p_votante_nombre),
    v_norm
  );

  return 'ok';
exception
  when unique_violation then
    return 'already_voted_for_player';
end;
1082;

-- 4. Mark voter completed (optional but good for metadata)
CREATE OR REPLACE FUNCTION public.public_mark_voter_completed(
  p_partido_id bigint,
  p_codigo text,
  p_votante_nombre text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS 1082
BEGIN
  UPDATE public.public_voters
  SET completed_at = now()
  WHERE partido_id = p_partido_id
    AND (nombre_norm = public.public_normalize_voter_name(p_votante_nombre));
  
  RETURN 'ok';
END;
1082;
