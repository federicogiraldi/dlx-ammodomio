import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { BY_MN, PSEUDO } from '../../core/isa/table';

interface S { start: boolean }

/** Evidenziazione sintattica DLX (stream parser semplice). */
export const dlxLanguage = StreamLanguage.define<S>({
  name: 'dlx',
  startState: () => ({ start: true }),
  token(stream, state) {
    if (stream.sol()) state.start = true;
    if (stream.eatSpace()) return null;
    if (stream.match(/^(;|\/\/|#).*/)) return 'comment';
    if (stream.match(/^"(?:\\.|[^"\\])*"?/)) return 'string';
    if (stream.match(/^'(?:\\.|[^'])'/)) return 'string';
    if (state.start && stream.match(/^[A-Za-z_.$][\w.$]*\s*:/)) return 'labelName';
    if (stream.match(/^\.[A-Za-z]+/)) { state.start = false; return 'meta'; }
    if (stream.match(/^(0x[0-9a-f]+|0b[01]+|[0-9][0-9a-f]*h\b|-?[0-9]+)/i)) return 'number';
    const w = stream.match(/^[A-Za-z_$][\w.$]*/) as RegExpMatchArray | null;
    if (w) {
      const word = w[0].toUpperCase();
      if (state.start && (BY_MN.has(word) || PSEUDO[word])) { state.start = false; return 'keyword'; }
      state.start = false;
      if (/^R([0-9]|[12][0-9]|3[01])$/.test(word) || word === 'IAR') return 'variableName';
      if (word === 'EQU') return 'meta';
      return 'name';
    }
    stream.next();
    state.start = false;
    return null;
  },
  languageData: { commentTokens: { line: ';' } },
});

export const dlxHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.comment, color: 'var(--text-2)', fontStyle: 'italic' },
    { tag: t.keyword, color: 'var(--f-op)', fontWeight: '600' },
    { tag: t.variableName, color: 'var(--f-rs1)' },
    { tag: t.number, color: 'var(--f-imm)' },
    { tag: t.labelName, color: 'var(--f-rd)', fontWeight: '600' },
    { tag: t.name, color: 'var(--f-rd)' },
    { tag: t.meta, color: 'var(--f-rs2)' },
    { tag: t.string, color: 'var(--warn)' },
  ]),
);
