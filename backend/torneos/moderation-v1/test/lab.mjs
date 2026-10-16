// CONTENT MODERATION 0022 lab: the commerce-production disposable PostgreSQL (its own container per checkout, named by
// COMMERCE_PRODUCTION_LAB_CONTAINER; never the shared lab), migrated 0000 → 0019 as the lab installer and then given
// Production's topology — every public/private object owned by `postgres`, the hosted installer, which is NOT a superuser
// (same emulation as sponsors-v1 and commerce-production/rollback-0013-hosted-installer.test.mjs). 0022 and its rollback are
// applied by db-0022.mjs's own run() as `postgres`, exactly as the operator would, with the same read-only catalog.
//
// Docker address pools may be exhausted on a busy host: create the lab network first with an explicit subnet
// (`docker network create --subnet 10.233.60.0/24 <container>-net`); pg-lab.mjs reuses an existing network.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

process.env.COMMERCE_PRODUCTION_LAB_CONTAINER ||= 'arma2-moderation-lab-db';
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const lab = await import('../../commerce-production/lab/pg-lab.mjs');
export const F = await import('../../commerce-production/lab/fixtures.mjs');
export const D = await import('../remote/db-0022.mjs');
export const CATALOG = fs.readFileSync(path.join(HERE, '../remote/sql-catalog-0022.sql'), 'utf8').trim();

export const one = (q) => lab.sql(q).trim();
export const asPostgres = (text) => { const r = lab.sqlTry(text, { user: 'postgres' }); return { code: r.ok ? 0 : 3, stderr_tail: r.error ?? '' }; };
/** The driver's dependencies on the lab: the catalog read inside a READ ONLY transaction, writes as the installer. */
export const deps = {
  readFile: (p) => fs.readFileSync(p),
  catalog: async () => JSON.parse(lab.sql(`BEGIN TRANSACTION READ ONLY;\nselect (\n${CATALOG}\n)::text;\nROLLBACK;\n`, { user: 'postgres' })
    .trim().split('\n').filter(Boolean).pop()),
  applySql: async (text) => asPostgres(text),
  readOnlySql: async (text) => {
    const r = lab.sqlTry(`BEGIN TRANSACTION READ ONLY;\n${text}\nROLLBACK;\n`, { user: 'postgres' });
    return { code: r.ok ? 0 : 3, stdout: r.out ?? '', stderr_tail: r.error ?? '' };
  },
  writeSql: async (text) => {
    const r = lab.sqlTry(text, { user: 'postgres' });
    return { code: r.ok ? 0 : 3, stdout: r.out ?? '', stderr_tail: r.error ?? '' };
  },
};
export const drive = (mode, { force = false } = {}) => D.run(mode, D.phraseFor(mode, { force }).split(' '), deps);
export const applied = () => one("select to_regclass('public.tournament_content_reports') is not null") === 't';

/** 0000 → 0019, then Production's ownership; 0022 present or not as found (callers decide). */
export async function prepare() {
  await lab.up({ upTo: '00000000000019' });
  lab.sql(`DO $$ DECLARE r record; BEGIN
    FOR r IN SELECT format('ALTER TABLE %I.%I OWNER TO postgres', n.nspname, c.relname) q FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p','v','m','f') AND pg_get_userbyid(c.relowner) <> 'postgres'
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e') LOOP EXECUTE r.q; END LOOP;
    FOR r IN SELECT format('ALTER SEQUENCE %I.%I OWNER TO postgres', n.nspname, c.relname) q FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public','private') AND c.relkind = 'S' AND pg_get_userbyid(c.relowner) <> 'postgres'
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('e','a','i')) LOOP EXECUTE r.q; END LOOP;
    FOR r IN SELECT format('ALTER ROUTINE %s OWNER TO postgres', p.oid::regprocedure) q FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public','private') AND p.prokind IN ('f','p') AND pg_get_userbyid(p.proowner) <> 'postgres'
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e') LOOP EXECUTE r.q; END LOOP;
    FOR r IN SELECT format('ALTER TYPE %I.%I OWNER TO postgres', n.nspname, t.typname) q FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname IN ('public','private') AND t.typtype IN ('e','d') AND pg_get_userbyid(t.typowner) <> 'postgres' LOOP EXECUTE r.q; END LOOP;
    IF (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'private') <> 'postgres' THEN
      EXECUTE 'ALTER SCHEMA private OWNER TO postgres';
    END IF;
  END $$;`);
}

/** Makes sure the lab is at PRE_0022 (a previous run may have left 0022 and rows: discarded, as the lab is disposable). */
export async function toPre() {
  if (!applied()) return;
  const out = await drive('rollback-0022', { force: true });
  if (out.verdict !== 'ROLLBACK_0022_DONE') throw new Error(`lab reset failed: ${JSON.stringify(out)}`);
}
export async function toPost() {
  if (applied()) return;
  const out = await drive('apply-0022');
  if (out.verdict !== 'APPLY_0022_DONE') throw new Error(`lab apply failed: ${JSON.stringify(out)}`);
}

// ───────────────────────────────────────────────────────────────────────────── fictional world
const { asUserJson, identity, lit, admin, RUN } = F;
const key = () => randomUUID();
export const call = (actor, rpc, args) => asUserJson(actor, `select to_jsonb(public.${rpc}(${args}))`);
/** The SQL error token of a statement that must fail as this identity (null when it succeeds). */
export const refused = (actor, rpc, args) => F.refusal(actor, `select public.${rpc}(${args})`);

/**
 * One organization with a published public page, two team entries (one approved with two players), a captain, an
 * admin, a collaborator and an application message. Everything fictional ("Lab …" + a run tag).
 */
export function world(label) {
  const owner = identity(`owner-${label}`);
  const org = F.organization(owner, label);
  const season = F.season(owner, org, label);
  const admin_ = F.member(org, 'admin', [season]);
  const collaborator = F.member(org, 'collaborator', []);
  const t = call(owner, 'create_tournament_with_defaults', `${lit(org)}, ${lit(season)}, ${lit(`Copa ${label} ${RUN}`)}, ${lit(`copa-${label}-${RUN}`)}, null, 'football_5', 'league', 'open', null, null, ${lit(key())}`);
  const tournament = t.id ?? t.tournamentId ?? t.tournament?.id;
  const category = call(owner, 'save_tournament_category', `${lit(org)}, ${lit(tournament)}, null, 'Libre', 'libre', null, null, null, null, null, null, null, 'active'`);
  const categoryId = category?.id ?? category?.categoryId ?? category?.category?.id;
  call(owner, 'change_tournament_status', `${lit(org)}, ${lit(tournament)}, 'registration'`);
  const entryOf = (name, short) => call(owner, 'create_tournament_team_entry', `${lit(org)}, ${lit(tournament)}, ${lit(categoryId)}, null, ${lit(name)}, ${lit(short)}, '#7c3aed', '#facc15', null, null, null, null, ${lit(key())}`);
  const teamName = `Los Insultos ${label} ${RUN}`;
  const entry = entryOf(teamName, 'INS');
  const playerName = `Apodo Ofensivo ${label} ${RUN}`;
  const players = [];
  for (const [i, name] of [playerName, `Jugador Correcto ${label} ${RUN}`].entries()) {
    const provisional = call(owner, 'create_tournament_provisional_player', `${lit(org)}, ${lit(entry.entryId)}, ${lit(name)}`);
    const pid = provisional.id ?? provisional.provisionalPlayerId ?? provisional.playerId;
    players.push(call(owner, 'add_tournament_roster_player', `${lit(org)}, ${lit(entry.entryId)}, ${lit(entry.rosterId)}, null, ${lit(pid)}, ${lit(name)}, null, ${i + 1}::smallint, 'DEL', null, false`));
  }
  // Submitted (not draft) so the public page's tournament knows it; the review is the organizer's.
  admin(`update public.tournament_team_entries set status = 'submitted', submitted_by = ${lit(owner.id)}, submitted_at = now() where id = ${lit(entry.entryId)}`);
  const page = call(owner, 'set_tournament_public_page_published', `${lit(org)}, ${lit(tournament)}, true`);
  return { label, owner, admin: admin_, collaborator, org, season, tournament, categoryId, entry, teamName, playerName, players,
    slug: page.publicSlug };
}

/** An application (as start_tournament_application leaves it) from `applicant` for a new entry of `w`. */
export function application(w, applicant, message = 'Queremos jugar, abrazo') {
  const entry = call(w.owner, 'create_tournament_team_entry', `${lit(w.org)}, ${lit(w.tournament)}, ${lit(w.categoryId)}, null, ${lit(`Solicitantes ${RUN} ${randomUUID().slice(0, 4)}`)}, null, null, null, null, null, null, null, ${lit(key())}`);
  admin(`insert into public.tournament_team_applications (team_entry_id, organization_id, tournament_id, category_id, applicant_user_id, message, accepted_conditions_at)
    values (${lit(entry.entryId)}, ${lit(w.org)}, ${lit(w.tournament)}, ${lit(w.categoryId)}, ${lit(applicant.id)}, ${lit(message)}, now())`);
  return entry.entryId;
}

/** A published announcement with deliveries to `recipients` (rows as publish_tournament_announcement leaves them). */
export function announcement(w, recipients, { type = 'general', title = `Aviso ${RUN}` } = {}) {
  const id = one(`insert into public.tournament_announcements (organization_id, season_id, tournament_id, author_user_id, status,
      announcement_type, title, summary, body, published_at, idempotency_key)
    values (${lit(w.org)}, ${lit(w.season)}, ${lit(w.tournament)}, ${lit(w.owner.id)}, 'published', ${lit(type)}, ${lit(title)},
      'Resumen del aviso', 'Cuerpo del aviso de laboratorio', now(), ${lit(key())}) returning id`).split('\n')[0];
  for (const r of recipients) {
    admin(`insert into public.tournament_announcement_deliveries (organization_id, announcement_id, recipient_user_id, recipient_relation_type)
      values (${lit(w.org)}, ${lit(id)}, ${lit(r.id)}, 'player')`);
  }
  return id;
}

/** Everything 0022 and its rollback could touch outside its own objects: catalog, permissions, data of the neighbours. */
export function snapshot() {
  return JSON.parse(one(`select json_build_object(
    'functions', (select json_agg(json_build_object('sig', p.oid::regprocedure::text, 'md5', md5(p.prosrc), 'acl', p.proacl::text,
      'owner', pg_get_userbyid(p.proowner), 'definer', p.prosecdef, 'config', p.proconfig::text, 'volatile', p.provolatile)
      order by p.oid::regprocedure::text)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private')),
    'relations', (select json_agg(json_build_object('rel', n.nspname||'.'||c.relname, 'kind', c.relkind, 'acl', c.relacl::text,
      'owner', pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity) order by n.nspname, c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public','private','storage') and c.relkind in ('r','v','m','S','p','i')),
    'constraints', (select json_agg(conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid) order by conrelid::regclass::text, conname)
      from pg_constraint where connamespace in ('public'::regnamespace, 'private'::regnamespace)),
    'triggers', (select json_agg(tgrelid::regclass::text||'.'||tgname||':'||tgenabled::text||':'||tgfoid::regprocedure::text order by 1)
      from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
      where not t.tgisinternal and n.nspname in ('public','private')),
    'policies', (select json_agg(schemaname||'.'||tablename||'.'||policyname||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,'')||':'||roles::text
      order by schemaname, tablename, policyname) from pg_policies where schemaname in ('public','private','storage')),
    'schema_acl', (select json_agg(nspname||':'||coalesce(nspacl::text,'') order by nspname) from pg_namespace where nspname in ('public','private')),
    'default_acl', (select json_agg(pg_get_userbyid(defaclrole)||':'||coalesce(defaclnamespace::regnamespace::text,'-')||':'||defaclobjtype::text||':'||defaclacl::text order by 1) from pg_default_acl)
  )::text`));
}
