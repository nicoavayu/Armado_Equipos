-- Core: align Core Production with the schema the 20261010* migrations build on.
--
-- Core Production is not the repository's schema (pg_dump --schema-only of 2026-10-09): the
-- canonical RLS migrations are in its ledger but were never executed there. For the objects
-- the privacy closure (20261010120000…141000) builds on, Production has:
--   * partidos: no admin_id column; SELECT policies USING (true) for role public (anon and
--     every account read every match and its code), an INSERT policy that accepts any
--     creado_por, and duplicated owner policies;
--   * jugadores: five SELECT policies USING (true) (anon reads every roster) and an INSERT
--     policy that lets any account add ANY row to ANY match;
--   * public_voters / votos_publicos: anyone reads and inserts (USING/CHECK true); the
--     installed apps only read them (organizer/roster) and delete (organizer); votes and voters
--     are written by the voting RPCs (SECURITY DEFINER);
--   * none of app_private.is_match_admin / is_match_player / is_public_match_visible.
-- This migration brings exactly those objects to the repository's shape and is a no-op on a
-- database that already has it:
--   * partidos.admin_id (nullable, never set by Production's flows: the organizer stays
--     creado_por; coalesce(creado_por, admin_id) = creado_por there);
--   * the three helpers, as in the repository;
--   * partidos / jugadores, scope authorized by Nico (2026-10-09): their SELECT policies and
--     their open INSERT policies are replaced by the repository's (reads per involvement come
--     with 20261010136000/137000/140000); Production's own UPDATE/DELETE policies stay as they
--     are, and so does partidos_insert_own (the organizer inserting its own match);
--   * public_voters / votos_publicos: the open read/insert policies are dropped and the
--     roster/organizer read is added; the organizer's delete policies stay;
--   * profiles, amigos, notifications, post_match_surveys and partidos_frecuentes: untouched.
--   docs/database/core-review/POLICIES-REPLACED.md lists every replaced policy with its original
--   definition, its replacement and its rollback.
-- Everything dropped or created is recorded in app_private.production_alignment_log, which
-- the rollback uses to put Production back exactly as it was.

create table if not exists app_private.production_alignment_log (
  id bigint generated always as identity primary key,
  kind text not null,          -- dropped_policy | created_policy | created_function | added_column | granted_schema_usage | untouched_policies_digest (+ added_* by 134000, *_before by 121/137/141)
  table_name text,
  object_name text not null,
  definition jsonb,
  logged_at timestamptz not null default now()
);
revoke all on table app_private.production_alignment_log from public, anon, authenticated;

-- A migration that changes the EXECUTE grants of an existing function saves them first, so its
-- rollback restores exactly what Production had (it grants many functions to PUBLIC/anon).
create or replace function app_private.alignment_save_function_acl(p_function regprocedure)
returns void
language sql
set search_path to ''
as $function$
  insert into app_private.production_alignment_log (kind, object_name, definition)
  select 'function_acl_before', p_function::text,
         jsonb_build_object('acl', coalesce(p.proacl, acldefault('f'::"char", p.proowner))::text)
  from pg_catalog.pg_proc p
  where p.oid = p_function
    and not exists (select 1 from app_private.production_alignment_log l
                    where l.kind = 'function_acl_before' and l.object_name = p_function::text)
$function$;

create or replace function app_private.alignment_restore_function_acl(p_function regprocedure)
returns void
language plpgsql
set search_path to ''
as $function$
declare
  v_acl aclitem[];
  r record;
begin
  select (l.definition ->> 'acl')::aclitem[] into v_acl
  from app_private.production_alignment_log l
  where l.kind = 'function_acl_before' and l.object_name = p_function::text
  order by l.id desc limit 1;
  if v_acl is null then
    return;
  end if;
  execute format('revoke all on function %s from public, anon, authenticated, service_role', p_function);
  for r in select * from aclexplode(v_acl) where privilege_type = 'EXECUTE' loop
    if r.grantee = 0 then
      execute format('grant execute on function %s to public', p_function);
    elsif pg_catalog.pg_get_userbyid(r.grantee) in ('anon', 'authenticated', 'service_role') then
      execute format('grant execute on function %s to %I', p_function, pg_catalog.pg_get_userbyid(r.grantee));
    end if;
  end loop;
  delete from app_private.production_alignment_log
  where kind = 'function_acl_before' and object_name = p_function::text;
end;
$function$;
revoke all on function app_private.alignment_save_function_acl(regprocedure) from public, anon, authenticated;
revoke all on function app_private.alignment_restore_function_acl(regprocedure) from public, anon, authenticated;

-- 1) partidos.admin_id
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'partidos' and column_name = 'admin_id') then
    alter table public.partidos add column admin_id uuid;
    comment on column public.partidos.admin_id is
      'Co-organizer of the match (repository schema). Added by 20261010119000 on Core Production, where it stays null: the organizer is creado_por.';
    insert into app_private.production_alignment_log (kind, table_name, object_name)
    values ('added_column', 'partidos', 'admin_id');
  end if;
end;
$$;

-- 2) helpers (the repository's definitions)
do $$
begin
  if to_regprocedure('app_private.is_match_admin(bigint,uuid)') is null then
    execute $f$
      create function app_private.is_match_admin(p_partido_id bigint, p_user_id uuid default auth.uid())
      returns boolean language sql stable security definer set search_path to '' as $body$
        select p_user_id is not null and exists (
          select 1 from public.partidos match_row
          where match_row.id = p_partido_id
            and coalesce(match_row.creado_por, match_row.admin_id) = p_user_id)
      $body$ $f$;
    insert into app_private.production_alignment_log (kind, object_name) values ('created_function', 'app_private.is_match_admin(bigint,uuid)');
  end if;
  if to_regprocedure('app_private.is_match_player(bigint,uuid)') is null then
    execute $f$
      create function app_private.is_match_player(p_partido_id bigint, p_user_id uuid default auth.uid())
      returns boolean language sql stable security definer set search_path to '' as $body$
        select p_user_id is not null and exists (
          select 1 from public.jugadores player_row
          where player_row.partido_id = p_partido_id and player_row.usuario_id = p_user_id)
      $body$ $f$;
    insert into app_private.production_alignment_log (kind, object_name) values ('created_function', 'app_private.is_match_player(bigint,uuid)');
  end if;
  if to_regprocedure('app_private.is_public_match_visible(bigint)') is null then
    execute $f$
      create function app_private.is_public_match_visible(p_partido_id bigint)
      returns boolean language sql stable security definer set search_path to '' as $body$
        select exists (
          select 1 from public.partidos match_row
          where match_row.id = p_partido_id
            and match_row.codigo is not null
            and match_row.deleted_at is null
            and public.normalize_partido_estado(match_row.estado) not in ('deleted', 'cancelado'))
      $body$ $f$;
    insert into app_private.production_alignment_log (kind, object_name) values ('created_function', 'app_private.is_public_match_visible(bigint)');
  end if;
end;
$$;
-- Core Production's app_private has no grants at all (owner only): the policies, views and
-- triggers of the stack call app_private functions as the caller, which needs USAGE. The
-- schema is not exposed by the API; each function keeps its own EXECUTE grants.
do $$
begin
  if not has_schema_privilege('anon', 'app_private', 'usage')
     or not has_schema_privilege('authenticated', 'app_private', 'usage') then
    grant usage on schema app_private to anon, authenticated, service_role;
    insert into app_private.production_alignment_log (kind, object_name) values ('granted_schema_usage', 'app_private');
  end if;
end;
$$;
grant execute on function app_private.is_match_admin(bigint, uuid) to anon, authenticated, service_role;
grant execute on function app_private.is_match_player(bigint, uuid) to anon, authenticated, service_role;
grant execute on function app_private.is_public_match_visible(bigint) to anon, authenticated, service_role;

-- 3) policies
do $$
declare
  r record;
  v_keep constant jsonb := jsonb_build_object(
    'partidos', jsonb_build_array('partidos_select_authenticated', 'partidos_select_public_shared', 'partidos_insert_creator',
                                  'partidos_insert_own'),
    'jugadores', jsonb_build_array('jugadores_select_authenticated', 'jugadores_select_public_shared',
                                   'jugadores_insert_self_or_admin'));
begin
  for r in
    select p.* from pg_policies p
    where p.schemaname = 'public'
      and (
        (p.tablename in ('partidos', 'jugadores') and p.cmd in ('SELECT', 'INSERT', 'ALL')
         and not (v_keep -> p.tablename) ? p.policyname)
        or (p.tablename in ('public_voters', 'votos_publicos')
            and p.cmd in ('SELECT', 'INSERT') and (p.qual = 'true' or p.with_check = 'true'))
      )
  loop
    insert into app_private.production_alignment_log (kind, table_name, object_name, definition)
    values ('dropped_policy', r.tablename, r.policyname,
            jsonb_build_object('permissive', r.permissive, 'roles', to_jsonb(r.roles), 'cmd', r.cmd,
                               'using', r.qual, 'check', r.with_check));
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
  -- Every other policy of the public schema stays as it is: its digest is kept so the post-check
  -- proves no later migration of the stack changed one (see POLICIES-REPLACED.md).
  if found then
    insert into app_private.production_alignment_log (kind, object_name, definition)
    select 'untouched_policies_digest', 'public', jsonb_build_object('n', count(*), 'md5', md5(string_agg(format('%s.%s %s %s %s u=%s c=%s', tablename, policyname, permissive, cmd, roles::text, qual, with_check), E'\n' order by tablename, policyname)))
    from pg_policies
    where schemaname = 'public'
      and not (tablename in ('partidos', 'jugadores') and cmd in ('SELECT', 'INSERT', 'ALL'))
      and not (tablename in ('public_voters', 'votos_publicos') and cmd in ('SELECT', 'INSERT'));
  end if;
end;
$$;

do $$
declare
  v_policy record;
begin
  for v_policy in
    select * from (values
      ('partidos', 'partidos_select_authenticated',
       'create policy partidos_select_authenticated on public.partidos for select to authenticated using ((deleted_at is null) or app_private.is_match_admin(id))'),
      ('jugadores', 'jugadores_select_authenticated',
       'create policy jugadores_select_authenticated on public.jugadores for select to authenticated using (true)'),
      ('jugadores', 'jugadores_insert_self_or_admin',
       'create policy jugadores_insert_self_or_admin on public.jugadores for insert to authenticated with check ((usuario_id = (select auth.uid())) or app_private.is_match_admin(partido_id))'),
      ('public_voters', 'public_voters_select_match_member',
       'create policy public_voters_select_match_member on public.public_voters for select to authenticated using (app_private.is_match_player(partido_id) or app_private.is_match_admin(partido_id))'),
      ('votos_publicos', 'votos_publicos_select_match_member',
       'create policy votos_publicos_select_match_member on public.votos_publicos for select to authenticated using (app_private.is_match_player(partido_id) or app_private.is_match_admin(partido_id))')
    ) as v(table_name, policy_name, ddl)
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = v_policy.table_name and policyname = v_policy.policy_name) then
      execute v_policy.ddl;
      insert into app_private.production_alignment_log (kind, table_name, object_name)
      values ('created_policy', v_policy.table_name, v_policy.policy_name);
    end if;
  end loop;
  -- The organizer inserts its own match: Production's partidos_insert_own, or the repository's
  -- partidos_insert_creator; one of them must exist.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'partidos'
                 and policyname in ('partidos_insert_own', 'partidos_insert_creator')) then
    create policy partidos_insert_creator on public.partidos for insert to authenticated
      with check ((creado_por = (select auth.uid())) and ((admin_id is null) or (admin_id = (select auth.uid()))));
    insert into app_private.production_alignment_log (kind, table_name, object_name)
    values ('created_policy', 'partidos', 'partidos_insert_creator');
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'partidos' and column_name = 'admin_id') then
    raise exception 'partidos.admin_id missing';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('partidos', 'jugadores')
             and cmd in ('SELECT', 'INSERT', 'ALL')
             and policyname not in ('partidos_select_authenticated', 'partidos_select_public_shared', 'partidos_insert_creator',
               'partidos_insert_own', 'jugadores_select_authenticated', 'jugadores_select_public_shared',
               'jugadores_insert_self_or_admin')) then
    raise exception 'partidos/jugadores still carry SELECT/INSERT policies outside the repository set';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('public_voters', 'votos_publicos')
             and cmd in ('SELECT', 'INSERT') and (qual = 'true' or with_check = 'true')) then
    raise exception 'public_voters/votos_publicos are still open to everyone';
  end if;
end;
$$;
