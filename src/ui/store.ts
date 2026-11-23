import { create } from 'zustand';
import { Machine, DEFAULT_MAP, RunOutcome } from '../core/machine';
import { Program, assemble } from '../core/asm/assembler';
import { StepResult } from '../core/cpu/cpu';
import { DeviceConfig, KIND_INFO } from '../core/bus/devices';
import { validateMap } from '../core/bus/bus';
import { SimError, Txt, txt } from '../core/util';
import { Lang, Key } from '../i18n';

export type Tab = 'explain' | 'memory' | 'devices' | 'datapath' | 'pipeline' | 'learn' | 'reference';

export interface Status {
  kind: 'ok' | 'info' | 'warn' | 'error';
  text: Txt | Key;
}

const LS = {
  /** legge una chiave dlx.*; se il valore manca, è corrotto o non supera `ok`, restituisce il default (e rimuove la chiave guasta) */
  get<T>(k: string, def: T, ok: (v: unknown) => boolean = () => true): T {
    try {
      const v = localStorage.getItem('dlx.' + k);
      if (v === null) return def;
      const parsed: unknown = JSON.parse(v);
      if (ok(parsed)) return parsed as T;
    } catch {
      /* JSON non valido */
    }
    try { localStorage.removeItem('dlx.' + k); } catch { /* ignora */ }
    return def;
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

const isStr = (v: unknown) => typeof v === 'string';

/** una mappa letta da localStorage è usabile solo se ha la forma giusta e supera validateMap */
function isValidMap(v: unknown): boolean {
  if (!Array.isArray(v) || v.length === 0) return false;
  const shapeOk = v.every(
    (d) =>
      d && typeof d === 'object' &&
      typeof d.id === 'string' && typeof d.name === 'string' &&
      typeof d.kind === 'string' && d.kind in KIND_INFO &&
      Number.isFinite(d.base) && Number.isFinite(d.size),
  );
  if (!shapeOk) return false;
  try {
    return validateMap(v as DeviceConfig[]).length === 0;
  } catch {
    return false;
  }
}

/** lunghezza massima del codice in un link condiviso (circa 48 KB di sorgente) */
const MAX_HASH = 65536;

function initialSource(): string {
  const saved = LS.get<string>('source', WELCOME, isStr);
  try {
    const h = location.hash;
    if (h.startsWith('#code=')) {
      // il link viene letto una volta sola: lo togliamo dall'URL così una ricarica non cancella le modifiche
      try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignora */ }
      const b64 = h.slice(6);
      if (b64.length > MAX_HASH) return saved;
      const bin = atob(decodeURIComponent(b64));
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      const fromLink = new TextDecoder().decode(bytes);
      // se l'utente aveva un suo programma diverso, chiediamo prima di sostituirlo
      if (saved !== WELCOME && saved.trim() !== fromLink.trim() && typeof confirm === 'function') {
        const yes = confirm('Aprire il programma del link condiviso?\nIl programma che avevi nell\'editor verrà sostituito (Annulla = tieni il tuo).\n\nOpen the shared program? Your current program will be replaced (Cancel = keep yours).');
        if (!yes) return saved;
      }
      return fromLink;
    }
  } catch {
    /* link non valido */
  }
  return saved;
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
  const map = LS.get<DeviceConfig[]>('map', DEFAULT_MAP, isValidMap);
  const machine = new Machine(DEFAULT_MAP);
  let source = initialSource();
  try {
    if (map !== DEFAULT_MAP) machine.setMap(map);
    machine.load(source);
  } catch {
    // stato salvato inutilizzabile: si riparte da zero invece di lasciare la pagina bianca
    try { localStorage.removeItem('dlx.map'); localStorage.removeItem('dlx.source'); } catch { /* ignora */ }
    machine.setMap(DEFAULT_MAP);
    source = WELCOME;
    machine.load(source);
  }
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
    speed: LS.get('speed', 4, (v) => typeof v === 'number' && v >= 0.5 && v <= 100000),
    status: { kind: 'info', text: 'ready' },
    runtimeError: null,
    lang: LS.get<Lang>('lang', 'it', (v) => v === 'it' || v === 'en'),
    theme: LS.get<'light' | 'dark'>('theme', window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', (v) => v === 'light' || v === 'dark'),
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
      // esecuzione a blocchi: tra un blocco e l'altro il browser ridisegna e il pulsante Pausa resta usabile
      const LIMIT = 500000;
      const CHUNK = 2000;
      let done = 0;
      let first = true;
      set({ running: true, status: { kind: 'info', text: 'running' } });
      const tick = () => {
        if (!get().running) return;
        const m = get().machine;
        const o = m.run(Math.min(CHUNK, LIMIT - done), first);
        first = false;
        done += o.steps;
        if (o.reason !== 'limit' || done >= LIMIT) {
          set({ running: false });
          outcome(o);
          set((s) => ({ version: s.version + 1 }));
          return;
        }
        // aggiorna i contatori in toolbar senza ridisegnare tutti i pannelli a ogni blocco
        if (done % (CHUNK * 10) === 0) set((s) => ({ version: s.version + 1 }));
        timer = window.setTimeout(tick, 0);
      };
      tick();
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
