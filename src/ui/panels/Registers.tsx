import { useState } from 'react';
import { useStore } from '../store';
import { tr } from '../../i18n';
import { bin, hex } from '../../core/util';
import { disassemble } from '../../core/isa/encode';

type Fmt = 'hex' | 'dec' | 'udec' | 'bin';
const FMTS: Fmt[] = ['hex', 'dec', 'udec', 'bin'];
const FMT_LABEL: Record<Fmt, string> = { hex: 'HEX', dec: 'DEC±', udec: 'DEC+', bin: 'BIN' };

export const fmtVal = (v: number, f: Fmt) =>
  f === 'hex' ? hex(v) : f === 'dec' ? String(v | 0) : f === 'udec' ? String(v >>> 0) : bin(v).replace(/(.{8})(?=.)/g, '$1 ');

export function Registers() {
  const lang = useStore((s) => s.lang);
  useStore((s) => s.version);
  const m = useStore((s) => s.machine);
  const last = useStore((s) => s.last);
  const [fmt, setFmt] = useState<Fmt>('hex');
  const [per, setPer] = useState<Record<number, Fmt>>({});
  const cpu = m.cpu;
  const changed = new Map(last?.regWrites.map((w) => [w.reg, w.old]) ?? []);
  const cycle = (i: number) => setPer((p) => ({ ...p, [i]: FMTS[(FMTS.indexOf(p[i] ?? fmt) + 1) % FMTS.length] }));

  const special: [string, number, string][] = [
    ['PC', cpu.pc, lang === 'it' ? 'Program Counter: indirizzo della prossima istruzione' : 'Program Counter: address of next instruction'],
    ['IAR', cpu.iar, lang === 'it' ? 'Interrupt Address Register: indirizzo di ritorno dall\'interrupt' : 'Interrupt Address Register: return address from interrupt'],
    ['IR', cpu.ir, lang === 'it' ? `Instruction Register: ${disassemble(cpu.ir)}` : `Instruction Register: ${disassemble(cpu.ir)}`],
    ['MAR', cpu.mar, lang === 'it' ? 'Memory Address Register: ultimo indirizzo usato verso la memoria' : 'Memory Address Register'],
    ['MDR', cpu.mdr, lang === 'it' ? 'Memory Data Register: ultimo dato letto/scritto' : 'Memory Data Register'],
  ];
  const intLine = m.bus.intLine();

  return (
    <section className="panel regs">
      <header className="panel-h">
        <h2>{tr(lang, 'registers')}</h2>
        <div className="seg" role="group">
          {FMTS.map((f) => (
            <button key={f} className={f === fmt ? 'on' : ''} onClick={() => { setFmt(f); setPer({}); }}>{FMT_LABEL[f]}</button>
          ))}
        </div>
      </header>
      <div className="special-regs">
        {special.map(([n, v, tip]) => (
          <div key={n} className={'sreg' + (n === 'IAR' && last?.interrupt ? ' changed' : '')} title={tip}>
            <span className="rname">{n}</span>
            <span className="rval mono">{hex(v)}</span>
          </div>
        ))}
        <div className={'sreg flag' + (cpu.ien ? ' on' : '')} title={tr(lang, 'ien')}>
          <span className="rname">IEN</span><span className="rval mono">{cpu.ien ? 1 : 0}</span>
        </div>
        <div className={'sreg flag' + (intLine ? ' int' : '')} title={tr(lang, 'intLine')}>
          <span className="rname">INT</span><span className="rval mono">{intLine ? 1 : 0}</span>
        </div>
      </div>
      <div className={'gp-regs' + (fmt === 'bin' ? ' wide' : '')}>
        {Array.from(cpu.regs).map((v, i) => {
          const f = per[i] ?? fmt;
          const old = changed.get(i);
          const garbage = !cpu.regInit[i];
          return (
            <button
              key={i}
              className={'reg' + (old !== undefined ? ' changed' : '') + (garbage ? ' garbage' : '')}
              onClick={() => cycle(i)}
              title={
                (old !== undefined ? `${tr(lang, 'was')}: ${hex(old)} (${old | 0})\n` : '') +
                `${hex(v)} = ${v | 0} = ${v >>> 0}` +
                (garbage ? (lang === 'it' ? '\nMai scritto: valore casuale dall\'accensione' : '\nNever written: random power-on value') : '') +
                (i === 0 ? (lang === 'it' ? '\nR0 vale sempre 0' : '\nR0 is always 0') : i === 31 ? (lang === 'it' ? '\nR31: indirizzo di ritorno di JAL/JALR' : '\nR31: JAL/JALR return address') : '')
              }
            >
              <span className="rname">R{i}</span>
              <span className="rval mono">{fmtVal(v, f)}</span>
            </button>
          );
        })}
      </div>
      <p className="hint">{lang === 'it' ? 'Clic su un registro per cambiarne il formato. In grigio: mai scritti (valore casuale).' : 'Click a register to change its format. Grey: never written (random value).'}</p>
    </section>
  );
}
