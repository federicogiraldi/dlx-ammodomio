// Regressioni per i finding ALTI del report QA (QA_REPORT.md, 2026-11-23)
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { assemble, MAX_SPACE } from '../src/core/asm/assembler';
import { Machine, DEFAULT_MAP } from '../src/core/machine';
import { EXERCISES } from '../src/content';
import type { Exercise } from '../src/content/types';

const errors = (src: string) => assemble(src, { dataBase: 0x40000000 }).diagnostics.filter((d) => d.severity === 'error');

describe('assembler: fine riga e limiti', () => {
  it('CR isolato, U+2028 e U+2029 separano le righe senza eccezioni', () => {
    for (const sep of ['\r', ' ', ' ', '\r\n']) {
      const p = assemble(`ADD R1,R2,R3${sep}ADD R4,R5,R6${sep}HALT`);
      expect(p.ok).toBe(true);
      expect(p.lineToAddr.get(2)).toBe(4);
    }
  });

  it('.space enorme: errore immediato, nessun blocco', () => {
    const t = Date.now();
    const e = errors('.data\n.space 0x7fffffff');
    expect(Date.now() - t).toBeLessThan(200);
    expect(e[0].text.it).toContain('troppo grande');
    expect(errors(`.data\n.space ${MAX_SPACE}`)).toHaveLength(0);
  });

  it('.space negativo o non intero e .align fuori range sono errori', () => {
    expect(errors('.data\n.space -4')).toHaveLength(1);
    expect(errors('.data\n.space 1<<-1')).toHaveLength(1);
    expect(errors('.data\n.align 40\n.word 7')).toHaveLength(1);
    expect(errors('.data\n.align -1')).toHaveLength(1);
  });
});

// stessa logica della verifica nel pannello Impara (Learn.tsx runCheck)
function check(ex: Exercise, source: string): boolean {
  const m = new Machine(ex.map ?? DEFAULT_MAP);
  m.load(source);
  if (!m.ready) return false;
  ex.setup?.(m);
  const o = m.run(ex.maxSteps ?? 200000);
  if (o.reason === 'error') return false;
  return ex.check(m).every((r) => r.ok);
}
const ex = (id: string) => EXERCISES.find((e) => e.id === id)!;

describe('esercizi: rifiutano le soluzioni sbagliate più probabili', () => {
  it('conta-pari: contare i dispari non passa', () => {
    const e = ex('conta-pari');
    expect(check(e, e.solution)).toBe(true);
    expect(e.solution).toContain('BNEZ R6,Dispari');
    expect(check(e, e.solution.replace('BNEZ R6,Dispari', 'BEQZ R6,Dispari'))).toBe(false);
  });

  it('esame 2020-09-01: contare i caratteri dispari non passa', () => {
    const e = ex('esame-2020-09-01');
    expect(check(e, e.solution)).toBe(true);
    expect(e.solution).toContain('BNEZ R25,esci');
    expect(check(e, e.solution.replace('BNEZ R25,esci', 'BEQZ R25,esci'))).toBe(false);
  });
});

// ------------------------------------------------------------------
// store: avvio robusto e link condiviso
// ------------------------------------------------------------------
let storage: Record<string, string>;
function stubBrowser(ls: Record<string, string>, hash = '', confirmAnswer = true) {
  storage = { ...ls };
  const g = globalThis as Record<string, unknown>;
  g.localStorage = {
    getItem: (k: string) => (k in storage ? storage[k] : null),
    setItem: (k: string, v: string) => { storage[k] = v; },
    removeItem: (k: string) => { delete storage[k]; },
  };
  const loc = { hash, origin: 'http://x', pathname: '/', search: '' };
  g.location = loc;
  g.history = { replaceState: () => { loc.hash = ''; } };
  g.confirm = () => confirmAnswer;
  g.window = globalThis;
}
const loadStore = async () => {
  vi.resetModules(); // ogni test crea uno store nuovo con i dati finti appena impostati
  return (await import('../src/ui/store')).useStore;
};

describe('store: dati salvati corrotti non bloccano l\'avvio', () => {
  beforeEach(() => stubBrowser({}));
  const bad: Record<string, string>[] = [
    { 'dlx.map': '{}' },
    { 'dlx.map': 'null' },
    { 'dlx.map': JSON.stringify([{ id: 'x', kind: 'bogus', name: 'X', base: 0, size: 16 }]) },
    { 'dlx.map': 'non json' },
    { 'dlx.source': '123' },
    { 'dlx.source': 'null' },
    { 'dlx.source': JSON.stringify('ADD R1,R2,R3\rADD R1,R2,R3') },
    { 'dlx.speed': '0', 'dlx.lang': '"xx"', 'dlx.theme': '42' },
  ];
  for (const ls of bad) {
    it(JSON.stringify(ls), async () => {
      stubBrowser(ls);
      const useStore = await loadStore();
      const s = useStore.getState();
      expect(s.machine.program).toBeTruthy();
      expect(typeof s.source).toBe('string');
      expect(['it', 'en']).toContain(s.lang);
      expect(s.speed).toBeGreaterThan(0);
    });
  }
});

describe('store: link condiviso', () => {
  const link = (code: string) => '#code=' + encodeURIComponent(btoa(code));
  it('il link viene tolto dall\'URL dopo la lettura', async () => {
    stubBrowser({}, link('ADDI R1,R0,7\nHALT'));
    const useStore = await loadStore();
    expect(useStore.getState().source).toBe('ADDI R1,R0,7\nHALT');
    expect((globalThis as unknown as { location: { hash: string } }).location.hash).toBe('');
  });
  it('se l\'utente rifiuta, il suo programma resta', async () => {
    stubBrowser({ 'dlx.source': JSON.stringify('; mio\nHALT') }, link('NOP\nHALT'), false);
    const useStore = await loadStore();
    expect(useStore.getState().source).toBe('; mio\nHALT');
  });
});

describe('store: "Fino alla fine" lavora a blocchi e si può fermare', () => {
  it('un ciclo infinito non blocca e Pausa lo ferma', async () => {
    stubBrowser({ 'dlx.source': JSON.stringify('loop: ADDI R1,R1,1\n      LHI R2,0x4000\n      SW R1,0(R2)\n      J loop') });
    const useStore = await loadStore();
    const s = useStore.getState();
    const t = Date.now();
    s.runToEnd();
    expect(Date.now() - t).toBeLessThan(1000); // ritorna subito: il resto gira con setTimeout
    expect(useStore.getState().running).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    useStore.getState().pause();
    const executed = useStore.getState().machine.cpu.instret;
    expect(executed).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(useStore.getState().machine.cpu.instret).toBe(executed);
    expect(useStore.getState().running).toBe(false);
  });
});
