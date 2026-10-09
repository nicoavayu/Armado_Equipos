-- Synthetic data in Core Production's shape (real schema), committed before the rehearsal.
\set ON_ERROR_STOP on
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000', md5('reh-' || g)::uuid, 'authenticated', 'authenticated', 'reh' || g || '@rehearsal.test', '',
       now(), now(), now(), '{}', json_build_object('full_name', 'Jugador ' || g)::jsonb
from generate_series(1, 1200) g;
-- private values the shared rows hold today (phone ~30 %, birth date ~20 %, location pair ~40 %)
update public.usuarios u
set telefono = case when abs(hashtext(u.id::text)) % 10 < 3 then '+54 9 11 ' || (10000000 + abs(hashtext(u.id::text)) % 89999999) end,
    fecha_nacimiento = case when abs(hashtext(u.id::text || 'b')) % 10 < 2 then date '1990-01-01' + abs(hashtext(u.id::text)) % 8000 end,
    latitud = case when abs(hashtext(u.id::text || 'l')) % 10 < 4 then -34.6 + (abs(hashtext(u.id::text)) % 2000) / 10000.0 end,
    longitud = case when abs(hashtext(u.id::text || 'l')) % 10 < 4 then -58.4 + (abs(hashtext(u.id::text || 'x')) % 2000) / 10000.0 end,
    location_accuracy_m = case when abs(hashtext(u.id::text || 'l')) % 10 < 4 then 20 end
where u.email like '%@rehearsal.test';

insert into public.partidos_frecuentes (id, nombre, user_id, creado_por, sede, hora)
select md5('tpl-' || g)::uuid, 'Plantilla ' || g, md5('reh-' || g)::uuid, md5('reh-' || g)::uuid, 'Cancha ' || g, '21:00'
from generate_series(1, 40) g;

insert into public.partidos (id, nombre, codigo, fecha, hora, sede, modalidad, cupo_jugadores, estado, falta_jugadores, creado_por, tipo_partido, template_id)
select 996000 + g, 'Partido ' || g, upper(substr(md5('code' || g), 1, 8)), current_date + (g % 60) - 30, '20:00', 'Cancha ' || (g % 17), 'F5', 10, 'activo',
       g % 9 = 0, md5('reh-' || (1 + g % 1200))::uuid, 'Masculino', case when g <= 40 then md5('tpl-' || g)::uuid end
from generate_series(1, 400) g;

insert into public.jugadores (partido_id, nombre, usuario_id, is_substitute)
select 996000 + g, case when j % 2 = 0 then 'Invitado ' || g || '-' || j else 'Jugador ' || (1 + (g * 7 + j) % 1200) end,
       case when j % 2 = 0 then null else md5('reh-' || (1 + (g * 7 + j) % 1200))::uuid end, false
from generate_series(1, 400) g, generate_series(1, 10) j;

insert into public.notifications (user_id, partido_id, type, title, message, data)
select md5('reh-' || (1 + g % 1200))::uuid, 996000 + (1 + g % 400), 'match_update', 'Aviso', 'Aviso', jsonb_build_object('match_id', 996000 + (1 + g % 400))
from generate_series(1, 1200) g;

insert into public.match_join_requests (match_id, user_id, status, role)
select 996000 + 9 * g, md5('reh-' || (900 + g))::uuid, 'pending', 'player' from generate_series(1, 20) g;

insert into public.public_voters (partido_id, nombre, nombre_norm, votante_nombre_norm)
select 996000 + g, 'Invitado ' || g || '-2', 'invitado ' || g || '-2', 'invitado ' || g || '-2' from generate_series(1, 30) g;
commit;
