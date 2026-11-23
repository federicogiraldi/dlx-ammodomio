import { useEffect, useRef } from 'react';
import { EditorState, StateEffect, StateField, RangeSetBuilder, Compartment } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, Decoration,
  gutter, GutterMarker, hoverTooltip, drawSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { autocompletion, CompletionContext, CompletionResult, completionKeymap } from '@codemirror/autocomplete';
import { linter, Diagnostic as CMDiag, lintGutter } from '@codemirror/lint';
import { dlxLanguage, dlxHighlight } from './dlxLanguage';
import { useStore } from '../store';
import { assemble, Program } from '../../core/asm/assembler';
import { BY_MN, INSTRUCTIONS, PSEUDO, syntaxOf } from '../../core/isa/table';
import { Lang } from '../../i18n';

// ---------- evidenziazione righe (prossima / eseguita / errore / breakpoint) ----------
interface Marks { next?: number; done?: number; error?: number; bps: Set<number> }
const setMarks = StateEffect.define<Marks>();
const marksField = StateField.define<Marks>({
  create: () => ({ bps: new Set() }),
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setMarks)) return e.value;
    return v;
  },
});
const lineDecos = EditorView.decorations.compute([marksField], (state) => {
  const m = state.field(marksField);
  const b = new RangeSetBuilder<Decoration>();
  const lines: [number, string][] = [];
  const add = (l: number | undefined, cls: string) => {
    if (l !== undefined && l >= 1 && l <= state.doc.lines) lines.push([l, cls]);
  };
  add(m.done, 'cm-done');
  add(m.next, 'cm-next');
  add(m.error, 'cm-errline');
  for (const l of m.bps) add(l, 'cm-bpline');
  lines.sort((a, b2) => a[0] - b2[0]);
  for (const [l, cls] of lines) {
    const line = state.doc.line(l);
    b.add(line.from, line.from, Decoration.line({ class: cls }));
  }
  return b.finish();
});

// ---------- gutter indirizzi + breakpoint ----------
const setProgram = StateEffect.define<Program | null>();
const programField = StateField.define<Program | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setProgram)) return e.value;
    return v;
  },
});
class AddrMarker extends GutterMarker {
  constructor(readonly addr: number | undefined, readonly bp: boolean, readonly isNext: boolean) { super(); }
  eq(o: AddrMarker) { return o.addr === this.addr && o.bp === this.bp && o.isNext === this.isNext; }
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-addr' + (this.bp ? ' bp' : '') + (this.isNext ? ' next' : '');
    el.textContent = this.addr === undefined ? '' : (this.addr >>> 0).toString(16).toUpperCase().padStart(8, '0');
    if (this.bp) el.title = 'Breakpoint';
    return el;
  }
}

function addrGutter(onToggle: (line: number) => void) {
  return gutter({
    class: 'cm-addr-gutter',
    lineMarker(view, line) {
      const p = view.state.field(programField);
      const m = view.state.field(marksField);
      const ln = view.state.doc.lineAt(line.from).number;
      const a = p?.lineToAddr.get(ln);
      return new AddrMarker(a, m.bps.has(ln), m.next === ln);
    },
    lineMarkerChange: (u) => u.transactions.some((t) => t.effects.some((e) => e.is(setProgram) || e.is(setMarks))),
    initialSpacer: () => new AddrMarker(0, false, false),
    domEventHandlers: {
      mousedown(view, line) {
        onToggle(view.state.doc.lineAt(line.from).number);
        return true;
      },
    },
  });
}

// ---------- autocompletamento ----------
function completions(langRef: { current: Lang }) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const word = ctx.matchBefore(/[\w.]*/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from).replace(/;.*$/, '');
    const stripped = before.replace(/^\s*([A-Za-z_.$][\w.$]*\s*:\s*)*/, '');
    const atMnemonic = /^\s*[\w.]*$/.test(stripped);
    const lang = langRef.current;
    if (atMnemonic) {
      return {
        from: word.from,
        options: [
          ...INSTRUCTIONS.map((d) => ({ label: d.mn, type: 'keyword', detail: syntaxOf(d).slice(d.mn.length + 1), info: d.doc[lang] })),
          ...Object.entries(PSEUDO).map(([k, v]) => ({ label: k, type: 'keyword', info: v.doc[lang] })),
          ...['.data', '.text', '.word', '.half', '.byte', '.space', '.asciiz', '.ascii', '.align', '.org', '.equ'].map((d) => ({ label: d, type: 'namespace' })),
        ],
      };
    }
    const labels = [...assemble(ctx.state.doc.toString()).symbols.keys()];
    return {
      from: word.from,
      options: [
        ...Array.from({ length: 32 }, (_, i) => ({ label: `R${i}`, type: 'variable', detail: i === 0 ? '= 0' : i === 31 ? 'link' : '' })),
        { label: 'IAR', type: 'variable' },
        ...labels.map((l) => ({ label: l, type: 'constant' })),
      ],
    };
  };
}

// ---------- tooltip su istruzione ----------
function hoverDoc(langRef: { current: Lang }) {
  return hoverTooltip((view, pos) => {
    const { from, to, text } = view.state.doc.lineAt(pos);
    let s = pos, e = pos;
    while (s > from && /\w/.test(text[s - from - 1])) s--;
    while (e < to && /\w/.test(text[e - from])) e++;
    const w = text.slice(s - from, e - from).toUpperCase();
    const d = BY_MN.get(w);
    if (!d) return null;
    return {
      pos: s, end: e, above: true,
      create() {
        const dom = document.createElement('div');
        dom.className = 'cm-doc-tip';
        dom.innerHTML = `<div class="tip-syntax"></div><div class="tip-rtl"></div><div class="tip-doc"></div>`;
        (dom.children[0] as HTMLElement).textContent = `${syntaxOf(d)}   [${d.fmt}]`;
        (dom.children[1] as HTMLElement).textContent = d.rtl;
        (dom.children[2] as HTMLElement).textContent = d.doc[langRef.current];
        return { dom };
      },
    };
  });
}

export function Editor() {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>();
  const langRef = useRef<Lang>(useStore.getState().lang);
  const lintComp = useRef(new Compartment());
  const lang = useStore((s) => s.lang);
  const source = useStore((s) => s.source);
  const version = useStore((s) => s.version);
  const breakLines = useStore((s) => s.breakLines);
  const runtimeError = useStore((s) => s.runtimeError);
  const dirty = useStore((s) => s.dirty);

  useEffect(() => {
    langRef.current = lang;
    // ricalcola il lint nella nuova lingua
    view.current?.dispatch({ effects: lintComp.current.reconfigure(makeLinter()) });
  }, [lang]);

  function makeLinter() {
    return linter(
      (v) => {
        const prog = assemble(v.state.doc.toString(), { dataBase: useStore.getState().machine.dataBase() });
        const out: CMDiag[] = [];
        for (const d of prog.diagnostics) {
          if (d.line > v.state.doc.lines) continue;
          const line = v.state.doc.line(d.line);
          const from = Math.min(line.from + d.from, line.to);
          const to = Math.max(from, Math.min(line.from + Math.max(d.to, d.from + 1), line.to));
          out.push({
            from, to: to === from && line.to > from ? from + 1 : to,
            severity: d.severity,
            message: d.text[langRef.current],
            actions: d.fix ? [{
              name: d.fix.label[langRef.current],
              apply(view2) {
                const l = view2.state.doc.line(d.line);
                view2.dispatch({ changes: { from: l.from + d.fix!.from, to: l.from + d.fix!.to, insert: d.fix!.insert } });
              },
            }] : undefined,
          });
        }
        return out;
      },
      { delay: 250 },
    );
  }

  useEffect(() => {
    const st = useStore.getState();
    const state = EditorState.create({
      doc: st.source,
      extensions: [
        lineNumbers(),
        addrGutter((l) => useStore.getState().toggleBreak(l)),
        lintGutter(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        dlxLanguage,
        dlxHighlight,
        marksField,
        programField,
        lineDecos,
        lintComp.current.of(makeLinter()),
        autocompletion({ override: [completions(langRef)], activateOnTyping: true }),
        hoverDoc(langRef),
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...completionKeymap]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) useStore.getState().setSource(u.state.doc.toString());
        }),
        EditorView.theme({}, { dark: false }),
      ],
    });
    view.current = new EditorView({ state, parent: host.current! });
    return () => view.current?.destroy();
  }, []);

  // testo sostituito dall'esterno (esempi, file aperti)
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== source) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: source } });
    }
  }, [source]);

  // evidenziazioni
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const st = useStore.getState();
    const m = st.machine;
    const prog = dirty ? st.live : m.program;
    const next = !dirty && !m.cpu.halted ? m.lineOfPC() : undefined;
    const done = !dirty && st.last ? m.program?.addrToLine.get(st.last.pc) : undefined;
    v.dispatch({
      effects: [
        setProgram.of(prog ?? null),
        setMarks.of({ next, done: done !== next ? done : undefined, error: runtimeError?.line, bps: breakLines }),
      ],
    });
    if (next !== undefined && st.running === false) {
      const line = v.state.doc.line(Math.min(next, v.state.doc.lines));
      v.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'nearest' }) });
    }
  }, [version, breakLines, runtimeError, dirty]);

  return <div className="editor-host" ref={host} />;
}

