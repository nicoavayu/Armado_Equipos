const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Stage B locks notifications INSERT to `user_id = auth.uid()` (self only), so
// every remaining client-side `from('notifications').insert(...)` MUST be one of:
//   self          — inserts a row for the current user (survives self-only policy)
//   routed         — replaced by the create_notification RPC per recipient
//   routed-helper  — the create_notification fallback inside insertNotificationSecure
//   rpc-primary    — a DEFINER RPC is the primary; direct insert only if RPC missing
//   dead           — unreachable (no callers)
//   dev-only       — disabled in production behind a flag
//   dev-canonical  — superseded by the DB cron fanout when SURVEY_FANOUT_MODE=db
//
// Each such site must carry a `// SEC: <category>` marker within the 6 lines
// preceding the insert. A NEW, unannotated cross-user insert fails this test —
// that is the mechanical guarantee of "zero Stage-B-incompatible call sites".

const SAFE_CATEGORIES = new Set([
  'self', 'routed', 'routed-helper', 'rpc-primary', 'dead', 'dev-only', 'dev-canonical',
]);

const repoRoot = path.join(__dirname, '..', '..');

const listFiles = () =>
  execSync("grep -rl \"from('notifications')\" src", { cwd: repoRoot, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter((f) => !f.includes('__tests__'));

const findInsertSites = () => {
  const sites = [];
  for (const file of listFiles()) {
    const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    const lines = source.split('\n');
    const re = /from\(\s*["']notifications["']\s*\)([\s\S]{0,160})/g;
    let m;
    while ((m = re.exec(source))) {
      if (!/^\s*\.insert\(/.test(m[1])) continue; // reads/updates are irrelevant
      const lineNo = source.slice(0, m.index).split('\n').length;
      const ctx = lines.slice(Math.max(0, lineNo - 7), lineNo).join('\n');
      const cat = (ctx.match(/\/\/ SEC:\s*([a-z-]+)/) || [])[1] || null;
      sites.push({ file, lineNo, cat });
    }
  }
  return sites;
};

describe('notifications insert guard — zero Stage-B-incompatible call sites', () => {
  const sites = findInsertSites();

  test('every notifications.insert is classified with a // SEC: marker', () => {
    const unannotated = sites.filter((s) => !s.cat);
    if (unannotated.length) {
      const list = unannotated.map((s) => `${s.file}:${s.lineNo}`).join('\n');
      throw new Error(
        `Unclassified notifications.insert site(s) — add a "// SEC: <category>" marker:\n${list}`,
      );
    }
    expect(unannotated).toHaveLength(0);
  });

  test('every marker uses a known-safe category', () => {
    const bad = sites.filter((s) => s.cat && !SAFE_CATEGORIES.has(s.cat));
    expect(bad.map((s) => `${s.file}:${s.lineNo} [${s.cat}]`)).toEqual([]);
  });

  test('there is at least the expected coverage (sanity: catalogue is non-empty)', () => {
    // Guards against the scanner silently matching nothing (e.g. refactor of the
    // supabase call shape) which would make the test vacuously pass.
    expect(sites.length).toBeGreaterThanOrEqual(10);
  });
});
