-- Rollback of 20261010134000 (template link). Run as postgres, in one transaction, after the
-- rollback of 135000. Removes the owner rule and its index; the column and its foreign key are
-- dropped only if this migration created them (app_private.production_alignment_log). On Core
-- Production both existed before (uuid template_id → partidos_frecuentes.id) and stay, with
-- their data. Data lost elsewhere: the template links of matches created since 134000.
drop trigger if exists partidos_template_owner on public.partidos;
drop function if exists app_private.tg_partidos_template_owner();
drop index if exists public.partidos_template_id_idx;
do $rollback$
begin
  if to_regclass('app_private.production_alignment_log') is not null then
    if exists (select 1 from app_private.production_alignment_log where kind = 'added_constraint' and object_name = 'partidos_template_id_fkey') then
      alter table public.partidos drop constraint if exists partidos_template_id_fkey;
      delete from app_private.production_alignment_log where kind = 'added_constraint' and object_name = 'partidos_template_id_fkey';
    end if;
    if exists (select 1 from app_private.production_alignment_log where kind = 'added_column' and table_name = 'partidos' and object_name = 'template_id') then
      alter table public.partidos drop column if exists template_id;
      delete from app_private.production_alignment_log where kind = 'added_column' and object_name = 'template_id';
    end if;
  end if;
end
$rollback$;
delete from supabase_migrations.schema_migrations where version = '20261010134000';
