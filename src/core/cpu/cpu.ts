import { Bus, MemAccess } from '../bus/bus';
import { StartupDevice } from '../bus/devices';
import { decode, Decoded, disassemble } from '../isa/encode';
import { Group } from '../isa/table';
import { hex, signExtend, SimError, Txt, txt, zeroExtend, decBoth } from '../util';

export type SpecialReg = 'PC' | 'IAR' | 'IR' | 'MAR' | 'MDR' | 'A' | 'B' | 'C' | 'TEMP';

export interface MicroStep {
  phase: 'FETCH' | 'DECODE' | 'EXECUTE' | 'MEMORY' | 'WRITE-BACK' | 'INTERRUPT';
  rtl: string;
  /** componenti del datapath coinvolti (id usati dalla vista datapath) */
  active: string[];
  /** cicli di clock (inclusi stati di wait) */
  clocks: number;
}

export interface RegWrite {
  reg: number; // 0..31
  old: number;
  value: number;
}

export interface StepResult {
  pc: number;
  word: number;
  decoded: Decoded;
  text: string;
  regWrites: RegWrite[];
  mem: MemAccess[];
  nextPC: number;
  taken?: boolean;
  explanation: Txt[];
  micro: MicroStep[];
  clocks: number;
  overflow?: boolean;
  halted?: boolean;
  interrupt?: { from: number; sources: string[] };
}

export interface CpuOptions {
  /** ADD/ADDI/SUB/SUBI: errore in caso di overflow invece del wrap */
  trapOnOverflow: boolean;
}

/** Cicli di clock per tipo di istruzione: tabella delle slide 07 (cicli + wait). */
export const CLOCKS: Record<string, number> = {
  load: 8,
  store: 7,
  alu: 6,
  set: 7,
  jump: 4,
  jal: 6,
  branchTaken: 5,
  branchNotTaken: 4,
};

export interface CpuSnapshot {
  regs: Uint32Array;
  pc: number;
  iar: number;
  ir: number;
  mar: number;
  mdr: number;
  a: number;
  b: number;
  c: number;
  temp: number;
  ien: boolean;
  halted: boolean;
  instret: number;
  cycles: number;
  wasStartup: boolean;
  /** registri scritti dall'accensione (opzionale: assente nelle istantanee vecchie) */
  regInit?: Uint8Array;
}

export class CPU {
  regs = new Uint32Array(32);
  pc = 0;
  iar = 0;
  ir = 0;
  mar = 0;
  mdr = 0;
  a = 0;
  b = 0;
  c = 0;
  temp = 0;
  /** Interrupt ENable flag (non accessibile al programmatore) */
  ien = true;
  halted = false;
  instret = 0;
  cycles = 0;
  /** registri mai scritti dall'accensione (valori casuali) */
  regInit = new Uint8Array(32);
  private wasStartup = false;

  constructor(public bus: Bus, public opts: CpuOptions = { trapOnOverflow: false }) {
    this.reset();
  }

  reset() {
    for (let i = 1; i < 32; i++) this.regs[i] = (Math.random() * 0x100000000) >>> 0;
    this.regs[0] = 0;
    this.regInit.fill(0);
    this.regInit[0] = 1;
    this.pc = 0;
    this.iar = 0;
    this.ir = this.mar = this.mdr = this.a = this.b = this.c = this.temp = 0;
    this.halted = false;
    this.instret = 0;
    this.cycles = 0;
    this.bus.resetDevices();
    // Se esiste la rete di STARTUP le interruzioni sono abilitate solo quando il software porta STARTUP a 0
    const st = this.startupDev();
    this.wasStartup = !!st;
    this.ien = !st;
  }

  private startupDev(): StartupDevice | undefined {
    return this.bus.devices.find((d): d is StartupDevice => d instanceof StartupDevice);
  }

  snapshot(): CpuSnapshot {
    return {
      regs: this.regs.slice(), pc: this.pc, iar: this.iar, ir: this.ir, mar: this.mar, mdr: this.mdr,
      a: this.a, b: this.b, c: this.c, temp: this.temp, ien: this.ien, halted: this.halted,
      instret: this.instret, cycles: this.cycles, wasStartup: this.wasStartup,
      regInit: this.regInit.slice(),
    };
  }

  restore(s: CpuSnapshot) {
    this.regs.set(s.regs);
    Object.assign(this, { pc: s.pc, iar: s.iar, ir: s.ir, mar: s.mar, mdr: s.mdr, a: s.a, b: s.b, c: s.c, temp: s.temp, ien: s.ien, halted: s.halted, instret: s.instret, cycles: s.cycles });
    this.wasStartup = s.wasStartup;
    if (s.regInit) this.regInit.set(s.regInit);
  }

  /** esegue una istruzione completa (fetch → write-back) e poi controlla INT */
  step(): StepResult {
    if (this.halted) throw new SimError(txt('Il processore è fermo (HALT). Premi Reset per ricominciare.', 'The CPU is halted. Press Reset to start again.'));
    const bus = this.bus;
    bus.log = [];
    const pc = this.pc >>> 0;
    if (pc % 4 !== 0) throw new SimError(txt(`PC = ${hex(pc)} non è multiplo di 4: le istruzioni sono allineate a 32 bit.`, `PC = ${hex(pc)} is not a multiple of 4.`), pc);

    // ---------------- FETCH ----------------
    const word = bus.read(pc, 4, 'fetch');
    const fetchAcc = bus.log[bus.log.length - 1];
    const d = decode(word);
    if (!d) {
      const isErased = word === 0xffffffff;
      throw new SimError(
        isErased
          ? txt(`All'indirizzo ${hex(pc)} non c'è un'istruzione (EPROM non programmata, 0xFFFFFFFF). Probabilmente il programma è "finito" senza un HALT o un salto: aggiungi HALT alla fine.`,
              `No instruction at ${hex(pc)} (unprogrammed EPROM, 0xFFFFFFFF). The program probably ran past its end: add HALT.`)
          : fetchAcc.garbage
            ? txt(`Il PC (${hex(pc)}) punta a RAM non inizializzata: lì c'è "spazzatura" (${hex(word)}), non codice. Controlla i salti.`, `PC (${hex(pc)}) points to uninitialized RAM: garbage (${hex(word)}), not code.`)
            : txt(`Istruzione non valida ${hex(word)} all'indirizzo ${hex(pc)}: opcode sconosciuto. Il PC è finito in una zona di dati?`, `Invalid instruction ${hex(word)} at ${hex(pc)}: unknown opcode. Did PC end up in data?`),
        pc,
      );
    }
    this.mar = pc;
    this.ir = word;
    const def = d.def;
    const text = disassemble(word, pc);
    const micro: MicroStep[] = [
      { phase: 'FETCH', rtl: 'MAR ← PC', active: ['PC', 'MAR', 'S1', 'ALU', 'dest'], clocks: 1 },
      { phase: 'FETCH', rtl: `IR ← M[MAR] = ${hex(word)}`, active: ['MAR', 'MEM', 'IR'], clocks: 2 },
    ];

    // ---------------- DECODE ----------------
    const pc4 = (pc + 4) >>> 0;
    this.a = this.regs[d.rs1];
    this.b = this.regs[d.rs2];
    micro.push({ phase: 'DECODE', rtl: `A ← R${d.rs1} = ${hex(this.a)} ; B ← R${d.rs2} = ${hex(this.b)} ; PC ← PC+4 = ${hex(pc4)}`, active: ['RF', 'A', 'B', 'PC', 'ALU'], clocks: 1 });

    let next = pc4;
    const regWrites: RegWrite[] = [];
    const ex: Txt[] = [];
    let taken: boolean | undefined;
    let overflow = false;
    let halted = false;
    let clockClass: keyof typeof CLOCKS = 'alu';

    const setReg = (r: number, v: number) => {
      v >>>= 0;
      if (r === 0) {
        ex.push(txt('Il risultato andrebbe in R0, ma R0 vale sempre 0: viene scartato.', 'The result would go to R0, but R0 is always 0: discarded.'));
        return;
      }
      regWrites.push({ reg: r, old: this.regs[r], value: v });
    };
    const R = (n: number) => `R${n}`;
    const imm16s = signExtend(d.imm16, 16);
    const imm16u = zeroExtend(d.imm16, 16);
    const immVal = def.ext === 'unsigned' ? imm16u : imm16s;
    const extDesc = def.ext === 'unsigned'
      ? txt(`immediato ${hex(d.imm16, 4)} esteso senza segno → ${hex(imm16u)}`, `immediate ${hex(d.imm16, 4)} zero-extended → ${hex(imm16u)}`)
      : txt(`immediato ${hex(d.imm16, 4)} esteso con segno → ${hex(imm16s)} (${imm16s | 0})`, `immediate ${hex(d.imm16, 4)} sign-extended → ${hex(imm16s)} (${imm16s | 0})`);

    const group: Group = def.group;
    switch (group) {
      case 'alu':
      case 'shift':
      case 'set': {
        const isImm = def.fmt === 'I';
        const x = this.regs[d.rs1];
        const y = isImm ? (group === 'shift' ? d.imm16 & 31 : immVal) : this.regs[d.rs2];
        this.temp = y;
        const yName = isImm ? (group === 'shift' ? `${d.imm16 & 31}` : hex(y)) : `${R(d.rs2)}`;
        const base = def.mn.replace(/I$/, '').replace(/UI$/, 'U');
        let res = 0;
        let opSym = '';
        const sx = x | 0, sy = y | 0;
        switch (base.replace(/U$/, '')) {
          case 'ADD': res = (x + y) >>> 0; opSym = '+';
            if (def.mn === 'ADD' || def.mn === 'ADDI') overflow = ((sx ^ (res | 0)) & (sy ^ (res | 0))) < 0;
            break;
          case 'SUB': res = (x - y) >>> 0; opSym = '-';
            if (def.mn === 'SUB' || def.mn === 'SUBI') overflow = ((sx ^ sy) & (sx ^ (res | 0))) < 0;
            break;
          case 'AND': res = (x & y) >>> 0; opSym = 'and'; break;
          case 'OR': res = (x | y) >>> 0; opSym = 'or'; break;
          case 'XOR': res = (x ^ y) >>> 0; opSym = 'xor'; break;
          case 'SLL': res = (x << (y & 31)) >>> 0; opSym = '<<'; break;
          case 'SRL': res = x >>> (y & 31); opSym = '>>'; break;
          case 'SRA': res = (sx >> (y & 31)) >>> 0; opSym = '>>(arit.)'; break;
          case 'SEQ': res = x === y ? 1 : 0; opSym = '='; break;
          case 'SNE': res = x !== y ? 1 : 0; opSym = '≠'; break;
          case 'SLT': res = (def.mn.endsWith('U') ? x < y : sx < sy) ? 1 : 0; opSym = '<'; break;
          case 'SGT': res = (def.mn.endsWith('U') ? x > y : sx > sy) ? 1 : 0; opSym = '>'; break;
          case 'SLE': res = (def.mn.endsWith('U') ? x <= y : sx <= sy) ? 1 : 0; opSym = '≤'; break;
          case 'SGE': res = (def.mn.endsWith('U') ? x >= y : sx >= sy) ? 1 : 0; opSym = '≥'; break;
        }
        if (isImm && group !== 'shift') ex.push(extDesc);
        const unsignedCmp = def.mn.endsWith('U') || def.mn.endsWith('UI');
        const fmtv = (v: number) => (group === 'alu' && (opSym === '+' || opSym === '-') ? `${hex(v)} (${decBoth(v)})` : group === 'set' ? (unsignedCmp ? `${v >>> 0}` : `${v | 0}`) : hex(v));
        if (group === 'set') {
          ex.push(txt(
            `Confronto ${unsignedCmp ? 'senza segno' : 'con segno'}: ${R(d.rs1)} (${fmtv(x)}) ${opSym} ${yName === hex(y) ? fmtv(y) : `${yName} (${fmtv(y)})`} ? → ${res ? 'VERO' : 'FALSO'}, quindi ${R(d.rd)} ← ${res}.`,
            `${unsignedCmp ? 'Unsigned' : 'Signed'} compare: ${R(d.rs1)} (${fmtv(x)}) ${opSym} ${yName === hex(y) ? fmtv(y) : `${yName} (${fmtv(y)})`} ? → ${res ? 'TRUE' : 'FALSE'}, so ${R(d.rd)} ← ${res}.`,
          ));
          clockClass = 'set';
        } else {
          ex.push(txt(
            `${R(d.rd)} ← ${R(d.rs1)} ${opSym} ${yName} = ${fmtv(x)} ${opSym} ${group === 'shift' ? y : fmtv(y)} = ${fmtv(res)}`,
            `${R(d.rd)} ← ${R(d.rs1)} ${opSym} ${yName} = ${fmtv(x)} ${opSym} ${group === 'shift' ? y : fmtv(y)} = ${fmtv(res)}`,
          ));
        }
        if (overflow) {
          if (this.opts.trapOnOverflow) throw new SimError(txt(`Overflow in ${def.mn}: il risultato non è rappresentabile su 32 bit con segno.`, `Overflow in ${def.mn}: result not representable as signed 32-bit.`), pc);
          ex.push(txt('⚠ OVERFLOW: il risultato vero non sta in 32 bit con segno; il registro contiene il valore "troncato". Se i numeri erano senza segno usa ADDU/SUBU.', '⚠ OVERFLOW: the true result does not fit in signed 32 bits; the register holds the wrapped value. Use ADDU/SUBU for unsigned numbers.'));
        }
        this.c = res;
        setReg(d.rd, res);
        micro.push({ phase: 'EXECUTE', rtl: isImm ? `TEMP ← (IR15)16##IR15..0 ; C ← A ${opSym} TEMP = ${hex(res)}` : `TEMP ← B ; C ← A ${opSym} TEMP = ${hex(res)}`, active: isImm ? ['IR', 'TEMP', 'A', 'ALU', 'C'] : ['B', 'TEMP', 'A', 'ALU', 'C'], clocks: group === 'set' ? 2 : 1 });
        micro.push({ phase: 'WRITE-BACK', rtl: `R${d.rd} ← C`, active: ['C', 'RF'], clocks: 1 });
        break;
      }
      case 'lhi': {
        const res = (d.imm16 << 16) >>> 0;
        ex.push(txt(`${R(d.rd)} ← ${hex(d.imm16, 4)} ## 0000 = ${hex(res)} (LHI non legge la memoria: costruisce solo la costante)`, `${R(d.rd)} ← ${hex(d.imm16, 4)} ## 0000 = ${hex(res)} (LHI does not read memory)`));
        this.c = res;
        setReg(d.rd, res);
        micro.push({ phase: 'EXECUTE', rtl: `C ← IR15..0 ## (0)16 = ${hex(res)}`, active: ['IR', 'ALU', 'C'], clocks: 1 });
        micro.push({ phase: 'WRITE-BACK', rtl: `R${d.rd} ← C`, active: ['C', 'RF'], clocks: 1 });
        break;
      }
      case 'load': {
        const addr = (this.regs[d.rs1] + imm16s) >>> 0;
        this.mar = addr;
        const size = def.mn.startsWith('LW') ? 4 : def.mn.startsWith('LH') ? 2 : 1;
        ex.push(txt(`Indirizzo = ${R(d.rs1)} + offset = ${hex(this.regs[d.rs1])} + ${imm16s | 0} = ${hex(addr)}`, `Address = ${R(d.rs1)} + offset = ${hex(this.regs[d.rs1])} + ${imm16s | 0} = ${hex(addr)}`));
        micro.push({ phase: 'EXECUTE', rtl: `MAR ← A + (IR15)16##IR15..0 = ${hex(addr)}`, active: ['A', 'IR', 'ALU', 'MAR'], clocks: 1 });
        const raw = bus.read(addr, size as 1 | 2 | 4);
        const acc = bus.log[bus.log.length - 1];
        this.mdr = raw;
        const signed = !def.mn.endsWith('U');
        const v = size === 4 ? raw : signed ? signExtend(raw, size * 8) : raw;
        const where = acc.cs ? `${acc.device} / ${acc.cs}` : acc.device;
        ex.push(txt(
          `Letto ${size === 4 ? 'una WORD' : size === 2 ? 'una HALF-WORD' : 'un BYTE'} da ${where}: ${hex(raw, size * 2)}${size < 4 ? ` → esteso ${signed ? 'con' : 'senza'} segno = ${hex(v)}` : ''}. ${R(d.rd)} ← ${hex(v)} (${decBoth(v)})`,
          `Read ${size === 4 ? 'a WORD' : size === 2 ? 'a HALF-WORD' : 'a BYTE'} from ${where}: ${hex(raw, size * 2)}${size < 4 ? ` → ${signed ? 'sign' : 'zero'}-extended = ${hex(v)}` : ''}. ${R(d.rd)} ← ${hex(v)} (${decBoth(v)})`,
        ));
        if (acc.garbage) ex.push(txt('⚠ Quella cella di RAM non era mai stata scritta: il valore è casuale ("spazzatura"), come in una RAM vera all\'accensione.', '⚠ That RAM cell was never written: the value is random garbage, as in a real RAM at power-on.'));
        micro.push({ phase: 'MEMORY', rtl: `MDR ← M[MAR] = ${hex(raw)}`, active: ['MAR', 'MEM', 'MDR'], clocks: 2 });
        micro.push({ phase: 'WRITE-BACK', rtl: size === 4 ? 'C ← MDR' : `C ← ${signed ? `(MDR${size * 8 - 1})${32 - size * 8}` : `(0)${32 - size * 8}`}##MDR${size * 8 - 1}..0`, active: ['MDR', 'ALU', 'C'], clocks: 1 });
        micro.push({ phase: 'WRITE-BACK', rtl: `R${d.rd} ← C`, active: ['C', 'RF'], clocks: 1 });
        this.c = v;
        setReg(d.rd, v);
        clockClass = 'load';
        break;
      }
      case 'store': {
        const addr = (this.regs[d.rs1] + imm16s) >>> 0;
        this.mar = addr;
        const size = def.mn === 'SW' ? 4 : def.mn === 'SH' ? 2 : 1;
        const val = this.regs[d.rs2];
        const mask = size === 4 ? 0xffffffff : size === 2 ? 0xffff : 0xff;
        this.mdr = val;
        ex.push(txt(`Indirizzo = ${R(d.rs1)} + offset = ${hex(this.regs[d.rs1])} + ${imm16s | 0} = ${hex(addr)}`, `Address = ${R(d.rs1)} + offset = ${hex(this.regs[d.rs1])} + ${imm16s | 0} = ${hex(addr)}`));
        micro.push({ phase: 'EXECUTE', rtl: `MAR ← A + (IR15)16##IR15..0 = ${hex(addr)} ; MDR ← B`, active: ['A', 'IR', 'ALU', 'MAR', 'B', 'MDR'], clocks: 2 });
        bus.write(addr, size as 1 | 2 | 4, val);
        const acc = bus.log[bus.log.length - 1];
        const where = acc.cs ? `${acc.device} / ${acc.cs}` : acc.device;
        const shown = (val & mask) >>> 0;
        ex.push(txt(
          `Scritto ${size === 4 ? 'la WORD' : size === 2 ? 'la HALF-WORD bassa' : 'il BYTE basso'} di ${R(d.rs2)} = ${hex(shown, size * 2)} in ${where}${size === 4 ? ` (big-endian: ${hex(addr)} ← ${hex(shown >>> 24, 2)}, …, ${hex(addr + 3)} ← ${hex(shown & 0xff, 2)})` : ''}.`,
          `Wrote the ${size === 4 ? 'WORD' : size === 2 ? 'low HALF-WORD' : 'low BYTE'} of ${R(d.rs2)} = ${hex(shown, size * 2)} to ${where}.`,
        ));
        micro.push({ phase: 'MEMORY', rtl: `M[MAR] ← MDR (${size} byte)`, active: ['MAR', 'MDR', 'MEM'], clocks: 2 });
        clockClass = 'store';
        break;
      }
      case 'branch': {
        const v = this.regs[d.rs1];
        const target = (pc4 + imm16s) >>> 0;
        this.temp = target;
        const cond = def.mn === 'BEQZ' ? v === 0 : v !== 0;
        taken = cond;
        ex.push(txt(
          `${R(d.rs1)} = ${hex(v)} → ${def.mn === 'BEQZ' ? (cond ? 'è zero' : 'non è zero') : cond ? 'è diverso da zero' : 'è zero'}: ${cond ? `salto PRESO a PC+4 ${(imm16s | 0) >= 0 ? '+' : ''}${imm16s | 0} = ${hex(target)}` : `salto NON preso, si prosegue a ${hex(pc4)}`}.`,
          `${R(d.rs1)} = ${hex(v)} → ${cond ? `branch TAKEN to PC+4 ${(imm16s | 0) >= 0 ? '+' : ''}${imm16s | 0} = ${hex(target)}` : `branch NOT taken, continue at ${hex(pc4)}`}.`,
        ));
        micro.push({ phase: 'EXECUTE', rtl: `TEMP ← PC + (IR15)16##IR15..0 = ${hex(target)}`, active: ['PC', 'IR', 'ALU', 'TEMP'], clocks: 1 });
        if (cond) {
          next = target;
          micro.push({ phase: 'MEMORY', rtl: `A ${def.mn === 'BEQZ' ? '=' : '≠'} 0 → PC ← TEMP`, active: ['A', 'ALU', 'TEMP', 'PC'], clocks: 1 });
        } else micro.push({ phase: 'MEMORY', rtl: 'condizione falsa → PC invariato', active: ['A', 'ALU'], clocks: 0 });
        clockClass = cond ? 'branchTaken' : 'branchNotTaken';
        break;
      }
      case 'jump': {
        const link = def.mn === 'JAL' || def.mn === 'JALR';
        let target: number;
        if (def.fmt === 'J') {
          const off = signExtend(d.imm26, 26);
          target = (pc4 + off) >>> 0;
          ex.push(txt(`Salto incondizionato a PC+4 ${(off | 0) >= 0 ? '+' : ''}${off | 0} = ${hex(target)}`, `Unconditional jump to PC+4 ${(off | 0) >= 0 ? '+' : ''}${off | 0} = ${hex(target)}`));
          micro.push({ phase: 'EXECUTE', rtl: `TEMP ← PC + (IR25)6##IR25..0 = ${hex(target)}`, active: ['PC', 'IR', 'ALU', 'TEMP'], clocks: 1 });
        } else {
          target = this.regs[d.rs1];
          ex.push(txt(`Salto all'indirizzo contenuto in ${R(d.rs1)} = ${hex(target)}`, `Jump to the address in ${R(d.rs1)} = ${hex(target)}`));
          micro.push({ phase: 'EXECUTE', rtl: `TEMP ← A = ${hex(target)}`, active: ['A', 'ALU', 'TEMP'], clocks: 1 });
        }
        if (link) {
          ex.push(txt(`Indirizzo di ritorno: R31 ← PC+4 = ${hex(pc4)} (per tornare: JR R31)`, `Return address: R31 ← PC+4 = ${hex(pc4)} (return with JR R31)`));
          micro.push({ phase: 'MEMORY', rtl: 'C ← PC', active: ['PC', 'ALU', 'C'], clocks: 1 });
          setReg(31, pc4);
          micro.push({ phase: 'WRITE-BACK', rtl: 'PC ← TEMP ; R31 ← C', active: ['TEMP', 'PC', 'C', 'RF'], clocks: 1 });
        } else micro.push({ phase: 'WRITE-BACK', rtl: 'PC ← TEMP', active: ['TEMP', 'PC'], clocks: 1 });
        if (def.mn === 'JR' && d.rs1 === 31) ex.push(txt('È il classico ritorno da procedura.', 'This is the classic return from procedure.'));
        next = target;
        clockClass = link ? 'jal' : 'jump';
        break;
      }
      case 'special': {
        switch (def.mn) {
          case 'RFE':
            next = this.iar;
            this.ien = true;
            ex.push(txt(`Ritorno dall'interrupt: PC ← IAR = ${hex(this.iar)} e interruzioni riabilitate (IEN ← 1).`, `Return from interrupt: PC ← IAR = ${hex(this.iar)}, interrupts re-enabled.`));
            micro.push({ phase: 'EXECUTE', rtl: 'PC ← IAR ; IEN ← 1', active: ['IAR', 'PC'], clocks: 1 });
            clockClass = 'jump';
            break;
          case 'MOVI2S':
            ex.push(txt(`IAR ← ${R(d.rs1)} = ${hex(this.regs[d.rs1])}`));
            this.iar = this.regs[d.rs1];
            micro.push({ phase: 'EXECUTE', rtl: 'IAR ← A', active: ['A', 'ALU', 'IAR'], clocks: 1 });
            break;
          case 'MOVS2I':
            ex.push(txt(`${R(d.rd)} ← IAR = ${hex(this.iar)}`));
            setReg(d.rd, this.iar);
            micro.push({ phase: 'EXECUTE', rtl: `C ← IAR ; R${d.rd} ← C`, active: ['IAR', 'ALU', 'C', 'RF'], clocks: 2 });
            break;
          case 'TRAP':
            if (d.imm26 === 0) {
              halted = true;
              next = pc;
              ex.push(txt('HALT (TRAP 0): fine del programma. Il simulatore si ferma.', 'HALT (TRAP 0): end of program. The simulator stops.'));
            } else {
              this.iar = pc4;
              this.ien = false;
              next = d.imm26 >>> 0;
              ex.push(txt(`TRAP: IAR ← ${hex(pc4)}, salto a ${hex(next)} con interruzioni disabilitate.`, `TRAP: IAR ← ${hex(pc4)}, jump to ${hex(next)} with interrupts disabled.`));
            }
            clockClass = 'jump';
            break;
        }
        break;
      }
      case 'misc':
        ex.push(txt('NOP: nessuna operazione.', 'NOP: no operation.'));
        break;
    }

    // commit registri
    for (const w of regWrites) {
      this.regs[w.reg] = w.value;
      this.regInit[w.reg] = 1;
    }
    this.regs[0] = 0;
    this.pc = next >>> 0;
    this.halted = halted;
    this.instret++;
    const clocks = CLOCKS[clockClass];
    this.cycles += clocks;

    // STARTUP: quando il software porta STARTUP a 0 le interruzioni vengono abilitate
    const st = this.startupDev();
    if (st && this.wasStartup && !st.value) {
      this.wasStartup = false;
      this.ien = true;
      ex.push(txt('STARTUP è passato a 0: fine inizializzazione, da ora le interruzioni sono abilitate.', 'STARTUP went to 0: initialization done, interrupts are now enabled.'));
    }

    const result: StepResult = {
      pc, word, decoded: d, text, regWrites, mem: [...bus.log], nextPC: this.pc, taken, explanation: ex, micro, clocks, overflow, halted,
    };

    // ---------------- controllo INT (fine istruzione) ----------------
    if (!halted && this.ien && bus.intLine()) {
      const sources = bus.intSources().map((s) => s.cfg.name);
      this.iar = this.pc;
      result.interrupt = { from: this.pc, sources };
      this.pc = 0;
      this.ien = false;
      result.nextPC = 0;
      result.micro.push({ phase: 'INTERRUPT', rtl: `INT=1 e IEN=1 → IAR ← PC (${hex(this.iar)}) ; PC ← 0 ; IEN ← 0`, active: ['PC', 'IAR'], clocks: 1 });
      result.explanation.push(txt(
        `⚡ INTERRUPT da ${sources.join(', ')}: l'istruzione corrente è stata completata, poi IAR ← ${hex(this.iar)} (indirizzo di ritorno), PC ← 0x00000000 (interrupt handler) e interruzioni disabilitate fino a RFE.`,
        `⚡ INTERRUPT from ${sources.join(', ')}: the current instruction completed, then IAR ← ${hex(this.iar)}, PC ← 0x00000000 (handler), interrupts disabled until RFE.`,
      ));
    }
    return result;
  }
}

export type { Decoded };
