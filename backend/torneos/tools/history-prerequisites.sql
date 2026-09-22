-- Reference-only structural substitutes. Never part of the isolated baseline.
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects(id uuid PRIMARY KEY, bucket_id text, name text, owner uuid, metadata jsonb);
CREATE TABLE IF NOT EXISTS "public"."usuarios" (
    "id" "uuid" NOT NULL,
    "nombre" "text",
    "email" "text",
    "avatar_url" "text",
    "telefono" "text",
    "ciudad" "text",
    "localidad" "text",
    "posicion" "text",
    "ranking" numeric DEFAULT 5.0 NOT NULL,
    "partidos_jugados" integer DEFAULT 0 NOT NULL,
    "partidos_ganados" integer DEFAULT 0 NOT NULL,
    "partidos_perdidos" integer DEFAULT 0 NOT NULL,
    "partidos_empatados" integer DEFAULT 0 NOT NULL,
    "partidos_abandonados" integer DEFAULT 0 NOT NULL,
    "mvps" integer DEFAULT 0 NOT NULL,
    "guantes_dorados" integer DEFAULT 0 NOT NULL,
    "tarjetas_rojas" integer DEFAULT 0 NOT NULL,
    "acepta_invitaciones" boolean DEFAULT true NOT NULL,
    "perfil_completo" boolean DEFAULT false NOT NULL,
    "profile_completion" integer DEFAULT 0 NOT NULL,
    "latitud" double precision,
    "longitud" double precision,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "avatar_zoom" numeric DEFAULT 1,
    "avatar_pos_x" integer DEFAULT 50,
    "avatar_pos_y" integer DEFAULT 50,
    "push_enabled" boolean DEFAULT true NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "last_seen_partido_id" bigint,
    "last_seen_at" timestamp with time zone,
    "pierna_habil" "text",
    "nivel" integer,
    "location_accuracy_m" double precision,
    "location_updated_at" timestamp with time zone,
    "location_label" "text",
    "location_city" "text",
    "location_state" "text",
    "location_country" "text",
    "posiciones" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "disponible_arquero" boolean DEFAULT false NOT NULL,
    CONSTRAINT "usuarios_latitud_range_check" CHECK ((("latitud" IS NULL) OR (("latitud" >= ('-90'::integer)::double precision) AND ("latitud" <= (90)::double precision)))),
    CONSTRAINT "usuarios_latlng_not_zero_zero_check" CHECK ((("latitud" IS NULL) OR ("longitud" IS NULL) OR (NOT (("abs"("latitud") < (0.0001)::double precision) AND ("abs"("longitud") < (0.0001)::double precision))))),
    CONSTRAINT "usuarios_longitud_range_check" CHECK ((("longitud" IS NULL) OR (("longitud" >= ('-180'::integer)::double precision) AND ("longitud" <= (180)::double precision)))),
    CONSTRAINT "usuarios_nivel_check" CHECK ((("nivel" IS NULL) OR (("nivel" >= 1) AND ("nivel" <= 5)))),
    CONSTRAINT "usuarios_pierna_habil_check" CHECK ((("pierna_habil" IS NULL) OR ("pierna_habil" = ANY (ARRAY['right'::"text", 'left'::"text", 'both'::"text"])))),
    CONSTRAINT "usuarios_posiciones_max_two_check" CHECK (("cardinality"(COALESCE("posiciones", '{}'::"text"[])) <= 2)),
    CONSTRAINT "usuarios_posiciones_valid_values_check" CHECK ((COALESCE("posiciones", '{}'::"text"[]) <@ ARRAY['ARQ'::"text", 'DEF'::"text", 'MED'::"text", 'DEL'::"text"])),
    CONSTRAINT "usuarios_ranking_max_five_check" CHECK ((("ranking" IS NULL) OR ("ranking" <= 5.0)))
);
CREATE TABLE IF NOT EXISTS "public"."jugadores" (
    "id" bigint NOT NULL,
    "uuid" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "match_ref" "uuid",
    "partido_id" bigint NOT NULL,
    "usuario_id" "uuid",
    "nombre" "text",
    "avatar_url" "text",
    "score" numeric DEFAULT 5 NOT NULL,
    "is_goalkeeper" boolean DEFAULT false NOT NULL,
    "titular" boolean DEFAULT true NOT NULL,
    "posicion" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_substitute" boolean DEFAULT false NOT NULL,
    "substitute_order" smallint
);
CREATE TABLE IF NOT EXISTS "public"."teams" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_user_id" "uuid",
    "name" "text" NOT NULL,
    "format" smallint NOT NULL,
    "base_zone" "text",
    "skill_level" "text" DEFAULT 'sin_definir'::"text" NOT NULL,
    "crest_url" "text",
    "color_primary" "text",
    "color_secondary" "text",
    "color_accent" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "mode" "text" DEFAULT 'Masculino'::"text" NOT NULL,
    "max_roster_size" smallint,
    "country_code" character(2) DEFAULT 'AR'::"bpchar" NOT NULL,
    CONSTRAINT "teams_color_accent_hex_check" CHECK ((("color_accent" IS NULL) OR ("color_accent" ~* '^#([0-9a-f]{6})$'::"text"))),
    CONSTRAINT "teams_color_primary_hex_check" CHECK ((("color_primary" IS NULL) OR ("color_primary" ~* '^#([0-9a-f]{6})$'::"text"))),
    CONSTRAINT "teams_color_secondary_hex_check" CHECK ((("color_secondary" IS NULL) OR ("color_secondary" ~* '^#([0-9a-f]{6})$'::"text"))),
    CONSTRAINT "teams_country_code_check" CHECK (("country_code" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "teams_format_check" CHECK (("format" = ANY (ARRAY[5, 6, 7, 8, 9, 11]))),
    CONSTRAINT "teams_max_roster_size_check" CHECK ((("max_roster_size" IS NULL) OR (("max_roster_size" >= 2) AND ("max_roster_size" <= 40)))),
    CONSTRAINT "teams_mode_check" CHECK (("mode" = ANY (ARRAY['Masculino'::"text", 'Femenino'::"text", 'Mixto'::"text"]))),
    CONSTRAINT "teams_name_not_blank_check" CHECK (("char_length"("btrim"("name")) > 0)),
    CONSTRAINT "teams_skill_level_check" CHECK (("skill_level" = ANY (ARRAY['sin_definir'::"text", 'inicial'::"text", 'intermedio'::"text", 'competitivo'::"text", 'avanzado'::"text", 'elite'::"text"])))
);
CREATE TABLE IF NOT EXISTS "public"."team_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "team_id" "uuid" NOT NULL,
    "jugador_id" bigint NOT NULL,
    "role" "text" DEFAULT 'player'::"text" NOT NULL,
    "is_captain" boolean DEFAULT false NOT NULL,
    "shirt_number" smallint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "photo_url" "text",
    "user_id" "uuid",
    "permissions_role" "text" DEFAULT 'member'::"text" NOT NULL,
    CONSTRAINT "team_members_permissions_role_check" CHECK (("permissions_role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'member'::"text"]))),
    CONSTRAINT "team_members_role_check" CHECK (("role" = ANY (ARRAY['gk'::"text", 'rb'::"text", 'cb'::"text", 'lb'::"text", 'dm'::"text", 'cm'::"text", 'am'::"text", 'rw'::"text", 'lw'::"text", 'st'::"text", 'defender'::"text", 'mid'::"text", 'forward'::"text", 'player'::"text"]))),
    CONSTRAINT "team_members_shirt_number_check" CHECK ((("shirt_number" IS NULL) OR (("shirt_number" >= 0) AND ("shirt_number" <= 99))))
);
ALTER TABLE public.teams ADD PRIMARY KEY (id);
CREATE FUNCTION public.team_user_is_admin_or_owner(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
