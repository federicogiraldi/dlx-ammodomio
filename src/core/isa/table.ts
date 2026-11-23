import { Txt, txt } from '../util';

/**
 * Tabella UNICA delle istruzioni DLX (integer).
 * Assembler, encoder/decoder, documentazione, autocomplete ed evidenziazione
 * sintattica derivano tutti da qui.
 *
 * Disposizione dei campi come nelle slide del corso (07 DLX sequenziale):
 *   I: opcode[31..26] RS2/Rd[25..21] RS1[20..16] imm16[15..0]
 *   R: opcode[31..26]=0 RS2[25..21] RS1[20..16] Rd[15..11] func[10..0]
 *   J: opcode[31..26] offset26[25..0]
 * Valori di opcode/func: quelli classici del DLX di Hennessy & Patterson.
 */

export type Format = 'R' | 'I' | 'J';

export type Shape =
  | 'rrr' // Rd, Rs1, Rs2
  | 'rri' // Rd, Rs1, imm
  | 'ri' // Rd, imm (LHI)
  | 'load' // Rd, off(Rs1)
  | 'store' // Rs2, off(Rs1)   (accettato anche off(Rs1), Rs2)
  | 'branch' // Rs1, label
  | 'jump' // label
  | 'jreg' // Rs1
  | 'movi2s' // IAR, Rs1
  | 'movs2i' // Rd, IAR
  | 'trap' // imm26
  | 'none';

export type Group =
  | 'alu'
  | 'shift'
  | 'set'
  | 'lhi'
  | 'load'
  | 'store'
  | 'branch'
  | 'jump'
  | 'special'
  | 'misc';

export interface InstrDef {
  mn: string;
  fmt: Format;
  opcode: number;
  func?: number;
  shape: Shape;
  group: Group;
  /** estensione dell'immediato a 16 bit */
  ext?: 'signed' | 'unsigned';
  /** l'istruzione compare nell'elenco delle slide del corso */
  course: boolean;
  /** RTL sintetico, notazione delle slide */
  rtl: string;
  doc: Txt;
  example: string;
}

const R = (
  mn: string,
  func: number,
  group: Group,
  rtl: string,
  doc: Txt,
  example: string,
  course = true,
): InstrDef => ({ mn, fmt: 'R', opcode: 0, func, shape: 'rrr', group, rtl, doc, example, course });

const I = (
  mn: string,
  opcode: number,
  shape: Shape,
  group: Group,
  ext: 'signed' | 'unsigned' | undefined,
  rtl: string,
  doc: Txt,
  example: string,
  course = true,
): InstrDef => ({ mn, fmt: 'I', opcode, shape, group, ext, rtl, doc, example, course });

export const INSTRUCTIONS: InstrDef[] = [
  // ---------- Aritmetiche ----------
  R('ADD', 0x20, 'alu', 'Rd ← Rs1 + Rs2',
    txt('Somma due registri (interi con segno). In caso di overflow il risultato "gira" (wrap) e il simulatore te lo segnala.',
      'Adds two registers (signed). On overflow the result wraps and the simulator warns you.'),
    'ADD R1,R2,R3'),
  R('ADDU', 0x21, 'alu', 'Rd ← Rs1 + Rs2',
    txt('Somma due registri considerandoli senza segno: nessun overflow.', 'Adds two registers as unsigned: never overflows.'),
    'ADDU R1,R2,R3'),
  R('SUB', 0x22, 'alu', 'Rd ← Rs1 - Rs2',
    txt('Sottrae Rs2 da Rs1 (con segno).', 'Subtracts Rs2 from Rs1 (signed).'), 'SUB R1,R2,R3'),
  R('SUBU', 0x23, 'alu', 'Rd ← Rs1 - Rs2',
    txt('Sottrae Rs2 da Rs1 senza segno.', 'Subtracts Rs2 from Rs1 (unsigned).'), 'SUBU R1,R2,R3'),
  I('ADDI', 0x08, 'rri', 'alu', 'signed', 'Rd ← Rs1 + (IR15)16##IR15..0',
    txt("Somma a Rs1 un immediato a 16 bit esteso CON segno (quindi 0xFFFF vale -1). Usata anche per caricare costanti: ADDI R1,R0,5.",
      'Adds a 16-bit immediate, sign-extended (0xFFFF means -1). Also used to load constants: ADDI R1,R0,5.'),
    'ADDI R1,R2,4'),
  I('ADDUI', 0x09, 'rri', 'alu', 'unsigned', 'Rd ← Rs1 + (0)16##IR15..0',
    txt("Somma a Rs1 un immediato a 16 bit esteso SENZA segno (0xFFFF vale 65535).",
      'Adds a 16-bit immediate, zero-extended (0xFFFF means 65535).'),
    'ADDUI R1,R2,0xFFFF'),
  I('SUBI', 0x0a, 'rri', 'alu', 'signed', 'Rd ← Rs1 - (IR15)16##IR15..0',
    txt('Sottrae a Rs1 un immediato esteso con segno.', 'Subtracts a sign-extended immediate from Rs1.'), 'SUBI R9,R9,1'),
  I('SUBUI', 0x0b, 'rri', 'alu', 'unsigned', 'Rd ← Rs1 - (0)16##IR15..0',
    txt('Sottrae a Rs1 un immediato esteso senza segno.', 'Subtracts a zero-extended immediate from Rs1.'), 'SUBUI R1,R1,4'),

  // ---------- Logiche ----------
  R('AND', 0x24, 'alu', 'Rd ← Rs1 and Rs2', txt('AND bit a bit.', 'Bitwise AND.'), 'AND R1,R2,R3'),
  R('OR', 0x25, 'alu', 'Rd ← Rs1 or Rs2', txt('OR bit a bit.', 'Bitwise OR.'), 'OR R1,R2,R3'),
  R('XOR', 0x26, 'alu', 'Rd ← Rs1 xor Rs2',
    txt('XOR bit a bit. Trucco classico: XOR R8,R8,R8 azzera R8.', 'Bitwise XOR. Classic trick: XOR R8,R8,R8 clears R8.'),
    'XOR R8,R8,R8'),
  I('ANDI', 0x0c, 'rri', 'alu', 'unsigned', 'Rd ← Rs1 and (0)16##IR15..0',
    txt("AND con immediato. Per le logiche l'immediato è SEMPRE esteso senza segno.", 'AND with immediate. Logic immediates are ALWAYS zero-extended.'),
    'ANDI R1,R2,0x00FF'),
  I('ORI', 0x0d, 'rri', 'alu', 'unsigned', 'Rd ← Rs1 or (0)16##IR15..0',
    txt('OR con immediato (esteso senza segno). Con LHI serve a costruire costanti a 32 bit.', 'OR with immediate (zero-extended). Together with LHI builds 32-bit constants.'),
    'ORI R1,R1,0x1234'),
  I('XORI', 0x0e, 'rri', 'alu', 'unsigned', 'Rd ← Rs1 xor (0)16##IR15..0',
    txt('XOR con immediato (esteso senza segno).', 'XOR with immediate (zero-extended).'), 'XORI R1,R1,1'),

  // ---------- Shift ----------
  R('SLL', 0x04, 'shift', 'Rd ← Rs1 << Rs2[4..0]',
    txt('Shift logico a sinistra di Rs2 posizioni (entrano zeri). Non esiste SLA: coincide con SLL.', 'Logical shift left (zeros enter). There is no SLA: it is the same as SLL.'),
    'SLL R1,R2,R3'),
  R('SRL', 0x06, 'shift', 'Rd ← Rs1 >> Rs2[4..0]',
    txt('Shift logico a destra (entrano zeri a sinistra).', 'Logical shift right (zeros enter on the left).'), 'SRL R1,R2,R3'),
  R('SRA', 0x07, 'shift', 'Rd ← (Rs1₃₁)ⁿ ## Rs1 >> n',
    txt('Shift aritmetico a destra: replica il bit di segno. Dividere per 2ⁿ mantenendo il segno.', 'Arithmetic shift right: replicates the sign bit (signed divide by 2ⁿ).'),
    'SRA R1,R2,R3'),
  I('SLLI', 0x14, 'rri', 'shift', undefined, 'Rd ← Rs1 << imm[4..0]',
    txt('Shift logico a sinistra di una quantità costante (0..31).', 'Logical shift left by a constant (0..31).'), 'SLLI R1,R2,2'),
  I('SRLI', 0x16, 'rri', 'shift', undefined, 'Rd ← Rs1 >> imm[4..0]',
    txt('Shift logico a destra di una quantità costante.', 'Logical shift right by a constant.'), 'SRLI R1,R2,4'),
  I('SRAI', 0x17, 'rri', 'shift', undefined, 'Rd ← Rs1 >>a imm[4..0]',
    txt('Shift aritmetico a destra di una quantità costante.', 'Arithmetic shift right by a constant.'), 'SRAI R1,R2,1'),

  // ---------- Set condition ----------
  R('SEQ', 0x28, 'set', 'Rd ← (Rs1 = Rs2) ? 1 : 0', txt('Rd = 1 se Rs1 = Rs2, altrimenti 0.', 'Rd = 1 if Rs1 = Rs2, else 0.'), 'SEQ R1,R2,R3'),
  R('SNE', 0x29, 'set', 'Rd ← (Rs1 ≠ Rs2) ? 1 : 0', txt('Rd = 1 se Rs1 ≠ Rs2.', 'Rd = 1 if Rs1 ≠ Rs2.'), 'SNE R1,R2,R3'),
  R('SLT', 0x2a, 'set', 'Rd ← (Rs1 < Rs2) ? 1 : 0', txt('Rd = 1 se Rs1 < Rs2 (con segno).', 'Rd = 1 if Rs1 < Rs2 (signed).'), 'SLT R1,R2,R3'),
  R('SGT', 0x2b, 'set', 'Rd ← (Rs1 > Rs2) ? 1 : 0', txt('Rd = 1 se Rs1 > Rs2 (con segno).', 'Rd = 1 if Rs1 > Rs2 (signed).'), 'SGT R1,R2,R3'),
  R('SLE', 0x2c, 'set', 'Rd ← (Rs1 ≤ Rs2) ? 1 : 0', txt('Rd = 1 se Rs1 ≤ Rs2 (con segno).', 'Rd = 1 if Rs1 ≤ Rs2 (signed).'), 'SLE R1,R2,R3'),
  R('SGE', 0x2d, 'set', 'Rd ← (Rs1 ≥ Rs2) ? 1 : 0', txt('Rd = 1 se Rs1 ≥ Rs2 (con segno).', 'Rd = 1 if Rs1 ≥ Rs2 (signed).'), 'SGE R1,R2,R3'),
  R('SLTU', 0x3a, 'set', 'Rd ← (Rs1 < Rs2) ? 1 : 0',
    txt('Come SLT ma confronta senza segno. (Estensione: non è nell\'elenco delle slide.)', 'Like SLT, unsigned compare. (Extension: not in the course list.)'), 'SLTU R1,R2,R3', false),
  R('SGTU', 0x3b, 'set', 'Rd ← (Rs1 > Rs2) ? 1 : 0', txt('Come SGT, senza segno. (Estensione.)', 'Like SGT, unsigned. (Extension.)'), 'SGTU R1,R2,R3', false),
  R('SLEU', 0x3c, 'set', 'Rd ← (Rs1 ≤ Rs2) ? 1 : 0', txt('Come SLE, senza segno. (Estensione.)', 'Like SLE, unsigned. (Extension.)'), 'SLEU R1,R2,R3', false),
  R('SGEU', 0x3d, 'set', 'Rd ← (Rs1 ≥ Rs2) ? 1 : 0', txt('Come SGE, senza segno. (Estensione.)', 'Like SGE, unsigned. (Extension.)'), 'SGEU R1,R2,R3', false),
  I('SEQI', 0x18, 'rri', 'set', 'signed', 'Rd ← (Rs1 = imm) ? 1 : 0', txt('Rd = 1 se Rs1 = immediato (esteso con segno).', 'Rd = 1 if Rs1 = immediate (sign-extended).'), 'SEQI R1,R2,8'),
  I('SNEI', 0x19, 'rri', 'set', 'signed', 'Rd ← (Rs1 ≠ imm) ? 1 : 0', txt('Rd = 1 se Rs1 ≠ immediato.', 'Rd = 1 if Rs1 ≠ immediate.'), 'SNEI R4,R2,8'),
  I('SLTI', 0x1a, 'rri', 'set', 'signed', 'Rd ← (Rs1 < imm) ? 1 : 0', txt('Rd = 1 se Rs1 < immediato.', 'Rd = 1 if Rs1 < immediate.'), 'SLTI R1,R2,3'),
  I('SGTI', 0x1b, 'rri', 'set', 'signed', 'Rd ← (Rs1 > imm) ? 1 : 0', txt('Rd = 1 se Rs1 > immediato.', 'Rd = 1 if Rs1 > immediate.'), 'SGTI R1,R2,3'),
  I('SLEI', 0x1c, 'rri', 'set', 'signed', 'Rd ← (Rs1 ≤ imm) ? 1 : 0', txt('Rd = 1 se Rs1 ≤ immediato.', 'Rd = 1 if Rs1 ≤ immediate.'), 'SLEI R1,R2,3'),
  I('SGEI', 0x1d, 'rri', 'set', 'signed', 'Rd ← (Rs1 ≥ imm) ? 1 : 0', txt('Rd = 1 se Rs1 ≥ immediato.', 'Rd = 1 if Rs1 ≥ immediate.'), 'SGEI R1,R2,3'),

  I('LHI', 0x0f, 'ri', 'lhi', undefined, 'Rd ← imm16 ## (0)16',
    txt("Load High Immediate: mette l'immediato nei 16 bit ALTI di Rd e zeri nei bassi. NON accede alla memoria. Serve a costruire indirizzi a 32 bit (es. LHI R4,0x8000 → R4=0x80000000).",
      'Load High Immediate: puts the immediate in the HIGH 16 bits of Rd, zeros below. It does NOT access memory. Used to build 32-bit addresses.'),
    'LHI R4,0x8000'),

  // ---------- Load / Store ----------
  I('LB', 0x20, 'load', 'load', 'signed', 'Rd ← (M[a]₇)²⁴ ## M[a]',
    txt('Legge un BYTE e lo estende CON segno a 32 bit. Indirizzo a = Rs1 + offset (offset esteso con segno).', 'Loads a BYTE, sign-extended to 32 bits. Address a = Rs1 + offset.'),
    'LB R7,0x0800(R3)'),
  I('LBU', 0x24, 'load', 'load', 'signed', 'Rd ← (0)²⁴ ## M[a]',
    txt('Legge un BYTE e lo estende SENZA segno (aggiunge 24 zeri).', 'Loads a BYTE, zero-extended.'), 'LBU R7,0x0800(R9)'),
  I('LH', 0x21, 'load', 'load', 'signed', 'Rd ← (M[a]₁₅)¹⁶ ## M[a..a+1]',
    txt('Legge una HALF-WORD (16 bit, indirizzo multiplo di 2) estesa con segno.', 'Loads a HALF-WORD (16 bit, address multiple of 2), sign-extended.'), 'LH R4,0x0002(R1)'),
  I('LHU', 0x25, 'load', 'load', 'signed', 'Rd ← (0)¹⁶ ## M[a..a+1]',
    txt('Legge una HALF-WORD estesa senza segno.', 'Loads a HALF-WORD, zero-extended.'), 'LHU R3,0x0002(R1)'),
  I('LW', 0x23, 'load', 'load', 'signed', 'Rd ←32 M[a..a+3]',
    txt('Legge una WORD (32 bit, indirizzo multiplo di 4). Big-endian: il byte all\'indirizzo più basso è il più significativo.', 'Loads a WORD (32 bit, address multiple of 4). Big-endian.'),
    'LW R1,0x0040(R3)'),
  I('SB', 0x28, 'store', 'store', 'signed', 'M[a] ←8 Rs2₇..₀',
    txt('Scrive in memoria il byte meno significativo di Rs2.', 'Stores the low byte of Rs2.'), 'SB R0,0x0004(R29)'),
  I('SH', 0x29, 'store', 'store', 'signed', 'M[a..a+1] ←16 Rs2₁₅..₀',
    txt('Scrive in memoria i 16 bit bassi di Rs2 (indirizzo multiplo di 2).', 'Stores the low 16 bits of Rs2 (address multiple of 2).'), 'SH R2,0x7FF2(R1)'),
  I('SW', 0x2b, 'store', 'store', 'signed', 'M[a..a+3] ←32 Rs2',
    txt('Scrive in memoria la word Rs2 (indirizzo multiplo di 4). Il simulatore accetta sia SW R18,0x800(R0) sia SW 0x800(R0),R18.',
      'Stores the word Rs2 (address multiple of 4). Both SW R18,0x800(R0) and SW 0x800(R0),R18 are accepted.'),
    'SW R1,0x0200(R7)'),

  // ---------- Salti ----------
  I('BEQZ', 0x04, 'branch', 'branch', 'signed', 'if (Rs1 = 0) PC ← PC+4 + (IR15)16##IR15..0',
    txt("Salta all'etichetta se Rs1 vale 0. Lo spiazzamento è relativo a PC+4 (lo calcola l'assembler).", 'Branches to the label if Rs1 is 0. Offset relative to PC+4 (computed by the assembler).'),
    'BEQZ R4,fine'),
  I('BNEZ', 0x05, 'branch', 'branch', 'signed', 'if (Rs1 ≠ 0) PC ← PC+4 + (IR15)16##IR15..0',
    txt("Salta all'etichetta se Rs1 è diverso da 0. Con le SET si realizza il \"compare and branch\".", 'Branches if Rs1 is not 0. With SET instructions you build "compare and branch".'),
    'BNEZ R9,LOOP'),
  { mn: 'J', fmt: 'J', opcode: 0x02, shape: 'jump', group: 'jump', course: true,
    rtl: 'PC ← PC+4 + (IR25)6##IR25..0',
    doc: txt('Salto incondizionato PC-relative (offset a 26 bit).', 'Unconditional PC-relative jump (26-bit offset).'), example: 'J main' },
  { mn: 'JAL', fmt: 'J', opcode: 0x03, shape: 'jump', group: 'jump', course: true,
    rtl: 'R31 ← PC+4 ; PC ← PC+4 + (IR25)6##IR25..0',
    doc: txt("Chiamata a procedura: salva l'indirizzo di ritorno (PC+4) in R31 e salta. Si torna con JR R31.", 'Procedure call: saves the return address (PC+4) in R31 and jumps. Return with JR R31.'),
    example: 'JAL funzione' },
  I('JR', 0x12, 'jreg', 'jump', undefined, 'PC ← Rs1',
    txt('Salta all\'indirizzo contenuto nel registro. JR R31 = ritorno da procedura.', 'Jumps to the address in the register. JR R31 = return from procedure.'), 'JR R31'),
  I('JALR', 0x13, 'jreg', 'jump', undefined, 'R31 ← PC+4 ; PC ← Rs1',
    txt('Chiamata a procedura all\'indirizzo contenuto nel registro.', 'Procedure call to the address held in the register.'), 'JALR R5'),

  // ---------- Speciali ----------
  { mn: 'RFE', fmt: 'J', opcode: 0x10, shape: 'none', group: 'special', course: true,
    rtl: 'PC ← IAR ; IEN ← 1',
    doc: txt("Return From Exception: torna dall'interrupt handler (PC ← IAR) e riabilita le interruzioni.", 'Return From Exception: returns from the interrupt handler (PC ← IAR) and re-enables interrupts.'),
    example: 'RFE' },
  { mn: 'MOVI2S', fmt: 'R', opcode: 0, func: 0x30, shape: 'movi2s', group: 'special', course: true,
    rtl: 'IAR ← Rs1',
    doc: txt('Copia un registro general purpose in un registro speciale (IAR).', 'Copies a general purpose register into a special register (IAR).'),
    example: 'MOVI2S IAR,R1' },
  { mn: 'MOVS2I', fmt: 'R', opcode: 0, func: 0x31, shape: 'movs2i', group: 'special', course: true,
    rtl: 'Rd ← IAR',
    doc: txt("Copia un registro speciale (IAR) in un registro general purpose. Utile per salvare IAR e annidare gli interrupt.", 'Copies a special register (IAR) into a GP register. Useful to save IAR when nesting interrupts.'),
    example: 'MOVS2I R1,IAR' },
  { mn: 'TRAP', fmt: 'J', opcode: 0x11, shape: 'trap', group: 'special', course: false,
    rtl: 'TRAP 0: stop ; TRAP n: IAR ← PC+4 ; PC ← n',
    doc: txt('Convenzione del simulatore: TRAP 0 (o HALT) ferma l\'esecuzione. TRAP n salta all\'indirizzo n salvando il ritorno in IAR.', 'Simulator convention: TRAP 0 (or HALT) stops execution. TRAP n jumps to address n saving the return address in IAR.'),
    example: 'TRAP 0' },
  { mn: 'NOP', fmt: 'J', opcode: 0x15, shape: 'none', group: 'misc', course: false,
    rtl: '—',
    doc: txt('Non fa nulla (utile per riempire o per i delay slot).', 'Does nothing.'), example: 'NOP' },
];

/** Pseudo-istruzioni: tradotte dall'assembler in istruzioni vere. */
export const PSEUDO: Record<string, { doc: Txt; example: string }> = {
  HALT: { doc: txt('Pseudo-istruzione: equivale a TRAP 0, ferma il simulatore.', 'Pseudo-instruction: same as TRAP 0, stops the simulator.'), example: 'HALT' },
};

export const BY_MN = new Map(INSTRUCTIONS.map((d) => [d.mn, d]));
export const BY_OPCODE = new Map(INSTRUCTIONS.filter((d) => d.opcode !== 0).map((d) => [d.opcode, d]));
export const BY_FUNC = new Map(INSTRUCTIONS.filter((d) => d.opcode === 0).map((d) => [d.func!, d]));

export const SPECIAL_REGS = ['IAR'];

/** Sintassi leggibile per documentazione e messaggi d'errore. */
export function syntaxOf(d: InstrDef): string {
  switch (d.shape) {
    case 'rrr': return `${d.mn} Rd,Rs1,Rs2`;
    case 'rri': return `${d.mn} Rd,Rs1,imm16`;
    case 'ri': return `${d.mn} Rd,imm16`;
    case 'load': return `${d.mn} Rd,offset(Rs1)`;
    case 'store': return `${d.mn} Rs2,offset(Rs1)`;
    case 'branch': return `${d.mn} Rs1,etichetta`;
    case 'jump': return `${d.mn} etichetta`;
    case 'jreg': return `${d.mn} Rs1`;
    case 'movi2s': return `${d.mn} IAR,Rs1`;
    case 'movs2i': return `${d.mn} Rd,IAR`;
    case 'trap': return `${d.mn} n`;
    case 'none': return d.mn;
  }
}

/** Gruppi per la documentazione. */
export const GROUP_NAMES: Record<Group, Txt> = {
  alu: txt('Aritmetiche e logiche', 'Arithmetic and logic'),
  shift: txt('Shift', 'Shifts'),
  set: txt('Set condition (confronti)', 'Set condition (compares)'),
  lhi: txt('Costanti a 32 bit', '32-bit constants'),
  load: txt('Load (lettura memoria)', 'Load (memory read)'),
  store: txt('Store (scrittura memoria)', 'Store (memory write)'),
  branch: txt('Salti condizionati', 'Conditional branches'),
  jump: txt('Salti incondizionati e procedure', 'Jumps and procedures'),
  special: txt('Interrupt e registri speciali', 'Interrupts and special registers'),
  misc: txt('Varie', 'Misc'),
};
