-- Migration: Admin Notifications for Join Requests (Final)
-- Date: 2026-01-30

create or replace function public.notify_admin_join_request()
returns trigger
language plpgsql
as $$
declare
  v_admin uuid;
  v_requester_name text;
  v_sede text;
  v_fecha date;
  v_hora text;
begin
  -- Get admin and match details
  select creado_por, sede, fecha, hora 
  into v_admin, v_sede, v_fecha, v_hora
  from public.partidos
  where id = new.match_id;

  if v_admin is null then
    return new;
  end if;

  -- Get requester name with priority: profiles.nombre > usuarios.nombre
  select coalesce(
    (select nombre from public.profiles where id = new.user_id),
    (select nombre from public.usuarios where id = new.user_id)
  ) into v_requester_name;

  -- Insert notification
  -- Title: "Nueva solicitud para unirse"
  -- Body: "{nombre} quiere unirse al partido del DD/MM · HH:mm"
  insert into public.notifications (
    user_id, 
    type, 
    title, 
    message, 
    partido_id, 
    data, 
    created_at
  )
  values (
    v_admin,
    'match_join_request',
    'Nueva solicitud para unirse',
    coalesce(v_requester_name, 'Un jugador') || ' quiere unirse al partido del ' || 
    to_char(v_fecha, 'DD/MM') || ' · ' || 
    substring(coalesce(v_hora, '00:00') from 1 for 5),
    new.match_id,
    jsonb_build_object(
      'matchId', new.match_id,
      'requestId', new.id,
      'request_user_id', new.user_id,
      'link', '/admin/' || new.match_id || '?tab=solicitudes'
    ),
    now()
  );

  return new;
end;
$$;

-- Ensure trigger exists
drop trigger if exists trg_notify_admin_join_request on public.match_join_requests;

create trigger trg_notify_admin_join_request
after insert on public.match_join_requests
for each row execute function public.notify_admin_join_request();
