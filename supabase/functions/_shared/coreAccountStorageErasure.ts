// supabase/functions/_shared/coreAccountStorageErasure.ts
//
// ACCOUNT DELETION — the person's own files in Core Storage. Called by `delete-account` with the id of the session it
// just verified (never a client value) and its service-role client. Plan: PLAN-FOTOS-CORE-Y-APPLE.md §1. Every Core
// bucket is classified in CORE_STORAGE_BUCKETS below (evidence in docs/superpowers/specs/2026-10-15-torneos-account-
// deletion-design.md §2.6). A bucket that is not there is never touched, and a test fails when the repo declares one
// that is not classified.
//
//   jugadores-fotos   every object under `<uid>/…` and every root object `<uid>_…` (the profile photo and its old
//                     versions). Never `guest/…`, never `partido_…`, never another id.
//   avatars           every root object `<uid>_…` (legacy profile photos of the old uploadAvatar). Never another id.
//   team-crests       every object under `<uid>/…` that NO row uses: `teams.crest_url` and `team_members.photo_url` keep
//                     theirs (a crest or a roster photo is part of a team that other people still see).
//   tournament-*      never (organization content of the legacy Torneos-in-Core; Torneos is its own project).
//
// Deletion is by PATH only: an object is never downloaded, opened, rendered or signed (a legacy SVG under the person's
// prefix is removed like any other file). `owner_id` is not a criterion (the Storage list API does not return it): the
// name the app wrote from the session id is.
//
// Guards: the uid must be a lowercase UUID (36 fixed characters, so no other uid can be a prefix of `<uid>/` or
// `<uid>_`); the buckets are fixed here; every path is checked against the prefix right before `remove()` and one
// violation aborts the whole step without removing anything. Deletion goes through the Storage API (never SQL on
// storage.objects: that would orphan the file), in batches of REMOVE_BATCH. Listing is paginated and bounded
// (MAX_OBJECTS per call → `incomplete`; every retry advances, since what was removed is no longer listed). Each Storage
// or database call has a timeout. Idempotent: running it twice gives the same final state.
//
// Never throws. Never logs (the caller logs only the counts and the code: no path, no URL, no user id).

export const PHOTOS_BUCKET = "jugadores-fotos"
export const AVATARS_BUCKET = "avatars"
export const CRESTS_BUCKET = "team-crests"
export const LIST_PAGE = 1000
export const REMOVE_BATCH = 100
export const MAX_OBJECTS = 5000
export const MAX_DEPTH = 8
export const STORAGE_TIMEOUT_MS = 10000
export const REFERENCE_PAGE = 1000

/**
 * How the account deletion treats each Core bucket. `erasure`:
 *   uid_folder_and_uid_underscore  `<uid>/…` (any depth) and root `<uid>_…` (files, and folders named so)
 *   uid_underscore                 root `<uid>_…` only (files, and folders named so)
 *   uid_folder_unreferenced        `<uid>/…` minus what teams.crest_url / team_members.photo_url use (team-crests only)
 *   never                          not touched by the account deletion (the reason says why)
 * scripts/edge-functions/core-account-storage-erasure.test.mjs fails if a bucket declared anywhere in supabase/ is
 * missing here.
 */
export type BucketErasure = "uid_folder_and_uid_underscore" | "uid_underscore" | "uid_folder_unreferenced" | "never"
export type BucketRule = Readonly<{ owner: "person" | "team" | "organization"; erasure: BucketErasure; reason: string }>

export const CORE_STORAGE_BUCKETS: Readonly<Record<string, BucketRule>> = Object.freeze({
  [PHOTOS_BUCKET]: Object.freeze({
    owner: "person",
    erasure: "uid_folder_and_uid_underscore",
    reason: "The person's profile photo and its old versions: `<uid>_<ts>.jpg` (ProfileEditor) and `<uid>/<uuid>.<ext>` "
      + "(uploadFoto). `guest/…` (guest voting, no account) and `partido_…` cannot be attributed: never touched.",
  } as const),
  [AVATARS_BUCKET]: Object.freeze({
    owner: "person",
    erasure: "uid_underscore",
    reason: "Legacy profile photos: the old uploadAvatar wrote `<uid>_<ts>.<ext>` here (removed 2025-07-16, fe13e326). "
      + "No write flow today (public read only, 20260622150000). Prod 2026-10-16: 8 objects, all `<uid>_…`, no orphans.",
  } as const),
  [CRESTS_BUCKET]: Object.freeze({
    owner: "team",
    erasure: "uid_folder_unreferenced",
    reason: "Team crests and roster photos uploaded by whoever edits the team (`<uid>/<team|draft>/…`): what a row still "
      + "uses belongs to the team and stays; drafts and old versions nobody uses are removed.",
  } as const),
  "tournament-branding": Object.freeze({
    owner: "organization",
    erasure: "never",
    reason: "Legacy Torneos-in-Core: organization assets (`<orgId>/…`). Torneos is its own project (#217). Prod 2026-10-16: 0 objects.",
  } as const),
  "tournament-player-portraits": Object.freeze({
    owner: "organization",
    erasure: "never",
    reason: "Legacy Torneos-in-Core, private, service-role only (`organizations/<orgId>/…`). Prod 2026-10-16: 0 objects.",
  } as const),
  "tournament-team-photos": Object.freeze({
    owner: "organization",
    erasure: "never",
    reason: "Legacy Torneos-in-Core, private, service-role only (`organizations/<orgId>/…`). Prod 2026-10-16: 0 objects.",
  } as const),
  "tournament-media": Object.freeze({
    owner: "organization",
    erasure: "never",
    reason: "Never created in Core (the baseline says so; only a contract check and policies name it). Prod 2026-10-16: 0 objects.",
  } as const),
})

/** The rule of a bucket, or null when it is not classified (an unclassified bucket is never touched). */
export function bucketRule(bucket: string): BucketRule | null {
  return Object.prototype.hasOwnProperty.call(CORE_STORAGE_BUCKETS, bucket) ? CORE_STORAGE_BUCKETS[bucket] : null
}

/** The buckets the step erases from, in this order. */
export const ERASED_BUCKETS: readonly string[] = Object.freeze(
  Object.keys(CORE_STORAGE_BUCKETS).filter((bucket) => CORE_STORAGE_BUCKETS[bucket].erasure !== "never"),
)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export type StorageErasureResult = {
  status: "ok" | "incomplete" | "failed"
  removed: number
  keptReferenced: number
  code?: string
}

type ListEntry = { name?: string; id?: string | null }
type ListOptions = { limit: number; offset: number; sortBy: { column: string; order: string }; search?: string }
// deno-lint-ignore no-explicit-any
type Result<T> = { data: T | null; error: any }
export type StorageBucketApi = {
  list(prefix: string, options: ListOptions): Promise<Result<ListEntry[]>>
  remove(paths: string[]): Promise<Result<unknown[]>>
}
export type StorageApi = { from(bucket: string): StorageBucketApi }
// deno-lint-ignore no-explicit-any
export type DbApi = { from(table: string): any }

export type StorageErasureOptions = {
  storage: StorageApi
  db: DbApi
  userId: string
  timeoutMs?: number
  maxObjects?: number
}

class StepError extends Error {
  constructor(readonly code: string) { super(code) }
}

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new StepError("storage_timeout")), ms) }),
  ]).finally(() => clearTimeout(timer))
}

/** The object path inside team-crests that a stored public URL points to (decoded, without query/fragment), or null. */
export function crestPathFromUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url) return null
  const marker = `/${CRESTS_BUCKET}/`
  const at = url.lastIndexOf(marker)
  if (at < 0) return null
  const raw = url.slice(at + marker.length).split(/[?#]/)[0]
  if (!raw) return null
  try { return decodeURIComponent(raw) } catch { return raw }
}

/** true only for a path this step may remove for `uid` in `bucket` (the last check before every remove()). */
export function isOwnPath(bucket: string, uid: string, path: string): boolean {
  if (!UUID_RE.test(uid) || typeof path !== "string") return false
  if (path.split("/").some((segment) => segment === ".." || segment === ".")) return false
  if (path.length <= uid.length + 1) return false
  const inFolder = path.startsWith(`${uid}/`)
  const underscore = path.startsWith(`${uid}_`)
  switch (bucketRule(bucket)?.erasure) {
    case "uid_folder_and_uid_underscore": return inFolder || underscore
    case "uid_underscore": return underscore
    case "uid_folder_unreferenced": return inFolder && bucket === CRESTS_BUCKET
    default: return false
  }
}

type Walk = { found: string[]; cap: number; overflow: boolean; tooDeep: boolean; timeoutMs: number }

async function listPage(api: StorageBucketApi, prefix: string, offset: number, walk: Walk, search?: string): Promise<ListEntry[]> {
  const options: ListOptions = { limit: LIST_PAGE, offset, sortBy: { column: "name", order: "asc" } }
  if (search) options.search = search
  const { data, error } = await withTimeout(api.list(prefix, options), walk.timeoutMs)
  if (error) throw new StepError("storage_list_failed")
  if (!Array.isArray(data)) throw new StepError("storage_list_failed")
  return data
}

/** Every object below `folder` (recursive, paginated, bounded). Folders are the entries without an id. */
async function walkFolder(api: StorageBucketApi, folder: string, depth: number, walk: Walk): Promise<void> {
  if (depth > MAX_DEPTH) { walk.tooDeep = true; return }
  for (let offset = 0; ; offset += LIST_PAGE) {
    const page = await listPage(api, folder, offset, walk)
    for (const entry of page) {
      if (walk.overflow) return
      const name = typeof entry?.name === "string" ? entry.name : ""
      if (!name || name.includes("/")) continue
      const path = `${folder}/${name}`
      if (entry.id === null || entry.id === undefined) await walkFolder(api, path, depth + 1, walk)
      else if (walk.found.length >= walk.cap) walk.overflow = true
      else walk.found.push(path)
    }
    if (page.length < LIST_PAGE || walk.overflow) return
  }
}

/** Root objects (and root folders) named `<uid>_…` (jugadores-fotos, avatars). `search` narrows the listing; the filter is ours. */
async function walkRootUnderscore(api: StorageBucketApi, uid: string, walk: Walk): Promise<void> {
  for (let offset = 0; ; offset += LIST_PAGE) {
    const page = await listPage(api, "", offset, walk, uid)
    for (const entry of page) {
      if (walk.overflow) return
      const name = typeof entry?.name === "string" ? entry.name : ""
      if (!name.startsWith(`${uid}_`) || name.includes("/")) continue
      if (entry.id === null || entry.id === undefined) await walkFolder(api, name, 1, walk)
      else if (walk.found.length >= walk.cap) walk.overflow = true
      else walk.found.push(name)
    }
    if (page.length < LIST_PAGE || walk.overflow) return
  }
}

/** Paths in team-crests/<uid>/ still used by a row (teams.crest_url, team_members.photo_url). Fails closed. */
async function referencedCrests(db: DbApi, uid: string, timeoutMs: number): Promise<Set<string>> {
  const keep = new Set<string>()
  // The uid has neither `_` nor `%`: the pattern has no accidental wildcard.
  const pattern = `%/${CRESTS_BUCKET}/${uid}/%`
  for (const [table, column] of [["teams", "crest_url"], ["team_members", "photo_url"]]) {
    for (let from = 0; ; from += REFERENCE_PAGE) {
      const { data, error } = await withTimeout(
        db.from(table).select(column).ilike(column, pattern).range(from, from + REFERENCE_PAGE - 1),
        timeoutMs,
      ) as Result<Record<string, unknown>[]>
      if (error || !Array.isArray(data)) throw new StepError("storage_references_failed")
      for (const row of data) {
        const path = crestPathFromUrl(row?.[column])
        if (path) keep.add(path)
      }
      if (data.length < REFERENCE_PAGE) break
    }
  }
  return keep
}

async function removeAll(api: StorageBucketApi, paths: string[], timeoutMs: number, done: { removed: number }): Promise<void> {
  for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
    const batch = paths.slice(i, i + REMOVE_BATCH)
    const { data, error } = await withTimeout(api.remove(batch), timeoutMs)
    if (error) throw new StepError("storage_remove_failed")
    done.removed += Array.isArray(data) ? data.length : batch.length
  }
}

/**
 * Deletes the person's own Core Storage objects (see the header). { status: 'ok' } when nothing of theirs is left to
 * delete; 'incomplete' when the bound was hit or a folder was too deep (a retry advances); 'failed' on any error (code).
 */
export async function eraseCoreAccountStorage(options: StorageErasureOptions): Promise<StorageErasureResult> {
  const uid = String(options.userId ?? "")
  const done = { removed: 0 }
  let keptReferenced = 0
  if (!UUID_RE.test(uid)) return { status: "failed", removed: 0, keptReferenced: 0, code: "storage_invalid_user" }
  const timeoutMs = options.timeoutMs ?? STORAGE_TIMEOUT_MS
  const walk: Walk = { found: [], cap: options.maxObjects ?? MAX_OBJECTS, overflow: false, tooDeep: false, timeoutMs }
  try {
    // 1. List every erased bucket (nothing is removed until all of them are listed and the crest references are known).
    const plan: { api: StorageBucketApi; bucket: string; paths: string[] }[] = []
    for (const bucket of ERASED_BUCKETS) {
      if (walk.overflow) break
      const erasure = bucketRule(bucket)?.erasure
      const api = options.storage.from(bucket)
      if (erasure === "uid_folder_and_uid_underscore") {
        await walkFolder(api, uid, 1, walk)
        if (!walk.overflow) await walkRootUnderscore(api, uid, walk)
      } else if (erasure === "uid_underscore") {
        await walkRootUnderscore(api, uid, walk)
      } else if (erasure === "uid_folder_unreferenced" && bucket === CRESTS_BUCKET) {
        await walkFolder(api, uid, 1, walk)
      } else {
        throw new StepError("storage_unclassified_bucket")
      }
      const listed = walk.found.splice(0)
      walk.cap = Math.max(0, walk.cap - listed.length)
      let paths = listed
      if (erasure === "uid_folder_unreferenced" && listed.length) {
        const keep = await referencedCrests(options.db, uid, timeoutMs)
        paths = listed.filter((path) => !keep.has(path))
        keptReferenced += listed.length - paths.length
      }
      plan.push({ api, bucket, paths })
    }

    // 2. The last guard before any remove(): one foreign path aborts everything.
    if (!plan.every(({ bucket, paths }) => paths.every((p) => isOwnPath(bucket, uid, p)))) {
      return { status: "failed", removed: 0, keptReferenced, code: "storage_guard_violation" }
    }

    // 3. Remove, by path only (never a download, never a signed URL).
    for (const { api, paths } of plan) await removeAll(api, paths, timeoutMs, done)

    if (walk.overflow) return { status: "incomplete", removed: done.removed, keptReferenced, code: "storage_too_many_objects" }
    if (walk.tooDeep) return { status: "incomplete", removed: done.removed, keptReferenced, code: "storage_too_deep" }
    return { status: "ok", removed: done.removed, keptReferenced }
  } catch (error) {
    const code = error instanceof StepError ? error.code : "storage_unexpected"
    return { status: "failed", removed: done.removed, keptReferenced, code }
  }
}

/** CORE_ACCOUNT_STORAGE_ERASURE: 'required' (default; fail closed) or 'best_effort' (operator's emergency valve). */
export function storageErasureMode(raw: string | undefined): "required" | "best_effort" {
  return String(raw ?? "").trim().toLowerCase() === "best_effort" ? "best_effort" : "required"
}
