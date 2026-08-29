// Static guard against the class of regression that broke accept-invite:
// a local credential binding gets renamed (anonKey -> anonCredential) and a
// call site keeps referencing the old name. TypeScript would reject it, but
// Edge Functions are shipped straight to Deno without a repo type-check, so the
// free identifier only surfaces at runtime as a ReferenceError -> HTTP 500,
// after the RPC already committed its side effects.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import ts from 'typescript';

const traverse = traverseModule.default ?? traverseModule;

const repoRoot = process.cwd();
const functionsRoot = path.join(repoRoot, 'supabase', 'functions');

// Globals the Deno Edge runtime actually provides. Anything referenced outside
// this list and outside the module's own bindings is an undeclared identifier.
const RUNTIME_GLOBALS = new Set([
  'AbortController', 'AbortSignal', 'Array', 'ArrayBuffer', 'Atomics',
  'BigInt', 'Blob', 'Boolean', 'BroadcastChannel', 'ByteLengthQueuingStrategy',
  'CountQueuingStrategy', 'Crypto', 'CryptoKey', 'DataView', 'Date', 'Deno',
  'DecompressionStream', 'DOMException', 'Error', 'EvalError', 'Event',
  'EventTarget', 'File', 'FileReader', 'FinalizationRegistry', 'FormData',
  'Function', 'Headers', 'Infinity', 'Intl', 'JSON', 'Map', 'Math',
  'MessageChannel', 'MessageEvent', 'MessagePort', 'NaN', 'Number', 'Object',
  'Promise', 'Proxy', 'RangeError', 'ReadableStream', 'ReferenceError',
  'Reflect', 'RegExp', 'Request', 'Response', 'Set', 'SharedArrayBuffer',
  'String', 'SubtleCrypto', 'Symbol', 'SyntaxError', 'TextDecoder',
  'TextEncoder', 'TransformStream', 'TypeError', 'URIError', 'URL',
  'URLSearchParams', 'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array',
  'Int16Array', 'Int32Array', 'Float32Array', 'Float64Array', 'BigInt64Array',
  'BigUint64Array', 'Uint8ClampedArray', 'WeakMap', 'WeakRef', 'WeakSet',
  'WebSocket', 'Worker', 'WritableStream', 'atob', 'btoa', 'clearInterval',
  'clearTimeout', 'console', 'crypto', 'decodeURI', 'decodeURIComponent',
  'encodeURI', 'encodeURIComponent', 'fetch', 'globalThis', 'isFinite',
  'isNaN', 'localStorage', 'navigator', 'parseFloat', 'parseInt',
  'performance', 'process', 'queueMicrotask', 'self', 'sessionStorage',
  'setInterval', 'setTimeout', 'structuredClone', 'undefined',
]);

const functionNames = (await fs.readdir(functionsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name !== '_shared')
  .map((entry) => entry.name)
  .sort();

async function unboundIdentifiers(sourcePath) {
  const source = await fs.readFile(sourcePath, 'utf8');
  // Strip the types first: Babel's scope analysis would otherwise treat type
  // annotations as value references and report every type name as unbound.
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      isolatedModules: true,
    },
  }).outputText;

  const ast = parse(javascript, { sourceType: 'module' });
  let globals = [];
  traverse(ast, {
    Program(programPath) {
      globals = Object.keys(programPath.scope.globals).sort();
      programPath.stop();
    },
  });

  return globals.filter((name) => !RUNTIME_GLOBALS.has(name));
}

test('no Edge Function references an undeclared identifier', async () => {
  // Collect every offender before asserting: failing on the first file would
  // hide the sibling functions that carry the same regression.
  const offenders = {};
  for (const name of [...functionNames, '_shared']) {
    const sourcePath = name === '_shared'
      ? path.join(functionsRoot, '_shared', 'supabaseApiKeys.ts')
      : path.join(functionsRoot, name, 'index.ts');
    const unbound = await unboundIdentifiers(sourcePath);
    if (unbound.length > 0) offenders[name] = unbound;
  }

  assert.deepEqual(offenders, {}, 'Edge Functions reference undeclared identifiers');
});

test('the guard would have caught the renamed accept-invite credential', async () => {
  const regressed = ts.transpileModule(
    [
      'const anonCredential = { key: "sb_publishable_x" };',
      'export function run() { return send({ anonKey }); }',
      'function send(args: unknown) { return args; }',
    ].join('\n'),
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
  ).outputText;

  const ast = parse(regressed, { sourceType: 'module' });
  let globals = [];
  traverse(ast, {
    Program(programPath) {
      globals = Object.keys(programPath.scope.globals);
      programPath.stop();
    },
  });

  assert.ok(globals.includes('anonKey'));
});

test('the immediate push helpers receive the resolved publishable key', async () => {
  // Both user-authenticated functions call push-dispatch-now over raw fetch, so
  // they must forward `anonCredential.key` (the value) rather than the
  // credential object, and must keep the caller's JWT in Authorization.
  const callers = [
    ['accept-invite', 'requestImmediateJoinedPush'],
    ['approve-join-request', 'requestImmediateApprovalPush'],
  ];

  for (const [name, helper] of callers) {
    const source = await fs.readFile(
      path.join(functionsRoot, name, 'index.ts'),
      'utf8',
    );

    const invocation = source.slice(source.indexOf(`await ${helper}({`));
    assert.match(
      invocation,
      /anonKey:\s*anonCredential\.key/,
      `${name} does not forward the resolved publishable key`,
    );
    assert.doesNotMatch(
      invocation,
      /anonKey:\s*anonCredential\s*[,}]/,
      `${name} forwards the credential object instead of its key`,
    );

    const helperBody = source.slice(
      source.indexOf(`async function ${helper}(`),
      source.indexOf(`serve(async (req)`),
    );
    assert.match(
      helperBody,
      /Authorization:\s*authHeader/,
      `${name} does not preserve the caller JWT`,
    );
    assert.match(
      helperBody,
      /apikey:\s*anonKey/,
      `${name} does not send the publishable key through apikey`,
    );
    assert.doesNotMatch(
      helperBody,
      /serviceCredential|serviceKey|SERVICE_ROLE/,
      `${name} leaks a secret key into the push dispatch call`,
    );
  }
});

test('accept-invite never returns a credential in its payload', async () => {
  const source = await fs.readFile(
    path.join(functionsRoot, 'accept-invite', 'index.ts'),
    'utf8',
  );

  for (const [, body] of source.matchAll(/JSON\.stringify\(([\s\S]*?)\),?\s*\{/g)) {
    assert.doesNotMatch(
      body,
      /anonCredential|serviceCredential|anonKey|serviceKey|apikey|Authorization/i,
      'accept-invite serializes credential material into a response',
    );
  }
});
