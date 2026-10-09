-- Smoke checks of the #193 stack on Core Production's REAL schema. Runs inside the probe's
-- transaction AFTER the migrations (as postgres), then rolls back. Prints PASS/FAIL lines.
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

-- Entries of a roster as an outsider must carry: no usuario_id/score/responsabilidad_score, and a
-- uuid key that is not an account id (143000).
create function pg_temp.roster_leaks(p_entries jsonb) returns int language sql as $f$
  select count(*)::int from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) e
  where e ? 'usuario_id' or e ? 'score' or e ? 'responsabilidad_score' or not (e ? 'uuid')
     or (e ->> 'uuid') in (select md5('smoke-' || k)::uuid::text from unnest(array['org', 'mem', 'stranger', 'req1', 'req2', 'inv', 'lnk']) k)
$f$;
grant execute on function pg_temp.roster_leaks(jsonb) to public;

-- ---------- seed (synthetic) ----------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000', md5('smoke-' || k)::uuid, 'authenticated', 'authenticated', k || '@smoke.test', '', now(), now(), now(), '{}', json_build_object('full_name', initcap(k))::jsonb
from unnest(array['org', 'mem', 'stranger', 'req1', 'req2', 'inv', 'lnk']) k;
update public.usuarios set telefono = '+54 9 11 5555 0101', fecha_nacimiento = '1990-01-02', latitud = -34.60371, longitud = -58.38157
where id = md5('smoke-mem')::uuid;

insert into public.partidos_frecuentes (id, nombre, user_id, creado_por, sede, hora)
values ('11111111-1111-1111-1111-111111111111', 'Plantilla smoke', md5('smoke-org')::uuid, md5('smoke-org')::uuid, 'Cancha', '21:00');

insert into public.partidos (id, nombre, codigo, fecha, hora, sede, modalidad, cupo_jugadores, estado, falta_jugadores, creado_por, tipo_partido) values
  (995001, 'Abierto smoke', 'SMOKE001', current_date + 2, '21:00', 'Cancha', 'F5', 2, 'activo', true, md5('smoke-org')::uuid, 'Masculino'),
  (995002, 'Privado smoke', 'SMOKE002', current_date + 2, '21:00', 'Cancha', 'F5', 10, 'activo', false, md5('smoke-org')::uuid, 'Masculino'),
  (995003, 'Votación smoke', 'SMOKE003', current_date - 1, '21:00', 'Cancha', 'F5', 3, 'activo', false, md5('smoke-org')::uuid, 'Masculino');
insert into public.jugadores (partido_id, nombre, usuario_id) values
  (995001, 'Org', md5('smoke-org')::uuid), (995001, 'Mem', md5('smoke-mem')::uuid),
  (995002, 'Org', md5('smoke-org')::uuid), (995002, 'Mem', md5('smoke-mem')::uuid),
  (995003, 'Invitado Uno', null), (995003, 'Invitado Dos', null), (995003, 'Mem', md5('smoke-mem')::uuid);
-- as the app writes it: a registered player's uuid is its account id
update public.jugadores set uuid = usuario_id, responsabilidad_score = 4.5
where partido_id between 995001 and 995003 and usuario_id is not null;
insert into public.notifications (user_id, partido_id, type, title, message, data) values
  (md5('smoke-org')::uuid, 995003, 'call_to_vote', 'A votar', 'Votá', jsonb_build_object('match_id', 995003)),
  (md5('smoke-inv')::uuid, 995002, 'match_invite', 'Invitación', 'Vení', jsonb_build_object('match_id', 995002, 'status', 'pending'));
insert into public.guest_match_invites (partido_id, token, created_by, expires_at, max_uses, uses_count)
values (995002, 'smoke-token-1', md5('smoke-org')::uuid, now() + interval '1 day', 20, 0);

-- ---------- private fields (135000) ----------
select pg_temp.check('135 shared row has no email/phone/birth of the seeded accounts',
  (select count(*) from public.usuarios where id::text like '%' and email is not null or telefono is not null or fecha_nacimiento is not null) = 0);
select pg_temp.check('135 auth sync email captured privately',
  (select email from app_private.usuarios_private where user_id = md5('smoke-mem')::uuid) = 'mem@smoke.test');
select pg_temp.as_user(md5('smoke-mem')::uuid);
set local role authenticated;
select pg_temp.check('135 owner reads own phone via get_my_profile', (select telefono from public.get_my_profile()) = '+54 9 11 5555 0101');
select pg_temp.check('135 owner clears phone', pg_temp.try($$select public.clear_my_profile_fields(array['telefono'])$$) = 'ok');
select pg_temp.check('135 owner phone gone after clear', (select telefono from public.get_my_profile()) is null);
reset role;

-- ---------- reads as a stranger (136/137/140) ----------
select pg_temp.as_user(md5('smoke-stranger')::uuid);
set local role authenticated;
select pg_temp.check('stranger: other users email/phone are NULL',
  (select count(*) from public.usuarios where email is not null or telefono is not null) = 0, (select count(*)::text from public.usuarios where email is not null));
select pg_temp.check('stranger: table returns no match', (select count(*) from public.partidos where id between 995001 and 995003) = 0);
select pg_temp.check('stranger: no roster rows', (select count(*) from public.jugadores where partido_id between 995001 and 995003) = 0);
select pg_temp.check('stranger: partidos_view shows the published match only, code masked',
  (select count(*) from public.partidos_view where id = 995001 and codigo is null) = 1
  and (select count(*) from public.partidos_view where id in (995002, 995003)) = 0,
  (select string_agg(id || ':' || coalesce(codigo, 'null'), ',') from public.partidos_view where id between 995001 and 995003));
select pg_temp.check('stranger: partidos_view embedded roster has no usuario_id/score',
  (select count(*) from public.partidos_view v, jsonb_array_elements(coalesce(to_jsonb(v) -> 'jugadores', '[]'::jsonb)) e
   where v.id = 995001 and (e ? 'usuario_id' or e ? 'score')) = 0);
select pg_temp.check('stranger: Quiero jugar entries without usuario_id/score',
  (select count(*) from public.partidos_abiertos_operativos_v2 v, jsonb_array_elements(v.jugadores) e
   where v.id = 995001 and (e ? 'usuario_id' or e ? 'score')) = 0
  and exists (select 1 from public.partidos_abiertos_operativos_v2 where id = 995001));
select pg_temp.check('stranger: public roster RPC without usuario_id/score',
  (select count(*) from jsonb_array_elements(public.get_public_match_roster(995001)) e where e ? 'usuario_id' or e ? 'score') = 0
  and jsonb_array_length(public.get_public_match_roster(995001)) = 2);
select pg_temp.check('143 stranger: no account id or responsabilidad_score in partidos_view, Quiero jugar or the roster RPC',
  (select pg_temp.roster_leaks(to_jsonb(v) -> 'jugadores') from public.partidos_view v where v.id = 995001) = 0
  and (select pg_temp.roster_leaks(v.jugadores) from public.partidos_abiertos_operativos_v2 v where v.id = 995001) = 0
  and pg_temp.roster_leaks(public.get_public_match_roster(995001)) = 0,
  public.get_public_match_roster(995001)::text);
select pg_temp.check('143 stranger: the opaque uuid keys are distinct per row',
  (select count(distinct e ->> 'uuid') from jsonb_array_elements(public.get_public_match_roster(995001)) e) = 2);
select pg_temp.check('stranger: get_match_access_codes gives nothing', (select count(*) from public.get_match_access_codes(array[995001, 995002]::bigint[])) = 0);
reset role;

-- ---------- member and organizer ----------
select pg_temp.as_user(md5('smoke-mem')::uuid);
set local role authenticated;
select pg_temp.check('member: sees both its matches with codes', (select count(*) from public.partidos where id in (995001, 995002) and codigo is not null) = 2);
select pg_temp.check('member: full roster entries in the view', (select count(*) from public.partidos_view v, jsonb_array_elements(coalesce(to_jsonb(v) -> 'jugadores', '[]'::jsonb)) e
   where v.id = 995001 and e ? 'usuario_id') = 2);
select pg_temp.check('143 member: real uuid and ratings in its own match',
  (select count(*) from public.partidos_view v, jsonb_array_elements(coalesce(to_jsonb(v) -> 'jugadores', '[]'::jsonb)) e
   where v.id = 995001 and e ->> 'uuid' = md5('smoke-org')::uuid::text and e ? 'responsabilidad_score') = 1);
reset role;
select pg_temp.as_user(md5('smoke-org')::uuid);
set local role authenticated;
select pg_temp.check('organizer: reads its matches and roster', (select count(*) from public.jugadores where partido_id = 995002) = 2);
select pg_temp.check('organizer: creates a match (INSERT…RETURNING)', pg_temp.try($$insert into public.partidos (nombre, codigo, fecha, hora, sede, modalidad, cupo_jugadores, estado, creado_por) values ('Nuevo', 'SMOKENEW', current_date + 3, '20:00', 'Cancha', 'F5', 10, 'activo', auth.uid()) returning id$$) = 'ok');
select pg_temp.check('organizer: cannot create a match for someone else', pg_temp.try($$insert into public.partidos (nombre, codigo, fecha, hora, sede, modalidad, cupo_jugadores, estado, creado_por) values ('Ajeno', 'SMOKEX1', current_date + 3, '20:00', 'Cancha', 'F5', 10, 'activo', md5('smoke-stranger')::uuid)$$) like '42501%');
select pg_temp.check('134 organizer: creates from own template', pg_temp.try($$insert into public.partidos (nombre, codigo, fecha, hora, sede, modalidad, cupo_jugadores, estado, creado_por, template_id) values ('De plantilla', 'SMOKETPL', current_date + 4, '20:00', 'Cancha', 'F5', 10, 'activo', auth.uid(), '11111111-1111-1111-1111-111111111111')$$) = 'ok');
select pg_temp.check('134 organizer: own template link kept', (select template_id::text from public.partidos where codigo = 'SMOKETPL') = '11111111-1111-1111-1111-111111111111');
reset role;
select pg_temp.as_user(md5('smoke-stranger')::uuid);
set local role authenticated;
select pg_temp.check('134 stranger: creates pointing to someone else''s template', pg_temp.try($$insert into public.partidos (nombre, codigo, fecha, hora, sede, modalidad, cupo_jugadores, estado, creado_por, template_id) values ('Copia', 'SMOKECPY', current_date + 4, '20:00', 'Cancha', 'F5', 10, 'activo', auth.uid(), '11111111-1111-1111-1111-111111111111')$$) = 'ok');
select pg_temp.check('134 stranger: that link is cleared', (select count(*) from public.partidos where codigo = 'SMOKECPY' and template_id is null) = 1);
reset role;

-- ---------- writes on a foreign published match (140/141/142) ----------
select pg_temp.as_user(md5('smoke-req1')::uuid);
set local role authenticated;
select pg_temp.check('req1: request to join published match', pg_temp.try($$insert into public.match_join_requests (match_id, user_id, status, role) values (995001, auth.uid(), 'pending', 'player')$$) = 'ok');
select pg_temp.check('req1: duplicate request → 23505', pg_temp.try($$insert into public.match_join_requests (match_id, user_id, status, role) values (995001, auth.uid(), 'pending', 'player')$$) like '23505%');
select pg_temp.check('req1: self-approved request → 42501', pg_temp.try($$insert into public.match_join_requests (match_id, user_id, status, role) values (995003, auth.uid(), 'approved', 'player')$$) like '42501%');
select pg_temp.check('req1: request to a private match → refused', pg_temp.try($$insert into public.match_join_requests (match_id, user_id, status, role) values (995002, auth.uid(), 'pending', 'player')$$) like 'P0001%');
select pg_temp.check('req1: self-insert into published roster → 42501', pg_temp.try($$insert into public.jugadores (partido_id, usuario_id, nombre) values (995001, auth.uid(), 'Colado')$$) like '42501%');
reset role;
select pg_temp.as_user(md5('smoke-req2')::uuid);
set local role authenticated;
select pg_temp.check('142 req2: a SECOND requester on the same match succeeds', pg_temp.try($$insert into public.match_join_requests (match_id, user_id, status, role) values (995001, auth.uid(), 'pending', 'player')$$) = 'ok');
select pg_temp.check('143 req2 (pending request): roster RPC and view entries masked',
  pg_temp.roster_leaks(public.get_public_match_roster(995001)) = 0 and jsonb_array_length(public.get_public_match_roster(995001)) = 2
  and (select pg_temp.roster_leaks(to_jsonb(v) -> 'jugadores') from public.partidos_view v where v.id = 995001) = 0,
  public.get_public_match_roster(995001)::text);
select pg_temp.check('143 req2 (pending request): no roster rows from the table', (select count(*) from public.jugadores where partido_id = 995001) = 0);
reset role;
select pg_temp.check('142 organizer got one notice per request',
  (select count(*) from public.notifications where user_id = md5('smoke-org')::uuid and type = 'match_join_request') = 2);
select pg_temp.as_user(md5('smoke-org')::uuid);
set local role authenticated;
select pg_temp.check('141 organizer approves req1', pg_temp.try(format('select public.approve_join_request(%s)',
  (select id from public.match_join_requests where match_id = 995001 and user_id = md5('smoke-req1')::uuid))) = 'ok');
reset role;
select set_config('smoke.req2', (select id::text from public.match_join_requests where match_id = 995001 and user_id = md5('smoke-req2')::uuid), true) is not null as stashed;
select pg_temp.as_user(md5('smoke-mem')::uuid);
set local role authenticated;
select pg_temp.check('member cannot approve', pg_temp.try('select public.approve_join_request(' || current_setting('smoke.req2') || ')') like '42501%');
-- Production keeps its own UPDATE policy on jugadores (organizer only): a player's update of its
-- own row changes nothing there; on the repository schema the 140000 guard refuses a re-score.
select pg_temp.check('member: updating own row raises no unexpected error', pg_temp.try($$update public.jugadores set nombre = 'Mem 2' where partido_id = 995001 and usuario_id = auth.uid()$$) = 'ok');
select pg_temp.check('member: cannot re-score own row', (pg_temp.try($$update public.jugadores set score = 10 where partido_id = 995001 and usuario_id = auth.uid()$$) like '42501%')
  or (select coalesce(score, 0) <> 10 from public.jugadores where partido_id = 995001 and usuario_id = auth.uid()));
reset role;
select pg_temp.as_user(md5('smoke-inv')::uuid);
set local role authenticated;
select pg_temp.check('143 invited (not in yet): no roster rows from the table', (select count(*) from public.jugadores where partido_id = 995002) = 0);
select pg_temp.check('invited: joins the private match itself', pg_temp.try($$insert into public.jugadores (partido_id, usuario_id, nombre) values (995002, auth.uid(), 'Inv')$$) = 'ok');
select pg_temp.check('143 invited after joining: sees the roster', (select count(*) from public.jugadores where partido_id = 995002) = 3);
reset role;
select pg_temp.as_user(md5('smoke-lnk')::uuid);
set local role authenticated;
select pg_temp.check('link: cannot join before validating the invite link', pg_temp.try($$insert into public.jugadores (partido_id, usuario_id, nombre) values (995002, auth.uid(), 'Lnk')$$) like '42501%');
select pg_temp.check('link: validates the invite link', (select ok from public.validate_guest_match_invite(995002, 'SMOKE002', 'smoke-token-1')) is true);
select pg_temp.check('link: joins after validating', pg_temp.try($$insert into public.jugadores (partido_id, usuario_id, nombre) values (995002, auth.uid(), 'Lnk')$$) = 'ok');
reset role;

-- ---------- anon: links and voting (125/121/138) ----------
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
select pg_temp.check('anon: no rows from partidos/jugadores/view',
  (select count(*) from public.partidos) = 0 and (select count(*) from public.jugadores) = 0 and (select count(*) from public.partidos_view) = 0);
select pg_temp.check('anon: the code opens its match, entries without usuario_id',
  (public.public_get_match_by_code('SMOKE003', 995003) -> 'partido' ->> 'id') = '995003'
  and (select count(*) from jsonb_array_elements(public.public_get_match_by_code('SMOKE003', 995003) -> 'jugadores') e where e ? 'usuario_id') = 0);
select pg_temp.check('143 anon: link entries carry no account id or responsabilidad_score',
  pg_temp.roster_leaks(public.public_get_match_by_code('SMOKE003', 995003) -> 'jugadores') = 0
  and jsonb_array_length(public.public_get_match_by_code('SMOKE003', 995003) -> 'jugadores') = 3);
select pg_temp.check('anon: guest votes by name', public.public_submit_player_rating(995003, 'SMOKE003', 'Invitado Uno',
  (select (e ->> 'id')::bigint from jsonb_array_elements(public.public_get_match_by_code('SMOKE003', 995003) -> 'jugadores') e where e ->> 'nombre' = 'Invitado Dos'), 8) = 'ok');
select pg_temp.check('anon: a registered name cannot vote as guest', public.public_submit_player_rating(995003, 'SMOKE003', 'Mem',
  (select (e ->> 'id')::bigint from jsonb_array_elements(public.public_get_match_by_code('SMOKE003', 995003) -> 'jugadores') e where e ->> 'nombre' = 'Invitado Dos'), 8) = 'invalid');
select pg_temp.check('anon: voters/votes tables not readable', (select count(*) from public.public_voters) = 0 and (select count(*) from public.votos_publicos) = 0);
select pg_temp.check('anon: a code opens only its own match', public.public_get_match_by_code('SMOKE003', 995002) -> 'partido' is null);
select pg_temp.check('anon: a code does not vote on another match', public.public_submit_player_rating(995002, 'SMOKE003', 'Invitado Uno',
  (select (e ->> 'id')::bigint from jsonb_array_elements(public.public_get_match_by_code('SMOKE003', 995003) -> 'jugadores') e where e ->> 'nombre' = 'Invitado Dos'), 8) is distinct from 'ok');
select pg_temp.check('anon: cannot write voters/votes directly',
  pg_temp.try($$insert into public.public_voters (partido_id, nombre, nombre_norm, votante_nombre_norm) values (995003, 'X', 'x', 'x')$$) like '42501%'
  and pg_temp.try($$insert into public.votos_publicos (partido_id, public_voter_id, votante_nombre, votado_jugador_id, puntaje) values (995003, 1, 'X', 1, 5)$$) like '42501%');
select pg_temp.check('121 anon: cannot call public_get_or_create_voter', pg_temp.try($$select public.public_get_or_create_voter(995003, 'SMOKE003', 'Invitado Uno')$$) like '42501%');
reset role;

-- ---------- server-side survey finalization runs on this schema (131) ----------
select pg_temp.check('131 finalization job runs', pg_temp.try($$select public.process_survey_finalizations_backend(25)$$) = 'ok', pg_temp.try($$select public.process_survey_finalizations_backend(25)$$));

-- ---------- match notifications: only the organizer and the people of the match (145) ----------
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
select pg_temp.check('145 anon: cannot send match notifications',
  pg_temp.try($$select public.enqueue_partido_notification(995001, 'match_update', 'X', 'Y')$$) like '42501%'
  and pg_temp.try($$select public.enqueue_match_participant_notification(995001, 'match_update', 'X', 'Y')$$) like '42501%');
select pg_temp.check('145 anon: cannot call add_creator_to_match', pg_temp.try($$select public.add_creator_to_match(gen_random_uuid())$$) like '42501%');
reset role;
select pg_temp.as_user(md5('smoke-stranger')::uuid);
set local role authenticated;
select pg_temp.check('145 stranger: no notice to a match it has nothing to do with',
  pg_temp.try($$select public.enqueue_partido_notification(995002, 'match_update', 'X', 'Y')$$) like '42501%');
select pg_temp.check('145 stranger: no cancellation notice to a roster',
  pg_temp.try($$select public.enqueue_partido_notification(995001, 'match_cancelled', 'X', 'Y')$$) like '42501%'
  and pg_temp.try($$select public.enqueue_match_participant_notification(995001, 'match_update', 'X', 'Y')$$) like '42501%');
reset role;
select pg_temp.as_user(md5('smoke-req2')::uuid);
set local role authenticated;
select pg_temp.check('145 requester: tells the organizer about its request (1.1.21)',
  pg_temp.try($$select public.enqueue_partido_notification(995001, 'match_join_request', 'Solicitud', 'Quiere jugar')$$) = 'ok');
select pg_temp.check('145 requester: cannot announce a cancellation nor fan out to the roster',
  pg_temp.try($$select public.enqueue_partido_notification(995001, 'match_cancelled', 'X', 'Y')$$) like '42501%'
  and pg_temp.try($$select public.enqueue_match_participant_notification(995001, 'match_update', 'X', 'Y')$$) like '42501%');
reset role;
select pg_temp.as_user(md5('smoke-mem')::uuid);
set local role authenticated;
select pg_temp.check('145 player: announces it joined to the roster (1.1.21)',
  pg_temp.try($$select public.enqueue_match_participant_notification(995001, 'match_update', 'Se sumó', 'Mem')$$) = 'ok');
select pg_temp.check('145 player: cannot fan out other types',
  pg_temp.try($$select public.enqueue_match_participant_notification(995001, 'match_cancelled', 'X', 'Y')$$) like '42501%');
reset role;
select pg_temp.as_user(md5('smoke-org')::uuid);
set local role authenticated;
select pg_temp.check('145 organizer: sends what it sent before (match_deleted, survey_start)',
  pg_temp.try($$select public.enqueue_partido_notification(995002, 'match_deleted', 'Borrado', 'X')$$) = 'ok'
  and pg_temp.try($$select public.enqueue_partido_notification(995003, 'survey_start', 'Encuesta', 'X')$$) = 'ok');
select pg_temp.check('145 organizer: a SECURITY DEFINER caller still notifies (cancel_partido_with_notification)',
  pg_temp.try($$select public.cancel_partido_with_notification(995002, 'Lluvia')$$) = 'ok');
reset role;
select pg_temp.check('145 the cancellation reached the roster', (select count(*) from public.notifications where partido_id = 995002 and type = 'match_cancelled') >= 1);
