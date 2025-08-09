create table if not exists public.survey_results (
  partido_id bigint primary key references public.partidos(id) on delete cascade,
  mvp uuid null,
  golden_glove uuid null,
  red_cards uuid[] null,
  ready_at timestamptz not null,
  results_ready boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS
alter table public.survey_results enable row level security;

-- Policies (mínimas para que funcione el flujo desde el cliente):
-- Leer resultados (solo jugadores del partido)
create policy "sr_select_if_player"
on public.survey_results
for select
to authenticated
using (
  exists (
    select 1
    from public.jugadores j
    where j.partido_id = survey_results.partido_id
      and j.usuario_id = auth.uid()
  )
);

-- Insert/Update (permitir a jugadores del partido)
create policy "sr_upsert_if_player"
on public.survey_results
for insert
to authenticated
with check (
  exists (
    select 1
    from public.jugadores j
    where j.partido_id = survey_results.partido_id
      and j.usuario_id = auth.uid()
  )
);

create policy "sr_update_if_player"
on public.survey_results
for update
to authenticated
using (
  exists (
    select 1
    from public.jugadores j
    where j.partido_id = survey_results.partido_id
      and j.usuario_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.jugadores j
    where j.partido_id = survey_results.partido_id
      and j.usuario_id = auth.uid()
  )
);