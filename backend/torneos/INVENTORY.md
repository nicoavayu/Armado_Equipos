# Inventario final Torneos — Phase 2

Catálogo derivado de las 48 fuentes verificadas y catálogo instalado del baseline candidato. Los nombres históricos de columnas `user_id`, `arma2_user_id`, `created_by`, etc. contienen UUID **locales** de `torneos_identity.id`; `core_user_id` es la correspondencia externa. No se migraron datos Core.

Los JSON en `evidence/` contienen definiciones completas. Este inventario presenta cada objeto final y sus permisos.

## Schemas, tipos, extensiones y vistas

- Baseline: `public`, `private`, `extensions`; Postgres aporta `pg_catalog` e `information_schema`.
- Extensiones de la DB candidata: `plpgsql`, `pgcrypto` (en `extensions`). `plpgsql_check` se instaló sólo dentro de una transacción de diagnóstico y se revirtió.
- No hay enums de usuario ni vistas/materialized views finales. Tipos compuestos de fila corresponden a las tablas.
- Referencia: `auth` y cuatro tablas Core son sustitutos estructurales vacíos, nunca se incluyen en el baseline. `storage` en referencia modela sólo las columnas utilizadas; no es una instalación completa del servicio Storage.

## Tablas finales: 103 históricas + identidad local

### torneos_identity

RLS: True; FORCE RLS: True. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'torneos_identity_writer=ar/supabase_admin', 'authenticated=r/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| core_user_id | uuid | True | None |
| created_at | timestamp with time zone | True | now() |

Constraints:

- `torneos_identity_core_user_id_key`: `UNIQUE (core_user_id)`
- `torneos_identity_pkey`: `PRIMARY KEY (id)`

### tournament_announcement_audiences

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'anon=r/supabase_admin', 'authenticated=arwd/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| announcement_id | uuid | True | None |
| audience_type | text | True | None |
| category_id | uuid | False | None |
| team_entry_id | uuid | False | None |
| match_id | uuid | False | None |
| specific_user_id | uuid | False | None |
| created_by | uuid | True | None |
| created_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_announcement_audiences_announcement_fk`: `FOREIGN KEY (organization_id, announcement_id) REFERENCES tournament_announcements(organization_id, id) ON DELETE RESTRICT`
- `tournament_announcement_audiences_category_fk`: `FOREIGN KEY (organization_id, category_id) REFERENCES tournament_categories(organization_id, id) ON DELETE RESTRICT`
- `tournament_announcement_audiences_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_announcement_audiences_match_fk`: `FOREIGN KEY (organization_id, match_id) REFERENCES tournament_matches(organization_id, id) ON DELETE RESTRICT`
- `tournament_announcement_audiences_org_id_unique`: `UNIQUE (organization_id, id)`
- `tournament_announcement_audiences_pkey`: `PRIMARY KEY (id)`
- `tournament_announcement_audiences_shape_check`: `CHECK ((((audience_type = 'category'::text) AND (category_id IS NOT NULL) AND (team_entry_id IS NULL) AND (match_id IS NULL) AND (specific_user_id IS NULL)) OR ((audience_type = 'team'::text) AND (team_entry_id IS NOT NULL) AND (category_id IS NULL) AND (match_id IS NULL) AND (specific_user_id IS NULL)) OR ((audience_type = ANY (ARRAY['match'::text, 'home_team'::text, 'away_team'::text])) AND (match_id IS NOT NULL) AND (category_id IS NULL) AND (team_entry_id IS NULL) AND (specific_user_id IS NULL)) OR ((audience_type = 'specific_user'::text) AND (specific_user_id IS NOT NULL) AND (category_id IS NULL) AND (team_entry_id IS NULL) AND (match_id IS NULL)) OR ((audience_type = ANY (ARRAY['organization'::text, 'tournament'::text, 'captains'::text, 'players'::text])) AND (category_id IS NULL) AND (team_entry_id IS NULL) AND (match_id IS NULL) AND (specific_user_id IS NULL))))`
- `tournament_announcement_audiences_specific_user_id_fkey`: `FOREIGN KEY (specific_user_id) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_announcement_audiences_team_fk`: `FOREIGN KEY (organization_id, team_entry_id) REFERENCES tournament_team_entries(organization_id, id) ON DELETE RESTRICT`
- `tournament_announcement_audiences_type_check`: `CHECK ((audience_type = ANY (ARRAY['organization'::text, 'tournament'::text, 'category'::text, 'team'::text, 'captains'::text, 'players'::text, 'match'::text, 'home_team'::text, 'away_team'::text, 'specific_user'::text])))`
- `tournament_announcement_audiences_unique`: `UNIQUE NULLS NOT DISTINCT (announcement_id, audience_type, category_id, team_entry_id, match_id, specific_user_id)`

### tournament_announcement_deliveries

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'anon=r/supabase_admin', 'authenticated=arwd/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| announcement_id | uuid | True | None |
| recipient_user_id | uuid | True | None |
| recipient_relation_type | text | True | None |
| status | text | True | 'available'::text |
| created_at | timestamp with time zone | True | now() |
| delivered_at | timestamp with time zone | True | now() |
| read_at | timestamp with time zone | False | None |
| confirmed_at | timestamp with time zone | False | None |
| archived_at | timestamp with time zone | False | None |
| revoked_at | timestamp with time zone | False | None |

Constraints:

- `tournament_announcement_deliveries_announcement_fk`: `FOREIGN KEY (organization_id, announcement_id) REFERENCES tournament_announcements(organization_id, id) ON DELETE RESTRICT`
- `tournament_announcement_deliveries_org_id_unique`: `UNIQUE (organization_id, id)`
- `tournament_announcement_deliveries_pkey`: `PRIMARY KEY (id)`
- `tournament_announcement_deliveries_recipient_unique`: `UNIQUE (announcement_id, recipient_user_id)`
- `tournament_announcement_deliveries_recipient_user_id_fkey`: `FOREIGN KEY (recipient_user_id) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_announcement_deliveries_relation_check`: `CHECK ((recipient_relation_type = ANY (ARRAY['organization_member'::text, 'player'::text, 'captain'::text, 'delegate'::text, 'match_participant'::text, 'specific'::text])))`
- `tournament_announcement_deliveries_state_check`: `CHECK ((((read_at IS NULL) OR (status = ANY (ARRAY['read'::text, 'confirmed'::text, 'archived'::text, 'revoked'::text]))) AND ((confirmed_at IS NULL) OR (status = ANY (ARRAY['confirmed'::text, 'archived'::text, 'revoked'::text]))) AND ((archived_at IS NULL) OR (status = 'archived'::text)) AND ((revoked_at IS NULL) OR (status = 'revoked'::text))))`
- `tournament_announcement_deliveries_status_check`: `CHECK ((status = ANY (ARRAY['available'::text, 'read'::text, 'confirmed'::text, 'archived'::text, 'revoked'::text])))`

### tournament_announcement_links

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'anon=r/supabase_admin', 'authenticated=arwd/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| announcement_id | uuid | True | None |
| link_type | text | True | None |
| resource_id | uuid | False | None |
| external_url | text | False | None |
| label | text | True | None |
| sort_order | integer | True | 0 |
| created_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_announcement_links_announcement_fk`: `FOREIGN KEY (organization_id, announcement_id) REFERENCES tournament_announcements(organization_id, id) ON DELETE RESTRICT`
- `tournament_announcement_links_count_unique`: `UNIQUE (announcement_id, sort_order)`
- `tournament_announcement_links_label_check`: `CHECK (((label = btrim(label)) AND ((char_length(label) >= 2) AND (char_length(label) <= 80))))`
- `tournament_announcement_links_org_id_unique`: `UNIQUE (organization_id, id)`
- `tournament_announcement_links_pkey`: `PRIMARY KEY (id)`
- `tournament_announcement_links_shape_check`: `CHECK ((((link_type = 'external'::text) AND (resource_id IS NULL) AND (external_url ~ '^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:/[^[:space:]]*)?$'::text)) OR ((link_type <> 'external'::text) AND (resource_id IS NOT NULL) AND (external_url IS NULL))))`
- `tournament_announcement_links_sort_check`: `CHECK (((sort_order >= 0) AND (sort_order <= 20)))`
- `tournament_announcement_links_type_check`: `CHECK ((link_type = ANY (ARRAY['tournament'::text, 'category'::text, 'match'::text, 'round'::text, 'standings'::text, 'discipline'::text, 'document'::text, 'external'::text])))`

### tournament_announcements

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'anon=r/supabase_admin', 'authenticated=arwd/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| season_id | uuid | True | None |
| tournament_id | uuid | True | None |
| category_id | uuid | False | None |
| author_user_id | uuid | True | None |
| status | text | True | 'draft'::text |
| announcement_type | text | True | None |
| title | text | True | None |
| summary | text | True | None |
| body | text | True | None |
| priority | text | True | 'normal'::text |
| acknowledgement_mode | text | True | 'none'::text |
| published_at | timestamp with time zone | False | None |
| scheduled_for | timestamp with time zone | False | None |
| archived_at | timestamp with time zone | False | None |
| revoked_at | timestamp with time zone | False | None |
| revoked_reason | text | False | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |
| version | integer | True | 1 |
| supersedes_id | uuid | False | None |
| correction_reason | text | False | None |
| published_recipient_count | integer | False | None |
| audience_snapshot | jsonb | False | None |
| idempotency_key | uuid | True | None |

Constraints:

- `tournament_announcements_ack_check`: `CHECK ((acknowledgement_mode = ANY (ARRAY['none'::text, 'read'::text, 'explicit'::text])))`
- `tournament_announcements_audience_snapshot_check`: `CHECK (((audience_snapshot IS NULL) OR ((jsonb_typeof(audience_snapshot) = 'object'::text) AND (pg_column_size(audience_snapshot) <= 16384))))`
- `tournament_announcements_author_user_id_fkey`: `FOREIGN KEY (author_user_id) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_announcements_category_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id) REFERENCES tournament_categories(organization_id, tournament_id, id) ON DELETE RESTRICT`
- `tournament_announcements_content_check`: `CHECK (((title = btrim(title)) AND ((char_length(title) >= 4) AND (char_length(title) <= 120)) AND (summary = btrim(summary)) AND ((char_length(summary) >= 4) AND (char_length(summary) <= 280)) AND (body = btrim(body)) AND ((char_length(body) >= 4) AND (char_length(body) <= 12000)) AND (title !~ '[<>]'::text) AND (summary !~ '[<>]'::text) AND (body !~ '[<>]'::text)))`
- `tournament_announcements_idempotency_unique`: `UNIQUE (organization_id, author_user_id, idempotency_key)`
- `tournament_announcements_org_id_unique`: `UNIQUE (organization_id, id)`
- `tournament_announcements_org_tournament_id_unique`: `UNIQUE (organization_id, tournament_id, id)`
- `tournament_announcements_pkey`: `PRIMARY KEY (id)`
- `tournament_announcements_priority_check`: `CHECK ((priority = ANY (ARRAY['normal'::text, 'important'::text, 'urgent'::text])))`
- `tournament_announcements_recipient_count_check`: `CHECK (((published_recipient_count IS NULL) OR ((published_recipient_count >= 0) AND (published_recipient_count <= 5000))))`
- `tournament_announcements_schedule_check`: `CHECK ((((status <> 'scheduled'::text) OR (scheduled_for IS NOT NULL)) AND ((published_at IS NULL) OR (status = ANY (ARRAY['published'::text, 'superseded'::text, 'archived'::text, 'revoked'::text]))) AND ((archived_at IS NULL) OR (status = 'archived'::text)) AND ((revoked_at IS NULL) OR (status = 'revoked'::text)) AND ((revoked_reason IS NULL) OR ((char_length(btrim(revoked_reason)) >= 4) AND (char_length(btrim(revoked_reason)) <= 500)))))`
- `tournament_announcements_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'published'::text, 'superseded'::text, 'archived'::text, 'cancelled'::text, 'revoked'::text])))`
- `tournament_announcements_supersedes_fk`: `FOREIGN KEY (supersedes_id) REFERENCES tournament_announcements(id) ON DELETE RESTRICT`
- `tournament_announcements_tournament_fk`: `FOREIGN KEY (organization_id, tournament_id, season_id) REFERENCES tournaments(organization_id, id, season_id) ON DELETE RESTRICT`
- `tournament_announcements_type_check`: `CHECK ((announcement_type = ANY (ARRAY['general'::text, 'registration'::text, 'schedule_change'::text, 'match_update'::text, 'discipline'::text, 'regulation'::text, 'administrative'::text, 'emergency'::text])))`
- `tournament_announcements_version_check`: `CHECK ((version > 0))`

### tournament_audit_log

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | bigint | True | None |
| organization_id | uuid | True | None |
| actor_user_id | uuid | False | None |
| actor_type | text | True | None |
| action | text | True | None |
| resource_type | text | True | None |
| resource_id | uuid | True | None |
| team_entry_id | uuid | False | None |
| tournament_id | uuid | False | None |
| metadata | jsonb | True | '{}'::jsonb |
| created_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_audit_log_action_check`: `CHECK ((action ~ '^[a-z][a-z0-9_.]{2,80}$'::text))`
- `tournament_audit_log_actor_check`: `CHECK ((actor_type = ANY (ARRAY['user'::text, 'system'::text])))`
- `tournament_audit_log_actor_user_id_fkey`: `FOREIGN KEY (actor_user_id) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_audit_log_entry_context_check`: `CHECK (((team_entry_id IS NULL) OR (tournament_id IS NOT NULL)))`
- `tournament_audit_log_entry_fk`: `FOREIGN KEY (organization_id, tournament_id, team_entry_id) REFERENCES tournament_team_entries(organization_id, tournament_id, id) ON DELETE RESTRICT`
- `tournament_audit_log_metadata_check`: `CHECK (((jsonb_typeof(metadata) = 'object'::text) AND (pg_column_size(metadata) <= 8192)))`
- `tournament_audit_log_organization_id_fkey`: `FOREIGN KEY (organization_id) REFERENCES tournament_organizations(id) ON DELETE RESTRICT`
- `tournament_audit_log_pkey`: `PRIMARY KEY (id)`
- `tournament_audit_log_resource_check`: `CHECK ((resource_type ~ '^[a-z][a-z0-9_]{2,60}$'::text))`
- `tournament_audit_log_tournament_fk`: `FOREIGN KEY (organization_id, tournament_id) REFERENCES tournaments(organization_id, id) ON DELETE RESTRICT`

### tournament_categories

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| name | text | True | None |
| slug | text | True | None |
| description | text | False | None |
| status | text | True | 'active'::text |
| sort_order | integer | True | 0 |
| min_age | smallint | False | None |
| max_age | smallint | False | None |
| gender_category | text | False | None |
| sport_modality | text | False | None |
| team_size | smallint | False | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |
| archived_at | timestamp with time zone | False | None |

Constraints:

- `tournament_categories_age_check`: `CHECK ((((min_age IS NULL) OR ((min_age >= 5) AND (min_age <= 99))) AND ((max_age IS NULL) OR ((max_age >= 5) AND (max_age <= 99))) AND ((min_age IS NULL) OR (max_age IS NULL) OR (max_age >= min_age))))`
- `tournament_categories_archive_state_check`: `CHECK ((((status = 'archived'::text) AND (archived_at IS NOT NULL)) OR ((status = 'active'::text) AND (archived_at IS NULL))))`
- `tournament_categories_description_check`: `CHECK (((description IS NULL) OR (char_length(description) <= 600)))`
- `tournament_categories_gender_check`: `CHECK (((gender_category IS NULL) OR (gender_category = ANY (ARRAY['male'::text, 'female'::text, 'mixed'::text, 'open'::text]))))`
- `tournament_categories_name_check`: `CHECK (((name = btrim(name)) AND ((char_length(name) >= 2) AND (char_length(name) <= 80))))`
- `tournament_categories_org_id_unique`: `UNIQUE (organization_id, id)`
- `tournament_categories_org_tournament_id_unique`: `UNIQUE (organization_id, tournament_id, id)`
- `tournament_categories_pkey`: `PRIMARY KEY (id)`
- `tournament_categories_slug_check`: `CHECK (((slug ~ '^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])$'::text) AND ((char_length(slug) >= 2) AND (char_length(slug) <= 48))))`
- `tournament_categories_slug_unique`: `UNIQUE (tournament_id, slug)`
- `tournament_categories_sport_modality_fkey`: `FOREIGN KEY (sport_modality) REFERENCES tournament_sport_modalities(code) ON DELETE RESTRICT`
- `tournament_categories_status_check`: `CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))`
- `tournament_categories_team_size_check`: `CHECK (((team_size IS NULL) OR ((team_size >= 5) AND (team_size <= 11))))`
- `tournament_categories_tournament_fk`: `FOREIGN KEY (organization_id, tournament_id) REFERENCES tournaments(organization_id, id) ON DELETE RESTRICT`

### tournament_commercial_offers

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'service_role=r/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| product_code | text | True | None |
| offer_code | text | True | None |
| offer_version | integer | True | None |
| offer_label | text | True | None |
| currency | text | True | None |
| list_amount | integer | True | None |
| amount | integer | True | None |
| valid_from | timestamp with time zone | True | now() |
| valid_until | timestamp with time zone | False | None |
| availability | text | True | 'available'::text |
| created_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_commercial_offers_amount_check`: `CHECK (((list_amount > 0) AND (amount > 0) AND (amount <= list_amount)))`
- `tournament_commercial_offers_availability_check`: `CHECK ((availability = ANY (ARRAY['available'::text, 'coming_soon'::text, 'unavailable'::text])))`
- `tournament_commercial_offers_code_check`: `CHECK ((offer_code ~ '^[a-z][a-z0-9_]{2,63}$'::text))`
- `tournament_commercial_offers_currency_check`: `CHECK ((currency = 'ARS'::text))`
- `tournament_commercial_offers_label_check`: `CHECK (((offer_label = btrim(offer_label)) AND ((char_length(offer_label) >= 3) AND (char_length(offer_label) <= 100))))`
- `tournament_commercial_offers_pkey`: `PRIMARY KEY (product_code, offer_code, offer_version)`
- `tournament_commercial_offers_product_code_fkey`: `FOREIGN KEY (product_code) REFERENCES tournament_commercial_products(product_code) ON DELETE RESTRICT`
- `tournament_commercial_offers_validity_check`: `CHECK (((valid_until IS NULL) OR (valid_until > valid_from)))`
- `tournament_commercial_offers_version_check`: `CHECK ((offer_version > 0))`

### tournament_commercial_products

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'service_role=r/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| product_code | text | True | None |
| product_name | text | True | None |
| plan_code | text | True | None |
| scope | text | True | None |
| billing_model | text | True | None |
| status | text | True | 'active'::text |
| public_capabilities | jsonb | True | '[]'::jsonb |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_commercial_products_billing_check`: `CHECK ((billing_model = 'one_time'::text))`
- `tournament_commercial_products_capabilities_check`: `CHECK (((jsonb_typeof(public_capabilities) = 'array'::text) AND (pg_column_size(public_capabilities) <= 8192)))`
- `tournament_commercial_products_code_check`: `CHECK ((product_code ~ '^[a-z][a-z0-9_]{2,63}$'::text))`
- `tournament_commercial_products_name_check`: `CHECK (((product_name = btrim(product_name)) AND ((char_length(product_name) >= 3) AND (char_length(product_name) <= 100))))`
- `tournament_commercial_products_pkey`: `PRIMARY KEY (product_code)`
- `tournament_commercial_products_plan_code_fkey`: `FOREIGN KEY (plan_code) REFERENCES tournament_plan_catalog(plan_code)`
- `tournament_commercial_products_scope_check`: `CHECK ((scope = 'season'::text))`
- `tournament_commercial_products_status_check`: `CHECK ((status = ANY (ARRAY['active'::text, 'retired'::text])))`

### tournament_competition_formats

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| code | text | True | None |
| name | text | True | None |
| description | text | True | None |

Constraints:

- `tournament_competition_formats_code_check`: `CHECK ((code = ANY (ARRAY['league'::text, 'knockout'::text, 'groups'::text, 'groups_and_playoffs'::text, 'league_and_playoffs'::text])))`
- `tournament_competition_formats_description_check`: `CHECK (((char_length(description) >= 10) AND (char_length(description) <= 240)))`
- `tournament_competition_formats_name_key`: `UNIQUE (name)`
- `tournament_competition_formats_pkey`: `PRIMARY KEY (code)`

### tournament_competition_participants

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| season_id | uuid | True | None |
| tournament_id | uuid | True | None |
| category_id | uuid | True | None |
| participant_set_id | uuid | True | None |
| team_entry_id | uuid | True | None |
| seed_number | integer | False | None |
| pot_number | integer | False | None |
| status | text | True | 'active'::text |
| snapshot_name | text | True | None |
| snapshot_short_name | text | False | None |
| snapshot_shield_path | text | False | None |
| snapshot_primary_color | text | False | None |
| snapshot_secondary_color | text | False | None |
| frozen_at | timestamp with time zone | True | None |
| created_at | timestamp with time zone | True | now() |
| withdrawn_at | timestamp with time zone | False | None |
| withdrawn_by | uuid | False | None |
| withdrawal_reason_code | text | False | None |
| withdrawal_reason_text | text | False | None |

Constraints:

- `tournament_competition_participants_colors_check`: `CHECK ((((snapshot_primary_color IS NULL) OR (snapshot_primary_color ~ '^#[0-9A-Fa-f]{6}$'::text)) AND ((snapshot_secondary_color IS NULL) OR (snapshot_secondary_color ~ '^#[0-9A-Fa-f]{6}$'::text))))`
- `tournament_competition_participants_entry_fk`: `FOREIGN KEY (organization_id, tournament_id, team_entry_id) REFERENCES tournament_team_entries(organization_id, tournament_id, id) ON DELETE RESTRICT`
- `tournament_competition_participants_entry_unique`: `UNIQUE (participant_set_id, team_entry_id)`
- `tournament_competition_participants_name_check`: `CHECK (((snapshot_name = btrim(snapshot_name)) AND ((char_length(snapshot_name) >= 2) AND (char_length(snapshot_name) <= 100))))`
- `tournament_competition_participants_pkey`: `PRIMARY KEY (id)`
- `tournament_competition_participants_pot_check`: `CHECK (((pot_number IS NULL) OR (pot_number > 0)))`
- `tournament_competition_participants_scope_unique`: `UNIQUE (organization_id, tournament_id, category_id, participant_set_id, id)`
- `tournament_competition_participants_seed_check`: `CHECK (((seed_number IS NULL) OR (seed_number > 0)))`
- `tournament_competition_participants_seed_unique`: `UNIQUE (participant_set_id, seed_number)`
- `tournament_competition_participants_set_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, participant_set_id) REFERENCES tournament_participant_sets(organization_id, tournament_id, category_id, id) ON DELETE RESTRICT`
- `tournament_competition_participants_short_name_check`: `CHECK (((snapshot_short_name IS NULL) OR ((char_length(btrim(snapshot_short_name)) >= 2) AND (char_length(btrim(snapshot_short_name)) <= 20))))`
- `tournament_competition_participants_status_check`: `CHECK ((status = ANY (ARRAY['active'::text, 'withdrawn'::text, 'archived'::text])))`
- `tournament_competition_participants_withdrawal_check`: `CHECK ((((withdrawn_at IS NULL) AND (withdrawn_by IS NULL) AND (withdrawal_reason_code IS NULL) AND (withdrawal_reason_text IS NULL)) OR ((status = 'withdrawn'::text) AND (withdrawn_at IS NOT NULL) AND (withdrawn_by IS NOT NULL) AND (withdrawal_reason_code = ANY (ARRAY['voluntary_resignation'::text, 'sanction_exclusion'::text, 'regulatory_breach'::text, 'other'::text])) AND ((withdrawal_reason_code <> 'other'::text) OR (char_length(btrim(COALESCE(withdrawal_reason_text, ''::text))) >= 3)) AND ((withdrawal_reason_text IS NULL) OR (char_length(withdrawal_reason_text) <= 2000)))))`
- `tournament_competition_participants_withdrawn_by_fkey`: `FOREIGN KEY (withdrawn_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`

### tournament_courts

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| venue_id | uuid | True | None |
| name | text | True | None |
| sport_modality | text | True | None |
| status | text | True | 'active'::text |
| notes | text | False | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |
| archived_at | timestamp with time zone | False | None |

Constraints:

- `tournament_courts_archive_check`: `CHECK ((((status = 'archived'::text) AND (archived_at IS NOT NULL)) OR ((status = 'active'::text) AND (archived_at IS NULL))))`
- `tournament_courts_name_check`: `CHECK (((name = btrim(name)) AND ((char_length(name) >= 1) AND (char_length(name) <= 100))))`
- `tournament_courts_notes_check`: `CHECK (((notes IS NULL) OR (char_length(notes) <= 1000)))`
- `tournament_courts_pkey`: `PRIMARY KEY (id)`
- `tournament_courts_scope_unique`: `UNIQUE (organization_id, id)`
- `tournament_courts_sport_modality_fkey`: `FOREIGN KEY (sport_modality) REFERENCES tournament_sport_modalities(code) ON DELETE RESTRICT`
- `tournament_courts_status_check`: `CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))`
- `tournament_courts_venue_fk`: `FOREIGN KEY (organization_id, venue_id) REFERENCES tournament_venues(organization_id, id) ON DELETE RESTRICT`
- `tournament_courts_venue_name_unique`: `UNIQUE (venue_id, name)`

### tournament_disciplinary_overrides

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| suspension_id | uuid | True | None |
| action | text | True | None |
| previous_state | jsonb | True | None |
| new_state | jsonb | True | None |
| reason | text | True | None |
| actor_user_id | uuid | True | None |
| idempotency_key | uuid | True | None |
| created_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_disciplinary_overrides_action_check`: `CHECK ((action = ANY (ARRAY['reduce'::text, 'revoke'::text, 'add_match'::text])))`
- `tournament_disciplinary_overrides_actor_user_id_fkey`: `FOREIGN KEY (actor_user_id) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_disciplinary_overrides_idempotency_unique`: `UNIQUE (organization_id, actor_user_id, idempotency_key)`
- `tournament_disciplinary_overrides_pkey`: `PRIMARY KEY (id)`
- `tournament_disciplinary_overrides_reason_check`: `CHECK (((reason = btrim(reason)) AND ((char_length(reason) >= 3) AND (char_length(reason) <= 1000))))`
- `tournament_disciplinary_overrides_states_check`: `CHECK (((jsonb_typeof(previous_state) = 'object'::text) AND (jsonb_typeof(new_state) = 'object'::text)))`
- `tournament_disciplinary_overrides_suspension_fk`: `FOREIGN KEY (suspension_id) REFERENCES tournament_player_suspensions(id) ON DELETE RESTRICT`

### tournament_discipline_ledgers

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| revision_id | uuid | True | None |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| category_id | uuid | True | None |
| phase_id | uuid | True | None |
| group_id | uuid | False | None |
| roster_player_id | uuid | True | None |
| team_entry_id | uuid | True | None |
| yellow_cards | integer | True | 0 |
| second_yellows | integer | True | 0 |
| direct_reds | integer | True | 0 |
| fair_play_points | integer | True | 0 |
| automatic_suspensions | integer | True | 0 |

Constraints:

- `tournament_discipline_ledgers_counts_check`: `CHECK (((yellow_cards >= 0) AND (second_yellows >= 0) AND (direct_reds >= 0) AND (fair_play_points >= 0) AND (automatic_suspensions >= 0)))`
- `tournament_discipline_ledgers_pkey`: `PRIMARY KEY (revision_id, roster_player_id)`
- `tournament_discipline_ledgers_player_fk`: `FOREIGN KEY (organization_id, team_entry_id, roster_player_id) REFERENCES tournament_roster_players(organization_id, team_entry_id, id) ON DELETE RESTRICT`
- `tournament_discipline_ledgers_revision_fk`: `FOREIGN KEY (organization_id, revision_id) REFERENCES tournament_standings_revisions(organization_id, id) ON DELETE RESTRICT`

### tournament_discipline_rules

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| tournament_id | uuid | True | None |
| organization_id | uuid | True | None |
| yellows_for_suspension | smallint | True | 5 |
| suspension_matches | smallint | True | 1 |
| direct_red_suggested_matches | smallint | False | None |
| double_yellow_counts_as_red | boolean | True | true |
| reset_yellows_each_stage | boolean | True | false |
| fair_play_enabled | boolean | True | true |
| yellow_fair_play_points | smallint | True | 1 |
| red_fair_play_points | smallint | True | 3 |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_discipline_rules_pkey`: `PRIMARY KEY (tournament_id)`
- `tournament_discipline_rules_tournament_fk`: `FOREIGN KEY (organization_id, tournament_id) REFERENCES tournaments(organization_id, id) ON DELETE RESTRICT`
- `tournament_discipline_rules_values_check`: `CHECK (((yellows_for_suspension >= 1) AND (yellows_for_suspension <= 20) AND ((suspension_matches >= 1) AND (suspension_matches <= 12)) AND ((direct_red_suggested_matches IS NULL) OR ((direct_red_suggested_matches >= 1) AND (direct_red_suggested_matches <= 12))) AND ((yellow_fair_play_points >= 0) AND (yellow_fair_play_points <= 20)) AND ((red_fair_play_points >= 0) AND (red_fair_play_points <= 40))))`

### tournament_document_acknowledgements

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'anon=r/supabase_admin', 'authenticated=arwd/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| document_id | uuid | True | None |
| version_id | uuid | True | None |
| user_id | uuid | True | None |
| status | text | True | None |
| read_at | timestamp with time zone | True | now() |
| confirmed_at | timestamp with time zone | False | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_document_acknowledgements_confirm_check`: `CHECK (((status = 'confirmed'::text) = (confirmed_at IS NOT NULL)))`
- `tournament_document_acknowledgements_document_fk`: `FOREIGN KEY (organization_id, document_id) REFERENCES tournament_documents(organization_id, id) ON DELETE RESTRICT`
- `tournament_document_acknowledgements_org_id_unique`: `UNIQUE (organization_id, id)`
- `tournament_document_acknowledgements_pkey`: `PRIMARY KEY (id)`
- `tournament_document_acknowledgements_status_check`: `CHECK ((status = ANY (ARRAY['read'::text, 'confirmed'::text])))`
- `tournament_document_acknowledgements_unique`: `UNIQUE (version_id, user_id)`
- `tournament_document_acknowledgements_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_document_acknowledgements_version_fk`: `FOREIGN KEY (organization_id, version_id) REFERENCES tournament_document_versions(organization_id, id) ON DELETE RESTRICT`

### tournament_document_versions

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'anon=r/supabase_admin', 'authenticated=arwd/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| document_id | uuid | True | None |
| version | integer | True | None |
| status | text | True | 'draft'::text |
| summary | text | True | None |
| body | text | True | None |
| effective_at | timestamp with time zone | False | None |
| correction_reason | text | False | None |
| created_by | uuid | True | None |
| created_at | timestamp with time zone | True | now() |
| published_by | uuid | False | None |
| published_at | timestamp with time zone | False | None |
| superseded_at | timestamp with time zone | False | None |
| source_version_id | uuid | False | None |

Constraints:

- `tournament_document_versions_content_check`: `CHECK (((version > 0) AND (summary = btrim(summary)) AND ((char_length(summary) >= 4) AND (char_length(summary) <= 280)) AND (body = btrim(body)) AND ((char_length(body) >= 4) AND (char_length(body) <= 20000)) AND (summary !~ '[<>]'::text) AND (body !~ '[<>]'::text) AND ((correction_reason IS NULL) OR ((char_length(btrim(correction_reason)) >= 4) AND (char_length(btrim(correction_reason)) <= 500)))))`
- `tournament_document_versions_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_document_versions_document_fk`: `FOREIGN KEY (organization_id, document_id) REFERENCES tournament_documents(organization_id, id) ON DELETE RESTRICT`
- `tournament_document_versions_number_unique`: `UNIQUE (document_id, version)`
- `tournament_document_versions_org_id_unique`: `UNIQUE (organization_id, id)`
- `tournament_document_versions_pkey`: `PRIMARY KEY (id)`
- `tournament_document_versions_publish_check`: `CHECK ((((status <> ALL (ARRAY['published'::text, 'superseded'::text])) OR (published_at IS NOT NULL)) AND ((status <> 'superseded'::text) OR (superseded_at IS NOT NULL))))`
- `tournament_document_versions_published_by_fkey`: `FOREIGN KEY (published_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_document_versions_source_fk`: `FOREIGN KEY (source_version_id) REFERENCES tournament_document_versions(id) ON DELETE RESTRICT`
- `tournament_document_versions_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'superseded'::text, 'cancelled'::text])))`

### tournament_documents

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'anon=r/supabase_admin', 'authenticated=arwd/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| season_id | uuid | True | None |
| tournament_id | uuid | True | None |
| category_id | uuid | False | None |
| document_type | text | True | None |
| title | text | True | None |
| status | text | True | 'draft'::text |
| active_version_id | uuid | False | None |
| acknowledgement_mode | text | True | 'none'::text |
| created_by | uuid | True | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |
| archived_at | timestamp with time zone | False | None |
| idempotency_key | uuid | True | None |

Constraints:

- `tournament_documents_ack_check`: `CHECK ((acknowledgement_mode = ANY (ARRAY['none'::text, 'read'::text, 'explicit'::text])))`
- `tournament_documents_active_version_fk`: `FOREIGN KEY (active_version_id) REFERENCES tournament_document_versions(id) ON DELETE RESTRICT`
- `tournament_documents_archive_check`: `CHECK (((status = 'archived'::text) = (archived_at IS NOT NULL)))`
- `tournament_documents_category_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id) REFERENCES tournament_categories(organization_id, tournament_id, id) ON DELETE RESTRICT`
- `tournament_documents_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_documents_idempotency_unique`: `UNIQUE (organization_id, created_by, idempotency_key)`
- `tournament_documents_org_id_unique`: `UNIQUE (organization_id, id)`
- `tournament_documents_org_tournament_id_unique`: `UNIQUE (organization_id, tournament_id, id)`
- `tournament_documents_pkey`: `PRIMARY KEY (id)`
- `tournament_documents_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text])))`
- `tournament_documents_title_check`: `CHECK (((title = btrim(title)) AND ((char_length(title) >= 4) AND (char_length(title) <= 120)) AND (title !~ '[<>]'::text)))`
- `tournament_documents_tournament_fk`: `FOREIGN KEY (organization_id, tournament_id, season_id) REFERENCES tournaments(organization_id, id, season_id) ON DELETE RESTRICT`
- `tournament_documents_type_check`: `CHECK ((document_type = ANY (ARRAY['regulation'::text, 'discipline'::text, 'terms'::text, 'requirements'::text, 'policy'::text, 'other'::text])))`

### tournament_draw_pot_members

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| pot_id | uuid | True | None |
| participant_id | uuid | True | None |
| seed_number | integer | False | None |
| created_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_draw_pot_members_participant_fk`: `FOREIGN KEY (participant_id) REFERENCES tournament_competition_participants(id) ON DELETE RESTRICT`
- `tournament_draw_pot_members_participant_unique`: `UNIQUE (participant_id)`
- `tournament_draw_pot_members_pkey`: `PRIMARY KEY (pot_id, participant_id)`
- `tournament_draw_pot_members_pot_fk`: `FOREIGN KEY (pot_id) REFERENCES tournament_draw_pots(id) ON DELETE RESTRICT`
- `tournament_draw_pot_members_seed_check`: `CHECK (((seed_number IS NULL) OR (seed_number > 0)))`

### tournament_draw_pots

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| category_id | uuid | True | None |
| participant_set_id | uuid | True | None |
| name | text | True | None |
| number | integer | True | None |
| sort_order | integer | True | 0 |
| status | text | True | 'active'::text |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |
| archived_at | timestamp with time zone | False | None |

Constraints:

- `tournament_draw_pots_archive_check`: `CHECK ((((status = 'archived'::text) AND (archived_at IS NOT NULL)) OR ((status = 'active'::text) AND (archived_at IS NULL))))`
- `tournament_draw_pots_name_check`: `CHECK (((name = btrim(name)) AND ((char_length(name) >= 1) AND (char_length(name) <= 80))))`
- `tournament_draw_pots_number_check`: `CHECK ((number > 0))`
- `tournament_draw_pots_pkey`: `PRIMARY KEY (id)`
- `tournament_draw_pots_scope_unique`: `UNIQUE (organization_id, tournament_id, category_id, participant_set_id, id)`
- `tournament_draw_pots_set_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, participant_set_id) REFERENCES tournament_participant_sets(organization_id, tournament_id, category_id, id) ON DELETE RESTRICT`
- `tournament_draw_pots_status_check`: `CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))`

### tournament_entitlement_capabilities

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'service_role=r/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| capability | text | True | None |
| free_enabled | boolean | True | None |
| premium_enabled | boolean | True | None |
| participant_enabled | boolean | True | false |
| description | text | True | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_entitlement_capabilities_description_check`: `CHECK (((description = btrim(description)) AND ((char_length(description) >= 8) AND (char_length(description) <= 240))))`
- `tournament_entitlement_capabilities_name_check`: `CHECK ((capability ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'::text))`
- `tournament_entitlement_capabilities_pkey`: `PRIMARY KEY (capability)`

### tournament_entitlement_overrides

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'service_role=r/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| capability | text | True | None |
| enabled | boolean | True | None |
| expires_at | timestamp with time zone | False | None |
| reason | text | True | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_entitlement_overrides_capability_fkey`: `FOREIGN KEY (capability) REFERENCES tournament_entitlement_capabilities(capability) ON DELETE RESTRICT`
- `tournament_entitlement_overrides_pkey`: `PRIMARY KEY (id)`
- `tournament_entitlement_overrides_reason_check`: `CHECK (((reason = btrim(reason)) AND ((char_length(reason) >= 8) AND (char_length(reason) <= 500))))`
- `tournament_entitlement_overrides_tenant_fk`: `FOREIGN KEY (organization_id, tournament_id) REFERENCES tournaments(organization_id, id) ON DELETE RESTRICT`
- `tournament_entitlement_overrides_unique`: `UNIQUE (organization_id, tournament_id, capability)`

### tournament_fixture_versions

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| season_id | uuid | True | None |
| tournament_id | uuid | True | None |
| category_id | uuid | True | None |
| participant_set_id | uuid | True | None |
| version_number | integer | True | None |
| status | text | True | 'draft'::text |
| generation_method | text | True | None |
| seed | text | False | None |
| participant_fingerprint | text | True | None |
| configuration_snapshot | jsonb | True | '{}'::jsonb |
| created_by | uuid | True | None |
| idempotency_key | uuid | True | None |
| created_at | timestamp with time zone | True | now() |
| published_at | timestamp with time zone | False | None |
| superseded_at | timestamp with time zone | False | None |
| archived_at | timestamp with time zone | False | None |
| invalidated_at | timestamp with time zone | False | None |

Constraints:

- `tournament_fixture_versions_configuration_check`: `CHECK (((jsonb_typeof(configuration_snapshot) = 'object'::text) AND (pg_column_size(configuration_snapshot) <= 32768)))`
- `tournament_fixture_versions_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_fixture_versions_fingerprint_check`: `CHECK ((participant_fingerprint ~ '^[0-9a-f]{64}$'::text))`
- `tournament_fixture_versions_idempotency_unique`: `UNIQUE (organization_id, created_by, idempotency_key)`
- `tournament_fixture_versions_lifecycle_check`: `CHECK ((((status = 'published'::text) AND (published_at IS NOT NULL) AND (superseded_at IS NULL) AND (archived_at IS NULL)) OR ((status = 'superseded'::text) AND (published_at IS NOT NULL) AND (superseded_at IS NOT NULL) AND (archived_at IS NULL)) OR ((status = 'archived'::text) AND (archived_at IS NOT NULL)) OR ((status = 'draft'::text) AND (published_at IS NULL) AND (superseded_at IS NULL) AND (archived_at IS NULL))))`
- `tournament_fixture_versions_method_check`: `CHECK ((generation_method = ANY (ARRAY['automatic'::text, 'manual'::text, 'draw'::text, 'import_future'::text])))`
- `tournament_fixture_versions_pkey`: `PRIMARY KEY (id)`
- `tournament_fixture_versions_scope_unique`: `UNIQUE (organization_id, tournament_id, category_id, id)`
- `tournament_fixture_versions_seed_check`: `CHECK (((seed IS NULL) OR ((char_length(seed) >= 1) AND (char_length(seed) <= 160))))`
- `tournament_fixture_versions_set_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, participant_set_id) REFERENCES tournament_participant_sets(organization_id, tournament_id, category_id, id) ON DELETE RESTRICT`
- `tournament_fixture_versions_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'superseded'::text, 'archived'::text])))`
- `tournament_fixture_versions_tournament_fk`: `FOREIGN KEY (organization_id, tournament_id, season_id) REFERENCES tournaments(organization_id, id, season_id) ON DELETE RESTRICT`
- `tournament_fixture_versions_version_check`: `CHECK ((version_number > 0))`
- `tournament_fixture_versions_version_unique`: `UNIQUE (tournament_id, category_id, version_number)`

### tournament_group_members

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| group_id | uuid | True | None |
| participant_id | uuid | True | None |
| position_seed | integer | False | None |
| created_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_group_members_group_fk`: `FOREIGN KEY (group_id) REFERENCES tournament_groups(id) ON DELETE RESTRICT`
- `tournament_group_members_participant_fk`: `FOREIGN KEY (participant_id) REFERENCES tournament_competition_participants(id) ON DELETE RESTRICT`
- `tournament_group_members_pkey`: `PRIMARY KEY (group_id, participant_id)`
- `tournament_group_members_position_check`: `CHECK (((position_seed IS NULL) OR (position_seed > 0)))`

### tournament_groups

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| category_id | uuid | True | None |
| participant_set_id | uuid | True | None |
| fixture_version_id | uuid | False | None |
| phase_id | uuid | False | None |
| name | text | True | None |
| code | text | True | None |
| sort_order | integer | True | 0 |
| status | text | True | 'draft'::text |
| draw_seed | text | False | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |
| archived_at | timestamp with time zone | False | None |

Constraints:

- `tournament_groups_archive_check`: `CHECK ((((status = 'archived'::text) AND (archived_at IS NOT NULL)) OR ((status <> 'archived'::text) AND (archived_at IS NULL))))`
- `tournament_groups_code_check`: `CHECK (((code = upper(btrim(code))) AND (code ~ '^[A-Z0-9-]{1,12}$'::text)))`
- `tournament_groups_fixture_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, fixture_version_id) REFERENCES tournament_fixture_versions(organization_id, tournament_id, category_id, id) ON DELETE RESTRICT`
- `tournament_groups_fixture_phase_scope_unique`: `UNIQUE (organization_id, tournament_id, category_id, fixture_version_id, phase_id, id)`
- `tournament_groups_name_check`: `CHECK (((name = btrim(name)) AND ((char_length(name) >= 1) AND (char_length(name) <= 80))))`
- `tournament_groups_phase_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, fixture_version_id, phase_id) REFERENCES tournament_phases(organization_id, tournament_id, category_id, fixture_version_id, id) ON DELETE RESTRICT`
- `tournament_groups_phase_requires_fixture`: `CHECK (((phase_id IS NULL) OR (fixture_version_id IS NOT NULL)))`
- `tournament_groups_pkey`: `PRIMARY KEY (id)`
- `tournament_groups_scope_unique`: `UNIQUE (organization_id, tournament_id, category_id, participant_set_id, id)`
- `tournament_groups_set_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, participant_set_id) REFERENCES tournament_participant_sets(organization_id, tournament_id, category_id, id) ON DELETE RESTRICT`
- `tournament_groups_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text])))`

### tournament_legacy_organization_subscriptions

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'service_role=r/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| plan_code | text | True | 'PRO'::text |
| status | text | True | None |
| source | text | True | 'manual'::text |
| starts_at | timestamp with time zone | True | None |
| current_period_end | timestamp with time zone | True | None |
| grace_until | timestamp with time zone | False | None |
| cancelled_at | timestamp with time zone | False | None |
| status_changed_at | timestamp with time zone | True | now() |
| post_expiration_retention_days | integer | True | 90 |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_organization_subscriptions_cancelled_check`: `CHECK (((status = 'cancelled'::text) = (cancelled_at IS NOT NULL)))`
- `tournament_organization_subscriptions_grace_check`: `CHECK (((grace_until IS NULL) OR (grace_until >= current_period_end)))`
- `tournament_organization_subscriptions_one_per_org`: `UNIQUE (organization_id)`
- `tournament_organization_subscriptions_organization_id_fkey`: `FOREIGN KEY (organization_id) REFERENCES tournament_organizations(id) ON DELETE RESTRICT`
- `tournament_organization_subscriptions_period_check`: `CHECK ((current_period_end > starts_at))`
- `tournament_organization_subscriptions_pkey`: `PRIMARY KEY (id)`
- `tournament_organization_subscriptions_plan_check`: `CHECK ((plan_code = 'PRO'::text))`
- `tournament_organization_subscriptions_plan_code_fkey`: `FOREIGN KEY (plan_code) REFERENCES tournament_legacy_subscription_plans(code) ON DELETE RESTRICT`
- `tournament_organization_subscriptions_retention_check`: `CHECK (((post_expiration_retention_days >= 1) AND (post_expiration_retention_days <= 3650)))`
- `tournament_organization_subscriptions_source_check`: `CHECK ((source = ANY (ARRAY['manual'::text, 'apple'::text, 'google'::text, 'web'::text])))`
- `tournament_organization_subscriptions_status_check`: `CHECK ((status = ANY (ARRAY['active'::text, 'grace_period'::text, 'past_due'::text, 'cancelled'::text, 'expired'::text])))`

### tournament_legacy_subscription_plans

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'service_role=r/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| code | text | True | None |
| max_photos_per_matchday | integer | False | None |
| retained_matchdays | integer | False | None |
| retention_grace_days | integer | True | None |
| post_expiration_retention_days | integer | True | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_entitlement_plans_code_check`: `CHECK ((code = ANY (ARRAY['FREE'::text, 'PRO'::text])))`
- `tournament_entitlement_plans_media_check`: `CHECK ((((code = 'FREE'::text) AND (max_photos_per_matchday = 20) AND (retained_matchdays = 3) AND (retention_grace_days = 7) AND (post_expiration_retention_days = 0)) OR ((code = 'PRO'::text) AND (max_photos_per_matchday IS NULL) AND (retained_matchdays IS NULL) AND ((retention_grace_days >= 0) AND (retention_grace_days <= 365)) AND ((post_expiration_retention_days >= 1) AND (post_expiration_retention_days <= 3650)))))`
- `tournament_entitlement_plans_pkey`: `PRIMARY KEY (code)`

### tournament_match_availability_responses

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| match_id | uuid | True | None |
| team_entry_id | uuid | True | None |
| roster_player_id | uuid | True | None |
| user_id | uuid | False | None |
| response | text | True | None |
| comment | text | False | None |
| response_source | text | True | None |
| recorded_by | uuid | True | None |
| manual_reason | text | False | None |
| responded_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_match_availability_comment_check`: `CHECK (((comment IS NULL) OR (char_length(comment) <= 500)))`
- `tournament_match_availability_entry_fk`: `FOREIGN KEY (organization_id, team_entry_id) REFERENCES tournament_team_entries(organization_id, id) ON DELETE RESTRICT`
- `tournament_match_availability_manual_check`: `CHECK ((((response_source = 'self'::text) AND (user_id IS NOT NULL) AND (recorded_by = user_id) AND (manual_reason IS NULL)) OR ((response_source = 'manual'::text) AND ((char_length(btrim(manual_reason)) >= 3) AND (char_length(btrim(manual_reason)) <= 500)))))`
- `tournament_match_availability_match_fk`: `FOREIGN KEY (organization_id, match_id) REFERENCES tournament_matches(organization_id, id) ON DELETE RESTRICT`
- `tournament_match_availability_player_fk`: `FOREIGN KEY (organization_id, team_entry_id, roster_player_id) REFERENCES tournament_roster_players(organization_id, team_entry_id, id) ON DELETE RESTRICT`
- `tournament_match_availability_response_check`: `CHECK ((response = ANY (ARRAY['available'::text, 'unavailable'::text, 'maybe'::text])))`
- `tournament_match_availability_responses_pkey`: `PRIMARY KEY (id)`
- `tournament_match_availability_responses_recorded_by_fkey`: `FOREIGN KEY (recorded_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_match_availability_responses_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_match_availability_source_check`: `CHECK ((response_source = ANY (ARRAY['self'::text, 'manual'::text])))`
- `tournament_match_availability_unique`: `UNIQUE (match_id, roster_player_id)`

### tournament_match_events

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| match_operation_id | uuid | True | None |
| match_id | uuid | True | None |
| team_entry_id | uuid | True | None |
| roster_player_id | uuid | False | None |
| related_roster_player_id | uuid | False | None |
| related_event_id | uuid | False | None |
| event_type | text | True | None |
| minute | smallint | False | None |
| period | text | True | 'unknown'::text |
| sequence_number | integer | True | None |
| unidentified_player_reason | text | False | None |
| metadata | jsonb | True | '{}'::jsonb |
| created_by | uuid | True | None |
| created_at | timestamp with time zone | True | now() |
| voided_at | timestamp with time zone | False | None |
| voided_by | uuid | False | None |
| void_reason | text | False | None |

Constraints:

- `tournament_match_events_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_match_events_entry_fk`: `FOREIGN KEY (organization_id, team_entry_id) REFERENCES tournament_team_entries(organization_id, id) ON DELETE RESTRICT`
- `tournament_match_events_metadata_check`: `CHECK (((jsonb_typeof(metadata) = 'object'::text) AND (pg_column_size(metadata) <= 8192)))`
- `tournament_match_events_minute_check`: `CHECK (((minute IS NULL) OR ((minute >= 0) AND (minute <= 240))))`
- `tournament_match_events_operation_fk`: `FOREIGN KEY (organization_id, match_id, match_operation_id) REFERENCES tournament_match_operations(organization_id, match_id, id) ON DELETE RESTRICT`
- `tournament_match_events_period_check`: `CHECK ((period = ANY (ARRAY['pre_match'::text, 'first_half'::text, 'halftime'::text, 'second_half'::text, 'extra_time'::text, 'penalties'::text, 'post_match'::text, 'unknown'::text])))`
- `tournament_match_events_pkey`: `PRIMARY KEY (id)`
- `tournament_match_events_player_fk`: `FOREIGN KEY (organization_id, roster_player_id) REFERENCES tournament_roster_players(organization_id, id) ON DELETE RESTRICT`
- `tournament_match_events_player_shape_check`: `CHECK (((roster_player_id IS NOT NULL) OR (event_type = ANY (ARRAY['match_started'::text, 'halftime'::text, 'second_half_started'::text, 'match_ended'::text, 'suspension'::text, 'resumption_future'::text, 'incident'::text, 'no_show'::text])) OR ((event_type = ANY (ARRAY['goal'::text, 'own_goal'::text, 'penalty_goal'::text])) AND ((char_length(btrim(unidentified_player_reason)) >= 3) AND (char_length(btrim(unidentified_player_reason)) <= 500)))))`
- `tournament_match_events_related_event_fk`: `FOREIGN KEY (related_event_id) REFERENCES tournament_match_events(id) ON DELETE RESTRICT`
- `tournament_match_events_related_player_fk`: `FOREIGN KEY (organization_id, related_roster_player_id) REFERENCES tournament_roster_players(organization_id, id) ON DELETE RESTRICT`
- `tournament_match_events_sequence_check`: `CHECK ((sequence_number > 0))`
- `tournament_match_events_sequence_unique`: `UNIQUE (match_operation_id, sequence_number)`
- `tournament_match_events_type_check`: `CHECK ((event_type = ANY (ARRAY['goal'::text, 'own_goal'::text, 'assist'::text, 'yellow_card'::text, 'second_yellow'::text, 'red_card'::text, 'substitution_in'::text, 'substitution_out'::text, 'penalty_goal'::text, 'penalty_missed'::text, 'match_started'::text, 'halftime'::text, 'second_half_started'::text, 'match_ended'::text, 'suspension'::text, 'resumption_future'::text, 'incident'::text, 'no_show'::text])))`
- `tournament_match_events_void_check`: `CHECK ((((voided_at IS NULL) AND (voided_by IS NULL) AND (void_reason IS NULL)) OR ((voided_at IS NOT NULL) AND (voided_by IS NOT NULL) AND ((char_length(btrim(void_reason)) >= 3) AND (char_length(btrim(void_reason)) <= 500)))))`
- `tournament_match_events_voided_by_fkey`: `FOREIGN KEY (voided_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`

### tournament_match_operation_players

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| match_operation_id | uuid | True | None |
| match_id | uuid | True | None |
| team_entry_id | uuid | True | None |
| roster_player_id | uuid | True | None |
| display_name_snapshot | text | True | None |
| avatar_url_snapshot | text | False | None |
| shirt_number_snapshot | smallint | False | None |
| position_snapshot | text | False | None |
| is_goalkeeper | boolean | True | false |
| is_captain | boolean | True | false |
| lineup_status | text | True | None |
| attendance_status | text | True | None |
| created_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_match_operation_players_attendance_check`: `CHECK ((attendance_status = ANY (ARRAY['unknown'::text, 'present'::text, 'absent'::text, 'late'::text, 'excused'::text])))`
- `tournament_match_operation_players_entry_fk`: `FOREIGN KEY (organization_id, team_entry_id) REFERENCES tournament_team_entries(organization_id, id) ON DELETE RESTRICT`
- `tournament_match_operation_players_lineup_check`: `CHECK ((lineup_status = ANY (ARRAY['starter'::text, 'substitute'::text, 'not_in_match_squad'::text])))`
- `tournament_match_operation_players_name_check`: `CHECK (((display_name_snapshot = btrim(display_name_snapshot)) AND ((char_length(display_name_snapshot) >= 2) AND (char_length(display_name_snapshot) <= 100))))`
- `tournament_match_operation_players_operation_fk`: `FOREIGN KEY (organization_id, match_id, match_operation_id) REFERENCES tournament_match_operations(organization_id, match_id, id) ON DELETE RESTRICT`
- `tournament_match_operation_players_pkey`: `PRIMARY KEY (id)`
- `tournament_match_operation_players_roster_player_fk`: `FOREIGN KEY (organization_id, team_entry_id, roster_player_id) REFERENCES tournament_roster_players(organization_id, team_entry_id, id) ON DELETE RESTRICT`
- `tournament_match_operation_players_unique`: `UNIQUE (match_operation_id, roster_player_id)`

### tournament_match_operations

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| season_id | uuid | True | None |
| tournament_id | uuid | True | None |
| category_id | uuid | True | None |
| fixture_version_id | uuid | True | None |
| phase_id | uuid | True | None |
| round_id | uuid | True | None |
| match_id | uuid | True | None |
| home_team_entry_id | uuid | True | None |
| away_team_entry_id | uuid | True | None |
| status | text | True | 'draft'::text |
| match_status | text | True | 'ready'::text |
| operation_version | integer | True | None |
| source_operation_id | uuid | False | None |
| match_snapshot | jsonb | True | None |
| home_team_snapshot | jsonb | True | None |
| away_team_snapshot | jsonb | True | None |
| notes | text | False | None |
| opened_by | uuid | True | None |
| opened_at | timestamp with time zone | True | now() |
| submitted_by | uuid | False | None |
| submitted_at | timestamp with time zone | False | None |
| validated_by | uuid | False | None |
| validated_at | timestamp with time zone | False | None |
| official_by | uuid | False | None |
| official_at | timestamp with time zone | False | None |
| closed_at | timestamp with time zone | False | None |
| reopened_at | timestamp with time zone | False | None |
| reopened_by | uuid | False | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_match_operations_away_entry_fk`: `FOREIGN KEY (organization_id, tournament_id, away_team_entry_id) REFERENCES tournament_team_entries(organization_id, tournament_id, id) ON DELETE RESTRICT`
- `tournament_match_operations_home_entry_fk`: `FOREIGN KEY (organization_id, tournament_id, home_team_entry_id) REFERENCES tournament_team_entries(organization_id, tournament_id, id) ON DELETE RESTRICT`
- `tournament_match_operations_lifecycle_check`: `CHECK ((((status = 'draft'::text) AND (submitted_at IS NULL) AND (validated_at IS NULL) AND (official_at IS NULL)) OR ((status = ANY (ARRAY['submitted'::text, 'under_review'::text])) AND (submitted_by IS NOT NULL) AND (submitted_at IS NOT NULL) AND (official_at IS NULL)) OR ((status = 'validated'::text) AND (submitted_by IS NOT NULL) AND (submitted_at IS NOT NULL) AND (validated_by IS NOT NULL) AND (validated_at IS NOT NULL) AND (official_at IS NULL)) OR ((status = ANY (ARRAY['official'::text, 'correction_requested'::text, 'superseded'::text])) AND (submitted_by IS NOT NULL) AND (submitted_at IS NOT NULL) AND (validated_by IS NOT NULL) AND (validated_at IS NOT NULL) AND (official_by IS NOT NULL) AND (official_at IS NOT NULL) AND (closed_at IS NOT NULL)) OR (status = 'voided'::text)))`
- `tournament_match_operations_match_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, fixture_version_id, match_id) REFERENCES tournament_matches(organization_id, tournament_id, category_id, fixture_version_id, id) ON DELETE RESTRICT`
- `tournament_match_operations_match_status_check`: `CHECK ((match_status = ANY (ARRAY['ready'::text, 'in_progress'::text, 'suspended'::text, 'abandoned'::text, 'played'::text, 'awaiting_validation'::text, 'official'::text, 'administrative'::text, 'voided'::text])))`
- `tournament_match_operations_match_version_unique`: `UNIQUE (match_id, operation_version)`
- `tournament_match_operations_notes_check`: `CHECK (((notes IS NULL) OR (char_length(notes) <= 4000)))`
- `tournament_match_operations_official_by_fkey`: `FOREIGN KEY (official_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_match_operations_opened_by_fkey`: `FOREIGN KEY (opened_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_match_operations_org_id_unique`: `UNIQUE (organization_id, id)`
- `tournament_match_operations_org_match_id_unique`: `UNIQUE (organization_id, match_id, id)`
- `tournament_match_operations_pkey`: `PRIMARY KEY (id)`
- `tournament_match_operations_reopened_by_fkey`: `FOREIGN KEY (reopened_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_match_operations_snapshot_check`: `CHECK (((jsonb_typeof(match_snapshot) = 'object'::text) AND (jsonb_typeof(home_team_snapshot) = 'object'::text) AND (jsonb_typeof(away_team_snapshot) = 'object'::text) AND (pg_column_size(match_snapshot) <= 16384) AND (pg_column_size(home_team_snapshot) <= 8192) AND (pg_column_size(away_team_snapshot) <= 8192)))`
- `tournament_match_operations_source_fk`: `FOREIGN KEY (source_operation_id) REFERENCES tournament_match_operations(id) ON DELETE RESTRICT`
- `tournament_match_operations_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'under_review'::text, 'validated'::text, 'official'::text, 'correction_requested'::text, 'superseded'::text, 'voided'::text])))`
- `tournament_match_operations_submitted_by_fkey`: `FOREIGN KEY (submitted_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_match_operations_teams_check`: `CHECK ((home_team_entry_id <> away_team_entry_id))`
- `tournament_match_operations_validated_by_fkey`: `FOREIGN KEY (validated_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_match_operations_version_check`: `CHECK ((operation_version > 0))`

### tournament_match_outcomes

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| match_operation_id | uuid | True | None |
| organization_id | uuid | True | None |
| match_id | uuid | True | None |
| outcome_type | text | True | None |
| started_at | timestamp with time zone | False | None |
| ended_at | timestamp with time zone | False | None |
| suspension_minute | smallint | False | None |
| suspension_period | text | False | None |
| events_remain_valid | boolean | True | true |
| reason_code | text | False | None |
| reason_text | text | False | None |
| administrative_home_score | smallint | False | None |
| administrative_away_score | smallint | False | None |
| counts_for_standings | boolean | True | false |
| counts_for_player_stats | boolean | True | false |
| requires_resolution | boolean | True | false |
| resolved_by | uuid | False | None |
| resolved_at | timestamp with time zone | False | None |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_match_outcomes_admin_score_check`: `CHECK ((((administrative_home_score IS NULL) AND (administrative_away_score IS NULL)) OR ((administrative_home_score >= 0) AND (administrative_home_score <= 99) AND ((administrative_away_score >= 0) AND (administrative_away_score <= 99)))))`
- `tournament_match_outcomes_minute_check`: `CHECK (((suspension_minute IS NULL) OR ((suspension_minute >= 0) AND (suspension_minute <= 240))))`
- `tournament_match_outcomes_operation_fk`: `FOREIGN KEY (organization_id, match_id, match_operation_id) REFERENCES tournament_match_operations(organization_id, match_id, id) ON DELETE RESTRICT`
- `tournament_match_outcomes_period_check`: `CHECK (((suspension_period IS NULL) OR (suspension_period = ANY (ARRAY['first_half'::text, 'halftime'::text, 'second_half'::text, 'extra_time'::text, 'penalties'::text, 'unknown'::text]))))`
- `tournament_match_outcomes_pkey`: `PRIMARY KEY (match_operation_id)`
- `tournament_match_outcomes_reason_check`: `CHECK (((reason_text IS NULL) OR (char_length(reason_text) <= 2000)))`
- `tournament_match_outcomes_resolution_check`: `CHECK ((((resolved_at IS NULL) AND (resolved_by IS NULL)) OR ((resolved_at IS NOT NULL) AND (resolved_by IS NOT NULL))))`
- `tournament_match_outcomes_resolved_by_fkey`: `FOREIGN KEY (resolved_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_match_outcomes_suspension_check`: `CHECK (((outcome_type <> 'suspended'::text) OR ((suspension_minute IS NOT NULL) AND (suspension_period IS NOT NULL) AND (reason_text IS NOT NULL))))`
- `tournament_match_outcomes_type_check`: `CHECK ((outcome_type = ANY (ARRAY['played'::text, 'postponed_before_start'::text, 'suspended'::text, 'abandoned'::text, 'home_no_show'::text, 'away_no_show'::text, 'double_no_show'::text, 'walkover_home'::text, 'walkover_away'::text, 'administrative_result'::text, 'cancelled'::text, 'not_played'::text, 'resumed_future'::text])))`

### tournament_match_reschedules

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | bigint | True | None |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| category_id | uuid | True | None |
| fixture_version_id | uuid | True | None |
| match_id | uuid | True | None |
| previous_scheduled_at | timestamp with time zone | False | None |
| previous_venue_id | uuid | False | None |
| previous_court_id | uuid | False | None |
| new_scheduled_at | timestamp with time zone | False | None |
| new_venue_id | uuid | False | None |
| new_court_id | uuid | False | None |
| reason | text | True | None |
| actor_user_id | uuid | True | None |
| previous_status | text | True | None |
| new_status | text | True | None |
| created_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_match_reschedules_actor_user_id_fkey`: `FOREIGN KEY (actor_user_id) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_match_reschedules_match_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, fixture_version_id, match_id) REFERENCES tournament_matches(organization_id, tournament_id, category_id, fixture_version_id, id) ON DELETE RESTRICT`
- `tournament_match_reschedules_new_court_fk`: `FOREIGN KEY (organization_id, new_court_id) REFERENCES tournament_courts(organization_id, id) ON DELETE RESTRICT`
- `tournament_match_reschedules_new_venue_fk`: `FOREIGN KEY (organization_id, new_venue_id) REFERENCES tournament_venues(organization_id, id) ON DELETE RESTRICT`
- `tournament_match_reschedules_pkey`: `PRIMARY KEY (id)`
- `tournament_match_reschedules_previous_court_fk`: `FOREIGN KEY (organization_id, previous_court_id) REFERENCES tournament_courts(organization_id, id) ON DELETE RESTRICT`
- `tournament_match_reschedules_previous_venue_fk`: `FOREIGN KEY (organization_id, previous_venue_id) REFERENCES tournament_venues(organization_id, id) ON DELETE RESTRICT`
- `tournament_match_reschedules_reason_check`: `CHECK (((reason = btrim(reason)) AND ((char_length(reason) >= 3) AND (char_length(reason) <= 500))))`
- `tournament_match_reschedules_status_check`: `CHECK (((previous_status = ANY (ARRAY['unscheduled'::text, 'scheduled'::text, 'postponed'::text, 'ready'::text])) AND (new_status = ANY (ARRAY['unscheduled'::text, 'scheduled'::text, 'postponed'::text, 'cancelled'::text, 'ready'::text]))))`

### tournament_match_resumptions

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| match_operation_id | uuid | True | None |
| scheduled_at | timestamp with time zone | False | None |
| venue_id | uuid | False | None |
| court_id | uuid | False | None |
| status | text | True | 'pending'::text |
| reason | text | True | None |
| created_by | uuid | True | None |
| created_at | timestamp with time zone | True | now() |
| resolved_at | timestamp with time zone | False | None |

Constraints:

- `tournament_match_resumptions_court_fk`: `FOREIGN KEY (organization_id, court_id) REFERENCES tournament_courts(organization_id, id) ON DELETE RESTRICT`
- `tournament_match_resumptions_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_match_resumptions_operation_fk`: `FOREIGN KEY (organization_id, match_operation_id) REFERENCES tournament_match_operations(organization_id, id) ON DELETE RESTRICT`
- `tournament_match_resumptions_pkey`: `PRIMARY KEY (id)`
- `tournament_match_resumptions_reason_check`: `CHECK (((reason = btrim(reason)) AND ((char_length(reason) >= 3) AND (char_length(reason) <= 1000))))`
- `tournament_match_resumptions_schedule_check`: `CHECK ((((scheduled_at IS NULL) AND (venue_id IS NULL) AND (court_id IS NULL) AND (status = 'pending'::text)) OR ((scheduled_at IS NOT NULL) AND (venue_id IS NOT NULL) AND (court_id IS NOT NULL) AND (status = ANY (ARRAY['scheduled'::text, 'completed'::text, 'cancelled'::text])))))`
- `tournament_match_resumptions_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'scheduled'::text, 'completed'::text, 'cancelled'::text])))`
- `tournament_match_resumptions_venue_fk`: `FOREIGN KEY (organization_id, venue_id) REFERENCES tournament_venues(organization_id, id) ON DELETE RESTRICT`

### tournament_match_reviews

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| match_operation_id | uuid | True | None |
| review_type | text | True | None |
| status | text | True | 'open'::text |
| reason | text | True | None |
| requested_by | uuid | True | None |
| requested_at | timestamp with time zone | True | now() |
| resolved_by | uuid | False | None |
| resolved_at | timestamp with time zone | False | None |
| resolution | text | False | None |
| created_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_match_reviews_operation_fk`: `FOREIGN KEY (organization_id, match_operation_id) REFERENCES tournament_match_operations(organization_id, id) ON DELETE RESTRICT`
- `tournament_match_reviews_pkey`: `PRIMARY KEY (id)`
- `tournament_match_reviews_reason_check`: `CHECK (((reason = btrim(reason)) AND ((char_length(reason) >= 3) AND (char_length(reason) <= 2000))))`
- `tournament_match_reviews_requested_by_fkey`: `FOREIGN KEY (requested_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_match_reviews_resolution_check`: `CHECK ((((status = 'open'::text) AND (resolved_by IS NULL) AND (resolved_at IS NULL) AND (resolution IS NULL)) OR ((status <> 'open'::text) AND (resolved_by IS NOT NULL) AND (resolved_at IS NOT NULL) AND ((char_length(btrim(resolution)) >= 3) AND (char_length(btrim(resolution)) <= 2000)))))`
- `tournament_match_reviews_resolved_by_fkey`: `FOREIGN KEY (resolved_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_match_reviews_status_check`: `CHECK ((status = ANY (ARRAY['open'::text, 'approved'::text, 'rejected'::text, 'superseded'::text])))`
- `tournament_match_reviews_type_check`: `CHECK ((review_type = ANY (ARRAY['validation'::text, 'correction'::text, 'dispute_future'::text, 'administrative_resolution'::text])))`

### tournament_match_scores

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| match_operation_id | uuid | True | None |
| organization_id | uuid | True | None |
| match_id | uuid | True | None |
| home_score | smallint | True | None |
| away_score | smallint | True | None |
| home_score_first_half | smallint | False | None |
| away_score_first_half | smallint | False | None |
| home_penalties | smallint | False | None |
| away_penalties | smallint | False | None |
| score_type | text | True | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_match_scores_operation_fk`: `FOREIGN KEY (organization_id, match_id, match_operation_id) REFERENCES tournament_match_operations(organization_id, match_id, id) ON DELETE RESTRICT`
- `tournament_match_scores_penalties_check`: `CHECK (((home_penalties IS NULL) = (away_penalties IS NULL)))`
- `tournament_match_scores_pkey`: `PRIMARY KEY (match_operation_id)`
- `tournament_match_scores_type_check`: `CHECK ((score_type = ANY (ARRAY['played'::text, 'administrative'::text, 'walkover'::text, 'series_leg'::text, 'penalty_shootout_future'::text])))`
- `tournament_match_scores_values_check`: `CHECK (((home_score >= 0) AND (home_score <= 99) AND ((away_score >= 0) AND (away_score <= 99)) AND ((home_score_first_half IS NULL) OR ((home_score_first_half >= 0) AND (home_score_first_half <= home_score))) AND ((away_score_first_half IS NULL) OR ((away_score_first_half >= 0) AND (away_score_first_half <= away_score))) AND ((home_penalties IS NULL) OR ((home_penalties >= 0) AND (home_penalties <= 99))) AND ((away_penalties IS NULL) OR ((away_penalties >= 0) AND (away_penalties <= 99)))))`

### tournament_match_sources

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| category_id | uuid | True | None |
| fixture_version_id | uuid | True | None |
| match_id | uuid | True | None |
| side | text | True | None |
| source_type | text | True | None |
| participant_id | uuid | False | None |
| source_match_id | uuid | False | None |
| group_id | uuid | False | None |
| source_phase_id | uuid | False | None |
| source_tie_key | text | False | None |
| position_number | integer | False | None |
| seed_number | integer | False | None |
| rank_number | integer | False | None |
| created_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_match_sources_group_fk`: `FOREIGN KEY (group_id) REFERENCES tournament_groups(id) ON DELETE RESTRICT`
- `tournament_match_sources_match_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, fixture_version_id, match_id) REFERENCES tournament_matches(organization_id, tournament_id, category_id, fixture_version_id, id) ON DELETE RESTRICT`
- `tournament_match_sources_participant_fk`: `FOREIGN KEY (participant_id) REFERENCES tournament_competition_participants(id) ON DELETE RESTRICT`
- `tournament_match_sources_phase_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, fixture_version_id, source_phase_id) REFERENCES tournament_phases(organization_id, tournament_id, category_id, fixture_version_id, id) ON DELETE RESTRICT`
- `tournament_match_sources_pkey`: `PRIMARY KEY (id)`
- `tournament_match_sources_shape_check`: `CHECK ((((source_type = 'participant'::text) AND (participant_id IS NOT NULL) AND (source_match_id IS NULL) AND (group_id IS NULL) AND (source_phase_id IS NULL) AND (source_tie_key IS NULL) AND (position_number IS NULL) AND (seed_number IS NULL) AND (rank_number IS NULL)) OR ((source_type = ANY (ARRAY['winner_of_match'::text, 'loser_of_match'::text])) AND (source_match_id IS NOT NULL) AND (participant_id IS NULL) AND (group_id IS NULL) AND (source_phase_id IS NULL) AND (source_tie_key IS NULL) AND (position_number IS NULL) AND (seed_number IS NULL) AND (rank_number IS NULL)) OR ((source_type = ANY (ARRAY['winner_of_tie'::text, 'loser_of_tie'::text])) AND (source_tie_key IS NOT NULL) AND ((char_length(source_tie_key) >= 3) AND (char_length(source_tie_key) <= 200)) AND (participant_id IS NULL) AND (source_match_id IS NULL) AND (group_id IS NULL) AND (source_phase_id IS NULL) AND (position_number IS NULL) AND (seed_number IS NULL) AND (rank_number IS NULL)) OR ((source_type = 'group_position'::text) AND (group_id IS NOT NULL) AND (position_number > 0) AND (participant_id IS NULL) AND (source_match_id IS NULL) AND (source_phase_id IS NULL) AND (source_tie_key IS NULL) AND (seed_number IS NULL) AND (rank_number IS NULL)) OR ((source_type = 'league_position'::text) AND (source_phase_id IS NOT NULL) AND (rank_number > 0) AND (participant_id IS NULL) AND (source_match_id IS NULL) AND (group_id IS NULL) AND (source_tie_key IS NULL) AND (position_number IS NULL) AND (seed_number IS NULL)) OR ((source_type = 'seed'::text) AND (seed_number > 0) AND (participant_id IS NULL) AND (source_match_id IS NULL) AND (group_id IS NULL) AND (source_phase_id IS NULL) AND (source_tie_key IS NULL) AND (position_number IS NULL) AND (rank_number IS NULL)) OR ((source_type = 'bye'::text) AND (participant_id IS NULL) AND (source_match_id IS NULL) AND (group_id IS NULL) AND (source_phase_id IS NULL) AND (source_tie_key IS NULL) AND (position_number IS NULL) AND (seed_number IS NULL) AND (rank_number IS NULL))))`
- `tournament_match_sources_side_check`: `CHECK ((side = ANY (ARRAY['home'::text, 'away'::text])))`
- `tournament_match_sources_side_unique`: `UNIQUE (match_id, side)`
- `tournament_match_sources_source_match_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, fixture_version_id, source_match_id) REFERENCES tournament_matches(organization_id, tournament_id, category_id, fixture_version_id, id) ON DELETE RESTRICT`
- `tournament_match_sources_type_check`: `CHECK ((source_type = ANY (ARRAY['participant'::text, 'winner_of_match'::text, 'loser_of_match'::text, 'winner_of_tie'::text, 'loser_of_tie'::text, 'group_position'::text, 'league_position'::text, 'seed'::text, 'bye'::text])))`

### tournament_match_squad_players

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| match_squad_id | uuid | True | None |
| match_id | uuid | True | None |
| roster_player_id | uuid | True | None |
| team_entry_id | uuid | True | None |
| availability_status | text | True | 'pending'::text |
| callup_status | text | True | 'not_called_up'::text |
| lineup_status | text | True | 'not_in_match_squad'::text |
| shirt_number_snapshot | smallint | False | None |
| position_snapshot | text | False | None |
| display_name_snapshot | text | True | None |
| avatar_url_snapshot | text | False | None |
| is_goalkeeper | boolean | True | false |
| is_captain | boolean | True | false |
| attendance_status | text | True | 'unknown'::text |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_match_squad_players_attendance_check`: `CHECK ((attendance_status = ANY (ARRAY['unknown'::text, 'present'::text, 'absent'::text, 'late'::text, 'excused'::text])))`
- `tournament_match_squad_players_availability_check`: `CHECK ((availability_status = ANY (ARRAY['pending'::text, 'available'::text, 'unavailable'::text, 'maybe'::text, 'no_response'::text])))`
- `tournament_match_squad_players_callup_check`: `CHECK ((callup_status = ANY (ARRAY['called_up'::text, 'not_called_up'::text, 'removed'::text])))`
- `tournament_match_squad_players_lineup_check`: `CHECK ((lineup_status = ANY (ARRAY['starter'::text, 'substitute'::text, 'not_in_match_squad'::text])))`
- `tournament_match_squad_players_name_check`: `CHECK (((display_name_snapshot = btrim(display_name_snapshot)) AND ((char_length(display_name_snapshot) >= 2) AND (char_length(display_name_snapshot) <= 100))))`
- `tournament_match_squad_players_number_check`: `CHECK (((shirt_number_snapshot IS NULL) OR ((shirt_number_snapshot >= 0) AND (shirt_number_snapshot <= 99))))`
- `tournament_match_squad_players_pkey`: `PRIMARY KEY (id)`
- `tournament_match_squad_players_position_check`: `CHECK (((position_snapshot IS NULL) OR (position_snapshot = ANY (ARRAY['ARQ'::text, 'DEF'::text, 'MED'::text, 'DEL'::text]))))`
- `tournament_match_squad_players_roster_player_fk`: `FOREIGN KEY (organization_id, team_entry_id, roster_player_id) REFERENCES tournament_roster_players(organization_id, team_entry_id, id) ON DELETE RESTRICT`
- `tournament_match_squad_players_shape_check`: `CHECK ((((callup_status = 'called_up'::text) AND (lineup_status = ANY (ARRAY['starter'::text, 'substitute'::text]))) OR ((callup_status <> 'called_up'::text) AND (lineup_status = 'not_in_match_squad'::text))))`
- `tournament_match_squad_players_squad_fk`: `FOREIGN KEY (organization_id, match_id, team_entry_id, match_squad_id) REFERENCES tournament_match_squads(organization_id, match_id, team_entry_id, id) ON DELETE RESTRICT`
- `tournament_match_squad_players_unique`: `UNIQUE (match_squad_id, roster_player_id)`

### tournament_match_squads

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| match_id | uuid | True | None |
| team_entry_id | uuid | True | None |
| roster_id | uuid | True | None |
| status | text | True | 'draft'::text |
| submitted_by | uuid | False | None |
| submitted_at | timestamp with time zone | False | None |
| locked_by | uuid | False | None |
| locked_at | timestamp with time zone | False | None |
| created_by | uuid | True | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_match_squads_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_match_squads_entry_fk`: `FOREIGN KEY (organization_id, team_entry_id) REFERENCES tournament_team_entries(organization_id, id) ON DELETE RESTRICT`
- `tournament_match_squads_lifecycle_check`: `CHECK ((((status = 'draft'::text) AND (submitted_at IS NULL) AND (locked_at IS NULL)) OR ((status = 'submitted'::text) AND (submitted_by IS NOT NULL) AND (submitted_at IS NOT NULL) AND (locked_at IS NULL)) OR ((status = ANY (ARRAY['locked'::text, 'superseded'::text])) AND (submitted_by IS NOT NULL) AND (submitted_at IS NOT NULL) AND (locked_by IS NOT NULL) AND (locked_at IS NOT NULL))))`
- `tournament_match_squads_locked_by_fkey`: `FOREIGN KEY (locked_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_match_squads_match_fk`: `FOREIGN KEY (organization_id, match_id) REFERENCES tournament_matches(organization_id, id) ON DELETE RESTRICT`
- `tournament_match_squads_org_match_team_unique`: `UNIQUE (organization_id, match_id, team_entry_id, id)`
- `tournament_match_squads_pkey`: `PRIMARY KEY (id)`
- `tournament_match_squads_roster_fk`: `FOREIGN KEY (organization_id, team_entry_id, roster_id) REFERENCES tournament_rosters(organization_id, team_entry_id, id) ON DELETE RESTRICT`
- `tournament_match_squads_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'locked'::text, 'superseded'::text])))`
- `tournament_match_squads_submitted_by_fkey`: `FOREIGN KEY (submitted_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`

### tournament_matches

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| season_id | uuid | True | None |
| tournament_id | uuid | True | None |
| category_id | uuid | True | None |
| participant_set_id | uuid | True | None |
| fixture_version_id | uuid | True | None |
| phase_id | uuid | True | None |
| group_id | uuid | False | None |
| round_id | uuid | True | None |
| match_number | integer | True | None |
| leg_number | smallint | True | 1 |
| tie_key | text | False | None |
| home_participant_id | uuid | False | None |
| away_participant_id | uuid | False | None |
| status | text | True | 'unscheduled'::text |
| scheduled_at | timestamp with time zone | False | None |
| venue_id | uuid | False | None |
| court_id | uuid | False | None |
| duration_minutes | integer | False | None |
| created_by | uuid | True | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |
| postponed_at | timestamp with time zone | False | None |
| cancelled_at | timestamp with time zone | False | None |
| cancelled_by | uuid | False | None |
| cancellation_reason_code | text | False | None |
| cancellation_reason_text | text | False | None |
| withdrawn_participant_id | uuid | False | None |

Constraints:

- `tournament_matches_away_participant_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, participant_set_id, away_participant_id) REFERENCES tournament_competition_participants(organization_id, tournament_id, category_id, participant_set_id, id) ON DELETE RESTRICT`
- `tournament_matches_cancellation_check`: `CHECK ((((cancellation_reason_code IS NULL) AND (cancellation_reason_text IS NULL) AND (cancelled_by IS NULL) AND (withdrawn_participant_id IS NULL)) OR ((status = 'cancelled'::text) AND (cancellation_reason_code = ANY (ARRAY['withdrawal_bye'::text, 'manual_cancellation'::text])) AND (char_length(COALESCE(cancellation_reason_text, ''::text)) <= 500) AND ((withdrawn_participant_id IS NULL) OR (cancellation_reason_code = 'withdrawal_bye'::text)))))`
- `tournament_matches_cancelled_by_fkey`: `FOREIGN KEY (cancelled_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_matches_court_fk`: `FOREIGN KEY (organization_id, court_id) REFERENCES tournament_courts(organization_id, id) ON DELETE RESTRICT`
- `tournament_matches_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_matches_duration_check`: `CHECK (((duration_minutes IS NULL) OR ((duration_minutes >= 15) AND (duration_minutes <= 240))))`
- `tournament_matches_fixture_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, fixture_version_id) REFERENCES tournament_fixture_versions(organization_id, tournament_id, category_id, id) ON DELETE RESTRICT`
- `tournament_matches_group_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, fixture_version_id, phase_id, group_id) REFERENCES tournament_groups(organization_id, tournament_id, category_id, fixture_version_id, phase_id, id) ON DELETE RESTRICT`
- `tournament_matches_home_participant_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, participant_set_id, home_participant_id) REFERENCES tournament_competition_participants(organization_id, tournament_id, category_id, participant_set_id, id) ON DELETE RESTRICT`
- `tournament_matches_leg_check`: `CHECK ((leg_number = ANY (ARRAY[1, 2])))`
- `tournament_matches_lifecycle_check`: `CHECK ((((status = 'cancelled'::text) AND (cancelled_at IS NOT NULL)) OR ((status <> 'cancelled'::text) AND (cancelled_at IS NULL))))`
- `tournament_matches_number_check`: `CHECK ((match_number > 0))`
- `tournament_matches_number_unique`: `UNIQUE (fixture_version_id, match_number)`
- `tournament_matches_org_id_unique`: `UNIQUE (organization_id, id)`
- `tournament_matches_participant_set_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, participant_set_id) REFERENCES tournament_participant_sets(organization_id, tournament_id, category_id, id) ON DELETE RESTRICT`
- `tournament_matches_participants_check`: `CHECK (((home_participant_id IS NULL) OR (away_participant_id IS NULL) OR (home_participant_id <> away_participant_id)))`
- `tournament_matches_phase_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, fixture_version_id, phase_id) REFERENCES tournament_phases(organization_id, tournament_id, category_id, fixture_version_id, id) ON DELETE RESTRICT`
- `tournament_matches_pkey`: `PRIMARY KEY (id)`
- `tournament_matches_round_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, fixture_version_id, round_id) REFERENCES tournament_rounds(organization_id, tournament_id, category_id, fixture_version_id, id) ON DELETE RESTRICT`
- `tournament_matches_schedule_fields_check`: `CHECK ((((scheduled_at IS NULL) AND (venue_id IS NULL) AND (court_id IS NULL)) OR ((scheduled_at IS NOT NULL) AND (venue_id IS NOT NULL) AND (court_id IS NOT NULL) AND (duration_minutes IS NOT NULL))))`
- `tournament_matches_scope_unique`: `UNIQUE (organization_id, tournament_id, category_id, fixture_version_id, id)`
- `tournament_matches_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'unscheduled'::text, 'scheduled'::text, 'postponed'::text, 'cancelled'::text, 'ready'::text])))`
- `tournament_matches_tournament_fk`: `FOREIGN KEY (organization_id, tournament_id, season_id) REFERENCES tournaments(organization_id, id, season_id) ON DELETE RESTRICT`
- `tournament_matches_venue_fk`: `FOREIGN KEY (organization_id, venue_id) REFERENCES tournament_venues(organization_id, id) ON DELETE RESTRICT`

### tournament_media_assets

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'anon=r/supabase_admin', 'authenticated=arwd/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| gallery_id | uuid | True | None |
| provider | text | True | 'supabase'::text |
| bucket | text | True | 'tournament-media'::text |
| internal_path | text | True | None |
| safe_name | text | True | None |
| detected_mime | text | True | None |
| byte_size | bigint | True | None |
| width | integer | True | None |
| height | integer | True | None |
| checksum_sha256 | text | True | None |
| status | text | True | 'pending_review'::text |
| uploaded_by | uuid | True | None |
| approved_by | uuid | False | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |
| approved_at | timestamp with time zone | False | None |
| published_at | timestamp with time zone | False | None |
| hidden_at | timestamp with time zone | False | None |
| revoked_at | timestamp with time zone | False | None |
| failure_code | text | False | None |
| processing_tier | text | True | 'processor_external'::text |
| storage_state | text | True | 'active'::text |
| retention_marked_at | timestamp with time zone | False | None |
| storage_purged_at | timestamp with time zone | False | None |
| retention_reason | text | False | None |
| metadata_stripped | boolean | False | None |
| normalization_verified_at | timestamp with time zone | False | None |

Constraints:

- `tournament_media_assets_approved_by_fkey`: `FOREIGN KEY (approved_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_media_assets_checksum_check`: `CHECK ((checksum_sha256 ~ '^[0-9a-f]{64}$'::text))`
- `tournament_media_assets_dimensions_check`: `CHECK (((width >= 1) AND (width <= 12000) AND ((height >= 1) AND (height <= 12000)) AND (((width)::bigint * (height)::bigint) <= 36000000)))`
- `tournament_media_assets_failure_check`: `CHECK (((failure_code IS NULL) OR (failure_code ~ '^[A-Z][A-Z0-9_]{2,80}$'::text)))`
- `tournament_media_assets_gallery_fk`: `FOREIGN KEY (organization_id, tournament_id, gallery_id) REFERENCES tournament_media_galleries(organization_id, tournament_id, id) ON DELETE RESTRICT`
- `tournament_media_assets_gallery_id_unique`: `UNIQUE (gallery_id, id)`
- `tournament_media_assets_mime_check`: `CHECK ((detected_mime = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text])))`
- `tournament_media_assets_mvp_limits_check`: `CHECK (((processing_tier <> 'mvp_simple'::text) OR ((byte_size >= 1) AND (byte_size <= 4194304) AND ((width >= 1) AND (width <= 1600)) AND ((height >= 1) AND (height <= 1600)) AND (((width)::bigint * (height)::bigint) <= 2560000))))`
- `tournament_media_assets_path_check`: `CHECK (((internal_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'::text) AND (internal_path !~~ '%..%'::text)))`
- `tournament_media_assets_path_unique`: `UNIQUE (bucket, internal_path)`
- `tournament_media_assets_pkey`: `PRIMARY KEY (id)`
- `tournament_media_assets_processing_tier_check`: `CHECK ((processing_tier = ANY (ARRAY['processor_external'::text, 'mvp_simple'::text])))`
- `tournament_media_assets_provider_check`: `CHECK (((provider = 'supabase'::text) AND (bucket = 'tournament-media'::text)))`
- `tournament_media_assets_retention_reason_check`: `CHECK (((retention_reason IS NULL) OR ((retention_reason = btrim(retention_reason)) AND ((char_length(retention_reason) >= 8) AND (char_length(retention_reason) <= 240)))))`
- `tournament_media_assets_safe_name_check`: `CHECK ((safe_name ~ '^foto-[0-9a-f]{12}\.(jpg|png|webp)$'::text))`
- `tournament_media_assets_simple_normalization_check`: `CHECK (((processing_tier <> 'mvp_simple'::text) OR ((metadata_stripped IS TRUE) AND (normalization_verified_at IS NOT NULL)))) NOT VALID`
- `tournament_media_assets_size_check`: `CHECK (((byte_size >= 1) AND (byte_size <= 12582912)))`
- `tournament_media_assets_status_check`: `CHECK ((status = ANY (ARRAY['uploading'::text, 'processing'::text, 'pending_review'::text, 'approved'::text, 'published'::text, 'rejected'::text, 'hidden'::text, 'revoked'::text, 'failed'::text])))`
- `tournament_media_assets_storage_lifecycle_check`: `CHECK ((((storage_state = 'active'::text) AND (retention_marked_at IS NULL) AND (storage_purged_at IS NULL) AND (retention_reason IS NULL)) OR ((storage_state = 'retention_marked'::text) AND (retention_marked_at IS NOT NULL) AND (storage_purged_at IS NULL) AND (retention_reason IS NOT NULL)) OR ((storage_state = 'storage_purged'::text) AND (retention_marked_at IS NOT NULL) AND (storage_purged_at IS NOT NULL) AND (storage_purged_at >= retention_marked_at) AND (retention_reason IS NOT NULL))))`
- `tournament_media_assets_storage_state_check`: `CHECK ((storage_state = ANY (ARRAY['active'::text, 'retention_marked'::text, 'storage_purged'::text])))`
- `tournament_media_assets_uploaded_by_fkey`: `FOREIGN KEY (uploaded_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`

### tournament_media_assignments

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'anon=r/supabase_admin', 'authenticated=arwd/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| gallery_id | uuid | True | None |
| user_id | uuid | True | None |
| role | text | True | 'photographer'::text |
| can_upload | boolean | True | true |
| status | text | True | 'active'::text |
| assigned_by | uuid | True | None |
| created_at | timestamp with time zone | True | now() |
| revoked_at | timestamp with time zone | False | None |

Constraints:

- `tournament_media_assignments_assigned_by_fkey`: `FOREIGN KEY (assigned_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_media_assignments_gallery_fk`: `FOREIGN KEY (organization_id, tournament_id, gallery_id) REFERENCES tournament_media_galleries(organization_id, tournament_id, id) ON DELETE RESTRICT`
- `tournament_media_assignments_pkey`: `PRIMARY KEY (id)`
- `tournament_media_assignments_revocation_check`: `CHECK ((((status = 'revoked'::text) AND (revoked_at IS NOT NULL)) OR ((status = 'active'::text) AND (revoked_at IS NULL))))`
- `tournament_media_assignments_role_check`: `CHECK ((role = 'photographer'::text))`
- `tournament_media_assignments_status_check`: `CHECK ((status = ANY (ARRAY['active'::text, 'revoked'::text])))`
- `tournament_media_assignments_unique`: `UNIQUE (gallery_id, user_id)`
- `tournament_media_assignments_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES torneos_identity(id) ON DELETE RESTRICT`

### tournament_media_consent_events

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'anon=r/supabase_admin', 'authenticated=arwd/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | bigint | True | None |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| consent_id | uuid | True | None |
| asset_id | uuid | True | None |
| roster_player_id | uuid | False | None |
| subject_user_id | uuid | False | None |
| use_scope | text | True | None |
| previous_status | text | False | None |
| resulting_status | text | True | None |
| legal_basis | text | False | None |
| actor_user_id | uuid | True | None |
| created_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_media_consent_events_actor_user_id_fkey`: `FOREIGN KEY (actor_user_id) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_media_consent_events_asset_id_fkey`: `FOREIGN KEY (asset_id) REFERENCES tournament_media_assets(id) ON DELETE RESTRICT`
- `tournament_media_consent_events_consent_id_fkey`: `FOREIGN KEY (consent_id) REFERENCES tournament_media_consents(id) ON DELETE RESTRICT`
- `tournament_media_consent_events_pkey`: `PRIMARY KEY (id)`
- `tournament_media_consent_events_roster_player_id_fkey`: `FOREIGN KEY (roster_player_id) REFERENCES tournament_roster_players(id) ON DELETE RESTRICT`
- `tournament_media_consent_events_status_check`: `CHECK ((((previous_status IS NULL) OR (previous_status = ANY (ARRAY['unknown'::text, 'allowed'::text, 'denied'::text, 'revoked'::text, 'not_required'::text]))) AND (resulting_status = ANY (ARRAY['unknown'::text, 'allowed'::text, 'denied'::text, 'revoked'::text, 'not_required'::text]))))`
- `tournament_media_consent_events_subject_check`: `CHECK (((roster_player_id IS NOT NULL) OR (subject_user_id IS NOT NULL)))`
- `tournament_media_consent_events_subject_user_id_fkey`: `FOREIGN KEY (subject_user_id) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_media_consent_events_use_check`: `CHECK ((use_scope = ANY (ARRAY['view_internal'::text, 'share_internal'::text, 'social_future'::text, 'promotion_future'::text, 'commercial'::text])))`

### tournament_media_consents

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'anon=r/supabase_admin', 'authenticated=arwd/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| asset_id | uuid | True | None |
| roster_player_id | uuid | False | None |
| subject_user_id | uuid | False | None |
| use_scope | text | True | None |
| status | text | True | 'unknown'::text |
| legal_basis | text | False | None |
| managed_by | uuid | True | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |
| revoked_at | timestamp with time zone | False | None |

Constraints:

- `tournament_media_consents_asset_id_fkey`: `FOREIGN KEY (asset_id) REFERENCES tournament_media_assets(id) ON DELETE RESTRICT`
- `tournament_media_consents_legal_basis_check`: `CHECK ((((status = 'not_required'::text) AND (legal_basis IS NOT NULL) AND (legal_basis = btrim(legal_basis)) AND ((char_length(legal_basis) >= 10) AND (char_length(legal_basis) <= 1000))) OR ((status <> 'not_required'::text) AND (legal_basis IS NULL))))`
- `tournament_media_consents_managed_by_fkey`: `FOREIGN KEY (managed_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_media_consents_pkey`: `PRIMARY KEY (id)`
- `tournament_media_consents_revocation_check`: `CHECK ((((status = 'revoked'::text) AND (revoked_at IS NOT NULL)) OR ((status <> 'revoked'::text) AND (revoked_at IS NULL))))`
- `tournament_media_consents_roster_player_id_fkey`: `FOREIGN KEY (roster_player_id) REFERENCES tournament_roster_players(id) ON DELETE RESTRICT`
- `tournament_media_consents_status_check`: `CHECK ((status = ANY (ARRAY['unknown'::text, 'allowed'::text, 'denied'::text, 'revoked'::text, 'not_required'::text])))`
- `tournament_media_consents_subject_check`: `CHECK (((roster_player_id IS NOT NULL) OR (subject_user_id IS NOT NULL)))`
- `tournament_media_consents_subject_user_id_fkey`: `FOREIGN KEY (subject_user_id) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_media_consents_use_check`: `CHECK ((use_scope = ANY (ARRAY['view_internal'::text, 'share_internal'::text, 'social_future'::text, 'promotion_future'::text, 'commercial'::text])))`

### tournament_media_galleries

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'anon=r/supabase_admin', 'authenticated=arwd/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| season_id | uuid | True | None |
| tournament_id | uuid | True | None |
| category_id | uuid | False | None |
| round_id | uuid | False | None |
| match_id | uuid | False | None |
| title | text | True | None |
| description | text | False | None |
| status | text | True | 'draft'::text |
| visibility | text | True | 'tournament_participants'::text |
| cover_asset_id | uuid | False | None |
| minor_restriction | boolean | True | true |
| created_by | uuid | True | None |
| published_by | uuid | False | None |
| version | integer | True | 1 |
| idempotency_key | uuid | True | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |
| submitted_at | timestamp with time zone | False | None |
| published_at | timestamp with time zone | False | None |
| archived_at | timestamp with time zone | False | None |
| revoked_at | timestamp with time zone | False | None |

Constraints:

- `tournament_media_galleries_category_id_fkey`: `FOREIGN KEY (category_id) REFERENCES tournament_categories(id) ON DELETE RESTRICT`
- `tournament_media_galleries_cover_fk`: `FOREIGN KEY (cover_asset_id) REFERENCES tournament_media_assets(id) ON DELETE RESTRICT`
- `tournament_media_galleries_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_media_galleries_creation_unique`: `UNIQUE (organization_id, created_by, idempotency_key)`
- `tournament_media_galleries_description_check`: `CHECK (((description IS NULL) OR ((description = btrim(description)) AND (char_length(description) <= 1200))))`
- `tournament_media_galleries_lifecycle_check`: `CHECK ((((status = 'draft'::text) AND (submitted_at IS NULL) AND (published_at IS NULL) AND (archived_at IS NULL) AND (revoked_at IS NULL)) OR ((status = 'under_review'::text) AND (submitted_at IS NOT NULL) AND (published_at IS NULL) AND (archived_at IS NULL) AND (revoked_at IS NULL)) OR ((status = 'published'::text) AND (submitted_at IS NOT NULL) AND (published_at IS NOT NULL) AND (published_by IS NOT NULL) AND (archived_at IS NULL) AND (revoked_at IS NULL)) OR ((status = 'archived'::text) AND (archived_at IS NOT NULL) AND (revoked_at IS NULL)) OR ((status = 'revoked'::text) AND (revoked_at IS NOT NULL))))`
- `tournament_media_galleries_match_id_fkey`: `FOREIGN KEY (match_id) REFERENCES tournament_matches(id) ON DELETE RESTRICT`
- `tournament_media_galleries_organization_id_fkey`: `FOREIGN KEY (organization_id) REFERENCES tournament_organizations(id) ON DELETE RESTRICT`
- `tournament_media_galleries_pkey`: `PRIMARY KEY (id)`
- `tournament_media_galleries_published_by_fkey`: `FOREIGN KEY (published_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_media_galleries_round_id_fkey`: `FOREIGN KEY (round_id) REFERENCES tournament_rounds(id) ON DELETE RESTRICT`
- `tournament_media_galleries_scope_unique`: `UNIQUE (organization_id, tournament_id, id)`
- `tournament_media_galleries_season_id_fkey`: `FOREIGN KEY (season_id) REFERENCES tournament_seasons(id) ON DELETE RESTRICT`
- `tournament_media_galleries_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'under_review'::text, 'published'::text, 'archived'::text, 'revoked'::text])))`
- `tournament_media_galleries_title_check`: `CHECK (((title = btrim(title)) AND ((char_length(title) >= 3) AND (char_length(title) <= 120))))`
- `tournament_media_galleries_tournament_fk`: `FOREIGN KEY (organization_id, tournament_id, season_id) REFERENCES tournaments(organization_id, id, season_id) ON DELETE RESTRICT`
- `tournament_media_galleries_version_check`: `CHECK ((version > 0))`
- `tournament_media_galleries_visibility_check`: `CHECK ((visibility = ANY (ARRAY['organization'::text, 'tournament_participants'::text, 'match_participants'::text, 'related_teams'::text, 'administrative_private'::text])))`

### tournament_media_gallery_items

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'anon=r/supabase_admin', 'authenticated=arwd/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| gallery_id | uuid | True | None |
| asset_id | uuid | True | None |
| sort_order | integer | True | 0 |
| caption | text | False | None |
| added_by | uuid | True | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_media_gallery_items_added_by_fkey`: `FOREIGN KEY (added_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_media_gallery_items_asset_fk`: `FOREIGN KEY (gallery_id, asset_id) REFERENCES tournament_media_assets(gallery_id, id) ON DELETE RESTRICT`
- `tournament_media_gallery_items_caption_check`: `CHECK (((caption IS NULL) OR ((caption = btrim(caption)) AND (char_length(caption) <= 500))))`
- `tournament_media_gallery_items_gallery_fk`: `FOREIGN KEY (organization_id, tournament_id, gallery_id) REFERENCES tournament_media_galleries(organization_id, tournament_id, id) ON DELETE RESTRICT`
- `tournament_media_gallery_items_order_check`: `CHECK ((sort_order >= 0))`
- `tournament_media_gallery_items_order_unique`: `UNIQUE (gallery_id, sort_order)`
- `tournament_media_gallery_items_pkey`: `PRIMARY KEY (id)`
- `tournament_media_gallery_items_unique`: `UNIQUE (gallery_id, asset_id)`

### tournament_media_moderation_actions

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'anon=r/supabase_admin', 'authenticated=arwd/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | bigint | True | None |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| gallery_id | uuid | True | None |
| asset_id | uuid | True | None |
| action | text | True | None |
| previous_status | text | True | None |
| resulting_status | text | True | None |
| reason | text | False | None |
| actor_user_id | uuid | True | None |
| created_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_media_moderation_actions_action_check`: `CHECK ((action = ANY (ARRAY['approve'::text, 'reject'::text, 'hide'::text, 'restore'::text, 'revoke'::text, 'request_deletion'::text])))`
- `tournament_media_moderation_actions_actor_user_id_fkey`: `FOREIGN KEY (actor_user_id) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_media_moderation_actions_asset_fk`: `FOREIGN KEY (gallery_id, asset_id) REFERENCES tournament_media_assets(gallery_id, id) ON DELETE RESTRICT`
- `tournament_media_moderation_actions_pkey`: `PRIMARY KEY (id)`
- `tournament_media_moderation_actions_reason_check`: `CHECK (((reason IS NULL) OR ((reason = btrim(reason)) AND ((char_length(reason) >= 3) AND (char_length(reason) <= 1000)))))`
- `tournament_media_moderation_actions_status_check`: `CHECK (((previous_status = ANY (ARRAY['pending_review'::text, 'approved'::text, 'published'::text, 'rejected'::text, 'hidden'::text, 'revoked'::text])) AND (resulting_status = ANY (ARRAY['approved'::text, 'published'::text, 'rejected'::text, 'hidden'::text, 'revoked'::text]))))`

### tournament_media_pipeline_configuration

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'service_role=arw/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| singleton | boolean | True | true |
| mode | text | True | 'PROCESSOR_EXTERNAL'::text |
| updated_at | timestamp with time zone | True | now() |
| updated_by | uuid | False | None |

Constraints:

- `tournament_media_pipeline_configuration_mode_check`: `CHECK ((mode = ANY (ARRAY['DISABLED'::text, 'MVP_SIMPLE'::text, 'PROCESSOR_EXTERNAL'::text])))`
- `tournament_media_pipeline_configuration_pkey`: `PRIMARY KEY (singleton)`
- `tournament_media_pipeline_configuration_singleton_check`: `CHECK (singleton)`

### tournament_media_processing_jobs

RLS: True; FORCE RLS: False. ACL: `None`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| session_id | uuid | True | None |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| gallery_id | uuid | True | None |
| requested_by | uuid | True | None |
| bucket | text | True | 'tournament-media'::text |
| quarantine_path | text | True | None |
| declared_mime | text | True | None |
| expected_bytes | bigint | True | None |
| status | text | True | 'queued'::text |
| attempts | integer | True | 0 |
| max_attempts | integer | True | 3 |
| lease_token | text | False | None |
| lease_expires_at | timestamp with time zone | False | None |
| worker_id | text | False | None |
| last_error | text | False | None |
| asset_id | uuid | False | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_media_processing_jobs_attempts_check`: `CHECK (((attempts >= 0) AND ((max_attempts >= 1) AND (max_attempts <= 10)) AND (attempts <= max_attempts)))`
- `tournament_media_processing_jobs_bytes_check`: `CHECK (((expected_bytes >= 1) AND (expected_bytes <= 12582912)))`
- `tournament_media_processing_jobs_error_check`: `CHECK (((last_error IS NULL) OR (last_error ~ '^[A-Z][A-Z0-9_]{2,80}$'::text)))`
- `tournament_media_processing_jobs_lease_check`: `CHECK ((((status = 'leased'::text) AND (lease_token ~ '^[0-9a-f]{64}$'::text) AND (lease_expires_at IS NOT NULL) AND (worker_id IS NOT NULL)) OR ((status <> 'leased'::text) AND (lease_token IS NULL) AND (lease_expires_at IS NULL))))`
- `tournament_media_processing_jobs_mime_check`: `CHECK ((declared_mime = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text])))`
- `tournament_media_processing_jobs_path_check`: `CHECK (((quarantine_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'::text) AND (quarantine_path !~~ '%..%'::text)))`
- `tournament_media_processing_jobs_pkey`: `PRIMARY KEY (id)`
- `tournament_media_processing_jobs_provider_check`: `CHECK ((bucket = 'tournament-media'::text))`
- `tournament_media_processing_jobs_session_key`: `UNIQUE (session_id)`
- `tournament_media_processing_jobs_status_check`: `CHECK ((status = ANY (ARRAY['queued'::text, 'leased'::text, 'succeeded'::text, 'failed'::text, 'abandoned'::text])))`
- `tournament_media_processing_jobs_worker_check`: `CHECK (((worker_id IS NULL) OR (worker_id ~ '^[a-z0-9][a-z0-9._:-]{2,60}$'::text)))`

### tournament_media_relations

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'anon=r/supabase_admin', 'authenticated=arwd/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| category_id | uuid | False | None |
| asset_id | uuid | True | None |
| relation_type | text | True | None |
| match_id | uuid | False | None |
| team_entry_id | uuid | False | None |
| roster_player_id | uuid | False | None |
| created_by | uuid | True | None |
| created_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_media_relations_asset_id_fkey`: `FOREIGN KEY (asset_id) REFERENCES tournament_media_assets(id) ON DELETE RESTRICT`
- `tournament_media_relations_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_media_relations_exact_target_check`: `CHECK ((((relation_type = 'match'::text) AND (match_id IS NOT NULL) AND (team_entry_id IS NULL) AND (roster_player_id IS NULL)) OR ((relation_type = 'team'::text) AND (match_id IS NULL) AND (team_entry_id IS NOT NULL) AND (roster_player_id IS NULL)) OR ((relation_type = 'player'::text) AND (match_id IS NULL) AND (team_entry_id IS NOT NULL) AND (roster_player_id IS NOT NULL))))`
- `tournament_media_relations_match_id_fkey`: `FOREIGN KEY (match_id) REFERENCES tournament_matches(id) ON DELETE RESTRICT`
- `tournament_media_relations_pkey`: `PRIMARY KEY (id)`
- `tournament_media_relations_roster_player_id_fkey`: `FOREIGN KEY (roster_player_id) REFERENCES tournament_roster_players(id) ON DELETE RESTRICT`
- `tournament_media_relations_team_entry_id_fkey`: `FOREIGN KEY (team_entry_id) REFERENCES tournament_team_entries(id) ON DELETE RESTRICT`
- `tournament_media_relations_type_check`: `CHECK ((relation_type = ANY (ARRAY['match'::text, 'team'::text, 'player'::text])))`

### tournament_media_reports

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'anon=r/supabase_admin', 'authenticated=arwd/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| gallery_id | uuid | True | None |
| asset_id | uuid | True | None |
| reporter_user_id | uuid | True | None |
| reason | text | True | None |
| detail | text | False | None |
| request_hide | boolean | True | false |
| status | text | True | 'open'::text |
| idempotency_key | uuid | True | None |
| handled_by | uuid | False | None |
| resolution | text | False | None |
| created_at | timestamp with time zone | True | now() |
| handled_at | timestamp with time zone | False | None |

Constraints:

- `tournament_media_reports_asset_fk`: `FOREIGN KEY (gallery_id, asset_id) REFERENCES tournament_media_assets(gallery_id, id) ON DELETE RESTRICT`
- `tournament_media_reports_detail_check`: `CHECK (((detail IS NULL) OR ((detail = btrim(detail)) AND ((char_length(detail) >= 3) AND (char_length(detail) <= 1000)))))`
- `tournament_media_reports_handled_by_fkey`: `FOREIGN KEY (handled_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_media_reports_pkey`: `PRIMARY KEY (id)`
- `tournament_media_reports_reason_check`: `CHECK ((reason = ANY (ARRAY['do_not_want_to_appear'::text, 'incorrect_identification'::text, 'privacy'::text, 'inappropriate_content'::text, 'other'::text])))`
- `tournament_media_reports_reporter_user_id_fkey`: `FOREIGN KEY (reporter_user_id) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_media_reports_request_unique`: `UNIQUE (reporter_user_id, idempotency_key)`
- `tournament_media_reports_resolution_check`: `CHECK ((((status = ANY (ARRAY['resolved'::text, 'dismissed'::text])) AND (handled_by IS NOT NULL) AND (handled_at IS NOT NULL) AND (resolution IS NOT NULL) AND (resolution = btrim(resolution)) AND ((char_length(resolution) >= 3) AND (char_length(resolution) <= 1000))) OR ((status = ANY (ARRAY['open'::text, 'under_review'::text])) AND (handled_at IS NULL))))`
- `tournament_media_reports_status_check`: `CHECK ((status = ANY (ARRAY['open'::text, 'under_review'::text, 'resolved'::text, 'dismissed'::text])))`

### tournament_media_service_attestations

RLS: True; FORCE RLS: False. ACL: `None`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| service | text | True | None |
| release | text | True | None |
| capabilities | jsonb | True | None |
| attested_at | timestamp with time zone | True | now() |
| expires_at | timestamp with time zone | True | None |

Constraints:

- `tournament_media_service_attestations_capabilities_check`: `CHECK (((jsonb_typeof(capabilities) = 'object'::text) AND (pg_column_size(capabilities) <= 4096)))`
- `tournament_media_service_attestations_expiry_check`: `CHECK (((expires_at > attested_at) AND (expires_at <= (attested_at + '24:00:00'::interval))))`
- `tournament_media_service_attestations_pkey`: `PRIMARY KEY (service)`
- `tournament_media_service_attestations_release_check`: `CHECK ((release ~ '^[a-z0-9][a-z0-9._-]{0,60}$'::text))`
- `tournament_media_service_attestations_service_check`: `CHECK ((service = ANY (ARRAY['signer'::text, 'processor'::text])))`

### tournament_media_upload_sessions

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'anon=r/supabase_admin', 'authenticated=arwd/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| gallery_id | uuid | True | None |
| requested_by | uuid | True | None |
| token_hash | text | True | None |
| provider | text | True | 'supabase'::text |
| bucket | text | True | 'tournament-media'::text |
| internal_path | text | True | None |
| safe_name | text | True | None |
| requested_mime | text | True | None |
| requested_size | bigint | True | None |
| max_size | bigint | True | 12582912 |
| status | text | True | 'issued'::text |
| idempotency_key | uuid | True | None |
| quota_snapshot | jsonb | True | None |
| created_at | timestamp with time zone | True | now() |
| expires_at | timestamp with time zone | True | None |
| consumed_at | timestamp with time zone | False | None |
| asset_id | uuid | False | None |
| processing_tier | text | True | 'processor_external'::text |

Constraints:

- `tournament_media_upload_sessions_asset_id_fkey`: `FOREIGN KEY (asset_id) REFERENCES tournament_media_assets(id) ON DELETE RESTRICT`
- `tournament_media_upload_sessions_consumption_check`: `CHECK ((((status = 'consumed'::text) AND (consumed_at IS NOT NULL) AND (asset_id IS NOT NULL)) OR ((status <> 'consumed'::text) AND (consumed_at IS NULL) AND (asset_id IS NULL))))`
- `tournament_media_upload_sessions_expiry_check`: `CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '00:15:00'::interval))))`
- `tournament_media_upload_sessions_gallery_fk`: `FOREIGN KEY (organization_id, tournament_id, gallery_id) REFERENCES tournament_media_galleries(organization_id, tournament_id, id) ON DELETE RESTRICT`
- `tournament_media_upload_sessions_mime_check`: `CHECK ((requested_mime = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text])))`
- `tournament_media_upload_sessions_mvp_limits_check`: `CHECK (((processing_tier <> 'mvp_simple'::text) OR ((requested_size >= 1) AND (requested_size <= 4194304) AND (max_size = 4194304))))`
- `tournament_media_upload_sessions_path_check`: `CHECK (((internal_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'::text) AND (internal_path !~~ '%..%'::text)))`
- `tournament_media_upload_sessions_pkey`: `PRIMARY KEY (id)`
- `tournament_media_upload_sessions_processing_tier_check`: `CHECK ((processing_tier = ANY (ARRAY['processor_external'::text, 'mvp_simple'::text])))`
- `tournament_media_upload_sessions_provider_check`: `CHECK (((provider = 'supabase'::text) AND (bucket = 'tournament-media'::text)))`
- `tournament_media_upload_sessions_quota_check`: `CHECK (((jsonb_typeof(quota_snapshot) = 'object'::text) AND (pg_column_size(quota_snapshot) <= 4096)))`
- `tournament_media_upload_sessions_requested_by_fkey`: `FOREIGN KEY (requested_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_media_upload_sessions_safe_name_check`: `CHECK ((safe_name ~ '^foto-[0-9a-f]{12}\.(jpg|png|webp)$'::text))`
- `tournament_media_upload_sessions_size_check`: `CHECK (((requested_size >= 1) AND (requested_size <= max_size) AND (max_size <= 12582912)))`
- `tournament_media_upload_sessions_status_check`: `CHECK ((status = ANY (ARRAY['issued'::text, 'uploaded'::text, 'consumed'::text, 'expired'::text, 'revoked'::text, 'failed'::text])))`
- `tournament_media_upload_sessions_token_check`: `CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text))`
- `tournament_media_upload_sessions_token_unique`: `UNIQUE (token_hash)`

### tournament_media_variants

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'anon=r/supabase_admin', 'authenticated=arwd/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| asset_id | uuid | True | None |
| kind | text | True | None |
| provider | text | True | 'supabase'::text |
| bucket | text | True | 'tournament-media'::text |
| internal_path | text | True | None |
| detected_mime | text | True | None |
| byte_size | bigint | False | None |
| width | integer | False | None |
| height | integer | False | None |
| checksum_sha256 | text | False | None |
| metadata_stripped | boolean | True | true |
| status | text | True | 'ready'::text |
| created_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_media_variants_asset_id_fkey`: `FOREIGN KEY (asset_id) REFERENCES tournament_media_assets(id) ON DELETE RESTRICT`
- `tournament_media_variants_kind_check`: `CHECK ((kind = ANY (ARRAY['thumbnail'::text, 'grid'::text, 'detail'::text, 'original'::text])))`
- `tournament_media_variants_mime_check`: `CHECK ((detected_mime = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text])))`
- `tournament_media_variants_path_check`: `CHECK (((internal_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}-(thumbnail|grid|detail|original)\.(jpg|png|webp)$'::text) AND (internal_path !~~ '%..%'::text)))`
- `tournament_media_variants_path_unique`: `UNIQUE (bucket, internal_path)`
- `tournament_media_variants_payload_check`: `CHECK ((((status = 'processing'::text) AND (byte_size IS NULL) AND (width IS NULL) AND (height IS NULL) AND (checksum_sha256 IS NULL)) OR ((status = ANY (ARRAY['ready'::text, 'failed'::text, 'revoked'::text])) AND ((byte_size >= 1) AND (byte_size <= 12582912)) AND (width > 0) AND (height > 0) AND (((width)::bigint * (height)::bigint) <= 36000000) AND (checksum_sha256 ~ '^[0-9a-f]{64}$'::text))))`
- `tournament_media_variants_pkey`: `PRIMARY KEY (id)`
- `tournament_media_variants_provider_check`: `CHECK (((provider = 'supabase'::text) AND (bucket = 'tournament-media'::text)))`
- `tournament_media_variants_status_check`: `CHECK ((status = ANY (ARRAY['processing'::text, 'ready'::text, 'failed'::text, 'revoked'::text])))`
- `tournament_media_variants_unique`: `UNIQUE (asset_id, kind)`

### tournament_notification_preferences

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'anon=r/supabase_admin', 'authenticated=arwd/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| user_id | uuid | True | None |
| general_enabled | boolean | True | true |
| match_changes_enabled | boolean | True | true |
| callups_enabled | boolean | True | true |
| discipline_enabled | boolean | True | true |
| documents_enabled | boolean | True | true |
| summaries_enabled | boolean | True | true |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_notification_preferences_org_id_unique`: `UNIQUE (organization_id, id)`
- `tournament_notification_preferences_pkey`: `PRIMARY KEY (id)`
- `tournament_notification_preferences_tournament_fk`: `FOREIGN KEY (organization_id, tournament_id) REFERENCES tournaments(organization_id, id) ON DELETE CASCADE`
- `tournament_notification_preferences_unique`: `UNIQUE (tournament_id, user_id)`
- `tournament_notification_preferences_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES torneos_identity(id) ON DELETE CASCADE`

### tournament_organization_entitlement_overrides

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'service_role=r/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| capability | text | True | None |
| enabled | boolean | True | None |
| expires_at | timestamp with time zone | False | None |
| reason | text | True | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_organization_entitlement_overri_organization_id_fkey`: `FOREIGN KEY (organization_id) REFERENCES tournament_organizations(id) ON DELETE RESTRICT`
- `tournament_organization_entitlement_overrides_capability_fkey`: `FOREIGN KEY (capability) REFERENCES tournament_entitlement_capabilities(capability) ON DELETE RESTRICT`
- `tournament_organization_entitlement_overrides_pkey`: `PRIMARY KEY (id)`
- `tournament_organization_entitlement_overrides_reason_check`: `CHECK (((reason = btrim(reason)) AND ((char_length(reason) >= 8) AND (char_length(reason) <= 500))))`
- `tournament_organization_entitlement_overrides_unique`: `UNIQUE (organization_id, capability)`

### tournament_organization_members

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| user_id | uuid | True | None |
| role | text | True | None |
| status | text | True | 'active'::text |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |
| invited_by | uuid | False | None |
| joined_at | timestamp with time zone | True | None |

Constraints:

- `tournament_organization_members_invited_by_fkey`: `FOREIGN KEY (invited_by) REFERENCES torneos_identity(id) ON DELETE SET NULL`
- `tournament_organization_members_organization_id_fkey`: `FOREIGN KEY (organization_id) REFERENCES tournament_organizations(id) ON DELETE RESTRICT`
- `tournament_organization_members_pkey`: `PRIMARY KEY (id)`
- `tournament_organization_members_role_check`: `CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'collaborator'::text])))`
- `tournament_organization_members_status_check`: `CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'removed'::text])))`
- `tournament_organization_members_unique`: `UNIQUE (organization_id, user_id)`
- `tournament_organization_members_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES torneos_identity(id) ON DELETE RESTRICT`

### tournament_organization_plan_state

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'service_role=r/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| organization_id | uuid | True | None |
| first_free_consumed_at | timestamp with time zone | True | None |
| first_free_tournament_id | uuid | False | None |
| initialization_source | text | True | None |
| created_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_organization_plan_state_organization_id_fkey`: `FOREIGN KEY (organization_id) REFERENCES tournament_organizations(id) ON DELETE RESTRICT`
- `tournament_organization_plan_state_pkey`: `PRIMARY KEY (organization_id)`
- `tournament_organization_plan_state_shape_check`: `CHECK ((((initialization_source = 'first_free'::text) AND (first_free_tournament_id IS NOT NULL)) OR ((initialization_source = 'legacy_backfill'::text) AND (first_free_tournament_id IS NULL))))`
- `tournament_organization_plan_state_source_check`: `CHECK ((initialization_source = ANY (ARRAY['first_free'::text, 'legacy_backfill'::text])))`
- `tournament_organization_plan_state_tournament_fk`: `FOREIGN KEY (organization_id, first_free_tournament_id) REFERENCES tournaments(organization_id, id) ON DELETE RESTRICT`

### tournament_organization_role_capabilities

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'service_role=r/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| role | text | True | None |
| capability | text | True | None |
| created_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_organization_role_capabilities_capability_check`: `CHECK ((capability ~ '^[a-z][a-z0-9_.]{2,80}$'::text))`
- `tournament_organization_role_capabilities_pkey`: `PRIMARY KEY (role, capability)`
- `tournament_organization_role_capabilities_role_check`: `CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'collaborator'::text])))`

### tournament_organizations

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| name | text | True | None |
| slug | text | True | None |
| logo_path | text | False | None |
| status | text | True | 'active'::text |
| created_by | uuid | True | None |
| creation_key | uuid | True | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |
| archived_at | timestamp with time zone | False | None |

Constraints:

- `tournament_organizations_archive_state_check`: `CHECK ((((status = 'active'::text) AND (archived_at IS NULL)) OR ((status = 'archived'::text) AND (archived_at IS NOT NULL))))`
- `tournament_organizations_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_organizations_creation_unique`: `UNIQUE (created_by, creation_key)`
- `tournament_organizations_logo_path_check`: `CHECK (((logo_path IS NULL) OR (logo_path ~ (((('^'::text || (id)::text) || '/organizations/'::text) || (id)::text) || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'::text))))`
- `tournament_organizations_name_check`: `CHECK (((name = btrim(name)) AND ((char_length(name) >= 3) AND (char_length(name) <= 80))))`
- `tournament_organizations_pkey`: `PRIMARY KEY (id)`
- `tournament_organizations_slug_check`: `CHECK (((slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'::text) AND ((char_length(slug) >= 3) AND (char_length(slug) <= 48))))`
- `tournament_organizations_slug_unique`: `UNIQUE (slug)`
- `tournament_organizations_status_check`: `CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))`

### tournament_participant_hub_preferences

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'anon=r/supabase_admin', 'authenticated=arwd/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| user_id | uuid | True | None |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| category_id | uuid | True | None |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_participant_hub_preferences_category_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id) REFERENCES tournament_categories(organization_id, tournament_id, id) ON DELETE CASCADE`
- `tournament_participant_hub_preferences_pkey`: `PRIMARY KEY (user_id, tournament_id)`
- `tournament_participant_hub_preferences_tournament_fk`: `FOREIGN KEY (organization_id, tournament_id) REFERENCES tournaments(organization_id, id) ON DELETE CASCADE`
- `tournament_participant_hub_preferences_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES torneos_identity(id) ON DELETE CASCADE`

### tournament_participant_sets

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| season_id | uuid | True | None |
| tournament_id | uuid | True | None |
| category_id | uuid | True | None |
| version_number | integer | True | None |
| status | text | True | 'frozen'::text |
| participant_fingerprint | text | True | None |
| frozen_by | uuid | True | None |
| frozen_at | timestamp with time zone | True | now() |
| reopened_by | uuid | False | None |
| reopened_at | timestamp with time zone | False | None |
| reopen_reason | text | False | None |
| invalidated_at | timestamp with time zone | False | None |
| idempotency_key | uuid | True | None |
| created_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_participant_sets_category_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id) REFERENCES tournament_categories(organization_id, tournament_id, id) ON DELETE RESTRICT`
- `tournament_participant_sets_fingerprint_check`: `CHECK ((participant_fingerprint ~ '^[0-9a-f]{64}$'::text))`
- `tournament_participant_sets_frozen_by_fkey`: `FOREIGN KEY (frozen_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_participant_sets_idempotency_unique`: `UNIQUE (organization_id, frozen_by, idempotency_key)`
- `tournament_participant_sets_pkey`: `PRIMARY KEY (id)`
- `tournament_participant_sets_reopen_check`: `CHECK ((((status = ANY (ARRAY['reopened'::text, 'superseded'::text])) AND (reopened_by IS NOT NULL) AND (reopened_at IS NOT NULL) AND (invalidated_at IS NOT NULL) AND ((char_length(btrim(reopen_reason)) >= 3) AND (char_length(btrim(reopen_reason)) <= 500))) OR ((status = 'frozen'::text) AND (reopened_by IS NULL) AND (reopened_at IS NULL) AND (reopen_reason IS NULL))))`
- `tournament_participant_sets_reopened_by_fkey`: `FOREIGN KEY (reopened_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_participant_sets_scope_unique`: `UNIQUE (organization_id, tournament_id, category_id, id)`
- `tournament_participant_sets_status_check`: `CHECK ((status = ANY (ARRAY['frozen'::text, 'reopened'::text, 'superseded'::text])))`
- `tournament_participant_sets_tournament_fk`: `FOREIGN KEY (organization_id, tournament_id, season_id) REFERENCES tournaments(organization_id, id, season_id) ON DELETE RESTRICT`
- `tournament_participant_sets_version_check`: `CHECK ((version_number > 0))`
- `tournament_participant_sets_version_unique`: `UNIQUE (tournament_id, category_id, version_number)`

### tournament_phases

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| category_id | uuid | True | None |
| fixture_version_id | uuid | True | None |
| name | text | True | None |
| phase_type | text | True | None |
| sequence_number | integer | True | None |
| status | text | True | 'draft'::text |
| configuration | jsonb | True | '{}'::jsonb |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |
| locked_at | timestamp with time zone | False | None |

Constraints:

- `tournament_phases_configuration_check`: `CHECK (((jsonb_typeof(configuration) = 'object'::text) AND (pg_column_size(configuration) <= 16384)))`
- `tournament_phases_fixture_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, fixture_version_id) REFERENCES tournament_fixture_versions(organization_id, tournament_id, category_id, id) ON DELETE RESTRICT`
- `tournament_phases_name_check`: `CHECK (((name = btrim(name)) AND ((char_length(name) >= 1) AND (char_length(name) <= 100))))`
- `tournament_phases_pkey`: `PRIMARY KEY (id)`
- `tournament_phases_scope_unique`: `UNIQUE (organization_id, tournament_id, category_id, fixture_version_id, id)`
- `tournament_phases_sequence_check`: `CHECK ((sequence_number > 0))`
- `tournament_phases_sequence_unique`: `UNIQUE (fixture_version_id, sequence_number)`
- `tournament_phases_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'generated'::text, 'scheduled'::text, 'active_future'::text, 'completed_future'::text, 'archived'::text])))`
- `tournament_phases_type_check`: `CHECK ((phase_type = ANY (ARRAY['league'::text, 'groups'::text, 'round_of_32'::text, 'round_of_16'::text, 'quarterfinal'::text, 'semifinal'::text, 'third_place'::text, 'final'::text, 'custom_knockout'::text])))`

### tournament_plan_catalog

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'service_role=r/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| plan_code | text | True | None |
| gallery_asset_limit | integer | True | None |
| administrative_collaborator_limit | integer | True | None |
| branding_mode | text | True | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_plan_catalog_admin_limit_check`: `CHECK (((administrative_collaborator_limit >= 0) AND (administrative_collaborator_limit <= 1000)))`
- `tournament_plan_catalog_branding_check`: `CHECK ((branding_mode = ANY (ARRAY['arma2_visible'::text, 'branding_optional'::text])))`
- `tournament_plan_catalog_gallery_limit_check`: `CHECK (((gallery_asset_limit >= 1) AND (gallery_asset_limit <= 100000)))`
- `tournament_plan_catalog_pkey`: `PRIMARY KEY (plan_code)`
- `tournament_plan_catalog_plan_check`: `CHECK ((plan_code = ANY (ARRAY['FREE'::text, 'PREMIUM'::text])))`

### tournament_plan_grant_events

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'service_role=r/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | bigint | True | None |
| grant_id | uuid | True | None |
| purchase_id | uuid | False | None |
| event_type | text | True | None |
| reason_code | text | True | None |
| reason | text | True | None |
| actor_type | text | True | None |
| actor_user_id | uuid | False | None |
| created_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_plan_grant_events_actor_check`: `CHECK ((actor_type = ANY (ARRAY['service'::text, 'provider'::text])))`
- `tournament_plan_grant_events_actor_user_id_fkey`: `FOREIGN KEY (actor_user_id) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_plan_grant_events_grant_id_fkey`: `FOREIGN KEY (grant_id) REFERENCES tournament_plan_grants(id) ON DELETE RESTRICT`
- `tournament_plan_grant_events_pkey`: `PRIMARY KEY (id)`
- `tournament_plan_grant_events_purchase_id_fkey`: `FOREIGN KEY (purchase_id) REFERENCES tournament_purchases(id) ON DELETE RESTRICT`
- `tournament_plan_grant_events_reason_check`: `CHECK (((reason = btrim(reason)) AND ((char_length(reason) >= 8) AND (char_length(reason) <= 500))))`
- `tournament_plan_grant_events_reason_code_check`: `CHECK ((reason_code ~ '^[a-z][a-z0-9_]{2,63}$'::text))`
- `tournament_plan_grant_events_type_check`: `CHECK ((event_type = ANY (ARRAY['granted'::text, 'suspended'::text, 'restored'::text, 'revoked'::text])))`

### tournament_plan_grants

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'service_role=r/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| plan_code | text | True | None |
| source | text | True | None |
| granted_at | timestamp with time zone | True | now() |
| reason | text | True | None |
| created_at | timestamp with time zone | True | now() |
| origin_purchase_id | uuid | False | None |

Constraints:

- `tournament_plan_grants_origin_purchase_id_fkey`: `FOREIGN KEY (origin_purchase_id) REFERENCES tournament_purchases(id) ON DELETE RESTRICT`
- `tournament_plan_grants_pkey`: `PRIMARY KEY (id)`
- `tournament_plan_grants_plan_code_fkey`: `FOREIGN KEY (plan_code) REFERENCES tournament_plan_catalog(plan_code) ON DELETE RESTRICT`
- `tournament_plan_grants_plan_source_check`: `CHECK ((((plan_code = 'FREE'::text) AND (source = 'first_free'::text)) OR ((plan_code = 'PREMIUM'::text) AND (source = ANY (ARRAY['purchase'::text, 'legacy_grant'::text])))))`
- `tournament_plan_grants_reason_check`: `CHECK (((reason = btrim(reason)) AND ((char_length(reason) >= 8) AND (char_length(reason) <= 500))))`
- `tournament_plan_grants_source_check`: `CHECK ((source = ANY (ARRAY['first_free'::text, 'purchase'::text, 'legacy_grant'::text])))`
- `tournament_plan_grants_tournament_fk`: `FOREIGN KEY (organization_id, tournament_id) REFERENCES tournaments(organization_id, id) ON DELETE RESTRICT`
- `tournament_plan_grants_unique`: `UNIQUE (organization_id, tournament_id, plan_code, source)`

### tournament_player_portraits

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'service_role=arwdDxtm/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| team_entry_id | uuid | True | None |
| roster_player_id | uuid | True | None |
| bucket | text | True | 'tournament-player-portraits'::text |
| object_path | text | True | None |
| mime_type | text | True | None |
| byte_size | bigint | True | None |
| width | integer | True | None |
| height | integer | True | None |
| focal_x | numeric(5,4) | True | 0.5 |
| focal_y | numeric(5,4) | True | 0.5 |
| editorial_status | text | True | 'pending_review'::text |
| publication_consent | text | True | 'unknown'::text |
| lifecycle_status | text | True | 'upload_pending'::text |
| uploaded_by | uuid | False | None |
| reviewed_by | uuid | False | None |
| consent_actor_user_id | uuid | False | None |
| replaced_by_id | uuid | False | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |
| reviewed_at | timestamp with time zone | False | None |
| consent_changed_at | timestamp with time zone | False | None |
| replaced_at | timestamp with time zone | False | None |
| removed_at | timestamp with time zone | False | None |
| storage_purged_at | timestamp with time zone | False | None |
| crop_zoom | numeric(6,4) | True | 1.0 |

Constraints:

- `tournament_player_portraits_bucket_check`: `CHECK ((bucket = 'tournament-player-portraits'::text))`
- `tournament_player_portraits_consent_actor_check`: `CHECK ((((publication_consent = 'unknown'::text) AND (consent_changed_at IS NULL)) OR ((publication_consent = ANY (ARRAY['granted'::text, 'revoked'::text])) AND (consent_changed_at IS NOT NULL))))`
- `tournament_player_portraits_consent_actor_fk`: `FOREIGN KEY (consent_actor_user_id) REFERENCES torneos_identity(id) ON DELETE SET NULL`
- `tournament_player_portraits_consent_check`: `CHECK ((publication_consent = ANY (ARRAY['unknown'::text, 'granted'::text, 'revoked'::text])))`
- `tournament_player_portraits_crop_zoom_check`: `CHECK (((crop_zoom >= (1)::numeric) AND (crop_zoom <= (4)::numeric)))`
- `tournament_player_portraits_dimensions_check`: `CHECK (((width >= 1) AND (width <= 12000) AND ((height >= 1) AND (height <= 12000)) AND (((width)::bigint * (height)::bigint) <= 36000000)))`
- `tournament_player_portraits_editorial_check`: `CHECK ((editorial_status = ANY (ARRAY['pending_review'::text, 'approved'::text, 'rejected'::text])))`
- `tournament_player_portraits_entry_fk`: `FOREIGN KEY (organization_id, tournament_id, team_entry_id) REFERENCES tournament_team_entries(organization_id, tournament_id, id) ON DELETE RESTRICT`
- `tournament_player_portraits_focal_check`: `CHECK (((focal_x >= (0)::numeric) AND (focal_x <= (1)::numeric) AND ((focal_y >= (0)::numeric) AND (focal_y <= (1)::numeric))))`
- `tournament_player_portraits_lifecycle_check`: `CHECK ((lifecycle_status = ANY (ARRAY['upload_pending'::text, 'active'::text, 'delete_pending'::text, 'replaced'::text, 'removed'::text, 'upload_failed'::text])))`
- `tournament_player_portraits_mime_check`: `CHECK ((mime_type = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text])))`
- `tournament_player_portraits_object_unique`: `UNIQUE (bucket, object_path)`
- `tournament_player_portraits_org_id_unique`: `UNIQUE (organization_id, id)`
- `tournament_player_portraits_path_check`: `CHECK ((object_path = (((((('organizations/'::text || (organization_id)::text) || '/roster-players/'::text) || (roster_player_id)::text) || '/'::text) || (id)::text) ||
CASE mime_type
    WHEN 'image/jpeg'::text THEN '.jpg'::text
    WHEN 'image/png'::text THEN '.png'::text
    WHEN 'image/webp'::text THEN '.webp'::text
    ELSE NULL::text
END)))`
- `tournament_player_portraits_pkey`: `PRIMARY KEY (id)`
- `tournament_player_portraits_player_fk`: `FOREIGN KEY (organization_id, team_entry_id, roster_player_id) REFERENCES tournament_roster_players(organization_id, team_entry_id, id) ON DELETE RESTRICT`
- `tournament_player_portraits_remove_check`: `CHECK ((((lifecycle_status = 'removed'::text) AND (removed_at IS NOT NULL) AND (storage_purged_at IS NOT NULL)) OR ((lifecycle_status <> 'removed'::text) AND (removed_at IS NULL))))`
- `tournament_player_portraits_replace_check`: `CHECK ((((lifecycle_status = 'replaced'::text) AND (replaced_by_id IS NOT NULL) AND (replaced_at IS NOT NULL)) OR ((lifecycle_status <> 'replaced'::text) AND (replaced_at IS NULL))))`
- `tournament_player_portraits_replaced_by_fk`: `FOREIGN KEY (organization_id, replaced_by_id) REFERENCES tournament_player_portraits(organization_id, id) ON DELETE RESTRICT`
- `tournament_player_portraits_review_check`: `CHECK ((((editorial_status = 'pending_review'::text) AND (reviewed_by IS NULL) AND (reviewed_at IS NULL)) OR ((editorial_status = ANY (ARRAY['approved'::text, 'rejected'::text])) AND (reviewed_by IS NOT NULL) AND (reviewed_at IS NOT NULL))))`
- `tournament_player_portraits_reviewed_by_fk`: `FOREIGN KEY (reviewed_by) REFERENCES torneos_identity(id) ON DELETE SET NULL`
- `tournament_player_portraits_size_check`: `CHECK (((byte_size >= 1) AND (byte_size <= 8388608)))`
- `tournament_player_portraits_uploaded_by_fk`: `FOREIGN KEY (uploaded_by) REFERENCES torneos_identity(id) ON DELETE SET NULL`

### tournament_player_statistics

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| revision_id | uuid | True | None |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| category_id | uuid | True | None |
| roster_player_id | uuid | True | None |
| team_entry_id | uuid | True | None |
| squad_calls | integer | True | 0 |
| appearances | integer | True | 0 |
| starts | integer | True | 0 |
| substitute_appearances | integer | True | 0 |
| minutes_played | integer | False | None |
| goals | integer | True | 0 |
| own_goals | integer | True | 0 |
| assists | integer | True | 0 |
| penalty_goals | integer | True | 0 |
| penalties_missed | integer | True | 0 |
| yellow_cards | integer | True | 0 |
| second_yellows | integer | True | 0 |
| red_cards | integer | True | 0 |
| captaincies | integer | True | 0 |

Constraints:

- `tournament_player_statistics_counts_check`: `CHECK (((squad_calls >= 0) AND (appearances >= 0) AND (starts >= 0) AND (substitute_appearances >= 0) AND (minutes_played IS NULL) AND (goals >= 0) AND (own_goals >= 0) AND (assists >= 0) AND (penalty_goals >= 0) AND (penalties_missed >= 0) AND (yellow_cards >= 0) AND (second_yellows >= 0) AND (red_cards >= 0) AND (captaincies >= 0)))`
- `tournament_player_statistics_entry_fk`: `FOREIGN KEY (organization_id, tournament_id, team_entry_id) REFERENCES tournament_team_entries(organization_id, tournament_id, id) ON DELETE RESTRICT`
- `tournament_player_statistics_pkey`: `PRIMARY KEY (revision_id, roster_player_id)`
- `tournament_player_statistics_player_fk`: `FOREIGN KEY (organization_id, team_entry_id, roster_player_id) REFERENCES tournament_roster_players(organization_id, team_entry_id, id) ON DELETE RESTRICT`
- `tournament_player_statistics_revision_fk`: `FOREIGN KEY (organization_id, revision_id) REFERENCES tournament_standings_revisions(organization_id, id) ON DELETE RESTRICT`

### tournament_player_suspensions

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| revision_id | uuid | True | None |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| category_id | uuid | True | None |
| phase_id | uuid | True | None |
| group_id | uuid | False | None |
| roster_player_id | uuid | True | None |
| team_entry_id | uuid | True | None |
| source_type | text | True | None |
| source_key | text | True | None |
| source_event_id | uuid | False | None |
| source_match_id | uuid | False | None |
| rule_snapshot | jsonb | True | None |
| total_matches | integer | True | None |
| served_matches | integer | True | 0 |
| status | text | True | 'pending'::text |
| reason | text | True | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_player_suspensions_event_fk`: `FOREIGN KEY (source_event_id) REFERENCES tournament_match_events(id) ON DELETE RESTRICT`
- `tournament_player_suspensions_lifecycle_check`: `CHECK ((((status = 'served'::text) AND (served_matches = total_matches)) OR ((status <> 'served'::text) AND (served_matches <= total_matches))))`
- `tournament_player_suspensions_match_fk`: `FOREIGN KEY (organization_id, source_match_id) REFERENCES tournament_matches(organization_id, id) ON DELETE RESTRICT`
- `tournament_player_suspensions_matches_check`: `CHECK (((total_matches >= 1) AND (total_matches <= 24) AND ((served_matches >= 0) AND (served_matches <= total_matches))))`
- `tournament_player_suspensions_pkey`: `PRIMARY KEY (id)`
- `tournament_player_suspensions_player_fk`: `FOREIGN KEY (organization_id, team_entry_id, roster_player_id) REFERENCES tournament_roster_players(organization_id, team_entry_id, id) ON DELETE RESTRICT`
- `tournament_player_suspensions_reason_check`: `CHECK (((reason = btrim(reason)) AND ((char_length(reason) >= 3) AND (char_length(reason) <= 500))))`
- `tournament_player_suspensions_revision_fk`: `FOREIGN KEY (organization_id, revision_id) REFERENCES tournament_standings_revisions(organization_id, id) ON DELETE RESTRICT`
- `tournament_player_suspensions_rule_check`: `CHECK (((jsonb_typeof(rule_snapshot) = 'object'::text) AND (pg_column_size(rule_snapshot) <= 8192)))`
- `tournament_player_suspensions_source_check`: `CHECK ((source_type = ANY (ARRAY['yellow_accumulation'::text, 'second_yellow'::text, 'direct_red'::text, 'manual'::text])))`
- `tournament_player_suspensions_source_key_check`: `CHECK (((source_key = btrim(source_key)) AND ((char_length(source_key) >= 3) AND (char_length(source_key) <= 160))))`
- `tournament_player_suspensions_source_unique`: `UNIQUE (revision_id, roster_player_id, source_type, source_key)`
- `tournament_player_suspensions_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'served'::text, 'reduced'::text, 'revoked'::text, 'superseded'::text])))`

### tournament_points_adjustments

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| category_id | uuid | True | None |
| participant_set_id | uuid | True | None |
| fixture_version_id | uuid | True | None |
| phase_id | uuid | True | None |
| group_id | uuid | False | None |
| participant_id | uuid | True | None |
| points | integer | True | None |
| status | text | True | 'active'::text |
| reason | text | True | None |
| actor_user_id | uuid | True | None |
| idempotency_key | uuid | True | None |
| created_at | timestamp with time zone | True | now() |
| revoked_at | timestamp with time zone | False | None |

Constraints:

- `tournament_points_adjustments_actor_user_id_fkey`: `FOREIGN KEY (actor_user_id) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_points_adjustments_group_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, fixture_version_id, phase_id, group_id) REFERENCES tournament_groups(organization_id, tournament_id, category_id, fixture_version_id, phase_id, id) ON DELETE RESTRICT`
- `tournament_points_adjustments_idempotency_unique`: `UNIQUE (organization_id, actor_user_id, idempotency_key)`
- `tournament_points_adjustments_lifecycle_check`: `CHECK ((((status = 'active'::text) AND (revoked_at IS NULL)) OR ((status = 'revoked'::text) AND (revoked_at IS NOT NULL))))`
- `tournament_points_adjustments_participant_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, participant_set_id, participant_id) REFERENCES tournament_competition_participants(organization_id, tournament_id, category_id, participant_set_id, id) ON DELETE RESTRICT`
- `tournament_points_adjustments_phase_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, fixture_version_id, phase_id) REFERENCES tournament_phases(organization_id, tournament_id, category_id, fixture_version_id, id) ON DELETE RESTRICT`
- `tournament_points_adjustments_pkey`: `PRIMARY KEY (id)`
- `tournament_points_adjustments_points_check`: `CHECK (((points >= '-99'::integer) AND (points <= 99)))`
- `tournament_points_adjustments_reason_check`: `CHECK (((reason = btrim(reason)) AND ((char_length(reason) >= 3) AND (char_length(reason) <= 1000))))`
- `tournament_points_adjustments_status_check`: `CHECK ((status = ANY (ARRAY['active'::text, 'revoked'::text])))`

### tournament_pricing_config

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'service_role=r/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| config_key | text | True | None |
| currency | text | True | None |
| list_price_minor | integer | True | None |
| launch_price_minor | integer | True | None |
| billing_model | text | True | None |
| scope | text | True | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_pricing_config_billing_check`: `CHECK ((billing_model = 'one_time'::text))`
- `tournament_pricing_config_currency_check`: `CHECK ((currency = 'ARS'::text))`
- `tournament_pricing_config_key_check`: `CHECK ((config_key = 'v1'::text))`
- `tournament_pricing_config_pkey`: `PRIMARY KEY (config_key)`
- `tournament_pricing_config_prices_check`: `CHECK (((list_price_minor > 0) AND (launch_price_minor > 0) AND (launch_price_minor < list_price_minor)))`
- `tournament_pricing_config_scope_check`: `CHECK ((scope = 'season'::text))`

### tournament_projection_sources

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| revision_id | uuid | True | None |
| organization_id | uuid | True | None |
| match_operation_id | uuid | True | None |
| match_id | uuid | True | None |
| official_at | timestamp with time zone | True | None |

Constraints:

- `tournament_projection_sources_operation_fk`: `FOREIGN KEY (organization_id, match_id, match_operation_id) REFERENCES tournament_match_operations(organization_id, match_id, id) ON DELETE RESTRICT`
- `tournament_projection_sources_pkey`: `PRIMARY KEY (revision_id, match_operation_id)`
- `tournament_projection_sources_revision_fk`: `FOREIGN KEY (organization_id, revision_id) REFERENCES tournament_standings_revisions(organization_id, id) ON DELETE RESTRICT`

### tournament_provisional_players

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'anon=r/supabase_admin', 'authenticated=arwd/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| display_name | text | True | None |
| normalized_name | text | True | None |
| contact_email | text | False | None |
| contact_phone | text | False | None |
| created_by | uuid | True | None |
| claimed_by_user_id | uuid | False | None |
| claim_status | text | True | 'unclaimed'::text |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_provisional_players_claim_check`: `CHECK (((claim_status = ANY (ARRAY['unclaimed'::text, 'pending'::text, 'claimed'::text, 'rejected'::text])) AND ((claim_status <> 'claimed'::text) OR (claimed_by_user_id IS NOT NULL))))`
- `tournament_provisional_players_claimed_by_user_id_fkey`: `FOREIGN KEY (claimed_by_user_id) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_provisional_players_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_provisional_players_email_check`: `CHECK (((contact_email IS NULL) OR ((char_length(contact_email) >= 5) AND (char_length(contact_email) <= 254))))`
- `tournament_provisional_players_name_check`: `CHECK (((display_name = btrim(display_name)) AND ((char_length(display_name) >= 2) AND (char_length(display_name) <= 100)) AND ((char_length(normalized_name) >= 2) AND (char_length(normalized_name) <= 120))))`
- `tournament_provisional_players_org_id_unique`: `UNIQUE (organization_id, id)`
- `tournament_provisional_players_organization_id_fkey`: `FOREIGN KEY (organization_id) REFERENCES tournament_organizations(id) ON DELETE RESTRICT`
- `tournament_provisional_players_phone_check`: `CHECK (((contact_phone IS NULL) OR ((char_length(contact_phone) >= 6) AND (char_length(contact_phone) <= 32))))`
- `tournament_provisional_players_pkey`: `PRIMARY KEY (id)`

### tournament_public_pages

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'service_role=arwdDxtm/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| tournament_id | uuid | True | None |
| organization_id | uuid | True | None |
| public_slug | text | True | None |
| status | text | True | 'unpublished'::text |
| published_by | uuid | True | None |
| published_at | timestamp with time zone | True | None |
| unpublished_by | uuid | False | None |
| unpublished_at | timestamp with time zone | False | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_public_pages_lifecycle_check`: `CHECK ((((status = 'published'::text) AND (unpublished_by IS NULL) AND (unpublished_at IS NULL)) OR ((status = 'unpublished'::text) AND (unpublished_by IS NOT NULL) AND (unpublished_at IS NOT NULL))))`
- `tournament_public_pages_pkey`: `PRIMARY KEY (tournament_id)`
- `tournament_public_pages_published_by_fkey`: `FOREIGN KEY (published_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_public_pages_slug_check`: `CHECK (((public_slug ~ '^[a-z0-9](?:[a-z0-9-]{1,94}[a-z0-9])$'::text) AND ((char_length(public_slug) >= 3) AND (char_length(public_slug) <= 96))))`
- `tournament_public_pages_status_check`: `CHECK ((status = ANY (ARRAY['published'::text, 'unpublished'::text])))`
- `tournament_public_pages_tournament_scope_fkey`: `FOREIGN KEY (organization_id, tournament_id) REFERENCES tournaments(organization_id, id) ON DELETE CASCADE`
- `tournament_public_pages_unpublished_by_fkey`: `FOREIGN KEY (unpublished_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`

### tournament_purchase_events

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'service_role=r/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | bigint | True | None |
| purchase_id | uuid | True | None |
| organization_id | uuid | True | None |
| event_type | text | True | None |
| from_status | text | False | None |
| to_status | text | False | None |
| provider_status | text | False | None |
| provider_status_detail | text | False | None |
| actor_type | text | True | None |
| actor_user_id | uuid | False | None |
| metadata | jsonb | True | '{}'::jsonb |
| created_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_purchase_events_actor_check`: `CHECK ((actor_type = ANY (ARRAY['user'::text, 'service'::text, 'provider'::text])))`
- `tournament_purchase_events_actor_user_id_fkey`: `FOREIGN KEY (actor_user_id) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_purchase_events_metadata_check`: `CHECK (((jsonb_typeof(metadata) = 'object'::text) AND (pg_column_size(metadata) <= 4096)))`
- `tournament_purchase_events_pkey`: `PRIMARY KEY (id)`
- `tournament_purchase_events_purchase_id_fkey`: `FOREIGN KEY (purchase_id) REFERENCES tournament_purchases(id) ON DELETE RESTRICT`
- `tournament_purchase_events_type_check`: `CHECK ((event_type ~ '^[a-z][a-z0-9_.]{2,80}$'::text))`

### tournament_purchases

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'service_role=r/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| tournament_id | uuid | False | None |
| buyer_user_id | uuid | True | None |
| product_code | text | True | None |
| offer_code | text | True | None |
| offer_version | integer | True | None |
| list_amount_snapshot | integer | True | None |
| amount_snapshot | integer | True | None |
| currency | text | True | None |
| provider | text | True | None |
| provider_environment | text | True | None |
| provider_preference_id | text | False | None |
| approved_provider_payment_id | text | False | None |
| external_reference | text | True | None |
| idempotency_key | uuid | True | None |
| status | text | True | 'created'::text |
| provider_status | text | False | None |
| provider_status_detail | text | False | None |
| preference_expires_at | timestamp with time zone | False | None |
| last_verified_at | timestamp with time zone | False | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |
| approved_at | timestamp with time zone | False | None |
| cancelled_at | timestamp with time zone | False | None |
| refunded_at | timestamp with time zone | False | None |
| charged_back_at | timestamp with time zone | False | None |
| activation_attempts | integer | True | 0 |
| activation_error_code | text | False | None |
| entitlement_activated_at | timestamp with time zone | False | None |
| metadata | jsonb | True | '{}'::jsonb |
| season_id | uuid | True | None |

Constraints:

- `tournament_purchases_activation_attempts_check`: `CHECK ((activation_attempts >= 0))`
- `tournament_purchases_amount_check`: `CHECK (((list_amount_snapshot > 0) AND (amount_snapshot > 0) AND (amount_snapshot <= list_amount_snapshot)))`
- `tournament_purchases_buyer_idempotency_unique`: `UNIQUE (buyer_user_id, idempotency_key)`
- `tournament_purchases_buyer_user_id_fkey`: `FOREIGN KEY (buyer_user_id) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_purchases_currency_check`: `CHECK ((currency = 'ARS'::text))`
- `tournament_purchases_environment_check`: `CHECK ((provider_environment = ANY (ARRAY['local'::text, 'qa'::text])))`
- `tournament_purchases_external_reference_check`: `CHECK ((external_reference ~ '^arma2:(tournament|season):purchase:[0-9a-f-]{36}$'::text))`
- `tournament_purchases_metadata_check`: `CHECK (((jsonb_typeof(metadata) = 'object'::text) AND (pg_column_size(metadata) <= 2048)))`
- `tournament_purchases_offer_fk`: `FOREIGN KEY (product_code, offer_code, offer_version) REFERENCES tournament_commercial_offers(product_code, offer_code, offer_version) ON DELETE RESTRICT`
- `tournament_purchases_pkey`: `PRIMARY KEY (id)`
- `tournament_purchases_provider_check`: `CHECK ((provider = 'FAKE'::text))`
- `tournament_purchases_provider_detail_check`: `CHECK (((provider_status IS NULL) OR ((char_length(provider_status) >= 2) AND (char_length(provider_status) <= 80))))`
- `tournament_purchases_season_fk`: `FOREIGN KEY (organization_id, season_id) REFERENCES tournament_seasons(organization_id, id) ON DELETE RESTRICT`
- `tournament_purchases_status_check`: `CHECK ((status = ANY (ARRAY['created'::text, 'preference_created'::text, 'pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text, 'expired'::text, 'refunded'::text, 'charged_back'::text])))`
- `tournament_purchases_tournament_fk`: `FOREIGN KEY (organization_id, tournament_id) REFERENCES tournaments(organization_id, id) ON DELETE RESTRICT`

### tournament_qualification_resolutions

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| category_id | uuid | True | None |
| fixture_version_id | uuid | True | None |
| standings_revision_id | uuid | True | None |
| slot_id | uuid | True | None |
| participant_id | uuid | True | None |
| target_match_id | uuid | True | None |
| target_side | text | True | None |
| status | text | True | 'resolved'::text |
| reason | text | False | None |
| resolved_by | uuid | True | None |
| resolved_at | timestamp with time zone | True | now() |
| superseded_at | timestamp with time zone | False | None |

Constraints:

- `tournament_qualification_resolutions_match_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, fixture_version_id, target_match_id) REFERENCES tournament_matches(organization_id, tournament_id, category_id, fixture_version_id, id) ON DELETE RESTRICT`
- `tournament_qualification_resolutions_participant_fk`: `FOREIGN KEY (participant_id) REFERENCES tournament_competition_participants(id) ON DELETE RESTRICT`
- `tournament_qualification_resolutions_pkey`: `PRIMARY KEY (id)`
- `tournament_qualification_resolutions_reason_check`: `CHECK (((reason IS NULL) OR (char_length(reason) <= 1000)))`
- `tournament_qualification_resolutions_resolved_by_fkey`: `FOREIGN KEY (resolved_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_qualification_resolutions_revision_fk`: `FOREIGN KEY (organization_id, standings_revision_id) REFERENCES tournament_standings_revisions(organization_id, id) ON DELETE RESTRICT`
- `tournament_qualification_resolutions_side_check`: `CHECK ((target_side = ANY (ARRAY['home'::text, 'away'::text])))`
- `tournament_qualification_resolutions_slot_fk`: `FOREIGN KEY (slot_id) REFERENCES tournament_qualification_slots(id) ON DELETE RESTRICT`
- `tournament_qualification_resolutions_status_check`: `CHECK ((status = ANY (ARRAY['resolved'::text, 'blocked'::text, 'manual'::text, 'superseded'::text])))`

### tournament_qualification_slots

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| category_id | uuid | True | None |
| fixture_version_id | uuid | True | None |
| source_phase_id | uuid | True | None |
| source_group_id | uuid | False | None |
| match_source_id | uuid | True | None |
| slot_type | text | True | None |
| rank_number | integer | True | None |
| status | text | True | 'active'::text |
| created_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_qualification_slots_pkey`: `PRIMARY KEY (id)`
- `tournament_qualification_slots_rank_check`: `CHECK ((rank_number > 0))`
- `tournament_qualification_slots_source_fk`: `FOREIGN KEY (match_source_id) REFERENCES tournament_match_sources(id) ON DELETE RESTRICT`
- `tournament_qualification_slots_source_unique`: `UNIQUE (match_source_id)`
- `tournament_qualification_slots_status_check`: `CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))`
- `tournament_qualification_slots_type_check`: `CHECK ((slot_type = ANY (ARRAY['group_position'::text, 'league_position'::text, 'best_third'::text, 'winner_of_match'::text, 'loser_of_match'::text, 'winner_of_tie'::text, 'loser_of_tie'::text, 'manual'::text])))`

### tournament_roster_players

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| team_entry_id | uuid | True | None |
| roster_id | uuid | True | None |
| arma2_user_id | uuid | False | None |
| provisional_player_id | uuid | False | None |
| display_name | text | True | None |
| avatar_url | text | False | None |
| shirt_number | smallint | False | None |
| primary_position | text | False | None |
| secondary_position | text | False | None |
| is_goalkeeper | boolean | True | false |
| status | text | True | 'active'::text |
| eligibility_status | text | True | 'pending'::text |
| added_by | uuid | True | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |
| removed_at | timestamp with time zone | False | None |

Constraints:

- `tournament_roster_players_added_by_fkey`: `FOREIGN KEY (added_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_roster_players_arma2_user_id_fkey`: `FOREIGN KEY (arma2_user_id) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_roster_players_avatar_check`: `CHECK (((avatar_url IS NULL) OR (char_length(avatar_url) <= 1000)))`
- `tournament_roster_players_eligibility_check`: `CHECK ((eligibility_status = ANY (ARRAY['pending'::text, 'eligible'::text, 'ineligible'::text, 'under_review'::text])))`
- `tournament_roster_players_entry_fk`: `FOREIGN KEY (organization_id, team_entry_id) REFERENCES tournament_team_entries(organization_id, id) ON DELETE RESTRICT`
- `tournament_roster_players_identity_check`: `CHECK ((num_nonnulls(arma2_user_id, provisional_player_id) = 1))`
- `tournament_roster_players_name_check`: `CHECK (((display_name = btrim(display_name)) AND ((char_length(display_name) >= 2) AND (char_length(display_name) <= 100))))`
- `tournament_roster_players_number_check`: `CHECK (((shirt_number IS NULL) OR ((shirt_number >= 0) AND (shirt_number <= 99))))`
- `tournament_roster_players_org_entry_id_unique`: `UNIQUE (organization_id, team_entry_id, id)`
- `tournament_roster_players_org_id_unique`: `UNIQUE (organization_id, id)`
- `tournament_roster_players_pkey`: `PRIMARY KEY (id)`
- `tournament_roster_players_positions_check`: `CHECK ((((primary_position IS NULL) OR (primary_position = ANY (ARRAY['ARQ'::text, 'DEF'::text, 'MED'::text, 'DEL'::text]))) AND ((secondary_position IS NULL) OR (secondary_position = ANY (ARRAY['ARQ'::text, 'DEF'::text, 'MED'::text, 'DEL'::text]))) AND ((secondary_position IS NULL) OR (secondary_position <> primary_position)) AND ((NOT is_goalkeeper) OR (primary_position = 'ARQ'::text) OR (secondary_position = 'ARQ'::text))))`
- `tournament_roster_players_provisional_fk`: `FOREIGN KEY (organization_id, provisional_player_id) REFERENCES tournament_provisional_players(organization_id, id) ON DELETE RESTRICT`
- `tournament_roster_players_removed_check`: `CHECK ((((status = 'active'::text) AND (removed_at IS NULL)) OR ((status = 'removed'::text) AND (removed_at IS NOT NULL))))`
- `tournament_roster_players_roster_fk`: `FOREIGN KEY (organization_id, team_entry_id, roster_id) REFERENCES tournament_rosters(organization_id, team_entry_id, id) ON DELETE RESTRICT`
- `tournament_roster_players_status_check`: `CHECK ((status = ANY (ARRAY['active'::text, 'removed'::text])))`

### tournament_roster_settings

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| tournament_id | uuid | True | None |
| organization_id | uuid | True | None |
| minimum_players | smallint | True | None |
| maximum_players | smallint | True | None |
| shirt_number_required | boolean | True | false |
| unique_shirt_numbers | boolean | True | true |
| position_required | boolean | True | false |
| minimum_goalkeepers | smallint | True | 1 |
| allow_provisional_players | boolean | True | true |
| allow_players_without_account | boolean | True | true |
| allow_player_multiple_teams | boolean | True | false |
| require_individual_player_approval | boolean | True | false |
| lock_changes_when_registration_closes | boolean | True | true |
| roster_opens_at | timestamp with time zone | False | None |
| roster_closes_at | timestamp with time zone | False | None |
| future_reopens_at | timestamp with time zone | False | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_roster_settings_dates_check`: `CHECK (((roster_opens_at IS NULL) OR (roster_closes_at IS NULL) OR (roster_opens_at <= roster_closes_at)))`
- `tournament_roster_settings_limits_check`: `CHECK (((minimum_players >= 1) AND (minimum_players <= 60) AND ((maximum_players >= minimum_players) AND (maximum_players <= 80)) AND ((minimum_goalkeepers >= 0) AND (minimum_goalkeepers <= maximum_players))))`
- `tournament_roster_settings_pkey`: `PRIMARY KEY (tournament_id)`
- `tournament_roster_settings_reopen_check`: `CHECK (((future_reopens_at IS NULL) OR (roster_closes_at IS NULL) OR (future_reopens_at > roster_closes_at)))`
- `tournament_roster_settings_tournament_fk`: `FOREIGN KEY (organization_id, tournament_id) REFERENCES tournaments(organization_id, id) ON DELETE RESTRICT`

### tournament_rosters

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| team_entry_id | uuid | True | None |
| version | integer | True | 1 |
| status | text | True | 'draft'::text |
| submitted_at | timestamp with time zone | False | None |
| approved_at | timestamp with time zone | False | None |
| locked_at | timestamp with time zone | False | None |
| created_by | uuid | True | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_rosters_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_rosters_entry_fk`: `FOREIGN KEY (organization_id, team_entry_id) REFERENCES tournament_team_entries(organization_id, id) ON DELETE RESTRICT`
- `tournament_rosters_lifecycle_check`: `CHECK ((((status <> ALL (ARRAY['submitted'::text, 'changes_requested'::text, 'approved'::text, 'locked'::text, 'superseded'::text])) OR (submitted_at IS NOT NULL)) AND ((status <> ALL (ARRAY['approved'::text, 'locked'::text, 'superseded'::text])) OR (approved_at IS NOT NULL)) AND ((status <> 'locked'::text) OR (locked_at IS NOT NULL))))`
- `tournament_rosters_org_id_unique`: `UNIQUE (organization_id, id)`
- `tournament_rosters_pkey`: `PRIMARY KEY (id)`
- `tournament_rosters_scope_unique`: `UNIQUE (organization_id, team_entry_id, id)`
- `tournament_rosters_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'changes_requested'::text, 'approved'::text, 'locked'::text, 'superseded'::text])))`
- `tournament_rosters_version_check`: `CHECK ((version > 0))`
- `tournament_rosters_version_unique`: `UNIQUE (team_entry_id, version)`

### tournament_rounds

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| category_id | uuid | True | None |
| fixture_version_id | uuid | True | None |
| phase_id | uuid | True | None |
| group_id | uuid | False | None |
| round_number | integer | True | None |
| name | text | True | None |
| status | text | True | 'draft'::text |
| starts_at | timestamp with time zone | False | None |
| ends_at | timestamp with time zone | False | None |
| sort_order | integer | True | 0 |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |
| locked_at | timestamp with time zone | False | None |

Constraints:

- `tournament_rounds_dates_check`: `CHECK (((starts_at IS NULL) OR (ends_at IS NULL) OR (ends_at >= starts_at)))`
- `tournament_rounds_group_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, fixture_version_id, phase_id, group_id) REFERENCES tournament_groups(organization_id, tournament_id, category_id, fixture_version_id, phase_id, id) ON DELETE RESTRICT`
- `tournament_rounds_name_check`: `CHECK (((name = btrim(name)) AND ((char_length(name) >= 1) AND (char_length(name) <= 100))))`
- `tournament_rounds_number_check`: `CHECK ((round_number > 0))`
- `tournament_rounds_phase_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, fixture_version_id, phase_id) REFERENCES tournament_phases(organization_id, tournament_id, category_id, fixture_version_id, id) ON DELETE RESTRICT`
- `tournament_rounds_phase_number_unique`: `UNIQUE NULLS NOT DISTINCT (phase_id, group_id, round_number)`
- `tournament_rounds_pkey`: `PRIMARY KEY (id)`
- `tournament_rounds_scope_unique`: `UNIQUE (organization_id, tournament_id, category_id, fixture_version_id, id)`
- `tournament_rounds_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'locked'::text])))`

### tournament_schedule_windows

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| category_id | uuid | False | None |
| venue_id | uuid | False | None |
| court_id | uuid | False | None |
| day_of_week | smallint | False | None |
| specific_date | date | False | None |
| starts_at | time without time zone | True | None |
| ends_at | time without time zone | True | None |
| slot_duration_minutes | integer | True | None |
| buffer_minutes | integer | True | 0 |
| window_type | text | True | 'availability'::text |
| status | text | True | 'active'::text |
| notes | text | False | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |
| archived_at | timestamp with time zone | False | None |

Constraints:

- `tournament_schedule_windows_archive_check`: `CHECK ((((status = 'archived'::text) AND (archived_at IS NOT NULL)) OR ((status = 'active'::text) AND (archived_at IS NULL))))`
- `tournament_schedule_windows_category_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id) REFERENCES tournament_categories(organization_id, tournament_id, id) ON DELETE RESTRICT`
- `tournament_schedule_windows_court_fk`: `FOREIGN KEY (organization_id, court_id) REFERENCES tournament_courts(organization_id, id) ON DELETE RESTRICT`
- `tournament_schedule_windows_court_requires_venue`: `CHECK (((court_id IS NULL) OR (venue_id IS NOT NULL)))`
- `tournament_schedule_windows_date_shape_check`: `CHECK (((day_of_week IS NULL) <> (specific_date IS NULL)))`
- `tournament_schedule_windows_day_check`: `CHECK (((day_of_week IS NULL) OR ((day_of_week >= 1) AND (day_of_week <= 7))))`
- `tournament_schedule_windows_duration_check`: `CHECK (((slot_duration_minutes >= 15) AND (slot_duration_minutes <= 240) AND ((buffer_minutes >= 0) AND (buffer_minutes <= 120))))`
- `tournament_schedule_windows_pkey`: `PRIMARY KEY (id)`
- `tournament_schedule_windows_scope_unique`: `UNIQUE (organization_id, tournament_id, id)`
- `tournament_schedule_windows_status_check`: `CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))`
- `tournament_schedule_windows_times_check`: `CHECK ((ends_at > starts_at))`
- `tournament_schedule_windows_tournament_fk`: `FOREIGN KEY (organization_id, tournament_id) REFERENCES tournaments(organization_id, id) ON DELETE RESTRICT`
- `tournament_schedule_windows_type_check`: `CHECK ((window_type = ANY (ARRAY['availability'::text, 'block'::text, 'closure'::text])))`
- `tournament_schedule_windows_venue_fk`: `FOREIGN KEY (organization_id, venue_id) REFERENCES tournament_venues(organization_id, id) ON DELETE RESTRICT`

### tournament_scoring_rules

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| tournament_id | uuid | True | None |
| organization_id | uuid | True | None |
| points_win | smallint | True | 3 |
| points_draw | smallint | True | 1 |
| points_loss | smallint | True | 0 |
| points_walkover_win | smallint | False | None |
| points_walkover_loss | smallint | False | None |
| allow_manual_points_adjustment | boolean | True | false |
| allow_administrative_result | boolean | True | false |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_scoring_rules_pkey`: `PRIMARY KEY (tournament_id)`
- `tournament_scoring_rules_points_check`: `CHECK (((points_win >= '-10'::integer) AND (points_win <= 20) AND ((points_draw >= '-10'::integer) AND (points_draw <= 20)) AND ((points_loss >= '-10'::integer) AND (points_loss <= 20)) AND ((points_walkover_win IS NULL) OR ((points_walkover_win >= '-10'::integer) AND (points_walkover_win <= 20))) AND ((points_walkover_loss IS NULL) OR ((points_walkover_loss >= '-10'::integer) AND (points_walkover_loss <= 20)))))`
- `tournament_scoring_rules_tournament_fk`: `FOREIGN KEY (organization_id, tournament_id) REFERENCES tournaments(organization_id, id) ON DELETE RESTRICT`

### tournament_season_member_assignments

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=r/supabase_admin', 'service_role=r/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| season_id | uuid | True | None |
| membership_id | uuid | True | None |
| assigned_by | uuid | False | None |
| assigned_at | timestamp with time zone | True | now() |
| created_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_season_member_assignments_assigned_by_fkey`: `FOREIGN KEY (assigned_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_season_member_assignments_membership_id_fkey`: `FOREIGN KEY (membership_id) REFERENCES tournament_organization_members(id) ON DELETE RESTRICT`
- `tournament_season_member_assignments_pkey`: `PRIMARY KEY (id)`
- `tournament_season_member_assignments_season_fk`: `FOREIGN KEY (organization_id, season_id) REFERENCES tournament_seasons(organization_id, id) ON DELETE RESTRICT`
- `tournament_season_member_assignments_unique`: `UNIQUE (season_id, membership_id)`

### tournament_season_plan_grant_events

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'service_role=r/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | bigint | True | None |
| season_grant_id | uuid | True | None |
| purchase_id | uuid | False | None |
| origin_tournament_grant_event_id | bigint | False | None |
| event_type | text | True | None |
| reason_code | text | True | None |
| reason | text | True | None |
| actor_type | text | True | None |
| actor_user_id | uuid | False | None |
| created_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_season_plan_grant__origin_tournament_grant_even_fkey`: `FOREIGN KEY (origin_tournament_grant_event_id) REFERENCES tournament_plan_grant_events(id) ON DELETE RESTRICT`
- `tournament_season_plan_grant_events_actor_check`: `CHECK ((actor_type = ANY (ARRAY['service'::text, 'provider'::text, 'migration'::text])))`
- `tournament_season_plan_grant_events_actor_user_id_fkey`: `FOREIGN KEY (actor_user_id) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_season_plan_grant_events_origin_unique`: `UNIQUE (origin_tournament_grant_event_id)`
- `tournament_season_plan_grant_events_pkey`: `PRIMARY KEY (id)`
- `tournament_season_plan_grant_events_purchase_id_fkey`: `FOREIGN KEY (purchase_id) REFERENCES tournament_purchases(id) ON DELETE RESTRICT`
- `tournament_season_plan_grant_events_reason_check`: `CHECK (((reason = btrim(reason)) AND ((char_length(reason) >= 8) AND (char_length(reason) <= 500))))`
- `tournament_season_plan_grant_events_reason_code_check`: `CHECK ((reason_code ~ '^[a-z][a-z0-9_]{2,63}$'::text))`
- `tournament_season_plan_grant_events_season_grant_id_fkey`: `FOREIGN KEY (season_grant_id) REFERENCES tournament_season_plan_grants(id) ON DELETE RESTRICT`
- `tournament_season_plan_grant_events_type_check`: `CHECK ((event_type = ANY (ARRAY['granted'::text, 'suspended'::text, 'restored'::text, 'revoked'::text])))`

### tournament_season_plan_grants

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'service_role=r/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| season_id | uuid | True | None |
| plan_code | text | True | None |
| source | text | True | None |
| origin_tournament_grant_id | uuid | False | None |
| origin_purchase_id | uuid | False | None |
| granted_at | timestamp with time zone | True | now() |
| reason | text | True | None |
| created_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_season_plan_grants_origin_check`: `CHECK ((((source = 'historical_tournament_grant'::text) AND (origin_tournament_grant_id IS NOT NULL)) OR ((source = 'purchase'::text) AND (origin_purchase_id IS NOT NULL)) OR (source = 'manual_legacy'::text)))`
- `tournament_season_plan_grants_origin_purchase_id_fkey`: `FOREIGN KEY (origin_purchase_id) REFERENCES tournament_purchases(id) ON DELETE RESTRICT`
- `tournament_season_plan_grants_origin_purchase_unique`: `UNIQUE (origin_purchase_id)`
- `tournament_season_plan_grants_origin_tournament_grant_id_fkey`: `FOREIGN KEY (origin_tournament_grant_id) REFERENCES tournament_plan_grants(id) ON DELETE RESTRICT`
- `tournament_season_plan_grants_origin_tournament_unique`: `UNIQUE (origin_tournament_grant_id)`
- `tournament_season_plan_grants_pkey`: `PRIMARY KEY (id)`
- `tournament_season_plan_grants_plan_check`: `CHECK ((plan_code = 'PREMIUM'::text))`
- `tournament_season_plan_grants_plan_code_fkey`: `FOREIGN KEY (plan_code) REFERENCES tournament_plan_catalog(plan_code) ON DELETE RESTRICT`
- `tournament_season_plan_grants_reason_check`: `CHECK (((reason = btrim(reason)) AND ((char_length(reason) >= 8) AND (char_length(reason) <= 500))))`
- `tournament_season_plan_grants_season_fk`: `FOREIGN KEY (organization_id, season_id) REFERENCES tournament_seasons(organization_id, id) ON DELETE RESTRICT`
- `tournament_season_plan_grants_source_check`: `CHECK ((source = ANY (ARRAY['historical_tournament_grant'::text, 'purchase'::text, 'manual_legacy'::text])))`

### tournament_seasons

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| name | text | True | None |
| slug | text | True | None |
| status | text | True | 'draft'::text |
| start_date | date | False | None |
| end_date | date | False | None |
| created_by | uuid | True | None |
| creation_key | uuid | True | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |
| archived_at | timestamp with time zone | False | None |

Constraints:

- `tournament_seasons_archive_state_check`: `CHECK ((((status = 'archived'::text) AND (archived_at IS NOT NULL)) OR ((status <> 'archived'::text) AND (archived_at IS NULL))))`
- `tournament_seasons_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_seasons_creation_unique`: `UNIQUE (organization_id, created_by, creation_key)`
- `tournament_seasons_dates_check`: `CHECK (((start_date IS NULL) OR (end_date IS NULL) OR (end_date >= start_date)))`
- `tournament_seasons_name_check`: `CHECK (((name = btrim(name)) AND ((char_length(name) >= 3) AND (char_length(name) <= 80))))`
- `tournament_seasons_org_id_unique`: `UNIQUE (organization_id, id)`
- `tournament_seasons_organization_id_fkey`: `FOREIGN KEY (organization_id) REFERENCES tournament_organizations(id) ON DELETE RESTRICT`
- `tournament_seasons_pkey`: `PRIMARY KEY (id)`
- `tournament_seasons_slug_check`: `CHECK (((slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'::text) AND ((char_length(slug) >= 3) AND (char_length(slug) <= 48))))`
- `tournament_seasons_slug_unique`: `UNIQUE (organization_id, slug)`
- `tournament_seasons_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'completed'::text, 'archived'::text])))`

### tournament_social_permissions

RLS: True; FORCE RLS: False. ACL: `None`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| organization_id | uuid | True | None |
| user_id | uuid | True | None |
| can_export | boolean | True | false |
| granted_by | uuid | True | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_social_permissions_organization_fk`: `FOREIGN KEY (organization_id) REFERENCES tournament_organizations(id) ON DELETE CASCADE`
- `tournament_social_permissions_pkey`: `PRIMARY KEY (organization_id, user_id)`

### tournament_sport_modalities

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| code | text | True | None |
| name | text | True | None |
| team_size | smallint | True | None |
| recommended_substitutes | smallint | True | None |
| team_of_round_size | smallint | True | None |
| suggested_duration_minutes | smallint | True | None |
| requires_goalkeeper | boolean | True | true |

Constraints:

- `tournament_sport_modalities_code_check`: `CHECK ((code ~ '^football_(5|6|7|8|9|11)$'::text))`
- `tournament_sport_modalities_name_key`: `UNIQUE (name)`
- `tournament_sport_modalities_pkey`: `PRIMARY KEY (code)`
- `tournament_sport_modalities_values_check`: `CHECK (((team_size >= 5) AND (team_size <= 11) AND ((recommended_substitutes >= 0) AND (recommended_substitutes <= 15)) AND ((team_of_round_size >= 5) AND (team_of_round_size <= 11)) AND ((suggested_duration_minutes >= 20) AND (suggested_duration_minutes <= 120))))`

### tournament_standings_revisions

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| season_id | uuid | True | None |
| tournament_id | uuid | True | None |
| category_id | uuid | True | None |
| fixture_version_id | uuid | True | None |
| phase_id | uuid | True | None |
| group_id | uuid | False | None |
| revision_number | integer | True | None |
| status | text | True | 'draft'::text |
| source_fingerprint | text | True | None |
| configuration_snapshot | jsonb | True | None |
| rebuild_reason | text | True | None |
| calculated_by | uuid | True | None |
| idempotency_key | uuid | True | None |
| calculated_at | timestamp with time zone | True | now() |
| published_by | uuid | False | None |
| published_at | timestamp with time zone | False | None |
| superseded_at | timestamp with time zone | False | None |
| discarded_by | uuid | False | None |
| discarded_at | timestamp with time zone | False | None |
| discard_reason | text | False | None |

Constraints:

- `tournament_standings_revisions_calculated_by_fkey`: `FOREIGN KEY (calculated_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_standings_revisions_config_check`: `CHECK (((jsonb_typeof(configuration_snapshot) = 'object'::text) AND (pg_column_size(configuration_snapshot) <= 65536)))`
- `tournament_standings_revisions_discard_reason_check`: `CHECK (((discard_reason IS NULL) OR ((discard_reason = btrim(discard_reason)) AND ((char_length(discard_reason) >= 3) AND (char_length(discard_reason) <= 500)))))`
- `tournament_standings_revisions_discarded_by_fkey`: `FOREIGN KEY (discarded_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_standings_revisions_fingerprint_check`: `CHECK ((source_fingerprint ~ '^[0-9a-f]{64}$'::text))`
- `tournament_standings_revisions_fixture_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, fixture_version_id) REFERENCES tournament_fixture_versions(organization_id, tournament_id, category_id, id) ON DELETE RESTRICT`
- `tournament_standings_revisions_group_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, fixture_version_id, phase_id, group_id) REFERENCES tournament_groups(organization_id, tournament_id, category_id, fixture_version_id, phase_id, id) ON DELETE RESTRICT`
- `tournament_standings_revisions_idempotency_unique`: `UNIQUE (organization_id, calculated_by, idempotency_key)`
- `tournament_standings_revisions_lifecycle_check`: `CHECK ((((status = 'draft'::text) AND (published_by IS NULL) AND (published_at IS NULL) AND (superseded_at IS NULL) AND (discarded_by IS NULL) AND (discarded_at IS NULL) AND (discard_reason IS NULL)) OR ((status = 'published'::text) AND (published_by IS NOT NULL) AND (published_at IS NOT NULL) AND (superseded_at IS NULL) AND (discarded_by IS NULL) AND (discarded_at IS NULL) AND (discard_reason IS NULL)) OR ((status = 'superseded'::text) AND (published_by IS NOT NULL) AND (published_at IS NOT NULL) AND (superseded_at IS NOT NULL) AND (discarded_by IS NULL) AND (discarded_at IS NULL) AND (discard_reason IS NULL)) OR ((status = 'discarded'::text) AND (published_by IS NULL) AND (published_at IS NULL) AND (superseded_at IS NULL) AND (discarded_by IS NOT NULL) AND (discarded_at IS NOT NULL) AND (discard_reason IS NOT NULL))))`
- `tournament_standings_revisions_number_check`: `CHECK ((revision_number > 0))`
- `tournament_standings_revisions_number_unique`: `UNIQUE NULLS NOT DISTINCT (fixture_version_id, phase_id, group_id, revision_number)`
- `tournament_standings_revisions_org_id_unique`: `UNIQUE (organization_id, id)`
- `tournament_standings_revisions_phase_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id, fixture_version_id, phase_id) REFERENCES tournament_phases(organization_id, tournament_id, category_id, fixture_version_id, id) ON DELETE RESTRICT`
- `tournament_standings_revisions_pkey`: `PRIMARY KEY (id)`
- `tournament_standings_revisions_published_by_fkey`: `FOREIGN KEY (published_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_standings_revisions_reason_check`: `CHECK (((rebuild_reason = btrim(rebuild_reason)) AND ((char_length(rebuild_reason) >= 3) AND (char_length(rebuild_reason) <= 500))))`
- `tournament_standings_revisions_scope_unique`: `UNIQUE (organization_id, tournament_id, category_id, fixture_version_id, id)`
- `tournament_standings_revisions_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'superseded'::text, 'discarded'::text])))`
- `tournament_standings_revisions_tournament_fk`: `FOREIGN KEY (organization_id, tournament_id, season_id) REFERENCES tournaments(organization_id, id, season_id) ON DELETE RESTRICT`

### tournament_suspension_served_matches

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| suspension_id | uuid | True | None |
| organization_id | uuid | True | None |
| match_id | uuid | True | None |
| marked_by | uuid | True | None |
| marked_at | timestamp with time zone | True | now() |
| note | text | False | None |

Constraints:

- `tournament_suspension_served_matches_marked_by_fkey`: `FOREIGN KEY (marked_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_suspension_served_matches_match_fk`: `FOREIGN KEY (organization_id, match_id) REFERENCES tournament_matches(organization_id, id) ON DELETE RESTRICT`
- `tournament_suspension_served_matches_note_check`: `CHECK (((note IS NULL) OR (char_length(note) <= 500)))`
- `tournament_suspension_served_matches_pkey`: `PRIMARY KEY (suspension_id, match_id)`
- `tournament_suspension_served_matches_suspension_fk`: `FOREIGN KEY (suspension_id) REFERENCES tournament_player_suspensions(id) ON DELETE RESTRICT`

### tournament_team_entries

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| season_id | uuid | True | None |
| tournament_id | uuid | True | None |
| category_id | uuid | True | None |
| arma2_team_id | uuid | False | None |
| name | text | True | None |
| slug | text | True | None |
| short_name | text | False | None |
| shield_path | text | False | None |
| primary_color | text | False | None |
| secondary_color | text | False | None |
| status | text | True | 'draft'::text |
| registration_source | text | True | None |
| created_by | uuid | True | None |
| submitted_by | uuid | False | None |
| submitted_at | timestamp with time zone | False | None |
| reviewed_by | uuid | False | None |
| reviewed_at | timestamp with time zone | False | None |
| approved_at | timestamp with time zone | False | None |
| rejected_at | timestamp with time zone | False | None |
| withdrawn_at | timestamp with time zone | False | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |
| archived_at | timestamp with time zone | False | None |
| idempotency_key | uuid | True | None |

Constraints:

- `tournament_team_entries_category_fk`: `FOREIGN KEY (organization_id, tournament_id, category_id) REFERENCES tournament_categories(organization_id, tournament_id, id) ON DELETE RESTRICT`
- `tournament_team_entries_colors_check`: `CHECK ((((primary_color IS NULL) OR (primary_color ~ '^#[0-9A-Fa-f]{6}$'::text)) AND ((secondary_color IS NULL) OR (secondary_color ~ '^#[0-9A-Fa-f]{6}$'::text))))`
- `tournament_team_entries_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_team_entries_idempotency_unique`: `UNIQUE (organization_id, created_by, idempotency_key)`
- `tournament_team_entries_lifecycle_check`: `CHECK ((((submitted_at IS NULL) OR (submitted_by IS NOT NULL)) AND ((approved_at IS NULL) OR (status = ANY (ARRAY['approved'::text, 'withdrawn'::text, 'archived'::text]))) AND ((rejected_at IS NULL) OR (status = ANY (ARRAY['rejected'::text, 'archived'::text]))) AND ((withdrawn_at IS NULL) OR (status = ANY (ARRAY['withdrawn'::text, 'archived'::text]))) AND (((status = 'archived'::text) AND (archived_at IS NOT NULL)) OR ((status <> 'archived'::text) AND (archived_at IS NULL)))))`
- `tournament_team_entries_name_check`: `CHECK (((name = btrim(name)) AND ((char_length(name) >= 2) AND (char_length(name) <= 100))))`
- `tournament_team_entries_org_id_unique`: `UNIQUE (organization_id, id)`
- `tournament_team_entries_org_tournament_id_unique`: `UNIQUE (organization_id, tournament_id, id)`
- `tournament_team_entries_pkey`: `PRIMARY KEY (id)`
- `tournament_team_entries_reviewed_by_fkey`: `FOREIGN KEY (reviewed_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_team_entries_shield_path_check`: `CHECK (((shield_path IS NULL) OR (shield_path ~ (((('^'::text || (organization_id)::text) || '/teams/'::text) || (id)::text) || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'::text)) OR (shield_path ~ '^qa/shields/[a-z0-9-]+\.svg$'::text)))`
- `tournament_team_entries_short_name_check`: `CHECK (((short_name IS NULL) OR ((char_length(btrim(short_name)) >= 2) AND (char_length(btrim(short_name)) <= 20))))`
- `tournament_team_entries_slug_check`: `CHECK (((slug ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])$'::text) AND ((char_length(slug) >= 2) AND (char_length(slug) <= 64))))`
- `tournament_team_entries_source_check`: `CHECK ((registration_source = ANY (ARRAY['manual'::text, 'invitation'::text, 'arma2_team'::text, 'provisional'::text])))`
- `tournament_team_entries_source_identity_check`: `CHECK ((((registration_source = 'arma2_team'::text) AND (arma2_team_id IS NOT NULL)) OR (registration_source <> 'arma2_team'::text)))`
- `tournament_team_entries_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'invited'::text, 'in_progress'::text, 'submitted'::text, 'changes_requested'::text, 'approved'::text, 'rejected'::text, 'withdrawn'::text, 'archived'::text])))`
- `tournament_team_entries_submitted_by_fkey`: `FOREIGN KEY (submitted_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_team_entries_tournament_fk`: `FOREIGN KEY (organization_id, tournament_id, season_id) REFERENCES tournaments(organization_id, id, season_id) ON DELETE RESTRICT`

### tournament_team_invitations

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'anon=r/supabase_admin', 'authenticated=arwd/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| team_entry_id | uuid | True | None |
| manager_id | uuid | True | None |
| email_normalized | text | True | None |
| role | text | True | None |
| token_hash | text | True | None |
| status | text | True | 'pending'::text |
| expires_at | timestamp with time zone | True | None |
| created_by | uuid | True | None |
| created_at | timestamp with time zone | True | now() |
| accepted_at | timestamp with time zone | False | None |
| revoked_at | timestamp with time zone | False | None |

Constraints:

- `tournament_team_invitations_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_team_invitations_entry_fk`: `FOREIGN KEY (organization_id, tournament_id, team_entry_id) REFERENCES tournament_team_entries(organization_id, tournament_id, id) ON DELETE RESTRICT`
- `tournament_team_invitations_expiry_check`: `CHECK ((expires_at > created_at))`
- `tournament_team_invitations_lifecycle_check`: `CHECK ((((status <> 'accepted'::text) OR (accepted_at IS NOT NULL)) AND ((status <> 'revoked'::text) OR (revoked_at IS NOT NULL)) AND ((accepted_at IS NULL) OR (accepted_at <= expires_at))))`
- `tournament_team_invitations_manager_fk`: `FOREIGN KEY (organization_id, team_entry_id, manager_id) REFERENCES tournament_team_managers(organization_id, team_entry_id, id) ON DELETE RESTRICT`
- `tournament_team_invitations_pkey`: `PRIMARY KEY (id)`
- `tournament_team_invitations_role_check`: `CHECK ((role = ANY (ARRAY['captain'::text, 'delegate'::text, 'assistant'::text])))`
- `tournament_team_invitations_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'expired'::text, 'revoked'::text])))`
- `tournament_team_invitations_token_hash_key`: `UNIQUE (token_hash)`
- `tournament_team_invitations_tournament_fk`: `FOREIGN KEY (organization_id, tournament_id) REFERENCES tournaments(organization_id, id) ON DELETE RESTRICT`

### tournament_team_managers

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'anon=r/supabase_admin', 'authenticated=arwd/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| team_entry_id | uuid | True | None |
| user_id | uuid | False | None |
| email_normalized | text | False | None |
| display_name | text | True | None |
| role | text | True | None |
| status | text | True | 'pending'::text |
| invited_by | uuid | True | None |
| invited_at | timestamp with time zone | True | now() |
| accepted_at | timestamp with time zone | False | None |
| revoked_at | timestamp with time zone | False | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_team_managers_email_check`: `CHECK (((email_normalized IS NULL) OR ((email_normalized = lower(btrim(email_normalized))) AND ((char_length(email_normalized) >= 5) AND (char_length(email_normalized) <= 254)) AND (email_normalized ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'::text))))`
- `tournament_team_managers_entry_fk`: `FOREIGN KEY (organization_id, team_entry_id) REFERENCES tournament_team_entries(organization_id, id) ON DELETE RESTRICT`
- `tournament_team_managers_identity_check`: `CHECK (((user_id IS NOT NULL) OR (email_normalized IS NOT NULL)))`
- `tournament_team_managers_invited_by_fkey`: `FOREIGN KEY (invited_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_team_managers_lifecycle_check`: `CHECK ((((status <> 'active'::text) OR ((user_id IS NOT NULL) AND (accepted_at IS NOT NULL))) AND ((status <> 'revoked'::text) OR (revoked_at IS NOT NULL))))`
- `tournament_team_managers_name_check`: `CHECK (((display_name = btrim(display_name)) AND ((char_length(display_name) >= 2) AND (char_length(display_name) <= 100))))`
- `tournament_team_managers_pkey`: `PRIMARY KEY (id)`
- `tournament_team_managers_role_check`: `CHECK ((role = ANY (ARRAY['captain'::text, 'delegate'::text, 'assistant'::text])))`
- `tournament_team_managers_scope_unique`: `UNIQUE (organization_id, team_entry_id, id)`
- `tournament_team_managers_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'revoked'::text])))`
- `tournament_team_managers_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES torneos_identity(id) ON DELETE RESTRICT`

### tournament_team_photos

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'service_role=arwdDxtm/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| team_entry_id | uuid | True | None |
| bucket | text | True | 'tournament-team-photos'::text |
| object_path | text | True | None |
| mime_type | text | True | None |
| byte_size | bigint | True | None |
| width | integer | True | None |
| height | integer | True | None |
| checksum_sha256 | text | False | None |
| editorial_status | text | True | 'pending_review'::text |
| lifecycle_status | text | True | 'upload_pending'::text |
| review_reason | text | False | None |
| uploaded_by | uuid | False | None |
| reviewed_by | uuid | False | None |
| revoked_by | uuid | False | None |
| replaced_by_id | uuid | False | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |
| reviewed_at | timestamp with time zone | False | None |
| approved_at | timestamp with time zone | False | None |
| revoked_at | timestamp with time zone | False | None |
| replaced_at | timestamp with time zone | False | None |
| removed_at | timestamp with time zone | False | None |
| storage_purged_at | timestamp with time zone | False | None |

Constraints:

- `tournament_team_photos_bucket_check`: `CHECK ((bucket = 'tournament-team-photos'::text))`
- `tournament_team_photos_checksum_check`: `CHECK ((((lifecycle_status = ANY (ARRAY['upload_pending'::text, 'upload_failed'::text])) AND (checksum_sha256 IS NULL)) OR ((lifecycle_status <> ALL (ARRAY['upload_pending'::text, 'upload_failed'::text])) AND (checksum_sha256 ~ '^[0-9a-f]{64}$'::text))))`
- `tournament_team_photos_dimensions_check`: `CHECK (((width >= 1) AND (width <= 12000) AND ((height >= 1) AND (height <= 12000)) AND (((width)::bigint * (height)::bigint) <= 36000000)))`
- `tournament_team_photos_editorial_check`: `CHECK ((editorial_status = ANY (ARRAY['pending_review'::text, 'approved'::text, 'rejected'::text])))`
- `tournament_team_photos_entry_fk`: `FOREIGN KEY (organization_id, tournament_id, team_entry_id) REFERENCES tournament_team_entries(organization_id, tournament_id, id) ON DELETE RESTRICT`
- `tournament_team_photos_lifecycle_check`: `CHECK ((lifecycle_status = ANY (ARRAY['upload_pending'::text, 'active'::text, 'delete_pending'::text, 'replaced'::text, 'removed'::text, 'upload_failed'::text])))`
- `tournament_team_photos_mime_check`: `CHECK ((mime_type = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text])))`
- `tournament_team_photos_object_unique`: `UNIQUE (bucket, object_path)`
- `tournament_team_photos_org_id_unique`: `UNIQUE (organization_id, id)`
- `tournament_team_photos_path_check`: `CHECK ((object_path = (((((('organizations/'::text || (organization_id)::text) || '/team-entries/'::text) || (team_entry_id)::text) || '/'::text) || (id)::text) ||
CASE mime_type
    WHEN 'image/jpeg'::text THEN '.jpg'::text
    WHEN 'image/png'::text THEN '.png'::text
    WHEN 'image/webp'::text THEN '.webp'::text
    ELSE NULL::text
END)))`
- `tournament_team_photos_pkey`: `PRIMARY KEY (id)`
- `tournament_team_photos_remove_check`: `CHECK ((((lifecycle_status = 'removed'::text) AND (removed_at IS NOT NULL) AND (storage_purged_at IS NOT NULL)) OR ((lifecycle_status <> 'removed'::text) AND (removed_at IS NULL) AND (storage_purged_at IS NULL))))`
- `tournament_team_photos_replace_check`: `CHECK ((((lifecycle_status = 'replaced'::text) AND (replaced_at IS NOT NULL)) OR ((lifecycle_status <> 'replaced'::text) AND (replaced_at IS NULL) AND (replaced_by_id IS NULL))))`
- `tournament_team_photos_replaced_by_fk`: `FOREIGN KEY (organization_id, replaced_by_id) REFERENCES tournament_team_photos(organization_id, id) ON DELETE RESTRICT`
- `tournament_team_photos_review_check`: `CHECK ((((editorial_status = 'pending_review'::text) AND (reviewed_by IS NULL) AND (reviewed_at IS NULL) AND (approved_at IS NULL) AND (review_reason IS NULL)) OR ((editorial_status = 'approved'::text) AND (reviewed_by IS NOT NULL) AND (reviewed_at IS NOT NULL) AND (approved_at IS NOT NULL) AND (review_reason IS NULL)) OR ((editorial_status = 'rejected'::text) AND (reviewed_by IS NOT NULL) AND (reviewed_at IS NOT NULL) AND (approved_at IS NULL) AND ((review_reason IS NULL) OR ((review_reason = btrim(review_reason)) AND ((char_length(review_reason) >= 1) AND (char_length(review_reason) <= 500)))))))`
- `tournament_team_photos_reviewed_by_fk`: `FOREIGN KEY (reviewed_by) REFERENCES torneos_identity(id) ON DELETE SET NULL`
- `tournament_team_photos_revoke_check`: `CHECK ((((revoked_at IS NULL) AND (revoked_by IS NULL)) OR ((revoked_at IS NOT NULL) AND (revoked_by IS NOT NULL) AND (editorial_status = 'approved'::text) AND (lifecycle_status = 'replaced'::text) AND (replaced_by_id IS NULL))))`
- `tournament_team_photos_revoked_by_fk`: `FOREIGN KEY (revoked_by) REFERENCES torneos_identity(id) ON DELETE SET NULL`
- `tournament_team_photos_size_check`: `CHECK (((byte_size >= 1) AND (byte_size <= 8388608)))`
- `tournament_team_photos_uploaded_by_fk`: `FOREIGN KEY (uploaded_by) REFERENCES torneos_identity(id) ON DELETE SET NULL`

### tournament_team_reviews

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| team_entry_id | uuid | True | None |
| roster_id | uuid | True | None |
| decision | text | True | None |
| reason | text | True | None |
| issues | jsonb | True | '[]'::jsonb |
| created_by | uuid | True | None |
| created_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_team_reviews_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournament_team_reviews_decision_check`: `CHECK ((decision = ANY (ARRAY['changes_requested'::text, 'approved'::text, 'rejected'::text])))`
- `tournament_team_reviews_entry_fk`: `FOREIGN KEY (organization_id, team_entry_id) REFERENCES tournament_team_entries(organization_id, id) ON DELETE RESTRICT`
- `tournament_team_reviews_issues_check`: `CHECK ((jsonb_typeof(issues) = 'array'::text))`
- `tournament_team_reviews_pkey`: `PRIMARY KEY (id)`
- `tournament_team_reviews_reason_check`: `CHECK (((reason = btrim(reason)) AND ((char_length(reason) >= 3) AND (char_length(reason) <= 1200))))`
- `tournament_team_reviews_roster_fk`: `FOREIGN KEY (organization_id, team_entry_id, roster_id) REFERENCES tournament_rosters(organization_id, team_entry_id, id) ON DELETE RESTRICT`

### tournament_team_standings

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| revision_id | uuid | True | None |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| category_id | uuid | True | None |
| phase_id | uuid | True | None |
| group_id | uuid | False | None |
| participant_id | uuid | True | None |
| team_entry_id | uuid | True | None |
| position | integer | False | None |
| played | integer | True | 0 |
| won | integer | True | 0 |
| drawn | integer | True | 0 |
| lost | integer | True | 0 |
| goals_for | integer | True | 0 |
| goals_against | integer | True | 0 |
| goal_difference | integer | True | 0 |
| base_points | integer | True | 0 |
| points_adjustment | integer | True | 0 |
| points | integer | True | 0 |
| walkovers | integer | True | 0 |
| administrative_results | integer | True | 0 |
| fair_play_points | integer | True | 0 |
| classification_status | text | True | 'pending'::text |
| tiebreak_trace | jsonb | True | '{}'::jsonb |
| created_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_team_standings_classification_check`: `CHECK ((classification_status = ANY (ARRAY['pending'::text, 'qualified'::text, 'eliminated'::text, 'playoff'::text, 'manual_review'::text])))`
- `tournament_team_standings_counts_check`: `CHECK (((played >= 0) AND (won >= 0) AND (drawn >= 0) AND (lost >= 0) AND (goals_for >= 0) AND (goals_against >= 0) AND (walkovers >= 0) AND (administrative_results >= 0) AND (fair_play_points >= 0) AND (played = ((won + drawn) + lost)) AND (goal_difference = (goals_for - goals_against)) AND (points = (base_points + points_adjustment))))`
- `tournament_team_standings_entry_fk`: `FOREIGN KEY (organization_id, tournament_id, team_entry_id) REFERENCES tournament_team_entries(organization_id, tournament_id, id) ON DELETE RESTRICT`
- `tournament_team_standings_participant_fk`: `FOREIGN KEY (participant_id) REFERENCES tournament_competition_participants(id) ON DELETE RESTRICT`
- `tournament_team_standings_pkey`: `PRIMARY KEY (id)`
- `tournament_team_standings_revision_fk`: `FOREIGN KEY (organization_id, revision_id) REFERENCES tournament_standings_revisions(organization_id, id) ON DELETE RESTRICT`
- `tournament_team_standings_revision_participant_unique`: `UNIQUE (revision_id, participant_id)`
- `tournament_team_standings_revision_position_unique`: `UNIQUE (revision_id, "position")`
- `tournament_team_standings_trace_check`: `CHECK (((jsonb_typeof(tiebreak_trace) = 'object'::text) AND (pg_column_size(tiebreak_trace) <= 16384)))`
- `tournament_team_standings_values_check`: `CHECK ((("position" IS NULL) OR ("position" > 0)))`

### tournament_team_statistics

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| revision_id | uuid | True | None |
| organization_id | uuid | True | None |
| participant_id | uuid | True | None |
| team_entry_id | uuid | True | None |
| goals | integer | True | 0 |
| own_goals_benefited | integer | True | 0 |
| yellow_cards | integer | True | 0 |
| second_yellows | integer | True | 0 |
| red_cards | integer | True | 0 |
| home_played | integer | True | 0 |
| away_played | integer | True | 0 |
| suspended_matches | integer | True | 0 |
| administrative_matches | integer | True | 0 |
| recent_form | jsonb | True | '[]'::jsonb |
| streak_type | text | False | None |
| streak_count | integer | True | 0 |

Constraints:

- `tournament_team_statistics_counts_check`: `CHECK (((goals >= 0) AND (own_goals_benefited >= 0) AND (yellow_cards >= 0) AND (second_yellows >= 0) AND (red_cards >= 0) AND (home_played >= 0) AND (away_played >= 0) AND (suspended_matches >= 0) AND (administrative_matches >= 0) AND (streak_count >= 0)))`
- `tournament_team_statistics_form_check`: `CHECK (((jsonb_typeof(recent_form) = 'array'::text) AND (jsonb_array_length(recent_form) <= 5)))`
- `tournament_team_statistics_participant_fk`: `FOREIGN KEY (participant_id) REFERENCES tournament_competition_participants(id) ON DELETE RESTRICT`
- `tournament_team_statistics_pkey`: `PRIMARY KEY (revision_id, participant_id)`
- `tournament_team_statistics_revision_fk`: `FOREIGN KEY (organization_id, revision_id) REFERENCES tournament_standings_revisions(organization_id, id) ON DELETE RESTRICT`
- `tournament_team_statistics_streak_check`: `CHECK (((streak_type IS NULL) OR (streak_type = ANY (ARRAY['win'::text, 'draw'::text, 'loss'::text, 'unbeaten'::text]))))`

### tournament_tiebreak_rules

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| tournament_id | uuid | True | None |
| criterion | text | True | None |
| sort_order | smallint | True | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `tournament_tiebreak_rules_criterion_check`: `CHECK ((criterion = ANY (ARRAY['goal_difference'::text, 'goals_for'::text, 'head_to_head'::text, 'matches_won'::text, 'fair_play'::text, 'playoff_match'::text, 'draw'::text])))`
- `tournament_tiebreak_rules_criterion_unique`: `UNIQUE (tournament_id, criterion)`
- `tournament_tiebreak_rules_order_check`: `CHECK (((sort_order >= 1) AND (sort_order <= 7)))`
- `tournament_tiebreak_rules_order_unique`: `UNIQUE (tournament_id, sort_order)`
- `tournament_tiebreak_rules_pkey`: `PRIMARY KEY (id)`
- `tournament_tiebreak_rules_tournament_fk`: `FOREIGN KEY (organization_id, tournament_id) REFERENCES tournaments(organization_id, id) ON DELETE RESTRICT`

### tournament_venues

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| name | text | True | None |
| address | text | True | None |
| place_id | text | False | None |
| latitude | double precision | False | None |
| longitude | double precision | False | None |
| locality | text | False | None |
| timezone | text | True | 'America/Argentina/Buenos_Aires'::text |
| status | text | True | 'active'::text |
| notes | text | False | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |
| archived_at | timestamp with time zone | False | None |

Constraints:

- `tournament_venues_address_check`: `CHECK (((address = btrim(address)) AND ((char_length(address) >= 3) AND (char_length(address) <= 300))))`
- `tournament_venues_archive_check`: `CHECK ((((status = 'archived'::text) AND (archived_at IS NOT NULL)) OR ((status = 'active'::text) AND (archived_at IS NULL))))`
- `tournament_venues_coordinates_check`: `CHECK ((((latitude IS NULL) AND (longitude IS NULL)) OR ((latitude >= ('-90'::integer)::double precision) AND (latitude <= (90)::double precision) AND ((longitude >= ('-180'::integer)::double precision) AND (longitude <= (180)::double precision)) AND (NOT ((latitude = (0)::double precision) AND (longitude = (0)::double precision))))))`
- `tournament_venues_name_check`: `CHECK (((name = btrim(name)) AND ((char_length(name) >= 2) AND (char_length(name) <= 120))))`
- `tournament_venues_notes_check`: `CHECK (((notes IS NULL) OR (char_length(notes) <= 1000)))`
- `tournament_venues_organization_id_fkey`: `FOREIGN KEY (organization_id) REFERENCES tournament_organizations(id) ON DELETE RESTRICT`
- `tournament_venues_pkey`: `PRIMARY KEY (id)`
- `tournament_venues_place_id_check`: `CHECK (((place_id IS NULL) OR ((char_length(place_id) >= 3) AND (char_length(place_id) <= 300))))`
- `tournament_venues_scope_unique`: `UNIQUE (organization_id, id)`
- `tournament_venues_status_check`: `CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))`
- `tournament_venues_timezone_check`: `CHECK (((timezone = btrim(timezone)) AND ((char_length(timezone) >= 3) AND (char_length(timezone) <= 80))))`

### tournaments

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| id | uuid | True | gen_random_uuid() |
| organization_id | uuid | True | None |
| season_id | uuid | True | None |
| name | text | True | None |
| slug | text | True | None |
| description | text | False | None |
| status | text | True | 'draft'::text |
| sport_modality | text | True | None |
| competition_format | text | True | None |
| gender_category | text | True | 'open'::text |
| team_size | smallint | True | None |
| substitutes_limit | smallint | False | None |
| start_date | date | False | None |
| end_date | date | False | None |
| registration_opens_at | timestamp with time zone | False | None |
| registration_closes_at | timestamp with time zone | False | None |
| format_settings | jsonb | True | '{}'::jsonb |
| created_by | uuid | True | None |
| creation_key | uuid | True | None |
| created_at | timestamp with time zone | True | now() |
| updated_at | timestamp with time zone | True | now() |
| archived_at | timestamp with time zone | False | None |
| started_at | timestamp with time zone | False | None |
| completed_at | timestamp with time zone | False | None |
| reopened_at | timestamp with time zone | False | None |
| reopen_count | integer | True | 0 |
| logo_path | text | False | None |
| team_visual_management_policy | text | True | 'organization_only'::text |

Constraints:

- `tournaments_archive_state_check`: `CHECK ((((status = 'archived'::text) AND (archived_at IS NOT NULL)) OR ((status <> 'archived'::text) AND (archived_at IS NULL))))`
- `tournaments_competition_format_fkey`: `FOREIGN KEY (competition_format) REFERENCES tournament_competition_formats(code) ON DELETE RESTRICT`
- `tournaments_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES torneos_identity(id) ON DELETE RESTRICT`
- `tournaments_creation_unique`: `UNIQUE (organization_id, created_by, creation_key)`
- `tournaments_dates_check`: `CHECK (((start_date IS NULL) OR (end_date IS NULL) OR (end_date >= start_date)))`
- `tournaments_description_check`: `CHECK (((description IS NULL) OR (char_length(description) <= 1200)))`
- `tournaments_format_settings_object_check`: `CHECK ((jsonb_typeof(format_settings) = 'object'::text))`
- `tournaments_gender_check`: `CHECK ((gender_category = ANY (ARRAY['male'::text, 'female'::text, 'mixed'::text, 'open'::text])))`
- `tournaments_logo_path_check`: `CHECK (((logo_path IS NULL) OR ((char_length(logo_path) >= 1) AND (char_length(logo_path) <= 512) AND (logo_path ~ (((('^'::text || (organization_id)::text) || '/tournaments/'::text) || (id)::text) || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'::text)) AND (logo_path !~ '(^|/)\.{1,2}(/|$)'::text) AND (logo_path !~ '//'::text))))`
- `tournaments_name_check`: `CHECK (((name = btrim(name)) AND ((char_length(name) >= 3) AND (char_length(name) <= 100))))`
- `tournaments_org_id_season_unique`: `UNIQUE (organization_id, id, season_id)`
- `tournaments_org_id_unique`: `UNIQUE (organization_id, id)`
- `tournaments_pkey`: `PRIMARY KEY (id)`
- `tournaments_registration_dates_check`: `CHECK (((registration_opens_at IS NULL) OR (registration_closes_at IS NULL) OR (registration_closes_at >= registration_opens_at)))`
- `tournaments_roster_limits_check`: `CHECK (((team_size >= 5) AND (team_size <= 11) AND ((substitutes_limit IS NULL) OR ((substitutes_limit >= 0) AND (substitutes_limit <= 30)))))`
- `tournaments_season_fk`: `FOREIGN KEY (organization_id, season_id) REFERENCES tournament_seasons(organization_id, id) ON DELETE RESTRICT`
- `tournaments_slug_check`: `CHECK (((slug ~ '^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$'::text) AND ((char_length(slug) >= 3) AND (char_length(slug) <= 64))))`
- `tournaments_slug_unique`: `UNIQUE (season_id, slug)`
- `tournaments_sport_modality_fkey`: `FOREIGN KEY (sport_modality) REFERENCES tournament_sport_modalities(code) ON DELETE RESTRICT`
- `tournaments_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'registration'::text, 'scheduled'::text, 'active'::text, 'completed'::text, 'archived'::text])))`
- `tournaments_team_visual_management_policy_check`: `CHECK ((team_visual_management_policy = ANY (ARRAY['organization_only'::text, 'delegates'::text, 'roster'::text])))`

### user_tournament_context_preferences

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| user_id | uuid | True | None |
| organization_id | uuid | True | None |
| active_season_id | uuid | False | None |
| active_tournament_id | uuid | False | None |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `user_tournament_context_preferences_organization_id_fkey`: `FOREIGN KEY (organization_id) REFERENCES tournament_organizations(id) ON DELETE CASCADE`
- `user_tournament_context_preferences_pkey`: `PRIMARY KEY (user_id, organization_id)`
- `user_tournament_context_preferences_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES torneos_identity(id) ON DELETE CASCADE`
- `user_tournament_context_season_fk`: `FOREIGN KEY (organization_id, active_season_id) REFERENCES tournament_seasons(organization_id, id) ON DELETE RESTRICT`
- `user_tournament_context_tournament_fk`: `FOREIGN KEY (organization_id, active_tournament_id, active_season_id) REFERENCES tournaments(organization_id, id, season_id) ON DELETE RESTRICT`
- `user_tournament_context_tournament_requires_season`: `CHECK (((active_tournament_id IS NULL) OR (active_season_id IS NOT NULL)))`

### user_workspace_preferences

RLS: True; FORCE RLS: False. ACL: `['supabase_admin=arwdDxtm/supabase_admin', 'authenticated=arwd/supabase_admin', 'anon=r/supabase_admin', 'service_role=arwd/supabase_admin']`. ACL nula conserva solamente los permisos implícitos del propietario.

| Columna | Tipo | NOT NULL | Default |
|---|---|---|---|
| user_id | uuid | True | None |
| workspace_type | text | True | 'personal'::text |
| active_organization_id | uuid | False | None |
| updated_at | timestamp with time zone | True | now() |

Constraints:

- `user_workspace_preferences_active_organization_id_fkey`: `FOREIGN KEY (active_organization_id) REFERENCES tournament_organizations(id) ON DELETE SET NULL`
- `user_workspace_preferences_context_check`: `CHECK ((((workspace_type = 'personal'::text) AND (active_organization_id IS NULL)) OR ((workspace_type = 'tournament_organization'::text) AND (active_organization_id IS NOT NULL))))`
- `user_workspace_preferences_pkey`: `PRIMARY KEY (user_id)`
- `user_workspace_preferences_type_check`: `CHECK ((workspace_type = ANY (ARRAY['personal'::text, 'tournament_organization'::text])))`
- `user_workspace_preferences_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES torneos_identity(id) ON DELETE CASCADE`

## Políticas RLS finales

61 históricas conservadas con identidad adaptada + 2 de identity shadow. Las tablas internas sin políticas no permiten acceso a roles normales; se operan mediante RPC autorizadas o roles servidor. El owner de funciones SECURITY DEFINER conserva bypass; no se afirma FORCE RLS general.

### torneos_identity.bridge_identity

Operación: ALL; roles: torneos_identity_writer.

```sql
USING: true
WITH CHECK: true
```

### torneos_identity.own_identity

Operación: SELECT; roles: authenticated.

```sql
USING: ((id = (((NULLIF(current_setting('request.jwt.claims'::text, true), ''::text))::jsonb ->> 'sub'::text))::uuid) AND ((core_user_id)::text = ((NULLIF(current_setting('request.jwt.claims'::text, true), ''::text))::jsonb ->> 'core_user_id'::text)))
WITH CHECK: None
```

### tournament_audit_log.tournament_audit_log_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: (has_tournament_organization_capability(organization_id, 'team_entries.review'::text) OR ((team_entry_id IS NOT NULL) AND is_tournament_team_manager(team_entry_id, false)))
WITH CHECK: None
```

### tournament_categories.tournament_categories_select_season_scope

Operación: SELECT; roles: authenticated.

```sql
USING: ( SELECT has_tournament_capability(tournament_categories.organization_id, tournament_categories.tournament_id, 'categories.read'::text) AS has_tournament_capability)
WITH CHECK: None
```

### tournament_competition_formats.tournament_competition_formats_select_authenticated

Operación: SELECT; roles: authenticated.

```sql
USING: true
WITH CHECK: None
```

### tournament_competition_participants.tournament_competition_participants_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: (has_tournament_organization_capability(organization_id, 'participants.read'::text) OR is_tournament_team_manager(team_entry_id, false))
WITH CHECK: None
```

### tournament_courts.tournament_courts_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: (has_tournament_organization_capability(organization_id, 'courts.read'::text) OR (EXISTS ( SELECT 1
   FROM tournament_matches match_row
  WHERE ((match_row.court_id = match_row.id) AND can_read_tournament_match(match_row.id)))))
WITH CHECK: None
```

### tournament_disciplinary_overrides.tournament_disciplinary_overrides_select_manage

Operación: SELECT; roles: authenticated.

```sql
USING: has_tournament_organization_capability(organization_id, 'discipline.manage'::text)
WITH CHECK: None
```

### tournament_discipline_ledgers.tournament_discipline_ledgers_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: (EXISTS ( SELECT 1
   FROM tournament_standings_revisions revision
  WHERE ((revision.id = tournament_discipline_ledgers.revision_id) AND (revision.organization_id = revision.organization_id) AND (revision.status = 'published'::text) AND can_read_tournament_projection_scope(revision.organization_id, revision.tournament_id))))
WITH CHECK: None
```

### tournament_discipline_rules.tournament_discipline_rules_select_capability

Operación: SELECT; roles: authenticated.

```sql
USING: has_tournament_organization_capability(organization_id, 'competition_rules.read'::text)
WITH CHECK: None
```

### tournament_draw_pot_members.tournament_draw_pot_members_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: (EXISTS ( SELECT 1
   FROM tournament_draw_pots pot
  WHERE ((pot.id = tournament_draw_pot_members.pot_id) AND can_read_tournament_fixture_scope(pot.organization_id, pot.tournament_id))))
WITH CHECK: None
```

### tournament_draw_pots.tournament_draw_pots_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: can_read_tournament_fixture_scope(organization_id, tournament_id)
WITH CHECK: None
```

### tournament_fixture_versions.tournament_fixture_versions_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: can_read_tournament_fixture_scope(organization_id, tournament_id)
WITH CHECK: None
```

### tournament_group_members.tournament_group_members_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: (EXISTS ( SELECT 1
   FROM tournament_groups group_row
  WHERE ((group_row.id = tournament_group_members.group_id) AND can_read_tournament_fixture_scope(group_row.organization_id, group_row.tournament_id))))
WITH CHECK: None
```

### tournament_groups.tournament_groups_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: can_read_tournament_fixture_scope(organization_id, tournament_id)
WITH CHECK: None
```

### tournament_match_availability_responses.tournament_match_availability_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: ((user_id = private.current_identity_id()) OR has_tournament_organization_capability(organization_id, 'match_availability.read'::text) OR is_tournament_team_manager(team_entry_id, false))
WITH CHECK: None
```

### tournament_match_events.tournament_match_events_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: has_tournament_organization_capability(organization_id, 'match_events.read'::text)
WITH CHECK: None
```

### tournament_match_operation_players.tournament_match_operation_players_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: has_tournament_organization_capability(organization_id, 'match_operations.read'::text)
WITH CHECK: None
```

### tournament_match_operations.tournament_match_operations_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: has_tournament_organization_capability(organization_id, 'match_operations.read'::text)
WITH CHECK: None
```

### tournament_match_outcomes.tournament_match_outcomes_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: has_tournament_organization_capability(organization_id, 'match_operations.read'::text)
WITH CHECK: None
```

### tournament_match_reschedules.tournament_match_reschedules_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: can_read_tournament_match(match_id)
WITH CHECK: None
```

### tournament_match_resumptions.tournament_match_resumptions_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: has_tournament_organization_capability(organization_id, 'match_operations.read'::text)
WITH CHECK: None
```

### tournament_match_reviews.tournament_match_reviews_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: has_tournament_organization_capability(organization_id, 'match_operations.review'::text)
WITH CHECK: None
```

### tournament_match_scores.tournament_match_scores_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: has_tournament_organization_capability(organization_id, 'match_operations.read'::text)
WITH CHECK: None
```

### tournament_match_sources.tournament_match_sources_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: can_read_tournament_match(match_id)
WITH CHECK: None
```

### tournament_match_squad_players.tournament_match_squad_players_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: (has_tournament_organization_capability(organization_id, 'match_squads.read'::text) OR is_tournament_team_manager(team_entry_id, false) OR (EXISTS ( SELECT 1
   FROM tournament_roster_players player
  WHERE ((player.id = tournament_match_squad_players.roster_player_id) AND (player.arma2_user_id = private.current_identity_id()) AND (player.status = 'active'::text) AND (player.eligibility_status = 'eligible'::text)))))
WITH CHECK: None
```

### tournament_match_squads.tournament_match_squads_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: (has_tournament_organization_capability(organization_id, 'match_squads.read'::text) OR is_tournament_team_manager(team_entry_id, false))
WITH CHECK: None
```

### tournament_matches.tournament_matches_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: can_read_tournament_match(id)
WITH CHECK: None
```

### tournament_organization_members.tournament_organization_members_select_member

Operación: SELECT; roles: authenticated.

```sql
USING: has_tournament_organization_capability(organization_id, 'members.read'::text)
WITH CHECK: None
```

### tournament_organizations.tournament_organizations_select_member

Operación: SELECT; roles: authenticated.

```sql
USING: is_tournament_organization_member(id)
WITH CHECK: None
```

### tournament_participant_sets.tournament_participant_sets_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: can_read_tournament_fixture_scope(organization_id, tournament_id)
WITH CHECK: None
```

### tournament_phases.tournament_phases_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: can_read_tournament_fixture_scope(organization_id, tournament_id)
WITH CHECK: None
```

### tournament_player_portraits.tournament_player_portraits_read_authorized

Operación: SELECT; roles: authenticated.

```sql
USING: can_read_tournament_player_portrait(organization_id, roster_player_id)
WITH CHECK: None
```

### tournament_player_statistics.tournament_player_statistics_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: (EXISTS ( SELECT 1
   FROM tournament_standings_revisions revision
  WHERE ((revision.id = tournament_player_statistics.revision_id) AND (revision.organization_id = revision.organization_id) AND ((revision.status = 'published'::text) OR has_tournament_organization_capability(revision.organization_id, 'statistics.rebuild'::text)) AND can_read_tournament_projection_scope(revision.organization_id, revision.tournament_id))))
WITH CHECK: None
```

### tournament_player_suspensions.tournament_player_suspensions_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: (EXISTS ( SELECT 1
   FROM tournament_standings_revisions revision
  WHERE ((revision.id = tournament_player_suspensions.revision_id) AND (revision.organization_id = revision.organization_id) AND (revision.status = 'published'::text) AND has_tournament_organization_capability(revision.organization_id, 'discipline.read'::text))))
WITH CHECK: None
```

### tournament_points_adjustments.tournament_points_adjustments_select_manage

Operación: SELECT; roles: authenticated.

```sql
USING: has_tournament_organization_capability(organization_id, 'standings.override'::text)
WITH CHECK: None
```

### tournament_projection_sources.tournament_projection_sources_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: (EXISTS ( SELECT 1
   FROM tournament_standings_revisions revision
  WHERE ((revision.id = tournament_projection_sources.revision_id) AND (revision.organization_id = revision.organization_id) AND has_tournament_organization_capability(revision.organization_id, 'standings.rebuild'::text))))
WITH CHECK: None
```

### tournament_provisional_players.tournament_provisional_players_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: (has_tournament_organization_capability(organization_id, 'roster_players.read'::text) OR (EXISTS ( SELECT 1
   FROM tournament_roster_players player
  WHERE ((player.provisional_player_id = tournament_provisional_players.id) AND is_tournament_team_manager(player.team_entry_id, false)))))
WITH CHECK: None
```

### tournament_qualification_resolutions.tournament_qualification_resolutions_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: has_tournament_organization_capability(organization_id, 'qualification.read'::text)
WITH CHECK: None
```

### tournament_qualification_slots.tournament_qualification_slots_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: has_tournament_organization_capability(organization_id, 'qualification.read'::text)
WITH CHECK: None
```

### tournament_roster_players.tournament_roster_players_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: can_read_tournament_team_entry(organization_id, team_entry_id)
WITH CHECK: None
```

### tournament_roster_settings.tournament_roster_settings_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: (has_tournament_organization_capability(organization_id, 'rosters.read'::text) AND (EXISTS ( SELECT 1
   FROM tournaments tournament
  WHERE ((tournament.id = tournament_roster_settings.tournament_id) AND (tournament.organization_id = tournament_roster_settings.organization_id) AND (tournament.status <> 'archived'::text)))))
WITH CHECK: None
```

### tournament_rosters.tournament_rosters_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: can_read_tournament_team_entry(organization_id, team_entry_id)
WITH CHECK: None
```

### tournament_rounds.tournament_rounds_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: can_read_tournament_fixture_scope(organization_id, tournament_id)
WITH CHECK: None
```

### tournament_schedule_windows.tournament_schedule_windows_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: has_tournament_organization_capability(organization_id, 'schedule_windows.read'::text)
WITH CHECK: None
```

### tournament_scoring_rules.tournament_scoring_rules_select_capability

Operación: SELECT; roles: authenticated.

```sql
USING: has_tournament_organization_capability(organization_id, 'competition_rules.read'::text)
WITH CHECK: None
```

### tournament_season_member_assignments.tournament_season_member_assignments_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: (( SELECT has_tournament_season_capability(tournament_season_member_assignments.organization_id, tournament_season_member_assignments.season_id, 'members.read'::text) AS has_tournament_season_capability) OR (EXISTS ( SELECT 1
   FROM tournament_organization_members membership
  WHERE ((membership.id = tournament_season_member_assignments.membership_id) AND (membership.user_id = ( SELECT private.current_identity_id() AS uid))))))
WITH CHECK: None
```

### tournament_seasons.tournament_seasons_select_season_scope

Operación: SELECT; roles: authenticated.

```sql
USING: ( SELECT has_tournament_season_access(tournament_seasons.organization_id, tournament_seasons.id) AS has_tournament_season_access)
WITH CHECK: None
```

### tournament_sport_modalities.tournament_sport_modalities_select_authenticated

Operación: SELECT; roles: authenticated.

```sql
USING: true
WITH CHECK: None
```

### tournament_standings_revisions.tournament_standings_revisions_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: (has_tournament_organization_capability(organization_id, 'standings.rebuild'::text) AND ((status = 'published'::text) OR has_tournament_organization_capability(organization_id, 'standings.rebuild'::text)))
WITH CHECK: None
```

### tournament_suspension_served_matches.tournament_suspension_served_matches_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: (EXISTS ( SELECT 1
   FROM tournament_player_suspensions suspension
  WHERE ((suspension.id = tournament_suspension_served_matches.suspension_id) AND (suspension.organization_id = suspension.organization_id) AND has_tournament_organization_capability(suspension.organization_id, 'suspensions.read'::text))))
WITH CHECK: None
```

### tournament_team_entries.tournament_team_entries_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: can_read_tournament_team_entry(organization_id, id)
WITH CHECK: None
```

### tournament_team_invitations.tournament_team_invitations_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: (has_tournament_organization_capability(organization_id, 'team_managers.read'::text) AND can_read_tournament_team_entry(organization_id, team_entry_id))
WITH CHECK: None
```

### tournament_team_managers.tournament_team_managers_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: can_read_tournament_team_entry(organization_id, team_entry_id)
WITH CHECK: None
```

### tournament_team_photos.tournament_team_photos_read_current

Operación: SELECT; roles: authenticated.

```sql
USING: ((lifecycle_status = 'active'::text) AND (editorial_status = 'approved'::text) AND can_read_tournament_team_photo_as(organization_id, team_entry_id, private.current_identity_id()))
WITH CHECK: None
```

### tournament_team_reviews.tournament_team_reviews_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: can_read_tournament_team_entry(organization_id, team_entry_id)
WITH CHECK: None
```

### tournament_team_standings.tournament_team_standings_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: (EXISTS ( SELECT 1
   FROM tournament_standings_revisions revision
  WHERE ((revision.id = tournament_team_standings.revision_id) AND (revision.organization_id = revision.organization_id) AND ((revision.status = 'published'::text) OR has_tournament_organization_capability(revision.organization_id, 'standings.rebuild'::text)) AND can_read_tournament_projection_scope(revision.organization_id, revision.tournament_id))))
WITH CHECK: None
```

### tournament_team_statistics.tournament_team_statistics_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: (EXISTS ( SELECT 1
   FROM tournament_standings_revisions revision
  WHERE ((revision.id = tournament_team_statistics.revision_id) AND (revision.organization_id = revision.organization_id) AND ((revision.status = 'published'::text) OR has_tournament_organization_capability(revision.organization_id, 'statistics.rebuild'::text)) AND can_read_tournament_projection_scope(revision.organization_id, revision.tournament_id))))
WITH CHECK: None
```

### tournament_tiebreak_rules.tournament_tiebreak_rules_select_capability

Operación: SELECT; roles: authenticated.

```sql
USING: has_tournament_organization_capability(organization_id, 'competition_rules.read'::text)
WITH CHECK: None
```

### tournament_venues.tournament_venues_select_scope

Operación: SELECT; roles: authenticated.

```sql
USING: (has_tournament_organization_capability(organization_id, 'venues.read'::text) OR (EXISTS ( SELECT 1
   FROM tournament_matches match_row
  WHERE ((match_row.venue_id = match_row.id) AND can_read_tournament_match(match_row.id)))))
WITH CHECK: None
```

### tournaments.tournaments_select_season_scope

Operación: SELECT; roles: authenticated.

```sql
USING: ( SELECT has_tournament_season_access(tournaments.organization_id, tournaments.season_id) AS has_tournament_season_access)
WITH CHECK: None
```

### user_tournament_context_preferences.user_tournament_context_select_own

Operación: SELECT; roles: authenticated.

```sql
USING: ((user_id = private.current_identity_id()) AND has_tournament_organization_capability(organization_id, 'workspace.access'::text))
WITH CHECK: None
```

### user_workspace_preferences.user_workspace_preferences_select_own

Operación: SELECT; roles: authenticated.

```sql
USING: (user_id = private.current_identity_id())
WITH CHECK: None
```

## Funciones y grants

366 funciones del candidato: 358 Torneos históricas, wrapper local gen_random_uuid, tres helpers privados de identidad, tres del boundary Core (Phase 2B) y uno de scope de temporada. Las 305 SECURITY DEFINER permanecen como RPC/helpers con sus ACL finales: moverlas de schema alteraría la API. Su disposición semántica está en evidence/security-definer-review.json (Phase 2B).

### private.authorize_core_contract(p_contract text, p_request jsonb)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'torneos_core_adapter=X/supabase_admin']`.

### private.check_token()

Retorna `void`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### private.consume_core_attestation(p_contract text, p_request jsonb)

Retorna `jsonb`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### private.core_contract_request_hash(p_contract text, p_request jsonb)

Retorna `text`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### private.current_identity_id()

Retorna `uuid`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### private.has_tournament_season_access_as(p_organization_id uuid, p_season_id uuid, p_actor_user_id uuid)

Retorna `boolean`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### private.prevent_identity_reassignment()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.accept_tournament_team_invitation(p_token text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.acknowledge_tournament_document(p_version_id uuid, p_confirm boolean)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.activate_verified_fake_tournament_purchase(p_purchase_id uuid, p_provider_payment_id text, p_simulated_activation_error_code text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.activate_verified_tournament_purchase(p_purchase_id uuid, p_provider text, p_provider_environment text, p_provider_status text, p_provider_status_detail text, p_provider_payment_id text, p_simulated_activation_error_code text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.add_tournament_match_event(p_organization_id uuid, p_match_operation_id uuid, p_event jsonb)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.add_tournament_roster_player(p_organization_id uuid, p_team_entry_id uuid, p_roster_id uuid, p_arma2_user_id uuid, p_provisional_player_id uuid, p_display_name text, p_avatar_url text, p_shirt_number smallint, p_primary_position text, p_secondary_position text, p_is_goalkeeper boolean)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.append_tournament_audit(p_organization_id uuid, p_action text, p_resource_type text, p_resource_id uuid, p_team_entry_id uuid, p_tournament_id uuid, p_metadata jsonb)

Retorna `bigint`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.append_tournament_playoff_phase(p_organization_id uuid, p_tournament_id uuid, p_category_id uuid, p_source_phase_id uuid, p_qualifier_count integer, p_double_leg boolean, p_idempotency_key uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.apply_fake_tournament_payment_status(p_purchase_id uuid, p_status text, p_provider_status_detail text, p_provider_payment_id text, p_simulated_activation_error_code text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.apply_tournament_purchase_reversal(p_purchase_id uuid, p_action text, p_reason text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.approve_tournament_team_entry(p_organization_id uuid, p_team_entry_id uuid, p_reason text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.archive_tournament_announcement(p_announcement_id uuid)

Retorna `uuid`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.archive_tournament_document(p_document_id uuid)

Retorna `uuid`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.archive_tournament_fixture(p_organization_id uuid, p_fixture_version_id uuid, p_reason text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.archive_tournament_team_entry(p_organization_id uuid, p_team_entry_id uuid, p_reason text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.assert_tournament_fixture_scope(p_organization_id uuid, p_tournament_id uuid, p_category_id uuid, p_capability text, p_allowed_statuses text[])

Retorna `void`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.assign_first_free_plan_on_tournament_insert()

Retorna `trigger`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.assign_tournament_media_photographer(p_gallery_id uuid, p_user_id uuid, p_revoke boolean)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.assign_tournament_season_member(p_organization_id uuid, p_season_id uuid, p_membership_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.attest_tournament_media_service(p_service text, p_release text, p_capabilities jsonb, p_ttl_seconds integer)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.authorize_tournament_media_read(p_actor_user_id uuid, p_asset_id uuid, p_kind text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.authorize_tournament_media_upload_target(p_session_id uuid, p_token text, p_actor_user_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.authorize_tournament_player_portrait_read(p_actor_user_id uuid, p_portrait_id uuid, p_variant text, p_audience text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.authorize_tournament_social_export(p_organization_id uuid, p_tournament_id uuid, p_piece text, p_theme text, p_include_arma2_branding boolean)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.authorize_tournament_team_photo_read(p_actor_user_id uuid, p_team_photo_id uuid, p_variant text, p_audience text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.auto_schedule_tournament_matches(p_organization_id uuid, p_fixture_version_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.begin_tournament_media_asset_delete(p_actor_user_id uuid, p_asset_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.begin_tournament_player_portrait_delete(p_actor_user_id uuid, p_portrait_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.begin_tournament_team_photo_delete(p_actor_user_id uuid, p_team_photo_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.build_tournament_knockout(p_fixture_version_id uuid, p_phase_id uuid, p_sources jsonb, p_double_leg boolean, p_third_place boolean)

Retorna `void`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.build_tournament_round_robin(p_fixture_version_id uuid, p_phase_id uuid, p_group_id uuid, p_participants uuid[], p_double_round boolean)

Retorna `void`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.bulk_schedule_tournament_matches(p_organization_id uuid, p_assignments jsonb)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.can_access_tournament_communications(p_tournament_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.can_current_user_access_tournament_announcement(p_announcement_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.can_current_user_read_media_gallery(p_gallery_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.can_edit_tournament_team_entry(p_organization_id uuid, p_team_entry_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.can_manage_tournament_match_squad(p_organization_id uuid, p_match_id uuid, p_team_entry_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.can_manage_tournament_player_portrait(p_organization_id uuid, p_roster_player_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.can_manage_tournament_player_portrait_as(p_organization_id uuid, p_roster_player_id uuid, p_actor_user_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.can_manage_tournament_team_visual_assets_as(p_organization_id uuid, p_team_entry_id uuid, p_actor_user_id uuid, p_organization_capability text)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.can_moderate_tournament_team_visual_assets_as(p_organization_id uuid, p_team_entry_id uuid, p_actor_user_id uuid, p_organization_capability text)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.can_read_tournament_fixture_scope(p_organization_id uuid, p_tournament_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.can_read_tournament_match(p_match_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.can_read_tournament_match_operation(p_organization_id uuid, p_match_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.can_read_tournament_participant_hub(p_tournament_id uuid, p_category_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.can_read_tournament_player_portrait(p_organization_id uuid, p_roster_player_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.can_read_tournament_player_portrait_as(p_organization_id uuid, p_roster_player_id uuid, p_actor_user_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.can_read_tournament_projection_scope(p_organization_id uuid, p_tournament_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.can_read_tournament_team_entry(p_organization_id uuid, p_team_entry_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.can_read_tournament_team_photo_as(p_organization_id uuid, p_team_entry_id uuid, p_actor_user_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.can_update_tournament_team_branding(p_organization_id uuid, p_team_entry_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.can_write_tournament_branding_object(p_name text)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.cancel_tournament_match(p_organization_id uuid, p_match_id uuid, p_reason text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.cancel_tournament_media_upload_session(p_session_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.cancel_tournament_purchase(p_purchase_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.change_tournament_media_gallery_state(p_gallery_id uuid, p_action text, p_reason text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.change_tournament_status(p_organization_id uuid, p_tournament_id uuid, p_status text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.cleanup_tournament_media_processing_jobs(p_limit integer)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.cleanup_tournament_media_upload_sessions(p_limit integer)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.clear_tournament_entitlement_override(p_organization_id uuid, p_tournament_id uuid, p_capability text)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.complete_tournament_media_asset_delete(p_actor_user_id uuid, p_asset_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.complete_tournament_media_processing_job(p_job_id uuid, p_lease_token text, p_asset_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.complete_tournament_media_simple_upload(p_actor_user_id uuid, p_session_id uuid, p_token text, p_detected_mime text, p_byte_size bigint, p_width integer, p_height integer, p_checksum_sha256 text, p_metadata_stripped boolean)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.complete_tournament_media_upload(p_session_id uuid, p_token text, p_detected_mime text, p_byte_size bigint, p_width integer, p_height integer, p_checksum_sha256 text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.complete_tournament_media_upload_for_actor(p_actor_user_id uuid, p_session_id uuid, p_token text, p_detected_mime text, p_byte_size bigint, p_width integer, p_height integer, p_checksum_sha256 text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.complete_tournament_media_upload_for_job(p_job_id uuid, p_lease_token text, p_detected_mime text, p_byte_size bigint, p_width integer, p_height integer, p_checksum_sha256 text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.complete_tournament_player_portrait_delete(p_actor_user_id uuid, p_portrait_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.complete_tournament_team_photo_delete(p_actor_user_id uuid, p_team_photo_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.create_fake_tournament_purchase(p_organization_id uuid, p_tournament_id uuid, p_product_code text, p_idempotency_key uuid, p_provider_environment text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.create_fake_tournament_season_purchase(p_organization_id uuid, p_season_id uuid, p_product_code text, p_idempotency_key uuid, p_provider_environment text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.create_manual_fixture_version(p_organization_id uuid, p_tournament_id uuid, p_category_id uuid, p_source_fixture_version_id uuid, p_idempotency_key uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.create_tournament_announcement_draft(p_organization_id uuid, p_tournament_id uuid, p_category_id uuid, p_announcement_type text, p_title text, p_summary text, p_body text, p_priority text, p_acknowledgement_mode text, p_scheduled_for timestamp with time zone, p_supersedes_id uuid, p_correction_reason text, p_idempotency_key uuid)

Retorna `uuid`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.create_tournament_court(p_organization_id uuid, p_venue_id uuid, p_name text, p_sport_modality text, p_notes text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.create_tournament_disciplinary_override(p_suspension_id uuid, p_action text, p_matches integer, p_reason text, p_idempotency_key uuid)

Retorna `uuid`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.create_tournament_document(p_organization_id uuid, p_tournament_id uuid, p_category_id uuid, p_document_type text, p_title text, p_summary text, p_body text, p_acknowledgement_mode text, p_effective_at timestamp with time zone, p_idempotency_key uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.create_tournament_document_version(p_document_id uuid, p_summary text, p_body text, p_effective_at timestamp with time zone, p_correction_reason text)

Retorna `uuid`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.create_tournament_match_correction(p_organization_id uuid, p_match_operation_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.create_tournament_media_gallery(p_organization_id uuid, p_tournament_id uuid, p_category_id uuid, p_round_id uuid, p_match_id uuid, p_title text, p_description text, p_visibility text, p_idempotency_key uuid)

Retorna `uuid`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.create_tournament_organization(p_name text, p_slug text, p_idempotency_key uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.create_tournament_points_adjustment(p_organization_id uuid, p_fixture_version_id uuid, p_phase_id uuid, p_group_id uuid, p_participant_id uuid, p_points integer, p_reason text, p_idempotency_key uuid)

Retorna `uuid`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.create_tournament_provisional_player(p_organization_id uuid, p_team_entry_id uuid, p_display_name text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.create_tournament_season(p_organization_id uuid, p_name text, p_slug text, p_start_date date, p_end_date date, p_idempotency_key uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.create_tournament_season_purchase(p_organization_id uuid, p_season_id uuid, p_product_code text, p_idempotency_key uuid, p_provider text, p_provider_environment text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.create_tournament_team_entry(p_organization_id uuid, p_tournament_id uuid, p_category_id uuid, p_arma2_team_id uuid, p_name text, p_short_name text, p_primary_color text, p_secondary_color text, p_registration_source text, p_manager_user_id uuid, p_manager_email text, p_manager_display_name text, p_idempotency_key uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.create_tournament_venue(p_organization_id uuid, p_name text, p_address text, p_place_id text, p_latitude double precision, p_longitude double precision, p_locality text, p_timezone text, p_notes text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.create_tournament_with_defaults(p_organization_id uuid, p_season_id uuid, p_name text, p_slug text, p_description text, p_sport_modality text, p_competition_format text, p_gender_category text, p_start_date date, p_end_date date, p_idempotency_key uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.current_user_has_media_team_relation(p_team_entry_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.current_user_tournament_social_capabilities(p_organization_id uuid)

Retorna `text[]`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.digest(data text, type text)

Retorna `bytea`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.enforce_tournament_media_gallery_limit()

Retorna `trigger`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.enforce_tournament_media_matchday_limit()

Retorna `trigger`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.enforce_tournament_premium_gate()

Retorna `trigger`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.enforce_tournament_purchase_transition()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.enforce_tournament_season_purchase_scope()

Retorna `trigger`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.enforce_tournament_season_root_write_scope()

Retorna `trigger`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.enforce_tournament_status_premium_gate()

Retorna `trigger`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.enqueue_tournament_media_processing_job(p_session_id uuid, p_token text, p_actor_user_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.execute_tournament_group_draw(p_organization_id uuid, p_tournament_id uuid, p_category_id uuid, p_group_count integer, p_seed text, p_publish boolean)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.fail_tournament_media_processing_job(p_job_id uuid, p_lease_token text, p_failure_code text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.fail_tournament_media_upload_session(p_session_id uuid, p_failure_code text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.fail_tournament_player_portrait_upload(p_actor_user_id uuid, p_portrait_id uuid)

Retorna `void`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.fail_tournament_team_photo_upload(p_actor_user_id uuid, p_team_photo_id uuid)

Retorna `void`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.finalize_tournament_media_variants(p_asset_id uuid, p_variants jsonb)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.finalize_tournament_player_portrait_upload(p_actor_user_id uuid, p_portrait_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.finalize_tournament_team_photo_upload(p_actor_user_id uuid, p_team_photo_id uuid, p_checksum_sha256 text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.finish_tournament_competition(p_organization_id uuid, p_tournament_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.freeze_tournament_participants(p_organization_id uuid, p_tournament_id uuid, p_category_id uuid, p_idempotency_key uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.gen_random_bytes(p_length integer)

Retorna `bytea`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.gen_random_uuid()

Retorna `uuid`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.generate_tournament_fixture(p_organization_id uuid, p_tournament_id uuid, p_category_id uuid, p_seed text, p_configuration jsonb, p_idempotency_key uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.get_effective_tournament_entitlements(p_organization_id uuid, p_tournament_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.get_effective_tournament_season_entitlements(p_organization_id uuid, p_season_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.get_managed_tournament_matches()

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.get_match_squad_context(p_organization_id uuid, p_match_id uuid, p_team_entry_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.get_my_current_tournament_roster_players()

Retorna `TABLE(roster_player_id uuid, team_entry_id uuid)`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.get_my_managed_match_squad_context(p_match_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.get_my_tournament_memberships(p_limit integer, p_offset integer)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.get_my_tournament_notification_preferences(p_tournament_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.get_player_tournament_matches()

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.get_player_tournament_statistics(p_tournament_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.get_player_tournament_suspensions(p_tournament_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.get_public_tournament_branding(p_public_slug text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.get_public_tournament_commercial_catalog(p_version integer)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.get_public_tournament_page(p_public_slug text, p_category_slug text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.get_published_tournament_documents(p_tournament_id uuid, p_category_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin', 'anon=X/supabase_admin']`.

### public.get_published_tournament_matches(p_tournament_id uuid, p_category_id uuid, p_view text, p_team_entry_id uuid, p_limit integer, p_offset integer)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin', 'anon=X/supabase_admin']`.

### public.get_published_tournament_media(p_tournament_id uuid, p_category_id uuid, p_match_id uuid, p_limit integer, p_offset integer)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin', 'anon=X/supabase_admin']`.

### public.get_published_tournament_standings(p_tournament_id uuid, p_category_id uuid, p_phase_id uuid, p_group_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin', 'anon=X/supabase_admin']`.

### public.get_published_tournament_statistics(p_tournament_id uuid, p_category_id uuid, p_phase_id uuid, p_group_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin', 'anon=X/supabase_admin']`.

### public.get_published_tournament_teams(p_tournament_id uuid, p_category_id uuid, p_limit integer, p_offset integer)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin', 'anon=X/supabase_admin']`.

### public.get_team_registration_context(p_organization_id uuid, p_team_entry_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.get_tournament_announcement(p_announcement_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin', 'anon=X/supabase_admin']`.

### public.get_tournament_branding_context(p_organization_id uuid, p_tournament_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.get_tournament_communications_admin_context(p_organization_id uuid, p_tournament_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.get_tournament_communications_inbox(p_tournament_id uuid, p_filter text, p_limit integer, p_offset integer)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.get_tournament_competition_context(p_organization_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.get_tournament_competition_context_organization_legacy(p_organization_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.get_tournament_creation_eligibility(p_organization_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.get_tournament_fixture_context(p_organization_id uuid, p_tournament_id uuid, p_category_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.get_tournament_match_operation_context(p_organization_id uuid, p_match_operation_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.get_tournament_match_operations_context(p_organization_id uuid, p_tournament_id uuid, p_category_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.get_tournament_media_admin_context(p_organization_id uuid, p_tournament_id uuid, p_status text, p_limit integer, p_offset integer)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.get_tournament_media_asset_processing_tiers(p_organization_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.get_tournament_media_upload_capability(p_organization_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.get_tournament_participant_hub(p_tournament_id uuid, p_category_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin', 'anon=X/supabase_admin']`.

### public.get_tournament_participant_match(p_match_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin', 'anon=X/supabase_admin']`.

### public.get_tournament_player_portrait_ref(p_organization_id uuid, p_roster_player_id uuid, p_variant text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.get_tournament_public_page_settings(p_organization_id uuid, p_tournament_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.get_tournament_purchase(p_purchase_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.get_tournament_schedule_context(p_organization_id uuid, p_tournament_id uuid, p_category_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.get_tournament_season_media_usage(p_organization_id uuid, p_season_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.get_tournament_social_snapshot(p_organization_id uuid, p_tournament_id uuid, p_category_id uuid, p_phase_id uuid, p_piece text, p_round_id uuid, p_group_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.get_tournament_social_snapshot_plan_legacy(p_organization_id uuid, p_tournament_id uuid, p_category_id uuid, p_phase_id uuid, p_piece text, p_round_id uuid, p_group_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.get_tournament_social_studio_context(p_organization_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.get_tournament_social_studio_context_organization_legacy(p_organization_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.get_tournament_standings_context(p_organization_id uuid, p_tournament_id uuid, p_category_id uuid, p_phase_id uuid, p_group_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.get_tournament_statistics_context(p_organization_id uuid, p_tournament_id uuid, p_category_id uuid, p_phase_id uuid, p_group_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.get_tournament_team_photo_state(p_organization_id uuid, p_team_entry_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.get_tournament_team_visual_policy(p_organization_id uuid, p_tournament_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.get_tournament_teams_context(p_organization_id uuid, p_tournament_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.get_tournament_workspace_context()

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.grant_tournament_premium(p_organization_id uuid, p_tournament_id uuid, p_source text, p_reason text)

Retorna `uuid`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.grant_tournament_season_premium(p_organization_id uuid, p_season_id uuid, p_purchase_id uuid, p_reason text)

Retorna `uuid`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.handle_tournament_media_report(p_report_id uuid, p_status text, p_resolution text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.has_organization_consumed_free_tournament(p_organization_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.has_tournament_capability(p_organization_id uuid, p_tournament_id uuid, p_capability text)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.has_tournament_communications_capability(p_organization_id uuid, p_capability text)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.has_tournament_entitlement(p_organization_id uuid, p_tournament_id uuid, p_capability text)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.has_tournament_media_assignment(p_gallery_id uuid, p_action text)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.has_tournament_media_capability(p_organization_id uuid, p_capability text)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.has_tournament_organization_capability(p_organization_id uuid, p_capability text)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.has_tournament_season_access(p_organization_id uuid, p_season_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.has_tournament_season_capability(p_organization_id uuid, p_season_id uuid, p_capability text)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.has_tournament_social_capability(p_organization_id uuid, p_capability text)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.insert_tournament_match_source(p_match_id uuid, p_side text, p_source jsonb)

Retorna `void`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.invite_tournament_team_manager(p_organization_id uuid, p_team_entry_id uuid, p_email text, p_display_name text, p_role text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.is_tournament_branding_path(p_name text, p_kind text)

Retorna `boolean`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.is_tournament_organization_member(p_organization_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.is_tournament_organization_slug_available(p_slug text)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.is_tournament_plan_grant_effective(p_grant_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.is_tournament_season_plan_grant_effective(p_grant_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.is_tournament_team_manager(p_team_entry_id uuid, p_require_edit boolean)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.is_tournament_team_roster_member_as(p_team_entry_id uuid, p_actor_user_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.is_valid_tournament_format_settings(p_format text, p_settings jsonb)

Retorna `boolean`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.lease_tournament_media_processing_jobs(p_worker_id text, p_lease_seconds integer, p_limit integer)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.list_tournament_media_retention_candidates(p_organization_id uuid, p_tournament_id uuid, p_as_of timestamp with time zone)

Retorna `TABLE(asset_id uuid, gallery_id uuid, sports_round_id uuid, sports_round_number integer, window_exited_at timestamp with time zone, eligible_at timestamp with time zone, bucket text, object_paths jsonb, reason text)`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.list_tournament_player_portrait_refs(p_organization_id uuid, p_team_entry_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.list_tournament_season_member_assignments(p_organization_id uuid, p_season_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.lock_tournament_roster(p_organization_id uuid, p_team_entry_id uuid, p_roster_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.make_tournament_match_official(p_organization_id uuid, p_match_operation_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.manage_tournament_media_consent(p_asset_id uuid, p_roster_player_id uuid, p_subject_user_id uuid, p_use_scope text, p_status text, p_legal_basis text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.mark_tournament_announcement_read(p_announcement_id uuid, p_confirm boolean)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.mark_tournament_suspension_served(p_suspension_id uuid, p_match_id uuid, p_note text)

Retorna `uuid`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.normalize_tournament_competition_slug(p_value text)

Retorna `text`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.normalize_tournament_organization_slug(p_value text)

Retorna `text`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.normalize_tournament_person_name(p_value text)

Retorna `text`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.open_tournament_match_operation(p_organization_id uuid, p_match_id uuid, p_override_reason text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.postpone_tournament_match(p_organization_id uuid, p_match_id uuid, p_reason text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.preview_tournament_announcement_audience(p_announcement_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.protect_active_tournament_fixture_draft()

Retorna `trigger`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.protect_published_tournament_communication()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.protect_published_tournament_document_version()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.protect_referenced_tournament_offer()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.protect_tournament_competition_scope()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.protect_tournament_completed_competition()

Retorna `trigger`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.protect_tournament_match_child_history()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.protect_tournament_match_operation_history()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.protect_tournament_match_planning_transition()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.protect_tournament_match_squad_players()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.protect_tournament_organization_owner()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.protect_tournament_purchase_snapshots()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.protect_tournament_registration_scope()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.publish_tournament_announcement(p_announcement_id uuid, p_expected_recipient_count integer)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.publish_tournament_document_version(p_version_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.publish_tournament_fixture(p_organization_id uuid, p_fixture_version_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.publish_tournament_media_gallery(p_gallery_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.publish_tournament_standings_revision(p_revision_id uuid, p_reason text)

Retorna `uuid`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.raise_tournament_match_error(p_message text)

Retorna `jsonb`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.rank_tournament_standings(p_revision_id uuid)

Retorna `void`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.ready_tournament_match(p_organization_id uuid, p_match_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.rebuild_tournament_discipline(p_organization_id uuid, p_tournament_id uuid, p_category_id uuid, p_phase_id uuid, p_group_id uuid, p_reason text, p_idempotency_key uuid)

Retorna `uuid`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.rebuild_tournament_standings(p_organization_id uuid, p_tournament_id uuid, p_category_id uuid, p_phase_id uuid, p_group_id uuid, p_reason text, p_idempotency_key uuid)

Retorna `uuid`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.record_manual_match_availability(p_organization_id uuid, p_match_id uuid, p_roster_player_id uuid, p_response text, p_reason text, p_comment text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.record_tournament_purchase_preference(p_purchase_id uuid, p_provider text, p_provider_environment text, p_provider_preference_id text, p_preference_expires_at timestamp with time zone)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.reject_append_only_tournament_commercial_mutation()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.reject_suspended_tournament_operation_player()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.reject_suspended_tournament_squad_player()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.reject_suspended_tournament_squad_submission()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.reject_tournament_audit_mutation()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.reject_tournament_match_child_delete()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.reject_tournament_projection_mutation()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.reject_tournament_team_entry(p_organization_id uuid, p_team_entry_id uuid, p_reason text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.remove_tournament_roster_player(p_organization_id uuid, p_team_entry_id uuid, p_roster_player_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.remove_tournament_season_member_assignment(p_organization_id uuid, p_season_id uuid, p_membership_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.reopen_tournament_competition(p_organization_id uuid, p_tournament_id uuid, p_reason text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.reopen_tournament_participants(p_organization_id uuid, p_tournament_id uuid, p_category_id uuid, p_reason text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.reorder_tournament_media_item(p_gallery_id uuid, p_asset_id uuid, p_target_order integer)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.replace_tournament_announcement_audience(p_announcement_id uuid, p_audience_type text, p_category_id uuid, p_team_entry_id uuid, p_match_id uuid, p_specific_user_id uuid)

Retorna `uuid`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.report_tournament_media_asset(p_asset_id uuid, p_reason text, p_detail text, p_request_hide boolean, p_idempotency_key uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.request_tournament_match_correction(p_organization_id uuid, p_match_operation_id uuid, p_reason text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.request_tournament_media_upload_session(p_gallery_id uuid, p_file_name text, p_declared_mime text, p_byte_size bigint, p_idempotency_key uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.request_tournament_player_portrait_upload(p_actor_user_id uuid, p_organization_id uuid, p_roster_player_id uuid, p_mime_type text, p_byte_size bigint, p_width integer, p_height integer)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.request_tournament_team_photo_upload(p_actor_user_id uuid, p_organization_id uuid, p_team_entry_id uuid, p_mime_type text, p_byte_size bigint, p_width integer, p_height integer)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.reschedule_tournament_match(p_organization_id uuid, p_match_id uuid, p_scheduled_at timestamp with time zone, p_venue_id uuid, p_court_id uuid, p_duration_minutes integer, p_reason text, p_override_warnings boolean)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.resolve_effective_tournament_entitlements_at(p_organization_id uuid, p_tournament_id uuid, p_as_of timestamp with time zone, p_participant_only boolean)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.resolve_effective_tournament_season_entitlements_at(p_organization_id uuid, p_season_id uuid, p_as_of timestamp with time zone, p_participant_only boolean, p_tournament_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.resolve_tournament_announcement_recipients(p_announcement_id uuid)

Retorna `TABLE(user_id uuid, relation_type text)`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.resolve_tournament_qualification(p_revision_id uuid, p_reason text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.resolve_tournament_subscription_plan(p_plan_code text, p_status text, p_starts_at timestamp with time zone, p_current_period_end timestamp with time zone, p_grace_until timestamp with time zone, p_cancelled_at timestamp with time zone, p_as_of timestamp with time zone)

Retorna `text`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.respond_match_availability(p_match_id uuid, p_response text, p_comment text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.restore_tournament_match_unscheduled(p_organization_id uuid, p_match_id uuid, p_reason text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.review_tournament_match_operation(p_organization_id uuid, p_match_operation_id uuid, p_decision text, p_reason text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.review_tournament_team_entry(p_organization_id uuid, p_team_entry_id uuid, p_decision text, p_reason text, p_issues jsonb)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.revoke_tournament_announcement(p_announcement_id uuid, p_reason text)

Retorna `uuid`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.revoke_tournament_media_service_attestation(p_service text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.revoke_tournament_player_portrait_publication(p_organization_id uuid, p_portrait_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.revoke_tournament_points_adjustment(p_adjustment_id uuid, p_reason text)

Retorna `uuid`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.revoke_tournament_team_invitation(p_organization_id uuid, p_invitation_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.revoke_tournament_team_photo(p_organization_id uuid, p_team_photo_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.save_match_squad(p_organization_id uuid, p_match_id uuid, p_team_entry_id uuid, p_players jsonb)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.save_tournament_category(p_organization_id uuid, p_tournament_id uuid, p_category_id uuid, p_name text, p_slug text, p_description text, p_sort_order integer, p_min_age smallint, p_max_age smallint, p_gender_category text, p_sport_modality text, p_team_size smallint, p_status text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.save_tournament_draw_pots(p_organization_id uuid, p_tournament_id uuid, p_category_id uuid, p_pots jsonb)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.save_tournament_match_operation_draft(p_organization_id uuid, p_match_operation_id uuid, p_match_status text, p_notes text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.save_tournament_schedule_windows(p_organization_id uuid, p_tournament_id uuid, p_windows jsonb)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.schedule_tournament_match(p_organization_id uuid, p_match_id uuid, p_scheduled_at timestamp with time zone, p_venue_id uuid, p_court_id uuid, p_duration_minutes integer, p_override_warnings boolean, p_override_reason text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.schedule_tournament_match_resumption(p_organization_id uuid, p_match_operation_id uuid, p_scheduled_at timestamp with time zone, p_venue_id uuid, p_court_id uuid, p_reason text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.search_tournament_arma2_teams(p_organization_id uuid, p_tournament_id uuid, p_query text, p_limit integer)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.search_tournament_players(p_organization_id uuid, p_tournament_id uuid, p_query text, p_limit integer, p_team_entry_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.set_active_tournament_context(p_organization_id uuid, p_season_id uuid, p_tournament_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.set_my_tournament_hub_category(p_tournament_id uuid, p_category_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.set_tournament_announcement_audience(p_announcement_id uuid, p_audience_type text, p_category_id uuid, p_team_entry_id uuid, p_match_id uuid, p_specific_user_id uuid)

Retorna `uuid`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.set_tournament_announcement_link(p_announcement_id uuid, p_link_type text, p_resource_id uuid, p_external_url text, p_label text, p_sort_order integer)

Retorna `uuid`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.set_tournament_branding_reference(p_organization_id uuid, p_entity_kind text, p_entity_id uuid, p_path text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.set_tournament_entitlement_override(p_organization_id uuid, p_tournament_id uuid, p_capability text, p_enabled boolean, p_expires_at timestamp with time zone, p_reason text)

Retorna `uuid`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.set_tournament_match_outcome(p_organization_id uuid, p_match_operation_id uuid, p_outcome jsonb)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.set_tournament_match_score(p_organization_id uuid, p_match_operation_id uuid, p_score jsonb)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.set_tournament_media_cover(p_gallery_id uuid, p_asset_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.set_tournament_organization_subscription(p_organization_id uuid, p_status text, p_starts_at timestamp with time zone, p_current_period_end timestamp with time zone, p_grace_until timestamp with time zone, p_cancelled_at timestamp with time zone, p_post_expiration_retention_days integer)

Retorna `uuid`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.set_tournament_player_portrait_crop(p_organization_id uuid, p_portrait_id uuid, p_focal_x numeric, p_focal_y numeric, p_zoom numeric)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.set_tournament_player_portrait_editorial_status(p_organization_id uuid, p_portrait_id uuid, p_editorial_status text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.set_tournament_public_page_published(p_organization_id uuid, p_tournament_id uuid, p_published boolean)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.set_tournament_social_permission(p_organization_id uuid, p_user_id uuid, p_can_export boolean)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.set_tournament_team_photo_editorial_status(p_organization_id uuid, p_team_photo_id uuid, p_editorial_status text, p_review_reason text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.set_tournament_team_visual_policy(p_organization_id uuid, p_tournament_id uuid, p_policy text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.set_tournament_workspace_preference(p_workspace_type text, p_organization_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.start_tournament_competition(p_organization_id uuid, p_tournament_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.submit_match_squad(p_organization_id uuid, p_match_id uuid, p_team_entry_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.submit_tournament_match_operation(p_organization_id uuid, p_match_operation_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.submit_tournament_team_entry(p_organization_id uuid, p_team_entry_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.supersede_tournament_fixture(p_organization_id uuid, p_fixture_version_id uuid, p_idempotency_key uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.tag_tournament_media_asset(p_asset_id uuid, p_relation_type text, p_match_id uuid, p_team_entry_id uuid, p_roster_player_id uuid)

Retorna `uuid`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.touch_tournament_communications_updated_at()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.touch_tournament_media_updated_at()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.touch_tournament_workspace_updated_at()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.tournament_communications_role_capabilities(p_role text)

Retorna `text[]`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.tournament_competition_open_commitments(p_organization_id uuid, p_tournament_id uuid)

Retorna `TABLE(match_id uuid, category_id uuid, match_number integer, reason_code text)`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.tournament_match_team_entries(p_match_id uuid)

Retorna `TABLE(home_team_entry_id uuid, away_team_entry_id uuid)`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.tournament_media_asset_has_internal_consent(p_asset_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.tournament_media_asset_publication_ready(p_asset_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.tournament_media_attestation_rejection(p_service text, p_capabilities jsonb, p_ttl_seconds integer)

Retorna `text`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.tournament_media_backend_fingerprint()

Retorna `text`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.tournament_media_capability_allowlist(p_service text)

Retorna `text[]`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.tournament_media_current_pipeline_mode()

Retorna `text`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.tournament_media_effective_readiness()

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.tournament_media_gallery_sports_round(p_gallery_id uuid)

Retorna `uuid`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.tournament_media_known_object_names(p_organization_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.tournament_media_mvp_user_can_upload(p_user_id uuid, p_gallery_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.tournament_media_pipeline_readiness()

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.tournament_media_require_pipeline_ready()

Retorna `void`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.tournament_media_require_upload_tier(p_processing_tier text)

Retorna `void`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.tournament_media_role_capabilities(p_role text)

Retorna `text[]`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.tournament_media_storage_contract_status()

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.tournament_media_user_can_upload(p_user_id uuid, p_gallery_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.tournament_media_variant_box(p_kind text)

Retorna `integer`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.tournament_media_variant_geometry(p_kind text, p_width integer, p_height integer)

Retorna `jsonb`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.tournament_media_variant_plan(p_width integer, p_height integer)

Retorna `jsonb`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.tournament_media_worker_type_allowlist()

Retorna `text[]`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.tournament_projection_source_fingerprint(p_fixture_version_id uuid, p_phase_id uuid, p_group_id uuid)

Retorna `text`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.tournament_purchase_projection(p_purchase tournament_purchases)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.tournament_registration_checklist(p_organization_id uuid, p_tournament_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.tournament_requires_premium(p_organization_id uuid, p_tournament_id uuid)

Retorna `boolean`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.tournament_role_capabilities(p_role text)

Retorna `text[]`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.tournament_season_member_assignment_limit()

Retorna `trigger`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.tournament_social_match_rows(p_fixture_version_id uuid, p_phase_id uuid, p_round_id uuid, p_only_played boolean)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.tournament_social_next_fixture(p_fixture_version_id uuid, p_phase_id uuid, p_group_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.tournament_social_player_candidates(p_fixture_version_id uuid, p_players jsonb)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.tournament_social_published_scope(p_organization_id uuid, p_tournament_id uuid, p_category_id uuid, p_phase_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.tournament_social_role_capabilities(p_role text)

Retorna `text[]`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.tournament_subscription_is_consistent(p_plan_code text, p_status text, p_starts_at timestamp with time zone, p_current_period_end timestamp with time zone, p_grace_until timestamp with time zone, p_cancelled_at timestamp with time zone, p_status_changed_at timestamp with time zone)

Retorna `boolean`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.tournament_subscription_pro_access_ended_at(p_plan_code text, p_status text, p_starts_at timestamp with time zone, p_current_period_end timestamp with time zone, p_grace_until timestamp with time zone, p_cancelled_at timestamp with time zone, p_status_changed_at timestamp with time zone, p_as_of timestamp with time zone)

Retorna `timestamp with time zone`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin']`.

### public.transition_tournament_media_asset(p_asset_id uuid, p_action text, p_reason text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.update_draft_fixture(p_organization_id uuid, p_fixture_version_id uuid, p_action text, p_payload jsonb)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.update_my_tournament_notification_preferences(p_tournament_id uuid, p_general boolean, p_match_changes boolean, p_callups boolean, p_discipline boolean, p_documents boolean, p_summaries boolean)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.update_tournament_announcement_draft(p_announcement_id uuid, p_title text, p_summary text, p_body text, p_priority text, p_acknowledgement_mode text, p_scheduled_for timestamp with time zone)

Retorna `uuid`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.update_tournament_configuration(p_organization_id uuid, p_tournament_id uuid, p_patch jsonb)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.update_tournament_court(p_organization_id uuid, p_court_id uuid, p_patch jsonb)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.update_tournament_document_draft(p_version_id uuid, p_summary text, p_body text, p_effective_at timestamp with time zone)

Retorna `uuid`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.update_tournament_media_gallery(p_gallery_id uuid, p_title text, p_description text, p_visibility text, p_submit_for_review boolean)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.update_tournament_organization(p_organization_id uuid, p_name text, p_slug text, p_status text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.update_tournament_roster_player(p_organization_id uuid, p_team_entry_id uuid, p_roster_player_id uuid, p_shirt_number smallint, p_primary_position text, p_secondary_position text, p_is_goalkeeper boolean)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.update_tournament_season(p_organization_id uuid, p_season_id uuid, p_name text, p_slug text, p_start_date date, p_end_date date, p_status text, p_clear_start_date boolean, p_clear_end_date boolean)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.update_tournament_team_entry(p_organization_id uuid, p_team_entry_id uuid, p_patch jsonb)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.update_tournament_venue(p_organization_id uuid, p_venue_id uuid, p_patch jsonb)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.validate_tournament_fixture(p_organization_id uuid, p_fixture_version_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.validate_tournament_fixture_member_scope()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.validate_tournament_group_scope()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.validate_tournament_match_operation(p_organization_id uuid, p_match_operation_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.validate_tournament_match_operation_payload(p_match_operation_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.validate_tournament_match_operation_source()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.validate_tournament_match_player_scope()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.validate_tournament_match_schedule(p_organization_id uuid, p_match_id uuid, p_scheduled_at timestamp with time zone, p_venue_id uuid, p_court_id uuid, p_duration_minutes integer)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.validate_tournament_match_scope()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.validate_tournament_match_source_scope()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.validate_tournament_match_squad_scope()

Retorna `trigger`; SECURITY DEFINER: `False`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.validate_tournament_roster(p_organization_id uuid, p_team_entry_id uuid, p_roster_id uuid)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.void_tournament_match_event(p_organization_id uuid, p_event_id uuid, p_reason text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.void_tournament_match_operation(p_organization_id uuid, p_match_operation_id uuid, p_reason text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

### public.withdraw_tournament_competition_participant(p_organization_id uuid, p_tournament_id uuid, p_team_entry_id uuid, p_reason_code text, p_reason_text text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']`.

### public.withdraw_tournament_team_entry(p_organization_id uuid, p_team_entry_id uuid, p_reason text)

Retorna `jsonb`; SECURITY DEFINER: `True`; settings: `['search_path=""']`; ACL: `['supabase_admin=X/supabase_admin', 'service_role=X/supabase_admin', 'authenticated=X/supabase_admin']`.

## Triggers

- `torneos_identity.torneos_identity_immutable`: `CREATE TRIGGER torneos_identity_immutable BEFORE UPDATE ON public.torneos_identity FOR EACH ROW EXECUTE FUNCTION private.prevent_identity_reassignment()`
- `tournament_announcements.tournament_announcements_protect_published`: `CREATE TRIGGER tournament_announcements_protect_published BEFORE UPDATE ON public.tournament_announcements FOR EACH ROW EXECUTE FUNCTION protect_published_tournament_communication()`
- `tournament_announcements.tournament_announcements_touch_updated_at`: `CREATE TRIGGER tournament_announcements_touch_updated_at BEFORE UPDATE ON public.tournament_announcements FOR EACH ROW EXECUTE FUNCTION touch_tournament_communications_updated_at()`
- `tournament_audit_log.tournament_audit_append_only`: `CREATE TRIGGER tournament_audit_append_only BEFORE DELETE OR UPDATE ON public.tournament_audit_log FOR EACH ROW EXECUTE FUNCTION reject_tournament_audit_mutation()`
- `tournament_categories.tournament_categories_protect_scope`: `CREATE TRIGGER tournament_categories_protect_scope BEFORE UPDATE ON public.tournament_categories FOR EACH ROW EXECUTE FUNCTION protect_tournament_competition_scope()`
- `tournament_categories.tournament_categories_touch_updated_at`: `CREATE TRIGGER tournament_categories_touch_updated_at BEFORE UPDATE ON public.tournament_categories FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_categories.tournament_categories_write_scope`: `CREATE TRIGGER tournament_categories_write_scope BEFORE INSERT OR DELETE OR UPDATE ON public.tournament_categories FOR EACH ROW EXECUTE FUNCTION enforce_tournament_season_root_write_scope()`
- `tournament_commercial_offers.tournament_commercial_offers_immutable_when_referenced`: `CREATE TRIGGER tournament_commercial_offers_immutable_when_referenced BEFORE DELETE OR UPDATE ON public.tournament_commercial_offers FOR EACH ROW EXECUTE FUNCTION protect_referenced_tournament_offer()`
- `tournament_commercial_products.tournament_commercial_products_touch`: `CREATE TRIGGER tournament_commercial_products_touch BEFORE UPDATE ON public.tournament_commercial_products FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_courts.tournament_courts_touch_updated_at`: `CREATE TRIGGER tournament_courts_touch_updated_at BEFORE UPDATE ON public.tournament_courts FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_discipline_ledgers.tournament_discipline_ledgers_immutable`: `CREATE TRIGGER tournament_discipline_ledgers_immutable BEFORE DELETE OR UPDATE ON public.tournament_discipline_ledgers FOR EACH ROW EXECUTE FUNCTION reject_tournament_projection_mutation()`
- `tournament_discipline_rules.tournament_discipline_rules_protect_scope`: `CREATE TRIGGER tournament_discipline_rules_protect_scope BEFORE UPDATE ON public.tournament_discipline_rules FOR EACH ROW EXECUTE FUNCTION protect_tournament_competition_scope()`
- `tournament_discipline_rules.tournament_discipline_rules_touch_updated_at`: `CREATE TRIGGER tournament_discipline_rules_touch_updated_at BEFORE UPDATE ON public.tournament_discipline_rules FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_discipline_rules.tournament_discipline_rules_write_scope`: `CREATE TRIGGER tournament_discipline_rules_write_scope BEFORE INSERT OR DELETE OR UPDATE ON public.tournament_discipline_rules FOR EACH ROW EXECUTE FUNCTION enforce_tournament_season_root_write_scope()`
- `tournament_document_acknowledgements.tournament_document_acknowledgements_touch_updated_at`: `CREATE TRIGGER tournament_document_acknowledgements_touch_updated_at BEFORE UPDATE ON public.tournament_document_acknowledgements FOR EACH ROW EXECUTE FUNCTION touch_tournament_communications_updated_at()`
- `tournament_document_versions.tournament_document_versions_protect_published`: `CREATE TRIGGER tournament_document_versions_protect_published BEFORE UPDATE ON public.tournament_document_versions FOR EACH ROW EXECUTE FUNCTION protect_published_tournament_document_version()`
- `tournament_documents.tournament_documents_touch_updated_at`: `CREATE TRIGGER tournament_documents_touch_updated_at BEFORE UPDATE ON public.tournament_documents FOR EACH ROW EXECUTE FUNCTION touch_tournament_communications_updated_at()`
- `tournament_draw_pot_members.tournament_draw_pot_members_scope_guard`: `CREATE TRIGGER tournament_draw_pot_members_scope_guard BEFORE INSERT OR UPDATE ON public.tournament_draw_pot_members FOR EACH ROW EXECUTE FUNCTION validate_tournament_fixture_member_scope()`
- `tournament_draw_pots.tournament_draw_pots_touch_updated_at`: `CREATE TRIGGER tournament_draw_pots_touch_updated_at BEFORE UPDATE ON public.tournament_draw_pots FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_entitlement_capabilities.tournament_entitlement_capabilities_touch`: `CREATE TRIGGER tournament_entitlement_capabilities_touch BEFORE UPDATE ON public.tournament_entitlement_capabilities FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_entitlement_overrides.tournament_entitlement_overrides_touch`: `CREATE TRIGGER tournament_entitlement_overrides_touch BEFORE UPDATE ON public.tournament_entitlement_overrides FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_group_members.tournament_group_members_scope_guard`: `CREATE TRIGGER tournament_group_members_scope_guard BEFORE INSERT OR UPDATE ON public.tournament_group_members FOR EACH ROW EXECUTE FUNCTION validate_tournament_fixture_member_scope()`
- `tournament_groups.tournament_groups_scope_guard`: `CREATE TRIGGER tournament_groups_scope_guard BEFORE INSERT OR UPDATE ON public.tournament_groups FOR EACH ROW EXECUTE FUNCTION validate_tournament_group_scope()`
- `tournament_groups.tournament_groups_touch_updated_at`: `CREATE TRIGGER tournament_groups_touch_updated_at BEFORE UPDATE ON public.tournament_groups FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_legacy_organization_subscriptions.tournament_organization_subscriptions_touch`: `CREATE TRIGGER tournament_organization_subscriptions_touch BEFORE UPDATE ON public.tournament_legacy_organization_subscriptions FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_legacy_subscription_plans.tournament_entitlement_plans_touch`: `CREATE TRIGGER tournament_entitlement_plans_touch BEFORE UPDATE ON public.tournament_legacy_subscription_plans FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_match_availability_responses.tournament_match_availability_scope_guard`: `CREATE TRIGGER tournament_match_availability_scope_guard BEFORE INSERT OR UPDATE ON public.tournament_match_availability_responses FOR EACH ROW EXECUTE FUNCTION validate_tournament_match_player_scope()`
- `tournament_match_events.tournament_match_events_completed_guard`: `CREATE TRIGGER tournament_match_events_completed_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tournament_match_events FOR EACH ROW EXECUTE FUNCTION protect_tournament_completed_competition()`
- `tournament_match_events.tournament_match_events_history_guard`: `CREATE TRIGGER tournament_match_events_history_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tournament_match_events FOR EACH ROW EXECUTE FUNCTION protect_tournament_match_child_history()`
- `tournament_match_events.tournament_match_events_no_delete`: `CREATE TRIGGER tournament_match_events_no_delete BEFORE DELETE ON public.tournament_match_events FOR EACH ROW EXECUTE FUNCTION reject_tournament_match_child_delete()`
- `tournament_match_operation_players.tournament_match_operation_players_completed_guard`: `CREATE TRIGGER tournament_match_operation_players_completed_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tournament_match_operation_players FOR EACH ROW EXECUTE FUNCTION protect_tournament_completed_competition()`
- `tournament_match_operation_players.tournament_match_operation_players_history_guard`: `CREATE TRIGGER tournament_match_operation_players_history_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tournament_match_operation_players FOR EACH ROW EXECUTE FUNCTION protect_tournament_match_child_history()`
- `tournament_match_operation_players.tournament_operation_player_suspension_guard`: `CREATE TRIGGER tournament_operation_player_suspension_guard BEFORE INSERT OR UPDATE ON public.tournament_match_operation_players FOR EACH ROW EXECUTE FUNCTION reject_suspended_tournament_operation_player()`
- `tournament_match_operations.tournament_match_operations_completed_guard`: `CREATE TRIGGER tournament_match_operations_completed_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tournament_match_operations FOR EACH ROW EXECUTE FUNCTION protect_tournament_completed_competition()`
- `tournament_match_operations.tournament_match_operations_history_guard`: `CREATE TRIGGER tournament_match_operations_history_guard BEFORE DELETE OR UPDATE ON public.tournament_match_operations FOR EACH ROW EXECUTE FUNCTION protect_tournament_match_operation_history()`
- `tournament_match_operations.tournament_match_operations_source_guard`: `CREATE TRIGGER tournament_match_operations_source_guard BEFORE INSERT OR UPDATE ON public.tournament_match_operations FOR EACH ROW EXECUTE FUNCTION validate_tournament_match_operation_source()`
- `tournament_match_outcomes.tournament_match_outcomes_completed_guard`: `CREATE TRIGGER tournament_match_outcomes_completed_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tournament_match_outcomes FOR EACH ROW EXECUTE FUNCTION protect_tournament_completed_competition()`
- `tournament_match_outcomes.tournament_match_outcomes_history_guard`: `CREATE TRIGGER tournament_match_outcomes_history_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tournament_match_outcomes FOR EACH ROW EXECUTE FUNCTION protect_tournament_match_child_history()`
- `tournament_match_reschedules.tournament_match_reschedules_completed_guard`: `CREATE TRIGGER tournament_match_reschedules_completed_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tournament_match_reschedules FOR EACH ROW EXECUTE FUNCTION protect_tournament_completed_competition()`
- `tournament_match_resumptions.tournament_match_resumptions_history_guard`: `CREATE TRIGGER tournament_match_resumptions_history_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tournament_match_resumptions FOR EACH ROW EXECUTE FUNCTION protect_tournament_match_child_history()`
- `tournament_match_reviews.tournament_match_reviews_completed_guard`: `CREATE TRIGGER tournament_match_reviews_completed_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tournament_match_reviews FOR EACH ROW EXECUTE FUNCTION protect_tournament_completed_competition()`
- `tournament_match_reviews.tournament_match_reviews_no_delete`: `CREATE TRIGGER tournament_match_reviews_no_delete BEFORE DELETE ON public.tournament_match_reviews FOR EACH ROW EXECUTE FUNCTION reject_tournament_match_child_delete()`
- `tournament_match_scores.tournament_match_scores_completed_guard`: `CREATE TRIGGER tournament_match_scores_completed_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tournament_match_scores FOR EACH ROW EXECUTE FUNCTION protect_tournament_completed_competition()`
- `tournament_match_scores.tournament_match_scores_history_guard`: `CREATE TRIGGER tournament_match_scores_history_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tournament_match_scores FOR EACH ROW EXECUTE FUNCTION protect_tournament_match_child_history()`
- `tournament_match_sources.tournament_match_sources_active_draft_guard`: `CREATE TRIGGER tournament_match_sources_active_draft_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tournament_match_sources FOR EACH ROW EXECUTE FUNCTION protect_active_tournament_fixture_draft()`
- `tournament_match_sources.tournament_match_sources_scope_guard`: `CREATE TRIGGER tournament_match_sources_scope_guard BEFORE INSERT OR UPDATE ON public.tournament_match_sources FOR EACH ROW EXECUTE FUNCTION validate_tournament_match_source_scope()`
- `tournament_match_squad_players.tournament_match_squad_players_history_guard`: `CREATE TRIGGER tournament_match_squad_players_history_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tournament_match_squad_players FOR EACH ROW EXECUTE FUNCTION protect_tournament_match_squad_players()`
- `tournament_match_squad_players.tournament_match_squad_players_scope_guard`: `CREATE TRIGGER tournament_match_squad_players_scope_guard BEFORE INSERT OR UPDATE ON public.tournament_match_squad_players FOR EACH ROW EXECUTE FUNCTION validate_tournament_match_player_scope()`
- `tournament_match_squad_players.tournament_squad_player_suspension_guard`: `CREATE TRIGGER tournament_squad_player_suspension_guard BEFORE INSERT OR UPDATE ON public.tournament_match_squad_players FOR EACH ROW EXECUTE FUNCTION reject_suspended_tournament_squad_player()`
- `tournament_match_squads.tournament_match_squads_completed_guard`: `CREATE TRIGGER tournament_match_squads_completed_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tournament_match_squads FOR EACH ROW EXECUTE FUNCTION protect_tournament_completed_competition()`
- `tournament_match_squads.tournament_match_squads_scope_guard`: `CREATE TRIGGER tournament_match_squads_scope_guard BEFORE INSERT OR UPDATE ON public.tournament_match_squads FOR EACH ROW EXECUTE FUNCTION validate_tournament_match_squad_scope()`
- `tournament_match_squads.tournament_squad_submission_suspension_guard`: `CREATE TRIGGER tournament_squad_submission_suspension_guard BEFORE UPDATE ON public.tournament_match_squads FOR EACH ROW EXECUTE FUNCTION reject_suspended_tournament_squad_submission()`
- `tournament_matches.tournament_matches_active_draft_guard`: `CREATE TRIGGER tournament_matches_active_draft_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tournament_matches FOR EACH ROW EXECUTE FUNCTION protect_active_tournament_fixture_draft()`
- `tournament_matches.tournament_matches_completed_guard`: `CREATE TRIGGER tournament_matches_completed_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tournament_matches FOR EACH ROW EXECUTE FUNCTION protect_tournament_completed_competition()`
- `tournament_matches.tournament_matches_operation_transition_guard`: `CREATE TRIGGER tournament_matches_operation_transition_guard BEFORE UPDATE ON public.tournament_matches FOR EACH ROW EXECUTE FUNCTION protect_tournament_match_planning_transition()`
- `tournament_matches.tournament_matches_scope_guard`: `CREATE TRIGGER tournament_matches_scope_guard BEFORE INSERT OR UPDATE ON public.tournament_matches FOR EACH ROW EXECUTE FUNCTION validate_tournament_match_scope()`
- `tournament_matches.tournament_matches_touch_updated_at`: `CREATE TRIGGER tournament_matches_touch_updated_at BEFORE UPDATE ON public.tournament_matches FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_media_assets.tournament_media_assets_touch_updated_at`: `CREATE TRIGGER tournament_media_assets_touch_updated_at BEFORE UPDATE ON public.tournament_media_assets FOR EACH ROW EXECUTE FUNCTION touch_tournament_media_updated_at()`
- `tournament_media_consents.tournament_media_consents_touch_updated_at`: `CREATE TRIGGER tournament_media_consents_touch_updated_at BEFORE UPDATE ON public.tournament_media_consents FOR EACH ROW EXECUTE FUNCTION touch_tournament_media_updated_at()`
- `tournament_media_galleries.tournament_media_galleries_touch_updated_at`: `CREATE TRIGGER tournament_media_galleries_touch_updated_at BEFORE UPDATE ON public.tournament_media_galleries FOR EACH ROW EXECUTE FUNCTION touch_tournament_media_updated_at()`
- `tournament_media_gallery_items.tournament_media_gallery_items_touch_updated_at`: `CREATE TRIGGER tournament_media_gallery_items_touch_updated_at BEFORE UPDATE ON public.tournament_media_gallery_items FOR EACH ROW EXECUTE FUNCTION touch_tournament_media_updated_at()`
- `tournament_media_upload_sessions.tournament_media_upload_sessions_gallery_limit`: `CREATE TRIGGER tournament_media_upload_sessions_gallery_limit BEFORE INSERT ON public.tournament_media_upload_sessions FOR EACH ROW EXECUTE FUNCTION enforce_tournament_media_gallery_limit()`
- `tournament_notification_preferences.tournament_notification_preferences_touch_updated_at`: `CREATE TRIGGER tournament_notification_preferences_touch_updated_at BEFORE UPDATE ON public.tournament_notification_preferences FOR EACH ROW EXECUTE FUNCTION touch_tournament_communications_updated_at()`
- `tournament_organization_entitlement_overrides.tournament_organization_entitlement_overrides_touch`: `CREATE TRIGGER tournament_organization_entitlement_overrides_touch BEFORE UPDATE ON public.tournament_organization_entitlement_overrides FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_organization_members.tournament_organization_members_protect_owner`: `CREATE TRIGGER tournament_organization_members_protect_owner BEFORE DELETE OR UPDATE ON public.tournament_organization_members FOR EACH ROW EXECUTE FUNCTION protect_tournament_organization_owner()`
- `tournament_organization_members.tournament_organization_members_touch_updated_at`: `CREATE TRIGGER tournament_organization_members_touch_updated_at BEFORE UPDATE ON public.tournament_organization_members FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_organizations.tournament_organizations_touch_updated_at`: `CREATE TRIGGER tournament_organizations_touch_updated_at BEFORE UPDATE ON public.tournament_organizations FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_phases.tournament_phases_active_draft_guard`: `CREATE TRIGGER tournament_phases_active_draft_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tournament_phases FOR EACH ROW EXECUTE FUNCTION protect_active_tournament_fixture_draft()`
- `tournament_phases.tournament_phases_touch_updated_at`: `CREATE TRIGGER tournament_phases_touch_updated_at BEFORE UPDATE ON public.tournament_phases FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_plan_catalog.tournament_plan_catalog_touch`: `CREATE TRIGGER tournament_plan_catalog_touch BEFORE UPDATE ON public.tournament_plan_catalog FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_plan_grant_events.tournament_plan_grant_events_append_only`: `CREATE TRIGGER tournament_plan_grant_events_append_only BEFORE DELETE OR UPDATE ON public.tournament_plan_grant_events FOR EACH ROW EXECUTE FUNCTION reject_append_only_tournament_commercial_mutation()`
- `tournament_player_statistics.tournament_player_statistics_immutable`: `CREATE TRIGGER tournament_player_statistics_immutable BEFORE DELETE OR UPDATE ON public.tournament_player_statistics FOR EACH ROW EXECUTE FUNCTION reject_tournament_projection_mutation()`
- `tournament_pricing_config.tournament_pricing_config_touch`: `CREATE TRIGGER tournament_pricing_config_touch BEFORE UPDATE ON public.tournament_pricing_config FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_provisional_players.tournament_provisional_players_touch`: `CREATE TRIGGER tournament_provisional_players_touch BEFORE UPDATE ON public.tournament_provisional_players FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_purchase_events.tournament_purchase_events_append_only`: `CREATE TRIGGER tournament_purchase_events_append_only BEFORE DELETE OR UPDATE ON public.tournament_purchase_events FOR EACH ROW EXECUTE FUNCTION reject_append_only_tournament_commercial_mutation()`
- `tournament_purchases.tournament_purchases_protect_snapshots`: `CREATE TRIGGER tournament_purchases_protect_snapshots BEFORE UPDATE ON public.tournament_purchases FOR EACH ROW EXECUTE FUNCTION protect_tournament_purchase_snapshots()`
- `tournament_purchases.tournament_purchases_season_scope`: `CREATE TRIGGER tournament_purchases_season_scope BEFORE INSERT ON public.tournament_purchases FOR EACH ROW EXECUTE FUNCTION enforce_tournament_season_purchase_scope()`
- `tournament_purchases.tournament_purchases_state_machine`: `CREATE TRIGGER tournament_purchases_state_machine BEFORE UPDATE OF status ON public.tournament_purchases FOR EACH ROW EXECUTE FUNCTION enforce_tournament_purchase_transition()`
- `tournament_roster_players.tournament_roster_players_scope`: `CREATE TRIGGER tournament_roster_players_scope BEFORE UPDATE ON public.tournament_roster_players FOR EACH ROW EXECUTE FUNCTION protect_tournament_registration_scope()`
- `tournament_roster_players.tournament_roster_players_touch`: `CREATE TRIGGER tournament_roster_players_touch BEFORE UPDATE ON public.tournament_roster_players FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_roster_settings.tournament_roster_settings_touch`: `CREATE TRIGGER tournament_roster_settings_touch BEFORE UPDATE ON public.tournament_roster_settings FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_rosters.tournament_rosters_scope`: `CREATE TRIGGER tournament_rosters_scope BEFORE UPDATE ON public.tournament_rosters FOR EACH ROW EXECUTE FUNCTION protect_tournament_registration_scope()`
- `tournament_rosters.tournament_rosters_touch`: `CREATE TRIGGER tournament_rosters_touch BEFORE UPDATE ON public.tournament_rosters FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_rounds.tournament_rounds_active_draft_guard`: `CREATE TRIGGER tournament_rounds_active_draft_guard BEFORE INSERT OR DELETE OR UPDATE ON public.tournament_rounds FOR EACH ROW EXECUTE FUNCTION protect_active_tournament_fixture_draft()`
- `tournament_rounds.tournament_rounds_touch_updated_at`: `CREATE TRIGGER tournament_rounds_touch_updated_at BEFORE UPDATE ON public.tournament_rounds FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_schedule_windows.tournament_schedule_windows_touch_updated_at`: `CREATE TRIGGER tournament_schedule_windows_touch_updated_at BEFORE UPDATE ON public.tournament_schedule_windows FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_scoring_rules.tournament_scoring_rules_protect_scope`: `CREATE TRIGGER tournament_scoring_rules_protect_scope BEFORE UPDATE ON public.tournament_scoring_rules FOR EACH ROW EXECUTE FUNCTION protect_tournament_competition_scope()`
- `tournament_scoring_rules.tournament_scoring_rules_touch_updated_at`: `CREATE TRIGGER tournament_scoring_rules_touch_updated_at BEFORE UPDATE ON public.tournament_scoring_rules FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_scoring_rules.tournament_scoring_rules_write_scope`: `CREATE TRIGGER tournament_scoring_rules_write_scope BEFORE INSERT OR DELETE OR UPDATE ON public.tournament_scoring_rules FOR EACH ROW EXECUTE FUNCTION enforce_tournament_season_root_write_scope()`
- `tournament_season_member_assignments.tournament_season_member_assignment_limit`: `CREATE TRIGGER tournament_season_member_assignment_limit BEFORE INSERT OR UPDATE ON public.tournament_season_member_assignments FOR EACH ROW EXECUTE FUNCTION tournament_season_member_assignment_limit()`
- `tournament_seasons.tournament_seasons_protect_scope`: `CREATE TRIGGER tournament_seasons_protect_scope BEFORE UPDATE ON public.tournament_seasons FOR EACH ROW EXECUTE FUNCTION protect_tournament_competition_scope()`
- `tournament_seasons.tournament_seasons_touch_updated_at`: `CREATE TRIGGER tournament_seasons_touch_updated_at BEFORE UPDATE ON public.tournament_seasons FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_seasons.tournament_seasons_write_scope`: `CREATE TRIGGER tournament_seasons_write_scope BEFORE DELETE OR UPDATE ON public.tournament_seasons FOR EACH ROW EXECUTE FUNCTION enforce_tournament_season_root_write_scope()`
- `tournament_standings_revisions.tournament_standings_revisions_no_delete`: `CREATE TRIGGER tournament_standings_revisions_no_delete BEFORE DELETE ON public.tournament_standings_revisions FOR EACH ROW EXECUTE FUNCTION reject_tournament_projection_mutation()`
- `tournament_team_entries.tournament_team_entries_premium_gate`: `CREATE TRIGGER tournament_team_entries_premium_gate BEFORE INSERT OR UPDATE ON public.tournament_team_entries FOR EACH ROW EXECUTE FUNCTION enforce_tournament_premium_gate()`
- `tournament_team_entries.tournament_team_entries_scope`: `CREATE TRIGGER tournament_team_entries_scope BEFORE UPDATE ON public.tournament_team_entries FOR EACH ROW EXECUTE FUNCTION protect_tournament_registration_scope()`
- `tournament_team_entries.tournament_team_entries_touch`: `CREATE TRIGGER tournament_team_entries_touch BEFORE UPDATE ON public.tournament_team_entries FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_team_managers.tournament_team_managers_scope`: `CREATE TRIGGER tournament_team_managers_scope BEFORE UPDATE ON public.tournament_team_managers FOR EACH ROW EXECUTE FUNCTION protect_tournament_registration_scope()`
- `tournament_team_managers.tournament_team_managers_touch`: `CREATE TRIGGER tournament_team_managers_touch BEFORE UPDATE ON public.tournament_team_managers FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_team_standings.tournament_team_standings_immutable`: `CREATE TRIGGER tournament_team_standings_immutable BEFORE DELETE OR UPDATE ON public.tournament_team_standings FOR EACH ROW EXECUTE FUNCTION reject_tournament_projection_mutation()`
- `tournament_team_statistics.tournament_team_statistics_immutable`: `CREATE TRIGGER tournament_team_statistics_immutable BEFORE DELETE OR UPDATE ON public.tournament_team_statistics FOR EACH ROW EXECUTE FUNCTION reject_tournament_projection_mutation()`
- `tournament_tiebreak_rules.tournament_tiebreak_rules_protect_scope`: `CREATE TRIGGER tournament_tiebreak_rules_protect_scope BEFORE UPDATE ON public.tournament_tiebreak_rules FOR EACH ROW EXECUTE FUNCTION protect_tournament_competition_scope()`
- `tournament_tiebreak_rules.tournament_tiebreak_rules_touch_updated_at`: `CREATE TRIGGER tournament_tiebreak_rules_touch_updated_at BEFORE UPDATE ON public.tournament_tiebreak_rules FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournament_tiebreak_rules.tournament_tiebreak_rules_write_scope`: `CREATE TRIGGER tournament_tiebreak_rules_write_scope BEFORE INSERT OR DELETE OR UPDATE ON public.tournament_tiebreak_rules FOR EACH ROW EXECUTE FUNCTION enforce_tournament_season_root_write_scope()`
- `tournament_venues.tournament_venues_touch_updated_at`: `CREATE TRIGGER tournament_venues_touch_updated_at BEFORE UPDATE ON public.tournament_venues FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournaments.tournaments_premium_status_gate`: `CREATE TRIGGER tournaments_premium_status_gate BEFORE UPDATE OF status ON public.tournaments FOR EACH ROW WHEN ((new.status IS DISTINCT FROM old.status)) EXECUTE FUNCTION enforce_tournament_status_premium_gate()`
- `tournaments.tournaments_protect_scope`: `CREATE TRIGGER tournaments_protect_scope BEFORE UPDATE ON public.tournaments FOR EACH ROW EXECUTE FUNCTION protect_tournament_competition_scope()`
- `tournaments.tournaments_touch_updated_at`: `CREATE TRIGGER tournaments_touch_updated_at BEFORE UPDATE ON public.tournaments FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `tournaments.tournaments_write_scope`: `CREATE TRIGGER tournaments_write_scope BEFORE INSERT OR DELETE OR UPDATE ON public.tournaments FOR EACH ROW EXECUTE FUNCTION enforce_tournament_season_root_write_scope()`
- `user_tournament_context_preferences.user_tournament_context_touch_updated_at`: `CREATE TRIGGER user_tournament_context_touch_updated_at BEFORE UPDATE ON public.user_tournament_context_preferences FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`
- `user_workspace_preferences.user_workspace_preferences_touch_updated_at`: `CREATE TRIGGER user_workspace_preferences_touch_updated_at BEFORE UPDATE ON public.user_workspace_preferences FOR EACH ROW EXECUTE FUNCTION touch_tournament_workspace_updated_at()`

## Índices finales

367 históricos + PK y UNIQUE de identidad = 369. Comparación estructural: cero pares exactamente duplicados. No se eliminan índices sólo por compartir prefijos, porque pueden tener predicados, unicidad o contratos diferentes.

- `torneos_identity_core_user_id_key`: `CREATE UNIQUE INDEX torneos_identity_core_user_id_key ON public.torneos_identity USING btree (core_user_id)`
- `torneos_identity_pkey`: `CREATE UNIQUE INDEX torneos_identity_pkey ON public.torneos_identity USING btree (id)`
- `tournament_announcement_audiences_announcement_idx`: `CREATE INDEX tournament_announcement_audiences_announcement_idx ON public.tournament_announcement_audiences USING btree (announcement_id, created_at, id)`
- `tournament_announcement_audiences_org_id_unique`: `CREATE UNIQUE INDEX tournament_announcement_audiences_org_id_unique ON public.tournament_announcement_audiences USING btree (organization_id, id)`
- `tournament_announcement_audiences_pkey`: `CREATE UNIQUE INDEX tournament_announcement_audiences_pkey ON public.tournament_announcement_audiences USING btree (id)`
- `tournament_announcement_audiences_unique`: `CREATE UNIQUE INDEX tournament_announcement_audiences_unique ON public.tournament_announcement_audiences USING btree (announcement_id, audience_type, category_id, team_entry_id, match_id, specific_user_id) NULLS NOT DISTINCT`
- `tournament_announcement_deliveries_announcement_summary_idx`: `CREATE INDEX tournament_announcement_deliveries_announcement_summary_idx ON public.tournament_announcement_deliveries USING btree (announcement_id, status)`
- `tournament_announcement_deliveries_org_id_unique`: `CREATE UNIQUE INDEX tournament_announcement_deliveries_org_id_unique ON public.tournament_announcement_deliveries USING btree (organization_id, id)`
- `tournament_announcement_deliveries_pkey`: `CREATE UNIQUE INDEX tournament_announcement_deliveries_pkey ON public.tournament_announcement_deliveries USING btree (id)`
- `tournament_announcement_deliveries_recipient_inbox_idx`: `CREATE INDEX tournament_announcement_deliveries_recipient_inbox_idx ON public.tournament_announcement_deliveries USING btree (recipient_user_id, status, delivered_at DESC, announcement_id)`
- `tournament_announcement_deliveries_recipient_unique`: `CREATE UNIQUE INDEX tournament_announcement_deliveries_recipient_unique ON public.tournament_announcement_deliveries USING btree (announcement_id, recipient_user_id)`
- `tournament_announcement_links_announcement_idx`: `CREATE INDEX tournament_announcement_links_announcement_idx ON public.tournament_announcement_links USING btree (announcement_id, sort_order, id)`
- `tournament_announcement_links_count_unique`: `CREATE UNIQUE INDEX tournament_announcement_links_count_unique ON public.tournament_announcement_links USING btree (announcement_id, sort_order)`
- `tournament_announcement_links_org_id_unique`: `CREATE UNIQUE INDEX tournament_announcement_links_org_id_unique ON public.tournament_announcement_links USING btree (organization_id, id)`
- `tournament_announcement_links_pkey`: `CREATE UNIQUE INDEX tournament_announcement_links_pkey ON public.tournament_announcement_links USING btree (id)`
- `tournament_announcements_author_drafts_idx`: `CREATE INDEX tournament_announcements_author_drafts_idx ON public.tournament_announcements USING btree (organization_id, author_user_id, updated_at DESC) WHERE (status = ANY (ARRAY['draft'::text, 'scheduled'::text]))`
- `tournament_announcements_category_published_idx`: `CREATE INDEX tournament_announcements_category_published_idx ON public.tournament_announcements USING btree (category_id, published_at DESC) WHERE ((status = 'published'::text) AND (category_id IS NOT NULL))`
- `tournament_announcements_idempotency_unique`: `CREATE UNIQUE INDEX tournament_announcements_idempotency_unique ON public.tournament_announcements USING btree (organization_id, author_user_id, idempotency_key)`
- `tournament_announcements_org_id_unique`: `CREATE UNIQUE INDEX tournament_announcements_org_id_unique ON public.tournament_announcements USING btree (organization_id, id)`
- `tournament_announcements_org_tournament_id_unique`: `CREATE UNIQUE INDEX tournament_announcements_org_tournament_id_unique ON public.tournament_announcements USING btree (organization_id, tournament_id, id)`
- `tournament_announcements_pkey`: `CREATE UNIQUE INDEX tournament_announcements_pkey ON public.tournament_announcements USING btree (id)`
- `tournament_announcements_scope_status_idx`: `CREATE INDEX tournament_announcements_scope_status_idx ON public.tournament_announcements USING btree (organization_id, tournament_id, status, published_at DESC, created_at DESC)`
- `tournament_audit_log_entry_created_idx`: `CREATE INDEX tournament_audit_log_entry_created_idx ON public.tournament_audit_log USING btree (team_entry_id, created_at DESC) WHERE (team_entry_id IS NOT NULL)`
- `tournament_audit_log_org_created_idx`: `CREATE INDEX tournament_audit_log_org_created_idx ON public.tournament_audit_log USING btree (organization_id, created_at DESC)`
- `tournament_audit_log_pkey`: `CREATE UNIQUE INDEX tournament_audit_log_pkey ON public.tournament_audit_log USING btree (id)`
- `tournament_categories_active_order_idx`: `CREATE INDEX tournament_categories_active_order_idx ON public.tournament_categories USING btree (tournament_id, sort_order, created_at) WHERE (status = 'active'::text)`
- `tournament_categories_org_id_unique`: `CREATE UNIQUE INDEX tournament_categories_org_id_unique ON public.tournament_categories USING btree (organization_id, id)`
- `tournament_categories_org_tournament_id_unique`: `CREATE UNIQUE INDEX tournament_categories_org_tournament_id_unique ON public.tournament_categories USING btree (organization_id, tournament_id, id)`
- `tournament_categories_pkey`: `CREATE UNIQUE INDEX tournament_categories_pkey ON public.tournament_categories USING btree (id)`
- `tournament_categories_slug_unique`: `CREATE UNIQUE INDEX tournament_categories_slug_unique ON public.tournament_categories USING btree (tournament_id, slug)`
- `tournament_commercial_offers_pkey`: `CREATE UNIQUE INDEX tournament_commercial_offers_pkey ON public.tournament_commercial_offers USING btree (product_code, offer_code, offer_version)`
- `tournament_commercial_offers_resolution_idx`: `CREATE INDEX tournament_commercial_offers_resolution_idx ON public.tournament_commercial_offers USING btree (product_code, availability, valid_from DESC, offer_version DESC)`
- `tournament_commercial_products_pkey`: `CREATE UNIQUE INDEX tournament_commercial_products_pkey ON public.tournament_commercial_products USING btree (product_code)`
- `tournament_commercial_products_plan_idx`: `CREATE INDEX tournament_commercial_products_plan_idx ON public.tournament_commercial_products USING btree (plan_code)`
- `tournament_competition_formats_name_key`: `CREATE UNIQUE INDEX tournament_competition_formats_name_key ON public.tournament_competition_formats USING btree (name)`
- `tournament_competition_formats_pkey`: `CREATE UNIQUE INDEX tournament_competition_formats_pkey ON public.tournament_competition_formats USING btree (code)`
- `tournament_competition_participants_entry_unique`: `CREATE UNIQUE INDEX tournament_competition_participants_entry_unique ON public.tournament_competition_participants USING btree (participant_set_id, team_entry_id)`
- `tournament_competition_participants_pkey`: `CREATE UNIQUE INDEX tournament_competition_participants_pkey ON public.tournament_competition_participants USING btree (id)`
- `tournament_competition_participants_scope_unique`: `CREATE UNIQUE INDEX tournament_competition_participants_scope_unique ON public.tournament_competition_participants USING btree (organization_id, tournament_id, category_id, participant_set_id, id)`
- `tournament_competition_participants_seed_unique`: `CREATE UNIQUE INDEX tournament_competition_participants_seed_unique ON public.tournament_competition_participants USING btree (participant_set_id, seed_number)`
- `tournament_competition_participants_set_order_idx`: `CREATE INDEX tournament_competition_participants_set_order_idx ON public.tournament_competition_participants USING btree (participant_set_id, status, seed_number, snapshot_name, id)`
- `tournament_courts_pkey`: `CREATE UNIQUE INDEX tournament_courts_pkey ON public.tournament_courts USING btree (id)`
- `tournament_courts_scope_unique`: `CREATE UNIQUE INDEX tournament_courts_scope_unique ON public.tournament_courts USING btree (organization_id, id)`
- `tournament_courts_venue_name_unique`: `CREATE UNIQUE INDEX tournament_courts_venue_name_unique ON public.tournament_courts USING btree (venue_id, name)`
- `tournament_courts_venue_status_idx`: `CREATE INDEX tournament_courts_venue_status_idx ON public.tournament_courts USING btree (venue_id, status, name)`
- `tournament_disciplinary_overrides_idempotency_unique`: `CREATE UNIQUE INDEX tournament_disciplinary_overrides_idempotency_unique ON public.tournament_disciplinary_overrides USING btree (organization_id, actor_user_id, idempotency_key)`
- `tournament_disciplinary_overrides_pkey`: `CREATE UNIQUE INDEX tournament_disciplinary_overrides_pkey ON public.tournament_disciplinary_overrides USING btree (id)`
- `tournament_discipline_ledgers_pkey`: `CREATE UNIQUE INDEX tournament_discipline_ledgers_pkey ON public.tournament_discipline_ledgers USING btree (revision_id, roster_player_id)`
- `tournament_discipline_rules_pkey`: `CREATE UNIQUE INDEX tournament_discipline_rules_pkey ON public.tournament_discipline_rules USING btree (tournament_id)`
- `tournament_document_acknowledgements_org_id_unique`: `CREATE UNIQUE INDEX tournament_document_acknowledgements_org_id_unique ON public.tournament_document_acknowledgements USING btree (organization_id, id)`
- `tournament_document_acknowledgements_pkey`: `CREATE UNIQUE INDEX tournament_document_acknowledgements_pkey ON public.tournament_document_acknowledgements USING btree (id)`
- `tournament_document_acknowledgements_unique`: `CREATE UNIQUE INDEX tournament_document_acknowledgements_unique ON public.tournament_document_acknowledgements USING btree (version_id, user_id)`
- `tournament_document_acknowledgements_user_idx`: `CREATE INDEX tournament_document_acknowledgements_user_idx ON public.tournament_document_acknowledgements USING btree (user_id, updated_at DESC)`
- `tournament_document_versions_document_idx`: `CREATE INDEX tournament_document_versions_document_idx ON public.tournament_document_versions USING btree (document_id, version DESC)`
- `tournament_document_versions_number_unique`: `CREATE UNIQUE INDEX tournament_document_versions_number_unique ON public.tournament_document_versions USING btree (document_id, version)`
- `tournament_document_versions_org_id_unique`: `CREATE UNIQUE INDEX tournament_document_versions_org_id_unique ON public.tournament_document_versions USING btree (organization_id, id)`
- `tournament_document_versions_pkey`: `CREATE UNIQUE INDEX tournament_document_versions_pkey ON public.tournament_document_versions USING btree (id)`
- `tournament_documents_idempotency_unique`: `CREATE UNIQUE INDEX tournament_documents_idempotency_unique ON public.tournament_documents USING btree (organization_id, created_by, idempotency_key)`
- `tournament_documents_org_id_unique`: `CREATE UNIQUE INDEX tournament_documents_org_id_unique ON public.tournament_documents USING btree (organization_id, id)`
- `tournament_documents_org_tournament_id_unique`: `CREATE UNIQUE INDEX tournament_documents_org_tournament_id_unique ON public.tournament_documents USING btree (organization_id, tournament_id, id)`
- `tournament_documents_pkey`: `CREATE UNIQUE INDEX tournament_documents_pkey ON public.tournament_documents USING btree (id)`
- `tournament_documents_scope_status_idx`: `CREATE INDEX tournament_documents_scope_status_idx ON public.tournament_documents USING btree (organization_id, tournament_id, status, updated_at DESC, id)`
- `tournament_draw_pot_members_participant_unique`: `CREATE UNIQUE INDEX tournament_draw_pot_members_participant_unique ON public.tournament_draw_pot_members USING btree (participant_id)`
- `tournament_draw_pot_members_pkey`: `CREATE UNIQUE INDEX tournament_draw_pot_members_pkey ON public.tournament_draw_pot_members USING btree (pot_id, participant_id)`
- `tournament_draw_pot_members_pot_order_idx`: `CREATE INDEX tournament_draw_pot_members_pot_order_idx ON public.tournament_draw_pot_members USING btree (pot_id, seed_number, created_at)`
- `tournament_draw_pots_number_unique`: `CREATE UNIQUE INDEX tournament_draw_pots_number_unique ON public.tournament_draw_pots USING btree (participant_set_id, number) WHERE (status = 'active'::text)`
- `tournament_draw_pots_order_idx`: `CREATE INDEX tournament_draw_pots_order_idx ON public.tournament_draw_pots USING btree (participant_set_id, sort_order, number) WHERE (status = 'active'::text)`
- `tournament_draw_pots_pkey`: `CREATE UNIQUE INDEX tournament_draw_pots_pkey ON public.tournament_draw_pots USING btree (id)`
- `tournament_draw_pots_scope_unique`: `CREATE UNIQUE INDEX tournament_draw_pots_scope_unique ON public.tournament_draw_pots USING btree (organization_id, tournament_id, category_id, participant_set_id, id)`
- `tournament_entitlement_capabilities_pkey`: `CREATE UNIQUE INDEX tournament_entitlement_capabilities_pkey ON public.tournament_entitlement_capabilities USING btree (capability)`
- `tournament_entitlement_overrides_active_idx`: `CREATE INDEX tournament_entitlement_overrides_active_idx ON public.tournament_entitlement_overrides USING btree (organization_id, tournament_id, capability, expires_at)`
- `tournament_entitlement_overrides_capability_idx`: `CREATE INDEX tournament_entitlement_overrides_capability_idx ON public.tournament_entitlement_overrides USING btree (capability)`
- `tournament_entitlement_overrides_pkey`: `CREATE UNIQUE INDEX tournament_entitlement_overrides_pkey ON public.tournament_entitlement_overrides USING btree (id)`
- `tournament_entitlement_overrides_unique`: `CREATE UNIQUE INDEX tournament_entitlement_overrides_unique ON public.tournament_entitlement_overrides USING btree (organization_id, tournament_id, capability)`
- `tournament_entitlement_plans_pkey`: `CREATE UNIQUE INDEX tournament_entitlement_plans_pkey ON public.tournament_legacy_subscription_plans USING btree (code)`
- `tournament_fixture_versions_context_idx`: `CREATE INDEX tournament_fixture_versions_context_idx ON public.tournament_fixture_versions USING btree (organization_id, tournament_id, category_id, version_number DESC)`
- `tournament_fixture_versions_idempotency_unique`: `CREATE UNIQUE INDEX tournament_fixture_versions_idempotency_unique ON public.tournament_fixture_versions USING btree (organization_id, created_by, idempotency_key)`
- `tournament_fixture_versions_pkey`: `CREATE UNIQUE INDEX tournament_fixture_versions_pkey ON public.tournament_fixture_versions USING btree (id)`
- `tournament_fixture_versions_published_unique`: `CREATE UNIQUE INDEX tournament_fixture_versions_published_unique ON public.tournament_fixture_versions USING btree (tournament_id, category_id) WHERE (status = 'published'::text)`
- `tournament_fixture_versions_scope_unique`: `CREATE UNIQUE INDEX tournament_fixture_versions_scope_unique ON public.tournament_fixture_versions USING btree (organization_id, tournament_id, category_id, id)`
- `tournament_fixture_versions_version_unique`: `CREATE UNIQUE INDEX tournament_fixture_versions_version_unique ON public.tournament_fixture_versions USING btree (tournament_id, category_id, version_number)`
- `tournament_group_members_group_order_idx`: `CREATE INDEX tournament_group_members_group_order_idx ON public.tournament_group_members USING btree (group_id, position_seed, created_at)`
- `tournament_group_members_pkey`: `CREATE UNIQUE INDEX tournament_group_members_pkey ON public.tournament_group_members USING btree (group_id, participant_id)`
- `tournament_group_members_position_unique`: `CREATE UNIQUE INDEX tournament_group_members_position_unique ON public.tournament_group_members USING btree (group_id, position_seed) WHERE (position_seed IS NOT NULL)`
- `tournament_groups_context_order_idx`: `CREATE INDEX tournament_groups_context_order_idx ON public.tournament_groups USING btree (participant_set_id, fixture_version_id, status, sort_order, code)`
- `tournament_groups_draw_code_unique`: `CREATE UNIQUE INDEX tournament_groups_draw_code_unique ON public.tournament_groups USING btree (participant_set_id, code) WHERE ((fixture_version_id IS NULL) AND (status <> 'archived'::text))`
- `tournament_groups_fixture_code_unique`: `CREATE UNIQUE INDEX tournament_groups_fixture_code_unique ON public.tournament_groups USING btree (fixture_version_id, code) WHERE ((fixture_version_id IS NOT NULL) AND (status <> 'archived'::text))`
- `tournament_groups_fixture_phase_scope_unique`: `CREATE UNIQUE INDEX tournament_groups_fixture_phase_scope_unique ON public.tournament_groups USING btree (organization_id, tournament_id, category_id, fixture_version_id, phase_id, id)`
- `tournament_groups_pkey`: `CREATE UNIQUE INDEX tournament_groups_pkey ON public.tournament_groups USING btree (id)`
- `tournament_groups_scope_unique`: `CREATE UNIQUE INDEX tournament_groups_scope_unique ON public.tournament_groups USING btree (organization_id, tournament_id, category_id, participant_set_id, id)`
- `tournament_match_availability_responses_pkey`: `CREATE UNIQUE INDEX tournament_match_availability_responses_pkey ON public.tournament_match_availability_responses USING btree (id)`
- `tournament_match_availability_team_idx`: `CREATE INDEX tournament_match_availability_team_idx ON public.tournament_match_availability_responses USING btree (match_id, team_entry_id, response)`
- `tournament_match_availability_unique`: `CREATE UNIQUE INDEX tournament_match_availability_unique ON public.tournament_match_availability_responses USING btree (match_id, roster_player_id)`
- `tournament_match_events_one_assist_per_goal_idx`: `CREATE UNIQUE INDEX tournament_match_events_one_assist_per_goal_idx ON public.tournament_match_events USING btree (match_operation_id, related_event_id) WHERE ((event_type = 'assist'::text) AND (voided_at IS NULL))`
- `tournament_match_events_one_substitution_in_per_out_idx`: `CREATE UNIQUE INDEX tournament_match_events_one_substitution_in_per_out_idx ON public.tournament_match_events USING btree (match_operation_id, related_event_id) WHERE ((event_type = 'substitution_in'::text) AND (voided_at IS NULL))`
- `tournament_match_events_pkey`: `CREATE UNIQUE INDEX tournament_match_events_pkey ON public.tournament_match_events USING btree (id)`
- `tournament_match_events_sequence_unique`: `CREATE UNIQUE INDEX tournament_match_events_sequence_unique ON public.tournament_match_events USING btree (match_operation_id, sequence_number)`
- `tournament_match_events_timeline_idx`: `CREATE INDEX tournament_match_events_timeline_idx ON public.tournament_match_events USING btree (match_operation_id, sequence_number) WHERE (voided_at IS NULL)`
- `tournament_match_operation_players_pkey`: `CREATE UNIQUE INDEX tournament_match_operation_players_pkey ON public.tournament_match_operation_players USING btree (id)`
- `tournament_match_operation_players_team_idx`: `CREATE INDEX tournament_match_operation_players_team_idx ON public.tournament_match_operation_players USING btree (match_operation_id, team_entry_id, lineup_status)`
- `tournament_match_operation_players_unique`: `CREATE UNIQUE INDEX tournament_match_operation_players_unique ON public.tournament_match_operation_players USING btree (match_operation_id, roster_player_id)`
- `tournament_match_operations_active_unique`: `CREATE UNIQUE INDEX tournament_match_operations_active_unique ON public.tournament_match_operations USING btree (match_id) WHERE (status = ANY (ARRAY['draft'::text, 'submitted'::text, 'under_review'::text, 'validated'::text]))`
- `tournament_match_operations_match_version_unique`: `CREATE UNIQUE INDEX tournament_match_operations_match_version_unique ON public.tournament_match_operations USING btree (match_id, operation_version)`
- `tournament_match_operations_official_unique`: `CREATE UNIQUE INDEX tournament_match_operations_official_unique ON public.tournament_match_operations USING btree (match_id) WHERE (status = 'official'::text)`
- `tournament_match_operations_org_id_unique`: `CREATE UNIQUE INDEX tournament_match_operations_org_id_unique ON public.tournament_match_operations USING btree (organization_id, id)`
- `tournament_match_operations_org_match_id_unique`: `CREATE UNIQUE INDEX tournament_match_operations_org_match_id_unique ON public.tournament_match_operations USING btree (organization_id, match_id, id)`
- `tournament_match_operations_pkey`: `CREATE UNIQUE INDEX tournament_match_operations_pkey ON public.tournament_match_operations USING btree (id)`
- `tournament_match_operations_scope_idx`: `CREATE INDEX tournament_match_operations_scope_idx ON public.tournament_match_operations USING btree (organization_id, tournament_id, category_id, match_status, updated_at DESC)`
- `tournament_match_outcomes_pkey`: `CREATE UNIQUE INDEX tournament_match_outcomes_pkey ON public.tournament_match_outcomes USING btree (match_operation_id)`
- `tournament_match_reschedules_match_idx`: `CREATE INDEX tournament_match_reschedules_match_idx ON public.tournament_match_reschedules USING btree (match_id, created_at DESC)`
- `tournament_match_reschedules_pkey`: `CREATE UNIQUE INDEX tournament_match_reschedules_pkey ON public.tournament_match_reschedules USING btree (id)`
- `tournament_match_resumptions_open_unique`: `CREATE UNIQUE INDEX tournament_match_resumptions_open_unique ON public.tournament_match_resumptions USING btree (match_operation_id) WHERE (status = ANY (ARRAY['pending'::text, 'scheduled'::text]))`
- `tournament_match_resumptions_pkey`: `CREATE UNIQUE INDEX tournament_match_resumptions_pkey ON public.tournament_match_resumptions USING btree (id)`
- `tournament_match_reviews_open_unique`: `CREATE UNIQUE INDEX tournament_match_reviews_open_unique ON public.tournament_match_reviews USING btree (match_operation_id, review_type) WHERE (status = 'open'::text)`
- `tournament_match_reviews_operation_idx`: `CREATE INDEX tournament_match_reviews_operation_idx ON public.tournament_match_reviews USING btree (match_operation_id, requested_at DESC)`
- `tournament_match_reviews_pkey`: `CREATE UNIQUE INDEX tournament_match_reviews_pkey ON public.tournament_match_reviews USING btree (id)`
- `tournament_match_scores_pkey`: `CREATE UNIQUE INDEX tournament_match_scores_pkey ON public.tournament_match_scores USING btree (match_operation_id)`
- `tournament_match_sources_fixture_idx`: `CREATE INDEX tournament_match_sources_fixture_idx ON public.tournament_match_sources USING btree (fixture_version_id, match_id, side)`
- `tournament_match_sources_pkey`: `CREATE UNIQUE INDEX tournament_match_sources_pkey ON public.tournament_match_sources USING btree (id)`
- `tournament_match_sources_side_unique`: `CREATE UNIQUE INDEX tournament_match_sources_side_unique ON public.tournament_match_sources USING btree (match_id, side)`
- `tournament_match_squad_players_lineup_idx`: `CREATE INDEX tournament_match_squad_players_lineup_idx ON public.tournament_match_squad_players USING btree (match_squad_id, lineup_status, display_name_snapshot)`
- `tournament_match_squad_players_one_captain_idx`: `CREATE UNIQUE INDEX tournament_match_squad_players_one_captain_idx ON public.tournament_match_squad_players USING btree (match_squad_id) WHERE (is_captain AND (callup_status = 'called_up'::text))`
- `tournament_match_squad_players_pkey`: `CREATE UNIQUE INDEX tournament_match_squad_players_pkey ON public.tournament_match_squad_players USING btree (id)`
- `tournament_match_squad_players_unique`: `CREATE UNIQUE INDEX tournament_match_squad_players_unique ON public.tournament_match_squad_players USING btree (match_squad_id, roster_player_id)`
- `tournament_match_squads_active_unique`: `CREATE UNIQUE INDEX tournament_match_squads_active_unique ON public.tournament_match_squads USING btree (match_id, team_entry_id) WHERE (status <> 'superseded'::text)`
- `tournament_match_squads_match_status_idx`: `CREATE INDEX tournament_match_squads_match_status_idx ON public.tournament_match_squads USING btree (match_id, status, team_entry_id)`
- `tournament_match_squads_org_match_team_unique`: `CREATE UNIQUE INDEX tournament_match_squads_org_match_team_unique ON public.tournament_match_squads USING btree (organization_id, match_id, team_entry_id, id)`
- `tournament_match_squads_pkey`: `CREATE UNIQUE INDEX tournament_match_squads_pkey ON public.tournament_match_squads USING btree (id)`
- `tournament_matches_away_schedule_idx`: `CREATE INDEX tournament_matches_away_schedule_idx ON public.tournament_matches USING btree (away_participant_id, scheduled_at) WHERE ((scheduled_at IS NOT NULL) AND (status <> ALL (ARRAY['cancelled'::text, 'completed'::text])))`
- `tournament_matches_fixture_round_idx`: `CREATE INDEX tournament_matches_fixture_round_idx ON public.tournament_matches USING btree (fixture_version_id, round_id, match_number)`
- `tournament_matches_home_schedule_idx`: `CREATE INDEX tournament_matches_home_schedule_idx ON public.tournament_matches USING btree (home_participant_id, scheduled_at) WHERE ((scheduled_at IS NOT NULL) AND (status <> ALL (ARRAY['cancelled'::text, 'completed'::text])))`
- `tournament_matches_number_unique`: `CREATE UNIQUE INDEX tournament_matches_number_unique ON public.tournament_matches USING btree (fixture_version_id, match_number)`
- `tournament_matches_org_id_unique`: `CREATE UNIQUE INDEX tournament_matches_org_id_unique ON public.tournament_matches USING btree (organization_id, id)`
- `tournament_matches_participant_feed_idx`: `CREATE INDEX tournament_matches_participant_feed_idx ON public.tournament_matches USING btree (fixture_version_id, scheduled_at, match_number)`
- `tournament_matches_pkey`: `CREATE UNIQUE INDEX tournament_matches_pkey ON public.tournament_matches USING btree (id)`
- `tournament_matches_schedule_idx`: `CREATE INDEX tournament_matches_schedule_idx ON public.tournament_matches USING btree (organization_id, scheduled_at, court_id) WHERE ((scheduled_at IS NOT NULL) AND (status <> ALL (ARRAY['cancelled'::text, 'completed'::text])))`
- `tournament_matches_scope_unique`: `CREATE UNIQUE INDEX tournament_matches_scope_unique ON public.tournament_matches USING btree (organization_id, tournament_id, category_id, fixture_version_id, id)`
- `tournament_matches_withdrawn_participant_idx`: `CREATE INDEX tournament_matches_withdrawn_participant_idx ON public.tournament_matches USING btree (withdrawn_participant_id) WHERE (withdrawn_participant_id IS NOT NULL)`
- `tournament_media_assets_checksum_active_unique`: `CREATE UNIQUE INDEX tournament_media_assets_checksum_active_unique ON public.tournament_media_assets USING btree (organization_id, checksum_sha256) WHERE (status <> 'revoked'::text)`
- `tournament_media_assets_gallery_id_unique`: `CREATE UNIQUE INDEX tournament_media_assets_gallery_id_unique ON public.tournament_media_assets USING btree (gallery_id, id)`
- `tournament_media_assets_gallery_status_idx`: `CREATE INDEX tournament_media_assets_gallery_status_idx ON public.tournament_media_assets USING btree (gallery_id, status, created_at DESC)`
- `tournament_media_assets_path_unique`: `CREATE UNIQUE INDEX tournament_media_assets_path_unique ON public.tournament_media_assets USING btree (bucket, internal_path)`
- `tournament_media_assets_pkey`: `CREATE UNIQUE INDEX tournament_media_assets_pkey ON public.tournament_media_assets USING btree (id)`
- `tournament_media_assets_retention_idx`: `CREATE INDEX tournament_media_assets_retention_idx ON public.tournament_media_assets USING btree (organization_id, tournament_id, storage_state, created_at) WHERE (storage_state <> 'storage_purged'::text)`
- `tournament_media_assets_review_idx`: `CREATE INDEX tournament_media_assets_review_idx ON public.tournament_media_assets USING btree (organization_id, status, created_at) WHERE (status = ANY (ARRAY['pending_review'::text, 'hidden'::text]))`
- `tournament_media_assignments_pkey`: `CREATE UNIQUE INDEX tournament_media_assignments_pkey ON public.tournament_media_assignments USING btree (id)`
- `tournament_media_assignments_unique`: `CREATE UNIQUE INDEX tournament_media_assignments_unique ON public.tournament_media_assignments USING btree (gallery_id, user_id)`
- `tournament_media_assignments_user_idx`: `CREATE INDEX tournament_media_assignments_user_idx ON public.tournament_media_assignments USING btree (user_id, status, gallery_id)`
- `tournament_media_consent_events_consent_idx`: `CREATE INDEX tournament_media_consent_events_consent_idx ON public.tournament_media_consent_events USING btree (consent_id, created_at DESC)`
- `tournament_media_consent_events_pkey`: `CREATE UNIQUE INDEX tournament_media_consent_events_pkey ON public.tournament_media_consent_events USING btree (id)`
- `tournament_media_consents_asset_idx`: `CREATE INDEX tournament_media_consents_asset_idx ON public.tournament_media_consents USING btree (asset_id, use_scope, status)`
- `tournament_media_consents_pkey`: `CREATE UNIQUE INDEX tournament_media_consents_pkey ON public.tournament_media_consents USING btree (id)`
- `tournament_media_consents_subject_unique`: `CREATE UNIQUE INDEX tournament_media_consents_subject_unique ON public.tournament_media_consents USING btree (asset_id, COALESCE(roster_player_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(subject_user_id, '00000000-0000-0000-0000-000000000000'::uuid), use_scope)`
- `tournament_media_galleries_admin_idx`: `CREATE INDEX tournament_media_galleries_admin_idx ON public.tournament_media_galleries USING btree (organization_id, tournament_id, status, updated_at DESC)`
- `tournament_media_galleries_creation_unique`: `CREATE UNIQUE INDEX tournament_media_galleries_creation_unique ON public.tournament_media_galleries USING btree (organization_id, created_by, idempotency_key)`
- `tournament_media_galleries_match_idx`: `CREATE INDEX tournament_media_galleries_match_idx ON public.tournament_media_galleries USING btree (match_id, status, published_at DESC) WHERE (match_id IS NOT NULL)`
- `tournament_media_galleries_participant_idx`: `CREATE INDEX tournament_media_galleries_participant_idx ON public.tournament_media_galleries USING btree (tournament_id, category_id, status, visibility, published_at DESC) WHERE (status = 'published'::text)`
- `tournament_media_galleries_pkey`: `CREATE UNIQUE INDEX tournament_media_galleries_pkey ON public.tournament_media_galleries USING btree (id)`
- `tournament_media_galleries_scope_unique`: `CREATE UNIQUE INDEX tournament_media_galleries_scope_unique ON public.tournament_media_galleries USING btree (organization_id, tournament_id, id)`
- `tournament_media_gallery_items_order_idx`: `CREATE INDEX tournament_media_gallery_items_order_idx ON public.tournament_media_gallery_items USING btree (gallery_id, sort_order, created_at)`
- `tournament_media_gallery_items_order_unique`: `CREATE UNIQUE INDEX tournament_media_gallery_items_order_unique ON public.tournament_media_gallery_items USING btree (gallery_id, sort_order)`
- `tournament_media_gallery_items_pkey`: `CREATE UNIQUE INDEX tournament_media_gallery_items_pkey ON public.tournament_media_gallery_items USING btree (id)`
- `tournament_media_gallery_items_unique`: `CREATE UNIQUE INDEX tournament_media_gallery_items_unique ON public.tournament_media_gallery_items USING btree (gallery_id, asset_id)`
- `tournament_media_moderation_actions_asset_idx`: `CREATE INDEX tournament_media_moderation_actions_asset_idx ON public.tournament_media_moderation_actions USING btree (asset_id, created_at DESC)`
- `tournament_media_moderation_actions_pkey`: `CREATE UNIQUE INDEX tournament_media_moderation_actions_pkey ON public.tournament_media_moderation_actions USING btree (id)`
- `tournament_media_pipeline_configuration_pkey`: `CREATE UNIQUE INDEX tournament_media_pipeline_configuration_pkey ON public.tournament_media_pipeline_configuration USING btree (singleton)`
- `tournament_media_processing_jobs_pkey`: `CREATE UNIQUE INDEX tournament_media_processing_jobs_pkey ON public.tournament_media_processing_jobs USING btree (id)`
- `tournament_media_processing_jobs_queue_idx`: `CREATE INDEX tournament_media_processing_jobs_queue_idx ON public.tournament_media_processing_jobs USING btree (status, created_at)`
- `tournament_media_processing_jobs_session_key`: `CREATE UNIQUE INDEX tournament_media_processing_jobs_session_key ON public.tournament_media_processing_jobs USING btree (session_id)`
- `tournament_media_relations_pkey`: `CREATE UNIQUE INDEX tournament_media_relations_pkey ON public.tournament_media_relations USING btree (id)`
- `tournament_media_relations_scope_idx`: `CREATE INDEX tournament_media_relations_scope_idx ON public.tournament_media_relations USING btree (organization_id, tournament_id, category_id, relation_type)`
- `tournament_media_relations_unique`: `CREATE UNIQUE INDEX tournament_media_relations_unique ON public.tournament_media_relations USING btree (asset_id, relation_type, COALESCE(match_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(team_entry_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(roster_player_id, '00000000-0000-0000-0000-000000000000'::uuid))`
- `tournament_media_reports_pkey`: `CREATE UNIQUE INDEX tournament_media_reports_pkey ON public.tournament_media_reports USING btree (id)`
- `tournament_media_reports_rate_idx`: `CREATE INDEX tournament_media_reports_rate_idx ON public.tournament_media_reports USING btree (reporter_user_id, created_at DESC)`
- `tournament_media_reports_request_unique`: `CREATE UNIQUE INDEX tournament_media_reports_request_unique ON public.tournament_media_reports USING btree (reporter_user_id, idempotency_key)`
- `tournament_media_reports_review_idx`: `CREATE INDEX tournament_media_reports_review_idx ON public.tournament_media_reports USING btree (organization_id, status, created_at)`
- `tournament_media_service_attestations_pkey`: `CREATE UNIQUE INDEX tournament_media_service_attestations_pkey ON public.tournament_media_service_attestations USING btree (service)`
- `tournament_media_upload_sessions_actor_idx`: `CREATE INDEX tournament_media_upload_sessions_actor_idx ON public.tournament_media_upload_sessions USING btree (requested_by, status, expires_at)`
- `tournament_media_upload_sessions_gallery_idx`: `CREATE INDEX tournament_media_upload_sessions_gallery_idx ON public.tournament_media_upload_sessions USING btree (gallery_id, status, created_at DESC)`
- `tournament_media_upload_sessions_live_request_unique`: `CREATE UNIQUE INDEX tournament_media_upload_sessions_live_request_unique ON public.tournament_media_upload_sessions USING btree (organization_id, requested_by, idempotency_key) WHERE (status = 'issued'::text)`
- `tournament_media_upload_sessions_pkey`: `CREATE UNIQUE INDEX tournament_media_upload_sessions_pkey ON public.tournament_media_upload_sessions USING btree (id)`
- `tournament_media_upload_sessions_token_unique`: `CREATE UNIQUE INDEX tournament_media_upload_sessions_token_unique ON public.tournament_media_upload_sessions USING btree (token_hash)`
- `tournament_media_variants_asset_idx`: `CREATE INDEX tournament_media_variants_asset_idx ON public.tournament_media_variants USING btree (asset_id, kind) WHERE (status = 'ready'::text)`
- `tournament_media_variants_path_unique`: `CREATE UNIQUE INDEX tournament_media_variants_path_unique ON public.tournament_media_variants USING btree (bucket, internal_path)`
- `tournament_media_variants_pkey`: `CREATE UNIQUE INDEX tournament_media_variants_pkey ON public.tournament_media_variants USING btree (id)`
- `tournament_media_variants_unique`: `CREATE UNIQUE INDEX tournament_media_variants_unique ON public.tournament_media_variants USING btree (asset_id, kind)`
- `tournament_notification_preferences_org_id_unique`: `CREATE UNIQUE INDEX tournament_notification_preferences_org_id_unique ON public.tournament_notification_preferences USING btree (organization_id, id)`
- `tournament_notification_preferences_pkey`: `CREATE UNIQUE INDEX tournament_notification_preferences_pkey ON public.tournament_notification_preferences USING btree (id)`
- `tournament_notification_preferences_unique`: `CREATE UNIQUE INDEX tournament_notification_preferences_unique ON public.tournament_notification_preferences USING btree (tournament_id, user_id)`
- `tournament_notification_preferences_user_idx`: `CREATE INDEX tournament_notification_preferences_user_idx ON public.tournament_notification_preferences USING btree (user_id, tournament_id)`
- `tournament_organization_entitlement_overrides_active_idx`: `CREATE INDEX tournament_organization_entitlement_overrides_active_idx ON public.tournament_organization_entitlement_overrides USING btree (organization_id, capability, expires_at)`
- `tournament_organization_entitlement_overrides_capability_idx`: `CREATE INDEX tournament_organization_entitlement_overrides_capability_idx ON public.tournament_organization_entitlement_overrides USING btree (capability)`
- `tournament_organization_entitlement_overrides_pkey`: `CREATE UNIQUE INDEX tournament_organization_entitlement_overrides_pkey ON public.tournament_organization_entitlement_overrides USING btree (id)`
- `tournament_organization_entitlement_overrides_unique`: `CREATE UNIQUE INDEX tournament_organization_entitlement_overrides_unique ON public.tournament_organization_entitlement_overrides USING btree (organization_id, capability)`
- `tournament_organization_members_org_status_idx`: `CREATE INDEX tournament_organization_members_org_status_idx ON public.tournament_organization_members USING btree (organization_id, status)`
- `tournament_organization_members_pkey`: `CREATE UNIQUE INDEX tournament_organization_members_pkey ON public.tournament_organization_members USING btree (id)`
- `tournament_organization_members_unique`: `CREATE UNIQUE INDEX tournament_organization_members_unique ON public.tournament_organization_members USING btree (organization_id, user_id)`
- `tournament_organization_members_user_active_idx`: `CREATE INDEX tournament_organization_members_user_active_idx ON public.tournament_organization_members USING btree (user_id, organization_id) WHERE (status = 'active'::text)`
- `tournament_organization_one_active_owner_idx`: `CREATE UNIQUE INDEX tournament_organization_one_active_owner_idx ON public.tournament_organization_members USING btree (organization_id) WHERE ((role = 'owner'::text) AND (status = 'active'::text))`
- `tournament_organization_plan_state_pkey`: `CREATE UNIQUE INDEX tournament_organization_plan_state_pkey ON public.tournament_organization_plan_state USING btree (organization_id)`
- `tournament_organization_role_capabilities_pkey`: `CREATE UNIQUE INDEX tournament_organization_role_capabilities_pkey ON public.tournament_organization_role_capabilities USING btree (role, capability)`
- `tournament_organization_subscriptions_effective_idx`: `CREATE INDEX tournament_organization_subscriptions_effective_idx ON public.tournament_legacy_organization_subscriptions USING btree (organization_id, status, current_period_end, grace_until)`
- `tournament_organization_subscriptions_one_per_org`: `CREATE UNIQUE INDEX tournament_organization_subscriptions_one_per_org ON public.tournament_legacy_organization_subscriptions USING btree (organization_id)`
- `tournament_organization_subscriptions_pkey`: `CREATE UNIQUE INDEX tournament_organization_subscriptions_pkey ON public.tournament_legacy_organization_subscriptions USING btree (id)`
- `tournament_organizations_creation_unique`: `CREATE UNIQUE INDEX tournament_organizations_creation_unique ON public.tournament_organizations USING btree (created_by, creation_key)`
- `tournament_organizations_pkey`: `CREATE UNIQUE INDEX tournament_organizations_pkey ON public.tournament_organizations USING btree (id)`
- `tournament_organizations_slug_unique`: `CREATE UNIQUE INDEX tournament_organizations_slug_unique ON public.tournament_organizations USING btree (slug)`
- `tournament_participant_hub_preferences_pkey`: `CREATE UNIQUE INDEX tournament_participant_hub_preferences_pkey ON public.tournament_participant_hub_preferences USING btree (user_id, tournament_id)`
- `tournament_participant_hub_preferences_scope_idx`: `CREATE INDEX tournament_participant_hub_preferences_scope_idx ON public.tournament_participant_hub_preferences USING btree (organization_id, tournament_id, category_id, user_id)`
- `tournament_participant_sets_context_idx`: `CREATE INDEX tournament_participant_sets_context_idx ON public.tournament_participant_sets USING btree (organization_id, tournament_id, category_id, version_number DESC)`
- `tournament_participant_sets_frozen_unique`: `CREATE UNIQUE INDEX tournament_participant_sets_frozen_unique ON public.tournament_participant_sets USING btree (tournament_id, category_id) WHERE (status = 'frozen'::text)`
- `tournament_participant_sets_idempotency_unique`: `CREATE UNIQUE INDEX tournament_participant_sets_idempotency_unique ON public.tournament_participant_sets USING btree (organization_id, frozen_by, idempotency_key)`
- `tournament_participant_sets_pkey`: `CREATE UNIQUE INDEX tournament_participant_sets_pkey ON public.tournament_participant_sets USING btree (id)`
- `tournament_participant_sets_scope_unique`: `CREATE UNIQUE INDEX tournament_participant_sets_scope_unique ON public.tournament_participant_sets USING btree (organization_id, tournament_id, category_id, id)`
- `tournament_participant_sets_version_unique`: `CREATE UNIQUE INDEX tournament_participant_sets_version_unique ON public.tournament_participant_sets USING btree (tournament_id, category_id, version_number)`
- `tournament_phases_fixture_order_idx`: `CREATE INDEX tournament_phases_fixture_order_idx ON public.tournament_phases USING btree (fixture_version_id, sequence_number)`
- `tournament_phases_pkey`: `CREATE UNIQUE INDEX tournament_phases_pkey ON public.tournament_phases USING btree (id)`
- `tournament_phases_scope_unique`: `CREATE UNIQUE INDEX tournament_phases_scope_unique ON public.tournament_phases USING btree (organization_id, tournament_id, category_id, fixture_version_id, id)`
- `tournament_phases_sequence_unique`: `CREATE UNIQUE INDEX tournament_phases_sequence_unique ON public.tournament_phases USING btree (fixture_version_id, sequence_number)`
- `tournament_plan_catalog_pkey`: `CREATE UNIQUE INDEX tournament_plan_catalog_pkey ON public.tournament_plan_catalog USING btree (plan_code)`
- `tournament_plan_grant_events_current_idx`: `CREATE INDEX tournament_plan_grant_events_current_idx ON public.tournament_plan_grant_events USING btree (grant_id, id DESC)`
- `tournament_plan_grant_events_pkey`: `CREATE UNIQUE INDEX tournament_plan_grant_events_pkey ON public.tournament_plan_grant_events USING btree (id)`
- `tournament_plan_grant_events_purchase_idx`: `CREATE INDEX tournament_plan_grant_events_purchase_idx ON public.tournament_plan_grant_events USING btree (purchase_id, id DESC) WHERE (purchase_id IS NOT NULL)`
- `tournament_plan_grants_origin_purchase_unique`: `CREATE UNIQUE INDEX tournament_plan_grants_origin_purchase_unique ON public.tournament_plan_grants USING btree (origin_purchase_id) WHERE (origin_purchase_id IS NOT NULL)`
- `tournament_plan_grants_pkey`: `CREATE UNIQUE INDEX tournament_plan_grants_pkey ON public.tournament_plan_grants USING btree (id)`
- `tournament_plan_grants_resolution_idx`: `CREATE INDEX tournament_plan_grants_resolution_idx ON public.tournament_plan_grants USING btree (organization_id, tournament_id, plan_code, granted_at)`
- `tournament_plan_grants_unique`: `CREATE UNIQUE INDEX tournament_plan_grants_unique ON public.tournament_plan_grants USING btree (organization_id, tournament_id, plan_code, source)`
- `tournament_player_portraits_object_unique`: `CREATE UNIQUE INDEX tournament_player_portraits_object_unique ON public.tournament_player_portraits USING btree (bucket, object_path)`
- `tournament_player_portraits_one_active_idx`: `CREATE UNIQUE INDEX tournament_player_portraits_one_active_idx ON public.tournament_player_portraits USING btree (roster_player_id) WHERE (lifecycle_status = ANY (ARRAY['active'::text, 'delete_pending'::text]))`
- `tournament_player_portraits_org_id_unique`: `CREATE UNIQUE INDEX tournament_player_portraits_org_id_unique ON public.tournament_player_portraits USING btree (organization_id, id)`
- `tournament_player_portraits_pkey`: `CREATE UNIQUE INDEX tournament_player_portraits_pkey ON public.tournament_player_portraits USING btree (id)`
- `tournament_player_portraits_resolver_idx`: `CREATE INDEX tournament_player_portraits_resolver_idx ON public.tournament_player_portraits USING btree (organization_id, tournament_id, lifecycle_status, editorial_status, publication_consent)`
- `tournament_player_portraits_roster_idx`: `CREATE INDEX tournament_player_portraits_roster_idx ON public.tournament_player_portraits USING btree (organization_id, roster_player_id, created_at DESC)`
- `tournament_player_portraits_team_idx`: `CREATE INDEX tournament_player_portraits_team_idx ON public.tournament_player_portraits USING btree (organization_id, team_entry_id)`
- `tournament_player_statistics_pkey`: `CREATE UNIQUE INDEX tournament_player_statistics_pkey ON public.tournament_player_statistics USING btree (revision_id, roster_player_id)`
- `tournament_player_statistics_rankings_idx`: `CREATE INDEX tournament_player_statistics_rankings_idx ON public.tournament_player_statistics USING btree (revision_id, goals DESC, assists DESC, roster_player_id)`
- `tournament_player_suspensions_current_idx`: `CREATE INDEX tournament_player_suspensions_current_idx ON public.tournament_player_suspensions USING btree (organization_id, tournament_id, category_id, roster_player_id, status) WHERE (status = ANY (ARRAY['active'::text, 'reduced'::text]))`
- `tournament_player_suspensions_pkey`: `CREATE UNIQUE INDEX tournament_player_suspensions_pkey ON public.tournament_player_suspensions USING btree (id)`
- `tournament_player_suspensions_source_unique`: `CREATE UNIQUE INDEX tournament_player_suspensions_source_unique ON public.tournament_player_suspensions USING btree (revision_id, roster_player_id, source_type, source_key)`
- `tournament_points_adjustments_idempotency_unique`: `CREATE UNIQUE INDEX tournament_points_adjustments_idempotency_unique ON public.tournament_points_adjustments USING btree (organization_id, actor_user_id, idempotency_key)`
- `tournament_points_adjustments_pkey`: `CREATE UNIQUE INDEX tournament_points_adjustments_pkey ON public.tournament_points_adjustments USING btree (id)`
- `tournament_pricing_config_pkey`: `CREATE UNIQUE INDEX tournament_pricing_config_pkey ON public.tournament_pricing_config USING btree (config_key)`
- `tournament_projection_sources_match_idx`: `CREATE INDEX tournament_projection_sources_match_idx ON public.tournament_projection_sources USING btree (match_id, revision_id)`
- `tournament_projection_sources_pkey`: `CREATE UNIQUE INDEX tournament_projection_sources_pkey ON public.tournament_projection_sources USING btree (revision_id, match_operation_id)`
- `tournament_provisional_players_claimed_user_idx`: `CREATE INDEX tournament_provisional_players_claimed_user_idx ON public.tournament_provisional_players USING btree (claimed_by_user_id, id) WHERE ((claim_status = 'claimed'::text) AND (claimed_by_user_id IS NOT NULL))`
- `tournament_provisional_players_name_idx`: `CREATE INDEX tournament_provisional_players_name_idx ON public.tournament_provisional_players USING btree (organization_id, normalized_name)`
- `tournament_provisional_players_org_id_unique`: `CREATE UNIQUE INDEX tournament_provisional_players_org_id_unique ON public.tournament_provisional_players USING btree (organization_id, id)`
- `tournament_provisional_players_pkey`: `CREATE UNIQUE INDEX tournament_provisional_players_pkey ON public.tournament_provisional_players USING btree (id)`
- `tournament_public_pages_pkey`: `CREATE UNIQUE INDEX tournament_public_pages_pkey ON public.tournament_public_pages USING btree (tournament_id)`
- `tournament_public_pages_published_scope_idx`: `CREATE INDEX tournament_public_pages_published_scope_idx ON public.tournament_public_pages USING btree (organization_id, tournament_id) WHERE (status = 'published'::text)`
- `tournament_public_pages_slug_unique`: `CREATE UNIQUE INDEX tournament_public_pages_slug_unique ON public.tournament_public_pages USING btree (public_slug)`
- `tournament_purchase_events_organization_idx`: `CREATE INDEX tournament_purchase_events_organization_idx ON public.tournament_purchase_events USING btree (organization_id, created_at DESC)`
- `tournament_purchase_events_pkey`: `CREATE UNIQUE INDEX tournament_purchase_events_pkey ON public.tournament_purchase_events USING btree (id)`
- `tournament_purchase_events_purchase_idx`: `CREATE INDEX tournament_purchase_events_purchase_idx ON public.tournament_purchase_events USING btree (purchase_id, id)`
- `tournament_purchases_buyer_created_idx`: `CREATE INDEX tournament_purchases_buyer_created_idx ON public.tournament_purchases USING btree (buyer_user_id, created_at DESC)`
- `tournament_purchases_buyer_idempotency_unique`: `CREATE UNIQUE INDEX tournament_purchases_buyer_idempotency_unique ON public.tournament_purchases USING btree (buyer_user_id, idempotency_key)`
- `tournament_purchases_offer_idx`: `CREATE INDEX tournament_purchases_offer_idx ON public.tournament_purchases USING btree (product_code, offer_code, offer_version)`
- `tournament_purchases_open_season_product_unique`: `CREATE UNIQUE INDEX tournament_purchases_open_season_product_unique ON public.tournament_purchases USING btree (organization_id, season_id, product_code) WHERE (status = ANY (ARRAY['created'::text, 'preference_created'::text, 'pending'::text]))`
- `tournament_purchases_pkey`: `CREATE UNIQUE INDEX tournament_purchases_pkey ON public.tournament_purchases USING btree (id)`
- `tournament_purchases_provider_payment_unique`: `CREATE UNIQUE INDEX tournament_purchases_provider_payment_unique ON public.tournament_purchases USING btree (provider, provider_environment, approved_provider_payment_id) WHERE (approved_provider_payment_id IS NOT NULL)`
- `tournament_purchases_provider_preference_unique`: `CREATE UNIQUE INDEX tournament_purchases_provider_preference_unique ON public.tournament_purchases USING btree (provider, provider_environment, provider_preference_id) WHERE (provider_preference_id IS NOT NULL)`
- `tournament_purchases_season_created_idx`: `CREATE INDEX tournament_purchases_season_created_idx ON public.tournament_purchases USING btree (organization_id, season_id, created_at DESC)`
- `tournament_purchases_season_fk_idx`: `CREATE INDEX tournament_purchases_season_fk_idx ON public.tournament_purchases USING btree (season_id)`
- `tournament_purchases_tournament_created_idx`: `CREATE INDEX tournament_purchases_tournament_created_idx ON public.tournament_purchases USING btree (organization_id, tournament_id, created_at DESC)`
- `tournament_qualification_resolutions_current_unique`: `CREATE UNIQUE INDEX tournament_qualification_resolutions_current_unique ON public.tournament_qualification_resolutions USING btree (slot_id) WHERE (status = ANY (ARRAY['resolved'::text, 'blocked'::text, 'manual'::text]))`
- `tournament_qualification_resolutions_pkey`: `CREATE UNIQUE INDEX tournament_qualification_resolutions_pkey ON public.tournament_qualification_resolutions USING btree (id)`
- `tournament_qualification_slots_pkey`: `CREATE UNIQUE INDEX tournament_qualification_slots_pkey ON public.tournament_qualification_slots USING btree (id)`
- `tournament_qualification_slots_source_unique`: `CREATE UNIQUE INDEX tournament_qualification_slots_source_unique ON public.tournament_qualification_slots USING btree (match_source_id)`
- `tournament_roster_players_active_provisional_unique`: `CREATE UNIQUE INDEX tournament_roster_players_active_provisional_unique ON public.tournament_roster_players USING btree (roster_id, provisional_player_id) WHERE ((status = 'active'::text) AND (provisional_player_id IS NOT NULL))`
- `tournament_roster_players_active_user_unique`: `CREATE UNIQUE INDEX tournament_roster_players_active_user_unique ON public.tournament_roster_players USING btree (roster_id, arma2_user_id) WHERE ((status = 'active'::text) AND (arma2_user_id IS NOT NULL))`
- `tournament_roster_players_org_entry_id_unique`: `CREATE UNIQUE INDEX tournament_roster_players_org_entry_id_unique ON public.tournament_roster_players USING btree (organization_id, team_entry_id, id)`
- `tournament_roster_players_org_id_unique`: `CREATE UNIQUE INDEX tournament_roster_players_org_id_unique ON public.tournament_roster_players USING btree (organization_id, id)`
- `tournament_roster_players_pkey`: `CREATE UNIQUE INDEX tournament_roster_players_pkey ON public.tournament_roster_players USING btree (id)`
- `tournament_roster_players_provisional_active_idx`: `CREATE INDEX tournament_roster_players_provisional_active_idx ON public.tournament_roster_players USING btree (provisional_player_id, team_entry_id, roster_id) WHERE ((status = 'active'::text) AND (provisional_player_id IS NOT NULL))`
- `tournament_roster_players_roster_active_idx`: `CREATE INDEX tournament_roster_players_roster_active_idx ON public.tournament_roster_players USING btree (roster_id, status, display_name)`
- `tournament_roster_players_user_active_idx`: `CREATE INDEX tournament_roster_players_user_active_idx ON public.tournament_roster_players USING btree (arma2_user_id, team_entry_id, roster_id) WHERE ((status = 'active'::text) AND (arma2_user_id IS NOT NULL))`
- `tournament_roster_settings_pkey`: `CREATE UNIQUE INDEX tournament_roster_settings_pkey ON public.tournament_roster_settings USING btree (tournament_id)`
- `tournament_rosters_editable_unique`: `CREATE UNIQUE INDEX tournament_rosters_editable_unique ON public.tournament_rosters USING btree (team_entry_id) WHERE (status = ANY (ARRAY['draft'::text, 'changes_requested'::text]))`
- `tournament_rosters_entry_version_idx`: `CREATE INDEX tournament_rosters_entry_version_idx ON public.tournament_rosters USING btree (team_entry_id, version DESC)`
- `tournament_rosters_org_id_unique`: `CREATE UNIQUE INDEX tournament_rosters_org_id_unique ON public.tournament_rosters USING btree (organization_id, id)`
- `tournament_rosters_pkey`: `CREATE UNIQUE INDEX tournament_rosters_pkey ON public.tournament_rosters USING btree (id)`
- `tournament_rosters_scope_unique`: `CREATE UNIQUE INDEX tournament_rosters_scope_unique ON public.tournament_rosters USING btree (organization_id, team_entry_id, id)`
- `tournament_rosters_version_unique`: `CREATE UNIQUE INDEX tournament_rosters_version_unique ON public.tournament_rosters USING btree (team_entry_id, version)`
- `tournament_rounds_fixture_order_idx`: `CREATE INDEX tournament_rounds_fixture_order_idx ON public.tournament_rounds USING btree (fixture_version_id, sort_order, phase_id, group_id, round_number)`
- `tournament_rounds_phase_number_unique`: `CREATE UNIQUE INDEX tournament_rounds_phase_number_unique ON public.tournament_rounds USING btree (phase_id, group_id, round_number) NULLS NOT DISTINCT`
- `tournament_rounds_pkey`: `CREATE UNIQUE INDEX tournament_rounds_pkey ON public.tournament_rounds USING btree (id)`
- `tournament_rounds_scope_unique`: `CREATE UNIQUE INDEX tournament_rounds_scope_unique ON public.tournament_rounds USING btree (organization_id, tournament_id, category_id, fixture_version_id, id)`
- `tournament_schedule_windows_context_idx`: `CREATE INDEX tournament_schedule_windows_context_idx ON public.tournament_schedule_windows USING btree (tournament_id, category_id, status, specific_date, day_of_week, starts_at)`
- `tournament_schedule_windows_pkey`: `CREATE UNIQUE INDEX tournament_schedule_windows_pkey ON public.tournament_schedule_windows USING btree (id)`
- `tournament_schedule_windows_scope_unique`: `CREATE UNIQUE INDEX tournament_schedule_windows_scope_unique ON public.tournament_schedule_windows USING btree (organization_id, tournament_id, id)`
- `tournament_scoring_rules_pkey`: `CREATE UNIQUE INDEX tournament_scoring_rules_pkey ON public.tournament_scoring_rules USING btree (tournament_id)`
- `tournament_season_member_assignments_membership_idx`: `CREATE INDEX tournament_season_member_assignments_membership_idx ON public.tournament_season_member_assignments USING btree (membership_id, season_id)`
- `tournament_season_member_assignments_pkey`: `CREATE UNIQUE INDEX tournament_season_member_assignments_pkey ON public.tournament_season_member_assignments USING btree (id)`
- `tournament_season_member_assignments_scope_idx`: `CREATE INDEX tournament_season_member_assignments_scope_idx ON public.tournament_season_member_assignments USING btree (organization_id, season_id, membership_id)`
- `tournament_season_member_assignments_unique`: `CREATE UNIQUE INDEX tournament_season_member_assignments_unique ON public.tournament_season_member_assignments USING btree (season_id, membership_id)`
- `tournament_season_plan_grant_events_current_idx`: `CREATE INDEX tournament_season_plan_grant_events_current_idx ON public.tournament_season_plan_grant_events USING btree (season_grant_id, id DESC)`
- `tournament_season_plan_grant_events_origin_unique`: `CREATE UNIQUE INDEX tournament_season_plan_grant_events_origin_unique ON public.tournament_season_plan_grant_events USING btree (origin_tournament_grant_event_id)`
- `tournament_season_plan_grant_events_pkey`: `CREATE UNIQUE INDEX tournament_season_plan_grant_events_pkey ON public.tournament_season_plan_grant_events USING btree (id)`
- `tournament_season_plan_grant_events_purchase_idx`: `CREATE INDEX tournament_season_plan_grant_events_purchase_idx ON public.tournament_season_plan_grant_events USING btree (purchase_id, id DESC) WHERE (purchase_id IS NOT NULL)`
- `tournament_season_plan_grants_origin_purchase_unique`: `CREATE UNIQUE INDEX tournament_season_plan_grants_origin_purchase_unique ON public.tournament_season_plan_grants USING btree (origin_purchase_id)`
- `tournament_season_plan_grants_origin_tournament_unique`: `CREATE UNIQUE INDEX tournament_season_plan_grants_origin_tournament_unique ON public.tournament_season_plan_grants USING btree (origin_tournament_grant_id)`
- `tournament_season_plan_grants_pkey`: `CREATE UNIQUE INDEX tournament_season_plan_grants_pkey ON public.tournament_season_plan_grants USING btree (id)`
- `tournament_season_plan_grants_resolution_idx`: `CREATE INDEX tournament_season_plan_grants_resolution_idx ON public.tournament_season_plan_grants USING btree (organization_id, season_id, granted_at, id)`
- `tournament_season_plan_grants_season_fk_idx`: `CREATE INDEX tournament_season_plan_grants_season_fk_idx ON public.tournament_season_plan_grants USING btree (season_id)`
- `tournament_seasons_creation_unique`: `CREATE UNIQUE INDEX tournament_seasons_creation_unique ON public.tournament_seasons USING btree (organization_id, created_by, creation_key)`
- `tournament_seasons_org_id_unique`: `CREATE UNIQUE INDEX tournament_seasons_org_id_unique ON public.tournament_seasons USING btree (organization_id, id)`
- `tournament_seasons_org_status_idx`: `CREATE INDEX tournament_seasons_org_status_idx ON public.tournament_seasons USING btree (organization_id, status, updated_at DESC)`
- `tournament_seasons_pkey`: `CREATE UNIQUE INDEX tournament_seasons_pkey ON public.tournament_seasons USING btree (id)`
- `tournament_seasons_slug_unique`: `CREATE UNIQUE INDEX tournament_seasons_slug_unique ON public.tournament_seasons USING btree (organization_id, slug)`
- `tournament_social_permissions_pkey`: `CREATE UNIQUE INDEX tournament_social_permissions_pkey ON public.tournament_social_permissions USING btree (organization_id, user_id)`
- `tournament_sport_modalities_name_key`: `CREATE UNIQUE INDEX tournament_sport_modalities_name_key ON public.tournament_sport_modalities USING btree (name)`
- `tournament_sport_modalities_pkey`: `CREATE UNIQUE INDEX tournament_sport_modalities_pkey ON public.tournament_sport_modalities USING btree (code)`
- `tournament_standings_revisions_context_idx`: `CREATE INDEX tournament_standings_revisions_context_idx ON public.tournament_standings_revisions USING btree (organization_id, tournament_id, category_id, phase_id, group_id, revision_number DESC)`
- `tournament_standings_revisions_draft_unique`: `CREATE UNIQUE INDEX tournament_standings_revisions_draft_unique ON public.tournament_standings_revisions USING btree (fixture_version_id, phase_id, COALESCE(group_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE (status = 'draft'::text)`
- `tournament_standings_revisions_idempotency_unique`: `CREATE UNIQUE INDEX tournament_standings_revisions_idempotency_unique ON public.tournament_standings_revisions USING btree (organization_id, calculated_by, idempotency_key)`
- `tournament_standings_revisions_number_unique`: `CREATE UNIQUE INDEX tournament_standings_revisions_number_unique ON public.tournament_standings_revisions USING btree (fixture_version_id, phase_id, group_id, revision_number) NULLS NOT DISTINCT`
- `tournament_standings_revisions_org_id_unique`: `CREATE UNIQUE INDEX tournament_standings_revisions_org_id_unique ON public.tournament_standings_revisions USING btree (organization_id, id)`
- `tournament_standings_revisions_pkey`: `CREATE UNIQUE INDEX tournament_standings_revisions_pkey ON public.tournament_standings_revisions USING btree (id)`
- `tournament_standings_revisions_published_unique`: `CREATE UNIQUE INDEX tournament_standings_revisions_published_unique ON public.tournament_standings_revisions USING btree (fixture_version_id, phase_id, COALESCE(group_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE (status = 'published'::text)`
- `tournament_standings_revisions_scope_unique`: `CREATE UNIQUE INDEX tournament_standings_revisions_scope_unique ON public.tournament_standings_revisions USING btree (organization_id, tournament_id, category_id, fixture_version_id, id)`
- `tournament_suspension_served_matches_pkey`: `CREATE UNIQUE INDEX tournament_suspension_served_matches_pkey ON public.tournament_suspension_served_matches USING btree (suspension_id, match_id)`
- `tournament_team_entries_category_status_idx`: `CREATE INDEX tournament_team_entries_category_status_idx ON public.tournament_team_entries USING btree (category_id, status, name)`
- `tournament_team_entries_idempotency_unique`: `CREATE UNIQUE INDEX tournament_team_entries_idempotency_unique ON public.tournament_team_entries USING btree (organization_id, created_by, idempotency_key)`
- `tournament_team_entries_linked_active_unique`: `CREATE UNIQUE INDEX tournament_team_entries_linked_active_unique ON public.tournament_team_entries USING btree (tournament_id, category_id, arma2_team_id) WHERE ((arma2_team_id IS NOT NULL) AND (status <> ALL (ARRAY['withdrawn'::text, 'archived'::text, 'rejected'::text])))`
- `tournament_team_entries_org_id_unique`: `CREATE UNIQUE INDEX tournament_team_entries_org_id_unique ON public.tournament_team_entries USING btree (organization_id, id)`
- `tournament_team_entries_org_tournament_id_unique`: `CREATE UNIQUE INDEX tournament_team_entries_org_tournament_id_unique ON public.tournament_team_entries USING btree (organization_id, tournament_id, id)`
- `tournament_team_entries_pkey`: `CREATE UNIQUE INDEX tournament_team_entries_pkey ON public.tournament_team_entries USING btree (id)`
- `tournament_team_entries_tournament_status_idx`: `CREATE INDEX tournament_team_entries_tournament_status_idx ON public.tournament_team_entries USING btree (tournament_id, status, updated_at DESC)`
- `tournament_team_invitations_email_pending_idx`: `CREATE INDEX tournament_team_invitations_email_pending_idx ON public.tournament_team_invitations USING btree (email_normalized, expires_at) WHERE (status = 'pending'::text)`
- `tournament_team_invitations_entry_status_idx`: `CREATE INDEX tournament_team_invitations_entry_status_idx ON public.tournament_team_invitations USING btree (team_entry_id, status, created_at DESC)`
- `tournament_team_invitations_pkey`: `CREATE UNIQUE INDEX tournament_team_invitations_pkey ON public.tournament_team_invitations USING btree (id)`
- `tournament_team_invitations_token_hash_key`: `CREATE UNIQUE INDEX tournament_team_invitations_token_hash_key ON public.tournament_team_invitations USING btree (token_hash)`
- `tournament_team_managers_active_email_unique`: `CREATE UNIQUE INDEX tournament_team_managers_active_email_unique ON public.tournament_team_managers USING btree (team_entry_id, email_normalized) WHERE ((email_normalized IS NOT NULL) AND (status <> 'revoked'::text))`
- `tournament_team_managers_active_user_unique`: `CREATE UNIQUE INDEX tournament_team_managers_active_user_unique ON public.tournament_team_managers USING btree (team_entry_id, user_id) WHERE ((user_id IS NOT NULL) AND (status <> 'revoked'::text))`
- `tournament_team_managers_pkey`: `CREATE UNIQUE INDEX tournament_team_managers_pkey ON public.tournament_team_managers USING btree (id)`
- `tournament_team_managers_scope_unique`: `CREATE UNIQUE INDEX tournament_team_managers_scope_unique ON public.tournament_team_managers USING btree (organization_id, team_entry_id, id)`
- `tournament_team_managers_user_status_idx`: `CREATE INDEX tournament_team_managers_user_status_idx ON public.tournament_team_managers USING btree (user_id, status, team_entry_id)`
- `tournament_team_photos_entry_idx`: `CREATE INDEX tournament_team_photos_entry_idx ON public.tournament_team_photos USING btree (organization_id, team_entry_id, created_at DESC)`
- `tournament_team_photos_moderation_idx`: `CREATE INDEX tournament_team_photos_moderation_idx ON public.tournament_team_photos USING btree (organization_id, tournament_id, editorial_status, lifecycle_status)`
- `tournament_team_photos_object_unique`: `CREATE UNIQUE INDEX tournament_team_photos_object_unique ON public.tournament_team_photos USING btree (bucket, object_path)`
- `tournament_team_photos_one_candidate_idx`: `CREATE UNIQUE INDEX tournament_team_photos_one_candidate_idx ON public.tournament_team_photos USING btree (team_entry_id) WHERE ((lifecycle_status = 'active'::text) AND (editorial_status = ANY (ARRAY['pending_review'::text, 'rejected'::text])))`
- `tournament_team_photos_one_current_idx`: `CREATE UNIQUE INDEX tournament_team_photos_one_current_idx ON public.tournament_team_photos USING btree (team_entry_id) WHERE ((lifecycle_status = 'active'::text) AND (editorial_status = 'approved'::text))`
- `tournament_team_photos_org_id_unique`: `CREATE UNIQUE INDEX tournament_team_photos_org_id_unique ON public.tournament_team_photos USING btree (organization_id, id)`
- `tournament_team_photos_pkey`: `CREATE UNIQUE INDEX tournament_team_photos_pkey ON public.tournament_team_photos USING btree (id)`
- `tournament_team_reviews_entry_created_idx`: `CREATE INDEX tournament_team_reviews_entry_created_idx ON public.tournament_team_reviews USING btree (team_entry_id, created_at DESC)`
- `tournament_team_reviews_pkey`: `CREATE UNIQUE INDEX tournament_team_reviews_pkey ON public.tournament_team_reviews USING btree (id)`
- `tournament_team_standings_pkey`: `CREATE UNIQUE INDEX tournament_team_standings_pkey ON public.tournament_team_standings USING btree (id)`
- `tournament_team_standings_revision_participant_unique`: `CREATE UNIQUE INDEX tournament_team_standings_revision_participant_unique ON public.tournament_team_standings USING btree (revision_id, participant_id)`
- `tournament_team_standings_revision_position_unique`: `CREATE UNIQUE INDEX tournament_team_standings_revision_position_unique ON public.tournament_team_standings USING btree (revision_id, "position")`
- `tournament_team_standings_table_idx`: `CREATE INDEX tournament_team_standings_table_idx ON public.tournament_team_standings USING btree (revision_id, "position", participant_id)`
- `tournament_team_statistics_pkey`: `CREATE UNIQUE INDEX tournament_team_statistics_pkey ON public.tournament_team_statistics USING btree (revision_id, participant_id)`
- `tournament_tiebreak_rules_criterion_unique`: `CREATE UNIQUE INDEX tournament_tiebreak_rules_criterion_unique ON public.tournament_tiebreak_rules USING btree (tournament_id, criterion)`
- `tournament_tiebreak_rules_order_idx`: `CREATE INDEX tournament_tiebreak_rules_order_idx ON public.tournament_tiebreak_rules USING btree (tournament_id, sort_order)`
- `tournament_tiebreak_rules_order_unique`: `CREATE UNIQUE INDEX tournament_tiebreak_rules_order_unique ON public.tournament_tiebreak_rules USING btree (tournament_id, sort_order)`
- `tournament_tiebreak_rules_pkey`: `CREATE UNIQUE INDEX tournament_tiebreak_rules_pkey ON public.tournament_tiebreak_rules USING btree (id)`
- `tournament_venues_org_status_idx`: `CREATE INDEX tournament_venues_org_status_idx ON public.tournament_venues USING btree (organization_id, status, name)`
- `tournament_venues_pkey`: `CREATE UNIQUE INDEX tournament_venues_pkey ON public.tournament_venues USING btree (id)`
- `tournament_venues_scope_unique`: `CREATE UNIQUE INDEX tournament_venues_scope_unique ON public.tournament_venues USING btree (organization_id, id)`
- `tournaments_creation_unique`: `CREATE UNIQUE INDEX tournaments_creation_unique ON public.tournaments USING btree (organization_id, created_by, creation_key)`
- `tournaments_org_id_season_unique`: `CREATE UNIQUE INDEX tournaments_org_id_season_unique ON public.tournaments USING btree (organization_id, id, season_id)`
- `tournaments_org_id_unique`: `CREATE UNIQUE INDEX tournaments_org_id_unique ON public.tournaments USING btree (organization_id, id)`
- `tournaments_org_season_status_idx`: `CREATE INDEX tournaments_org_season_status_idx ON public.tournaments USING btree (organization_id, season_id, status, updated_at DESC)`
- `tournaments_pkey`: `CREATE UNIQUE INDEX tournaments_pkey ON public.tournaments USING btree (id)`
- `tournaments_slug_unique`: `CREATE UNIQUE INDEX tournaments_slug_unique ON public.tournaments USING btree (season_id, slug)`
- `user_tournament_context_active_season_idx`: `CREATE INDEX user_tournament_context_active_season_idx ON public.user_tournament_context_preferences USING btree (active_season_id) WHERE (active_season_id IS NOT NULL)`
- `user_tournament_context_active_tournament_idx`: `CREATE INDEX user_tournament_context_active_tournament_idx ON public.user_tournament_context_preferences USING btree (active_tournament_id) WHERE (active_tournament_id IS NOT NULL)`
- `user_tournament_context_preferences_pkey`: `CREATE UNIQUE INDEX user_tournament_context_preferences_pkey ON public.user_tournament_context_preferences USING btree (user_id, organization_id)`
- `user_workspace_preferences_active_org_idx`: `CREATE INDEX user_workspace_preferences_active_org_idx ON public.user_workspace_preferences USING btree (active_organization_id) WHERE (active_organization_id IS NOT NULL)`
- `user_workspace_preferences_pkey`: `CREATE UNIQUE INDEX user_workspace_preferences_pkey ON public.user_workspace_preferences USING btree (user_id)`
