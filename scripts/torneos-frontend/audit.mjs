import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from '@babel/parser';

export const root = path.resolve(import.meta.dirname, '../..');
export const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
export function filesUnder(directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(file) : [file];
  }).sort();
}
export const isCode = (file) => /\.[cm]?[jt]sx?$/.test(file)
  && !/(__tests__|testUtils|\.test\.|\.spec\.|setupTests)/.test(file);
function walk(node, visit, ancestors = []) {
  if (!node || typeof node !== 'object') return;
  if (node.type) visit(node, ancestors);
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'start', 'end', 'extra', 'comments', 'tokens'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach((item) => walk(item, visit, [...ancestors, node]));
    else if (value && typeof value === 'object') walk(value, visit, [...ancestors, node]);
  }
}
function member(node) {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'StringLiteral') return node.value;
  if (/MemberExpression$/.test(node.type)) return `${member(node.object)}.${member(node.property)}`;
  if (/CallExpression$/.test(node.type)) return member(node.callee);
  return '';
}
export function inspect(file, source) {
  const ast = parse(source, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'] });
  const imports = [], calls = [], strings = [];
  walk(ast, (node, ancestors) => {
    if (node.type === 'StringLiteral' || node.type === 'TemplateElement') {
      strings.push(node.value?.raw ?? node.value);
    }
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) {
      imports.push({ file, line: node.loc.start.line, source: node.source.value });
    }
    if (!/CallExpression$/.test(node.type) && node.type !== 'NewExpression') return;
    const callee = member(node.callee);
    if (node.callee.type === 'Import' || callee === 'require') {
      imports.push({ file, line: node.loc.start.line, source: node.arguments[0]?.value || '<dynamic>' });
    }
    const kind = /\.rpc$/.test(callee) ? 'rpc'
      : /\.from$/.test(callee) && !/^(Array|Buffer|Object)\./.test(callee) ? 'from'
        : /\.auth\.|\b(signIn\w*|signUp|signOut|setSession|refreshSession|startAutoRefresh)$/.test(callee) ? 'auth'
          : /\.storage\./.test(callee) ? 'storage'
            : /\.(channel|subscribe|removeChannel)$/.test(callee) ? 'realtime'
              : /\.functions\.invoke$/.test(callee) ? 'function'
                : /(^|\.)(fetch|fetchImpl|createClient|WebSocket|EventSource|XMLHttpRequest|sendBeacon)$/.test(callee) ? 'transport'
                  : /(^|\.)(localStorage|sessionStorage)\./.test(callee) ? 'persistence' : null;
    if (!kind) return;
    const parentFunction = [...ancestors].reverse().find((a) => /Function/.test(a.type));
    let targets = typeof node.arguments?.[0]?.value === 'string' ? [node.arguments[0].value] : [];
    // The legacy action dispatch selects literal values from a local object.
    if (kind === 'rpc' && !targets.length && node.arguments[0]?.type === 'Identifier' && parentFunction) {
      walk(parentFunction, (candidate) => {
        if (candidate.type === 'VariableDeclarator' && candidate.id.name === node.arguments[0].name
          && candidate.init?.object?.type === 'ObjectExpression') {
          targets = candidate.init.object.properties.map((p) => p.value?.value).filter((v) => typeof v === 'string');
        }
      });
    }
    calls.push({ file, line: node.loc.start.line, kind, callee, targets,
      function: parentFunction?.id?.name || '<callback>',
      expression: source.slice(node.start, node.end).replace(/\s+/g, ' ').trim() });
  });
  return { imports, calls, strings };
}
export function resolveImport(file, specifier, modules) {
  if (!specifier.startsWith('.')) return null;
  const stem = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
  return [stem, ...['.js', '.jsx', '.ts', '.tsx', '/index.js', '/index.jsx'].map((ext) => stem + ext)]
    .find((candidate) => modules.has(candidate)) || null;
}
export function audit(sources) {
  const modules = new Map([...sources].map(([file, source]) => [file, inspect(file, source)]));
  const core = new Set(['src/lib/supabaseClient.js', 'src/lib/coreSupabaseClient.js']);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [file, module] of modules) {
      if (!core.has(file) && module.imports.some((entry) => core.has(resolveImport(file, entry.source, modules)))) {
        core.add(file); changed = true;
      }
    }
  }
  const torneos = [...modules].filter(([file]) => file.startsWith('src/features/torneos/'));
  const reachable = new Set(torneos.map(([file]) => file));
  for (const file of reachable) {
    for (const entry of modules.get(file)?.imports || []) {
      const target = resolveImport(file, entry.source, modules);
      if (target) reachable.add(target);
    }
  }
  return {
    reachableCallSignatures: Object.fromEntries([...reachable].sort().filter((file) => modules.get(file)?.calls.length)
      .map((file) => [file, createHash('sha256').update(JSON.stringify(modules.get(file).calls.map(({line, ...call}) => call))).digest('hex')])),
    directSingletonImports: [...modules.values()].flatMap((m) => m.imports)
      .filter((entry) => resolveImport(entry.file, entry.source, modules) === 'src/lib/supabaseClient.js'),
    coreDependencies: torneos.flatMap(([, m]) => m.imports)
      .filter((entry) => core.has(resolveImport(entry.file, entry.source, modules))),
    calls: torneos.flatMap(([, m]) => m.calls),
  };
}
export const sourceFiles = () => filesUnder('src').filter(isCode);
export const currentSources = () => new Map(sourceFiles().map((file) => [file, read(file)]));

// Read immutable Git objects; never inspect another worktree or load its env files.
export function sourcesAtRevision(revision, execFileSync) {
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', revision, '--', 'src'],
    { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(isCode);
  const output = execFileSync('git', ['cat-file', '--batch'], {
    cwd: root, input: files.map((file) => `${revision}:${file}\n`).join(''), maxBuffer: 64 * 1024 * 1024,
  });
  let offset = 0;
  return new Map(files.map((file) => {
    const end = output.indexOf(10, offset);
    const size = Number(output.subarray(offset, end).toString().split(' ')[2]);
    if (!Number.isFinite(size)) throw new Error(`Missing baseline file: ${file}`);
    const source = output.subarray(end + 1, end + 1 + size).toString();
    offset = end + size + 2;
    return [file, source];
  }));
}
