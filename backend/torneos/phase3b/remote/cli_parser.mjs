// Port fiel del separador de sentencias del Supabase CLI v2.84.2.
//
// Origen (leido en la version exacta que hay instalada, brew supabase 2.84.2):
//   pkg/parser/token.go   -> Split / SplitAndTrim / tokenizer.ScanToken
//   pkg/parser/state.go   -> ReadyState, CommentState, BlockState, QuoteState,
//                            DollarState, TagState, EscapeState, AtomicState
//
// Por que existe: `supabase migration repair <version> --status applied` guarda
// en supabase_migrations.schema_migrations la columna `statements`, que es
// exactamente `parser.SplitAndTrim(<archivo de la migracion>)`. Para escribir la
// fila canonica sin correr el CLI hay que reproducir ese arreglo tal cual. No
// hay toolchain de Go en esta maquina, asi que se reimplementa la maquina de
// estados y se valida contra los propios fixtures del CLI (pkg/parser/testdata)
// en test_cli_parser.mjs.
//
// La maquina de estados trabaja sobre BYTES, igual que el original: las ventanas
// de comparacion en Go son slices de []byte. Por eso todo aca es Buffer.

// --- Decodificacion de runas, equivalente a utf8.DecodeRune -----------------
// Devuelve { rune, width }. Ante bytes invalidos Go devuelve RuneError con
// ancho 1; se hace lo mismo para que el avance del cursor coincida.
const RUNE_ERROR = 0xfffd;

export const decodeRune = (buf, index) => {
  const b0 = buf[index];
  if (b0 < 0x80) return { rune: b0, width: 1 };

  const cont = (offset) => {
    const byte = buf[index + offset];
    return byte !== undefined && (byte & 0xc0) === 0x80;
  };

  if (b0 >= 0xc2 && b0 <= 0xdf && cont(1)) {
    return { rune: ((b0 & 0x1f) << 6) | (buf[index + 1] & 0x3f), width: 2 };
  }
  if (b0 >= 0xe0 && b0 <= 0xef && cont(1) && cont(2)) {
    const rune = ((b0 & 0x0f) << 12) | ((buf[index + 1] & 0x3f) << 6) | (buf[index + 2] & 0x3f);
    if (rune >= 0x800 && !(rune >= 0xd800 && rune <= 0xdfff)) return { rune, width: 3 };
    return { rune: RUNE_ERROR, width: 1 };
  }
  if (b0 >= 0xf0 && b0 <= 0xf4 && cont(1) && cont(2) && cont(3)) {
    const rune = ((b0 & 0x07) << 18) | ((buf[index + 1] & 0x3f) << 12)
      | ((buf[index + 2] & 0x3f) << 6) | (buf[index + 3] & 0x3f);
    if (rune >= 0x10000 && rune <= 0x10ffff) return { rune, width: 4 };
    return { rune: RUNE_ERROR, width: 1 };
  }
  return { rune: RUNE_ERROR, width: 1 };
};

// utf8.RuneLen: cuantos bytes ocupa una runa codificada.
const runeLen = (rune) => {
  if (rune < 0x80) return 1;
  if (rune < 0x800) return 2;
  if (rune < 0x10000) return 3;
  return 4;
};

const LETTER = /\p{L}/u;   // unicode.IsLetter
const DIGIT = /\p{Nd}/u;   // unicode.IsDigit

const isLetter = (rune) => LETTER.test(String.fromCodePoint(rune));
const isDigit = (rune) => DIGIT.test(String.fromCodePoint(rune));

// strings.EqualFold sobre texto ASCII, que es lo unico que se compara aca
// (los delimitadores son "ATOMIC", "END" y ")").
const equalFoldAscii = (a, b) => a.length === b.length && a.toLowerCase() === b.toLowerCase();

// Ventana de los ultimos n bytes de data, como data[len(data)-n:] en Go.
// Si la ventana no entra, Go entraria en panico; aca se devuelve null y el
// llamador lo trata como "no coincide", que es el unico camino alcanzable en
// los estados donde puede pasar.
const window = (data, size) => (data.length >= size ? data.subarray(data.length - size) : null);

// --- Estados ----------------------------------------------------------------
// Cada Next(rune, data) devuelve el proximo estado, o null para emitir token.
// data es el buffer del token en curso, incluida la runa actual.

const BEGIN_ATOMIC = 'ATOMIC';
const END_ATOMIC = 'END';

class ReadyState {
  next(rune, data) {
    switch (rune) {
      case 0x24: // '$'
        return new TagState(data.length - runeLen(rune));
      case 0x27: // '\''
      case 0x22: // '"'
        return new QuoteState(rune);
      case 0x2d: // '-'
        return new CommentState();
      case 0x2f: // '/'
        return new BlockState();
      case 0x5c: // '\\'
        return new EscapeState();
      case 0x3b: // ';'
        return null; // emitir token
      case 0x28: // '('
        return new AtomicState(this, Buffer.from(')', 'utf8'));
      case 0x63: // 'c'
      case 0x43: { // 'C'
        const offset = data.length - BEGIN_ATOMIC.length;
        if (offset >= 0 && equalFoldAscii(data.subarray(offset).toString('latin1'), BEGIN_ATOMIC)) {
          return new AtomicState(this, Buffer.from(END_ATOMIC, 'utf8'));
        }
        return this;
      }
      default:
        return this;
    }
  }
}

class CommentState {
  next(rune, data) {
    if (rune === 0x2d) { // segundo '-': comentario de linea
      return new DollarState(Buffer.from('\n', 'utf8'));
    }
    return new ReadyState().next(rune, data);
  }
}

class BlockState {
  constructor() { this.depth = 0; }

  next(rune, data) {
    const win = window(data, 2);
    if (win && win[0] === 0x2f && win[1] === 0x2a) { // "/*"
      this.depth += 1;
      return this;
    }
    if (this.depth === 0) {
      return new ReadyState().next(rune, data);
    }
    if (win && win[0] === 0x2a && win[1] === 0x2f) { // "*/"
      this.depth -= 1;
      if (this.depth === 0) return new ReadyState();
    }
    return this;
  }
}

class QuoteState {
  constructor(delimiter) { this.delimiter = delimiter; this.escape = false; }

  next(rune, data) {
    if (this.escape) {
      if (rune === this.delimiter) { // comilla escapada ''
        this.escape = false;
        return this;
      }
      return new ReadyState().next(rune, data);
    }
    if (rune === this.delimiter) this.escape = true;
    return this;
  }
}

class DollarState {
  constructor(delimiter) { this.delimiter = delimiter; }

  next(rune, data) {
    const win = window(data, this.delimiter.length);
    if (win && win.equals(this.delimiter)) return new ReadyState();
    return this;
  }
}

class TagState {
  constructor(offset) { this.offset = offset; }

  next(rune, data) {
    if (rune === 0x24) { // '$' cierra la etiqueta: $tag$
      return new DollarState(Buffer.from(data.subarray(this.offset)));
    }
    if (isLetter(rune) || isDigit(rune) || rune === 0x5f) return this;
    return new ReadyState().next(rune, data);
  }
}

class EscapeState {
  next() { return new ReadyState(); }
}

class AtomicState {
  constructor(prev, delimiter) { this.prev = prev; this.delimiter = delimiter; }

  next(rune, data) {
    const curr = this.prev.next(rune, data);
    if (curr !== null) this.prev = curr;
    if (this.prev instanceof ReadyState) {
      const win = window(data, this.delimiter.length);
      if (win && equalFoldAscii(win.toString('latin1'), this.delimiter.toString('latin1'))) {
        return new ReadyState();
      }
    }
    return this;
  }
}

// --- Split ------------------------------------------------------------------
// Equivalente a parser.Split sobre el contenido completo. El original usa
// bufio.Scanner para no cargar todo en memoria; con el buffer alcanzando al
// archivo entero (que es lo que hace pkg/migration/parseFile: sube
// MaxScannerCapacity al tamano del archivo) el recorrido es el mismo.

export const split = (source, transforms = []) => {
  const data = Buffer.isBuffer(source) ? source : Buffer.from(source, 'utf8');
  const statements = [];

  let state = new ReadyState();
  let tokenStart = 0;
  let cursor = 0;

  const emit = (end) => {
    const token = data.subarray(tokenStart, end).toString('utf8');
    let trimmed = token;
    for (const apply of transforms) trimmed = apply(trimmed);
    if (trimmed.length > 0) statements.push(trimmed);
  };

  while (cursor < data.length) {
    const { rune, width } = decodeRune(data, cursor);
    const end = cursor + width;
    state = state.next(rune, data.subarray(tokenStart, end));
    if (state === null) {
      emit(end);
      tokenStart = end;
      state = new ReadyState();
    }
    cursor = end;
  }

  // Token final sin terminar (EOF).
  if (tokenStart < data.length) emit(data.length);

  return statements;
};

// strings.TrimRight(token, ";") y despues strings.TrimSpace, EN ESE ORDEN.
//
// El conjunto de espacios se escribe explicito en vez de usar \s: unicode.IsSpace
// de Go incluye U+0085 (NEL), que \s no tiene, y NO incluye U+FEFF (BOM), que \s
// si tiene. Un BOM inicial se recortaria de mas con \s.
const GO_SPACE = '\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const TRIM_SPACE = new RegExp(`^[${GO_SPACE}]+|[${GO_SPACE}]+$`, 'g');

const trimRightSemicolons = (token) => token.replace(/;+$/, '');
const trimSpace = (token) => token.replace(TRIM_SPACE, '');

export const splitAndTrim = (source) => split(source, [trimRightSemicolons, trimSpace]);
