-- Checks for the DRAFT 20261010144000, inside a transaction the caller rolls back, as postgres,
-- after the stack (needs pg_temp.try/as_user/check from integration/prod-schema/smoke.sql) and
-- with :apply_draft = on|off. Prints PASS/FAIL and "DBG INFO" lines; they say what changes for
-- 1.1.21 (table reads) and what does not (views).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000', md5('draft144-' || k)::uuid, 'authenticated', 'authenticated', k || '@draft144.test', '', now(), now(), now(), '{}', '{}'::jsonb
from unnest(array['org', 'mem', 'req', 'inv']) k;
insert into public.partidos (id, nombre, codigo, fecha, hora, sede, modalidad, cupo_jugadores, estado, falta_jugadores, creado_por, tipo_partido) values
  (995101, 'Publicado 144', 'DRAFT101', current_date + 2, '21:00', 'Cancha', 'F5', 10, 'activo', true, md5('draft144-org')::uuid, 'Masculino'),
  (995102, 'Privado 144', 'DRAFT102', current_date + 2, '21:00', 'Cancha', 'F5', 10, 'activo', false, md5('draft144-org')::uuid, 'Masculino');
insert into public.jugadores (partido_id, nombre, usuario_id) values
  (995101, 'Org', md5('draft144-org')::uuid), (995101, 'Mem', md5('draft144-mem')::uuid),
  (995102, 'Org', md5('draft144-org')::uuid), (995102, 'Mem', md5('draft144-mem')::uuid);
insert into public.notifications (user_id, partido_id, type, title, message, data) values
  (md5('draft144-inv')::uuid, 995102, 'match_invite', 'Invitación', 'Vení', jsonb_build_object('match_id', 995102, 'status', 'pending'));
insert into public.match_join_requests (match_id, user_id, status, role) values (995101, md5('draft144-req')::uuid, 'pending', 'player');

\if :apply_draft
\i docs/database/core-review/drafts/20261010144000_core_partidos_row_roster_only.sql
\endif

select pg_temp.as_user(md5('draft144-req')::uuid);
set local role authenticated;
select 'DBG INFO requester (pending): table rows ' || (select count(*) from public.partidos where id = 995101)
  || ', with code ' || (select count(*) from public.partidos where id = 995101 and codigo is not null)
  || '; partidos_view rows ' || (select count(*) from public.partidos_view where id = 995101)
  || ' (code ' || coalesce((select codigo from public.partidos_view where id = 995101), 'masked') || ')';
\if :apply_draft
select pg_temp.check('144 requester: no code from the table', (select count(*) from public.partidos where id = 995101 and codigo is not null) = 0);
\endif
select pg_temp.check('144 requester: still sees the published match in partidos_view, code masked',
  (select count(*) from public.partidos_view where id = 995101 and codigo is null) = 1);
reset role;

select pg_temp.as_user(md5('draft144-inv')::uuid);
set local role authenticated;
select 'DBG INFO invited (private, not in yet): table rows ' || (select count(*) from public.partidos where id = 995102)
  || '; partidos_view rows ' || (select count(*) from public.partidos_view where id = 995102)
  || '; roster RPC entries ' || coalesce(jsonb_array_length(public.get_public_match_roster(995102)), 0);
\if :apply_draft
select pg_temp.check('144 invited: no code from the table', (select count(*) from public.partidos where id = 995102 and codigo is not null) = 0);
\endif
select pg_temp.check('144 invited: joins by the invitation', pg_temp.try($$insert into public.jugadores (partido_id, usuario_id, nombre) values (995102, auth.uid(), 'Inv')$$) = 'ok');
select pg_temp.check('144 invited after joining: reads the match and its code', (select count(*) from public.partidos where id = 995102 and codigo is not null) = 1);
reset role;

select pg_temp.as_user(md5('draft144-mem')::uuid);
set local role authenticated;
select pg_temp.check('144 member: reads both matches with code', (select count(*) from public.partidos where id in (995101, 995102) and codigo is not null) = 2);
reset role;
select pg_temp.as_user(md5('draft144-org')::uuid);
set local role authenticated;
select pg_temp.check('144 organizer: reads both matches with code', (select count(*) from public.partidos where id in (995101, 995102) and codigo is not null) = 2);
reset role;
