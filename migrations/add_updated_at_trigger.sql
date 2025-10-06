-- Add updated_at column and trigger to partidos table
-- This ensures updated_at is automatically set on every update

alter table public.partidos
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_partidos_updated_at on public.partidos;
create trigger trg_partidos_updated_at
before update on public.partidos
for each row execute function public.set_updated_at();

select pg_notify('pgrst','reload schema');