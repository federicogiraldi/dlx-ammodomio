import { BY_MN, INSTRUCTIONS, InstrDef, PSEUDO, syntaxOf } from '../isa/table';
import { encode, Fields } from '../isa/encode';
import { Txt, txt, hex, hexShort } from '../util';

export type Severity = 'error' | 'warning' | 'info';

export interface Fix {
  from: number; // colonne nella riga
  to: number;
  insert: string;
  label: Txt;
}

export interface Diagnostic {
  line: number; // 1-based
  from: number; // colonna 0-based
  to: number;
  severity: Severity;
  text: Txt;
  fix?: Fix;
}

export interface SymbolInfo {
  value: number;
  line: number;
  kind: 'label' | 'equ';
}

export interface Region {
  start: number;
  end: number; // incluso
  line: number;
  kind: 'code' | 'data';
}

export interface Program {
  ok: boolean;
  source: string;
  diagnostics: Diagnostic[];
  /** immagine di memoria byte per byte */
  bytes: Map<number, number>;
  /** indirizzo istruzione → riga sorgente (1-based) */
  addrToLine: Map<number, number>;
  /** riga → indirizzo (istruzioni e dati) */
  lineToAddr: Map<number, number>;
  symbols: Map<string, SymbolInfo>;
  regions: Region[];
  entry: number;
}

export interface AsmOptions {
  /** indirizzo iniziale della sezione .data se non specificato */
  dataBase?: number;
}

// ------------------------------------------------------------------
// Tokenizzazione della riga
// ------------------------------------------------------------------

interface Piece {
  text: string;
  col: number;
}

/** Rimuove il commento (; o //) rispettando le stringhe tra apici. */
function stripComment(line: string): string {
  let inStr: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") inStr = c;
    else if (c === ';' || (c === '/' && line[i + 1] === '/') || c === '#') return line.slice(0, i);
  }
  return line;
}

/** Divide gli operandi sulle virgole fuori da parentesi e stringhe. */
function splitOperands(s: string, baseCol: number): Piece[] {
  const out: Piece[] = [];
  let depth = 0;
  let inStr: string | null = null;
  let start = 0;
  const push = (end: number) => {
    const raw = s.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    out.push({ text: raw.trim(), col: baseCol + start + lead });
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") inStr = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      push(i);
      start = i + 1;
    }
  }
  if (s.trim().length > 0 || out.length > 0) push(s.length);
  return out;
}

// ------------------------------------------------------------------
// Numeri ed espressioni
// ------------------------------------------------------------------

class AsmError extends Error {
  constructor(
    public text: Txt,
    public col?: number,
    public len?: number,
    public fix?: Fix,
  ) {
    super(text.it);
  }
}

interface EvalCtx {
  symbols: Map<string, SymbolInfo>;
  /** in passata 1 i simboli non ancora definiti valgono 0 */
  allowUndefined: boolean;
  warn: (d: Omit<Diagnostic, 'line'>) => void;
  usedSymbol?: boolean;
}

const REG_RE = /^r(\d+)$/i;

function parseNumberLiteral(tok: string, col: number, ctx: EvalCtx): number | null {
  let m: RegExpMatchArray | null;
  if ((m = tok.match(/^0x([0-9a-f]+)$/i))) return parseInt(m[1], 16);
  if ((m = tok.match(/^0b([01]+)$/i))) return parseInt(m[1], 2);
  if ((m = tok.match(/^([0-9][0-9a-f]*)h$/i))) return parseInt(m[1], 16);
  if ((m = tok.match(/^[0-9]+$/))) {
    const dec = parseInt(tok, 10);
    if (tok.length > 1 && tok[0] === '0') {
      const asHex = parseInt(tok, 16);
      if (asHex !== dec) {
        ctx.warn({
          from: col,
          to: col + tok.length,
          severity: 'warning',
          text: txt(
            `"${tok}" è letto come DECIMALE (${dec}). Se intendevi esadecimale scrivi 0x${tok} oppure ${tok}h (= ${asHex}).`,
            `"${tok}" is read as DECIMAL (${dec}). If you meant hexadecimal write 0x${tok} or ${tok}h (= ${asHex}).`,
          ),
          fix: { from: col, to: col + tok.length, insert: `0x${tok}`, label: txt(`Usa 0x${tok}`, `Use 0x${tok}`) },
        });
      }
    }
    return dec;
  }
  if ((m = tok.match(/^'(\\?.)'$/))) {
    const ch = m[1].length === 2 ? ({ n: '\n', t: '\t', '0': '\0' } as Record<string, string>)[m[1][1]] ?? m[1][1] : m[1];
    return ch.charCodeAt(0);
  }
  return null;
}

/** Valutatore di espressioni: + - * / << >> & | ~, parentesi, hi(), lo(), simboli. */
function evaluate(expr: string, col: number, ctx: EvalCtx): number {
  const tokens: { t: string; c: number }[] = [];
  const re = /\s*(0x[0-9a-f]+|0b[01]+|[0-9][0-9a-f]*h\b|[0-9]+|'(?:\\.|[^'])'|[A-Za-z_.$][\w.$]*|<<|>>|[-+*/()&|~^])/iy;
  let pos = 0;
  while (pos < expr.length) {
    re.lastIndex = pos;
    const m = re.exec(expr);
    if (!m) {
      if (expr.slice(pos).trim() === '') break;
      throw new AsmError(txt(`Carattere non valido in "${expr}"`, `Invalid character in "${expr}"`), col + pos, 1);
    }
    tokens.push({ t: m[1], c: col + m.index + m[0].indexOf(m[1]) });
    pos = re.lastIndex;
  }
  if (tokens.length === 0) throw new AsmError(txt('Manca un valore', 'Missing value'), col, 1);
  let i = 0;
  const peek = () => tokens[i]?.t;
  const next = () => tokens[i++];

  const primary = (): number => {
    const tk = next();
    if (!tk) throw new AsmError(txt(`Espressione incompleta: "${expr}"`, `Incomplete expression: "${expr}"`), col, expr.length);
    const t = tk.t;
    if (t === '(') {
      const v = orExpr();
      if (next()?.t !== ')') throw new AsmError(txt('Manca ")"', 'Missing ")"'), tk.c, 1);
      return v;
    }
    if (t === '-') return -primary();
    if (t === '+') return primary();
    if (t === '~') return ~primary();
    const n = parseNumberLiteral(t, tk.c, ctx);
    if (n !== null) return n;
    if (/^[A-Za-z_.$]/.test(t)) {
      const low = t.toLowerCase();
      if ((low === 'hi' || low === 'lo') && peek() === '(') {
        next();
        const v = orExpr();
        if (next()?.t !== ')') throw new AsmError(txt('Manca ")"', 'Missing ")"'), tk.c, 1);
        if (low === 'lo') return v & 0xffff;
        // hi compensa l'estensione del segno quando si usa ADDI per i bit bassi? No: nel corso si usa LHI + ORI
        return (v >>> 16) & 0xffff;
      }
      if (REG_RE.test(t)) {
        throw new AsmError(
          txt(`Qui serve un numero o un'etichetta, non il registro ${t.toUpperCase()}.`, `A number or label is expected here, not register ${t.toUpperCase()}.`),
          tk.c,
          t.length,
        );
      }
      const sym = ctx.symbols.get(t) ?? ctx.symbols.get(low) ?? findCaseInsensitive(ctx.symbols, t);
      if (sym) {
        ctx.usedSymbol = true;
        return sym.value;
      }
      if (ctx.allowUndefined) {
        ctx.usedSymbol = true;
        return 0;
      }
      const hexLike = /^[0-9a-f]+h$/i.test(t);
      if (hexLike) {
        throw new AsmError(
          txt(`"${t}" sembra un numero esadecimale ma inizia con una lettera: scrivi 0${t} oppure 0x${t.slice(0, -1)}.`,
            `"${t}" looks like a hex number but starts with a letter: write 0${t} or 0x${t.slice(0, -1)}.`),
          tk.c,
          t.length,
          { from: tk.c, to: tk.c + t.length, insert: `0x${t.slice(0, -1)}`, label: txt(`Usa 0x${t.slice(0, -1)}`, `Use 0x${t.slice(0, -1)}`) },
        );
      }
      const near = nearest(t, [...ctx.symbols.keys()]);
      throw new AsmError(
        txt(`Etichetta "${t}" non definita.${near ? ` Forse intendevi "${near}"?` : ''}`, `Label "${t}" is not defined.${near ? ` Did you mean "${near}"?` : ''}`),
        tk.c,
        t.length,
        near ? { from: tk.c, to: tk.c + t.length, insert: near, label: txt(`Usa "${near}"`, `Use "${near}"`) } : undefined,
      );
    }
    throw new AsmError(txt(`Valore non valido: "${t}"`, `Invalid value: "${t}"`), tk.c, t.length);
  };
  const mul = (): number => {
    let v = primary();
    while (peek() === '*' || peek() === '/') {
      const op = next().t;
      const opTok = tokens[i - 1];
      const r = primary();
      if (op === '/' && r === 0) throw new AsmError(txt('Divisione per zero', 'Division by zero'), opTok.c, 1);
      v = op === '*' ? Math.imul(v, r) : Math.trunc(v / r);
    }
    return v;
  };
  const add = (): number => {
    let v = mul();
    while (peek() === '+' || peek() === '-') {
      const op = next().t;
      const r = mul();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const shift = (): number => {
    let v = add();
    while (peek() === '<<' || peek() === '>>') {
      const op = next().t;
      const r = add();
      v = op === '<<' ? v * 2 ** r : Math.floor(v / 2 ** r);
    }
    return v;
  };
  const andE = (): number => {
    let v = shift();
    while (peek() === '&') {
      next();
      v = (v & shift()) >>> 0;
    }
    return v;
  };
  const orExpr = (): number => {
    let v = andE();
    while (peek() === '|' || peek() === '^') {
      const op = next().t;
      const r = andE();
      v = (op === '|' ? v | r : v ^ r) >>> 0;
    }
    return v;
  };
  const v = orExpr();
  if (i < tokens.length) {
    const tk = tokens[i];
    throw new AsmError(txt(`Testo inatteso "${tk.t}"`, `Unexpected "${tk.t}"`), tk.c, tk.t.length);
  }
  return v;
}

function findCaseInsensitive(map: Map<string, SymbolInfo>, name: string): SymbolInfo | undefined {
  const low = name.toLowerCase();
  for (const [k, v] of map) if (k.toLowerCase() === low) return v;
  return undefined;
}

function levenshtein(a: string, b: string): number {
  // distanza di Damerau-Levenshtein (versione OSA): anche lo scambio di due lettere adiacenti costa 1
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

function nearest(word: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  const w = word.toUpperCase();
  for (const c of candidates) {
    const d = levenshtein(w, c.toUpperCase());
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return bestD <= Math.max(1, Math.floor(word.length / 3)) ? best : undefined;
}

// ------------------------------------------------------------------
// Assembler a due passate
// ------------------------------------------------------------------

type Section = 'text' | 'data';

interface Stmt {
  line: number;
  addr: number;
  section: Section;
  kind: 'instr' | 'directive';
  name: string; // mnemonico o direttiva (maiuscolo / minuscolo)
  nameCol: number;
  ops: Piece[];
  size: number;
}

/** dimensione massima di una singola .space (evita che un programma blocchi la pagina) */
export const MAX_SPACE = 0x40000; // 256 KiB

const DIRECTIVES = ['.org', '.text', '.data', '.word', '.half', '.byte', '.space', '.ascii', '.asciiz', '.align', '.equ', '.global', '.globl', '.set'];

export function assemble(source: string, opts: AsmOptions = {}): Program {
  // tutte le forme di fine riga: CRLF (Windows), LF, CR isolato (vecchi Mac), separatori Unicode
  const lines = source.split(/\r\n|\r|\n|\u2028|\u2029/);
  const diagnostics: Diagnostic[] = [];
  const symbols = new Map<string, SymbolInfo>();
  const stmts: Stmt[] = [];
  const loc: Record<Section, number> = { text: 0, data: opts.dataBase ?? 0x40000000 };
  let section: Section = 'text';
  let labelsThisLine: string[] = [];

  const diag = (line: number, severity: Severity, text: Txt, from = 0, to = lines[line - 1]?.length ?? 0, fix?: Fix) =>
    diagnostics.push({ line, from, to, severity, text, fix });

  const ctx1 = (_line: number): EvalCtx => ({
    symbols,
    allowUndefined: false,
    warn: () => {},
  });

  // ---------------- Passata 1: etichette, dimensioni, indirizzi ----------------
  for (let li = 0; li < lines.length; li++) {
    const lineNo = li + 1;
    let code = stripComment(lines[li]);
    let col = 0;
    labelsThisLine = [];
    // etichette (anche più di una, anche da sole sulla riga)
    for (;;) {
      const m = code.slice(col).match(/^(\s*)([A-Za-z_.$][\w.$]*)\s*:/);
      if (!m) break;
      const name = m[2];
      const nameCol = col + m[1].length;
      if (REG_RE.test(name) && Number(name.slice(1)) < 32) {
        diag(lineNo, 'error', txt(`"${name}" è il nome di un registro: scegli un altro nome per l'etichetta.`, `"${name}" is a register name: choose another label name.`), nameCol, nameCol + name.length);
      } else if (BY_MN.has(name.toUpperCase())) {
        diag(lineNo, 'warning', txt(`L'etichetta "${name}" ha lo stesso nome di un'istruzione: può confondere.`, `Label "${name}" has the same name as an instruction: confusing.`), nameCol, nameCol + name.length);
      }
      const prev = findCaseInsensitive(symbols, name);
      if (prev) {
        diag(lineNo, 'error', txt(`Etichetta "${name}" già definita alla riga ${prev.line}.`, `Label "${name}" already defined at line ${prev.line}.`), nameCol, nameCol + name.length);
      } else {
        symbols.set(name, { value: loc[section] >>> 0, line: lineNo, kind: 'label' });
        labelsThisLine.push(name);
      }
      col += m[0].length;
    }
    const rest = code.slice(col);
    const trimmed = rest.trim();
    if (!trimmed) continue;
    const lead = rest.length - rest.trimStart().length;
    const firstCol = col + lead;
    const mm = trimmed.match(/^(\S+)\s*([\s\S]*)$/)!;
    let name = mm[1];
    let opsText = mm[2];
    let opsCol = firstCol + trimmed.indexOf(opsText, name.length);
    if (opsText === '') opsCol = firstCol + name.length;

    // forma "NOME EQU valore" / "NOME .equ valore"
    const eqm = trimmed.match(/^([A-Za-z_.$][\w.$]*)\s+(equ|\.equ|=)\s+(.+)$/i);
    if (eqm && !BY_MN.has(eqm[1].toUpperCase())) {
      defineEqu(lineNo, eqm[1], eqm[3], firstCol + trimmed.indexOf(eqm[3], eqm[1].length + eqm[2].length));
      continue;
    }

    const ops = splitOperands(opsText, opsCol);
    if (name.startsWith('.')) {
      const d = name.toLowerCase();
      if (!DIRECTIVES.includes(d)) {
        const near = nearest(d, DIRECTIVES);
        diag(lineNo, 'error', txt(`Direttiva sconosciuta "${name}".${near ? ` Forse "${near}"?` : ''}`, `Unknown directive "${name}".${near ? ` Maybe "${near}"?` : ''}`), firstCol, firstCol + name.length);
        continue;
      }
      try {
        handleDirectivePass1(lineNo, d, ops, firstCol);
      } catch (e) {
        report(lineNo, e);
      }
      continue;
    }
    // istruzione
    const upper = name.toUpperCase();
    if (!BY_MN.has(upper) && !PSEUDO[upper]) {
      const near = nearest(upper, [...BY_MN.keys(), ...Object.keys(PSEUDO)]);
      const looksLabel = ops.length === 0 && /^[A-Za-z_]\w*$/.test(name);
      diag(
        lineNo,
        'error',
        txt(
          `Istruzione sconosciuta "${name}".${near ? ` Forse intendevi ${near}?` : ''}${looksLabel && !near ? ' Se è un\'etichetta, aggiungi ":" dopo il nome.' : ''}`,
          `Unknown instruction "${name}".${near ? ` Did you mean ${near}?` : ''}${looksLabel && !near ? ' If it is a label, add ":" after it.' : ''}`,
        ),
        firstCol,
        firstCol + name.length,
        near ? { from: firstCol, to: firstCol + name.length, insert: near, label: txt(`Sostituisci con ${near}`, `Replace with ${near}`) } : looksLabel ? { from: firstCol + name.length, to: firstCol + name.length, insert: ':', label: txt('Aggiungi ":"', 'Add ":"') } : undefined,
      );
      continue;
    }
    if (loc[section] % 4 !== 0) {
      diag(lineNo, 'error', txt(`Istruzione a indirizzo non allineato (${hex(loc[section])}): le istruzioni devono stare a multipli di 4. Usa .align 2 prima.`, `Instruction at unaligned address (${hex(loc[section])}): instructions must be at multiples of 4. Use .align 2 before it.`), firstCol, firstCol + name.length);
    }
    stmts.push({ line: lineNo, addr: loc[section] >>> 0, section, kind: 'instr', name: upper, nameCol: firstCol, ops, size: 4 });
    loc[section] += 4;
  }

  function defineEqu(lineNo: number, name: string, exprText: string, exprCol: number) {
    try {
      const v = evaluate(exprText.trim(), exprCol, { ...ctx1(lineNo), warn: (d) => diagnostics.push({ ...d, line: lineNo }) });
      if (findCaseInsensitive(symbols, name)) {
        diag(lineNo, 'error', txt(`Simbolo "${name}" già definito.`, `Symbol "${name}" already defined.`));
      } else symbols.set(name, { value: v >>> 0, line: lineNo, kind: 'equ' });
    } catch (e) {
      report(lineNo, e);
    }
  }

  function handleDirectivePass1(lineNo: number, d: string, ops: Piece[], col: number) {
    const ev = (p: Piece) => evaluate(p.text, p.col, { ...ctx1(lineNo), warn: (dd) => diagnostics.push({ ...dd, line: lineNo }) });
    switch (d) {
      case '.text':
      case '.data':
        section = d === '.text' ? 'text' : 'data';
        if (ops.length && ops[0].text) loc[section] = ev(ops[0]) >>> 0;
        return;
      case '.org':
        if (!ops.length) throw new AsmError(txt('.org vuole un indirizzo, es. .org 0x100', '.org needs an address, e.g. .org 0x100'), col);
        loc[section] = ev(ops[0]) >>> 0;
        return;
      case '.align': {
        const n = ops.length ? ev(ops[0]) : 2;
        if (!Number.isInteger(n) || n < 0 || n > 16) throw new AsmError(txt(`.align n allinea a 2^n byte: n deve essere un intero tra 0 e 16 (qui vale ${n}).`, `.align n aligns to 2^n bytes: n must be a whole number between 0 and 16 (here it is ${n}).`), ops[0]?.col ?? col);
        const a = 2 ** n;
        loc[section] = Math.ceil(loc[section] / a) * a;
        for (const l of labelsThisLine) symbols.get(l)!.value = loc[section] >>> 0;
        return;
      }
      case '.equ':
      case '.set': {
        if (ops.length !== 2) throw new AsmError(txt('Sintassi: .equ NOME, valore', 'Syntax: .equ NAME, value'), col);
        defineEqu(lineNo, ops[0].text, ops[1].text, ops[1].col);
        return;
      }
      case '.global':
      case '.globl':
        return;
    }
    // direttive che occupano memoria
    let size = 0;
    switch (d) {
      case '.word': size = 4 * ops.length; break;
      case '.half': size = 2 * ops.length; break;
      case '.byte': size = ops.length; break;
      case '.space': {
        if (!ops.length) throw new AsmError(txt('.space vuole il numero di byte', '.space needs a byte count'), col);
        size = ev(ops[0]);
        if (!Number.isInteger(size) || size < 0) throw new AsmError(txt(`.space vuole un numero intero di byte ≥ 0 (qui vale ${size}).`, `.space needs a whole byte count ≥ 0 (here it is ${size}).`), ops[0].col, ops[0].text.length);
        if (size > MAX_SPACE) throw new AsmError(txt(`.space ${size} è troppo grande: il massimo è ${MAX_SPACE} byte (256 KiB). Per gli esercizi bastano poche centinaia di byte.`, `.space ${size} is too large: the maximum is ${MAX_SPACE} bytes (256 KiB).`), ops[0].col, ops[0].text.length);
        break;
      }
      case '.ascii':
      case '.asciiz': {
        for (const p of ops) size += parseString(p).length;
        if (d === '.asciiz') size += ops.length;
        break;
      }
    }
    if ((d === '.word' && loc[section] % 4) || (d === '.half' && loc[section] % 2)) {
      diag(lineNo, 'warning', txt(`${d} a indirizzo non allineato (${hex(loc[section])}): le LW/LH andrebbero in alignment fault. Aggiungi .align.`, `${d} at unaligned address (${hex(loc[section])}): LW/LH would fault. Add .align.`), col, col + d.length);
    }
    stmts.push({ line: lineNo, addr: loc[section] >>> 0, section, kind: 'directive', name: d, nameCol: col, ops, size });
    loc[section] += size;
  }

  function report(lineNo: number, e: unknown) {
    if (e instanceof AsmError) {
      const from = e.col ?? 0;
      diag(lineNo, 'error', e.text, from, e.len !== undefined ? from + e.len : (lines[lineNo - 1]?.length ?? from + 1), e.fix);
    } else {
      diag(lineNo, 'error', txt(String(e)));
    }
  }

  // ---------------- Passata 2: codifica ----------------
  const bytes = new Map<number, number>();
  const owner = new Map<number, number>(); // byte → riga
  const addrToLine = new Map<number, number>();
  const lineToAddr = new Map<number, number>();
  const regions: Region[] = [];

  const put = (addr: number, b: number, line: number) => {
    addr >>>= 0;
    const o = owner.get(addr);
    if (o !== undefined && o !== line) {
      throw new AsmError(txt(`Sovrapposizione: l'indirizzo ${hex(addr)} è già occupato dalla riga ${o}.`, `Overlap: address ${hex(addr)} is already used by line ${o}.`));
    }
    owner.set(addr, line);
    bytes.set(addr, b & 0xff);
  };
  const putWord = (addr: number, w: number, line: number) => {
    put(addr, w >>> 24, line);
    put(addr + 1, w >>> 16, line);
    put(addr + 2, w >>> 8, line);
    put(addr + 3, w, line);
  };

  for (const st of stmts) {
    const ctx: EvalCtx = {
      symbols,
      allowUndefined: false,
      warn: (d) => diagnostics.push({ ...d, line: st.line }),
    };
    try {
      if (st.kind === 'instr') {
        const word = encodeStmt(st, ctx, diagnostics);
        putWord(st.addr, word, st.line);
        addrToLine.set(st.addr, st.line);
      } else {
        emitData(st, ctx, put);
      }
      if (st.size > 0) {
        lineToAddr.set(st.line, st.addr);
        regions.push({ start: st.addr, end: st.addr + st.size - 1, line: st.line, kind: st.kind === 'instr' ? 'code' : 'data' });
      }
    } catch (e) {
      report(st.line, e);
    }
  }

  // nota se non c'è alcun HALT
  const hasCode = stmts.some((s) => s.kind === 'instr');
  if (hasCode && !stmts.some((s) => s.kind === 'instr' && (s.name === 'HALT' || (s.name === 'TRAP' && s.ops[0]?.text === '0')))) {
    const last = [...stmts].reverse().find((s) => s.kind === 'instr')!;
    diagnostics.push({
      line: last.line,
      from: 0,
      to: lines[last.line - 1].length,
      severity: 'info',
      text: txt(
        'Il programma non contiene HALT (TRAP 0): dopo l\'ultima istruzione il processore continuerebbe a leggere la memoria che segue. Puoi comunque fermarlo con Pausa, o terminare con un ciclo infinito (es. fine: J fine).',
        'The program has no HALT (TRAP 0): after the last instruction the CPU would keep fetching whatever follows. You can still Pause it, or end with an infinite loop (e.g. end: J end).',
      ),
    });
  }

  diagnostics.sort((a, b) => a.line - b.line || a.from - b.from);
  return {
    ok: !diagnostics.some((d) => d.severity === 'error'),
    source,
    diagnostics,
    bytes,
    addrToLine,
    lineToAddr,
    symbols,
    regions,
    entry: 0,
  };
}

function parseString(p: Piece): string {
  const m = p.text.match(/^"((?:\\.|[^"\\])*)"$/);
  if (!m) throw new AsmError(txt('Serve una stringa tra virgolette, es. "ciao"', 'A quoted string is needed, e.g. "hello"'), p.col, p.text.length);
  return m[1].replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t', '0': '\0', r: '\r' } as Record<string, string>)[c] ?? c);
}

function emitData(st: Stmt, ctx: EvalCtx, put: (a: number, b: number, line: number) => void) {
  let a = st.addr;
  const ev = (p: Piece) => evaluate(p.text, p.col, ctx);
  switch (st.name) {
    case '.word':
      for (const p of st.ops) {
        const v = ev(p);
        if (v > 0xffffffff || v < -0x80000000) throw new AsmError(txt(`${p.text} non sta in 32 bit`, `${p.text} does not fit in 32 bits`), p.col, p.text.length);
        const w = v >>> 0;
        put(a, w >>> 24, st.line); put(a + 1, w >>> 16, st.line); put(a + 2, w >>> 8, st.line); put(a + 3, w, st.line);
        a += 4;
      }
      return;
    case '.half':
      for (const p of st.ops) {
        const v = ev(p);
        if (v > 0xffff || v < -0x8000) throw new AsmError(txt(`${p.text} non sta in 16 bit`, `${p.text} does not fit in 16 bits`), p.col, p.text.length);
        put(a, v >> 8, st.line); put(a + 1, v, st.line);
        a += 2;
      }
      return;
    case '.byte':
      for (const p of st.ops) {
        const v = ev(p);
        if (v > 0xff || v < -0x80) throw new AsmError(txt(`${p.text} non sta in 8 bit`, `${p.text} does not fit in 8 bits`), p.col, p.text.length);
        put(a++, v, st.line);
      }
      return;
    case '.space': {
      const fill = st.ops[1] ? ev(st.ops[1]) : 0;
      for (let i = 0; i < st.size; i++) put(a++, fill, st.line);
      return;
    }
    case '.ascii':
    case '.asciiz':
      for (const p of st.ops) {
        for (const ch of parseString(p)) put(a++, ch.charCodeAt(0), st.line);
        if (st.name === '.asciiz') put(a++, 0, st.line);
      }
      return;
  }
}

// ------------------------------------------------------------------
// Codifica di una singola istruzione
// ------------------------------------------------------------------

function parseReg(p: Piece | undefined, what: Txt): number {
  if (!p || !p.text) throw new AsmError(txt(`Manca ${what.it}`, `Missing ${what.en}`));
  const m = p.text.match(REG_RE);
  if (!m) {
    if (/^-?\d|^0x|h$/i.test(p.text)) {
      throw new AsmError(txt(`Qui serve un registro (${what.it}), non il numero "${p.text}".`, `A register (${what.en}) is needed here, not the number "${p.text}".`), p.col, p.text.length);
    }
    throw new AsmError(txt(`"${p.text}" non è un registro valido (${what.it}). I registri sono R0..R31.`, `"${p.text}" is not a valid register (${what.en}). Registers are R0..R31.`), p.col, p.text.length);
  }
  const n = Number(m[1]);
  if (n > 31) throw new AsmError(txt(`R${n} non esiste: il DLX ha 32 registri, da R0 a R31.`, `R${n} does not exist: DLX has 32 registers, R0..R31.`), p.col, p.text.length);
  return n;
}

const isReg = (p?: Piece) => !!p && REG_RE.test(p.text);
const MEM_RE = /^(.*?)\(\s*([A-Za-z]\w*)\s*\)\s*$/;
const isMem = (p?: Piece) => !!p && MEM_RE.test(p.text);

function parseMem(p: Piece, ctx: EvalCtx): { base: number; off: number; offCol: number; offLen: number } {
  const m = p.text.match(MEM_RE);
  if (!m) {
    // forma "LW R1, etichetta": indirizzo assoluto con base R0
    const v = evaluate(p.text, p.col, ctx);
    return { base: 0, off: v, offCol: p.col, offLen: p.text.length };
  }
  const offText = m[1].trim();
  const baseCol = p.col + p.text.indexOf('(') + 1;
  const base = parseReg({ text: m[2], col: baseCol + (p.text.slice(p.text.indexOf('(') + 1).length - p.text.slice(p.text.indexOf('(') + 1).trimStart().length) }, txt('il registro base', 'the base register'));
  const off = offText === '' ? 0 : evaluate(offText, p.col, ctx);
  return { base, off, offCol: p.col, offLen: Math.max(1, m[1].length) };
}

function checkImm16(v: number, def: InstrDef, col: number, len: number, ctx: EvalCtx): number {
  const signed = def.ext === 'signed';
  if (def.group === 'shift') {
    if (v < 0 || v > 31) ctx.warn({ from: col, to: col + len, severity: 'warning', text: txt(`Lo shift usa solo i 5 bit bassi: ${v} diventa ${v & 31}.`, `Shifts use only the low 5 bits: ${v} becomes ${v & 31}.`) });
    return v & 0xffff;
  }
  if (v < -0x8000 || v > 0xffff) {
    const hiPart = (v >>> 16) & 0xffff;
    const loPart = v & 0xffff;
    throw new AsmError(
      txt(
        `Il valore ${v} (${hexShort(v >>> 0)}) non sta in un immediato a 16 bit. Per costanti a 32 bit usa due istruzioni: LHI Rx,${hexShort(hiPart)} e poi ORI Rx,Rx,${hexShort(loPart)}.`,
        `Value ${v} (${hexShort(v >>> 0)}) does not fit in a 16-bit immediate. For 32-bit constants use LHI Rx,${hexShort(hiPart)} then ORI Rx,Rx,${hexShort(loPart)}.`,
      ),
      col,
      len,
    );
  }
  if (signed && v >= 0x8000 && def.group !== 'lhi') {
    ctx.warn({
      from: col, to: col + len, severity: 'info',
      text: txt(
        `Attenzione: ${def.mn} estende l'immediato CON segno, quindi ${hexShort(v)} vale ${v - 0x10000} (non ${v}).`,
        `Note: ${def.mn} sign-extends the immediate, so ${hexShort(v)} means ${v - 0x10000} (not ${v}).`,
      ),
    });
  }
  if (!signed && v < 0 && def.group !== 'lhi') {
    ctx.warn({
      from: col, to: col + len, severity: 'warning',
      text: txt(
        `${def.mn} estende l'immediato SENZA segno: ${v} diventa ${v & 0xffff} (${hexShort(v & 0xffff)}).`,
        `${def.mn} zero-extends the immediate: ${v} becomes ${v & 0xffff} (${hexShort(v & 0xffff)}).`,
      ),
    });
  }
  return v & 0xffff;
}

const WRITES_RD = new Set(['alu', 'shift', 'set', 'lhi', 'load']);

function encodeStmt(st: Stmt, ctx: EvalCtx, diags: Diagnostic[]): number {
  if (st.name === 'HALT') {
    if (st.ops.length) throw new AsmError(txt('HALT non vuole operandi', 'HALT takes no operands'), st.ops[0].col);
    return encode(BY_MN.get('TRAP')!, { imm: 0 });
  }
  const def = BY_MN.get(st.name)!;
  const ops = st.ops;
  const L = (n: number) => {
    if (ops.length !== n) {
      const hint = '';
      throw new AsmError(
        txt(
          `${def.mn} vuole ${n === 0 ? 'nessun operando' : n === 1 ? '1 operando' : `${n} operandi`} (ne hai scritti ${ops.length}). Sintassi: ${syntaxOf(def)} — es. ${def.example}${hint}`,
          `${def.mn} takes ${n} operand(s) (you wrote ${ops.length}). Syntax: ${syntaxOf(def)} — e.g. ${def.example}${hint}`,
        ),
        st.nameCol,
        def.mn.length,
      );
    }
  };
  const rdWarn = (rd: number, p: Piece) => {
    if (rd === 0 && (WRITES_RD.has(def.group) || def.mn === 'MOVS2I')) {
      diags.push({
        line: st.line, from: p.col, to: p.col + p.text.length, severity: 'warning',
        text: txt('R0 vale sempre 0: scriverci non ha effetto (nelle slide R0 non può essere destinazione).', 'R0 is always 0: writing to it has no effect.'),
      });
    }
  };
  const f: Fields = {};
  switch (def.shape) {
    case 'rrr': {
      L(3);
      if (!isReg(ops[2]) && ops[2].text) {
        const immVer = BY_MN.get(def.mn + 'I') ?? BY_MN.get(def.mn.replace(/U$/, 'UI'));
        if (immVer) {
          throw new AsmError(
            txt(`${def.mn} lavora solo con registri; con una costante usa ${immVer.mn} (es. ${immVer.example}).`, `${def.mn} works only with registers; with a constant use ${immVer.mn} (e.g. ${immVer.example}).`),
            st.nameCol, def.mn.length,
            { from: st.nameCol, to: st.nameCol + def.mn.length, insert: immVer.mn, label: txt(`Usa ${immVer.mn}`, `Use ${immVer.mn}`) },
          );
        }
      }
      f.rd = parseReg(ops[0], txt('il registro destinazione Rd', 'destination register Rd'));
      f.rs1 = parseReg(ops[1], txt('il primo registro sorgente Rs1', 'first source register Rs1'));
      f.rs2 = parseReg(ops[2], txt('il secondo registro sorgente Rs2', 'second source register Rs2'));
      rdWarn(f.rd, ops[0]);
      break;
    }
    case 'rri': {
      L(3);
      if (isReg(ops[2])) {
        const regVer = BY_MN.get(def.mn.replace(/UI$/, 'U').replace(/I$/, ''));
        throw new AsmError(
          txt(`${def.mn} vuole una costante come terzo operando; tra registri usa ${regVer?.mn ?? def.mn.slice(0, -1)}.`, `${def.mn} needs a constant as third operand; between registers use ${regVer?.mn ?? def.mn.slice(0, -1)}.`),
          st.nameCol, def.mn.length,
          regVer ? { from: st.nameCol, to: st.nameCol + def.mn.length, insert: regVer.mn, label: txt(`Usa ${regVer.mn}`, `Use ${regVer.mn}`) } : undefined,
        );
      }
      f.rd = parseReg(ops[0], txt('il registro destinazione Rd', 'destination register Rd'));
      f.rs1 = parseReg(ops[1], txt('il registro sorgente Rs1', 'source register Rs1'));
      f.imm = checkImm16(evaluate(ops[2].text, ops[2].col, ctx), def, ops[2].col, ops[2].text.length, ctx);
      rdWarn(f.rd, ops[0]);
      break;
    }
    case 'ri': {
      L(2);
      f.rd = parseReg(ops[0], txt('il registro destinazione Rd', 'destination register Rd'));
      const v = evaluate(ops[1].text, ops[1].col, ctx);
      if (v > 0xffff || v < -0x8000) {
        const sugg = (v >>> 16) & 0xffff;
        throw new AsmError(
          txt(`LHI vuole i 16 bit ALTI (max 0xFFFF). Per ottenere ${hexShort(v >>> 0)} scrivi LHI ${ops[0].text},${hexShort(sugg)}.`, `LHI takes the HIGH 16 bits (max 0xFFFF). To get ${hexShort(v >>> 0)} write LHI ${ops[0].text},${hexShort(sugg)}.`),
          ops[1].col, ops[1].text.length,
          { from: ops[1].col, to: ops[1].col + ops[1].text.length, insert: hexShort(sugg), label: txt(`Usa ${hexShort(sugg)}`, `Use ${hexShort(sugg)}`) },
        );
      }
      f.imm = v & 0xffff;
      rdWarn(f.rd, ops[0]);
      break;
    }
    case 'load': {
      L(2);
      if (isMem(ops[0]) && isReg(ops[1])) {
        throw new AsmError(txt(`Nelle load il registro destinazione va per primo: ${def.mn} ${ops[1].text},${ops[0].text}`, `In loads the destination register comes first: ${def.mn} ${ops[1].text},${ops[0].text}`), ops[0].col, ops[0].text.length);
      }
      f.rd = parseReg(ops[0], txt('il registro destinazione Rd', 'destination register Rd'));
      const mem = parseMem(ops[1], ctx);
      f.rs1 = mem.base;
      f.imm = checkMemOffset(mem.off, mem.offCol, mem.offLen, mem.base);
      rdWarn(f.rd, ops[0]);
      break;
    }
    case 'store': {
      L(2);
      let regP: Piece, memP: Piece;
      if (isReg(ops[0]) && !isReg(ops[1])) { regP = ops[0]; memP = ops[1]; }
      else if (isReg(ops[1]) && isMem(ops[0])) { regP = ops[1]; memP = ops[0]; }
      else { regP = ops[0]; memP = ops[1]; }
      f.rs2 = parseReg(regP, txt('il registro da scrivere in memoria', 'the register to store'));
      const mem = parseMem(memP, ctx);
      f.rs1 = mem.base;
      f.imm = checkMemOffset(mem.off, mem.offCol, mem.offLen, mem.base);
      break;
    }
    case 'branch': {
      L(2);
      f.rs1 = parseReg(ops[0], txt('il registro da testare', 'the register to test'));
      f.imm = branchOffset(ops[1], st, ctx, 16);
      break;
    }
    case 'jump': {
      L(1);
      if (isReg(ops[0])) {
        const alt = def.mn === 'J' ? 'JR' : 'JALR';
        throw new AsmError(txt(`${def.mn} vuole un'etichetta; per saltare all'indirizzo contenuto in un registro usa ${alt} ${ops[0].text}.`, `${def.mn} needs a label; to jump to a register use ${alt} ${ops[0].text}.`), st.nameCol, def.mn.length,
          { from: st.nameCol, to: st.nameCol + def.mn.length, insert: alt, label: txt(`Usa ${alt}`, `Use ${alt}`) });
      }
      f.imm = branchOffset(ops[0], st, ctx, 26);
      break;
    }
    case 'jreg': {
      L(1);
      if (!isReg(ops[0])) {
        const alt = def.mn === 'JR' ? 'J' : 'JAL';
        throw new AsmError(txt(`${def.mn} vuole un registro; per saltare a un'etichetta usa ${alt}.`, `${def.mn} needs a register; to jump to a label use ${alt}.`), st.nameCol, def.mn.length,
          { from: st.nameCol, to: st.nameCol + def.mn.length, insert: alt, label: txt(`Usa ${alt}`, `Use ${alt}`) });
      }
      f.rs1 = parseReg(ops[0], txt('il registro con l\'indirizzo di destinazione', 'the register holding the target'));
      break;
    }
    case 'movi2s': {
      L(2);
      if (ops[0].text.toUpperCase() !== 'IAR') {
        throw new AsmError(txt(`Il primo operando di MOVI2S deve essere il registro speciale IAR (es. MOVI2S IAR,R1).`, `The first operand of MOVI2S must be the special register IAR.`), ops[0].col, ops[0].text.length);
      }
      f.rd = 0;
      f.rs1 = parseReg(ops[1], txt('il registro sorgente', 'the source register'));
      break;
    }
    case 'movs2i': {
      L(2);
      if (ops[1].text.toUpperCase() !== 'IAR') {
        throw new AsmError(txt(`Il secondo operando di MOVS2I deve essere il registro speciale IAR (es. MOVS2I R1,IAR).`, `The second operand of MOVS2I must be the special register IAR.`), ops[1].col, ops[1].text.length);
      }
      f.rd = parseReg(ops[0], txt('il registro destinazione', 'destination register'));
      f.rs1 = 0;
      rdWarn(f.rd, ops[0]);
      break;
    }
    case 'trap': {
      L(1);
      const v = evaluate(ops[0].text, ops[0].col, ctx);
      if (v < 0 || v > 0x3ffffff) throw new AsmError(txt('Il valore di TRAP deve stare in 26 bit', 'TRAP value must fit in 26 bits'), ops[0].col, ops[0].text.length);
      f.imm = v;
      break;
    }
    case 'none':
      L(0);
      break;
  }
  return encode(def, f);

  function checkMemOffset(off: number, col: number, len: number, base: number): number {
    if (off < -0x8000 || off > 0xffff) {
      const hi = (off >>> 16) & 0xffff;
      throw new AsmError(
        txt(
          `L'offset ${hexShort(off >>> 0)} non sta in 16 bit. Metti prima la parte alta in un registro, es. LHI R1,${hexShort(hi)} e poi usa ${hexShort(off & 0xffff)}(R1).${base === 0 ? ' (Gli indirizzi alti come 0x40000000 non si raggiungono con R0 come base.)' : ''}`,
          `Offset ${hexShort(off >>> 0)} does not fit in 16 bits. Load the high part into a register first, e.g. LHI R1,${hexShort(hi)} then use ${hexShort(off & 0xffff)}(R1).`,
        ),
        col, len,
      );
    }
    if (off >= 0x8000) {
      ctx.warn({
        from: col, to: col + len, severity: 'info',
        text: txt(`L'offset è esteso con segno: ${hexShort(off)} vale ${off - 0x10000}, quindi l'indirizzo sarà base ${off - 0x10000 < 0 ? '-' : '+'} ${Math.abs(off - 0x10000)}.`,
          `The offset is sign-extended: ${hexShort(off)} means ${off - 0x10000}.`),
      });
    }
    return off & 0xffff;
  }
}

function branchOffset(p: Piece, st: Stmt, ctx: EvalCtx, bits: 16 | 26): number {
  const isLabel = /^[A-Za-z_.$]/.test(p.text) && !/^(hi|lo)\(/i.test(p.text);
  ctx.usedSymbol = false;
  const v = evaluate(p.text, p.col, ctx);
  let off: number;
  if (isLabel || ctx.usedSymbol) {
    off = v - (st.addr + 4);
  } else {
    off = v;
    ctx.warn({
      from: p.col, to: p.col + p.text.length, severity: 'info',
      text: txt(`Numero interpretato come spiazzamento (in byte) relativo a PC+4: salto a ${hex((st.addr + 4 + v) >>> 0)}. Di solito è più comodo usare un'etichetta.`,
        `Number taken as a byte offset relative to PC+4: target ${hex((st.addr + 4 + v) >>> 0)}. Using a label is usually easier.`),
    });
  }
  if (off % 4 !== 0) {
    throw new AsmError(txt('La destinazione del salto deve essere allineata a 4 byte.', 'Jump target must be 4-byte aligned.'), p.col, p.text.length);
  }
  const lim = 2 ** (bits - 1);
  if (off < -lim || off >= lim) {
    throw new AsmError(
      txt(`Destinazione troppo lontana: lo spiazzamento ${off} non sta in ${bits} bit con segno.${bits === 16 ? ' Usa un BEQZ/BNEZ verso un J vicino, oppure JR.' : ' Usa JR con un registro.'}`,
        `Target too far: offset ${off} does not fit in ${bits} signed bits.`),
      p.col, p.text.length,
    );
  }
  return off & (bits === 16 ? 0xffff : 0x3ffffff);
}

/** Elenco dei mnemonici per editor / autocomplete. */
export const ALL_MNEMONICS = [...INSTRUCTIONS.map((d) => d.mn), ...Object.keys(PSEUDO)];
export const ALL_DIRECTIVES = DIRECTIVES;
