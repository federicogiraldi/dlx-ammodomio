import { useStore } from '../store';
import { tr } from '../../i18n';
import { bin, hex } from '../../core/util';
import { Decoded, decode, disassemble } from '../../core/isa/encode';

/** Codifica binaria dell'istruzione colorata per campi (layout delle slide). */
export function Encoding({ d }: { d: Decoded }) {
  const b = bin(d.word);
  const lang = useStore((s) => s.lang);
  let fields: { bits: string; label: string; cls: string; val: string }[];
  const fld = (from: number, to: number) => b.slice(31 - from, 32 - to);
  if (d.def.fmt === 'R') {
    fields = [
      { bits: fld(31, 26), label: 'opcode', cls: 'op', val: '0' },
      { bits: fld(25, 21), label: 'RS2', cls: 'rs2', val: `R${d.rs2}` },
      { bits: fld(20, 16), label: 'RS1', cls: 'rs1', val: `R${d.rs1}` },
      { bits: fld(15, 11), label: 'Rd', cls: 'rd', val: `R${d.rd}` },
      { bits: fld(10, 0), label: 'func', cls: 'func', val: hex(d.word & 0x7ff, 3) },
    ];
  } else if (d.def.fmt === 'I') {
    const store = d.def.shape === 'store';
    fields = [
      { bits: fld(31, 26), label: 'opcode', cls: 'op', val: hex(d.word >>> 26, 2) },
      { bits: fld(25, 21), label: store ? 'RS2' : 'Rd', cls: store ? 'rs2' : 'rd', val: `R${d.rs2}` },
      { bits: fld(20, 16), label: 'RS1', cls: 'rs1', val: `R${d.rs1}` },
      { bits: fld(15, 0), label: 'imm16', cls: 'imm', val: hex(d.imm16, 4) },
    ];
  } else {
    fields = [
      { bits: fld(31, 26), label: 'opcode', cls: 'op', val: hex(d.word >>> 26, 2) },
      { bits: fld(25, 0), label: lang === 'it' ? 'offset 26 bit' : '26-bit offset', cls: 'imm', val: hex(d.imm26, 7) },
    ];
  }
  return (
    <div className="encoding" aria-label={tr(lang, 'encoding')}>
      <div className="enc-row">
        {fields.map((f, i) => (
          <div key={i} className={'enc-f f-' + f.cls} style={{ flexGrow: f.bits.length }}>
            <span className="enc-bits mono">{f.bits}</span>
            <span className="enc-label">{f.label} <b className="mono">{f.val}</b></span>
          </div>
        ))}
      </div>
      <div className="enc-meta">
        {lang === 'it' ? 'Formato' : 'Format'} <b>{d.def.fmt}</b> · {hex(d.word)} · <span className="mono">{d.def.rtl}</span>
      </div>
    </div>
  );
}

export function Explain() {
  const lang = useStore((s) => s.lang);
  useStore((s) => s.version);
  const last = useStore((s) => s.last);
  const m = useStore((s) => s.machine);
  const err = useStore((s) => s.runtimeError);
  const dirty = useStore((s) => s.dirty);
  const line = last ? m.program?.addrToLine.get(last.pc) : undefined;

  // anteprima della prossima istruzione
  const pc = m.cpu.pc;
  const nw = m.bus.peekWord(pc);
  const nextD = nw.device && !m.cpu.halted ? decode(nw.value) : null;
  const nextLine = m.lineOfPC();

  return (
    <section className="panel explain">
      <header className="panel-h"><h2>{tr(lang, 'whatHappened')}</h2>
        {last && <span className="chip">{lang === 'it' ? 'istruzione n.' : 'instruction #'}{m.cpu.instret}</span>}
      </header>
      {err && (
        <div className="alert error" role="alert">
          <b>{lang === 'it' ? 'Errore durante l\'esecuzione' : 'Runtime error'}</b>
          {err.line !== undefined && <> — {lang === 'it' ? 'riga' : 'line'} {err.line}</>}
          <p>{err.text[lang]}</p>
          <small>{lang === 'it' ? 'L\'istruzione non è stata eseguita: lo stato è quello di prima.' : 'The instruction was not executed: state is unchanged.'}</small>
        </div>
      )}
      {!last && !err && <p className="empty">{tr(lang, 'nothingYet')}</p>}
      {last && (
        <div className="ex-body">
          <div className="ex-title">
            <code className="ex-instr">{last.text}</code>
            <span className="ex-where mono">@ {hex(last.pc)}{line !== undefined && <> · {lang === 'it' ? 'riga' : 'line'} {line}</>}</span>
            {last.taken !== undefined && <span className={'chip ' + (last.taken ? 'ok' : '')}>{last.taken ? (lang === 'it' ? 'salto preso' : 'taken') : (lang === 'it' ? 'non preso' : 'not taken')}</span>}
            <span className="chip">{last.clocks} {tr(lang, 'clocks')}</span>
          </div>
          <ol className="ex-lines">
            {last.explanation.map((e, i) => (
              <li key={i} className={e.it.startsWith('⚠') ? 'warn' : e.it.startsWith('⚡') ? 'int' : ''}>{e[lang]}</li>
            ))}
          </ol>
          {last.mem.filter((a) => a.kind !== 'fetch').length > 0 && (
            <table className="mini">
              <caption>{tr(lang, 'memAccesses')}</caption>
              <tbody>
                {last.mem.filter((a) => a.kind !== 'fetch').map((a, i) => (
                  <tr key={i}>
                    <td>{a.kind === 'read' ? (lang === 'it' ? 'lettura' : 'read') : (lang === 'it' ? 'scrittura' : 'write')}</td>
                    <td className="mono">{hex(a.addr)}</td>
                    <td>{a.size} B</td>
                    <td className="mono">{hex(a.value, a.size * 2)}</td>
                    <td>{a.device}{a.cs ? ` · ${a.cs}` : ''}{a.garbage ? ' ⚠' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Encoding d={last.decoded} />
        </div>
      )}
      {!dirty && nextD && !err && (
        <div className="next-preview">
          <span className="label">{tr(lang, 'nextInstr')}:</span> <code>{disassemble(nw.value, pc, (a) => labelAt(m, a))}</code>
          <span className="mono muted"> @ {hex(pc)}{nextLine !== undefined && ` · ${lang === 'it' ? 'riga' : 'line'} ${nextLine}`}</span>
        </div>
      )}
      {m.cpu.halted && <div className="alert ok">{tr(lang, 'halted')}</div>}
    </section>
  );
}

export function labelAt(m: { program: { symbols: Map<string, { value: number; kind: string }> } | null }, addr: number): string | undefined {
  if (!m.program) return undefined;
  for (const [k, v] of m.program.symbols) if (v.kind === 'label' && v.value === addr) return k;
  return undefined;
}
