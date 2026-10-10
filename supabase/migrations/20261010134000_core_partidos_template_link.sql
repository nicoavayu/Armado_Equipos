-- Core: a match created from a frequent template remembers it.
--
-- The frequent-match history (TemplateHistoryPage, TemplateStatsModal) lists the matches
-- of a template by partidos.template_id, and creating from a template already sends it
-- (ListaPartidosFrecuentes). The column never existed in this schema, so the link was
-- dropped on every creation and every history was empty. Additive and nullable: installed
-- apps that do not send it are unaffected; matches created before this stay unlinked.
-- A match may only point to a template of its own organizer (anything else is cleared,
-- not rejected, so creating the match never fails because of the link).

-- Core Production already has partidos.template_id as uuid with this foreign key: there
-- partidos_frecuentes.id is uuid (migrations/20260210_templates_teams_winner.sql). The column
-- takes the type of partidos_frecuentes.id, so an existing one is kept as it is.
do $$
declare
  v_template_type text := (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
                           where a.attrelid = 'public.partidos_frecuentes'::regclass and a.attname = 'id' and not a.attisdropped);
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'partidos' and column_name = 'template_id') then
    execute format('alter table public.partidos add column template_id %s', v_template_type);
    insert into app_private.production_alignment_log (kind, table_name, object_name)
    values ('added_column', 'partidos', 'template_id');
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'partidos_template_id_fkey'
      and conrelid = 'public.partidos'::regclass
  ) then
    alter table public.partidos
      add constraint partidos_template_id_fkey
      foreign key (template_id) references public.partidos_frecuentes(id) on delete set null;
    insert into app_private.production_alignment_log (kind, table_name, object_name)
    values ('added_constraint', 'partidos', 'partidos_template_id_fkey');
  end if;
end;
$$;

create index if not exists partidos_template_id_idx
  on public.partidos (template_id)
  where template_id is not null;

create or replace function app_private.tg_partidos_template_owner()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.template_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.template_id is not distinct from old.template_id then
    return new;
  end if;
  -- The template's owner: usuario_id in the repository schema, user_id in Core Production,
  -- creado_por in both (read through to_jsonb so either shape works).
  if not exists (
    select 1
    from public.partidos_frecuentes f
    where f.id = new.template_id
      and exists (
        select 1
        from unnest(array[to_jsonb(f) ->> 'usuario_id', to_jsonb(f) ->> 'user_id', to_jsonb(f) ->> 'creado_por']) owner_id
        where owner_id is not null
          and owner_id in (new.creado_por::text, new.admin_id::text)
      )
  ) then
    new.template_id := null;
  end if;
  return new;
end;
$function$;

revoke all on function app_private.tg_partidos_template_owner() from public, anon, authenticated;

drop trigger if exists partidos_template_owner on public.partidos;
create trigger partidos_template_owner
  before insert or update of template_id on public.partidos
  for each row execute function app_private.tg_partidos_template_owner();

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'partidos' and column_name = 'template_id'
  ) or (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
        where a.attrelid = 'public.partidos'::regclass and a.attname = 'template_id' and not a.attisdropped)
     is distinct from (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
        where a.attrelid = 'public.partidos_frecuentes'::regclass and a.attname = 'id' and not a.attisdropped) then
    raise exception 'partidos.template_id must exist with the type of partidos_frecuentes.id';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'partidos_template_owner' and not tgisinternal) then
    raise exception 'partidos_template_owner trigger is missing';
  end if;
end;
$$;
