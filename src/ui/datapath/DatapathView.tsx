import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { MicroStep } from '../../core/cpu/cpu';
import './datapath.css';

type RegId = 'PC' | 'MAR' | 'MDR' | 'IR' | 'A' | 'B' | 'C' | 'TEMP' | 'IAR';
type Lang = 'it' | 'en';

export interface DatapathViewProps {
  micro: MicroStep[];
  values: Partial<Record<RegId, number>>;
  instructionText?: string;
  lang: Lang;
}

const PHASES: MicroStep['phase'][] = ['FETCH', 'DECODE', 'EXECUTE', 'MEMORY', 'WRITE-BACK', 'INTERRUPT'];

const T = {
  it: {
    title: 'Datapath DLX sequenziale',
    svgTitle: 'Schema del datapath sequenziale del DLX: register file, registri A, B, C, TEMP, PC, IAR, MAR, MDR, IR, bus S1, S2 e dest, ALU, unità di controllo e memoria',
    empty: "Esegui un'istruzione con Step per vedere il datapath in azione",
    steps: 'Micro-operazioni',
    clocks: 'Cicli di clock',
    stepClocks: 'clock',
    prev: 'Micro-operazione precedente',
    next: 'Micro-operazione successiva',
    play: 'Avvia animazione',
    pause: 'Pausa animazione',
    restart: 'Riavvia',
    legend: 'Cosa sono i registri?',
    ctrl: 'Unità di controllo',
    ctrlSub: 'segnali di controllo non mostrati',
    mem: 'Memoria',
    memSub: 'esterna alla CPU — dati/istruzioni in lettura, dati in scrittura',
    addr: 'indirizzi',
    stepOf: (i: number, n: number) => `Passo ${i} di ${n}`,
    phase: {
      FETCH: 'Fetch', DECODE: 'Decode', EXECUTE: 'Execute', MEMORY: 'Memory', 'WRITE-BACK': 'Write-back', INTERRUPT: 'Interrupt',
    } as Record<MicroStep['phase'], string>,
    regs: [
      ['A, B', 'Latch di uscita del register file: contengono gli operandi letti (rs1 e rs2) nella fase di decode.'],
      ['C', 'Latch di uscita dell\'ALU: contiene il risultato prima di essere scritto nel register file.'],
      ['TEMP', 'Registro temporaneo: operando intermedio per l\'ALU (secondo operando, immediato, indirizzo di salto).'],
      ['MAR', 'Memory Address Register: indirizzo da inviare alla memoria.'],
      ['MDR', 'Memory Data Register: dato letto da o da scrivere in memoria.'],
      ['IR', 'Instruction Register: contiene l\'istruzione in esecuzione, letta con il fetch.'],
      ['PC', 'Program Counter: indirizzo della prossima istruzione.'],
      ['IAR', 'Interrupt Address Register: salva il PC di ritorno quando scatta un\'interruzione.'],
    ],
  },
  en: {
    title: 'Sequential DLX datapath',
    svgTitle: 'Sequential DLX datapath diagram: register file, registers A, B, C, TEMP, PC, IAR, MAR, MDR, IR, buses S1, S2 and dest, ALU, control unit and memory',
    empty: 'Run an instruction with Step to see the datapath in action',
    steps: 'Micro-operations',
    clocks: 'Clock cycles',
    stepClocks: 'clk',
    prev: 'Previous micro-operation',
    next: 'Next micro-operation',
    play: 'Play animation',
    pause: 'Pause animation',
    restart: 'Restart',
    legend: 'What are these registers?',
    ctrl: 'Control unit',
    ctrlSub: 'control signals not shown',
    mem: 'Memory',
    memSub: 'outside the CPU — instructions/data read, data write',
    addr: 'addresses',
    stepOf: (i: number, n: number) => `Step ${i} of ${n}`,
    phase: {
      FETCH: 'Fetch', DECODE: 'Decode', EXECUTE: 'Execute', MEMORY: 'Memory', 'WRITE-BACK': 'Write-back', INTERRUPT: 'Interrupt',
    } as Record<MicroStep['phase'], string>,
    regs: [
      ['A, B', 'Output latches of the register file: hold the operands read (rs1 and rs2) during decode.'],
      ['C', 'ALU output latch: holds the result before it is written to the register file.'],
      ['TEMP', 'Temporary register: intermediate ALU operand (second operand, immediate, branch target).'],
      ['MAR', 'Memory Address Register: address sent to memory.'],
      ['MDR', 'Memory Data Register: data read from or to be written to memory.'],
      ['IR', 'Instruction Register: holds the instruction being executed, loaded by the fetch.'],
      ['PC', 'Program Counter: address of the next instruction.'],
      ['IAR', 'Interrupt Address Register: saves the return PC when an interrupt is taken.'],
    ],
  },
};

const hex8 = (n: number | undefined): string => (n === undefined ? '' : '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0'));

/* ---------- analisi RTL: quali registri sono sorgente / destinazione ---------- */
const ID_RE = /(?<![A-Za-z0-9])(PC|MAR|MDR|IR|TEMP|IAR|A|B|C)(?![A-Za-z])/g;

function ids(s: string): string[] {
  return Array.from(s.replace(/0x[0-9a-fA-F]+/g, '').matchAll(ID_RE), (m) => m[1]);
}

interface Roles { src: Set<string>; dst: Set<string>; memWrite: boolean }

function analyze(rtl: string): Roles {
  const src = new Set<string>();
  const dst = new Set<string>();
  let memWrite = false;
  for (const raw of rtl.split(/\s*;\s*/)) {
    const part = raw.split('→').pop() ?? raw;
    const i = part.indexOf('←');
    if (i < 0) continue;
    const lhs = part.slice(0, i).trim();
    const rhs = part.slice(i + 1).split(' = ')[0];
    if (lhs.startsWith('M[')) memWrite = true;
    else if (/^R\d+/.test(lhs)) dst.add('RF');
    else ids(lhs).forEach((x) => dst.add(x));
    ids(rhs).forEach((x) => src.add(x));
  }
  return { src, dst, memWrite };
}

/* ---------- geometria dello schema ---------- */
const REG_X = 215;
const REG_W = 140;
const REG_H = 34;
const REG_ORDER = ['C', 'PC', 'TEMP', 'IAR', 'MAR', 'MDR'] as const;
const regY = (id: string) => 215 + 41 * REG_ORDER.indexOf(id as (typeof REG_ORDER)[number]);
const regMid = (id: string) => regY(id) + REG_H / 2;
const S1X = 570;
const S2X = 640;
const DESTX = 175;

interface Edge { id: string; d: string; on: boolean; kind: 'bus' | 'wire' | 'mem'; arrow?: boolean; both?: boolean; rev?: boolean; muted?: boolean }

function BoxText(props: { x: number; y: number; w: number; h: number; label: string; value?: string; big?: boolean }) {
  const { x, y, w, h, label, value } = props;
  return (
    <>
      <text className="dp-label" x={x + 9} y={y + h / 2 + 4}>{label}</text>
      {value !== undefined && (
        <text className="dp-value" x={x + w - 8} y={y + h / 2 + 4} textAnchor="end">{value}</text>
      )}
    </>
  );
}

function Diagram({ active, values, micro, step, t, uid }: {
  active: Set<string>; values: DatapathViewProps['values']; micro: MicroStep | undefined; step: number; t: (typeof T)['it']; uid: string;
}) {
  const alu = active.has('ALU');
  const mem = active.has('MEM');
  const roles = micro ? analyze(micro.rtl) : { src: new Set<string>(), dst: new Set<string>(), memWrite: false };
  const unknown = (r: string) => !roles.src.has(r) && !roles.dst.has(r);
  const isSrc = (r: string) => alu && active.has(r) && (roles.src.has(r) || unknown(r));
  const isDst = (r: string) => alu && active.has(r) && (roles.dst.has(r) || unknown(r));
  const a = (r: string) => active.has(r);

  const edges: Edge[] = [
    { id: 'rf-a', d: 'M365,112 H420', on: a('RF') && a('A'), kind: 'wire', arrow: true },
    { id: 'rf-b', d: 'M365,160 H420', on: a('RF') && a('B'), kind: 'wire', arrow: true },
    { id: 'a-s1', d: `M530,112 H${S1X}`, on: isSrc('A'), kind: 'wire' },
    { id: 'b-s2', d: `M530,160 H${S2X}`, on: isSrc('B'), kind: 'wire' },
    { id: 'c-rf', d: 'M290,215 V192', on: a('C') && a('RF'), kind: 'wire', arrow: true },
    { id: 'dest-rf', d: `M${DESTX},170 H${REG_X}`, on: alu && roles.dst.has('RF'), kind: 'wire', arrow: true },
    { id: 'ctl-rf', d: `M142,110 H${REG_X}`, on: false, kind: 'wire', arrow: true, muted: true },
    { id: 'ir-ctl', d: 'M83,410 V380', on: false, kind: 'wire', arrow: true, muted: true },
    ...(['PC', 'IAR', 'MDR'] as const).map((r): Edge => ({ id: `${r}-s1`, d: `M${REG_X + REG_W},${regMid(r) - 6} H${S1X}`, on: isSrc(r), kind: 'wire' })),
    ...(['TEMP'] as const).map((r): Edge => ({ id: `${r}-s2`, d: `M${REG_X + REG_W},${regMid(r) + 6} H${S2X}`, on: isSrc(r), kind: 'wire' })),
    { id: 'ir-s2', d: `M120,458 V468 H${S2X}`, on: isSrc('IR'), kind: 'wire' },
    ...REG_ORDER.map((r): Edge => ({ id: `dest-${r}`, d: `M${DESTX},${regMid(r)} H${REG_X}`, on: isDst(r), kind: 'wire', arrow: true })),
    { id: 's1', d: `M${S1X},437 V105`, on: alu, kind: 'bus' },
    { id: 's2', d: `M${S2X},468 V105`, on: alu, kind: 'bus' },
    { id: 'dest', d: `M605,55 V24 H${DESTX} V437`, on: alu, kind: 'bus' },
    { id: 'mar-mem', d: `M${REG_X + REG_W},408 H${REG_X + REG_W + 22} V505`, on: mem && a('MAR'), kind: 'mem', arrow: true },
    { id: 'mdr-mem', d: `M268,${regY('MDR') + REG_H} V505`, on: mem && a('MDR'), kind: 'mem', arrow: true, both: true, rev: !roles.memWrite },
    { id: 'mem-ir', d: 'M50,505 V458', on: mem && a('IR'), kind: 'mem', arrow: true },
  ];

  const mk = (hl: boolean) => `url(#${uid}-${hl ? 'ah' : 'a'})`;
  const mkS = (hl: boolean) => `url(#${uid}-${hl ? 'sh' : 's'})`;

  const box = (id: string, x: number, y: number, w: number, h: number, label: string, extra?: ReactNode) => (
    <g key={id} className={`dp-box${a(id) ? ' on' : ''}`} data-id={id}>
      <rect x={x} y={y} width={w} height={h} rx={7} />
      <BoxText x={x} y={y} w={w} h={h} label={label} value={id in values ? hex8(values[id as RegId]) : undefined} />
      {extra}
    </g>
  );

  // ordine di disegno: prima i fili spenti, poi quelli accesi
  const sorted = [...edges].sort((p, q) => Number(p.on) - Number(q.on));

  return (
    <svg className="dp-svg" viewBox="0 0 900 560" role="img" aria-label={t.svgTitle} data-step={step}>
      <title>{t.svgTitle}</title>
      <defs>
        <marker id={`${uid}-a`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="dp-mk" /></marker>
        <marker id={`${uid}-ah`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="dp-mk on" /></marker>
        <marker id={`${uid}-s`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5"><circle cx="5" cy="5" r="4" className="dp-mk" /></marker>
        <marker id={`${uid}-sh`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5"><circle cx="5" cy="5" r="4" className="dp-mk on" /></marker>
      </defs>

      {/* cornice CPU e memoria */}
      <rect className="dp-cpu" x={10} y={10} width={880} height={470} rx={14} />
      <text className="dp-tag" x={22} y={30}>CPU</text>
      <text className="dp-tag" x={880} y={470} textAnchor="end">execute</text>

      {/* fili */}
      {sorted.map((e) => (
        <path
          key={e.id}
          d={e.d}
          className={`dp-edge dp-${e.kind}${e.on ? ' on' : ''}${e.muted ? ' muted' : ''}${e.rev ? ' rev' : ''}`}
          markerEnd={e.arrow ? mk(e.on) : e.kind === 'wire' ? mkS(e.on) : undefined}
          markerStart={e.both ? mk(e.on) : undefined}
          fill="none"
        />
      ))}
      <text className="dp-bus-label" x={S1X} y={452} textAnchor="middle">S1</text>
      <text className="dp-bus-label" x={S2X + 12} y={452}>S2</text>
      <text className="dp-bus-label" x={400} y={18} textAnchor="middle">dest</text>
      <text className="dp-note" x={146} y={104}>{t.addr}</text>

      {/* unità di controllo */}
      <g className="dp-box ctl">
        <rect x={24} y={50} width={118} height={330} rx={9} />
        <text className="dp-label" x={83} y={200} textAnchor="middle">{t.ctrl.split(' ')[0]}</text>
        <text className="dp-label" x={83} y={218} textAnchor="middle">{t.ctrl.split(' ').slice(1).join(' ')}</text>
        <text className="dp-note" x={83} y={350} textAnchor="middle">{t.ctrlSub}</text>
      </g>
      {box('IR', 24, 410, 118, 48, 'IR', undefined)}

      {/* register file */}
      <g className={`dp-box${a('RF') ? ' on' : ''}`} data-id="RF">
        <rect x={215} y={80} width={150} height={112} rx={9} />
        <text className="dp-label" x={290} y={102} textAnchor="middle">Register file</text>
        {['R0', 'R1', '…', 'R31'].map((r, i) => (
          <text key={r} className="dp-note" x={290} y={122 + i * 16} textAnchor="middle">{r}</text>
        ))}
      </g>
      {box('A', 420, 92, 110, 40, 'A')}
      {box('B', 420, 140, 110, 40, 'B')}

      {/* ALU */}
      <g className={`dp-box alu${alu ? ' on' : ''}`} data-id="ALU">
        <polygon points="540,105 580,55 630,55 670,105" />
        <text className="dp-label" x={605} y={89} textAnchor="middle">ALU</text>
      </g>

      {/* registri */}
      {REG_ORDER.map((r) => box(r, REG_X, regY(r), REG_W, REG_H, r))}

      {/* memoria */}
      <g className={`dp-box mem${mem ? ' on' : ''}`} data-id="MEM">
        <rect x={24} y={505} width={700} height={44} rx={9} />
        <text className="dp-label" x={40} y={523}>{t.mem}</text>
        <text className="dp-note" x={40} y={540}>{t.memSub}</text>
      </g>
    </svg>
  );
}

export function DatapathView({ micro, values, instructionText, lang }: DatapathViewProps) {
  const t = T[lang];
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const n = micro.length;

  useEffect(() => {
    setIdx(0);
    setPlaying(false);
  }, [micro]);

  useEffect(() => {
    if (!playing) return;
    const h = window.setInterval(() => {
      setIdx((i) => {
        if (i >= n - 1) { setPlaying(false); return i; }
        return i + 1;
      });
    }, 900);
    return () => window.clearInterval(h);
  }, [playing, n]);

  const cur = micro[Math.min(idx, n - 1)] as MicroStep | undefined;
  const active = useMemo(() => new Set(cur?.active ?? []), [cur]);
  const totalClocks = useMemo(() => micro.reduce((s, m) => s + m.clocks, 0), [micro]);

  const go = useCallback((d: number) => { setPlaying(false); setIdx((i) => Math.max(0, Math.min(n - 1, i + d))); }, [n]);
  const togglePlay = () => {
    if (playing) { setPlaying(false); return; }
    if (idx >= n - 1) setIdx(0);
    setPlaying(true);
  };

  if (n === 0) {
    return (
      <section className="dp-root" aria-label={t.title}>
        <div className="dp-empty">
          <div className="dp-diagram dp-faded"><Diagram active={new Set()} values={values} micro={undefined} step={0} t={t} uid={uid} /></div>
          <p className="dp-empty-msg">{t.empty}</p>
        </div>
        <Legend t={t} open={legendOpen} setOpen={setLegendOpen} />
      </section>
    );
  }

  const curPhase = cur?.phase;
  return (
    <section className="dp-root" aria-label={t.title}>
      <header className="dp-head">
        <h3 className="dp-title">{t.title}</h3>
        {instructionText && <code className="dp-instr">{instructionText}</code>}
        <span className="dp-total" title={t.clocks}>
          {t.clocks}: <strong className="mono">{totalClocks}</strong>
        </span>
      </header>

      <ol className="dp-phases" aria-label="Fasi">
        {PHASES.filter((p) => p !== 'INTERRUPT' || micro.some((m) => m.phase === 'INTERRUPT')).map((p, i, arr) => (
          <li key={p} className={`dp-phase${curPhase === p ? ' cur' : ''}`} data-phase={p} aria-current={curPhase === p ? 'step' : undefined}>
            {t.phase[p]}
            {i < arr.length - 1 && <span className="dp-phase-arrow" aria-hidden="true">→</span>}
          </li>
        ))}
      </ol>

      <div className="dp-diagram">
        <Diagram active={active} values={values} micro={cur} step={idx} t={t} uid={uid} />
      </div>

      <div className="dp-controls" role="group" aria-label={t.steps}>
        <button type="button" className="dp-btn" onClick={() => go(-1)} disabled={idx <= 0} aria-label={t.prev}>◀</button>
        <button type="button" className="dp-btn primary" onClick={togglePlay} aria-label={playing ? t.pause : idx >= n - 1 ? t.restart : t.play}>
          {playing ? '❚❚' : '▶'}
        </button>
        <button type="button" className="dp-btn" onClick={() => go(1)} disabled={idx >= n - 1} aria-label={t.next}>▶</button>
        <span className="dp-counter" aria-live="polite">{t.stepOf(idx + 1, n)}</span>
      </div>

      <ol className="dp-steps" aria-label={t.steps}>
        {micro.map((m, i) => (
          <li key={i}>
            <button
              type="button"
              className={`dp-step${i === idx ? ' cur' : ''}${i < idx ? ' done' : ''}`}
              onClick={() => { setPlaying(false); setIdx(i); }}
              aria-current={i === idx ? 'step' : undefined}
            >
              <span className="dp-chip" data-phase={m.phase}>{t.phase[m.phase]}</span>
              <code className="dp-rtl">{m.rtl}</code>
              <span className="dp-clk">{m.clocks} {t.stepClocks}</span>
            </button>
          </li>
        ))}
      </ol>

      <Legend t={t} open={legendOpen} setOpen={setLegendOpen} />
    </section>
  );
}

function Legend({ t, open, setOpen }: { t: (typeof T)['it']; open: boolean; setOpen: (b: boolean) => void }) {
  return (
    <details className="dp-legend" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>{t.legend}</summary>
      <dl>
        {t.regs.map(([k, v]) => (
          <div key={k} className="dp-legend-row">
            <dt className="mono">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export default DatapathView;
