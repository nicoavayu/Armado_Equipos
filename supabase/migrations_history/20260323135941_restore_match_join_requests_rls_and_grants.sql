BEGIN;

ALTER TABLE public.match_join_requests ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON TABLE public.match_join_requests TO authenticated;

DO $$
DECLARE
  v_sequence_name text;
BEGIN
  SELECT pg_get_serial_sequence('public.match_join_requests', 'id')
  INTO v_sequence_name;

  IF v_sequence_name IS NOT NULL THEN
    EXECUTE format(
      'GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated',
      v_sequence_name
    );
  END IF;
END
$$;

DROP POLICY IF EXISTS "user can request join" ON public.match_join_requests;
CREATE POLICY "user can request join"
ON public.match_join_requests
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user can read own requests" ON public.match_join_requests;
CREATE POLICY "user can read own requests"
ON public.match_join_requests
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "admin can read match requests" ON public.match_join_requests;
CREATE POLICY "admin can read match requests"
ON public.match_join_requests
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.partidos p
    WHERE p.id = match_join_requests.match_id
      AND p.creado_por = auth.uid()
  )
);

DROP POLICY IF EXISTS "admin can update match requests" ON public.match_join_requests;
CREATE POLICY "admin can update match requests"
ON public.match_join_requests
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.partidos p
    WHERE p.id = match_join_requests.match_id
      AND p.creado_por = auth.uid()
  )
)
WITH CHECK (status IN ('approved', 'rejected'));

COMMIT;
