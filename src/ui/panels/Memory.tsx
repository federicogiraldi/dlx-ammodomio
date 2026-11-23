import { useState } from 'react';
import { useStore } from '../store';
import { tr } from '../../i18n';
import { hex } from '../../core/util';
import { decode, disassemble } from '../../core/isa/encode';
import { MemoryDevice } from '../../core/bus/devices';
import { labelAt } from './Explain';

const ROWS = 24;

export function Memory() {
  const lang = useStore((s) => s.lang);
  useStore((s) => s.version);
  const m = useStore((s) => s.machine);
  const touched = useStore((s) => s.touched);
  const view = useStore((s) => s.memView);
  const setView = useStore((s) => s.setMemView);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [mode, setMode] = useState<'word' | 'byte'>('word');
  const prog = m.program;
  const base = (view & ~3) >>> 0;

  const go = () => {
    const s = q.trim();
    if (!s) return;
    const sym = prog && [...prog.symbols.entries()].find(([k]) => k.toLowerCase() === s.toLowerCase());
    let a: number | null = null;
    if (sym) a = sym[1].value;
    else if (/^0x[0-9a-f]+$/i.test(s)) a = parseInt(s, 16);
    else if (/^[0-9a-f]+h$/i.test(s)) a = parseInt(s, 16);
    else if (/^\d+$/.test(s)) a = parseInt(s, 10);
    else if (/^r\d+$/i.test(s) && Number(s.slice(1)) < 32) a = m.cpu.regs[Number(s.slice(1))];
    if (a === null) { setErr(lang === 'it' ? 'Non trovato' : 'Not found'); return; }
    setErr('');
    setView(a);
  };

  const rows = [];
  for (let r = 0; r < ROWS; r++) {
    const addr = (base + r * 4) >>> 0;
    const w = m.bus.peekWord(addr);
    const dev = w.device;
    const isMem = dev instanceof MemoryDevice;
    const isCode = prog?.addrToLine.has(addr);
    const lab = labelAt(m, addr);
    const bytes = [0, 1, 2, 3].map((i) => m.bus.peek(addr + i));
    const isTouched = [0, 1, 2, 3].some((i) => touched.has((addr + i) >>> 0));
    const isPC = addr === m.cpu.pc;
    rows.push(
      <tr key={addr} className={(isTouched ? 'touched ' : '') + (isPC ? 'pcrow ' : '')}>
        <td className="mono addr">{isPC ? '▶ ' : ''}{hex(addr)}</td>
        <td className="lab">{lab ? `${lab}:` : ''}</td>
        {!dev ? (
          <td colSpan={3} className="muted">{lang === 'it' ? '— nessun dispositivo —' : '— no device —'}</td>
        ) : !isMem ? (
          <td colSpan={3} className="muted">{dev.cfg.name} {lang === 'it' ? '(periferica: vedi tab Periferiche)' : '(peripheral: see Devices tab)'}</td>
        ) : (
          <>
            <td className={'mono val' + (w.init ? '' : ' garbage')}>
              {mode === 'word'
                ? hex(w.value)
                : bytes.map((b, i) => <span key={i} className={'byte' + (b.init ? '' : ' garbage') + (touched.has((addr + i) >>> 0) ? ' tb' : '')}>{b.value.toString(16).toUpperCase().padStart(2, '0')}</span>)}
            </td>
            <td className="mono dec">{w.init ? (w.value | 0) : '?'}</td>
            <td className="mono dis">{isCode ? disassemble(w.value, addr, (a) => labelAt(m, a)) : w.init && dev.cfg.kind === 'eprom' && decode(w.value) && w.value !== 0xffffffff ? <span className="muted">{disassemble(w.value, addr)}</span> : bytes.every((b) => b.init && b.value >= 32 && b.value < 127) ? <span className="muted">"{bytes.map((b) => String.fromCharCode(b.value)).join('')}"</span> : ''}</td>
          </>
        )}
      </tr>,
    );
  }

  const quick: [string, number][] = [
    ['PC', m.cpu.pc],
    ...m.map.filter((d) => d.kind === 'ram' || d.kind === 'eprom').map((d) => [d.name, d.base] as [string, number]),
  ];

  return (
    <section className="panel memory">
      <header className="panel-h">
        <h2>{tr(lang, 'memory')}</h2>
        <div className="seg">
          <button className={mode === 'word' ? 'on' : ''} onClick={() => setMode('word')}>WORD</button>
          <button className={mode === 'byte' ? 'on' : ''} onClick={() => setMode('byte')}>BYTE</button>
        </div>
      </header>
      <div className="mem-tools">
        <form onSubmit={(e) => { e.preventDefault(); go(); }} className="goto">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr(lang, 'gotoPh')} aria-label={tr(lang, 'goto')} />
          <button type="submit">{tr(lang, 'goto')}</button>
          {err && <span className="err-text">{err}</span>}
        </form>
        <div className="quick">
          {quick.map(([n, a]) => <button key={n} className="chip-btn" onClick={() => setView(a)}>{n}</button>)}
          {prog && [...prog.symbols.entries()].filter(([, s]) => s.kind === 'label' && !prog.addrToLine.has(s.value)).slice(0, 8).map(([n, s]) => (
            <button key={n} className="chip-btn data" onClick={() => setView(s.value)}>{n}</button>
          ))}
        </div>
        <div className="pager">
          <button onClick={() => setView(base - ROWS * 4)} aria-label="su">▲</button>
          <button onClick={() => setView(base + ROWS * 4)} aria-label="giù">▼</button>
        </div>
      </div>
      <div className="mem-scroll">
        <table className="memtable">
          <thead><tr><th>{lang === 'it' ? 'Indirizzo' : 'Address'}</th><th></th><th>{mode === 'word' ? 'Word (big-endian)' : 'Byte +0 +1 +2 +3'}</th><th>dec</th><th>{lang === 'it' ? 'Contenuto' : 'Content'}</th></tr></thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
      <p className="hint">{lang === 'it' ? 'Arancione = celle mai scritte (valore casuale in RAM). Azzurro = toccate dall\'ultima istruzione. ▶ = PC.' : 'Orange = never written (random RAM value). Blue = touched by the last instruction. ▶ = PC.'}</p>
    </section>
  );
}
