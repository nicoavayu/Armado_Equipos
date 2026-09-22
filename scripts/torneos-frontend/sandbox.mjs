// Executes real frontend modules (ESM + JSX-free) in one vm sandbox with the SDK
// and the network stubbed. Shared by the foundation, transport and adapter tests.
import path from 'node:path';
import vm from 'node:vm';
import { transformSync } from '@babel/core';
import { read } from './audit.mjs';

export function runtime({ env = {}, globals = {}, modules = {} } = {}) {
  const cache = new Map();
  const creations = [];
  let networkCalls = 0;
  const context = vm.createContext({
    URL,
    URLSearchParams,
    Headers,
    AbortController,
    AbortSignal,
    setTimeout,
    clearTimeout,
    console,
    process: { env },
    fetch: async () => { networkCalls += 1; throw new Error('Network forbidden'); },
    ...globals,
  });
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const code = transformSync(read(file), {
      babelrc: false,
      configFile: false,
      plugins: ['@babel/plugin-transform-modules-commonjs'],
    }).code;
    const require = (specifier) => {
      if (specifier === '@supabase/supabase-js') {
        return {
          createClient(...args) {
            creations.push(args);
            return Object.freeze({ marker: 'Core singleton' });
          },
        };
      }
      if (Object.prototype.hasOwnProperty.call(modules, specifier)) return modules[specifier];
      if (!specifier.startsWith('.')) throw new Error(`Unexpected dependency: ${specifier}`);
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      const target = path.extname(resolved) ? resolved : `${resolved}.js`;
      // A stub keyed by repo path replaces that module (e.g. the Core singleton).
      if (Object.prototype.hasOwnProperty.call(modules, target)) return modules[target];
      return load(target);
    };
    vm.runInContext(`(function(require,module,exports){${code}\n})`, context)(require, module, module.exports);
    return module.exports;
  }
  return { load, creations, networkCalls: () => networkCalls, context };
}
