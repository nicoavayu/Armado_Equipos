-- INACTIVE STORAGE CONTRACT: not a migration; not executed in Phase 2.
-- Requires real Supabase Storage schema and an explicitly scoped future local certification.
CREATE POLICY tournament_media_service_insert ON storage.objects FOR INSERT TO service_role WITH CHECK (((bucket_id = 'tournament-media'::text) AND (name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}(-(?:thumbnail|grid|detail|original))?\.(jpg|png|webp)$'::text)));
CREATE POLICY tournament_media_service_read ON storage.objects FOR SELECT TO service_role USING ((bucket_id = 'tournament-media'::text));
CREATE POLICY tournament_media_service_update ON storage.objects FOR UPDATE TO service_role USING (false) WITH CHECK (false);
CREATE POLICY tournament_media_service_delete ON storage.objects FOR DELETE TO service_role USING (false);
CREATE POLICY tournament_branding_select_authorized ON storage.objects FOR SELECT TO authenticated USING (((bucket_id = 'tournament-branding'::text) AND public.can_write_tournament_branding_object(name)));
CREATE POLICY tournament_branding_insert_authorized ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'tournament-branding'::text) AND public.can_write_tournament_branding_object(name)));
CREATE POLICY tournament_branding_update_denied ON storage.objects FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY tournament_branding_delete_authorized ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'tournament-branding'::text) AND public.can_write_tournament_branding_object(name)));
