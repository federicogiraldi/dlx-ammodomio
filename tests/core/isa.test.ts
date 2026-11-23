import { describe, it, expect } from 'vitest';
import { INSTRUCTIONS, BY_MN, BY_OPCODE, BY_FUNC, InstrDef, PSEUDO, syntaxOf } from '../../src/core/isa/table';
import { decode, disassemble, encode, Fields } from '../../src/core/isa/encode';
import { assemble } from '../../src/core/asm/assembler';
import { signExtend, zeroExtend, hex, hexShort, bin, decBoth, u32, s32 } from '../../src/core/util';
import { wordOf } from './helpers';

function sampleFields(d: InstrDef): Fields {
  switch (d.shape) {
    case 'rrr': return { rd: 3, rs1: 7, rs2: 11 };
    case 'rri': return { rd: 3, rs1: 7, imm: d.group === 'shift' ? 5 : 0x1234 };
    case 'ri': return { rd: 3, imm: 0x1234 };
    case 'load': return { rd: 3, rs1: 7, imm: 0x0034 };
    case 'store': return { rs2: 3, rs1: 7, imm: 0x0034 };
    case 'branch': return { rs1: 7, imm: 0x1230 };
    case 'jump': return { imm: 0x0000ff0 };
    case 'jreg': return { rs1: 7 };
    case 'movi2s': return { rs1: 7 };
    case 'movs2i': return { rd: 3 };
    case 'trap': return { imm: 0x40 };
    case 'none': return {};
  }
}

describe('tabella ISA', () => {
  it('nessun mnemonico duplicato', () => {
    const names = INSTRUCTIONS.map((d) => d.mn);
    expect(new Set(names).size).toBe(names.length);
  });
  it('nessun opcode duplicato (formati I/J) e nessun func duplicato (formato R)', () => {
    const ops = INSTRUCTIONS.filter((d) => d.fmt !== 'R').map((d) => d.opcode);
    expect(new Set(ops).size).toBe(ops.length);
    const funcs = INSTRUCTIONS.filter((d) => d.fmt === 'R').map((d) => d.func);
    expect(new Set(funcs).size).toBe(funcs.length);
  });
  it('R ha opcode 0 e func; I/J hanno opcode != 0 su 6 bit', () => {
    for (const d of INSTRUCTIONS) {
      if (d.fmt === 'R') {
        expect(d.opcode, d.mn).toBe(0);
        expect(d.func, d.mn).toBeGreaterThanOrEqual(0);
        expect(d.func!, d.mn).toBeLessThan(0x800);
      } else {
        expect(d.opcode, d.mn).toBeGreaterThan(0);
        expect(d.opcode, d.mn).toBeLessThan(64);
      }
    }
  });
  it('mappe BY_* coerenti', () => {
    for (const d of INSTRUCTIONS) {
      expect(BY_MN.get(d.mn)).toBe(d);
      if (d.fmt === 'R') expect(BY_FUNC.get(d.func!)).toBe(d);
      else expect(BY_OPCODE.get(d.opcode)).toBe(d);
    }
  });
  it('valori di opcode/func classici H&P', () => {
    const op = (m: string) => BY_MN.get(m)!.opcode;
    const fn = (m: string) => BY_MN.get(m)!.func;
    expect([op('J'), op('JAL'), op('BEQZ'), op('BNEZ')]).toEqual([2, 3, 4, 5]);
    expect([op('ADDI'), op('ADDUI'), op('SUBI'), op('SUBUI')]).toEqual([8, 9, 10, 11]);
    expect([op('ANDI'), op('ORI'), op('XORI'), op('LHI')]).toEqual([12, 13, 14, 15]);
    expect([op('JR'), op('JALR')]).toEqual([0x12, 0x13]);
    expect([op('SLLI'), op('SRLI'), op('SRAI')]).toEqual([0x14, 0x16, 0x17]);
    expect([op('SEQI'), op('SNEI'), op('SLTI'), op('SGTI'), op('SLEI'), op('SGEI')]).toEqual([0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d]);
    expect([op('LB'), op('LH'), op('LW'), op('LBU'), op('LHU')]).toEqual([0x20, 0x21, 0x23, 0x24, 0x25]);
    expect([op('SB'), op('SH'), op('SW')]).toEqual([0x28, 0x29, 0x2b]);
    expect([fn('SLL'), fn('SRL'), fn('SRA')]).toEqual([4, 6, 7]);
    expect([fn('ADD'), fn('ADDU'), fn('SUB'), fn('SUBU')]).toEqual([0x20, 0x21, 0x22, 0x23]);
    expect([fn('AND'), fn('OR'), fn('XOR')]).toEqual([0x24, 0x25, 0x26]);
    expect([fn('SEQ'), fn('SNE'), fn('SLT'), fn('SGT'), fn('SLE'), fn('SGE')]).toEqual([0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d]);
  });
  it('ogni istruzione ha doc bilingue, rtl ed esempio', () => {
    for (const d of INSTRUCTIONS) {
      expect(d.doc.it.length, d.mn).toBeGreaterThan(3);
      expect(d.doc.en.length, d.mn).toBeGreaterThan(3);
      expect(d.rtl.length, d.mn).toBeGreaterThan(0);
      expect(d.example.toUpperCase().startsWith(d.mn), d.mn).toBe(true);
      expect(syntaxOf(d).startsWith(d.mn)).toBe(true);
    }
    expect(PSEUDO.HALT).toBeDefined();
  });
  it('ext dichiarata: signed per aritmetiche/set/load/store/branch, unsigned per ADDUI/SUBUI/logiche', () => {
    for (const m of ['ADDI', 'SUBI', 'SEQI', 'SNEI', 'SLTI', 'SGTI', 'SLEI', 'SGEI', 'LB', 'LW', 'SW', 'BEQZ', 'BNEZ']) expect(BY_MN.get(m)!.ext, m).toBe('signed');
    for (const m of ['ADDUI', 'SUBUI', 'ANDI', 'ORI', 'XORI']) expect(BY_MN.get(m)!.ext, m).toBe('unsigned');
  });
});

describe('encode/decode', () => {
  for (const d of INSTRUCTIONS) {
    it(`roundtrip ${d.mn}`, () => {
      const f = sampleFields(d);
      const w = encode(d, f);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(w)).toBe(true);
      const dec = decode(w)!;
      expect(dec).not.toBeNull();
      expect(dec.def).toBe(d);
      expect(dec.word).toBe(w);
      if (d.fmt === 'R') {
        expect(w >>> 26).toBe(0);
        expect(w & 0x7ff).toBe(d.func);
        expect(dec.rd).toBe(f.rd ?? 0);
        expect(dec.rs1).toBe(f.rs1 ?? 0);
        expect(dec.rs2).toBe(f.rs2 ?? 0);
      } else if (d.fmt === 'I') {
        expect(w >>> 26).toBe(d.opcode);
        expect(dec.imm16).toBe(f.imm ?? 0);
        expect(dec.rs1).toBe(f.rs1 ?? 0);
        // il campo [25..21] è RS2 per le store, Rd per le altre
        if (d.shape === 'store') expect(dec.rs2).toBe(f.rs2);
        else expect(dec.rd).toBe(f.rd ?? 0);
      } else {
        expect(w >>> 26).toBe(d.opcode);
        expect(dec.imm26).toBe(f.imm ?? 0);
      }
    });
  }

  it('posizione dei campi R: opcode[31..26] RS2[25..21] RS1[20..16] Rd[15..11] func[10..0]', () => {
    const w = encode(BY_MN.get('SUB')!, { rd: 1, rs1: 2, rs2: 3 });
    expect(w).toBe(((3 << 21) | (2 << 16) | (1 << 11) | 0x22) >>> 0);
    expect(encode(BY_MN.get('ADD')!, { rd: 1, rs1: 2, rs2: 3 })).toBe(0x00620820);
  });
  it('posizione dei campi I: opcode[31..26] Rd[25..21] RS1[20..16] imm16', () => {
    expect(encode(BY_MN.get('ADDI')!, { rd: 1, rs1: 2, imm: 4 })).toBe(0x20220004);
    expect(encode(BY_MN.get('LW')!, { rd: 1, rs1: 2, imm: 8 })).toBe(0x8c220008 >>> 0);
    expect(encode(BY_MN.get('SW')!, { rs2: 1, rs1: 2, imm: 8 })).toBe(0xac220008 >>> 0);
    expect(encode(BY_MN.get('BEQZ')!, { rs1: 4, imm: 0xfff8 })).toBe(0x1004fff8);
  });
  it('formato J: opcode + offset 26 bit, troncato', () => {
    expect(encode(BY_MN.get('J')!, { imm: 0x3ffffff })).toBe(0x0bffffff);
    expect(encode(BY_MN.get('J')!, { imm: 0x4000000 })).toBe(0x08000000);
    expect(encode(BY_MN.get('JAL')!, { imm: 4 })).toBe(0x0c000004);
    expect(encode(BY_MN.get('TRAP')!, { imm: 0 })).toBe(0x44000000);
    expect(encode(BY_MN.get('RFE')!, {})).toBe(0x40000000);
    expect(encode(BY_MN.get('NOP')!, {})).toBe(0x54000000);
  });
  it('opcode >= 32 non rompe il segno (risultato sempre uint32)', () => {
    const w = encode(BY_MN.get('SW')!, { rs2: 31, rs1: 31, imm: 0xffff });
    expect(w).toBe(0xafffffff >>> 0);
    expect(w).toBeGreaterThan(0);
  });
  it('i campi vengono mascherati (registri a 5 bit, imm a 16)', () => {
    const w = encode(BY_MN.get('ADDI')!, { rd: 33, rs1: 65, imm: 0x12345 });
    const d = decode(w)!;
    expect([d.rd, d.rs1, d.imm16]).toEqual([1, 1, 0x2345]);
  });
  it('decode di parole non valide', () => {
    expect(decode(0)).toBeNull();
    expect(decode(0xffffffff)).toBeNull();
    expect(decode(0x00000001)).toBeNull(); // opcode 0, func 1 sconosciuta
    expect(decode(0x7c000000)).toBeNull(); // opcode 0x1f sconosciuto
    expect(decode(-1)).toBeNull(); // negativi trattati come uint32
  });
  it('decode accetta numeri negativi JS come uint32', () => {
    const w = encode(BY_MN.get('LW')!, { rd: 1, rs1: 2, imm: 8 }); // >= 0x80000000
    expect(decode(w | 0)!.def.mn).toBe('LW');
  });
});

describe('disassemble', () => {
  it('roundtrip: disassembla e riassembla ogni istruzione ottenendo la stessa word', () => {
    for (const d of INSTRUCTIONS) {
      const w = encode(d, sampleFields(d));
      const text = disassemble(w);
      expect(text, d.mn).not.toBe('???');
      const p = assemble(text);
      const errs = p.diagnostics.filter((e) => e.severity === 'error');
      expect(errs, `${d.mn}: ${text}`).toEqual([]);
      expect(wordOf(p, 0), `${d.mn}: ${text}`).toBe(w);
    }
  });
  it('parola non valida → ???', () => {
    expect(disassemble(0)).toBe('???');
  });
  it('immediati: signed in decimale, unsigned/LHI in esadecimale', () => {
    expect(disassemble(encode(BY_MN.get('ADDI')!, { rd: 1, rs1: 2, imm: 0xffff }))).toBe('ADDI R1,R2,-1');
    expect(disassemble(encode(BY_MN.get('ANDI')!, { rd: 1, rs1: 2, imm: 0xffff }))).toBe('ANDI R1,R2,0xFFFF');
    expect(disassemble(encode(BY_MN.get('LHI')!, { rd: 1, imm: 0x8000 }))).toBe('LHI R1,0x8000');
    expect(disassemble(encode(BY_MN.get('SW')!, { rs2: 5, rs1: 6, imm: 0xfffc }))).toBe('SW R5,-4(R6)');
    expect(disassemble(encode(BY_MN.get('LW')!, { rd: 5, rs1: 6, imm: 0x10 }))).toBe('LW R5,16(R6)');
  });
  it('salti con pc: indirizzo assoluto o etichetta', () => {
    const w = encode(BY_MN.get('BNEZ')!, { rs1: 7, imm: 0xfff8 }); // -8
    expect(disassemble(w, 0x20)).toBe('BNEZ R7,0x1C');
    expect(disassemble(w, 0x20, (a) => (a === 0x1c ? 'Loop' : undefined))).toBe('BNEZ R7,Loop');
    const j = encode(BY_MN.get('J')!, { imm: 0x3fffffc }); // -4
    expect(disassemble(j, 0x10)).toBe('J 0x10');
    expect(disassemble(j)).toBe('J -4');
  });
  it('TRAP 0 mostra HALT', () => {
    expect(disassemble(0x44000000)).toContain('HALT');
    expect(disassemble(0x44000040)).toBe('TRAP 0x40');
  });
});

describe('ogni esempio della tabella assembla', () => {
  it('senza errori', () => {
    for (const d of INSTRUCTIONS) {
      const src = `fine: main: LOOP: funzione:\n${d.example}\n`;
      const p = assemble(src);
      const errs = p.diagnostics.filter((e) => e.severity === 'error');
      expect(errs, d.example).toEqual([]);
      expect(decode(wordOf(p, 0))!.def.mn, d.example).toBe(d.mn);
    }
  });
});

describe('util', () => {
  it('signExtend / zeroExtend', () => {
    expect(signExtend(0x7fff, 16)).toBe(0x7fff);
    expect(signExtend(0x8000, 16)).toBe(0xffff8000);
    expect(signExtend(0xffff, 16)).toBe(0xffffffff);
    expect(signExtend(0x80, 8)).toBe(0xffffff80);
    expect(signExtend(0x2000000, 26)).toBe(0xfe000000);
    expect(signExtend(0x1ffffff, 26)).toBe(0x1ffffff);
    expect(signExtend(0x12345678, 32)).toBe(0x12345678);
    expect(zeroExtend(0xffffffff, 16)).toBe(0xffff);
    expect(zeroExtend(0x1234ff, 8)).toBe(0xff);
    expect(zeroExtend(0xffffffff, 32)).toBe(0xffffffff);
  });
  it('formattatori', () => {
    expect(hex(255)).toBe('0x000000FF');
    expect(hex(-1)).toBe('0xFFFFFFFF');
    expect(hex(5, 2)).toBe('0x05');
    expect(hexShort(0x1f)).toBe('0x1F');
    expect(bin(5, 4)).toBe('0101');
    expect(decBoth(5)).toBe('5');
    expect(decBoth(0xffffffff)).toBe('-1 (unsigned 4294967295)');
    expect(u32(-1)).toBe(0xffffffff);
    expect(s32(0x80000000)).toBe(-0x80000000);
  });
});
