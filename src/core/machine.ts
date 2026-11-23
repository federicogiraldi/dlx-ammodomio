import { assemble, Program } from './asm/assembler';
import { Bus, ByteUndo, validateMap } from './bus/bus';
import { DeviceConfig, MemoryDevice } from './bus/devices';
import { CPU, CpuSnapshot, StepResult } from './cpu/cpu';
import { SimError, Txt, txt } from './util';

interface HistoryEntry {
  cpu: CpuSnapshot;
  devices: unknown[];
  bytes: ByteUndo[];
  result: StepResult;
}

export type StopReason = 'halt' | 'breakpoint' | 'error' | 'limit' | 'selfloop' | 'paused';

export interface RunOutcome {
  steps: number;
  reason: StopReason;
  error?: { text: Txt; pc?: number };
}

export const DEFAULT_MAP: DeviceConfig[] = [
  { id: 'eprom', kind: 'eprom', name: 'EPROM', base: 0x00000000, size: 0x20000000 },
  { id: 'ram1', kind: 'ram', name: 'RAM', base: 0x40000000, size: 0x40000000 },
  { id: 'led', kind: 'led', name: 'LED', base: 0x90000000, size: 16 },
  { id: 'startup', kind: 'startup', name: 'STARTUP', base: 0xc0000000, size: 16 },
  { id: 'ram2', kind: 'ram', name: 'RAM_H', base: 0xe0000000, size: 0x20000000 },
];

/** Macchina completa: assembler + bus + CPU + storia per lo step indietro. */
export class Machine {
  bus: Bus;
  cpu: CPU;
  program: Program | null = null;
  map: DeviceConfig[];
  history: HistoryEntry[] = [];
  maxHistory = 20000;
  breakpoints = new Set<number>(); // indirizzi
  /** traccia delle istruzioni eseguite (per la pipeline) */
  trace: StepResult[] = [];
  loadErrors: { line?: number; text: Txt }[] = [];

  constructor(map: DeviceConfig[] = DEFAULT_MAP) {
    this.map = map;
    this.bus = new Bus(map);
    this.cpu = new CPU(this.bus);
  }

  setMap(map: DeviceConfig[]): Txt[] {
    const errs = validateMap(map);
    if (errs.length) return errs;
    this.map = map;
    this.bus.setMap(map);
    if (this.program) this.load(this.program.source);
    else this.cpu.reset();
    return [];
  }

  /** dataBase predefinita: inizio della prima RAM */
  dataBase(): number {
    const ram = this.map.filter((d) => d.kind === 'ram').sort((a, b) => (a.base >>> 0) - (b.base >>> 0))[0];
    return ram ? ram.base >>> 0 : 0x40000000;
  }

  assemble(source: string): Program {
    return assemble(source, { dataBase: this.dataBase() });
  }

  /** assembla, carica in memoria e resetta la CPU */
  load(source: string): Program {
    const prog = this.assemble(source);
    this.program = prog;
    this.history = [];
    this.trace = [];
    this.loadErrors = [];
    if (prog.ok) {
      const lineOf = (addr: number) => prog.regions.find((r) => addr >= r.start && addr <= r.end)?.line;
      this.loadErrors = this.bus.loadImage(prog.bytes, lineOf);
    } else {
      for (const m of this.bus.memories()) m.clear();
    }
    this.cpu.reset();
    return prog;
  }

  /** RESET: riporta la CPU allo stato iniziale e ricarica l'immagine (la RAM torna come dopo il caricamento) */
  reset() {
    if (this.program) this.load(this.program.source);
    else this.cpu.reset();
  }

  get ready() {
    return !!this.program && this.program.ok && this.loadErrors.length === 0;
  }

  lineOfPC(pc = this.cpu.pc): number | undefined {
    return this.program?.addrToLine.get(pc >>> 0);
  }

  step(): StepResult {
    if (!this.ready) throw new SimError(txt('Correggi prima gli errori del programma (vedi la lista sotto l\'editor).', 'Fix the program errors first (see the list below the editor).'));
    const snap = this.cpu.snapshot();
    const devs = this.bus.devices.map((d) => d.save());
    this.bus.undo = [];
    try {
      const r = this.cpu.step();
      this.history.push({ cpu: snap, devices: devs, bytes: this.bus.undo, result: r });
      if (this.history.length > this.maxHistory) this.history.shift();
      this.trace.push(r);
      if (this.trace.length > 2000) this.trace.shift();
      return r;
    } catch (e) {
      // ripristina lo stato: l'istruzione che ha causato l'errore non viene eseguita
      this.undoBytes(this.bus.undo);
      this.cpu.restore(snap);
      this.bus.devices.forEach((d, i) => d.load(devs[i]));
      throw e;
    }
  }

  private undoBytes(list: ByteUndo[]) {
    for (let i = list.length - 1; i >= 0; i--) {
      const u = list[i];
      const dev = u.dev as MemoryDevice;
      if (u.old.init) dev.pokeByte(u.addr, u.old.value);
      else {
        // torna "non inizializzato"
        const page = dev.pages.get(Math.floor(u.addr / 4096));
        if (page) page.init[u.addr % 4096] = 0;
      }
    }
  }

  canStepBack() {
    return this.history.length > 0;
  }

  stepBack(): StepResult | undefined {
    const h = this.history.pop();
    if (!h) return undefined;
    this.undoBytes(h.bytes);
    this.cpu.restore(h.cpu);
    this.bus.devices.forEach((d, i) => d.load(h.devices[i]));
    this.trace.pop();
    return this.history[this.history.length - 1]?.result;
  }

  lastResult(): StepResult | undefined {
    return this.history[this.history.length - 1]?.result;
  }

  /** esegue fino a HALT, breakpoint, errore o limite di passi */
  run(maxSteps = 100000, ignoreFirstBreakpoint = true): RunOutcome {
    let steps = 0;
    while (steps < maxSteps) {
      if (this.cpu.halted) return { steps, reason: 'halt' };
      if (this.breakpoints.has(this.cpu.pc) && !(ignoreFirstBreakpoint && steps === 0)) return { steps, reason: 'breakpoint' };
      let r: StepResult;
      try {
        r = this.step();
      } catch (e) {
        if (e instanceof SimError) return { steps, reason: 'error', error: { text: e.text, pc: e.pc ?? this.cpu.pc } };
        throw e;
      }
      steps++;
      if (r.halted) return { steps, reason: 'halt' };
      // ciclo infinito "fine: J fine" senza interrupt possibili
      if (r.nextPC === r.pc && !r.interrupt && !this.cpu.ien) return { steps, reason: 'selfloop' };
      if (r.nextPC === r.pc && !r.interrupt && !this.bus.devices.some((d) => ['input', 'button'].includes(d.cfg.kind))) return { steps, reason: 'selfloop' };
    }
    return { steps, reason: 'limit' };
  }
}
