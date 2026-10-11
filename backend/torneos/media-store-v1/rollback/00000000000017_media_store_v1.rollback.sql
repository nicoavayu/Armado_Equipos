-- MEDIA-STORE-V1 rollback: removes exactly what 00000000000017 added. No data, policy, bucket or other grant changes.
-- Run only with BRANDING and MEDIA off on the gateway (otherwise the media store answers 503 for every operation, which
-- is fail-closed but visible). Buckets stay private.
BEGIN;
DO $pre$
BEGIN
  IF to_regprocedure('public.authorize_tournament_storage_objects(text,text,text[])') IS NULL
    OR to_regprocedure('private.tournament_branding_object_in_use(text)') IS NULL THEN
    RAISE EXCEPTION 'TORNEOS_MEDIA_STORE_V1_ROLLBACK_PRECONDITION_FAILED: 00000000000017 is not applied';
  END IF;
END
$pre$;
drop function public.authorize_tournament_storage_objects(text, text, text[]);
drop function private.tournament_branding_object_in_use(text);
DO $post$
BEGIN
  IF to_regprocedure('public.authorize_tournament_storage_objects(text,text,text[])') IS NOT NULL
    OR to_regprocedure('private.tournament_branding_object_in_use(text)') IS NOT NULL
    OR (select public from storage.buckets where id = 'tournament-branding') IS DISTINCT FROM false
    OR (select public from storage.buckets where id = 'tournament-media') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TORNEOS_MEDIA_STORE_V1_ROLLBACK_POSTCONDITION_FAILED';
  END IF;
END
$post$;
COMMIT;
