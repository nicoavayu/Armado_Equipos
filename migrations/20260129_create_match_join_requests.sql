-- Crear tabla de solicitudes de unión a partido (match_join_requests)
create table if not exists public.match_join_requests (
  id uuid primary key default gen_random_uuid(),
  partido_id bigint references partidos(id) on delete cascade,
  usuario_id uuid references usuarios(id) on delete cascade,
  estado text not null default 'pending',
  created_at timestamptz default now(),
  unique (partido_id, usuario_id)
);

-- Índices
create index if not exists idx_match_join_requests_partido_id on public.match_join_requests(partido_id);
create index if not exists idx_match_join_requests_usuario_id on public.match_join_requests(usuario_id);
