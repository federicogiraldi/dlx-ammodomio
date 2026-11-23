import { assemble, Program } from '../../src/core/asm/assembler';
import { Machine } from '../../src/core/machine';
import type { DeviceConfig } from '../../src/core/bus/devices';
import type { StepResult } from '../../src/core/cpu/cpu';

export const RAM = 0x40000000;

/** assembla e ritorna il programma, fallendo con i diagnostici se ci sono errori */
export function asmOk(src: string, dataBase?: number): Program {
  const p = assemble(src, { dataBase });
  const errs = p.diagnostics.filter((d) => d.severity === 'error');
  if (errs.length) throw new Error('errori di assemblaggio: ' + errs.map((e) => `${e.line}: ${e.text.en}`).join(' | '));
  return p;
}

export function wordOf(p: Program, addr: number): number {
  let v = 0;
  for (let i = 0; i < 4; i++) {
    const b = p.bytes.get(addr + i);
    if (b === undefined) throw new Error(`byte mancante a ${addr + i}`);
    v = v * 256 + b;
  }
  return v >>> 0;
}

export const errorsOf = (p: Program) => p.diagnostics.filter((d) => d.severity === 'error');
export const warningsOf = (p: Program) => p.diagnostics.filter((d) => d.severity === 'warning');

/** carica il sorgente in una Machine (fallisce se non assembla) e imposta i registri */
export function mk(src: string, regs: Record<number, number> = {}, map?: DeviceConfig[]): Machine {
  const m = new Machine(map);
  const p = m.load(src);
  const errs = errorsOf(p);
  if (errs.length) throw new Error('errori di assemblaggio: ' + errs.map((e) => `${e.line}: ${e.text.en}`).join(' | '));
  if (m.loadErrors.length) throw new Error('errori di caricamento: ' + m.loadErrors.map((e) => e.text.en).join(' | '));
  for (const [k, v] of Object.entries(regs)) m.cpu.regs[Number(k)] = v >>> 0;
  return m;
}

/** esegue una sola istruzione con i registri dati */
export function exec1(instr: string, regs: Record<number, number> = {}): { m: Machine; r: StepResult } {
  const m = mk(instr, regs);
  const r = m.step();
  return { m, r };
}

/** istantanea completa dello stato osservabile della macchina (registri, pc, memoria, periferiche) */
export function fingerprint(m: Machine, ranges: [number, number][] = []): string {
  const c = m.cpu;
  const mem: number[] = [];
  for (const [a, n] of ranges) {
    for (let i = 0; i < n; i++) {
      const b = m.bus.peek(a + i);
      mem.push(b.init ? b.value : -1);
    }
  }
  return JSON.stringify({
    regs: Array.from(c.regs), pc: c.pc, iar: c.iar, ien: c.ien, halted: c.halted,
    instret: c.instret, cycles: c.cycles, regInit: Array.from(c.regInit),
    mem, dev: m.bus.devices.map((d) => d.save()),
  });
}
