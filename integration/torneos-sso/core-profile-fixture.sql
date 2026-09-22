-- Local-only fixtures for the existing AuthProvider/getProfile read path.
-- Not a product baseline or a migration. No tournament business schema.
CREATE TABLE IF NOT EXISTS public.usuarios (
 id uuid PRIMARY KEY REFERENCES auth.users(id), nombre text NOT NULL,
 email text, avatar_url text, ranking numeric DEFAULT 5, partidos_jugados integer DEFAULT 0,
 partidos_abandonados integer DEFAULT 0, acepta_invitaciones boolean DEFAULT true,
 profile_completion integer DEFAULT 100, updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.jugadores (uuid uuid PRIMARY KEY, usuario_id uuid, partido_id bigint);
CREATE TABLE IF NOT EXISTS public.player_awards (id uuid PRIMARY KEY, jugador_id text, award_type text);
CREATE TABLE IF NOT EXISTS public.partidos_manuales (id uuid PRIMARY KEY, usuario_id uuid);
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jugadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partidos_manuales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_profile ON public.usuarios;
CREATE POLICY own_profile ON public.usuarios FOR SELECT TO authenticated USING (id = (select auth.uid()));
DROP POLICY IF EXISTS own_players ON public.jugadores;
CREATE POLICY own_players ON public.jugadores FOR SELECT TO authenticated USING (usuario_id = (select auth.uid()));
DROP POLICY IF EXISTS own_awards ON public.player_awards;
CREATE POLICY own_awards ON public.player_awards FOR SELECT TO authenticated USING (jugador_id = (select auth.uid())::text);
DROP POLICY IF EXISTS own_manual ON public.partidos_manuales;
CREATE POLICY own_manual ON public.partidos_manuales FOR SELECT TO authenticated USING (usuario_id = (select auth.uid()));
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.usuarios, public.jugadores, public.player_awards, public.partidos_manuales TO authenticated;
NOTIFY pgrst, 'reload schema';
