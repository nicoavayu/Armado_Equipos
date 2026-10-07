-- Core: a match created from a frequent template remembers it.
--
-- The frequent-match history (TemplateHistoryPage, TemplateStatsModal) lists the matches
-- of a template by partidos.template_id, and creating from a template already sends it
-- (ListaPartidosFrecuentes). The column never existed in this schema, so the link was
-- dropped on every creation and every history was empty. Additive and nullable: installed
-- apps that do not send it are unaffected; matches created before this stay unlinked.
-- A match may only point to a template of its own organizer (anything else is cleared,
-- not rejected, so creating the match never fails because of the link).

alter table public.partidos
  add column if not exists template_id bigint;

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
  if not exists (
    select 1
    from public.partidos_frecuentes f
    where f.id = new.template_id
      and coalesce(f.usuario_id, f.creado_por) is not null
      and coalesce(f.usuario_id, f.creado_por) in (new.creado_por, new.admin_id)
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
  ) then
    raise exception 'partidos.template_id is missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'partidos_template_owner' and not tgisinternal) then
    raise exception 'partidos_template_owner trigger is missing';
  end if;
end;
$$;
