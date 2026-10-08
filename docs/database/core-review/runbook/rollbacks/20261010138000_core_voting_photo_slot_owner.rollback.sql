-- Rollback of 20261010138000 (voting photo slot owner). Run as postgres, in one transaction.
-- Data: nothing is deleted (slot claims stay). Effect: any session holding the match code can
-- again take any guest slot and replace that guest's photo.
CREATE OR REPLACE FUNCTION public.bind_voting_photo_slot(p_match_id bigint, p_guest_session_id text, p_player_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bound bigint;
BEGIN
  INSERT INTO public.voting_photo_slot_claims (match_id, guest_session_id, player_id)
  VALUES (p_match_id, p_guest_session_id, p_player_id)
  ON CONFLICT (match_id, guest_session_id) DO NOTHING;

  SELECT player_id INTO v_bound
  FROM public.voting_photo_slot_claims
  WHERE match_id = p_match_id AND guest_session_id = p_guest_session_id;

  RETURN v_bound;
END;
$function$;

revoke all on function public.bind_voting_photo_slot(bigint, text, bigint) from public, anon, authenticated;
grant execute on function public.bind_voting_photo_slot(bigint, text, bigint) to service_role;
drop index if exists public.voting_photo_slot_claims_match_player_idx;
delete from supabase_migrations.schema_migrations where version = '20261010138000';
