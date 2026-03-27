BEGIN;

CREATE OR REPLACE FUNCTION public.is_public_voting_open(p_partido_id bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.type IN ('call_to_vote', 'pre_match_vote')
      AND (
        n.partido_id = p_partido_id
        OR COALESCE(n.data ->> 'match_id', '') = p_partido_id::text
        OR COALESCE(n.data ->> 'matchId', '') = p_partido_id::text
        OR COALESCE(n.data ->> 'partido_id', '') = p_partido_id::text
        OR COALESCE(n.data ->> 'partidoId', '') = p_partido_id::text
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_public_voting_open(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_public_voting_open(bigint) TO anon, authenticated, service_role;

COMMIT;
