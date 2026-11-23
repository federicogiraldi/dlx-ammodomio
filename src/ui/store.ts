import { create } from 'zustand';
import { Machine, DEFAULT_MAP, RunOutcome } from '../core/machine';
import { Program, assemble } from '../core/asm/assembler';
import { StepResult } from '../core/cpu/cpu';
import { DeviceConfig } from '../core/bus/devices';
import { SimError, Txt, txt } from '../core/util';
import { Lang, Key } from '../i18n';

export type Tab = 'explain' | 'memory' | 'devices' | 'datapath' | 'pipeline' | 'learn' | 'reference';

export interface Status {
  kind: 'ok' | 'info' | 'warn' | 'error';
  text: Txt | Key;
}

const LS = {
  get<T>(k: string, def: T): T {
    try {
      const v = localStorage.getItem('dlx.' + k);
      return v === null ? def : (JSON.parse(v) as T);
    } catch {
      return def;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem('dlx.' + k, JSON.stringify(v));
    } catch {
      /* storage non disponibile */
    }
  },
};

export const WELCOME = `; Benvenuto in DLX ammodomio!
; Questo programma somma i numeri da 1 a 5.
; Premi Step (F8) per eseguire un'istruzione alla volta
; e guarda il pannello "Cosa è successo".

        ADDI R1,R0,5      ; R1 = 5 (contatore)
        ADD  R2,R0,R0     ; R2 = 0 (somma)
loop:   ADD  R2,R2,R1     ; somma += contatore
        SUBI R1,R1,1      ; contatore--
        BNEZ R1,loop      ; ripeti finché R1 != 0
        LHI  R3,0x4000    ; R3 = 0x40000000 (inizio RAM)
        SW   R2,0(R3)     ; salva il risultato in RAM
        HALT              ; fine
`;

function initialSource(): string {
  try {
    const h = location.hash;
    if (h.startsWith('#code=')) {
      const b64 = h.slice(6);
      const bin = atob(decodeURIComponent(b64));
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
  } catch {
    /* link non valido */
  }
  return LS.get('source', WELCOME);
}

export function shareLink(source: string): string {
  const bytes = new TextEncoder().encode(source);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return `${location.origin}${location.pathname}#code=${encodeURIComponent(btoa(bin))}`;
}

interface State {
  machine: Machine;
  version: number; // incrementato a ogni cambio di stato della macchina
  source: string;
  /** assemblaggio "live" del testo nell'editor (per la diagnostica) */
  live: Program;
  /** il programma caricato non corrisponde più al testo */
  dirty: boolean;
  last: StepResult | undefined;
  running: boolean;
  speed: number; // istruzioni al secondo
  status: Status;
  runtimeError: { text: Txt; line?: number } | null;
  lang: Lang;
  theme: 'light' | 'dark';
  tab: Tab;
  breakLines: Set<number>;
  trapOnOverflow: boolean;
  /** indirizzi di memoria toccati dall'ultima istruzione */
  touched: Set<number>;
  memView: number;

  setSource(s: string): void;
  ensureLoaded(): boolean;
  load(): void;
  step(): void;
  back(): void;
  run(): void;
  pause(): void;
  runToEnd(): void;
  reset(): void;
  toggleBreak(line: number): void;
  setLang(l: Lang): void;
  setTheme(t: 'light' | 'dark'): void;
  setTab(t: Tab): void;
  setSpeed(n: number): void;
  setMap(m: DeviceConfig[]): Txt[];
  setTrap(b: boolean): void;
  bump(): void;
  setMemView(a: number): void;
  loadProgram(code: string, map?: DeviceConfig[]): void;
}

let timer: number | undefined;

function syncBreakpoints(m: Machine, lines: Set<number>) {
  m.breakpoints.clear();
  if (!m.program) return;
  for (const l of lines) {
    const a = m.program.lineToAddr.get(l);
    if (a !== undefined && m.program.addrToLine.get(a) === l) m.breakpoints.add(a);
  }
}

function touchedOf(r?: StepResult): Set<number> {
  const s = new Set<number>();
  if (!r) return s;
  for (const a of r.mem) if (a.kind !== 'fetch') for (let i = 0; i < a.size; i++) s.add((a.addr + i) >>> 0);
  return s;
}

export const useStore = create<State>((set, get) => {
  const map = LS.get<DeviceConfig[]>('map', DEFAULT_MAP);
  const machine = new Machine(DEFAULT_MAP);
  if (map !== DEFAULT_MAP) machine.setMap(map);
  const source = initialSource();
  machine.load(source);
  const breakLines = new Set<number>();

  const outcome = (o: RunOutcome) => {
    const m = get().machine;
    const st: Status =
      o.reason === 'halt' ? { kind: 'ok', text: 'halted' }
      : o.reason === 'breakpoint' ? { kind: 'info', text: 'bpHit' }
      : o.reason === 'selfloop' ? { kind: 'info', text: 'selfloop' }
      : o.reason === 'limit' ? { kind: 'warn', text: 'limit' }
      : { kind: 'error', text: o.error!.text };
    const last = m.lastResult();
    set({
      status: st,
      runtimeError: o.reason === 'error' ? { text: o.error!.text, line: m.lineOfPC(o.error!.pc) } : null,
      last,
      touched: touchedOf(last),
    });
  };

  return {
    machine,
    version: 0,
    source,
    live: machine.program!,
    dirty: false,
    last: undefined,
    running: false,
    speed: LS.get('speed', 4),
    status: { kind: 'info', text: 'ready' },
    runtimeError: null,
    lang: LS.get<Lang>('lang', 'it'),
    theme: LS.get('theme', window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    tab: 'explain',
    breakLines,
    trapOnOverflow: false,
    touched: new Set(),
    memView: 0x40000000,

    bump: () => set((s) => ({ version: s.version + 1 })),

    setSource(s) {
      LS.set('source', s);
      const live = assemble(s, { dataBase: get().machine.dataBase() });
      set({ source: s, live, dirty: true, runtimeError: null });
    },

    load() {
      get().pause();
      const m = get().machine;
      m.load(get().source);
      syncBreakpoints(m, get().breakLines);
      set((s) => ({
        live: m.program!,
        dirty: false,
        last: undefined,
        runtimeError: null,
        touched: new Set(),
        version: s.version + 1,
        status: m.ready ? { kind: 'info', text: 'ready' } : { kind: 'error', text: m.loadErrors[0]?.text ?? 'fixErrors' },
      }));
    },

    ensureLoaded() {
      if (get().dirty) {
        get().load();
        set({ status: { kind: 'info', text: 'reloaded' } });
      }
      const m = get().machine;
      if (!m.ready) {
        set({ status: { kind: 'error', text: m.loadErrors[0]?.text ?? 'fixErrors' } });
        return false;
      }
      return true;
    },

    step() {
      if (!get().ensureLoaded()) return;
      const m = get().machine;
      try {
        const r = m.step();
        set((s) => ({
          last: r,
          touched: touchedOf(r),
          runtimeError: null,
          version: s.version + 1,
          status: r.halted ? { kind: 'ok', text: 'halted' } : r.interrupt ? { kind: 'warn', text: txt('⚡ Interrupt: salto all\'handler a 0x00000000', '⚡ Interrupt: jumping to the handler at 0x00000000') } : { kind: 'info', text: 'paused' },
        }));
      } catch (e) {
        if (e instanceof SimError) {
          set((s) => ({ runtimeError: { text: e.text, line: m.lineOfPC() }, status: { kind: 'error', text: e.text }, version: s.version + 1 }));
        } else throw e;
      }
    },

    back() {
      get().pause();
      const m = get().machine;
      if (!m.canStepBack()) return;
      const r = m.stepBack();
      set((s) => ({ last: r, touched: touchedOf(r), runtimeError: null, version: s.version + 1, status: { kind: 'info', text: 'paused' } }));
    },

    run() {
      if (get().running) return;
      if (!get().ensureLoaded()) return;
      set({ running: true, status: { kind: 'info', text: 'running' } });
      let first = true;
      const tick = () => {
        if (!get().running) return;
        const sp = get().speed;
        const m = get().machine;
        // a velocità alte si eseguono più istruzioni per frame
        const batch = sp >= 60 ? Math.ceil(sp / 30) : 1;
        const o = m.run(batch, first);
        first = false;
        if (o.reason !== 'limit') {
          set({ running: false });
          outcome(o);
          set((s) => ({ version: s.version + 1 }));
          return;
        }
        const last = m.lastResult();
        set((s) => ({ last, touched: touchedOf(last), version: s.version + 1 }));
        timer = window.setTimeout(tick, sp >= 60 ? 33 : 1000 / sp);
      };
      tick();
    },

    pause() {
      if (timer) window.clearTimeout(timer);
      timer = undefined;
      if (get().running) set({ running: false, status: { kind: 'info', text: 'paused' } });
    },

    runToEnd() {
      get().pause();
      if (!get().ensureLoaded()) return;
      const o = get().machine.run(500000);
      outcome(o);
      set((s) => ({ version: s.version + 1 }));
    },

    reset() {
      get().pause();
      get().load();
    },

    toggleBreak(line) {
      const b = new Set(get().breakLines);
      if (b.has(line)) b.delete(line);
      else b.add(line);
      syncBreakpoints(get().machine, b);
      set({ breakLines: b });
    },

    setLang(l) { LS.set('lang', l); set({ lang: l }); },
    setTheme(t) { LS.set('theme', t); set({ theme: t }); },
    setTab(t) { set({ tab: t }); },
    setSpeed(n) { LS.set('speed', n); set({ speed: n }); },
    setTrap(b) { get().machine.cpu.opts.trapOnOverflow = b; set({ trapOnOverflow: b }); },
    setMemView(a) { set({ memView: a >>> 0 }); },

    setMap(map) {
      get().pause();
      const errs = get().machine.setMap(map);
      if (errs.length) return errs;
      LS.set('map', map);
      get().load();
      return [];
    },

    loadProgram(code, map) {
      get().pause();
      if (map) {
        const errs = get().machine.setMap(map);
        if (!errs.length) LS.set('map', map);
      }
      set({ breakLines: new Set() });
      get().setSource(code);
      get().load();
    },
  };
});
