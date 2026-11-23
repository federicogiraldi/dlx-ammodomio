import { describe, it, expect } from 'vitest';
import { Machine } from '../../src/core/machine';
import { CLOCKS } from '../../src/core/cpu/cpu';
import { SimError } from '../../src/core/util';
import { exec1, mk, RAM } from './helpers';

const VALS = [0, 1, 2, 0x7fffffff, 0x80000000, 0x80000001, 0xffffffff, 0xfffffffe, 0x12345678, 0x0000ffff];
const s = (v: number) => v | 0;
const u = (v: number) => v >>> 0;

/** modello di riferimento per le istruzioni registro-registro */
const RR: Record<string, (a: number, b: number) => number> = {
  ADD: (a, b) => u(a + b),
  ADDU: (a, b) => u(a + b),
  SUB: (a, b) => u(a - b),
  SUBU: (a, b) => u(a - b),
  AND: (a, b) => u(a & b),
  OR: (a, b) => u(a | b),
  XOR: (a, b) => u(a ^ b),
  SLL: (a, b) => u(a << (b & 31)),
  SRL: (a, b) => u(a >>> (b & 31)),
  SRA: (a, b) => u(s(a) >> (b & 31)),
  SEQ: (a, b) => +(a === b),
  SNE: (a, b) => +(a !== b),
  SLT: (a, b) => +(s(a) < s(b)),
  SGT: (a, b) => +(s(a) > s(b)),
  SLE: (a, b) => +(s(a) <= s(b)),
  SGE: (a, b) => +(s(a) >= s(b)),
  SLTU: (a, b) => +(a < b),
  SGTU: (a, b) => +(a > b),
  SLEU: (a, b) => +(a <= b),
  SGEU: (a, b) => +(a >= b),
};

/** immediato grezzo a 16 bit → valore esteso (signed o zero) */
const sx = (i: number) => u((i << 16) >> 16);
const zx = (i: number) => i & 0xffff;
const RI: Record<string, { ext: (i: number) => number; f: (a: number, b: number) => number }> = {
  ADDI: { ext: sx, f: RR.ADD },
  ADDUI: { ext: zx, f: RR.ADD },
  SUBI: { ext: sx, f: RR.SUB },
  SUBUI: { ext: zx, f: RR.SUB },
  ANDI: { ext: zx, f: RR.AND },
  ORI: { ext: zx, f: RR.OR },
  XORI: { ext: zx, f: RR.XOR },
  SEQI: { ext: sx, f: RR.SEQ },
  SNEI: { ext: sx, f: RR.SNE },
  SLTI: { ext: sx, f: RR.SLT },
  SGTI: { ext: sx, f: RR.SGT },
  SLEI: { ext: sx, f: RR.SLE },
  SGEI: { ext: sx, f: RR.SGE },
};
const IMMS = [0, 1, 5, 0x7fff, 0x8000, 0x8001, 0xffff, 0xfffe, 0x1234];

describe('ALU registro-registro (modello di riferimento)', () => {
  for (const [mn, f] of Object.entries(RR)) {
    it(mn, () => {
      const m = mk(`${mn} R3,R1,R2`);
      for (const a of VALS) {
        for (const b of VALS) {
          m.cpu.pc = 0;
          m.cpu.regs[1] = a;
          m.cpu.regs[2] = b;
          m.step();
          expect(m.cpu.regs[3], `${mn} ${a.toString(16)} ${b.toString(16)}`).toBe(f(a, b));
          expect(m.cpu.regs[1]).toBe(a);
          expect(m.cpu.regs[2]).toBe(b);
        }
      }
    });
  }
  it('rd uguale a un sorgente (ADD R1,R1,R1)', () => {
    const { m } = exec1('ADD R1,R1,R1', { 1: 21 });
    expect(m.cpu.regs[1]).toBe(42);
  });
});

describe('ALU con immediato (estensione signed/unsigned)', () => {
  for (const [mn, { ext, f }] of Object.entries(RI)) {
    it(mn, () => {
      for (const i of IMMS) {
        const m = mk(`${mn} R3,R1,${i}`);
        for (const a of VALS) {
          m.cpu.pc = 0;
          m.cpu.regs[1] = a;
          m.step();
          expect(m.cpu.regs[3], `${mn} ${a.toString(16)},${i.toString(16)}`).toBe(f(a, ext(i)));
        }
      }
    });
  }
  it('ADDI con 0xFFFF vale -1, ADDUI con 0xFFFF vale 65535', () => {
    expect(exec1('ADDI R1,R0,0xFFFF').m.cpu.regs[1]).toBe(0xffffffff);
    expect(exec1('ADDUI R1,R0,0xFFFF').m.cpu.regs[1]).toBe(0xffff);
    expect(exec1('ADDI R1,R0,0x7FFF').m.cpu.regs[1]).toBe(0x7fff);
    expect(exec1('ADDI R1,R0,0x8000').m.cpu.regs[1]).toBe(0xffff8000);
    expect(exec1('SUBUI R1,R0,0xFFFF').m.cpu.regs[1]).toBe(0xffff0001);
    expect(exec1('SUBI R1,R0,0xFFFF').m.cpu.regs[1]).toBe(1);
  });
  it('ANDI/ORI/XORI: estensione sempre senza segno', () => {
    expect(exec1('ANDI R1,R2,0xFFFF', { 2: 0xffffffff }).m.cpu.regs[1]).toBe(0x0000ffff);
    expect(exec1('ANDI R1,R2,0x8000', { 2: 0xffffffff }).m.cpu.regs[1]).toBe(0x00008000);
    expect(exec1('ORI R1,R2,0x8000', { 2: 0 }).m.cpu.regs[1]).toBe(0x00008000);
    expect(exec1('XORI R1,R2,0xFFFF', { 2: 0xffffffff }).m.cpu.regs[1]).toBe(0xffff0000);
  });
  it('SEQI con immediato negativo confronta con la versione estesa', () => {
    expect(exec1('SEQI R1,R2,-1', { 2: 0xffffffff }).m.cpu.regs[1]).toBe(1);
    expect(exec1('SEQI R1,R2,0xFFFF', { 2: 0x0000ffff }).m.cpu.regs[1]).toBe(0);
    expect(exec1('SLTI R1,R2,-1', { 2: 0xfffffffe }).m.cpu.regs[1]).toBe(1);
    expect(exec1('SGTI R1,R2,-1', { 2: 0 }).m.cpu.regs[1]).toBe(1);
  });
});

describe('LHI', () => {
  it('Rd = imm16 << 16', () => {
    expect(exec1('LHI R1,0x8000').m.cpu.regs[1]).toBe(0x80000000);
    expect(exec1('LHI R1,0xFFFF').m.cpu.regs[1]).toBe(0xffff0000);
    expect(exec1('LHI R1,0').m.cpu.regs[1]).toBe(0);
    expect(exec1('LHI R1,0x1234', { 1: 0xffffffff }).m.cpu.regs[1]).toBe(0x12340000);
    expect(exec1('LHI R1,0x7FFF').m.cpu.regs[1]).toBe(0x7fff0000);
  });
  it('LHI + ORI costruisce una costante a 32 bit', () => {
    const m = mk('LHI R1,0x1234\nORI R1,R1,0x8765\nHALT');
    m.run();
    expect(m.cpu.regs[1]).toBe(0x12348765);
  });
  it('LHI non accede alla memoria', () => {
    const { r } = exec1('LHI R1,0x4000');
    expect(r.mem.filter((a) => a.kind !== 'fetch')).toHaveLength(0);
  });
  it('hi()/lo() ricostruiscono qualsiasi costante', () => {
    const m = mk('LHI R1,hi(0xDEADBEEF)\nORI R1,R1,lo(0xDEADBEEF)\nHALT');
    m.run();
    expect(m.cpu.regs[1]).toBe(0xdeadbeef);
  });
});

describe('overflow', () => {
  const ov = (src: string, regs: Record<number, number>) => exec1(src, regs).r.overflow;
  it('ADD: positivo+positivo → negativo', () => {
    const { m, r } = exec1('ADD R3,R1,R2', { 1: 0x7fffffff, 2: 1 });
    expect(r.overflow).toBe(true);
    expect(m.cpu.regs[3]).toBe(0x80000000); // wrap
  });
  it('ADD: negativo+negativo → positivo', () => {
    const { m, r } = exec1('ADD R3,R1,R2', { 1: 0x80000000, 2: 0xffffffff });
    expect(r.overflow).toBe(true);
    expect(m.cpu.regs[3]).toBe(0x7fffffff);
  });
  it('ADD senza overflow ai limiti', () => {
    expect(ov('ADD R3,R1,R2', { 1: 0x7fffffff, 2: 0xffffffff })).toBeFalsy();
    expect(ov('ADD R3,R1,R2', { 1: 0x7fffffff, 2: 0 })).toBeFalsy();
    expect(ov('ADD R3,R1,R2', { 1: 0x80000000, 2: 0x7fffffff })).toBeFalsy();
    expect(ov('ADD R3,R1,R2', { 1: 0x80000000, 2: 0 })).toBeFalsy();
    expect(ov('ADD R3,R1,R2', { 1: 0xffffffff, 2: 1 })).toBeFalsy(); // -1 + 1 = 0 (carry ma non overflow)
  });
  it('ADDI: overflow con 0x7FFFFFFF + 1; -1 su 0x80000000', () => {
    expect(ov('ADDI R3,R1,1', { 1: 0x7fffffff })).toBe(true);
    expect(ov('ADDI R3,R1,-1', { 1: 0x80000000 })).toBe(true);
    expect(ov('ADDI R3,R1,0xFFFF', { 1: 0x80000000 })).toBe(true); // 0xFFFF = -1
    expect(ov('ADDI R3,R1,0x7FFF', { 1: 0x7fff8000 })).toBeFalsy();
    expect(ov('ADDI R3,R1,0x7FFF', { 1: 0x7fff8001 })).toBe(true);
  });
  it('SUB: overflow', () => {
    expect(ov('SUB R3,R1,R2', { 1: 0x80000000, 2: 1 })).toBe(true);
    expect(ov('SUB R3,R1,R2', { 1: 0x7fffffff, 2: 0xffffffff })).toBe(true); // MAX - (-1)
    expect(ov('SUB R3,R1,R2', { 1: 0, 2: 0x80000000 })).toBe(true); // -MIN non rappresentabile
    expect(ov('SUB R3,R1,R2', { 1: 0, 2: 1 })).toBeFalsy();
    expect(ov('SUB R3,R1,R2', { 1: 0x80000000, 2: 0x80000000 })).toBeFalsy();
    expect(ov('SUB R3,R1,R2', { 1: 5, 2: 0x80000000 })).toBe(true);
    expect(ov('SUB R3,R1,R2', { 1: 0xffffffff, 2: 0x7fffffff })).toBeFalsy(); // -1 - MAX = MIN
    expect(ov('SUB R3,R1,R2', { 1: 0xfffffffe, 2: 0x7fffffff })).toBe(true); // -2 - MAX
  });
  it('SUBI: overflow', () => {
    expect(ov('SUBI R3,R1,1', { 1: 0x80000000 })).toBe(true);
    expect(ov('SUBI R3,R1,-1', { 1: 0x7fffffff })).toBe(true);
    expect(ov('SUBI R3,R1,1', { 1: 0 })).toBeFalsy();
  });
  it('ADDU/SUBU/ADDUI/SUBUI e logiche/shift non segnalano mai overflow', () => {
    expect(ov('ADDU R3,R1,R2', { 1: 0xffffffff, 2: 1 })).toBeFalsy();
    expect(ov('ADDU R3,R1,R2', { 1: 0x7fffffff, 2: 1 })).toBeFalsy();
    expect(ov('SUBU R3,R1,R2', { 1: 0, 2: 1 })).toBeFalsy();
    expect(ov('SUBU R3,R1,R2', { 1: 0x80000000, 2: 1 })).toBeFalsy();
    expect(ov('ADDUI R3,R1,1', { 1: 0x7fffffff })).toBeFalsy();
    expect(ov('SUBUI R3,R1,1', { 1: 0x80000000 })).toBeFalsy();
    expect(ov('SLL R3,R1,R2', { 1: 0x7fffffff, 2: 4 })).toBeFalsy();
  });
  it('modello esaustivo ADD/SUB sui valori di prova', () => {
    const mAdd = mk('ADD R3,R1,R2');
    const mSub = mk('SUB R3,R1,R2');
    for (const a of VALS) {
      for (const b of VALS) {
        for (const [m, op] of [[mAdd, (x: number, y: number) => s(x) + s(y)], [mSub, (x: number, y: number) => s(x) - s(y)]] as const) {
          m.cpu.pc = 0;
          m.cpu.regs[1] = a;
          m.cpu.regs[2] = b;
          const r = m.step();
          const exact = op(a, b);
          expect(!!r.overflow, `${a.toString(16)} ${b.toString(16)}`).toBe(exact > 0x7fffffff || exact < -0x80000000);
        }
      }
    }
  });
  it('trapOnOverflow: SimError, stato invariato; ADDU non lancia', () => {
    const m = mk('ADD R3,R1,R2\nADDU R4,R1,R2\nHALT', { 1: 0x7fffffff, 2: 1, 3: 77 });
    m.cpu.opts.trapOnOverflow = true;
    expect(() => m.step()).toThrow(SimError);
    expect(m.cpu.pc).toBe(0);
    expect(m.cpu.regs[3]).toBe(77);
    expect(m.cpu.instret).toBe(0);
    expect(m.history).toHaveLength(0);
    m.cpu.pc = 4;
    m.step();
    expect(m.cpu.regs[4]).toBe(0x80000000);
  });
  it('trapOnOverflow per ADDI, SUB e SUBI', () => {
    for (const [src, regs] of [['ADDI R3,R1,1', { 1: 0x7fffffff }], ['SUB R3,R1,R2', { 1: 0x80000000, 2: 1 }], ['SUBI R3,R1,1', { 1: 0x80000000 }]] as const) {
      const m = mk(src, regs);
      m.cpu.opts.trapOnOverflow = true;
      expect(() => m.step(), src).toThrow(/verflow/);
    }
  });
});

describe('shift', () => {
  it('quantità 0, 31, 32, 33 e oltre (si usano i 5 bit bassi)', () => {
    const run = (mn: string, a: number, n: number) => {
      const m = mk(`${mn} R3,R1,R2`);
      m.cpu.regs[1] = a;
      m.cpu.regs[2] = n;
      m.step();
      return m.cpu.regs[3];
    };
    expect(run('SLL', 0x80000001, 0)).toBe(0x80000001);
    expect(run('SLL', 1, 31)).toBe(0x80000000);
    expect(run('SLL', 1, 32)).toBe(1);
    expect(run('SLL', 1, 33)).toBe(2);
    expect(run('SLL', 1, 0xffffffe1)).toBe(2);
    expect(run('SRL', 0x80000000, 31)).toBe(1);
    expect(run('SRL', 0x80000000, 32)).toBe(0x80000000);
    expect(run('SRL', 0xffffffff, 1)).toBe(0x7fffffff);
    expect(run('SRA', 0x80000000, 31)).toBe(0xffffffff);
    expect(run('SRA', 0x80000000, 1)).toBe(0xc0000000);
    expect(run('SRA', 0x7fffffff, 31)).toBe(0);
    expect(run('SRA', 0x80000000, 32)).toBe(0x80000000);
    expect(run('SRA', 0xfffffff0, 4)).toBe(0xffffffff);
  });
  it('varianti con immediato', () => {
    expect(exec1('SLLI R3,R1,31', { 1: 1 }).m.cpu.regs[3]).toBe(0x80000000);
    expect(exec1('SLLI R3,R1,0', { 1: 5 }).m.cpu.regs[3]).toBe(5);
    expect(exec1('SLLI R3,R1,32', { 1: 5 }).m.cpu.regs[3]).toBe(5);
    expect(exec1('SLLI R3,R1,33', { 1: 5 }).m.cpu.regs[3]).toBe(10);
    expect(exec1('SRLI R3,R1,31', { 1: 0xffffffff }).m.cpu.regs[3]).toBe(1);
    expect(exec1('SRAI R3,R1,31', { 1: 0x80000000 }).m.cpu.regs[3]).toBe(0xffffffff);
    expect(exec1('SRAI R3,R1,4', { 1: 0x70000000 }).m.cpu.regs[3]).toBe(0x07000000);
  });
  it('SLL non è SLA: moltiplica per 2^n anche con segno', () => {
    expect(exec1('SLLI R3,R1,2', { 1: 0xfffffffe }).m.cpu.regs[3]).toBe(0xfffffff8);
  });
});

describe('confronti signed / unsigned', () => {
  it('0x80000000 e 0xFFFFFFFF', () => {
    const t = (mn: string, a: number, b: number) => exec1(`${mn} R3,R1,R2`, { 1: a, 2: b }).m.cpu.regs[3];
    expect(t('SLT', 0x80000000, 1)).toBe(1);
    expect(t('SLTU', 0x80000000, 1)).toBe(0);
    expect(t('SGT', 0xffffffff, 0)).toBe(0);
    expect(t('SGTU', 0xffffffff, 0)).toBe(1);
    expect(t('SLE', 0xffffffff, 0xffffffff)).toBe(1);
    expect(t('SLEU', 0xffffffff, 0x80000000)).toBe(0);
    expect(t('SLE', 0xffffffff, 0x80000000)).toBe(0);
    expect(t('SGE', 0x80000000, 0x7fffffff)).toBe(0);
    expect(t('SGEU', 0x80000000, 0x7fffffff)).toBe(1);
    expect(t('SEQ', 0xffffffff, 0xffffffff)).toBe(1);
    expect(t('SNE', 0xffffffff, 0xfffffffe)).toBe(1);
  });
  it('il risultato è esattamente 0 o 1 (32 bit)', () => {
    expect(exec1('SLT R3,R1,R2', { 1: 1, 2: 2, 3: 0xffffffff }).m.cpu.regs[3]).toBe(1);
    expect(exec1('SLT R3,R1,R2', { 1: 2, 2: 1, 3: 0xffffffff }).m.cpu.regs[3]).toBe(0);
  });
});

describe('R0', () => {
  it('le scritture su R0 sono scartate (ALU, load, LHI, JAL non applicabile, MOVS2I)', () => {
    for (const src of ['ADDI R0,R0,5', 'ADD R0,R1,R1', 'LHI R0,0x1234', 'MOVS2I R0,IAR', 'SLLI R0,R1,1', 'SEQ R0,R0,R0']) {
      const { m, r } = exec1(src, { 1: 7 });
      expect(m.cpu.regs[0], src).toBe(0);
      expect(r.regWrites.find((w) => w.reg === 0), src).toBeUndefined();
    }
    const m = mk('LW R0,0(R1)', { 1: RAM });
    m.bus.write(RAM, 4, 0x1234);
    m.step();
    expect(m.cpu.regs[0]).toBe(0);
  });
  it('R0 legge sempre 0 anche se il Uint32Array fosse stato alterato', () => {
    const m = mk('ADD R1,R0,R0');
    m.cpu.regs[0] = 99; // anomalo
    m.step();
    expect(m.cpu.regs[0]).toBe(0);
  });
  it('dopo reset R0 = 0 e gli altri registri sono (di norma) casuali', () => {
    const m = new Machine();
    expect(m.cpu.regs[0]).toBe(0);
    let nonzero = 0;
    for (let i = 1; i < 32; i++) if (m.cpu.regs[i] !== 0) nonzero++;
    expect(nonzero).toBeGreaterThan(20);
    expect(m.cpu.regInit[0]).toBe(1);
    expect(m.cpu.regInit[5]).toBe(0);
  });
});

describe('load / store', () => {
  const setup = (src: string, regs: Record<number, number> = {}) => mk(src, { 1: RAM, ...regs });

  it('SW/LW big-endian', () => {
    const m = setup('SW R2,0(R1)\nLW R3,0(R1)\nLB R4,0(R1)\nLB R5,3(R1)\nLHU R6,0(R1)\nLHU R7,2(R1)\nHALT', { 2: 0x11223344 });
    m.run();
    expect([0, 1, 2, 3].map((i) => m.bus.peek(RAM + i).value)).toEqual([0x11, 0x22, 0x33, 0x44]);
    expect(m.cpu.regs[3]).toBe(0x11223344);
    expect(m.cpu.regs[4]).toBe(0x11);
    expect(m.cpu.regs[5]).toBe(0x44);
    expect(m.cpu.regs[6]).toBe(0x1122);
    expect(m.cpu.regs[7]).toBe(0x3344);
  });
  it('LB/LBU/LH/LHU: estensione del segno', () => {
    const m = setup('SW R2,0(R1)\nLB R3,0(R1)\nLBU R4,0(R1)\nLH R5,0(R1)\nLHU R6,0(R1)\nLB R7,1(R1)\nLH R8,2(R1)\nHALT', { 2: 0x80ff7f01 });
    m.run();
    expect(m.cpu.regs[3]).toBe(0xffffff80);
    expect(m.cpu.regs[4]).toBe(0x80);
    expect(m.cpu.regs[5]).toBe(0xffff80ff);
    expect(m.cpu.regs[6]).toBe(0x80ff);
    expect(m.cpu.regs[7]).toBe(0xffffffff);
    expect(m.cpu.regs[8]).toBe(0x7f01);
  });
  it('SB/SH scrivono solo i byte bassi e non toccano i vicini', () => {
    const m = setup('SW R2,0(R1)\nSB R3,1(R1)\nSH R4,2(R1)\nLW R5,0(R1)\nHALT', { 2: 0x11223344, 3: 0xaabbccdd, 4: 0x99887766 });
    m.run();
    expect(m.cpu.regs[5]).toBe(0x11dd7766);
  });
  it('offset negativo e offset 0x8000 esteso con segno', () => {
    const m = mk('LW R2,-4(R1)\nLW R3,0x8000(R4)\nHALT', { 1: RAM + 8, 4: RAM + 0x8000 });
    m.bus.write(RAM + 4, 4, 0xcafebabe);
    m.bus.write(RAM, 4, 0x01020304);
    m.run();
    expect(m.cpu.regs[2]).toBe(0xcafebabe);
    expect(m.cpu.regs[3]).toBe(0x01020304); // 0x40008000 - 0x8000
  });
  it('indirizzo con wrap a 32 bit (base alta + offset)', () => {
    const m = mk('SW R2,-4(R1)\nHALT', { 1: 0xe0000008, 2: 5 });
    m.run();
    expect(m.bus.peekWord(0xe0000004).value).toBe(5);
  });
  it('base R0 con indirizzo assoluto (EPROM) e lettura del codice', () => {
    const m = mk('LW R1,0(R0)\nHALT');
    m.step();
    expect(m.cpu.regs[1]).toBe(m.program!.bytes.get(0)! * 0x1000000 + m.program!.bytes.get(1)! * 0x10000 + m.program!.bytes.get(2)! * 0x100 + m.program!.bytes.get(3)!);
  });
  it('alignment fault: LW/SW non multipli di 4, LH/SH dispari; LB sempre ok', () => {
    for (const [src, off] of [['LW R2,%(R1)', 1], ['LW R2,%(R1)', 2], ['LW R2,%(R1)', 3], ['SW R2,%(R1)', 1], ['SW R2,%(R1)', 2], ['SW R2,%(R1)', 3], ['LH R2,%(R1)', 1], ['LHU R2,%(R1)', 3], ['SH R2,%(R1)', 1]] as const) {
      const m = mk(src.replace('%', String(off)), { 1: RAM });
      const before = m.cpu.snapshot();
      let err: unknown;
      try { m.step(); } catch (e) { err = e; }
      expect(err, `${src} ${off}`).toBeInstanceOf(SimError);
      expect((err as SimError).text.it).toContain('Alignment');
      expect(m.cpu.pc).toBe(before.pc);
      expect(Array.from(m.cpu.regs)).toEqual(Array.from(before.regs));
    }
    for (const off of [0, 1, 2, 3]) {
      const m = mk(`LB R2,${off}(R1)\nSB R2,${off}(R1)`, { 1: RAM });
      m.step();
      m.step();
      expect(m.cpu.pc).toBe(8);
    }
    // LH/SH agli indirizzi pari
    for (const off of [0, 2, 4]) {
      const m = mk(`SH R2,${off}(R1)\nLH R3,${off}(R1)`, { 1: RAM, 2: 0x1234 });
      m.step();
      m.step();
      expect(m.cpu.regs[3]).toBe(0x1234);
    }
  });
  it('l\'alignment dipende dall\'indirizzo effettivo, non dall\'offset', () => {
    const m = mk('LW R2,1(R1)\nHALT', { 1: RAM + 3 });
    expect(() => m.step()).not.toThrow(); // 0x40000004
    const n = mk('LW R2,4(R1)\nHALT', { 1: RAM + 2 });
    expect(() => n.step()).toThrow(SimError);
  });
  it('scrittura in EPROM → errore; EPROM non programmata legge 0xFF', () => {
    const m = mk('SW R2,0x100(R0)\nHALT', { 2: 5 });
    expect(() => m.step()).toThrow(/EPROM/);
    expect(m.cpu.pc).toBe(0);
    const n = mk('LW R2,0x1000(R0)\nLB R3,0x1001(R0)\nLBU R4,0x1001(R0)\nHALT');
    n.run();
    expect(n.cpu.regs[2]).toBe(0xffffffff);
    expect(n.cpu.regs[3]).toBe(0xffffffff);
    expect(n.cpu.regs[4]).toBe(0xff);
  });
  it('accesso a indirizzo non mappato (lettura/scrittura) → errore', () => {
    for (const src of ['LW R2,0(R1)', 'SW R2,0(R1)', 'LB R2,0(R1)']) {
      const m = mk(src, { 1: 0x20000000 });
      expect(() => m.step(), src).toThrow(/nessun dispositivo/);
    }
  });
  it('RAM non inizializzata: valore casuale ma stabile, flag garbage nel log', () => {
    const m = mk('LW R2,0(R1)\nLW R3,0(R1)\nHALT', { 1: RAM + 0x100 });
    const r1 = m.step();
    const r2 = m.step();
    expect(r1.mem.find((a) => a.kind === 'read')!.garbage).toBe(true);
    expect(m.cpu.regs[2]).toBe(m.cpu.regs[3]);
    expect(r2.mem.find((a) => a.kind === 'read')!.garbage).toBe(true);
  });
  it('RAM scritta: nessun garbage; scrittura parziale poi lettura word → garbage', () => {
    const m = mk('SW R2,0(R1)\nLW R3,0(R1)\nSB R2,8(R1)\nLW R4,8(R1)\nHALT', { 1: RAM, 2: 0x01020304 });
    m.step();
    expect(m.step().mem.find((a) => a.kind === 'read')!.garbage).toBeFalsy();
    m.step();
    expect(m.step().mem.find((a) => a.kind === 'read')!.garbage).toBe(true);
  });
  it('byte uninizializzato ≠ garbage dopo una scrittura che lo copre', () => {
    const m = mk('SH R2,0(R1)\nLH R3,0(R1)\nHALT', { 1: RAM, 2: 0xbeef });
    m.step();
    const r = m.step();
    expect(r.mem.find((a) => a.kind === 'read')!.garbage).toBeFalsy();
    expect(m.cpu.regs[3]).toBe(0xffffbeef);
  });
  it('RAM alta (0xE0000000) accessibile', () => {
    const m = mk('LHI R1,0xE000\nSW R2,0x200(R1)\nLW R3,0x200(R1)\nHALT', { 2: 0x55 });
    m.run();
    expect(m.cpu.regs[3]).toBe(0x55);
  });
});

describe('salti', () => {
  it('BEQZ/BNEZ preso / non preso', () => {
    const t = (mn: string, v: number) => {
      const m = mk(`${mn} R1,skip\nADDI R2,R0,1\nskip: HALT`, { 1: v, 2: 0 });
      const r = m.step();
      return { taken: r.taken, next: m.cpu.pc, nextPC: r.nextPC };
    };
    expect(t('BEQZ', 0)).toEqual({ taken: true, next: 8, nextPC: 8 });
    expect(t('BEQZ', 1)).toEqual({ taken: false, next: 4, nextPC: 4 });
    expect(t('BEQZ', 0x80000000).taken).toBe(false);
    expect(t('BNEZ', 0)).toEqual({ taken: false, next: 4, nextPC: 4 });
    expect(t('BNEZ', 1)).toEqual({ taken: true, next: 8, nextPC: 8 });
    expect(t('BNEZ', 0xffffffff).taken).toBe(true);
  });
  it('R0 nel BEQZ: sempre preso', () => {
    const m = mk('BEQZ R0,8\nNOP\nNOP\nHALT');
    m.step();
    expect(m.cpu.pc).toBe(12);
  });
  it('offset negativo: ciclo con contatore', () => {
    const m = mk('ADDI R1,R0,5\nL: SUBI R1,R1,1\nBNEZ R1,L\nHALT');
    const out = m.run();
    expect(out.reason).toBe('halt');
    expect(m.cpu.regs[1]).toBe(0);
    expect(out.steps).toBe(1 + 5 * 2 + 1);
  });
  it('target = PC+4 + offset (offset numerico grezzo, da una istruzione a 0x10)', () => {
    const m = mk('.org 0x10\nBNEZ R1,-8\n.org 0x0C\nHALT\n.org 8\nHALT', { 1: 1 });
    m.cpu.pc = 0x10;
    m.step();
    expect(m.cpu.pc).toBe(0x10 + 4 - 8);
  });
  it('J avanti e indietro', () => {
    const m = mk('J fine\nADDI R1,R0,1\nfine: ADDI R2,R0,2\nHALT');
    m.run();
    expect(m.cpu.regs[1]).not.toBe(1);
    expect(m.cpu.regs[2]).toBe(2);
    const k = mk('NOP\nJ end\nstart: ADDI R3,R0,3\nHALT\nend: J start');
    k.run();
    expect(k.cpu.regs[3]).toBe(3);
  });
  it('JAL salva PC+4 in R31, JR R31 ritorna', () => {
    const m = mk('JAL f\nADDI R2,R0,2\nHALT\nf: ADDI R1,R0,1\nJR R31');
    const r = m.step();
    expect(m.cpu.regs[31]).toBe(4);
    expect(m.cpu.pc).toBe(12);
    expect(r.regWrites).toEqual([{ reg: 31, old: r.regWrites[0].old, value: 4 }]);
    m.run();
    expect(m.cpu.regs[1]).toBe(1);
    expect(m.cpu.regs[2]).toBe(2);
  });
  it('JAL da un indirizzo alto del codice: R31 = PC+4', () => {
    const m = mk('.org 0x100\nJAL f\nHALT\nf: JR R31');
    m.cpu.pc = 0x100;
    m.step();
    expect(m.cpu.regs[31]).toBe(0x104);
  });
  it('JALR/JR saltano esattamente al valore del registro', () => {
    const m = mk('JALR R5\nHALT\nHALT\nf: ADDI R1,R0,9\nJR R31', { 5: 12 });
    m.step();
    expect(m.cpu.pc).toBe(12);
    expect(m.cpu.regs[31]).toBe(4);
    m.step();
    m.step();
    expect(m.cpu.pc).toBe(4);
    expect(m.cpu.regs[1]).toBe(9);
  });
  it('JALR R31 usa il vecchio R31 come destinazione', () => {
    const m = mk('JALR R31\nHALT\nHALT', { 31: 8 });
    m.step();
    expect(m.cpu.pc).toBe(8);
    expect(m.cpu.regs[31]).toBe(4);
  });
  it('JR a indirizzo non multiplo di 4: PC accettato, errore al fetch successivo', () => {
    const m = mk('JR R5\nHALT', { 5: 6 });
    m.step();
    expect(m.cpu.pc).toBe(6);
    expect(() => m.step()).toThrow(/multiplo di 4/);
  });
  it('JR in zona non programmata (EPROM 0xFF) o non mappata → errore chiaro', () => {
    const m = mk('JR R5', { 5: 0x1000 });
    m.step();
    expect(() => m.step()).toThrow(/EPROM non programmata/);
    const o = mk('JR R5', { 5: 0x20000000 });
    o.step();
    expect(() => o.step()).toThrow(/nessun dispositivo/);
  });
  it('nessun delay slot: l\'istruzione dopo il salto non viene eseguita', () => {
    const m = mk('J L\nADDI R9,R0,1\nL: HALT', { 9: 0 });
    m.run();
    expect(m.cpu.regs[9]).toBe(0);
  });
});

describe('istruzioni speciali', () => {
  it('TRAP 0 / HALT fermano la CPU; step successivo lancia', () => {
    for (const h of ['HALT', 'TRAP 0']) {
      const m = mk(`${h}\nNOP`);
      const r = m.step();
      expect(r.halted).toBe(true);
      expect(m.cpu.halted).toBe(true);
      expect(m.cpu.pc).toBe(0);
      expect(() => m.step()).toThrow(/fermo/);
    }
  });
  it('TRAP n: IAR ← PC+4, salto a n, interruzioni disabilitate', () => {
    const m = mk('NOP\nTRAP 0x20\n.org 0x20\nHALT');
    m.step();
    m.cpu.ien = true;
    m.step();
    expect(m.cpu.iar).toBe(8);
    expect(m.cpu.pc).toBe(0x20);
    expect(m.cpu.ien).toBe(false);
    expect(m.cpu.halted).toBe(false);
  });
  it('MOVI2S / MOVS2I', () => {
    const m = mk('MOVI2S IAR,R1\nMOVS2I R2,IAR\nHALT', { 1: 0xdeadbee0 });
    m.step();
    expect(m.cpu.iar).toBe(0xdeadbee0);
    m.step();
    expect(m.cpu.regs[2]).toBe(0xdeadbee0);
    expect(m.cpu.regs[1]).toBe(0xdeadbee0);
  });
  it('RFE: PC ← IAR e ien ← true', () => {
    const m = mk('RFE\nHALT\nHALT\nHALT', {});
    m.cpu.iar = 12;
    m.cpu.ien = false;
    const r = m.step();
    expect(m.cpu.pc).toBe(12);
    expect(m.cpu.ien).toBe(true);
    expect(r.nextPC).toBe(12);
  });
  it('NOP: cambia solo PC e contatori', () => {
    const m = mk('NOP\nHALT');
    const regs = Array.from(m.cpu.regs);
    const r = m.step();
    expect(Array.from(m.cpu.regs)).toEqual(regs);
    expect(m.cpu.pc).toBe(4);
    expect(r.regWrites).toEqual([]);
    expect(m.cpu.instret).toBe(1);
  });
  it('istruzione non valida in EPROM (dato come codice) → errore con testo', () => {
    const m = mk('.word 0\nHALT');
    expect(() => m.step()).toThrow(/non valida/);
    const n = mk('.word 0xFFFFFFFF');
    expect(() => n.step()).toThrow(/EPROM non programmata/);
  });
  it('PC non allineato → errore', () => {
    const m = mk('NOP\nHALT');
    m.cpu.pc = 2;
    expect(() => m.step()).toThrow(/multiplo di 4/);
  });
});

describe('StepResult', () => {
  it('contiene testo, registri scritti con vecchio/nuovo valore e accessi', () => {
    const m = mk('ADDI R5,R0,7\nSW R5,0(R1)\nHALT', { 1: RAM, 5: 123 });
    const r1 = m.step();
    expect(r1.pc).toBe(0);
    expect(r1.text).toBe('ADDI R5,R0,7');
    expect(r1.regWrites).toEqual([{ reg: 5, old: 123, value: 7 }]);
    expect(r1.mem.map((a) => a.kind)).toEqual(['fetch']);
    expect(r1.nextPC).toBe(4);
    expect(r1.explanation.length).toBeGreaterThan(0);
    expect(r1.micro.length).toBeGreaterThan(2);
    const r2 = m.step();
    const w = r2.mem.find((a) => a.kind === 'write')!;
    expect(w).toMatchObject({ addr: RAM, size: 4, value: 7, device: 'RAM' });
    expect(r2.regWrites).toEqual([]);
  });
  it('la spiegazione è bilingue', () => {
    const r = exec1('ADD R1,R2,R3').r;
    for (const t of r.explanation) {
      expect(t.it.length).toBeGreaterThan(0);
      expect(t.en.length).toBeGreaterThan(0);
    }
  });
  it('cicli di clock secondo la tabella delle slide', () => {
    const cl = (src: string, regs: Record<number, number> = {}) => exec1(src, { 1: RAM, ...regs }).r.clocks;
    expect(cl('ADD R3,R4,R5')).toBe(CLOCKS.alu);
    expect(cl('ADDI R3,R4,5')).toBe(CLOCKS.alu);
    expect(cl('SLT R3,R4,R5')).toBe(CLOCKS.set);
    expect(cl('SEQI R3,R4,5')).toBe(CLOCKS.set);
    expect(cl('SW R3,0(R1)')).toBe(CLOCKS.store);
    expect(cl('J 0')).toBe(CLOCKS.jump);
    expect(cl('JAL 0')).toBe(CLOCKS.jal);
    expect(cl('BEQZ R0,0')).toBe(CLOCKS.branchTaken);
    expect(cl('BNEZ R0,0')).toBe(CLOCKS.branchNotTaken);
    expect(CLOCKS).toMatchObject({ load: 8, store: 7, alu: 6, set: 7, jump: 4, jal: 6, branchTaken: 5, branchNotTaken: 4 });
    const m = mk('SW R2,0(R1)\nLW R3,0(R1)', { 1: RAM });
    m.step();
    expect(m.step().clocks).toBe(CLOCKS.load);
    expect(m.cpu.cycles).toBe(CLOCKS.store + CLOCKS.load);
  });
  it('overflow nel risultato solo per ADD/SUB signed', () => {
    expect(exec1('ADD R3,R1,R2', { 1: 1, 2: 2 }).r.overflow).toBeFalsy();
  });
});

describe('programmi delle slide', () => {
  it('somma di 8 word (RAM a 0x40000000, indirizzo base 0x800 come nelle slide)', () => {
    const m = new Machine();
    const p = m.load(`
        LHI R5,0x4000          ; R5 = 0x40000000
        ADDI R6,R0,1           ; valore da scrivere
        ADDI R2,R0,0           ; i = 0
init:   ADD R8,R5,R2
        SW R6,0x0800(R8)       ; v[i] = i+1
        ADDI R6,R6,1
        ADDI R2,R2,4
        SNEI R7,R2,32
        BNEZ R7,init
        ADD R1,R0,R0           ; somma
        ADDI R2,R0,32
Loop:   SUBI R2,R2,4
        ADD R8,R5,R2
        LW R3,0x0800(R8)
        ADD R1,R1,R3
        BNEZ R2,Loop
        HALT`);
    expect(p.ok).toBe(true);
    const out = m.run();
    expect(out.reason).toBe('halt');
    expect(m.cpu.regs[1]).toBe(36);
    for (let i = 0; i < 8; i++) expect(m.bus.peekWord(RAM + 0x800 + 4 * i).value).toBe(i + 1);
  });

  it('scrittura dell\'array 0..7 in 0xE0000800 con SNEI R4,R2,8 / BNEZ R4,Loop', () => {
    const m = new Machine();
    const p = m.load(`
        LHI R1,0xE000
        ADDI R2,R0,0
Loop:   SLLI R3,R2,2
        ADD R3,R3,R1
        SW R2,0x0800(R3)
        ADDI R2,R2,1
        SNEI R4,R2,8
        BNEZ R4,Loop
        HALT`);
    expect(p.ok).toBe(true);
    expect(m.run().reason).toBe('halt');
    for (let i = 0; i < 8; i++) expect(m.bus.peekWord(0xe0000800 + 4 * i).value).toBe(i);
    expect(m.bus.peekWord(0xe0000820).init).toBe(false);
    expect(m.cpu.regs[2]).toBe(8);
    expect(m.cpu.regs[4]).toBe(0);
  });

  it('LHI/ADDI/SH/LHU/LH: 0x7FF1 è disallineato per SH e deve dare fault', () => {
    // versione con indirizzo base 0x40000000 + offset 0x7FF2 (pari: ok)
    const ok = new Machine();
    expect(ok.load(`
        LHI R1,0x4000
        ADDI R2,R0,0x0081
        SH R2,0x7FF2(R1)
        LHU R3,0x7FF2(R1)
        LH R4,0x7FF2(R1)
        HALT`).ok).toBe(true);
    expect(ok.run().reason).toBe('halt');
    expect(ok.cpu.regs[3]).toBe(0x0081);
    expect(ok.cpu.regs[4]).toBe(0x0081);
    expect(ok.bus.peek(RAM + 0x7ff2).value).toBe(0x00);
    expect(ok.bus.peek(RAM + 0x7ff3).value).toBe(0x81);

    // con offset dispari 0x7FF1 la SH deve generare un alignment fault
    const bad = new Machine();
    expect(bad.load(`
        LHI R1,0x4000
        ADDI R2,R0,0x0081
        SH R2,0x7FF1(R1)
        LHU R3,0x7FF1(R1)
        HALT`).ok).toBe(true);
    const out = bad.run();
    expect(out.reason).toBe('error');
    expect(out.error!.text.it).toContain('Alignment');
    expect(out.error!.pc).toBe(8);
    expect(bad.cpu.pc).toBe(8); // lo stato è quello prima dell'istruzione che fallisce
    expect(bad.bus.peek(RAM + 0x7ff1).init).toBe(false);
  });

  it('LH con halfword negativa e LHU/LB/LBU sullo stesso dato', () => {
    const m = new Machine();
    m.load(`
        LHI R1,0x4000
        ADDI R2,R0,0x8001
        SH R2,0x0010(R1)
        LH R3,0x0010(R1)
        LHU R4,0x0010(R1)
        LB R5,0x0010(R1)
        LBU R6,0x0011(R1)
        HALT`);
    m.run();
    expect(m.cpu.regs[2]).toBe(0xffff8001);
    expect(m.cpu.regs[3]).toBe(0xffff8001);
    expect(m.cpu.regs[4]).toBe(0x8001);
    expect(m.cpu.regs[5]).toBe(0xffffff80);
    expect(m.cpu.regs[6]).toBe(1);
  });

  it('procedura con JAL/JR R31 e stack in RAM alta', () => {
    const m = new Machine();
    m.load(`
        LHI R29,0xE000
        ADDI R29,R29,0x1000
        ADDI R1,R0,5
        JAL fact
        HALT
fact:   SUBI R29,R29,8
        SW R31,4(R29)
        SW R1,0(R29)
        SEQI R2,R1,1
        BNEZ R2,base
        SUBI R1,R1,1
        JAL fact
        LW R3,0(R29)
        ; R1 = R1 * R3 tramite somme ripetute
        ADD R4,R0,R0
mul:    BEQZ R3,done
        ADD R4,R4,R1
        SUBI R3,R3,1
        J mul
done:   ADD R1,R4,R0
base:   LW R31,4(R29)
        ADDI R29,R29,8
        JR R31`);
    expect(m.run(100000).reason).toBe('halt');
    expect(m.cpu.regs[1]).toBe(120);
  });
});
