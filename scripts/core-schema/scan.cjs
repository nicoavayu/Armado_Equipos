// Static scan of a src/ tree for Core reads/writes, checked against a schema fixture
// (src/__tests__/fixtures/core-production-schema.json). Used by
// src/__tests__/coreProductionSchemaCompat.test.js and by scripts/core-schema/preexisting.cjs.
const fs = require('fs');
const path = require('path');

const sourceFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
  return /\.(js|jsx|ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
});

// Drop embedded resources ("rel(...)", "alias:rel!fk(...)", nested), keeping the table's own columns.
const withoutEmbeds = (text) => {
  let out = '';
  let depth = 0;
  for (const ch of text) {
    if (ch === '(') {
      if (depth === 0) out = out.replace(/[\w!:.]+\s*$/, '');
      depth += 1;
    } else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out;
};

// String constants a select may use: NAME = '...' / "..." / `...` (no ${}) / [ '...', ... ].join(', ').
const collectConstants = (files) => {
  const constants = new Map();
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:const|let|var)\s+([A-Z][A-Z0-9_]*)\s*=\s*(['"`])([^'"`$]*)\2/g)) constants.set(m[1], m[3]);
    for (const m of src.matchAll(/(?:const|let|var)\s+([A-Z][A-Z0-9_]*)\s*=\s*\[([^\]]*)\]\s*\.join\(\s*(['"`])[^'"`]*\3\s*\)/g)) {
      constants.set(m[1], Array.from(m[2].matchAll(/['"`]([^'"`]*)['"`]/g), (x) => x[1]).join(', '));
    }
  }
  return constants;
};

const selectColumns = (list) => withoutEmbeds(list.replace(/\$\{[^}]*\}/g, ''))
  .split(',')
  .map((part) => part.trim())
  .filter((part) => part && !part.includes('*') && !part.includes('.'))
  .map((part) => part.split(':').pop().split('::')[0].replace(/!inner$/, '').trim())
  .filter((part) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(part));

/**
 * @param {string} srcDir the src/ directory to scan
 * @param {{ tables: Record<string, string[]>, functions: string[] }} schema
 * @param {Set<string>} [knownRpcs] RPC names to accept although the schema lacks them
 * @returns {string[]} "src/<file> table.column" | "src/<file> table:<name>" | "src/<file> rpc:<name>"
 */
function scan(srcDir, schema, knownRpcs = new Set()) {
  const tables = new Map(Object.entries(schema.tables).map(([t, cols]) => [t, new Set(cols)]));
  const functions = new Set(schema.functions);
  const root = path.dirname(srcDir);
  const problems = [];
  const files = sourceFiles(srcDir);
  const constants = collectConstants(files);
  const expand = (text) => text.replace(/\$\{\s*([A-Z][A-Z0-9_]*)\s*\}/g, (all, name) => (constants.has(name) ? constants.get(name) : all));
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\.from\(\s*['"]([a-zA-Z_0-9]+)['"]\s*\)/g)) {
      const table = m[1];
      if (!tables.has(table)) { problems.push(`${rel} table:${table}`); continue; }
      const rest = src.slice(m.index + m[0].length, m.index + 900);
      const chain = rest.split(/;\s*\n|\n\s*\n|\.from\(/)[0];
      const used = new Set();
      for (const s of chain.matchAll(/\.select\(\s*(['"`])([\s\S]*?)\1/g)) selectColumns(expand(s[2])).forEach((c) => used.add(c));
      for (const s of chain.matchAll(/\.select\(\s*([A-Z][A-Z0-9_]*)\s*[,)]/g)) {
        if (constants.has(s[1])) selectColumns(constants.get(s[1])).forEach((c) => used.add(c));
      }
      for (const f of chain.matchAll(/\.(?:eq|neq|in|is|gt|gte|lt|lte|order|like|ilike|contains|not)\(\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]/g)) used.add(f[1]);
      for (const column of used) if (!tables.get(table).has(column)) problems.push(`${rel} ${table}.${column}`);
    }
    for (const m of src.matchAll(/\.rpc\(\s*['"]([a-zA-Z_0-9]+)['"]/g)) {
      if (!functions.has(m[1]) && !knownRpcs.has(m[1])) problems.push(`${rel} rpc:${m[1]}`);
    }
    // rpcWithLegacyName(client, 'name', 'legacyName', …): works if either name exists.
    for (const m of src.matchAll(/rpcWithLegacyName\(\s*[a-zA-Z_$][\w$]*\s*,\s*['"]([a-zA-Z_0-9]+)['"]\s*,\s*['"]([a-zA-Z_0-9]+)['"]/g)) {
      const exists = (name) => functions.has(name) || knownRpcs.has(name);
      if (!exists(m[1]) && !exists(m[2])) problems.push(`${rel} rpc:${m[1]}|${m[2]}`);
    }
  }
  return Array.from(new Set(problems)).sort();
}

module.exports = { scan, selectColumns };
