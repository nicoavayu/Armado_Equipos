import { audit, inspect, resolveImport } from './audit.mjs';

const identity = ({ file, kind, callee, targets, expression, source }) =>
  JSON.stringify({ file, kind, callee, targets, expression, source });
function additions(current, baseline) {
  const remaining = new Map();
  for (const entry of baseline) remaining.set(identity(entry), (remaining.get(identity(entry)) || 0) + 1);
  return current.filter((entry) => {
    const key = identity(entry), count = remaining.get(key) || 0;
    if (count) { remaining.set(key, count - 1); return false; }
    return true;
  });
}
export function boundaryViolations(sources, baseline) {
  const current = audit(sources);
  const violations = [
    ...additions(current.coreDependencies, baseline.coreDependencies).map((e) => `Core dependency: ${e.file} -> ${e.source}`),
    ...Object.entries(current.reachableCallSignatures)
      .filter(([file, hash]) => baseline.reachableCallSignatures[file] !== hash)
      .map(([file]) => `Changed backend access reachable from Torneos: ${file}`),
  ];
  const modules = new Map([...sources].map(([file, source]) => [file, inspect(file, source)]));
  for (const [file, module] of modules) {
    if (!file.includes('/torneos/foundation/')) continue;
    for (const entry of module.imports) {
      const target = resolveImport(file, entry.source, modules);
      if (!target?.startsWith('src/features/torneos/foundation/')) {
        violations.push(`Foundation dependency escapes boundary: ${file} -> ${entry.source}`);
      }
    }
    if (module.strings.some((value) => /^(auth|signInWithPassword|setSession|storage|channel|rpc)$/.test(value))) {
      violations.push(`Indirect backend API: ${file}`);
    }
  }
  return violations;
}
export function frontendLiteralViolations(source) {
  const violations = [];
  if (/service[_-]?role|sb_secret_|SUPABASE_SERVICE|PRIVATE_KEY/i.test(source)) violations.push('Privileged credential');
  if (/https?:\/\/|\b[a-z]{20}\b/.test(source)) violations.push('Hardcoded endpoint/ref');
  for (const token of source.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []) {
    try {
      if (JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).role === 'service_role') {
        violations.push('Privileged JWT');
      }
    } catch { violations.push('Embedded JWT'); }
  }
  return violations;
}
