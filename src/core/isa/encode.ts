import { BY_FUNC, BY_OPCODE, InstrDef } from './table';
import { hexShort, signExtend } from '../util';

/** Istruzione decodificata (campi grezzi + definizione). */
export interface Decoded {
  def: InstrDef;
  word: number;
  rs1: number;
  rs2: number; // per formato I è il campo RS2/Rd
  rd: number; // destinazione effettiva
  imm16: number; // campo grezzo 16 bit
  imm26: number; // campo grezzo 26 bit
}

/** Campi "logici" prodotti dall'assembler. */
export interface Fields {
  rd?: number;
  rs1?: number;
  rs2?: number;
  imm?: number; // già ridotto a 16 o 26 bit
}

export function encode(def: InstrDef, f: Fields): number {
  const op = (def.opcode & 0x3f) << 26;
  if (def.fmt === 'J') return (op | ((f.imm ?? 0) & 0x3ffffff)) >>> 0;
  if (def.fmt === 'R') {
    return (
      (op |
        ((f.rs2 ?? 0) & 31) << 21 |
        ((f.rs1 ?? 0) & 31) << 16 |
        ((f.rd ?? 0) & 31) << 11 |
        ((def.func ?? 0) & 0x7ff)) >>>
      0
    );
  }
  // formato I: il campo [25..21] è RS2 per le store, Rd per load/ALU
  const mid = def.shape === 'store' ? (f.rs2 ?? 0) : (f.rd ?? 0);
  return (op | (mid & 31) << 21 | ((f.rs1 ?? 0) & 31) << 16 | ((f.imm ?? 0) & 0xffff)) >>> 0;
}

export function decode(word: number): Decoded | null {
  word >>>= 0;
  const opcode = word >>> 26;
  const def = opcode === 0 ? BY_FUNC.get(word & 0x7ff) : BY_OPCODE.get(opcode);
  if (!def) return null;
  const f25 = (word >>> 21) & 31;
  const f20 = (word >>> 16) & 31;
  const f15 = (word >>> 11) & 31;
  const rd = def.fmt === 'R' ? f15 : f25;
  return {
    def,
    word,
    rs1: f20,
    rs2: f25,
    rd,
    imm16: word & 0xffff,
    imm26: word & 0x3ffffff,
  };
}

/** Disassembla una word (gli offset dei salti vengono risolti in indirizzi assoluti se si passa pc). */
export function disassemble(word: number, pc?: number, labelOf?: (addr: number) => string | undefined): string {
  const d = decode(word);
  if (!d) return '???';
  const { def } = d;
  const r = (n: number) => `R${n}`;
  const simm = (signExtend(d.imm16, 16) | 0);
  const immStr = def.ext === 'unsigned' || def.shape === 'ri' ? hexShort(d.imm16) : `${simm}`;
  const target = (off: number) => {
    if (pc === undefined) return `${off}`;
    const t = (pc + 4 + off) >>> 0;
    return labelOf?.(t) ?? hexShort(t);
  };
  switch (def.shape) {
    case 'rrr': return `${def.mn} ${r(d.rd)},${r(d.rs1)},${r(d.rs2)}`;
    case 'rri': return `${def.mn} ${r(d.rd)},${r(d.rs1)},${def.group === 'shift' ? d.imm16 & 31 : immStr}`;
    case 'ri': return `${def.mn} ${r(d.rd)},${hexShort(d.imm16)}`;
    case 'load': return `${def.mn} ${r(d.rd)},${simm}(${r(d.rs1)})`;
    case 'store': return `${def.mn} ${r(d.rs2)},${simm}(${r(d.rs1)})`;
    case 'branch': return `${def.mn} ${r(d.rs1)},${target(simm)}`;
    case 'jump': return `${def.mn} ${target(signExtend(d.imm26, 26) | 0)}`;
    case 'jreg': return `${def.mn} ${r(d.rs1)}`;
    case 'movi2s': return `${def.mn} IAR,${r(d.rs1)}`;
    case 'movs2i': return `${def.mn} ${r(d.rd)},IAR`;
    case 'trap': return d.imm26 === 0 ? 'TRAP 0 (HALT)' : `TRAP ${hexShort(d.imm26)}`;
    case 'none': return def.mn;
  }
}
