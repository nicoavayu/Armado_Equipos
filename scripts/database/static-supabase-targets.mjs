const IDENTIFIER = '[A-Za-z_$][\\w$]*';

export const collectStaticStringConstants = (source) => {
  const constants = new Map();
  const declaration = new RegExp(
    `\\b(?:export\\s+)?const\\s+(${IDENTIFIER})\\s*=\\s*(['\"\\x60])([^'\"\\x60]+)\\2\\s*;`,
    'g',
  );

  for (const match of source.matchAll(declaration)) {
    constants.set(match[1], match[3]);
  }
  return constants;
};

export const findStaticSupabaseCalls = (source, method) => {
  if (!['from', 'rpc'].includes(method)) {
    throw new Error(`Unsupported Supabase method: ${method}`);
  }

  const constants = collectStaticStringConstants(source);
  const argumentTail = method === 'rpc' ? '(?:,\\s*([\\s\\S]{0,700}?))?' : '';
  const call = new RegExp(
    `\\.${method}\\(\\s*(?:(['\"\\x60])([^'\"\\x60]+)\\1|(${IDENTIFIER}))\\s*${argumentTail}\\)`,
    'g',
  );

  const calls = [];
  for (const match of source.matchAll(call)) {
    const target = match[2] || constants.get(match[3]);
    if (!target) continue;
    calls.push({
      index: match.index,
      target,
      identifier: match[3] || null,
      args: method === 'rpc' ? (match[4] || '') : '',
    });
  }
  return calls;
};

const REGISTERED_CONSTANT_TARGETS = new Map([
  ['src/services/db/openMatches.js', {
    from: new Map([
      ['QUIERO_JUGAR_OPEN_MATCHES_VIEW', 'partidos_abiertos_operativos_v2'],
    ]),
    rpc: new Map([
      ['QUIERO_JUGAR_OPEN_MATCHES_RPC', 'get_open_matches_for_quiero_jugar_v2'],
    ]),
  }],
]);

export const findRegisteredSupabaseCalls = (source, relativePath, method) => {
  const registered = REGISTERED_CONSTANT_TARGETS.get(relativePath)?.[method];
  if (!registered) return [];

  return findStaticSupabaseCalls(source, method).filter((call) => (
    call.identifier
      && registered.get(call.identifier) === call.target
  ));
};
