-- Reset votación con SECURITY DEFINER para bypass de RLS
-- Crea función RPC segura que borra votos y resetea scores de jugadores
-- Asegúrate de correr esta migración en Supabase

create or replace function public.reset_votacion(match_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Borrar todos los votos del partido
  delete from public.votos where partido_id = match_id;

  -- Resetear score de jugadores del partido
  update public.jugadores
    set score = null
  where partido_id = match_id;
end;
$$;

grant execute on function public.reset_votacion(bigint) to authenticated, service_role, anon;
