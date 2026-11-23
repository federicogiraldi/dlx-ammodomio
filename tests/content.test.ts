import { describe, it, expect } from 'vitest';
import { Machine } from '../src/core/machine';
import type { InputDevice, ButtonDevice, OutputDevice, LedDevice } from '../src/core/bus/devices';
import { EXAMPLES, EXERCISES, TUTORIALS } from '../src/content';

type Diags = { diagnostics: { severity: string; line: number; text: { it: string } }[] };
const errorsOf = (p: Diags) => p.diagnostics.filter((d) => d.severity === 'error').map((d) => `riga ${d.line}: ${d.text.it}`);
const warningsOf = (p: Diags) => p.diagnostics.filter((d) => d.severity === 'warning').map((d) => `riga ${d.line}: ${d.text.it}`);

const dev = <T,>(m: Machine, id: string): T => m.bus.devices.find((d) => d.cfg.id === id) as unknown as T;

/** esegue n istruzioni (o fino a HALT); lancia se c'è un errore di runtime */
function steps(m: Machine, n: number) {
  for (let i = 0; i < n && !m.cpu.halted; i++) m.step();
}

describe('contenuti: struttura', () => {
  it('id unici e testi bilingue non vuoti', () => {
    for (const list of [EXAMPLES, EXERCISES, TUTORIALS]) {
      const ids = list.map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    const nonEmpty = (t: { it: string; en: string }) => t.it.trim().length > 0 && t.en.trim().length > 0;
    for (const e of EXAMPLES) {
      expect(nonEmpty(e.title)).toBe(true);
      expect(nonEmpty(e.description)).toBe(true);
    }
    for (const e of EXERCISES) {
      expect(nonEmpty(e.title)).toBe(true);
      expect(nonEmpty(e.statement)).toBe(true);
      expect(e.hints.length).toBeGreaterThan(0);
      for (const h of e.hints) expect(nonEmpty(h)).toBe(true);
    }
    for (const t of TUTORIALS) {
      expect(nonEmpty(t.title)).toBe(true);
      expect(nonEmpty(t.summary)).toBe(true);
      expect(t.steps.length).toBeGreaterThanOrEqual(3);
      expect(t.steps.length).toBeLessThanOrEqual(6);
      for (const s of t.steps) {
        expect(nonEmpty(s.title)).toBe(true);
        expect(nonEmpty(s.body)).toBe(true);
        if (s.tryIt) expect(nonEmpty(s.tryIt)).toBe(true);
      }
    }
  });
});

describe('esempi', () => {
  for (const ex of EXAMPLES) {
    it(`${ex.id}: assembla senza errori né avvisi`, () => {
      const m = new Machine(ex.map);
      const p = m.load(ex.code);
      expect(errorsOf(p)).toEqual([]);
      expect(warningsOf(p)).toEqual([]);
      expect(m.loadErrors).toEqual([]);
    });
  }

  const load = (id: string) => {
    const ex = EXAMPLES.find((e) => e.id === id)!;
    const m = new Machine(ex.map);
    m.load(ex.code);
    return m;
  };

  const HALTING = ['primo-programma', 'somma-array', 'riempi-array', 'costanti-32bit', 'procedura-jal', 'signed-unsigned', 'big-endian', 'led-startup', 'output-hello'];
  for (const id of HALTING) {
    it(`${id}: termina con HALT senza errori`, () => {
      const m = load(id);
      const out = m.run(200000);
      expect(out.error?.text.it).toBeUndefined();
      expect(out.reason).toBe('halt');
    });
  }

  it('primo-programma: valori', () => {
    const m = load('primo-programma');
    m.run();
    expect([1, 2, 3, 4, 5].map((i) => m.cpu.regs[i])).toEqual([5, 7, 12, 2, 24]);
  });
  it('somma-array: 31 a 0xE0000200', () => {
    const m = load('somma-array');
    m.run();
    expect(m.bus.peekWord(0xe0000200).value).toBe(31);
  });
  it('riempi-array: 0..7 a 0xE0000800', () => {
    const m = load('riempi-array');
    m.run();
    for (let i = 0; i < 8; i++) expect(m.bus.peekWord(0xe0000800 + 4 * i).value).toBe(i);
    expect(m.bus.peekWord(0xe0000820).init).toBe(false);
  });
  it('costanti-32bit: valori', () => {
    const m = load('costanti-32bit');
    m.run();
    expect(m.cpu.regs[1]).toBe(0x12345678);
    expect(m.cpu.regs[2]).toBe(0xcafebabe);
    expect(m.cpu.regs[3]).toBe(0x00008000);
    expect(m.cpu.regs[4]).toBe(0x00018000);
  });
  it('procedura-jal: massimo = 12', () => {
    const m = load('procedura-jal');
    m.run();
    expect(m.bus.peekWord(0xe0000000).value).toBe(12);
  });
  it('signed-unsigned: valori', () => {
    const m = load('signed-unsigned');
    m.run();
    const r = m.cpu.regs;
    expect([r[2], r[3], r[4], r[5], r[8], r[9]]).toEqual([0xfffffff0, 0xf0, 0xffff8001, 0x8001, 1, 0]);
  });
  it('big-endian: byte e half-word', () => {
    const m = load('big-endian');
    m.run();
    const r = m.cpu.regs;
    expect([r[3], r[4], r[5], r[6], r[7], r[8]]).toEqual([0x12, 0x34, 0x56, 0x78, 0x1234, 0x5678]);
  });
  it('led-startup: LED acceso, R5 = 1', () => {
    const m = load('led-startup');
    m.run();
    expect(m.cpu.regs[5]).toBe(1);
    expect(dev<LedDevice>(m, 'led').on).toBe(true);
  });
  it('output-hello: scrive la stringa', () => {
    const m = load('output-hello');
    m.run();
    const log = dev<OutputDevice>(m, 'out').log;
    expect(String.fromCharCode(...log)).toBe('Ciao, DLX!');
  });

  it('interrupt-input: eco, registri protetti, contatore', () => {
    const m = load('interrupt-input');
    const inp = dev<InputDevice>(m, 'in');
    steps(m, 40); // avvio + main
    expect(m.cpu.ien).toBe(true);
    for (const ch of 'CIAO') {
      inp.provide(ch.charCodeAt(0));
      steps(m, 60);
    }
    expect(String.fromCharCode(...dev<OutputDevice>(m, 'out').log)).toBe('CIAO');
    expect(m.bus.peekWord(0xfffffff0).value).toBe(4);
    expect(m.cpu.regs[2]).toBe(100); // R2 protetto
    expect(m.cpu.regs[1]).toBeGreaterThan(50); // il main ha continuato a lavorare
    expect(m.cpu.ien).toBe(true);
  });

  it('interrupt-pulsante: il LED si inverte a ogni pressione', () => {
    const m = load('interrupt-pulsante');
    const btn = dev<ButtonDevice>(m, 'btn');
    const led = dev<LedDevice>(m, 'led');
    steps(m, 30);
    expect(led.on).toBe(false);
    btn.press();
    steps(m, 30);
    expect(led.on).toBe(true);
    expect(btn.ff).toBe(false);
    btn.press();
    steps(m, 30);
    expect(led.on).toBe(false);
  });
});

describe('tutorial', () => {
  for (const t of TUTORIALS) {
    t.steps.forEach((s, i) => {
      if (!s.code) return;
      it(`${t.id} passo ${i + 1}: il codice assembla senza errori`, () => {
        const m = new Machine(s.map);
        const p = m.load(s.code!);
        expect(errorsOf(p)).toEqual([]);
        expect(m.loadErrors).toEqual([]);
      });
    });
  }

  it('i programmi dei tutorial fanno quello che dicono', () => {
    const find = (id: string, n: number) => TUTORIALS.find((t) => t.id === id)!.steps[n - 1];
    // somma 10..1
    let m = new Machine();
    m.load(find('primo-programma', 5).code!);
    expect(m.run().reason).toBe('halt');
    expect(m.cpu.regs[1]).toBe(55);
    // minimo
    m = new Machine();
    m.load(find('salti-cicli', 3).code!);
    m.run();
    expect(m.cpu.regs[3]).toBe(4);
    // somma 1..10
    m = new Machine();
    m.load(find('salti-cicli', 4).code!);
    m.run();
    expect(m.cpu.regs[1]).toBe(55);
    // procedure con stack
    m = new Machine();
    m.load(find('procedure', 3).code!);
    expect(m.run().reason).toBe('halt');
    expect(m.cpu.regs[2]).toBe(11);
    expect(m.cpu.regs[8]).toBe(77);
    // errori attesi
    m = new Machine();
    m.load(find('load-store', 5).code!);
    expect(m.run().reason).toBe('error');
    m = new Machine();
    m.load(find('io-chip-select', 5).code!);
    expect(m.run().reason).toBe('error');
    // numeri e overflow
    m = new Machine();
    m.load(find('registri-numeri', 2).code!);
    m.run();
    expect([1, 2, 3, 4, 5].map((i) => m.cpu.regs[i])).toEqual([255, 255, 255, 255, 65]);
    m = new Machine();
    m.load(find('registri-numeri', 4).code!);
    expect(m.run().reason).toBe('halt');
    expect(m.cpu.regs[3]).toBe(0x80000000);
    // immediati
    m = new Machine();
    m.load(find('alu-immediati', 2).code!);
    m.run();
    expect([1, 2, 3, 4].map((i) => m.cpu.regs[i])).toEqual([0xffffffff, 65535, 65535, 0xff]);
  });
});

describe('esercizi', () => {
  for (const ex of EXERCISES) {
    const runIt = (code: string) => {
      const m = new Machine(ex.map);
      const p = m.load(code);
      expect(errorsOf(p)).toEqual([]);
      expect(m.loadErrors).toEqual([]);
      ex.setup?.(m);
      const out = m.run(ex.maxSteps ?? 200000);
      return { m, out };
    };

    it(`${ex.id}: la soluzione supera tutti i controlli`, () => {
      const { m, out } = runIt(ex.solution);
      expect(out.error?.text.it).toBeUndefined();
      const checks = ex.check(m);
      expect(checks.length).toBeGreaterThan(0);
      expect(checks.filter((c) => !c.ok).map((c) => c.text.it)).toEqual([]);
    });

    it(`${ex.id}: lo starter NON supera i controlli`, () => {
      const { m, out } = runIt(ex.starter);
      expect(out.error?.text.it).toBeUndefined();
      expect(ex.check(m).some((c) => !c.ok)).toBe(true);
    });

    it(`${ex.id}: testi dei check bilingue e soluzione ripetibile dopo reset`, () => {
      const { m } = runIt(ex.solution);
      for (const c of ex.check(m)) {
        expect(c.text.it.length).toBeGreaterThan(0);
        expect(c.text.en.length).toBeGreaterThan(0);
      }
      m.reset();
      ex.setup?.(m);
      m.run(ex.maxSteps ?? 200000);
      expect(ex.check(m).every((c) => c.ok)).toBe(true);
    });
  }
});
