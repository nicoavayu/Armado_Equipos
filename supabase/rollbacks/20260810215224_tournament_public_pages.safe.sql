-- Safe rollback for the public tournament page surface.
--
-- Publication history and stable slugs are preserved. All pages are first
-- unpublished, then every client/service entry point is revoked. This is
-- intentionally fail-closed and can be rolled forward without losing links.

BEGIN;

LOCK TABLE public.tournament_public_pages IN SHARE ROW EXCLUSIVE MODE;

UPDATE public.tournament_public_pages
SET status = 'unpublished',
    unpublished_by = COALESCE(unpublished_by, published_by),
    unpublished_at = COALESCE(unpublished_at, now()),
    updated_at = now()
WHERE status = 'published';

REVOKE ALL ON FUNCTION public.get_public_tournament_page(text, text)
  FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_tournament_public_page_settings(uuid, uuid)
  FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_tournament_public_page_published(uuid, uuid, boolean)
  FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.tournament_public_pages
  FROM anon, authenticated;

COMMIT;
