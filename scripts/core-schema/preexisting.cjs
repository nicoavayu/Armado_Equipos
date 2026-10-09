// Prints the scan problems of a git ref's src/ (e.g. the web live in Production) that the
// working tree still has: the candidates for PREEXISTING in coreProductionSchemaCompat.test.js.
//   node scripts/core-schema/preexisting.cjs <ref>
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scan } = require('./scan.cjs');

const ref = process.argv[2];
if (!ref) { console.error('usage: preexisting.cjs <git ref>'); process.exit(2); }
const repo = path.resolve(__dirname, '..', '..');
const schema = require(path.join(repo, 'src/__tests__/fixtures/core-production-schema.json'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'core-schema-'));
execFileSync('sh', ['-c', `git archive ${ref} src | tar -x -C "${tmp}"`], { cwd: repo });
const before = new Set(scan(path.join(tmp, 'src'), schema));
const now = scan(path.join(repo, 'src'), schema);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(JSON.stringify({ preexisting: now.filter((p) => before.has(p)), introduced: now.filter((p) => !before.has(p)) }, null, 2));
