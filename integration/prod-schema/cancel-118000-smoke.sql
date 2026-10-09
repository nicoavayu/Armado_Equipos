-- Rehearsal of 20261010118000 on a disposable copy of Core Production's schema, inside a
-- transaction the caller rolls back, as postgres, after the migration. Prints PASS/FAIL lines.
create function pg_temp.try(p_sql text) returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$f$;
grant execute on function pg_temp.try(text) to public;
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
end;
$f$;
grant execute on function pg_temp.as_user(uuid) to public;
create function pg_temp.check(p_name text, p_pass boolean, p_detail text default '') returns text language sql as $f$
  select case when coalesce(p_pass, false) then 'PASS ' || p_name else 'FAIL ' || p_name || ' :: ' || coalesce(p_detail, '') end
$f$;
grant execute on function pg_temp.check(text, boolean, text) to public;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000', md5('c118-' || k)::uuid, 'authenticated', 'authenticated', k || '@c118.test', '', now(), now(), now(), '{}', '{}'::jsonb
from unnest(array['org', 'mem', 'stranger']) k;
insert into public.partidos (id, nombre, codigo, fecha, hora, sede, modalidad, cupo_jugadores, estado, creado_por, tipo_partido) values
  (995201, 'Cancelable', 'C118A', current_date + 2, '21:00', 'Cancha', 'F5', 10, 'activo', md5('c118-org')::uuid, 'Masculino'),
  (995202, 'Otro', 'C118B', current_date + 2, '21:00', 'Cancha', 'F5', 10, 'activo', md5('c118-org')::uuid, 'Masculino');
insert into public.jugadores (partido_id, nombre, usuario_id) values
  (995201, 'Org', md5('c118-org')::uuid), (995201, 'Mem', md5('c118-mem')::uuid);

select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
select pg_temp.check('118 anon: cannot cancel', pg_temp.try($$select public.cancel_partido_with_notification(995201, 'x')$$) like '42501%');
reset role;
select pg_temp.as_user(md5('c118-stranger')::uuid);
set local role authenticated;
select pg_temp.check('118 stranger: refused', pg_temp.try($$select public.cancel_partido_with_notification(995201, 'x')$$) like '42501%');
reset role;
select pg_temp.as_user(md5('c118-mem')::uuid);
set local role authenticated;
select pg_temp.check('118 player of the roster (not organizer): refused', pg_temp.try($$select public.cancel_partido_with_notification(995201, 'x')$$) like '42501%');
reset role;
select pg_temp.check('118 the refusals changed nothing', (select count(*) from public.partidos where id = 995201 and estado = 'activo' and deleted_at is null) = 1);
select pg_temp.as_user(md5('c118-org')::uuid);
set local role authenticated;
select pg_temp.check('118 organizer cancels (as 1.1.21 does)', pg_temp.try($$select public.cancel_partido_with_notification(995201, 'Lluvia')$$) = 'ok');
reset role;
select pg_temp.check('118 the match is cancelled', (select count(*) from public.partidos where id = 995201 and estado = 'cancelado' and deleted_at is not null) = 1);
select pg_temp.check('118 the roster is notified', (select count(*) from public.notifications where type = 'match_cancelled'
  and (partido_id = 995201 or data ->> 'match_id' = '995201') and user_id = md5('c118-mem')::uuid) >= 1);
select pg_temp.check('118 the other match is untouched', (select count(*) from public.partidos where id = 995202 and estado = 'activo' and deleted_at is null) = 1);
set local role service_role;
select pg_temp.check('118 service_role still cancels', pg_temp.try($$select public.cancel_partido_with_notification(995202, 'x')$$) = 'ok');
reset role;
