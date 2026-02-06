-- Enable public access to public_voters and votos_publicos

-- 1. Enable RLS (just in case it's not already, but we know it's on because of the 42501 error)
ALTER TABLE public.public_voters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votos_publicos ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing policies if any (to avoid duplicates)
DROP POLICY IF EXISTS "Public voters are visible to everyone" ON public.public_voters;
DROP POLICY IF EXISTS "Public voters can be created by everyone" ON public.public_voters;
DROP POLICY IF EXISTS "Public votes are visible to everyone" ON public.votos_publicos;
DROP POLICY IF EXISTS "Public votes can be created by everyone" ON public.votos_publicos;

-- 3. Create SELECT policies
CREATE POLICY "Public voters are visible to everyone" 
ON public.public_voters FOR SELECT 
USING (true);

CREATE POLICY "Public votes are visible to everyone" 
ON public.votos_publicos FOR SELECT 
USING (true);

-- 4. Create INSERT policies (needed for direct inserts or if RPC owners don't bypass)
CREATE POLICY "Public voters can be created by everyone" 
ON public.public_voters FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Public votes can be created by everyone" 
ON public.votos_publicos FOR INSERT 
WITH CHECK (true);

-- 5. Grant permissions to anon and authenticated roles
GRANT SELECT, INSERT ON public.public_voters TO anon, authenticated;
GRANT SELECT, INSERT ON public.votos_publicos TO anon, authenticated;
GRANT ALL ON public.public_voters TO service_role;
GRANT ALL ON public.votos_publicos TO service_role;

-- 6. Also check public.votos just in case
ALTER TABLE public.votos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Votos are visible to everyone" ON public.votos;
CREATE POLICY "Votos are visible to everyone" ON public.votos FOR SELECT USING (true);
GRANT SELECT ON public.votos TO anon, authenticated;

-- Confirmation query
SELECT table_name, policyname, action, roles 
FROM pg_policies 
WHERE schemaname = 'public' 
AND table_name IN ('public_voters', 'votos_publicos', 'votos');
