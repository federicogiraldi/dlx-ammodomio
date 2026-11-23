import type { ButtonDevice, InputDevice, LedDevice, OutputDevice, CounterDevice, StartupDevice } from '../core/bus/devices';
import type { Machine } from '../core/machine';
import { hex, txt, Txt } from '../core/util';
import type { CheckResult, Exercise } from './types';
import { MAP_BUTTON, MAP_INPUT_COUNTER, MAP_INPUT_OUTPUT } from './maps';

// ------------------------------------------------------------------
// Utilità per i controlli automatici
// ------------------------------------------------------------------

const res = (ok: boolean, it: string, en: string = it): CheckResult => ({ ok, text: txt(it, en) });

const dev = <T>(m: Machine, id: string): T => m.bus.devices.find((d) => d.cfg.id === id) as unknown as T;

/** word in memoria (senza effetti collaterali) */
function checkWord(m: Machine, addr: number, expected: number, what: Txt): CheckResult {
  const w = m.bus.peekWord(addr);
  const exp = expected >>> 0;
  if (!w.init) {
    return res(false,
      `${what.it}: all'indirizzo ${hex(addr)} non è stato scritto nulla (atteso ${exp} = ${hex(exp)}).`,
      `${what.en}: nothing was written at ${hex(addr)} (expected ${exp} = ${hex(exp)}).`);
  }
  if (w.value !== exp) {
    return res(false,
      `${what.it}: a ${hex(addr)} c'è ${w.value | 0} (${hex(w.value)}), ma doveva essere ${exp | 0} (${hex(exp)}).`,
      `${what.en}: at ${hex(addr)} there is ${w.value | 0} (${hex(w.value)}), expected ${exp | 0} (${hex(exp)}).`);
  }
  return res(true, `${what.it}: ${hex(addr)} = ${w.value | 0}. Corretto!`, `${what.en}: ${hex(addr)} = ${w.value | 0}. Correct!`);
}

/** sequenza di word consecutive */
function checkWords(m: Machine, addr: number, expected: number[], what: Txt): CheckResult {
  for (let i = 0; i < expected.length; i++) {
    const a = addr + 4 * i;
    const w = m.bus.peekWord(a);
    if (!w.init || w.value !== expected[i] >>> 0) {
      const found = w.init ? `${w.value | 0}` : 'non scritto';
      const foundEn = w.init ? `${w.value | 0}` : 'not written';
      return res(false,
        `${what.it}: l'elemento ${i} (indirizzo ${hex(a)}) vale ${found}, atteso ${expected[i]}.`,
        `${what.en}: element ${i} (address ${hex(a)}) is ${foundEn}, expected ${expected[i]}.`);
    }
  }
  return res(true, `${what.it}: ${expected.length} word corrette a partire da ${hex(addr)}.`, `${what.en}: ${expected.length} correct words from ${hex(addr)}.`);
}

function checkBytes(m: Machine, addr: number, expected: number[], what: Txt): CheckResult {
  for (let i = 0; i < expected.length; i++) {
    const b = m.bus.peek(addr + i);
    if (!b.init || b.value !== expected[i]) {
      return res(false,
        `${what.it}: il byte ${i} (indirizzo ${hex(addr + i)}) è ${b.init ? hex(b.value, 2) : 'non scritto'}, atteso ${hex(expected[i], 2)} ('${String.fromCharCode(expected[i])}').`,
        `${what.en}: byte ${i} (address ${hex(addr + i)}) is ${b.init ? hex(b.value, 2) : 'not written'}, expected ${hex(expected[i], 2)}.`);
    }
  }
  return res(true, `${what.it}: ${expected.length} byte corretti a partire da ${hex(addr)}.`, `${what.en}: ${expected.length} correct bytes from ${hex(addr)}.`);
}

const checkHalt = (m: Machine): CheckResult =>
  res(m.cpu.halted, m.cpu.halted ? 'Il programma termina con HALT.' : 'Il programma deve terminare con HALT (ora è ancora in esecuzione o si è fermato per un errore).',
    m.cpu.halted ? 'The program ends with HALT.' : 'The program must end with HALT (it is still running or stopped on an error).');

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

/** Fornisce dei byte alla porta di input (vengono accodati: la porta li presenta uno alla volta). */
function feedInput(m: Machine, values: number[], id = 'in') {
  const d = dev<InputDevice>(m, id);
  for (const v of values) d.provide(v);
}

/** Smistamento comune a tutti gli handler di esercizi: R20/R21 sono "liberi" (come nei testi d'esame). */
const DISPATCH = `        LHI  R20,0xC000         ; base STARTUP
        LW   R21,0(R20)         ; CS_READ_STARTUP: 1 = RESET, 0 = interrupt
        BEQZ R21,handler`;

// ------------------------------------------------------------------
// Dati
// ------------------------------------------------------------------

const SOMMA_DATA = [5, -3, 12, 7, 0, 20, -8, 1];
const MAX_DATA = [7, -2, 15, -30, 4, 99, -100, 42, 98, 3];
const PARI_DATA = [3, 8, 15, 22, 7, 10, 41, -64, 5, 0, 18, -9];
const ABS_DATA = [-5, 12, -300, 0, 7, -1];
const STRINGA = 'Ciao, DLX!';
const ECO_IN = 'Ciao dlx 2024!';
const ECO_OUT = 'CIAO DLX 2024!';
const PARI_CHARS = ascii('ABCDEFGH'); // B, D, F, H sono pari: 4 pari
const BYTES_2016 = [10, 200, 100, 129, 50, 255];

// ------------------------------------------------------------------
// Esercizi
// ------------------------------------------------------------------

export const EXERCISES: Exercise[] = [
  // ============================ 1 ============================
  {
    id: 'costante-32bit',
    title: txt('Una costante a 32 bit in memoria', 'A 32-bit constant in memory'),
    difficulty: 1,
    statement: txt(
      `Scrivi un programma che memorizza la word **0xCAFEBABE** all'indirizzo **0xE0000000** (RAM_H) e poi termina con HALT.

Ricorda che un immediato ha solo 16 bit: servono due istruzioni per costruire la costante e una per costruire l'indirizzo.`,
      `Write a program that stores the word **0xCAFEBABE** at address **0xE0000000** (RAM_H) and then ends with HALT.

Remember that an immediate has only 16 bits: you need two instructions to build the constant and one to build the address.`,
    ),
    starter: `; Scrivi 0xCAFEBABE all'indirizzo 0xE0000000, poi HALT.
        ; 1) costruisci la costante in un registro
        ; 2) costruisci l'indirizzo in un altro registro
        ; 3) SW
        HALT
`,
    hints: [
      txt('LHI Rd,imm16 mette imm16 nei 16 bit alti di Rd e zeri in quelli bassi. Per i 16 bit bassi serve un\'altra istruzione.', 'LHI Rd,imm16 puts imm16 in the high 16 bits of Rd and zeros below. The low 16 bits need another instruction.'),
      txt('ORI estende l\'immediato SENZA segno: LHI R1,0xCAFE seguita da ORI R1,R1,0xBABE dà 0xCAFEBABE. ADDI no: 0xBABE verrebbe esteso con segno!', 'ORI zero-extends the immediate: LHI R1,0xCAFE then ORI R1,R1,0xBABE gives 0xCAFEBABE. ADDI would not: 0xBABE would be sign-extended!'),
      txt('L\'indirizzo 0xE0000000 si ottiene con LHI R2,0xE000; poi SW R1,0(R2).', 'Address 0xE0000000 comes from LHI R2,0xE000; then SW R1,0(R2).'),
    ],
    solution: `        LHI  R1,0xCAFE          ; R1 = 0xCAFE0000
        ORI  R1,R1,0xBABE       ; R1 = 0xCAFEBABE
        LHI  R2,0xE000          ; R2 = 0xE0000000
        SW   R1,0(R2)
        HALT
`,
    check: (m) => [checkWord(m, 0xe0000000, 0xcafebabe, txt('Costante in memoria', 'Constant in memory')), checkHalt(m)],
  },

  // ============================ 2 ============================
  {
    id: 'somma-8-word',
    title: txt('Somma delle prime 8 word', 'Sum of the first 8 words'),
    difficulty: 1,
    statement: txt(
      `In RAM, a partire da **0x40000000** (etichetta \`vettore\`), ci sono 8 word con segno. Calcola la loro somma e memorizzala (una word) all'indirizzo **0xE0000200**. Termina con HALT.

È la versione "da esame" dell'esempio delle slide: indirizzamento indiretto (registro + offset) e un ciclo.`,
      `In RAM, starting at **0x40000000** (label \`vettore\`), there are 8 signed words. Compute their sum and store it (one word) at address **0xE0000200**. End with HALT.

This is the exam-style version of the slides' example: indirect addressing (register + offset) and a loop.`,
    ),
    starter: `; Somma degli 8 elementi di "vettore", risultato a 0xE0000200.
        ; TODO: puntatore al vettore, accumulatore, ciclo, SW del risultato
        HALT

        .data
vettore: .word 5, -3, 12, 7, 0, 20, -8, 1
`,
    hints: [
      txt('Per avere l\'indirizzo di "vettore" in un registro: LHI R5,hi(vettore) e ORI R5,R5,lo(vettore).', 'To get the address of "vettore" in a register: LHI R5,hi(vettore) and ORI R5,R5,lo(vettore).'),
      txt('Usa un registro come contatore di byte (8 word = 32 byte) che scende di 4 a ogni giro: ADD R8,R5,R2 dà l\'indirizzo dell\'elemento.', 'Use a register as a byte counter (8 words = 32 bytes) decreasing by 4 each iteration: ADD R8,R5,R2 gives the element address.'),
      txt('Il ciclo finisce quando il contatore vale 0: BNEZ R2,Loop.', 'The loop ends when the counter is 0: BNEZ R2,Loop.'),
    ],
    solution: `        LHI  R5,hi(vettore)
        ORI  R5,R5,lo(vettore)  ; R5 = indirizzo del vettore
        ADD  R1,R0,R0           ; accumulatore
        ADDI R2,R0,32           ; byte rimasti
Loop:   SUBI R2,R2,4
        ADD  R8,R5,R2
        LW   R3,0(R8)
        ADD  R1,R1,R3
        BNEZ R2,Loop
        LHI  R7,0xE000
        SW   R1,0x0200(R7)
        HALT

        .data
vettore: .word 5, -3, 12, 7, 0, 20, -8, 1
`,
    check: (m) => [checkWord(m, 0xe0000200, sum(SOMMA_DATA), txt('Somma', 'Sum')), checkHalt(m)],
  },

  // ============================ 3 ============================
  {
    id: 'massimo-array',
    title: txt('Massimo di un array (con segno)', 'Maximum of an array (signed)'),
    difficulty: 2,
    statement: txt(
      `Il vettore \`vettore\` (RAM, 0x40000000) contiene 10 word **con segno**. Trova il massimo e scrivilo a **0xE0000100**. Termina con HALT.

Attenzione ai numeri negativi: -2 è maggiore di -30, ma come numero senza segno 0xFFFFFFFE è enorme!`,
      `The vector \`vettore\` (RAM, 0x40000000) holds 10 **signed** words. Find the maximum and write it at **0xE0000100**. End with HALT.

Careful with negative numbers: -2 is greater than -30, but as an unsigned number 0xFFFFFFFE is huge!`,
    ),
    starter: `; Massimo di 10 word con segno, risultato a 0xE0000100.
        HALT

        .data
vettore: .word 7, -2, 15, -30, 4, 99, -100, 42, 98, 3
`,
    hints: [
      txt('Parti con max = primo elemento, poi confronta gli altri 9 uno a uno.', 'Start with max = first element, then compare the other 9 one by one.'),
      txt('SGT Rd,Rs1,Rs2 (con segno) mette Rd = 1 se Rs1 > Rs2. Poi BEQZ salta il "nuovo massimo" se il confronto è falso.', 'SGT Rd,Rs1,Rs2 (signed) sets Rd = 1 if Rs1 > Rs2. Then BEQZ skips the "new max" if the compare is false.'),
      txt('Non usare SGTU/SLTU: confrontano senza segno e sbagliano con i negativi.', 'Do not use SGTU/SLTU: they compare unsigned and fail with negatives.'),
    ],
    solution: `        LHI  R1,hi(vettore)
        ORI  R1,R1,lo(vettore)
        LW   R2,0(R1)           ; max = primo elemento
        ADDI R3,R0,4            ; offset del prossimo elemento
Loop:   ADD  R4,R1,R3
        LW   R5,0(R4)
        SGT  R6,R5,R2           ; elemento > max ?
        BEQZ R6,Avanti
        ADD  R2,R5,R0           ; nuovo massimo
Avanti: ADDI R3,R3,4
        SNEI R6,R3,40           ; finché offset ≠ 40 (10 word)
        BNEZ R6,Loop
        LHI  R7,0xE000
        SW   R2,0x0100(R7)
        HALT

        .data
vettore: .word 7, -2, 15, -30, 4, 99, -100, 42, 98, 3
`,
    check: (m) => [checkWord(m, 0xe0000100, Math.max(...MAX_DATA), txt('Massimo', 'Maximum')), checkHalt(m)],
  },

  // ============================ 4 ============================
  {
    id: 'conta-pari',
    title: txt('Conta i numeri pari', 'Count the even numbers'),
    difficulty: 2,
    statement: txt(
      `Il vettore \`vettore\` (RAM, 0x40000000) contiene 12 word con segno. Conta quante sono **pari** (lo zero è pari, e anche i negativi possono esserlo) e scrivi il conteggio a **0xE0000200**. Termina con HALT.

Un numero è pari se il suo bit 0 vale 0.`,
      `The vector \`vettore\` (RAM, 0x40000000) holds 12 signed words. Count how many are **even** (zero is even, and negatives can be even too) and write the count at **0xE0000200**. End with HALT.

A number is even if its bit 0 is 0.`,
    ),
    starter: `; Conta i pari tra 12 word, risultato a 0xE0000200.
        HALT

        .data
vettore: .word 3, 8, 15, 22, 7, 10, 41, -64, 5, 0, 18, -9
`,
    hints: [
      txt('ANDI Rd,Rs,1 isola il bit 0: vale 0 se il numero è pari.', 'ANDI Rd,Rs,1 isolates bit 0: it is 0 if the number is even.'),
      txt('BNEZ sul risultato dell\'AND salta il "conteggio" quando il numero è dispari.', 'BNEZ on the AND result skips the "count" when the number is odd.'),
    ],
    solution: `        LHI  R1,hi(vettore)
        ORI  R1,R1,lo(vettore)
        XOR  R2,R2,R2           ; contatore dei pari
        ADDI R3,R0,48           ; byte rimasti (12 word)
Loop:   SUBI R3,R3,4
        ADD  R4,R1,R3
        LW   R5,0(R4)
        ANDI R6,R5,1            ; bit 0
        BNEZ R6,Dispari
        ADDI R2,R2,1            ; era pari
Dispari: BNEZ R3,Loop
        LHI  R7,0xE000
        SW   R2,0x0200(R7)
        HALT

        .data
vettore: .word 3, 8, 15, 22, 7, 10, 41, -64, 5, 0, 18, -9
`,
    check: (m) => [checkWord(m, 0xe0000200, PARI_DATA.filter((x) => x % 2 === 0).length, txt('Numero di pari', 'Number of even values')), checkHalt(m)],
  },

  // ============================ 5 ============================
  {
    id: 'quadrati',
    title: txt('I quadrati senza moltiplicare', 'Squares without multiplying'),
    difficulty: 2,
    statement: txt(
      `Il DLX non ha una moltiplicazione. Scrivi a partire da **0xE0000800** le 8 word 0, 1, 4, 9, 16, 25, 36, 49 (i quadrati di 0..7) senza usare tabelle: calcolale con somme. Termina con HALT.`,
      `The DLX has no multiply instruction. Starting at **0xE0000800** write the 8 words 0, 1, 4, 9, 16, 25, 36, 49 (squares of 0..7) without tables: compute them with additions. End with HALT.`,
    ),
    starter: `; Quadrati di 0..7 a partire da 0xE0000800.
        HALT
`,
    hints: [
      txt('(n+1)² = n² + 2n + 1: dal quadrato corrente si ottiene il successivo sommando un numero dispari.', '(n+1)² = n² + 2n + 1: the next square is the current one plus an odd number.'),
      txt('2n si ottiene con SLLI Rd,Rn,1 (shift a sinistra di 1).', '2n comes from SLLI Rd,Rn,1 (shift left by 1).'),
      txt('Come nell\'esempio "Riempire un array": SW R3,0x0800(R1) con R1 che avanza di 4.', 'As in the "Fill an array" example: SW R3,0x0800(R1) with R1 advancing by 4.'),
    ],
    solution: `        LHI  R1,0xE000          ; puntatore
        XOR  R2,R2,R2           ; n = 0
        XOR  R3,R3,R3           ; q = n² = 0
Loop:   SW   R3,0x0800(R1)
        ADDI R1,R1,4
        SLLI R4,R2,1            ; 2n
        ADDI R4,R4,1            ; 2n + 1
        ADD  R3,R3,R4           ; (n+1)² = n² + 2n + 1
        ADDI R2,R2,1
        SNEI R5,R2,8
        BNEZ R5,Loop
        HALT
`,
    check: (m) => [checkWords(m, 0xe0000800, [0, 1, 4, 9, 16, 25, 36, 49], txt('Quadrati', 'Squares')), checkHalt(m)],
  },

  // ============================ 6 ============================
  {
    id: 'copia-stringa',
    title: txt('Copia di una stringa', 'Copy a string'),
    difficulty: 2,
    statement: txt(
      `In RAM (0x40000000, etichetta \`sorgente\`) c'è la stringa "${STRINGA}" terminata da uno 0 (.asciiz). Copiala, **terminatore compreso**, a partire da **0xE0000300**. Termina con HALT.

Lavora a byte: LBU e SB.`,
      `In RAM (0x40000000, label \`sorgente\`) there is the string "${STRINGA}" ended by a 0 (.asciiz). Copy it, **terminator included**, starting at **0xE0000300**. End with HALT.

Work with bytes: LBU and SB.`,
    ),
    starter: `; Copia la stringa "sorgente" (compreso lo 0 finale) a partire da 0xE0000300.
        HALT

        .data
sorgente: .asciiz "${STRINGA}"
`,
    hints: [
      txt('Usa due puntatori: uno per la sorgente e uno per la destinazione. Entrambi avanzano di 1 (byte!) a ogni giro.', 'Use two pointers: one for the source, one for the destination. Both advance by 1 (a byte!) each iteration.'),
      txt('Scrivi il byte PRIMA di controllare se è 0: così copi anche il terminatore. Il BNEZ va dopo la SB e gli incrementi.', 'Write the byte BEFORE testing for 0: that way the terminator is copied too. Put BNEZ after SB and the increments.'),
    ],
    solution: `        LHI  R1,hi(sorgente)
        ORI  R1,R1,lo(sorgente)
        LHI  R2,0xE000
        ORI  R2,R2,0x0300       ; destinazione
Loop:   LBU  R3,0(R1)
        SB   R3,0(R2)
        ADDI R1,R1,1
        ADDI R2,R2,1
        BNEZ R3,Loop            ; si ferma DOPO aver copiato lo 0
        HALT

        .data
sorgente: .asciiz "${STRINGA}"
`,
    check: (m) => [checkBytes(m, 0xe0000300, [...ascii(STRINGA), 0], txt('Stringa copiata', 'Copied string')), checkHalt(m)],
  },

  // ============================ 7 ============================
  {
    id: 'procedura-abs',
    title: txt('Procedura valore assoluto', 'Absolute-value procedure'),
    difficulty: 2,
    statement: txt(
      `Il vettore \`vettore\` (RAM, 0x40000000) contiene 6 word con segno. Sostituisci **in place** ogni elemento con il suo valore assoluto.

Il calcolo del valore assoluto deve stare in una **procedura** \`abs\` chiamata con **JAL** (argomento in R4, risultato in R5) che torna con **JR R31**. Termina con HALT.`,
      `The vector \`vettore\` (RAM, 0x40000000) holds 6 signed words. Replace **in place** each element with its absolute value.

The absolute-value computation must be in a **procedure** \`abs\` called with **JAL** (argument in R4, result in R5) returning with **JR R31**. End with HALT.`,
    ),
    starter: `; Valore assoluto in place di 6 word, con una procedura abs (JAL / JR R31).
        HALT

abs:    ; R4 = argomento, R5 = risultato
        JR   R31

        .data
vettore: .word -5, 12, -300, 0, 7, -1
`,
    hints: [
      txt('Nel ciclo: carica l\'elemento in R4, JAL abs, poi SW R5 nello stesso indirizzo.', 'In the loop: load the element into R4, JAL abs, then SW R5 to the same address.'),
      txt('abs: R5 ← R4; se R4 < 0 (SLTI R6,R4,0 e BEQZ) allora R5 ← 0 - R4 con SUB R5,R0,R4.', 'abs: R5 ← R4; if R4 < 0 (SLTI R6,R4,0 and BEQZ) then R5 ← 0 - R4 using SUB R5,R0,R4.'),
      txt('La procedura non deve toccare i registri del ciclo (puntatore e contatore): usa solo R4, R5, R6.', 'The procedure must not touch the loop registers (pointer and counter): use only R4, R5, R6.'),
    ],
    solution: `        LHI  R1,hi(vettore)
        ORI  R1,R1,lo(vettore)
        ADDI R2,R0,24           ; byte rimasti (6 word)
Loop:   SUBI R2,R2,4
        ADD  R3,R1,R2           ; indirizzo elemento
        LW   R4,0(R3)           ; argomento
        JAL  abs                ; R5 ← |R4|
        SW   R5,0(R3)
        BNEZ R2,Loop
        HALT

abs:    ADD  R5,R4,R0
        SLTI R6,R4,0            ; R4 < 0 ?
        BEQZ R6,fine
        SUB  R5,R0,R4           ; R5 ← -R4
fine:   JR   R31

        .data
vettore: .word -5, 12, -300, 0, 7, -1
`,
    check: (m) => [
      checkWords(m, 0x40000000, ABS_DATA.map(Math.abs), txt('Vettore in valore assoluto', 'Vector in absolute value')),
      res(m.trace.some((r) => r.decoded.def.mn === 'JAL') && m.trace.some((r) => r.decoded.def.mn === 'JR' && r.decoded.rs1 === 31),
        'Hai usato JAL e JR R31 (la procedura).', 'You used JAL and JR R31 (the procedure).'),
      checkHalt(m),
    ],
  },

  // ============================ 8 ============================
  {
    id: 'led-startup',
    title: txt('LED e STARTUP: la sequenza di avvio', 'LED and STARTUP: the boot sequence'),
    difficulty: 2,
    statement: txt(
      `Dalle slide (03). Dopo il RESET scrivi un programma che:

- porta il segnale **STARTUP** a 0 (CS_WRITE_STARTUP = 0xC0000004);
- inverte il **LED** esattamente **5 volte** con CS_SWITCH_LED (0x90000004);
- legge lo stato del LED (CS_READ_LED = 0x90000000) e lo scrive a **0xE0000000**;
- termina con HALT.

Alla fine il LED è acceso e a 0xE0000000 c'è 1.`,
      `From the slides (03). After RESET write a program that:

- sets the **STARTUP** signal to 0 (CS_WRITE_STARTUP = 0xC0000004);
- toggles the **LED** exactly **5 times** using CS_SWITCH_LED (0x90000004);
- reads the LED state (CS_READ_LED = 0x90000000) and writes it to **0xE0000000**;
- ends with HALT.

At the end the LED is on and 0xE0000000 holds 1.`,
    ),
    starter: `; Sequenza di avvio con STARTUP e LED.
        HALT
`,
    hints: [
      txt('Gli indirizzi delle periferiche sono troppo alti per un offset a 16 bit: costruisci la base con LHI (es. LHI R1,0x9000).', 'Peripheral addresses are too high for a 16-bit offset: build the base with LHI (e.g. LHI R1,0x9000).'),
      txt('Il dato scritto a CS_SWITCH_LED non conta: SW R0,4(R1) va bene.', 'The data written to CS_SWITCH_LED does not matter: SW R0,4(R1) is fine.'),
      txt('Per ripetere 5 volte usa un contatore con SUBI + BNEZ.', 'To repeat 5 times use a counter with SUBI + BNEZ.'),
    ],
    solution: `        LHI  R1,0x9000          ; base LED
        LHI  R2,0xC000          ; base STARTUP
        LHI  R7,0xE000
        SW   R0,4(R2)           ; STARTUP ← 0
        ADDI R4,R0,5
Loop:   SW   R0,4(R1)           ; CS_SWITCH_LED
        SUBI R4,R4,1
        BNEZ R4,Loop
        LW   R5,0(R1)           ; CS_READ_LED
        SW   R5,0(R7)
        HALT
`,
    check: (m) => {
      const toggles = m.trace.filter((r) => r.mem.some((a) => a.kind === 'write' && a.cs === 'CS_SWITCH_LED')).length;
      const led = dev<LedDevice>(m, 'led');
      const st = dev<StartupDevice>(m, 'startup');
      return [
        res(!st.value, st.value ? 'STARTUP vale ancora 1: scrivi 0 a CS_WRITE_STARTUP (0xC0000004).' : 'STARTUP = 0.', st.value ? 'STARTUP is still 1: write 0 to CS_WRITE_STARTUP (0xC0000004).' : 'STARTUP = 0.'),
        res(toggles === 5, `Inversioni del LED con CS_SWITCH_LED: ${toggles} (devono essere 5).`, `LED toggles through CS_SWITCH_LED: ${toggles} (must be 5).`),
        res(led.on, led.on ? 'Il LED è acceso.' : 'Il LED è spento.', led.on ? 'The LED is on.' : 'The LED is off.'),
        checkWord(m, 0xe0000000, 1, txt('Stato del LED letto e salvato', 'LED state read and saved')),
        checkHalt(m),
      ];
    },
  },

  // ============================ 9 ============================
  {
    id: 'interrupt-pulsante',
    title: txt('Il pulsante accende il LED', 'The button turns the LED on'),
    difficulty: 3,
    statement: txt(
      `Il sistema ha un **pulsante** (BTN, 0xD0000000) con flip-flop da fronte a livello: quando viene premuto, INT vale 1 finché il software non scrive a **CS_RESET_INT_BTN (0xD0000004)**. Il pulsante viene premuto una volta durante l'avvio.

Scrivi:
- il codice a 0x0 che distingue RESET da interrupt leggendo STARTUP;
- all'avvio: STARTUP ← 0 e poi un ciclo infinito di attesa (\`attesa: J attesa\`);
- l'interrupt handler: azzera il flip-flop, **inverte il LED** (CS_SWITCH_LED = 0x90000004) e torna con RFE.

Puoi usare R20..R25 senza ripristinarli. Il programma termina quando il simulatore raggiunge il limite di passi: alla fine il LED deve essere acceso, il pulsante servito e l'handler eseguito **una sola volta** (se dimentichi di azzerare il flip-flop l'handler riparte all'infinito!).`,
      `The system has a **button** (BTN, 0xD0000000) with an edge-to-level flip-flop: when pressed, INT is 1 until software writes to **CS_RESET_INT_BTN (0xD0000004)**. The button is pressed once during boot.

Write:
- the code at 0x0 that tells RESET from interrupt by reading STARTUP;
- at boot: STARTUP ← 0, then an infinite wait loop (\`attesa: J attesa\`);
- the interrupt handler: clear the flip-flop, **toggle the LED** (CS_SWITCH_LED = 0x90000004) and return with RFE.

You may use R20..R25 without restoring them. The run ends when the simulator reaches its step limit: at the end the LED must be on, the button served and the handler executed **only once** (if you forget to clear the flip-flop the handler restarts forever!).`,
    ),
    map: MAP_BUTTON,
    maxSteps: 1000,
    setup: (m) => dev<ButtonDevice>(m, 'btn').press(),
    starter: `; Pulsante → interrupt → LED
; Indirizzo 0: RESET o interrupt?
        LHI  R20,0xC000
        LW   R21,0(R20)         ; STARTUP
        ; TODO: se STARTUP = 0 salta a handler
        ; TODO: avvio: STARTUP ← 0
attesa: J    attesa

handler:
        ; TODO: azzera il flip-flop del pulsante
        ; TODO: inverti il LED
        RFE
`,
    hints: [
      txt('BEQZ R21,handler salta quando STARTUP = 0 (cioè è un interrupt).', 'BEQZ R21,handler branches when STARTUP = 0 (i.e. it is an interrupt).'),
      txt('Finché STARTUP vale 1 le interruzioni sono disabilitate: scrivere 0 a CS_WRITE_STARTUP (SW R0,4(R20)) le abilita.', 'While STARTUP is 1 interrupts are disabled: writing 0 to CS_WRITE_STARTUP (SW R0,4(R20)) enables them.'),
      txt('Qualsiasi scrittura a CS_RESET_INT_BTN azzera il flip-flop: SW R0,4(R22) con R22 = 0xD0000000.', 'Any write to CS_RESET_INT_BTN clears the flip-flop: SW R0,4(R22) with R22 = 0xD0000000.'),
    ],
    solution: `${DISPATCH}
        SW   R0,4(R20)          ; STARTUP ← 0: abilita gli interrupt
attesa: J    attesa

handler:
        LHI  R22,0xD000         ; base BTN
        SW   R0,4(R22)          ; CS_RESET_INT_BTN: INT torna a 0
        LHI  R22,0x9000         ; base LED
        SW   R0,4(R22)          ; CS_SWITCH_LED
        RFE
`,
    check: (m) => {
      const led = dev<LedDevice>(m, 'led');
      const btn = dev<ButtonDevice>(m, 'btn');
      const st = dev<StartupDevice>(m, 'startup');
      const ints = m.trace.filter((r) => r.interrupt).length;
      return [
        res(!st.value, st.value ? 'STARTUP vale ancora 1: le interruzioni non sono mai state abilitate.' : 'STARTUP = 0: interruzioni abilitate.', st.value ? 'STARTUP is still 1: interrupts were never enabled.' : 'STARTUP = 0: interrupts enabled.'),
        res(ints === 1, `Interrupt serviti: ${ints} (deve essere 1).`, `Interrupts served: ${ints} (must be 1).`),
        res(!btn.ff, btn.ff ? 'Il flip-flop del pulsante è ancora a 1: scrivi a CS_RESET_INT_BTN.' : 'Flip-flop del pulsante azzerato.', btn.ff ? 'The button flip-flop is still 1: write to CS_RESET_INT_BTN.' : 'Button flip-flop cleared.'),
        res(led.on, led.on ? 'Il LED è acceso.' : 'Il LED è spento: l\'handler deve invertirlo una volta.', led.on ? 'The LED is on.' : 'The LED is off: the handler must toggle it once.'),
      ];
    },
  },

  // ============================ 10 ============================
  {
    id: 'eco-maiuscolo',
    title: txt('Eco in maiuscolo', 'Uppercase echo'),
    difficulty: 3,
    statement: txt(
      `Una porta **INPUT** (0x80000000, 8 bit) genera un interrupt a ogni carattere ricevuto; la porta **OUTPUT** (0xA0000000) mostra i caratteri scritti.

L'interrupt handler deve leggere il carattere (CS_INPUT, che azzera anche la richiesta), **convertire le lettere minuscole in maiuscole** (lascia invariati tutti gli altri caratteri) e scriverlo sulla porta OUTPUT (SB).

Come negli esami puoi usare R20..R25 senza ripristinarli. Nel main basta un ciclo infinito dopo aver portato STARTUP a 0.

*Suggerimento ASCII:* 'a' = 97, 'z' = 122 e la differenza tra minuscola e maiuscola è 32. I caratteri di prova sono "${ECO_IN}".`,
      `An **INPUT** port (0x80000000, 8 bit) raises an interrupt for each received character; the **OUTPUT** port (0xA0000000) displays the written characters.

The interrupt handler must read the character (CS_INPUT, which also clears the request), **convert lowercase letters to uppercase** (leave every other character unchanged) and write it to the OUTPUT port (SB).

As in the exams you may use R20..R25 without restoring them. The main program just needs an infinite loop after setting STARTUP to 0.

*ASCII hint:* 'a' = 97, 'z' = 122 and the difference between lowercase and uppercase is 32. The test characters are "${ECO_IN}".`,
    ),
    map: MAP_INPUT_OUTPUT,
    maxSteps: 3000,
    setup: (m) => feedInput(m, ascii(ECO_IN)),
    starter: `; Eco in maiuscolo: INPUT (0x80000000) → OUTPUT (0xA0000000)
${DISPATCH}
        ; TODO: avvio: STARTUP ← 0
fine:   J    fine

handler:
        ; TODO: leggi il carattere, rendilo maiuscolo se è tra 'a' e 'z', scrivilo su OUTPUT
        RFE
`,
    hints: [
      txt('SLTI R24,R23,97 vale 1 se il carattere è < \'a\'; SGTI R24,R23,122 vale 1 se è > \'z\'. In entrambi i casi niente conversione.', 'SLTI R24,R23,97 is 1 if the character is < \'a\'; SGTI R24,R23,122 is 1 if it is > \'z\'. In both cases do not convert.'),
      txt('La conversione è SUBI R23,R23,32.', 'The conversion is SUBI R23,R23,32.'),
      txt('Per scrivere: LHI R22,0xA000 e SB R23,0(R22). Non dimenticare RFE.', 'To write: LHI R22,0xA000 and SB R23,0(R22). Do not forget RFE.'),
    ],
    solution: `${DISPATCH}
        SW   R0,4(R20)          ; STARTUP ← 0
fine:   J    fine

handler:
        LHI  R22,0x8000         ; base INPUT
        LW   R23,0(R22)         ; carattere (e azzera INT)
        SLTI R24,R23,97         ; < 'a' ?
        BNEZ R24,scrivi
        SGTI R24,R23,122        ; > 'z' ?
        BNEZ R24,scrivi
        SUBI R23,R23,32         ; minuscola → maiuscola
scrivi: LHI  R22,0xA000         ; base OUTPUT
        SB   R23,0(R22)
        RFE
`,
    check: (m) => {
      const out = dev<OutputDevice>(m, 'out');
      const got = out.log.map((c) => String.fromCharCode(c)).join('');
      const ok = got === ECO_OUT;
      return [
        res(ok, ok ? `OUTPUT mostra "${got}". Corretto!` : `OUTPUT mostra "${got}", ma doveva mostrare "${ECO_OUT}".`, ok ? `OUTPUT shows "${got}". Correct!` : `OUTPUT shows "${got}", expected "${ECO_OUT}".`),
      ];
    },
  },

  // ============================ 11 ============================
  {
    id: 'esame-2020-09-01',
    title: txt('Esame 1/9/2020: pari, contatore e LED', 'Exam 1 Sep 2020: even values, counter and LED'),
    difficulty: 3,
    statement: txt(
      `*Ispirato all'esame del 1 settembre 2020 (Calcolatori Elettronici T).* Nel testo originale una rete logica da progettare conta i caratteri **pari** letti da una porta in INPUT a 8 bit e, dopo 1024 caratteri pari, genera un interrupt che inverte un LED inizialmente spento; i dati letti vanno memorizzati a FFFF1000h.

**Adattamento al simulatore.** La rete di conteggio è il dispositivo **COUNTER** (0xB0000000): incrementa a ogni scrittura in CS_INC_COUNTER (0xB0000004), alla soglia genera INT e si azzera con CS_RESET_COUNTER (0xB0000008). Il simulatore non sa riconoscere i caratteri pari: lo fa il **software** (bit 0). Per poter provare, la soglia è **4** invece di 1024. Anche la porta INPUT (0x80000000) genera INT: l'handler deve capire *chi* ha chiesto l'interrupt leggendo CS_STATUS_INPUT (0x80000004: 1 = c'è un dato).

L'handler deve:
- se c'è un dato: leggerlo (CS_INPUT), memorizzarlo (byte) a **0xFFFF1000**; se è pari incrementare il contatore;
- altrimenti (interrupt dal contatore): azzerare il contatore e **invertire il LED** (CS_SWITCH_LED);
- tornare con RFE.

Puoi usare R20..R25 senza ripristinarli. Il test invia "ABCDEFGH": i caratteri pari (B, D, F, H) sono 4, quindi alla fine il LED deve essere acceso (una sola inversione) e il contatore azzerato.`,
      `*Inspired by the exam of 1 September 2020 (Calcolatori Elettronici T).* In the original text a logic network to be designed counts the **even** characters read from an 8-bit INPUT port and, after 1024 even characters, raises an interrupt that toggles a LED (initially off); data read must be stored at FFFF1000h.

**Adaptation to the simulator.** The counting network is the **COUNTER** device (0xB0000000): it increments on each write to CS_INC_COUNTER (0xB0000004), raises INT at the threshold and is cleared by CS_RESET_COUNTER (0xB0000008). The simulator cannot recognize even characters: **software** does it (bit 0). To make testing practical the threshold is **4** instead of 1024. The INPUT port (0x80000000) also raises INT: the handler must tell *who* asked for the interrupt by reading CS_STATUS_INPUT (0x80000004: 1 = data available).

The handler must:
- if data is available: read it (CS_INPUT), store it (byte) at **0xFFFF1000**; if it is even, increment the counter;
- otherwise (interrupt from the counter): clear the counter and **toggle the LED** (CS_SWITCH_LED);
- return with RFE.

You may use R20..R25 without restoring them. The test sends "ABCDEFGH": the even characters (B, D, F, H) are 4, so at the end the LED must be on (a single toggle) and the counter cleared.`,
    ),
    map: MAP_INPUT_COUNTER,
    maxSteps: 2000,
    setup: (m) => feedInput(m, PARI_CHARS),
    starter: `; Esame 1/9/2020 (adattato): caratteri pari → contatore → LED
${DISPATCH}
        ; TODO: avvio: STARTUP ← 0
fine:   J    fine

handler:
        ; TODO: CS_STATUS_INPUT (0x80000004): c'è un dato?
        ;   sì: leggi CS_INPUT, SB a 0xFFFF1000, se pari CS_INC_COUNTER
        ;   no: CS_RESET_COUNTER e CS_SWITCH_LED
        RFE
`,
    hints: [
      txt('Due sorgenti, un solo INT: all\'inizio dell\'handler leggi CS_STATUS_INPUT (LW R23,4(R22) con R22 = 0x80000000).', 'Two sources, one INT: at the start of the handler read CS_STATUS_INPUT (LW R23,4(R22) with R22 = 0x80000000).'),
      txt('0xFFFF1000 = LHI R24,0xFFFF poi offset 0x1000: SB R23,0x1000(R24).', '0xFFFF1000 = LHI R24,0xFFFF then offset 0x1000: SB R23,0x1000(R24).'),
      txt('Pari: ANDI R25,R23,1 e BNEZ salta l\'incremento. L\'incremento è una scrittura qualsiasi a 0xB0000004.', 'Even: ANDI R25,R23,1 and BNEZ skips the increment. The increment is any write to 0xB0000004.'),
      txt('Quando il contatore arriva a 4 mantiene INT a 1 finché non lo azzeri: al giro successivo non ci saranno dati in attesa e l\'handler va nel ramo "contatore".', 'When the counter reaches 4 it keeps INT at 1 until you clear it: on the next round there is no pending data and the handler takes the "counter" branch.'),
    ],
    solution: `${DISPATCH}
        SW   R0,4(R20)          ; STARTUP ← 0
fine:   J    fine

handler:
        LHI  R22,0x8000         ; base INPUT
        LW   R23,4(R22)         ; CS_STATUS_INPUT: dato pronto?
        BEQZ R23,scaduto        ; no → interrupt del contatore
        LW   R23,0(R22)         ; CS_INPUT: carattere (azzera la richiesta)
        LHI  R24,0xFFFF
        SB   R23,0x1000(R24)    ; memorizza a 0xFFFF1000
        ANDI R25,R23,1
        BNEZ R25,esci           ; dispari: niente da contare
        LHI  R24,0xB000         ; base COUNTER
        SW   R0,4(R24)          ; CS_INC_COUNTER
esci:   RFE
scaduto:
        LHI  R24,0xB000
        SW   R0,8(R24)          ; CS_RESET_COUNTER: azzera contatore e INT
        LHI  R24,0x9000
        SW   R0,4(R24)          ; CS_SWITCH_LED
        RFE
`,
    check: (m) => {
      const led = dev<LedDevice>(m, 'led');
      const cnt = dev<CounterDevice>(m, 'cnt');
      const last = PARI_CHARS[PARI_CHARS.length - 1];
      const b = m.bus.peek(0xffff1000);
      return [
        res(b.init && b.value === last, b.init ? `A 0xFFFF1000 c'è ${hex(b.value, 2)}, atteso l'ultimo carattere ${hex(last, 2)} ('${String.fromCharCode(last)}').` : 'Nulla scritto a 0xFFFF1000.', b.init ? `At 0xFFFF1000 there is ${hex(b.value, 2)}, expected the last character ${hex(last, 2)}.` : 'Nothing written at 0xFFFF1000.'),
        res(led.on, led.on ? 'Il LED è acceso (una inversione).' : 'Il LED è spento: dopo 4 caratteri pari doveva essere invertito una volta.', led.on ? 'The LED is on (one toggle).' : 'The LED is off: after 4 even characters it should have been toggled once.'),
        res(cnt.value === 0 && !cnt.reached, `Contatore = ${cnt.value}${cnt.reached ? ' con INT ancora attivo' : ''} (deve essere azzerato dopo l'interrupt).`, `Counter = ${cnt.value}${cnt.reached ? ' with INT still active' : ''} (must be cleared after the interrupt).`),
      ];
    },
  },

  // ============================ 12 ============================
  {
    id: 'esame-2016-07-07',
    title: txt('Esame 7/7/2016: somma dei byte < 128', 'Exam 7 Jul 2016: sum of bytes < 128'),
    difficulty: 3,
    statement: txt(
      `*Ispirato all'esame del 7 luglio 2016.* Nel testo originale una INPUT_PORT a 8 bit (dati senza segno) genera interrupt e l'handler scrive il dato a FFFF0000h; una rete logica da progettare somma al dato inviato su OUTPUT_PORT l'ultimo dato letto solo se è inferiore a 128.

**Adattamento.** Qui la "rete" è software. L'interrupt handler della porta **INPUT** (0x80000000) deve:
1. leggere il byte (senza segno) e scriverlo come **word** a **0xFFFF0000**;
2. mantenere a **0xFFFF0004** la **somma modulo 256 dei soli byte minori di 128** ricevuti finora (all'avvio vale 0: la RAM contiene valori casuali, quindi va inizializzata prima di abilitare gli interrupt!);
3. scrivere la somma corrente (word) sulla porta **OUTPUT** (0xA0000000) a ogni byte ricevuto;
4. tornare con RFE.

Puoi usare R20..R25 senza ripristinarli. Byte di prova: ${BYTES_2016.join(', ')}. Atteso: 0xFFFF0000 = 255, 0xFFFF0004 = 160 e sulla OUTPUT i valori 10, 10, 110, 110, 160, 160.`,
      `*Inspired by the exam of 7 July 2016.* In the original text an 8-bit INPUT_PORT (unsigned data) raises interrupts and the handler writes the datum at FFFF0000h; a logic network to be designed adds the last datum read to the value sent on OUTPUT_PORT only if it is below 128.

**Adaptation.** Here the "network" is software. The interrupt handler of the **INPUT** port (0x80000000) must:
1. read the (unsigned) byte and write it as a **word** at **0xFFFF0000**;
2. keep at **0xFFFF0004** the **sum modulo 256 of only the bytes below 128** received so far (it is 0 at boot: RAM holds random values, so initialize it before enabling interrupts!);
3. write the current sum (word) to the **OUTPUT** port (0xA0000000) for every received byte;
4. return with RFE.

You may use R20..R25 without restoring them. Test bytes: ${BYTES_2016.join(', ')}. Expected: 0xFFFF0000 = 255, 0xFFFF0004 = 160 and OUTPUT shows 10, 10, 110, 110, 160, 160.`,
    ),
    map: MAP_INPUT_OUTPUT,
    maxSteps: 3000,
    setup: (m) => feedInput(m, BYTES_2016),
    starter: `; Esame 7/7/2016 (adattato): somma modulo 256 dei byte < 128
${DISPATCH}
        ; TODO: avvio: somma a 0xFFFF0004 ← 0, poi STARTUP ← 0
fine:   J    fine

handler:
        ; TODO: leggi il byte, scrivilo a 0xFFFF0000, aggiorna la somma a 0xFFFF0004, scrivila su OUTPUT
        RFE
`,
    hints: [
      txt('Prima di SW R0,4(R20) (che abilita gli interrupt) azzera la somma: LHI R22,0xFFFF e SW R0,4(R22).', 'Before SW R0,4(R20) (which enables interrupts) clear the sum: LHI R22,0xFFFF and SW R0,4(R22).'),
      txt('SLTI R25,R23,128 vale 1 se il byte è < 128 (il byte è già senza segno: lo legge una LW dalla porta, valore 0..255).', 'SLTI R25,R23,128 is 1 if the byte is < 128 (it is already unsigned: an LW from the port returns 0..255).'),
      txt('Modulo 256: ANDI R25,R25,0xFF dopo la somma.', 'Modulo 256: ANDI R25,R25,0xFF after the sum.'),
      txt('Scrivi sulla OUTPUT sempre la somma corrente, anche se il byte era ≥ 128.', 'Always write the current sum to OUTPUT, even if the byte was ≥ 128.'),
    ],
    solution: `${DISPATCH}
        LHI  R22,0xFFFF
        SW   R0,4(R22)          ; somma = 0 (la RAM all'accensione è casuale!)
        SW   R0,4(R20)          ; STARTUP ← 0: abilita gli interrupt
fine:   J    fine

handler:
        LHI  R22,0x8000         ; base INPUT
        LW   R23,0(R22)         ; byte letto (0..255)
        LHI  R24,0xFFFF
        SW   R23,0(R24)         ; 0xFFFF0000 ← byte
        SLTI R25,R23,128        ; byte < 128 ?
        BEQZ R25,fuori          ; no: la somma non cambia
        LW   R25,4(R24)
        ADD  R25,R25,R23
        ANDI R25,R25,0xFF       ; modulo 256
        SW   R25,4(R24)
fuori:  LW   R25,4(R24)         ; somma corrente
        LHI  R22,0xA000         ; base OUTPUT
        SW   R25,0(R22)
        RFE
`,
    check: (m) => {
      const out = dev<OutputDevice>(m, 'out');
      const sums: number[] = [];
      let s = 0;
      for (const b of BYTES_2016) {
        if (b < 128) s = (s + b) & 0xff;
        sums.push(s);
      }
      const okOut = out.log.length === sums.length && out.log.every((v, i) => v === sums[i]);
      return [
        checkWord(m, 0xffff0000, BYTES_2016[BYTES_2016.length - 1], txt('Ultimo byte ricevuto', 'Last byte received')),
        checkWord(m, 0xffff0004, s, txt('Somma dei byte < 128 (mod 256)', 'Sum of bytes < 128 (mod 256)')),
        res(okOut, okOut ? 'OUTPUT ha ricevuto le somme corrette.' : `OUTPUT ha ricevuto [${out.log.join(', ')}], attesi [${sums.join(', ')}].`, okOut ? 'OUTPUT received the correct sums.' : `OUTPUT received [${out.log.join(', ')}], expected [${sums.join(', ')}].`),
      ];
    },
  },
];
