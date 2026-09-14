# Resolución del historial 1–48

Trazabilidad calculada por introspección antes/después de cada fuente. Las tablas de laboratorio Core existían antes del paso 1, por lo que no se confunden con tablas creadas por Torneos. `history-transitions.json` registra 1.402 eventos de creación/cambio/remoción con hashes de objeto y fuente. Un cambio de nombre aparece como remoción + creación, no implica perder sus datos.

## Renombres resueltos

- Paso 34: `tournament_entitlement_plans` → `tournament_legacy_subscription_plans`.
- Paso 34: `tournament_organization_subscriptions` → `tournament_legacy_organization_subscriptions`.
- Se conservan ambas tablas con su nombre final para compatibilidad/auditoría. No se reinstalan nombres antiguos ni el gate `first_free` como autoridad comercial.

## Objetos retirados o sustituidos

- Paso 31: `functions:.public.complete_tournament_media_simple_upload(p_actor_user_id uuid, p_session_id uuid, p_token text, p_detected_mime text, p_byte_size bigint, p_width integer, p_height integer, p_checksum_sha256 text)`. Fuente: `supabase/migrations/20260820120000_tournament_media_publication_is_processing_aware.sql`.
- Paso 34: `indexes:tournament_entitlement_plans.tournament_entitlement_plans_pkey()`. Fuente: `supabase/migrations/20260821213918_plans_entitlements_foundation_v2.sql`.
- Paso 34: `indexes:tournament_organization_subscriptions.tournament_organization_subscriptions_effective_idx()`. Fuente: `supabase/migrations/20260821213918_plans_entitlements_foundation_v2.sql`.
- Paso 34: `indexes:tournament_organization_subscriptions.tournament_organization_subscriptions_one_per_org()`. Fuente: `supabase/migrations/20260821213918_plans_entitlements_foundation_v2.sql`.
- Paso 34: `indexes:tournament_organization_subscriptions.tournament_organization_subscriptions_pkey()`. Fuente: `supabase/migrations/20260821213918_plans_entitlements_foundation_v2.sql`.
- Paso 34: `tables:.tournament_entitlement_plans()`. Fuente: `supabase/migrations/20260821213918_plans_entitlements_foundation_v2.sql`.
- Paso 34: `tables:.tournament_organization_subscriptions()`. Fuente: `supabase/migrations/20260821213918_plans_entitlements_foundation_v2.sql`.
- Paso 34: `triggers:tournament_entitlement_plans.tournament_entitlement_plans_touch()`. Fuente: `supabase/migrations/20260821213918_plans_entitlements_foundation_v2.sql`.
- Paso 34: `triggers:tournament_media_upload_sessions.tournament_media_upload_sessions_matchday_limit()`. Fuente: `supabase/migrations/20260821213918_plans_entitlements_foundation_v2.sql`.
- Paso 34: `triggers:tournament_organization_subscriptions.tournament_organization_subscriptions_touch()`. Fuente: `supabase/migrations/20260821213918_plans_entitlements_foundation_v2.sql`.
- Paso 40: `indexes:tournament_purchases.tournament_purchases_open_product_unique()`. Fuente: `docs/operations/production-upgrade-proposals/20260903213454_production_season_optional_legacy_purchase_revoke.sql`.
- Paso 40: `triggers:tournaments.tournaments_assign_first_free_plan()`. Fuente: `docs/operations/production-upgrade-proposals/20260903213454_production_season_optional_legacy_purchase_revoke.sql`.
- Paso 41: `policies:tournament_categories.tournament_categories_select_capability()`. Fuente: `supabase/migrations/20260828163328_tournament_season_member_scope.sql`.
- Paso 41: `policies:tournament_seasons.tournament_seasons_select_capability()`. Fuente: `supabase/migrations/20260828163328_tournament_season_member_scope.sql`.
- Paso 41: `policies:tournaments.tournaments_select_capability()`. Fuente: `supabase/migrations/20260828163328_tournament_season_member_scope.sql`.
- Paso 46: `indexes:tournament_media_upload_sessions.tournament_media_upload_sessions_request_unique()`. Fuente: `supabase/migrations/20260831163520_fix_tournament_media_session_reuse.sql`.
- Paso 47: `functions:.public.authorize_tournament_social_export(p_organization_id uuid, p_tournament_id uuid, p_piece text, p_include_arma2_branding boolean)`. Fuente: `supabase/migrations/20260901120000_social_studio_theme_export_contract.sql`.

La firma eliminada de `complete_tournament_media_simple_upload` cambia sus nombres de parámetros; el catálogo final conserva la firma efectiva. `authorize_tournament_social_export` conserva la firma final ampliada. Los índices/trigger de tablas renombradas se registran bajo el nombre final. Las políticas de lectura de temporadas, torneos y categorías del paso 41 son reemplazadas por las de scope por temporada.

## Revisiones que no sobreviven en la instalación

- CREATE OR REPLACE de funciones, ALTER de columnas/constraints, grants transitorios y reemplazos de políticas se resuelven en sus definiciones finales.
- Se excluyen el ledger Core, receipts de promoción, `local_existing_functions`, hooks operacionales y el schema `lab_reference`.
- Los grants finales incluyen la revocación de defaults de cada nueva función que los ejecutables certificados aplicaban desde el paso 12. 48/48 hashes de esos ejecutables verificados; no se ejecutaron sus operadores.
- El baseline no contiene las cuatro tablas Core de referencia ni el helper Core `team_user_is_admin_or_owner`.
- Las funciones antiguas aún existentes en el catálogo se conservan, aunque algunas sean internas/legacy. No se presume obsolescencia sólo por el nombre; su retiro requiere comprobar consumidores y autorización.

## Conservados

Los 103 nombres de tablas finales y las definiciones de 358 funciones históricas están en INVENTORY.md. 354 funciones conservan definición/ACL tras normalizar identidad; cuatro tienen diferencias explícitas de boundary y bloquean equivalencia funcional completa.
