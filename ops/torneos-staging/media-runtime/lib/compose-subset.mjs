/**
 * A deliberately small YAML reader for the manifests in this directory.
 *
 * ---------------------------------------------------------------------------
 * Why this exists at all
 * ---------------------------------------------------------------------------
 * The guarantees this directory claims — clamd is never published, the
 * processor never receives the attestation secret, the remote certification
 * command is never wired as a container HEALTHCHECK — are only worth stating if
 * something re-reads the manifest and fails when they stop being true. The
 * obvious reader is `docker compose config`, and it is the right one to use
 * where Docker exists. It does not exist on every machine that reviews this PR,
 * and installing it is not something a test suite gets to decide, so the checks
 * would simply not run. A test that silently skips is the same as no test.
 *
 * So the manifests are additionally parsed here, with no dependency at all.
 * This is NOT a YAML implementation and must never grow into one: it accepts
 * the block subset the manifests in this directory are written in and THROWS on
 * everything else. That is the useful behaviour in both directions — an
 * unreadable manifest fails the suite, and a manifest that reaches for anchors,
 * merge keys or multi-line scalars fails too, which keeps the files reviewable
 * by eye. `test/compose-subset.test.mjs` cross-checks every parse against
 * js-yaml whenever js-yaml can be resolved, so the subset cannot quietly drift
 * away from what a real parser would have read.
 *
 * ---------------------------------------------------------------------------
 * The accepted subset
 * ---------------------------------------------------------------------------
 *   - block mappings            key: value   /   key:
 *   - block sequences           - value      /   - key: value
 *   - flow sequences of scalars ["CMD", "x"]
 *   - plain, 'single'- and "double"-quoted scalars
 *   - # comments, including trailing ones outside quotes
 *   - the scalars true/false/null/~ and integers
 *
 * Explicitly refused: anchors and aliases (& *), merge keys (<<), tags (!),
 * block scalars (| >), flow mappings ({}), and multi-document streams (---).
 */

export class ComposeSubsetError extends Error {
  constructor(message, line) {
    super(line === undefined ? message : `${message} (line ${line})`);
    this.name = 'ComposeSubsetError';
    this.line = line ?? null;
  }
}

const fail = (message, line) => { throw new ComposeSubsetError(message, line); };

/**
 * Removes a trailing comment, honouring quotes so a `#` inside a value stays.
 * Returns the content with trailing whitespace stripped.
 */
function stripComment(raw, lineNo) {
  let quote = null;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quote) {
      if (ch === '\\' && quote === '"') { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    // A `#` only starts a comment when it is at the start or preceded by space.
    if (ch === '#' && (i === 0 || /\s/.test(raw[i - 1]))) return raw.slice(0, i).trimEnd();
  }
  if (quote) fail('unterminated quoted scalar', lineNo);
  return raw.trimEnd();
}

/** Splits the source into significant lines, each with its indent column. */
function toLines(text) {
  const out = [];
  const rawLines = String(text).split('\n');
  for (let n = 0; n < rawLines.length; n += 1) {
    const raw = rawLines[n];
    if (raw.includes('\t')) fail('tabs are not valid YAML indentation', n + 1);
    const content = stripComment(raw, n + 1);
    if (!content.trim()) continue;
    if (content.trim() === '---' || content.trim() === '...') {
      fail('multi-document streams are outside the accepted subset', n + 1);
    }
    const indent = content.length - content.trimStart().length;
    out.push({ indent, text: content.trimStart(), line: n + 1 });
  }
  return out;
}

/**
 * Rewrites `- key: value` into a bare `-` marker followed by the item body at
 * indent + 2, so the sequence parser only ever has one shape to handle and the
 * item body goes back through the ordinary block parser.
 */
function expandSequenceItems(lines) {
  const out = [];
  for (const entry of lines) {
    if (entry.text !== '-' && !entry.text.startsWith('- ')) { out.push(entry); continue; }
    const rest = entry.text === '-' ? '' : entry.text.slice(2).trimStart();
    out.push({ indent: entry.indent, text: '-', line: entry.line, marker: true });
    if (rest) {
      // The body sits two columns in from the dash. Any continuation lines the
      // author wrote for this item are already indented past the dash, so they
      // land in the same block.
      out.push({ indent: entry.indent + 2, text: rest, line: entry.line });
    }
  }
  return out;
}

const KEY_RE = /^([A-Za-z0-9_./$-][A-Za-z0-9_./$ -]*?)\s*:(?:\s+(.*))?$/;

/** Whether a line opens a mapping entry rather than being a bare scalar. */
function keyOf(text) {
  // A quoted scalar is never a key here: the manifests never quote keys.
  if (text.startsWith('"') || text.startsWith("'")) return null;
  const m = KEY_RE.exec(text);
  if (!m) return null;
  return { key: m[1].trim(), rest: m[2] === undefined ? '' : m[2].trim() };
}

function parseFlowSequence(text, lineNo) {
  const inner = text.slice(1, -1).trim();
  if (!inner) return [];
  const items = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (quote) {
      if (ch === '\\' && quote === '"') { current += inner[i + 1] ?? ''; i += 1; continue; }
      if (ch === quote) { quote = null; current += ch; continue; }
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === ',') { items.push(current); current = ''; continue; }
    if (ch === '[' || ch === ']' || ch === '{' || ch === '}') {
      fail('nested flow collections are outside the accepted subset', lineNo);
    }
    current += ch;
  }
  if (quote) fail('unterminated quoted scalar in flow sequence', lineNo);
  items.push(current);
  return items.map((item) => parseScalar(item.trim(), lineNo));
}

function parseScalar(text, lineNo) {
  if (text === '') return null;
  if (text.startsWith('&') || text.startsWith('*')) {
    fail('anchors and aliases are outside the accepted subset', lineNo);
  }
  if (text.startsWith('!')) fail('tags are outside the accepted subset', lineNo);
  if (text === '|' || text === '>' || /^[|>][-+0-9]*$/.test(text)) {
    fail('block scalars are outside the accepted subset', lineNo);
  }
  if (text.startsWith('{')) fail('flow mappings are outside the accepted subset', lineNo);
  if (text.startsWith('[')) {
    if (!text.endsWith(']')) fail('unterminated flow sequence', lineNo);
    return parseFlowSequence(text, lineNo);
  }
  if (text.startsWith('"')) {
    if (text.length < 2 || !text.endsWith('"')) fail('unterminated double-quoted scalar', lineNo);
    return text.slice(1, -1).replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c));
  }
  if (text.startsWith("'")) {
    if (text.length < 2 || !text.endsWith("'")) fail('unterminated single-quoted scalar', lineNo);
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null' || text === '~') return null;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^-?\d+\.\d+$/.test(text)) return Number(text);
  return text;
}

function parseBlock(lines, start, indent) {
  if (start >= lines.length) return [null, start];
  const first = lines[start];
  if (first.indent !== indent) fail('unexpected indentation', first.line);
  if (first.marker) return parseSequence(lines, start, indent);
  if (keyOf(first.text)) return parseMapping(lines, start, indent);
  // Something that looks like a mapping entry — a colon followed by whitespace
  // or end of line, before any quote — but whose key `keyOf` would not accept.
  // `<<: *defaults` is the case that matters: read as a scalar it would become
  // the harmless-looking string "<<: *defaults" and the merge would be lost
  // silently, which is precisely the failure this parser exists to prevent.
  if (/^[^"']*:(?:\s|$)/.test(first.text)) {
    fail('unsupported mapping key syntax (merge keys and quoted keys are outside the accepted subset)', first.line);
  }
  // A lone scalar: a sequence item body such as `- "clamav-db:/var/lib/clamav"`.
  return [parseScalar(first.text, first.line), start + 1];
}

function parseSequence(lines, start, indent) {
  const out = [];
  let i = start;
  while (i < lines.length && lines[i].indent === indent && lines[i].marker) {
    const dashLine = lines[i];
    i += 1;
    if (i < lines.length && lines[i].indent > indent) {
      const [value, next] = parseBlock(lines, i, lines[i].indent);
      out.push(value);
      i = next;
    } else {
      // `-` with nothing after it and nothing indented under it.
      fail('empty sequence item', dashLine.line);
    }
  }
  return [out, i];
}

function parseMapping(lines, start, indent) {
  const out = {};
  let i = start;
  while (i < lines.length && lines[i].indent === indent && !lines[i].marker) {
    const entry = lines[i];
    const parsed = keyOf(entry.text);
    if (!parsed) fail('expected a mapping key', entry.line);
    const { key, rest } = parsed;
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      fail(`duplicate key ${key}`, entry.line);
    }
    if (key.startsWith('<<')) fail('merge keys are outside the accepted subset', entry.line);
    if (rest) {
      out[key] = parseScalar(rest, entry.line);
      i += 1;
      if (i < lines.length && lines[i].indent > indent) {
        fail('a key with an inline value may not also have a nested block', lines[i].line);
      }
      continue;
    }
    i += 1;
    if (i < lines.length && lines[i].indent > indent) {
      const [value, next] = parseBlock(lines, i, lines[i].indent);
      out[key] = value;
      i = next;
    } else {
      out[key] = null;
    }
  }
  return [out, i];
}

/** Parses the accepted subset, or throws `ComposeSubsetError`. */
export function parseYamlSubset(text) {
  const lines = expandSequenceItems(toLines(text));
  if (lines.length === 0) return null;
  const baseIndent = lines[0].indent;
  if (baseIndent !== 0) fail('the document must start at column 0', lines[0].line);
  const [value, next] = parseBlock(lines, 0, 0);
  if (next !== lines.length) fail('trailing content after the document', lines[next].line);
  return value;
}

/**
 * Every `${VAR}` / `${VAR:?msg}` / `${VAR:-default}` reference in the raw text,
 * as `{ name, required, hasDefault }`. Interpolation is the one Compose feature
 * that decides whether a value comes from the repository or from the host, so
 * the tests read it from the source rather than from the parsed tree.
 */
export function interpolationReferences(text) {
  const out = [];
  const re = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::([?-])([^}]*))?\}/g;
  let m = re.exec(text);
  while (m) {
    out.push({ name: m[1], required: m[2] === '?', hasDefault: m[2] === '-' });
    m = re.exec(text);
  }
  return out;
}

/** Flattens a parsed tree to `[dottedPath, scalar]` pairs, for blanket scans. */
export function flatten(value, prefix = '', out = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${prefix}[${index}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out.push([prefix, value]);
  }
  return out;
}
