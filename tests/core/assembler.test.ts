import { describe, it, expect } from 'vitest';
import { assemble, ALL_MNEMONICS, ALL_DIRECTIVES } from '../../src/core/asm/assembler';
import { asmOk, errorsOf, warningsOf, wordOf } from './helpers';

/** valore a 16 bit dell'immediato di "ADDI R1,R0,<expr>" */
const imm = (expr: string) => wordOf(asmOk(`ADDI R1,R0,${expr}`), 0) & 0xffff;
const bytesAt = (p: ReturnType<typeof assemble>, a: number, n: number) => Array.from({ length: n }, (_, i) => p.bytes.get(a + i));

describe('formati numerici', () => {
  it.each([
    ['0x1F', 31], ['0X1f', 31], ['1Fh', 31], ['1fH', 31], ['0800h', 0x800], ['0FFh', 255], ['0b101', 5], ['0B11', 3],
    ['31', 31], ['0', 0], ['00', 0], ['-1', 0xffff], ['-0x10', 0xfff0], ["'A'", 65], ["'0'", 48], ["' '", 32],
    ["'\\n'", 10], ["'\\t'", 9], ["'\\0'", 0], ["','", 44], ["';'", 59], ["'#'", 35], ['0x7FFF', 0x7fff], ['-32768', 0x8000],
    ['0xFFFF', 0xffff], ['+5', 5], ['- 5', 0xfffb],
  ])('%s → %d', (expr, v) => {
    expect(imm(expr)).toBe(v);
  });
});

describe('espressioni', () => {
  it.each([
    ['(1+2)*3', 9], ['2+3*4', 14], ['10-3-2', 5], ['7/2', 3], ['-7/2', 0xfffd], ['1<<4', 16], ['0xF0>>4', 15],
    ['6&3', 2], ['6|1', 7], ['6^3', 5], ['~0', 0xffff], ['~1&0xFF', 0xfe], ['1+2<<1', 6], ['1|2&3', 3], ['-(3)', 0xfffd],
    ['((2))', 2], ['0x10+0b11+3h', 0x16], ['hi(0x12345678)', 0x1234], ['lo(0x12345678)', 0x5678], ['HI(0x80000000)', 0x8000],
    ['lo(-1)', 0xffff], ['hi(lo(0x12345678)<<16)', 0x5678], ['1<<15', 0x8000], ['0x10000>>1', 0x8000], ['2*3*4', 24],
  ])('%s → 0x%s', (expr, v) => {
    // ADDI estende con segno: per i valori ≥ 0x8000 controllo solo i 16 bit bassi
    expect(imm(expr)).toBe(v);
  });
  it('operatori su valori a 32 bit via .word', () => {
    const p = asmOk('.org 0\n.word 0x80000000|1, 1<<31, 0xFFFFFFFF&0xFF00FF00, 0xFFFFFFFF^0xF, ~0, -1, 0x12345678>>16');
    expect(wordOf(p, 0)).toBe(0x80000001);
    expect(wordOf(p, 4)).toBe(0x80000000);
    expect(wordOf(p, 8)).toBe(0xff00ff00);
    expect(wordOf(p, 12)).toBe(0xfffffff0);
    expect(wordOf(p, 16)).toBe(0xffffffff);
    expect(wordOf(p, 20)).toBe(0xffffffff);
    expect(wordOf(p, 24)).toBe(0x1234);
  });
  it('simboli nelle espressioni (EQU e label)', () => {
    const p = asmOk('N EQU 5\nM .equ N*2\n.equ K, M+1\nX = K+1\nADDI R1,R0,X\n');
    expect(wordOf(p, 0) & 0xffff).toBe(12);
    expect(p.symbols.get('N')).toMatchObject({ value: 5, kind: 'equ' });
    expect(p.symbols.get('M')!.value).toBe(10);
  });
  it('divisione per zero è un errore (non un valore silenzioso)', () => {
    const p = assemble('ADDI R1,R0,5/0');
    expect(errorsOf(p).length).toBe(1);
  });
  it('errori di sintassi delle espressioni', () => {
    for (const bad of ['(1+2', '1+', '*3', '1 2', '$$', '5)', 'hi(1']) {
      const p = assemble(`ADDI R1,R0,${bad}`);
      expect(errorsOf(p).length, bad).toBeGreaterThan(0);
    }
  });
  it('un registro dove serve un numero', () => {
    const p = assemble('ADDI R1,R0,R5+1');
    expect(errorsOf(p)).toHaveLength(1);
    expect(errorsOf(p)[0].text.it).toContain('R5');
  });
});

describe('zero iniziale: avviso decimale', () => {
  it('0800 → warning con fix 0x0800 e valore decimale', () => {
    const p = assemble('ADDI R1,R0,0800');
    expect(p.ok).toBe(true);
    const w = warningsOf(p);
    expect(w).toHaveLength(1);
    expect(w[0].text.it).toContain('0x0800');
    expect(w[0].text.en).toContain('0x0800');
    expect(w[0].fix?.insert).toBe('0x0800');
    expect(w[0].from).toBe('ADDI R1,R0,'.length);
    expect(w[0].to).toBe('ADDI R1,R0,0800'.length);
    expect(wordOf(p, 0) & 0xffff).toBe(800);
  });
  it('anche nelle direttive e nei load/store', () => {
    expect(warningsOf(assemble('.word 0100'))).toHaveLength(1);
    expect(warningsOf(assemble('LW R1,0800(R0)'))).toHaveLength(1);
    expect(warningsOf(assemble('.org 0100'))).toHaveLength(1);
  });
  it('nessun avviso per 0, 00, 0x.., ..h, 0b.., 7, 10', () => {
    for (const v of ['0', '00', '0x0800', '0800h', '0b0101', '7', '10', '-0']) {
      expect(warningsOf(assemble(`ADDI R1,R0,${v}`)), v).toHaveLength(0);
    }
  });
  it('ogni occorrenza produce un solo avviso', () => {
    expect(warningsOf(assemble('ADDI R1,R0,0800\nADDI R1,R0,0900'))).toHaveLength(2);
  });
});

describe('etichette', () => {
  it('da sole sulla riga, prima di un\'istruzione, più per riga', () => {
    const p = asmOk('a:\nb: c: ADD R1,R1,R1\nd:\n\n  HALT');
    expect(p.symbols.get('a')!.value).toBe(0);
    expect(p.symbols.get('b')!.value).toBe(0);
    expect(p.symbols.get('c')!.value).toBe(0);
    expect(p.symbols.get('d')!.value).toBe(4);
    expect(p.symbols.get('d')!.line).toBe(3);
    expect(p.symbols.get('a')!.kind).toBe('label');
  });
  it('nomi con . _ $ e cifre; case-insensitive nei riferimenti', () => {
    const p = asmOk('.l_1$x: NOP\nLoop: NOP\nJ loop\nJ .l_1$x\nJ LOOP');
    expect(p.ok).toBe(true);
  });
  it('salto in avanti e all\'indietro: offset da PC+4', () => {
    const p = asmOk('L: ADD R1,R1,R1\nBNEZ R1,L\nJ end\nNOP\nend: HALT');
    expect(wordOf(p, 4) & 0xffff).toBe(0xfff8); // 0 - (4+4)
    expect(wordOf(p, 8) & 0x3ffffff).toBe(4); // 16 - 12
    expect(wordOf(p, 8) >>> 26).toBe(2);
  });
  it('salto a se stesso: offset -4; offset 0 = istruzione seguente', () => {
    const p = asmOk('x: J x\nBEQZ R0,y\ny: HALT');
    expect(wordOf(p, 0) & 0x3ffffff).toBe(0x3fffffc);
    expect(wordOf(p, 4) & 0xffff).toBe(0);
  });
  it('etichetta + offset', () => {
    const p = asmOk('a: NOP\nNOP\nNOP\nJ a+8');
    expect(wordOf(p, 12) & 0x3ffffff).toBe((8 - 16) & 0x3ffffff); // 8 - (12+4) = -8 su 26 bit
  });
  it('numero = spostamento in byte raw (con info)', () => {
    const p = asmOk('BEQZ R1,8\nJ -4\nJ 0');
    expect(wordOf(p, 0) & 0xffff).toBe(8);
    expect(wordOf(p, 4) & 0x3ffffff).toBe(0x3fffffc);
    expect(wordOf(p, 8) & 0x3ffffff).toBe(0);
    expect(p.diagnostics.filter((d) => d.severity === 'info' && /byte/.test(d.text.en)).length).toBe(3);
  });
  it('etichette di dati e .word con etichetta', () => {
    const p = asmOk('.data\nv: .word 1,2,3\nw: .word v, w\n');
    expect(p.symbols.get('v')!.value).toBe(0x40000000);
    expect(p.symbols.get('w')!.value).toBe(0x4000000c);
    expect(wordOf(p, 0x4000000c)).toBe(0x40000000);
    expect(wordOf(p, 0x40000010)).toBe(0x4000000c);
  });
  it('registro con nome di etichetta (R5:) → errore; nome di istruzione → warning', () => {
    expect(errorsOf(assemble('R5: NOP'))).toHaveLength(1);
    expect(errorsOf(assemble('r0: NOP'))).toHaveLength(1);
    const p = assemble('add: NOP');
    expect(p.ok).toBe(true);
    expect(warningsOf(p)).toHaveLength(1);
  });
  it('etichetta duplicata (anche con maiuscole diverse) → errore alla seconda riga', () => {
    const p = assemble('a: NOP\nA: NOP');
    const e = errorsOf(p);
    expect(e).toHaveLength(1);
    expect(e[0].line).toBe(2);
    expect(e[0].text.it).toContain('riga 1');
  });
  it('etichetta non definita: errore con colonna e suggerimento', () => {
    const src = 'Loop: NOP\n  BNEZ R1,Lop';
    const p = assemble(src);
    const e = errorsOf(p);
    expect(e).toHaveLength(1);
    expect(e[0].line).toBe(2);
    expect(e[0].from).toBe(src.split('\n')[1].indexOf('Lop'));
    expect(e[0].to).toBe(e[0].from + 3);
    expect(e[0].fix?.insert).toBe('Loop');
    expect(e[0].text.en).toContain('Loop');
  });
  it('etichetta non definita senza simile: nessun fix', () => {
    const p = assemble('J zzzzzzzz');
    expect(errorsOf(p)[0].fix).toBeUndefined();
  });
  it('hex senza zero iniziale (FFh) → errore con fix 0xFF', () => {
    const p = assemble('ADDI R1,R0,FFh');
    const e = errorsOf(p);
    expect(e).toHaveLength(1);
    expect(e[0].fix?.insert).toBe('0xFF');
  });
  it('la riga con sola etichetta non genera byte ma lineToAddr/addrToLine sono coerenti', () => {
    const p = asmOk('x:\nNOP\nHALT');
    expect(p.lineToAddr.get(1)).toBeUndefined();
    expect(p.lineToAddr.get(2)).toBe(0);
    expect(p.addrToLine.get(4)).toBe(3);
    expect(p.regions).toEqual([
      { start: 0, end: 3, line: 2, kind: 'code' },
      { start: 4, end: 7, line: 3, kind: 'code' },
    ]);
  });
});

describe('direttive', () => {
  it('.word/.half/.byte big-endian', () => {
    const p = asmOk('.word 0x11223344, -1\n.half 0x5566, -2\n.byte 0x77, 255, -128, \'A\'');
    expect(bytesAt(p, 0, 8)).toEqual([0x11, 0x22, 0x33, 0x44, 0xff, 0xff, 0xff, 0xff]);
    expect(bytesAt(p, 8, 4)).toEqual([0x55, 0x66, 0xff, 0xfe]);
    expect(bytesAt(p, 12, 4)).toEqual([0x77, 0xff, 0x80, 0x41]);
  });
  it('.space con e senza riempimento', () => {
    const p = asmOk('.space 3\n.space 2, 0xAB\n.byte 9');
    expect(bytesAt(p, 0, 6)).toEqual([0, 0, 0, 0xab, 0xab, 9]);
  });
  it('.ascii / .asciiz / escape', () => {
    const p = asmOk('.ascii "ab"\n.asciiz "c\\n\\t\\\\\\""\n.asciiz "x;y#z//w"');
    expect(bytesAt(p, 0, 2)).toEqual([97, 98]);
    expect(bytesAt(p, 2, 6)).toEqual([99, 10, 9, 92, 34, 0]);
    expect(bytesAt(p, 8, 10)).toEqual([120, 59, 121, 35, 122, 47, 47, 119, 0, undefined]);
  });
  it('.org e .align', () => {
    const p = asmOk('.org 0x10\nNOP\n.byte 1\n.align 2\n.word 5\n.align 3\n.half 7');
    expect(p.addrToLine.get(0x10)).toBe(2);
    expect(wordOf(p, 0x18)).toBe(5);
    expect(bytesAt(p, 0x20, 2)).toEqual([0, 7]);
  });
  it('.text / .data con default dataBase e operando', () => {
    const p = asmOk('.data\n.word 1\n.text\nNOP\n.data\n.word 2\n.data 0x50000000\n.word 3');
    expect(wordOf(p, 0x40000000)).toBe(1);
    expect(wordOf(p, 0x40000004)).toBe(2);
    expect(wordOf(p, 0x50000000)).toBe(3);
    expect(p.addrToLine.get(0)).toBe(4);
    const q = asmOk('.data\n.word 1', 0x60000000);
    expect(wordOf(q, 0x60000000)).toBe(1);
  });
  it('.equ nelle due forme e NOME EQU valore (maiuscolo/minuscolo)', () => {
    const p = asmOk('A EQU 3\nB equ 4\nC .EQU 5\n.equ D, 6\n.set E, 7\nF = 8\n.word A,B,C,D,E,F');
    for (let i = 0; i < 6; i++) expect(wordOf(p, i * 4)).toBe(3 + i);
  });
  it('.global/.globl ignorate', () => {
    expect(assemble('.global main\n.globl main\nmain: HALT').ok).toBe(true);
  });
  it('intervalli di valori: .word/.half/.byte', () => {
    expect(assemble('.word 0xFFFFFFFF').ok).toBe(true);
    expect(assemble('.word -2147483648').ok).toBe(true);
    expect(assemble('.word 0x100000000').ok).toBe(false);
    expect(assemble('.word -2147483649').ok).toBe(false);
    expect(assemble('.half 0xFFFF').ok).toBe(true);
    expect(assemble('.half -32768').ok).toBe(true);
    expect(assemble('.half 0x10000').ok).toBe(false);
    expect(assemble('.half -32769').ok).toBe(false);
    expect(assemble('.byte 255').ok).toBe(true);
    expect(assemble('.byte -128').ok).toBe(true);
    expect(assemble('.byte 256').ok).toBe(false);
    expect(assemble('.byte -129').ok).toBe(false);
  });
  it('direttiva sconosciuta con suggerimento', () => {
    const p = assemble('.wrd 1');
    expect(errorsOf(p)).toHaveLength(1);
    expect(errorsOf(p)[0].text.it).toContain('.word');
    expect(errorsOf(p)[0].from).toBe(0);
    expect(errorsOf(p)[0].to).toBe(4);
  });
  it('direttive con operandi mancanti o sbagliati', () => {
    expect(errorsOf(assemble('.org'))).toHaveLength(1);
    expect(errorsOf(assemble('.space'))).toHaveLength(1);
    expect(errorsOf(assemble('.equ X'))).toHaveLength(1);
    expect(errorsOf(assemble('.equ X, 1, 2'))).toHaveLength(1);
    expect(errorsOf(assemble('.ascii abc'))).toHaveLength(1);
    expect(errorsOf(assemble('.word 1,,2'))).toHaveLength(1);
    expect(errorsOf(assemble('.word 1,'))).toHaveLength(1);
  });
  it('EQU duplicato o in conflitto con etichetta → errore', () => {
    expect(errorsOf(assemble('X EQU 1\nX EQU 2'))).toHaveLength(1);
    expect(errorsOf(assemble('X: NOP\nX EQU 2'))).toHaveLength(1);
  });
  it('EQU con simbolo non ancora definito → errore (niente riferimenti in avanti)', () => {
    expect(errorsOf(assemble('X EQU Y\nY EQU 1')).length).toBeGreaterThan(0);
  });
  it('.word/.half a indirizzo non allineato → warning; istruzione non allineata → errore', () => {
    const p = assemble('.byte 1\n.word 5');
    expect(p.ok).toBe(true);
    expect(warningsOf(p)).toHaveLength(1);
    expect(warningsOf(assemble('.byte 1\n.half 5'))).toHaveLength(1);
    expect(warningsOf(assemble('.half 5'))).toHaveLength(0);
    const q = assemble('.byte 1\nNOP');
    expect(errorsOf(q)).toHaveLength(1);
    expect(errorsOf(q)[0].line).toBe(2);
    expect(assemble('.org 2\nNOP').ok).toBe(false);
  });
  it('sovrapposizione di indirizzi → errore sulla seconda riga', () => {
    const p = assemble('NOP\n.org 0\nNOP');
    expect(errorsOf(p)).toHaveLength(1);
    expect(errorsOf(p)[0].line).toBe(3);
    const q = assemble('.word 1\n.org 2\n.half 3');
    expect(errorsOf(q)).toHaveLength(1);
  });
});

describe('istruzioni: codifica', () => {
  it('codifiche note', () => {
    const w = (s: string) => wordOf(asmOk(s), 0);
    expect(w('ADD R1,R2,R3')).toBe(0x00620820);
    expect(w('ADDI R1,R2,4')).toBe(0x20220004);
    expect(w('LW R1,8(R2)')).toBe(0x8c220008);
    expect(w('SW R1,8(R2)')).toBe(0xac220008);
    expect(w('HALT')).toBe(0x44000000);
    expect(w('TRAP 0')).toBe(0x44000000);
    expect(w('NOP')).toBe(0x54000000);
    expect(w('RFE')).toBe(0x40000000);
    expect(w('JR R31')).toBe(0x48000000 | (31 << 16));
    expect(w('JALR R5')).toBe(0x4c000000 | (5 << 16));
    expect(w('LHI R1,0x8000')).toBe(0x3c208000);
    expect(w('MOVI2S IAR,R3')).toBe((3 << 16) | 0x30);
    expect(w('MOVS2I R3,IAR')).toBe((3 << 11) | 0x31);
  });
  it('mnemonici, registri e IAR case-insensitive', () => {
    const a = wordOf(asmOk('addi r1,r0,5'), 0);
    expect(a).toBe(wordOf(asmOk('ADDI R1,R0,5'), 0));
    expect(wordOf(asmOk('movi2s iar,r1'), 0)).toBe(wordOf(asmOk('MOVI2S IAR,R1'), 0));
  });
  it('store: entrambi gli ordini degli operandi', () => {
    const a = wordOf(asmOk('SW R1,8(R2)'), 0);
    expect(wordOf(asmOk('SW 8(R2),R1'), 0)).toBe(a);
    expect(wordOf(asmOk('SW 0x800(R0),R18'), 0)).toBe(wordOf(asmOk('SW R18,0x800(R0)'), 0));
    expect(wordOf(asmOk('SB 4(R3),R4'), 0)).toBe(wordOf(asmOk('SB R4,4(R3)'), 0));
    expect(wordOf(asmOk('SH R4,-2(R3)'), 0) & 0xffff).toBe(0xfffe);
  });
  it('offset omesso, negativo, con spazi, con espressione', () => {
    expect(wordOf(asmOk('LW R1,(R2)'), 0) & 0xffff).toBe(0);
    expect(wordOf(asmOk('LW R1,-4(R2)'), 0) & 0xffff).toBe(0xfffc);
    expect(wordOf(asmOk('LW R1, 4 ( R2 )'), 0) & 0xffff).toBe(4);
    expect(wordOf(asmOk('LW R1,(2+2)*2(R2)'), 0) & 0xffff).toBe(8);
    expect(wordOf(asmOk('N EQU 12\nLW R1,N+4(R2)'), 0) & 0xffff).toBe(16);
  });
  it('LW R1,label = indirizzo assoluto con base R0', () => {
    const p = asmOk('LW R1,v\nSW R1,v\nHALT\nv: .word 5');
    expect(wordOf(p, 0)).toBe((0x8c200000 | 12) >>> 0);
    expect(wordOf(p, 4)).toBe((0xac200000 | 12) >>> 0);
  });
  it('LW R1,label con indirizzo non a 16 bit → errore che suggerisce LHI', () => {
    const p = assemble('LW R1,v\n.data\nv: .word 5');
    expect(errorsOf(p)).toHaveLength(1);
    expect(errorsOf(p)[0].text.it).toContain('LHI');
  });
  it('limiti degli immediati a 16 bit', () => {
    expect(assemble('ADDI R1,R0,65535').ok).toBe(true);
    expect(assemble('ADDI R1,R0,-32768').ok).toBe(true);
    expect(errorsOf(assemble('ADDI R1,R0,65536'))).toHaveLength(1);
    expect(errorsOf(assemble('ADDI R1,R0,-32769'))).toHaveLength(1);
    expect(errorsOf(assemble('ORI R1,R0,0x12345'))).toHaveLength(1);
    expect(errorsOf(assemble('ORI R1,R0,0x12345'))[0].text.it).toContain('LHI');
  });
  it('immediato signed ≥ 0x8000 → info; unsigned negativo → warning; shift fuori range → warning', () => {
    const a = assemble('ADDI R1,R0,0x8000');
    expect(a.ok).toBe(true);
    expect(a.diagnostics.some((d) => d.severity === 'info' && d.text.it.includes('CON segno'))).toBe(true);
    const b = assemble('ANDI R1,R0,-1');
    expect(warningsOf(b)).toHaveLength(1);
    expect(wordOf(b, 0) & 0xffff).toBe(0xffff);
    const c = assemble('SLLI R1,R2,32');
    expect(warningsOf(c)).toHaveLength(1);
    expect(assemble('SLLI R1,R2,31').diagnostics.filter((d) => d.severity === 'warning')).toHaveLength(0);
    expect(warningsOf(assemble('SRAI R1,R2,-1'))).toHaveLength(1);
    expect(warningsOf(assemble('ADDUI R1,R2,0xFFFF'))).toHaveLength(0);
  });
  it('LHI: 0..0xFFFF ok, oltre errore con fix', () => {
    expect(assemble('LHI R1,0').ok).toBe(true);
    expect(assemble('LHI R1,0xFFFF').ok).toBe(true);
    expect(assemble('LHI R1,hi(0x40000000)').ok).toBe(true);
    const p = assemble('LHI R1,0x40000000');
    expect(errorsOf(p)).toHaveLength(1);
    expect(errorsOf(p)[0].fix?.insert).toBe('0x4000');
  });
  it('TRAP: intervallo a 26 bit', () => {
    expect(wordOf(asmOk('TRAP 0x3FFFFFF'), 0)).toBe(0x47ffffff);
    expect(errorsOf(assemble('TRAP 0x4000000'))).toHaveLength(1);
    expect(errorsOf(assemble('TRAP -1'))).toHaveLength(1);
  });
  it('salti troppo lontani o non allineati', () => {
    expect(errorsOf(assemble('BEQZ R1,far\n.org 0x10000\nfar: HALT'))).toHaveLength(1);
    expect(assemble('BEQZ R1,far\n.org 0x7ffc\nfar: HALT').ok).toBe(true);
    expect(errorsOf(assemble('J far\n.org 0x10000000\nfar: HALT'))).toHaveLength(1);
    expect(errorsOf(assemble('BEQZ R1,2'))).toHaveLength(1);
    expect(errorsOf(assemble('J -6'))).toHaveLength(1);
    expect(errorsOf(assemble('BEQZ R1,x\n.byte 1\nx: .byte 2'))[0].text.it).toContain('allineata');
  });
  it('branch all\'indietro al limite: -32768', () => {
    const p = asmOk('.org 0x7ffc\nx: NOP\n.org 0x8000\nNOP\nJ x');
    expect(p.ok).toBe(true);
    const q = asmOk('start: NOP\n.org 0x7ffc\nBEQZ R1,start');
    // 0 - (0x7ffc+4) = -0x8000 → rappresentabile
    expect(wordOf(q, 0x7ffc) & 0xffff).toBe(0x8000);
  });
  it('R0 come destinazione → warning; come sorgente/store no', () => {
    expect(warningsOf(assemble('ADD R0,R1,R2'))).toHaveLength(1);
    expect(warningsOf(assemble('ADDI R0,R1,2'))).toHaveLength(1);
    expect(warningsOf(assemble('LW R0,0(R1)'))).toHaveLength(1);
    expect(warningsOf(assemble('LHI R0,1'))).toHaveLength(1);
    expect(warningsOf(assemble('MOVS2I R0,IAR'))).toHaveLength(1);
    expect(warningsOf(assemble('ADD R1,R0,R0'))).toHaveLength(0);
    expect(warningsOf(assemble('SW R0,0(R1)'))).toHaveLength(0);
    expect(warningsOf(assemble('BEQZ R0,0'))).toHaveLength(0);
  });
});

describe('istruzioni: errori', () => {
  it('istruzione sconosciuta: errore con colonna e suggerimento', () => {
    const src = '    ADDD R1,R2,R3';
    const p = assemble(src);
    const e = errorsOf(p);
    expect(e).toHaveLength(1);
    expect(e[0].from).toBe(4);
    expect(e[0].to).toBe(8);
    expect(e[0].fix).toBeDefined();
    expect(/^ADD/.test(e[0].fix!.insert)).toBe(true);
  });
  it('parola isolata senza ":" suggerisce di aggiungere i due punti', () => {
    const p = assemble('qwerty');
    expect(errorsOf(p)[0].fix?.insert).toBe(':');
    expect(errorsOf(p)[0].text.it).toContain('":"');
  });
  it('numero di operandi sbagliato: colonna del mnemonico, con sintassi ed esempio', () => {
    const p = assemble('  ADD R1,R2');
    const e = errorsOf(p);
    expect(e).toHaveLength(1);
    expect(e[0].from).toBe(2);
    expect(e[0].to).toBe(5);
    expect(e[0].text.it).toContain('Rd,Rs1,Rs2');
    for (const s of ['ADD R1,R2,R3,R4', 'ADDI R1', 'LW R1', 'JR', 'J', 'RFE R1', 'NOP 1', 'HALT 1', 'LHI R1', 'MOVI2S IAR', 'TRAP', 'BEQZ R1']) {
      expect(errorsOf(assemble(s)).length, s).toBe(1);
    }
  });
  it('ADD con costante → suggerisce ADDI (anche per le varianti U e SLL/SLT)', () => {
    const fixOf = (s: string) => errorsOf(assemble(s))[0]?.fix?.insert;
    expect(fixOf('ADD R1,R2,5')).toBe('ADDI');
    expect(fixOf('ADDU R1,R2,5')).toBe('ADDUI');
    expect(fixOf('SUBU R1,R2,5')).toBe('SUBUI');
    expect(fixOf('SLL R1,R2,5')).toBe('SLLI');
    expect(fixOf('SLT R1,R2,5')).toBe('SLTI');
    expect(fixOf('AND R1,R2,5')).toBe('ANDI');
    expect(fixOf('SLTU R1,R2,5')).toBeUndefined();
    expect(errorsOf(assemble('SLTU R1,R2,5'))).toHaveLength(1);
  });
  it('ADDI con registro → suggerisce ADD', () => {
    const fixOf = (s: string) => errorsOf(assemble(s))[0]?.fix?.insert;
    expect(fixOf('ADDI R1,R2,R3')).toBe('ADD');
    expect(fixOf('ADDUI R1,R2,R3')).toBe('ADDU');
    expect(fixOf('SUBUI R1,R2,R3')).toBe('SUBU');
    expect(fixOf('SLLI R1,R2,R3')).toBe('SLL');
    expect(fixOf('XORI R1,R2,R3')).toBe('XOR');
  });
  it('registri non validi', () => {
    const e = (s: string) => errorsOf(assemble(s));
    expect(e('ADD R1,R2,R32')[0].text.it).toContain('R32');
    expect(e('ADD R1,foo,R3')[0].text.it).toContain('non è un registro');
    expect(e('ADD 5,R2,R3')[0].text.it).toContain('numero');
    expect(e('ADD R1,R2,R3').length).toBe(0);
    expect(e('ADD R31,R0,R1').length).toBe(0);
    expect(e('LW R1,0(R32)')[0].text.it).toContain('R32');
    expect(e('LW R1,0(foo)')).toHaveLength(1);
    expect(e('JR R40')).toHaveLength(1);
    expect(e('BEQZ x,0')).toHaveLength(1);
  });
  it('colonne degli operandi', () => {
    const src = 'ADD R1,R2,R40';
    const e = errorsOf(assemble(src))[0];
    expect(e.from).toBe(src.indexOf('R40'));
    expect(e.to).toBe(src.length);
  });
  it('J con registro → JR; JR con etichetta → J; JAL ↔ JALR', () => {
    expect(errorsOf(assemble('J R5'))[0].fix?.insert).toBe('JR');
    expect(errorsOf(assemble('JAL R5'))[0].fix?.insert).toBe('JALR');
    expect(errorsOf(assemble('JR lab\nlab: NOP'))[0].fix?.insert).toBe('J');
    expect(errorsOf(assemble('JALR lab\nlab: NOP'))[0].fix?.insert).toBe('JAL');
  });
  it('load con operandi invertiti', () => {
    const p = assemble('LW 4(R1),R2');
    expect(errorsOf(p)).toHaveLength(1);
    expect(errorsOf(p)[0].text.it).toContain('destinazione');
  });
  it('store con operandi entrambi registri o nessun registro', () => {
    expect(errorsOf(assemble('SW R1,R2'))).toHaveLength(1);
    expect(errorsOf(assemble('SW 4,8(R2)'))).toHaveLength(1);
  });
  it('offset oltre 16 bit', () => {
    expect(errorsOf(assemble('LW R1,70000(R0)'))).toHaveLength(1);
    expect(errorsOf(assemble('SW R1,-32769(R0)'))).toHaveLength(1);
    expect(assemble('LW R1,-32768(R0)').ok).toBe(true);
    expect(assemble('LW R1,65535(R0)').ok).toBe(true);
    // 0x8000..0xFFFF accettati con info (estensione del segno)
    expect(assemble('LW R1,0x8000(R0)').diagnostics.some((d) => d.severity === 'info')).toBe(true);
  });
  it('MOVI2S/MOVS2I vogliono IAR', () => {
    expect(errorsOf(assemble('MOVI2S R1,R2'))).toHaveLength(1);
    expect(errorsOf(assemble('MOVS2I R1,R2'))).toHaveLength(1);
    expect(errorsOf(assemble('MOVI2S IAR,5'))).toHaveLength(1);
  });
  it('più errori: ognuno sulla propria riga, ordinati', () => {
    const p = assemble('FOO\nADD R1\nBAR R2,R3\nHALT');
    const lines = errorsOf(p).map((d) => d.line);
    expect(lines).toEqual([1, 2, 3]);
    expect(p.ok).toBe(false);
  });
  it('tutti i diagnostici hanno testo bilingue non vuoto, riga ≥ 1 e from ≤ to', () => {
    const src = ['FOO', 'ADD R1', 'ADD R1,R2,5', '.wrod', 'J nowhere', 'ADDI R1,R0,0800', 'LW R1,70000(R0)', 'MOVI2S R1,R1', 'x: x: NOP', 'ADDI R0,R0,1', 'LHI R1,0x40000000'].join('\n');
    const p = assemble(src);
    expect(p.diagnostics.length).toBeGreaterThan(8);
    for (const d of p.diagnostics) {
      expect(d.text.it.length).toBeGreaterThan(0);
      expect(d.text.en.length).toBeGreaterThan(0);
      expect(d.line).toBeGreaterThanOrEqual(1);
      expect(d.from).toBeLessThanOrEqual(d.to);
      expect(d.from).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('sorgente: commenti, spazi, righe', () => {
  it('commenti ; // # e dentro le stringhe', () => {
    const p = asmOk('NOP ; c\nNOP // c\nNOP # c\n; solo commento\n// altro\n# ancora\n.asciiz "a;b"\n');
    expect(p.regions.filter((r) => r.kind === 'code')).toHaveLength(3);
    expect(bytesAt(p, 12, 4)).toEqual([97, 59, 98, 0]);
  });
  it('CRLF e righe vuote conservano la numerazione', () => {
    const p = asmOk('NOP\r\n\r\nx: NOP\r\n');
    expect(p.symbols.get('x')!.line).toBe(3);
    expect(p.addrToLine.get(4)).toBe(3);
  });
  it('tab e spazi multipli', () => {
    const p = asmOk('\tADD\tR1 ,\tR2 ,  R3  ');
    expect(wordOf(p, 0)).toBe(0x00620820);
  });
  it('sorgente vuoto: ok, nessun byte, nessun avviso HALT', () => {
    const p = assemble('');
    expect(p.ok).toBe(true);
    expect(p.bytes.size).toBe(0);
    expect(p.diagnostics).toHaveLength(0);
    expect(assemble('; solo commenti\n\n').diagnostics).toHaveLength(0);
  });
  it('info "manca HALT" solo se c\'è codice e non c\'è HALT/TRAP 0', () => {
    const noHalt = assemble('NOP');
    expect(noHalt.ok).toBe(true);
    expect(noHalt.diagnostics.filter((d) => d.severity === 'info')).toHaveLength(1);
    expect(assemble('NOP\nHALT').diagnostics).toHaveLength(0);
    expect(assemble('NOP\nTRAP 0').diagnostics).toHaveLength(0);
    expect(assemble('TRAP 4\n').diagnostics.some((d) => d.severity === 'info')).toBe(true);
    expect(assemble('.word 1').diagnostics).toHaveLength(0);
  });
  it('ok è false solo con errori (warning e info non contano)', () => {
    expect(assemble('ADDI R0,R0,0800').ok).toBe(true);
    expect(assemble('FOO').ok).toBe(false);
  });
  it('liste esportate', () => {
    expect(ALL_MNEMONICS).toContain('HALT');
    expect(ALL_MNEMONICS).toContain('ADDI');
    expect(ALL_DIRECTIVES).toContain('.word');
  });
  it('indirizzi alti non causano numeri negativi nella mappa dei byte', () => {
    const p = asmOk('.data 0xE0000000\n.word 7');
    expect(p.bytes.has(0xe0000000)).toBe(true);
    expect(wordOf(p, 0xe0000000)).toBe(7);
    expect([...p.bytes.keys()].every((k) => k >= 0)).toBe(true);
  });
});
