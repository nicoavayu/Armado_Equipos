-- Final fix for all public voting RPCs
-- This script fixes the missing normalized names in both rating and "no lo conozco" RPCs

-- 1. Fix public_submit_player_rating
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
AS $$
declare
  v_voter_id bigint;
  v_norm text;
begin
  if p_partido_id is null
     or p_codigo is null or trim(p_codigo) = ''
     or p_votante_nombre is null or trim(p_votante_nombre) = ''
     or p_votado_jugador_id is null
     or p_puntaje is null then
    return 'invalid';
  end if;

  if p_puntaje < 1 or p_puntaje > 5 then
    return 'invalid_score';
  end if;

  if not exists (
    select 1 from public.partidos
    where id = p_partido_id
      and codigo = trim(p_codigo)
  ) then
    return 'invalid';
  end if;

  if not exists (
    select 1 from public.jugadores
    where id = p_votado_jugador_id
      and partido_id = p_partido_id
  ) then
    return 'invalid_player';
  end if;

  v_voter_id :=
    public.public_get_or_create_voter(
      p_partido_id,
      trim(p_codigo),
      p_votante_nombre
    );

  if v_voter_id is null then
    return 'invalid';
  end if;

  if exists (
    select 1
    from public.public_voters
    where id = v_voter_id
      and completed_at is not null
  ) then
    return 'already_voted_for_match';
  end if;

  -- Get normalized name for the vote record
  v_norm := public.public_normalize_voter_name(p_votante_nombre);

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
$$;

-- 2. Fix public_submit_no_lo_conozco
CREATE OR REPLACE FUNCTION public.public_submit_no_lo_conozco(
  p_partido_id bigint,
  p_codigo text,
  p_votante_nombre text,
  p_votado_jugador_id bigint
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
declare
  v_voter_id bigint;
  v_norm text;
begin
  if p_partido_id is null
     or p_codigo is null or trim(p_codigo) = ''
     or p_votante_nombre is null or trim(p_votante_nombre) = ''
     or p_votado_jugador_id is null then
    return 'invalid';
  end if;

  if not exists (
    select 1 from public.partidos
    where id = p_partido_id
      and codigo = trim(p_codigo)
  ) then
    return 'invalid';
  end if;

  if not exists (
    select 1 from public.jugadores
    where id = p_votado_jugador_id
      and partido_id = p_partido_id
  ) then
    return 'invalid_player';
  end if;

  v_voter_id :=
    public.public_get_or_create_voter(
      p_partido_id,
      trim(p_codigo),
      p_votante_nombre
    );

  if v_voter_id is null then
    return 'invalid';
  end if;

  if exists (
    select 1
    from public.public_voters
    where id = v_voter_id
      and completed_at is not null
  ) then
    return 'already_voted_for_match';
  end if;

  -- Get normalized name for the vote record
  v_norm := public.public_normalize_voter_name(p_votante_nombre);

  insert into public.votos_publicos(
    partido_id,
    public_voter_id,
    votado_jugador_id,
    votante_nombre,
    votante_nombre_norm,
    no_lo_conozco,
    puntaje
  )
  values (
    p_partido_id,
    v_voter_id,
    p_votado_jugador_id,
    trim(p_votante_nombre),
    v_norm,
    true,
    0
  );

  return 'ok';

exception
  when unique_violation then
    return 'already_voted_for_player';
end;
$$;
