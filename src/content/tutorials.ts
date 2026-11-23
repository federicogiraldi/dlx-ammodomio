import { txt } from '../core/util';
import { EXAMPLES } from './examples';
import { MAP_BUTTON, MAP_INPUT_OUTPUT } from './maps';
import type { Tutorial } from './types';

const exampleCode = (id: string): string => {
  const e = EXAMPLES.find((x) => x.id === id);
  if (!e) throw new Error(`Esempio mancante: ${id}`);
  return e.code;
};

/**
 * Tutorial brevi (3-6 passi). Il testo usa markdown-lite:
 * paragrafi separati da riga vuota, **grassetto**, `codice`, elenchi con "- ".
 */
export const TUTORIALS: Tutorial[] = [
  // ================================================================
  // 1. Primo programma e interfaccia
  // ================================================================
  {
    id: 'primo-programma',
    title: txt('Il primo programma e l\'interfaccia', 'Your first program and the interface'),
    summary: txt(
      'Scrivi, esegui passo passo e "riavvolgi" un programma. Impara a leggere il pannello "Cosa è successo".',
      'Write, single-step and "rewind" a program. Learn to read the "What happened" panel.',
    ),
    steps: [
      {
        title: txt('Benvenuto', 'Welcome'),
        body: txt(
          `Questo simulatore esegue programmi in **assembly DLX**, il processore RISC usato nel corso di Calcolatori Elettronici T.

L'interfaccia ha quattro zone principali:
- l'**editor**, dove scrivi il programma (un'istruzione per riga, con eventuali etichette e commenti dopo il \`;\`);
- i **registri** R0..R31, PC e IAR;
- la **memoria** e le **periferiche** della mappa di indirizzamento;
- il pannello **"Cosa è successo"**, che racconta in italiano ogni istruzione eseguita.

Gli errori dell'assembler compaiono sotto l'editor con una spiegazione e, spesso, un suggerimento per correggerli.`,
          `This simulator runs **DLX assembly**, the RISC processor used in the Calcolatori Elettronici T course.

The interface has four main areas:
- the **editor**, where you write the program (one instruction per line, with optional labels and comments after \`;\`);
- the **registers** R0..R31, PC and IAR;
- the **memory** and the **peripherals** of the address map;
- the **"What happened"** panel, which narrates every executed instruction.

Assembler errors show up under the editor with an explanation and, often, a suggested fix.`,
        ),
      },
      {
        title: txt('Quattro istruzioni', 'Four instructions'),
        body: txt(
          `Ecco il primo programma. \`ADDI R1,R0,5\` significa **R1 ← R0 + 5**: poiché R0 vale sempre 0, è il modo standard per mettere una costante in un registro.

\`ADD R3,R1,R2\` somma due registri: **R3 ← R1 + R2**.

\`HALT\` ferma il processore.`,
          `Here is the first program. \`ADDI R1,R0,5\` means **R1 ← R0 + 5**: since R0 is always 0, this is the standard way to put a constant into a register.

\`ADD R3,R1,R2\` adds two registers: **R3 ← R1 + R2**.

\`HALT\` stops the processor.`,
        ),
        code: `        ADDI R1,R0,5        ; R1 ← 5
        ADDI R2,R0,7        ; R2 ← 7
        ADD  R3,R1,R2       ; R3 ← R1 + R2
        HALT
`,
        tryIt: txt('Premi **Step** una volta: il PC avanza di 4 e R1 diventa 5. Ripeti altre due volte e guarda R3.', 'Press **Step** once: PC advances by 4 and R1 becomes 5. Repeat twice more and watch R3.'),
      },
      {
        title: txt('Il pannello "Cosa è successo"', 'The "What happened" panel'),
        body: txt(
          `Dopo ogni Step il pannello **"Cosa è successo"** mostra:
- l'istruzione eseguita e la sua codifica a 32 bit;
- il **calcolo** con i valori reali (per esempio \`R3 ← R1 + R2 = 0x5 + 0x7 = 0xC\`);
- i registri e le celle di memoria modificati;
- per i salti, se sono stati **presi** o no.

È il modo più veloce per capire perché un programma non fa quello che ti aspetti: invece di indovinare, leggi cosa ha fatto davvero la CPU.`,
          `After every Step the **"What happened"** panel shows:
- the executed instruction and its 32-bit encoding;
- the **computation** with real values (for example \`R3 ← R1 + R2 = 0x5 + 0x7 = 0xC\`);
- the registers and memory cells that changed;
- for jumps, whether they were **taken** or not.

It is the fastest way to understand why a program does not do what you expect: instead of guessing, read what the CPU actually did.`,
        ),
        tryIt: txt('Fai Step sulla ADD e leggi la spiegazione. Poi modifica un valore nell\'editor e rilancia con **Reset**.', 'Step the ADD and read the explanation. Then change a value in the editor and restart with **Reset**.'),
      },
      {
        title: txt('Tornare indietro e ricominciare', 'Going back and restarting'),
        body: txt(
          `Hai sbagliato? Nessun problema.
- **Step indietro** annulla l'ultima istruzione: ripristina registri, memoria e periferiche come erano prima.
- **Reset** riporta la CPU all'inizio (PC = 0) e ricarica il programma.

Nota: dopo il RESET i registri e la RAM contengono valori **casuali**, come in un computer vero appena acceso. Un programma corretto non deve mai contare su registri o celle che non ha ancora scritto.`,
          `Made a mistake? No problem.
- **Step back** undoes the last instruction: registers, memory and peripherals are restored.
- **Reset** brings the CPU back to the start (PC = 0) and reloads the program.

Note: after RESET registers and RAM hold **random** values, like a real computer just switched on. A correct program must never rely on registers or cells it has not written yet.`,
        ),
        tryIt: txt('Fai 3 Step e poi 2 volte **Step indietro**: osserva R3 tornare indietro.', 'Do 3 Steps and then **Step back** twice: watch R3 go back.'),
      },
      {
        title: txt('Run e HALT', 'Run and HALT'),
        body: txt(
          `**Run** esegue il programma fino a HALT, a un errore o a un breakpoint. Questo programma somma i numeri da 10 a 1 con un ciclo: dovresti trovare **55** in R1.

Se il programma "si pianta" in un ciclo infinito, **Pausa** lo ferma. Puoi anche mettere un **breakpoint** su una riga per fermarti lì durante Run.`,
          `**Run** executes the program until HALT, an error or a breakpoint. This program adds the numbers from 10 down to 1 with a loop: you should find **55** in R1.

If a program gets stuck in an infinite loop, **Pause** stops it. You can also set a **breakpoint** on a line to stop there during Run.`,
        ),
        code: `        ADD  R1,R0,R0       ; somma = 0
        ADDI R2,R0,10       ; contatore = 10
Loop:   ADD  R1,R1,R2       ; somma += contatore
        SUBI R2,R2,1        ; contatore -= 1
        BNEZ R2,Loop        ; ripeti finché contatore ≠ 0
        HALT
`,
        tryIt: txt('Premi **Run** e controlla R1 = 55. Poi **Reset** e prova a fare qualche Step dentro il ciclo.', 'Press **Run** and check R1 = 55. Then **Reset** and try a few Steps inside the loop.'),
      },
    ],
  },

  // ================================================================
  // 2. Registri, R0, numeri
  // ================================================================
  {
    id: 'registri-numeri',
    title: txt('Registri, R0 e formati dei numeri', 'Registers, R0 and number formats'),
    summary: txt(
      '32 registri, il registro R0 sempre a zero, decimale/esadecimale/binario, numeri negativi e overflow.',
      '32 registers, the always-zero R0, decimal/hex/binary, negative numbers and overflow.',
    ),
    steps: [
      {
        title: txt('32 registri, uno speciale', '32 registers, one special'),
        body: txt(
          `Il DLX ha **32 registri general purpose** da 32 bit: R0, R1, ..., R31. Sono veloci e interni alla CPU, per questo si usano al posto della memoria quando possibile.

**R0 vale sempre 0**: se provi a scriverci il risultato viene scartato (l'assembler ti avvisa). Questo trucco permette di avere "gratis" la costante 0 e di caricare costanti con \`ADDI Rd,R0,k\`.

**R31** è usato da JAL/JALR per l'indirizzo di ritorno. Il **PC** e l'**IAR** non sono general purpose: il PC contiene l'indirizzo della prossima istruzione, lo IAR l'indirizzo di ritorno da un interrupt.`,
          `The DLX has **32 general purpose registers** of 32 bits: R0, R1, ..., R31. They are fast and inside the CPU, which is why they are used instead of memory when possible.

**R0 is always 0**: if you try to write to it the result is discarded (the assembler warns you). This trick gives you the constant 0 for free and lets you load constants with \`ADDI Rd,R0,k\`.

**R31** is used by JAL/JALR for the return address. The **PC** and the **IAR** are not general purpose: the PC holds the address of the next instruction, the IAR the return address from an interrupt.`,
        ),
        code: `        ADDI R1,R0,42
        ADDI R0,R0,99       ; scrivere su R0 non ha effetto: R0 resta 0
        ADD  R2,R1,R0       ; R2 = 42 + 0
        HALT
`,
        tryIt: txt('Fai Step sulla seconda istruzione e leggi cosa dice il pannello "Cosa è successo" su R0.', 'Step the second instruction and read what the "What happened" panel says about R0.'),
      },
      {
        title: txt('Scrivere i numeri', 'Writing numbers'),
        body: txt(
          `Nell'editor puoi scrivere le costanti in vari modi:
- decimale: \`255\`, negativo: \`-1\`;
- esadecimale: \`0xFF\` oppure \`0FFh\` (nelle slide: \`0800h\`);
- binario: \`0b11111111\`;
- carattere ASCII: \`'A'\` (vale 65).

Attenzione: **\`010\` è decimale** (dieci), non esadecimale! L'assembler ti avvisa se un numero con zero iniziale sembra scritto in esadecimale.`,
          `In the editor you can write constants in several ways:
- decimal: \`255\`, negative: \`-1\`;
- hexadecimal: \`0xFF\` or \`0FFh\` (slides use \`0800h\`);
- binary: \`0b11111111\`;
- ASCII character: \`'A'\` (value 65).

Careful: **\`010\` is decimal** (ten), not hexadecimal! The assembler warns you when a number with a leading zero looks like hex.`,
        ),
        code: `        ADDI R1,R0,255
        ADDI R2,R0,0xFF
        ADDI R3,R0,0FFh
        ADDI R4,R0,0b11111111
        ADDI R5,R0,'A'
        ADDI R6,R0,-1
        HALT
`,
        tryIt: txt('Dopo Run guarda R1..R4: sono tutti 255 (0xFF). R5 = 65, R6 = 0xFFFFFFFF.', 'After Run look at R1..R4: all 255 (0xFF). R5 = 65, R6 = 0xFFFFFFFF.'),
      },
      {
        title: txt('Con segno o senza segno?', 'Signed or unsigned?'),
        body: txt(
          `Un registro è solo una sequenza di **32 bit**: l'interpretazione la decide l'istruzione. Con la rappresentazione in **complemento a due**, 0xFFFFFFFF è -1 se letto *con segno*, ma 4294967295 se letto *senza segno*.

Quindi gli stessi due numeri possono confrontarsi in modo diverso:
- \`SLT\` confronta **con segno**: -1 < 1 è vero;
- \`SLTU\` confronta **senza segno**: 4294967295 < 1 è falso.

Il simulatore mostra spesso entrambe le letture, per esempio \`0xFFFFFFFF (-1)\`.`,
          `A register is just a sequence of **32 bits**: the instruction decides how to read it. With **two's complement**, 0xFFFFFFFF is -1 when read *signed*, but 4294967295 when read *unsigned*.

So the same two numbers can compare differently:
- \`SLT\` compares **signed**: -1 < 1 is true;
- \`SLTU\` compares **unsigned**: 4294967295 < 1 is false.

The simulator often shows both readings, for example \`0xFFFFFFFF (-1)\`.`,
        ),
        code: `        ADDI R1,R0,-1       ; 0xFFFFFFFF
        ADDI R2,R0,1
        SLT  R3,R1,R2       ; con segno:   -1 < 1 → 1
        SLTU R4,R1,R2       ; senza segno: 4294967295 < 1 → 0
        HALT
`,
        tryIt: txt('Esegui con Step e confronta R3 e R4: stessi bit, risultati opposti.', 'Run with Step and compare R3 and R4: same bits, opposite results.'),
      },
      {
        title: txt('Overflow', 'Overflow'),
        body: txt(
          `Con 32 bit il massimo numero positivo con segno è **0x7FFFFFFF** (2147483647). Sommare 1 darebbe 0x80000000, che con segno è il numero più negativo: c'è stato un **overflow**.

- \`ADD\`/\`ADDI\`/\`SUB\`/\`SUBI\` trattano i numeri **con segno**: il simulatore ti segnala l'overflow.
- \`ADDU\`/\`ADDUI\`/\`SUBU\`/\`SUBUI\` li trattano **senza segno**: per loro sommare 1 a 0x7FFFFFFF è perfettamente normale.

Il DLX non ha un registro di flag: l'overflow non si "legge", è il programmatore a scegliere l'istruzione giusta.`,
          `With 32 bits the largest signed positive number is **0x7FFFFFFF** (2147483647). Adding 1 gives 0x80000000, which signed is the most negative number: that is an **overflow**.

- \`ADD\`/\`ADDI\`/\`SUB\`/\`SUBI\` treat numbers as **signed**: the simulator flags the overflow.
- \`ADDU\`/\`ADDUI\`/\`SUBU\`/\`SUBUI\` treat them as **unsigned**: adding 1 to 0x7FFFFFFF is perfectly normal for them.

The DLX has no flag register: overflow cannot be "read", the programmer picks the right instruction.`,
        ),
        code: `        LHI   R1,0x7FFF
        ORI   R1,R1,0xFFFF  ; R1 = 0x7FFFFFFF
        ADDI  R2,R1,1       ; overflow con segno!
        ADDUI R3,R1,1       ; senza segno: nessun problema
        HALT
`,
        tryIt: txt('Fai Step sulla ADDI e leggi l\'avviso di overflow. Poi sulla ADDUI.', 'Step the ADDI and read the overflow warning. Then the ADDUI.'),
      },
    ],
  },

  // ================================================================
  // 3. ALU e immediati
  // ================================================================
  {
    id: 'alu-immediati',
    title: txt('Istruzioni ALU, immediati e LHI', 'ALU instructions, immediates and LHI'),
    summary: txt(
      'Operazioni a tre operandi, immediati a 16 bit con estensione con/senza segno, costanti a 32 bit con LHI, shift.',
      'Three-operand operations, 16-bit immediates with signed/unsigned extension, 32-bit constants with LHI, shifts.',
    ),
    steps: [
      {
        title: txt('Tre operandi', 'Three operands'),
        body: txt(
          `Le istruzioni aritmetico-logiche hanno la forma **Rd, Rs1, Rs2** e lavorano **solo tra registri**: \`ADD R1,R2,R3\` fa R1 ← R2 + R3. Non esistono istruzioni che sommano direttamente un registro a una cella di memoria.

Le operazioni logiche sono **bit a bit**:
- \`AND\`: 1 solo se entrambi i bit sono 1;
- \`OR\`: 1 se almeno uno è 1;
- \`XOR\`: 1 se i bit sono diversi. \`XOR R6,R1,R1\` azzera R6.`,
          `Arithmetic-logic instructions have the form **Rd, Rs1, Rs2** and work **only between registers**: \`ADD R1,R2,R3\` does R1 ← R2 + R3. There is no instruction that adds a register directly to a memory cell.

Logic operations are **bitwise**:
- \`AND\`: 1 only if both bits are 1;
- \`OR\`: 1 if at least one is 1;
- \`XOR\`: 1 if the bits differ. \`XOR R6,R1,R1\` clears R6.`,
        ),
        code: `        ADDI R1,R0,12       ; 0b1100
        ADDI R2,R0,10       ; 0b1010
        AND  R3,R1,R2       ; 0b1000 = 8
        OR   R4,R1,R2       ; 0b1110 = 14
        XOR  R5,R1,R2       ; 0b0110 = 6
        XOR  R6,R1,R1       ; azzera R6
        HALT
`,
        tryIt: txt('Esegui e confronta R3, R4, R5 in binario con R1 e R2.', 'Run and compare R3, R4, R5 in binary with R1 and R2.'),
      },
      {
        title: txt('Immediati a 16 bit: con o senza segno?', '16-bit immediates: signed or not?'),
        body: txt(
          `Nelle istruzioni con immediato (formato I) la costante ha **16 bit** e viene estesa a 32 prima del calcolo. Come?
- aritmetiche (\`ADDI\`, \`SUBI\`) e **SET** (\`SLTI\`, ...): estensione **con segno**, quindi \`0xFFFF\` vale -1;
- aritmetiche **U** (\`ADDUI\`, \`SUBUI\`): senza segno, \`0xFFFF\` vale 65535;
- **logiche** (\`ANDI\`, \`ORI\`, \`XORI\`): *sempre* senza segno.

Regola pratica: per mettere dei bit in un registro usa le logiche; per i numeri piccoli, con o senza segno, ADDI/ADDUI.`,
          `In instructions with an immediate (format I) the constant has **16 bits** and is extended to 32 before the calculation. How?
- arithmetic (\`ADDI\`, \`SUBI\`) and **SET** (\`SLTI\`, ...): **sign** extension, so \`0xFFFF\` means -1;
- **U** arithmetic (\`ADDUI\`, \`SUBUI\`): zero extension, \`0xFFFF\` is 65535;
- **logic** (\`ANDI\`, \`ORI\`, \`XORI\`): *always* zero-extended.

Rule of thumb: to put bits in a register use the logic instructions; for small numbers, signed or unsigned, use ADDI/ADDUI.`,
        ),
        code: `        ADDI  R1,R0,0xFFFF  ; esteso con segno   → -1
        ADDUI R2,R0,0xFFFF  ; esteso senza segno → 65535
        ORI   R3,R0,0xFFFF  ; logica: senza segno → 65535
        ANDI  R4,R1,0x00FF  ; maschera: tiene solo il byte basso → 0xFF
        HALT
`,
        tryIt: txt('Guarda nel pannello "Cosa è successo" come viene descritta l\'estensione dell\'immediato in ogni istruzione.', 'Look in the "What happened" panel at how the immediate extension is described for each instruction.'),
      },
      {
        title: txt('Costanti a 32 bit con LHI', '32-bit constants with LHI'),
        body: txt(
          `Un immediato ha solo 16 bit, ma gli indirizzi e molte costanti ne hanno 32. \`LHI Rd,imm16\` (*Load High Immediate*) mette **imm16 nei 16 bit alti** di Rd e zeri sotto: \`Rd ← imm16 ## (0)16\`. **Non accede alla memoria.**

Per una costante completa: \`LHI\` per la metà alta e \`ORI\` per la bassa. Nell'assembler puoi anche scrivere \`hi(simbolo)\` e \`lo(simbolo)\`.

Perché ORI e non ADDI? Perché ORI estende senza segno: con ADDI una metà bassa con il bit 15 a 1 sarebbe estesa con segno e rovinerebbe la metà alta.`,
          `An immediate has only 16 bits, but addresses and many constants have 32. \`LHI Rd,imm16\` (*Load High Immediate*) puts **imm16 in the high 16 bits** of Rd and zeros below: \`Rd ← imm16 ## (0)16\`. **It does not access memory.**

For a full constant: \`LHI\` for the high half and \`ORI\` for the low half. The assembler also accepts \`hi(symbol)\` and \`lo(symbol)\`.

Why ORI and not ADDI? Because ORI zero-extends: with ADDI a low half with bit 15 set would be sign-extended and would corrupt the high half.`,
        ),
        code: `        LHI  R1,0x1234
        ORI  R1,R1,0x5678   ; R1 = 0x12345678
        LHI  R2,0x8000      ; R2 = 0x80000000
        LHI  R3,0x0001
        ADDI R3,R3,0x8000   ; trappola! 0x8000 diventa -32768 → R3 = 0x00008000
        HALT
`,
        tryIt: txt('Dopo l\'ultima ADDI R3 non vale 0x00018000: leggi la spiegazione per capire perché.', 'After the last ADDI, R3 is not 0x00018000: read the explanation to see why.'),
      },
      {
        title: txt('Shift', 'Shifts'),
        body: txt(
          `Gli shift spostano i bit:
- \`SLL\`/\`SLLI\`: a sinistra, entrano zeri. Spostare di *n* posizioni equivale a **moltiplicare per 2ⁿ**. Non esiste SLA: lo shift aritmetico a sinistra coincide con quello logico.
- \`SRL\`/\`SRLI\`: a destra, entrano zeri (logico).
- \`SRA\`/\`SRAI\`: a destra, si **replica il bit di segno** (aritmetico): divide per 2ⁿ mantenendo il segno.

Con numeri negativi SRL e SRA danno risultati molto diversi.`,
          `Shifts move bits:
- \`SLL\`/\`SLLI\`: left, zeros enter. Shifting by *n* positions is the same as **multiplying by 2ⁿ**. There is no SLA: arithmetic shift left is the same as logical.
- \`SRL\`/\`SRLI\`: right, zeros enter (logical).
- \`SRA\`/\`SRAI\`: right, the **sign bit is replicated** (arithmetic): divides by 2ⁿ keeping the sign.

With negative numbers SRL and SRA give very different results.`,
        ),
        code: `        ADDI R1,R0,5
        SLLI R2,R1,3        ; 5 << 3 = 40
        ADDI R3,R0,-16      ; 0xFFFFFFF0
        SRLI R4,R3,2        ; logico:     0x3FFFFFFC
        SRAI R5,R3,2        ; aritmetico: 0xFFFFFFFC = -4
        HALT
`,
        tryIt: txt('Confronta R4 e R5 in binario.', 'Compare R4 and R5 in binary.'),
      },
    ],
  },

  // ================================================================
  // 4. Load/store, big-endian, allineamento
  // ================================================================
  {
    id: 'load-store',
    title: txt('Load/store, big-endian e allineamento', 'Load/store, big-endian and alignment'),
    summary: txt(
      "Indirizzo = registro + offset, byte/half/word, ordine dei byte in memoria, errori di allineamento e RAM non inizializzata.",
      'Address = register + offset, byte/half/word, byte order in memory, alignment errors and uninitialized RAM.',
    ),
    steps: [
      {
        title: txt('Dove stanno i dati', 'Where data lives'),
        body: txt(
          `Il DLX ha un unico spazio di indirizzamento di 4 GB. Nella mappa predefinita del simulatore:
- **EPROM** a 0x00000000 (512 MB): contiene il programma, è **a sola lettura**;
- **RAM** a 0x40000000 (1 GB): qui vanno i dati (la sezione \`.data\` parte da qui);
- **LED** a 0x90000000 e **STARTUP** a 0xC0000000: periferiche;
- **RAM_H** a 0xE0000000 (512 MB): altra RAM, fino alla fine dello spazio.

Ogni indirizzo individua un **byte**.`,
          `The DLX has a single 4 GB address space. In the simulator's default map:
- **EPROM** at 0x00000000 (512 MB): holds the program, it is **read-only**;
- **RAM** at 0x40000000 (1 GB): data goes here (the \`.data\` section starts here);
- **LED** at 0x90000000 and **STARTUP** at 0xC0000000: peripherals;
- **RAM_H** at 0xE0000000 (512 MB): more RAM, up to the end of the space.

Every address identifies a **byte**.`,
        ),
        tryIt: txt('Apri la vista della mappa di memoria e individua EPROM, RAM, RAM_H e le periferiche.', 'Open the memory map view and locate EPROM, RAM, RAM_H and the peripherals.'),
      },
      {
        title: txt('Registro + offset', 'Register + offset'),
        body: txt(
          `L'**unico** modo di indirizzare la memoria è l'**indirizzamento indiretto**: indirizzo = **contenuto di un registro + offset a 16 bit** (esteso con segno).

\`LW R3,0x10(R1)\` significa R3 ← M[R1 + 0x10] (lettura di una word). \`SW R2,0x10(R1)\` scrive R2 in M[R1 + 0x10].

Poiché l'offset ha solo 16 bit, per raggiungere indirizzi come 0x40000000 si carica prima la parte alta in un registro con \`LHI\`.`,
          `The **only** way to address memory is **indirect addressing**: address = **register contents + 16-bit offset** (sign-extended).

\`LW R3,0x10(R1)\` means R3 ← M[R1 + 0x10] (reading a word). \`SW R2,0x10(R1)\` writes R2 to M[R1 + 0x10].

Since the offset has only 16 bits, to reach addresses like 0x40000000 you first load the high part into a register with \`LHI\`.`,
        ),
        code: `        LHI  R1,0x4000        ; R1 = 0x40000000 (base della RAM)
        ADDI R2,R0,123
        SW   R2,0x0010(R1)    ; M[0x40000010] ← 123
        LW   R3,0x0010(R1)    ; R3 ← M[0x40000010]
        HALT
`,
        tryIt: txt('Fai Step sulla SW: nel pannello vedi l\'indirizzo calcolato e la cella di RAM modificata.', 'Step the SW: the panel shows the computed address and the RAM cell that changed.'),
      },
      {
        title: txt('Big-endian: l\'ordine dei byte', 'Big-endian: byte order'),
        body: txt(
          `Una word occupa 4 byte consecutivi. Nel DLX vale la convenzione **big-endian**: il byte **più significativo** sta all'indirizzo **più basso**.

Scrivendo 0x12345678 all'indirizzo A si ottiene A: 0x12, A+1: 0x34, A+2: 0x56, A+3: 0x78. (Intel x86 usa l'ordine opposto, little-endian.)

Si può quindi leggere la stessa memoria come byte (\`LBU\`), half-word (\`LHU\`, 16 bit) o word (\`LW\`).`,
          `A word takes 4 consecutive bytes. The DLX uses the **big-endian** convention: the **most significant** byte sits at the **lowest** address.

Writing 0x12345678 at address A gives A: 0x12, A+1: 0x34, A+2: 0x56, A+3: 0x78. (Intel x86 uses the opposite order, little-endian.)

So the same memory can be read as bytes (\`LBU\`), half-words (\`LHU\`, 16 bits) or words (\`LW\`).`,
        ),
        code: exampleCode('big-endian'),
        tryIt: txt('Esegui e controlla R3..R6 (i singoli byte) e R7, R8 (le due half-word).', 'Run and check R3..R6 (the single bytes) and R7, R8 (the two half-words).'),
      },
      {
        title: txt('LB o LBU?', 'LB or LBU?'),
        body: txt(
          `Quando si legge un byte o una half-word in un registro a 32 bit bisogna **estenderla**:
- \`LB\`, \`LH\`: estensione **con segno** (si replica il bit più alto): 0x80 diventa 0xFFFFFF80;
- \`LBU\`, \`LHU\`: estensione **senza segno** (si aggiungono zeri): 0x80 diventa 0x00000080.

Scegli in base a come interpreti il dato: un carattere ASCII o un contatore 0..255 vogliono \`LBU\`; un numero con segno a 8 bit vuole \`LB\`. Le **store** (\`SB\`, \`SH\`) non hanno questo problema: scrivono semplicemente i bit bassi del registro.`,
          `When a byte or half-word is read into a 32-bit register it must be **extended**:
- \`LB\`, \`LH\`: **sign** extension (the top bit is replicated): 0x80 becomes 0xFFFFFF80;
- \`LBU\`, \`LHU\`: **zero** extension (zeros are added): 0x80 becomes 0x00000080.

Choose based on how you interpret the data: an ASCII character or a 0..255 counter wants \`LBU\`; an 8-bit signed number wants \`LB\`. **Stores** (\`SB\`, \`SH\`) have no such issue: they simply write the low bits of the register.`,
        ),
        code: `        LHI  R1,hi(dato)
        ORI  R1,R1,lo(dato)
        LB   R2,0(R1)       ; 0x80 → 0xFFFFFF80 (-128)
        LBU  R3,0(R1)       ; 0x80 → 0x00000080 (128)
        HALT

        .data
dato:   .byte 0x80
`,
        tryIt: txt('Confronta R2 e R3.', 'Compare R2 and R3.'),
      },
      {
        title: txt('Errori classici', 'Classic mistakes'),
        body: txt(
          `Alcuni errori che il simulatore ti spiega:
- **Allineamento**: una word va a indirizzi multipli di 4, una half-word a multipli di 2. \`LW\` all'indirizzo 0x40000002 genera un *alignment fault*.
- **RAM non inizializzata**: leggere una cella mai scritta dà un valore casuale (il pannello ti avvisa).
- **EPROM**: scrivere nella EPROM è un errore, è a sola lettura.
- **Indirizzo non mappato**: nessun dispositivo risponde.

Qui sotto un programma che va in alignment fault: leggi il messaggio.`,
          `Some mistakes the simulator explains:
- **Alignment**: a word goes at multiples of 4, a half-word at multiples of 2. \`LW\` at address 0x40000002 raises an *alignment fault*.
- **Uninitialized RAM**: reading a cell never written gives a random value (the panel warns you).
- **EPROM**: writing to the EPROM is an error, it is read-only.
- **Unmapped address**: no device responds.

Below is a program that hits an alignment fault: read the message.`,
        ),
        code: `        LHI  R1,0x4000
        LW   R2,2(R1)       ; ERRORE: 0x40000002 non è multiplo di 4
        HALT
`,
        tryIt: txt('Premi Run e leggi l\'errore. Poi correggi l\'offset (0 o 4) e riprova.', 'Press Run and read the error. Then fix the offset (0 or 4) and retry.'),
      },
    ],
  },

  // ================================================================
  // 5. Salti, cicli, compare and branch
  // ================================================================
  {
    id: 'salti-cicli',
    title: txt('Salti, cicli e "compare and branch"', 'Jumps, loops and "compare and branch"'),
    summary: txt(
      'PC+4 relativo, J, BEQZ/BNEZ, istruzioni SET per confrontare, if/else e cicli for.',
      'PC+4 relative, J, BEQZ/BNEZ, SET instructions to compare, if/else and for loops.',
    ),
    steps: [
      {
        title: txt('Il salto incondizionato', 'The unconditional jump'),
        body: txt(
          `Normalmente il PC avanza di 4 a ogni istruzione. Un **salto** lo cambia. \`J etichetta\` salta sempre: **PC ← PC + 4 + offset**, dove l'offset è calcolato dall'assembler dalla posizione dell'etichetta (salti *PC-relative*).

Le **etichette** sono nomi seguiti da \`:\` che indicano un indirizzo. Non devi contare le istruzioni a mano.`,
          `Normally the PC advances by 4 at each instruction. A **jump** changes it. \`J label\` always jumps: **PC ← PC + 4 + offset**, where the offset is computed by the assembler from the label position (*PC-relative* jumps).

**Labels** are names followed by \`:\` that stand for an address. You never need to count instructions by hand.`,
        ),
        code: `        ADDI R1,R0,1
        J    salta
        ADDI R1,R0,99       ; non verrà mai eseguita
salta:  ADDI R2,R0,2
        HALT
`,
        tryIt: txt('Fai Step e osserva il PC saltare dopo la J. R1 resterà 1.', 'Step and watch the PC jump after J. R1 will stay 1.'),
      },
      {
        title: txt('BEQZ e BNEZ', 'BEQZ and BNEZ'),
        body: txt(
          `I salti **condizionati** del DLX sono solo due:
- \`BEQZ Rs,etichetta\`: salta se **Rs = 0**;
- \`BNEZ Rs,etichetta\`: salta se **Rs ≠ 0**.

Non ci sono flag: la condizione è *il valore di un registro*. Il tipico ciclo "conto alla rovescia" sfrutta proprio BNEZ.`,
          `The DLX has only two **conditional** branches:
- \`BEQZ Rs,label\`: branches if **Rs = 0**;
- \`BNEZ Rs,label\`: branches if **Rs ≠ 0**.

There are no flags: the condition is *a register value*. The typical countdown loop uses BNEZ.`,
        ),
        code: `        ADDI R1,R0,3
Loop:   SUBI R1,R1,1
        BNEZ R1,Loop        ; ripete finché R1 ≠ 0
        HALT
`,
        tryIt: txt('Fai Step: il pannello dice se il salto è PRESO o NON preso. Quante volte viene preso?', 'Step: the panel says whether the branch is TAKEN or NOT taken. How many times is it taken?'),
      },
      {
        title: txt('SET + branch = compare and branch', 'SET + branch = compare and branch'),
        body: txt(
          `Per confrontare due registri si usano le istruzioni **SET**: \`SLT\`, \`SGT\`, \`SLE\`, \`SGE\`, \`SEQ\`, \`SNE\` (e le versioni con immediato \`SLTI\`, ...). Mettono **1 o 0** nel registro destinazione. Poi si salta con BEQZ/BNEZ su quel registro.

Esempio **if/else**: calcolare il minimo tra R1 e R2.`,
          `To compare two registers you use the **SET** instructions: \`SLT\`, \`SGT\`, \`SLE\`, \`SGE\`, \`SEQ\`, \`SNE\` (and the immediate versions \`SLTI\`, ...). They put **1 or 0** in the destination register. Then you branch with BEQZ/BNEZ on that register.

Example **if/else**: compute the minimum of R1 and R2.`,
        ),
        code: `; R3 = minimo(R1, R2)
        ADDI R1,R0,9
        ADDI R2,R0,4
        SLT  R4,R1,R2       ; R4 = 1 se R1 < R2
        BEQZ R4,altrimenti  ; condizione falsa → ramo else
        ADD  R3,R1,R0       ; then: R3 = R1
        J    fine
altrimenti:
        ADD  R3,R2,R0       ; else: R3 = R2
fine:   HALT
`,
        tryIt: txt('Prova a cambiare i valori di R1 e R2 e controlla R3. Qual è il ruolo della J fine?', 'Try changing R1 and R2 and check R3. What is the role of J fine?'),
      },
      {
        title: txt('Il ciclo "for"', 'The "for" loop'),
        body: txt(
          `Un ciclo con contatore *i* da 1 a 10 si scrive così: inizializzazione, corpo, incremento, **SET** per testare la condizione, **BNEZ** per ripetere. Questo è lo schema dell'esempio delle slide che riempie un array.

Ricorda sempre di domandarti: *quante volte viene eseguito il corpo?* e *cosa succede se il ciclo deve eseguire 0 volte?* (qui il corpo viene eseguito almeno una volta).`,
          `A loop with counter *i* from 1 to 10 is written like this: initialization, body, increment, **SET** to test the condition, **BNEZ** to repeat. This is the pattern of the slides' example that fills an array.

Always ask yourself: *how many times does the body run?* and *what if the loop must run 0 times?* (here the body runs at least once).`,
        ),
        code: `; somma 1 + 2 + ... + 10
        ADD  R1,R0,R0       ; somma = 0
        ADDI R2,R0,1        ; i = 1
Loop:   ADD  R1,R1,R2       ; somma += i
        ADDI R2,R2,1        ; i++
        SLEI R3,R2,10       ; R3 = (i <= 10)
        BNEZ R3,Loop
        HALT
`,
        tryIt: txt('Premi Run: R1 = 55. Poi cambia 10 in 100 e verifica R1 = 5050.', 'Press Run: R1 = 55. Then change 10 to 100 and check R1 = 5050.'),
      },
    ],
  },

  // ================================================================
  // 6. Procedure
  // ================================================================
  {
    id: 'procedure',
    title: txt('Procedure: JAL, JR e salvataggio dei registri', 'Procedures: JAL, JR and saving registers'),
    summary: txt(
      "Chiamata e ritorno con R31, procedure che ne chiamano altre, stack manuale per salvare i registri.",
      'Call and return through R31, procedures calling other procedures, a manual stack to save registers.',
    ),
    steps: [
      {
        title: txt('Chiamare e tornare', 'Calling and returning'),
        body: txt(
          `Una **procedura** è un pezzo di codice riusabile. Per chiamarla:
- \`JAL etichetta\` (*Jump And Link*): salva l'indirizzo di ritorno **PC+4 in R31** e salta all'etichetta;
- la procedura termina con \`JR R31\`: **PC ← R31**, cioè torna alla riga dopo la JAL.

Gli argomenti e il risultato passano nei registri, per convenzione tua (qui R4 = argomento, R2 = risultato).`,
          `A **procedure** is a reusable piece of code. To call it:
- \`JAL label\` (*Jump And Link*): saves the return address **PC+4 into R31** and jumps to the label;
- the procedure ends with \`JR R31\`: **PC ← R31**, i.e. back to the line after the JAL.

Arguments and result go through registers, by your own convention (here R4 = argument, R2 = result).`,
        ),
        code: `        ADDI R4,R0,21
        JAL  raddoppia      ; R31 ← PC+4 ; salta
        ADD  R6,R2,R0       ; qui si ritorna: R6 = 42
        HALT

raddoppia:
        ADD  R2,R4,R4       ; R2 = 2 * R4
        JR   R31            ; ritorno
`,
        tryIt: txt('Segui con Step il valore di R31 dopo la JAL e il PC dopo la JR.', 'Follow with Step the value of R31 after JAL and the PC after JR.'),
      },
      {
        title: txt('Procedure che chiamano procedure', 'Procedures calling procedures'),
        body: txt(
          `Se una procedura ne chiama un'altra, la seconda JAL **sovrascrive R31** e la prima perde il suo indirizzo di ritorno: al \`JR R31\` finale il programma tornerebbe nel posto sbagliato (spesso in un ciclo infinito).

La soluzione: la procedura "esterna" **salva R31** prima di chiamare e lo ripristina prima di tornare. Nell'esempio lo copiamo in R20.`,
          `If a procedure calls another one, the second JAL **overwrites R31** and the first loses its return address: at the final \`JR R31\` the program would return to the wrong place (often an infinite loop).

The fix: the "outer" procedure **saves R31** before calling and restores it before returning. In the example we copy it to R20.`,
        ),
        code: exampleCode('procedura-jal'),
        tryIt: txt('Fai Step passando per max3: osserva R31 cambiare a ogni JAL e R20 che lo conserva.', 'Step through max3: watch R31 change at every JAL and R20 keep it.'),
      },
      {
        title: txt('Uno stack fatto a mano', 'A hand-made stack'),
        body: txt(
          `Il DLX non ha istruzioni per lo **stack**, ma si può costruire con un registro "puntatore" (qui **R29**, scelta nostra) che punta alla cima, in RAM, e **scende** a ogni *push*:
- push: \`SUBI R29,R29,4\` e poi \`SW R,0(R29)\`;
- pop: \`LW R,0(R29)\` e poi \`ADDI R29,R29,4\`.

Una procedura che usa registri non suoi (per esempio R8) li salva all'inizio e li ripristina alla fine: il chiamante non si accorge di nulla.`,
          `The DLX has no **stack** instructions, but you can build one with a "pointer" register (here **R29**, our choice) pointing to the top, in RAM, and **going down** at every *push*:
- push: \`SUBI R29,R29,4\` and then \`SW R,0(R29)\`;
- pop: \`LW R,0(R29)\` and then \`ADDI R29,R29,4\`.

A procedure that uses registers that are not its own (say R8) saves them at the start and restores them at the end: the caller notices nothing.`,
        ),
        code: `        LHI  R29,0xF000     ; R29 = puntatore allo stack (in RAM_H)
        ADDI R4,R0,5
        ADDI R8,R0,77       ; R8 deve sopravvivere alla chiamata
        JAL  f
        HALT                ; qui R2 = 2*5+1 = 11 e R8 vale ancora 77

; f(x) = 2x + 1; usa R8 come temporaneo e chiama incrementa
f:      SUBI R29,R29,8      ; push: riserva 2 word
        SW   R31,4(R29)     ; salva l'indirizzo di ritorno
        SW   R8,0(R29)      ; salva R8
        ADD  R8,R4,R4       ; R8 = 2x
        ADD  R4,R8,R0
        JAL  incrementa     ; R2 = R4 + 1
        LW   R8,0(R29)      ; ripristina R8
        LW   R31,4(R29)     ; ripristina R31
        ADDI R29,R29,8      ; pop
        JR   R31

incrementa:
        ADDI R2,R4,1
        JR   R31
`,
        tryIt: txt('Guarda la RAM_H attorno a 0xEFFFFFF8: durante f ci sono R8 e R31 salvati.', 'Look at RAM_H around 0xEFFFFFF8: during f the saved R8 and R31 are there.'),
      },
      {
        title: txt('Chi salva cosa?', 'Who saves what?'),
        body: txt(
          `Non c'è una convenzione imposta dall'hardware: bisogna **decidere e documentare** chi salva i registri.
- Se è il **chiamato** a salvare quelli che usa, il chiamante può contare su tutti i suoi registri.
- Se è il **chiamante**, salva solo ciò che gli serve dopo la chiamata.

Nei testi d'esame sugli interrupt trovi la stessa idea: *"i registri da R20 a R25 possono essere usati senza ripristinarli"*. Quelli sono liberi; tutti gli altri che l'handler usa vanno salvati e ripristinati.`,
          `There is no hardware-imposed convention: you must **decide and document** who saves registers.
- If the **callee** saves the ones it uses, the caller can rely on all its registers.
- If the **caller** does it, it saves only what it needs after the call.

In the exam texts about interrupts you find the same idea: *"registers R20 to R25 can be used without being restored"*. Those are free; every other register the handler uses must be saved and restored.`,
        ),
      },
    ],
  },

  // ================================================================
  // 7. I/O mappato in memoria e chip-select
  // ================================================================
  {
    id: 'io-chip-select',
    title: txt('I/O mappato in memoria e chip-select', 'Memory-mapped I/O and chip selects'),
    summary: txt(
      'Le periferiche stanno nello spazio di indirizzamento: mapping, decodifica semplificata, byte enable e chip-select del simulatore.',
      'Peripherals live in the address space: mapping, simplified decoding, byte enables and the simulator chip selects.',
    ),
    steps: [
      {
        title: txt('Periferiche = indirizzi', 'Peripherals = addresses'),
        body: txt(
          `Il DLX non ha istruzioni speciali di input/output. Le periferiche sono **mappate in memoria**: si accede a loro con le normali LW/SW a indirizzi particolari. Ogni indirizzo di una periferica è un **comando** o un **segnale** (un *chip-select*).

Esempio dalle slide, il LED mappato a 0x90000000:
- \`CS_READ_LED\` (0x90000000, lettura): restituisce 1 se acceso;
- \`CS_SWITCH_LED\` (0x90000004, scrittura): **inverte** il LED, il dato scritto non conta.

Il pannello "Cosa è successo" mostra il nome del chip-select attivato da ogni accesso.`,
          `The DLX has no special input/output instructions. Peripherals are **memory-mapped**: you access them with ordinary LW/SW at particular addresses. Each peripheral address is a **command** or a **signal** (a *chip select*).

Example from the slides, the LED mapped at 0x90000000:
- \`CS_READ_LED\` (0x90000000, read): returns 1 if on;
- \`CS_SWITCH_LED\` (0x90000004, write): **toggles** the LED, the written data does not matter.

The "What happened" panel shows the name of the chip select activated by each access.`,
        ),
        code: `        LHI  R1,0x9000        ; base del LED
        LW   R2,0(R1)         ; CS_READ_LED: R2 = 0 (spento)
        SW   R0,4(R1)         ; CS_SWITCH_LED: il LED si accende
        LW   R3,0(R1)         ; R3 = 1
        HALT
`,
        tryIt: txt('Fai Step e guarda il LED nella vista delle periferiche e il nome del chip-select nel pannello.', 'Step and watch the LED in the peripherals view and the chip select name in the panel.'),
      },
      {
        title: txt('Decodifica: quali bit contano', 'Decoding: which bits matter'),
        body: txt(
          `Il **chip-select** di un dispositivo è una rete logica combinatoria sui bit alti dell'indirizzo BA[31..2]. Con la **decodifica completa** si controllano tutti i bit che identificano il blocco; con la **decodifica semplificata** (quella chiesta all'esame) si tengono **solo i bit necessari a distinguerlo dagli altri dispositivi**.

Nella mappa predefinita, per esempio:
- \`CS_EPROM = BA31*·BA30*\` (0x00000000-0x1FFFFFFF; con X* si indica "X negato");
- \`CS_RAM = BA31*·BA30\` (0x40000000-0x7FFFFFFF);
- LED: \`BA31·BA30*\`;
- \`CS_STARTUP = BA31·BA30·BA29*\`;
- \`CS_RAM_H = BA31·BA29\`.

Conseguenza: con decodifica semplificata un dispositivo "si ripete" (*immagini*) in zone dello spazio che nessun altro usa. Il simulatore è più severo: accessi a indirizzi non mappati danno errore.`,
          `A device's **chip select** is a combinational network over the high address bits BA[31..2]. With **full decoding** you check all the bits identifying the block; with **simplified decoding** (the one required at the exam) you keep **only the bits needed to tell it apart from the other devices**.

In the default map, for example:
- \`CS_EPROM = BA31*·BA30*\` (0x00000000-0x1FFFFFFF; X* means "X negated");
- \`CS_RAM = BA31*·BA30\` (0x40000000-0x7FFFFFFF);
- LED: \`BA31·BA30*\`;
- \`CS_STARTUP = BA31·BA30·BA29*\`;
- \`CS_RAM_H = BA31·BA29\`.

Consequence: with simplified decoding a device "repeats" (*images*) in zones of the space nobody else uses. The simulator is stricter: accesses to unmapped addresses raise an error.`,
        ),
        tryIt: txt('Nella vista di mapping trovi le espressioni di decodifica generate dalla mappa: cambia la base di un dispositivo e guarda come cambiano.', 'The mapping view shows the decoding expressions generated from the map: change a device base and see how they change.'),
      },
      {
        title: txt('Byte enable e banchi', 'Byte enables and banks'),
        body: txt(
          `Il DLX non porta fuori i bit A1 e A0 dell'indirizzo: esporta **BA[31..2]** (l'indirizzo della word) e quattro segnali **BE0..BE3** che dicono quali dei 4 byte della word sono interessati dall'accesso.

Per questo ogni memoria è fatta di **4 banchi da 8 bit**, uno per "corsia" del bus dati (BD[7..0], BD[15..8], BD[23..16], BD[31..24]) e ha quattro chip-select: \`CS_RAM_i = (decodifica)·BEi\`.

Una \`LW\` attiva tutti i 4 BE, una \`LB\` uno solo (quello del byte richiesto). Anche questo è il motivo per cui i dati non allineati sono vietati.

*Nota:* nei testi d'esame le periferiche a 8 bit usano spesso una singola corsia (es. porta su BD[31..24] con BE3). Nel simulatore ogni chip-select di periferica è invece a un indirizzo multiplo di 4 (+0, +4, +8), per semplicità.`,
          `The DLX does not export address bits A1 and A0: it exports **BA[31..2]** (the word address) and four signals **BE0..BE3** saying which of the 4 bytes of the word are involved in the access.

That is why every memory is made of **4 banks of 8 bits**, one per data bus "lane" (BD[7..0], BD[15..8], BD[23..16], BD[31..24]) with four chip selects: \`CS_RAM_i = (decoding)·BEi\`.

An \`LW\` activates all 4 BE, an \`LB\` only one (that of the requested byte). This is also why unaligned accesses are forbidden.

*Note:* in the exam texts 8-bit peripherals often use a single lane (e.g. a port on BD[31..24] with BE3). In the simulator every peripheral chip select is instead at an address multiple of 4 (+0, +4, +8), for simplicity.`,
        ),
      },
      {
        title: txt('Porte di input e output', 'Input and output ports'),
        body: txt(
          `Altri dispositivi del simulatore, con i loro chip-select (offset dalla base):
- **INPUT** (0x80000000): \`CS_INPUT\` +0 lettura del dato; \`CS_STATUS_INPUT\` +4 lettura "c'è un dato?"; \`CS_RESET_INT_INPUT\` +8 scrittura;
- **OUTPUT** (0xA0000000): \`CS_OUTPUT\` +0 scrittura del dato; \`CS_READ_OUTPUT\` +4 lettura dell'ultimo dato.

Questo programma fa **polling**: aspetta che nello INPUT ci sia un dato e lo ricopia su OUTPUT. Il polling funziona, ma la CPU passa tutto il tempo a controllare: per questo esistono gli **interrupt** (prossimo tutorial).`,
          `Other simulator devices, with their chip selects (offset from the base):
- **INPUT** (0x80000000): \`CS_INPUT\` +0 read the data; \`CS_STATUS_INPUT\` +4 read "is there data?"; \`CS_RESET_INT_INPUT\` +8 write;
- **OUTPUT** (0xA0000000): \`CS_OUTPUT\` +0 write the data; \`CS_READ_OUTPUT\` +4 read the last data.

This program does **polling**: it waits for data in INPUT and copies it to OUTPUT. Polling works, but the CPU spends all its time checking: that is why **interrupts** exist (next tutorial).`,
        ),
        map: MAP_INPUT_OUTPUT,
        code: `        LHI  R1,0x8000        ; base INPUT
        LHI  R2,0xA000        ; base OUTPUT
Attesa: LW   R3,4(R1)         ; CS_STATUS_INPUT: c'è un dato?
        BEQZ R3,Attesa        ; no: riprova
        LW   R4,0(R1)         ; CS_INPUT: legge il dato
        SB   R4,0(R2)         ; CS_OUTPUT: lo scrive
        J    Attesa
`,
        tryIt: txt('Premi Run, poi invia un carattere dalla porta INPUT: lo vedrai comparire su OUTPUT. Usa Pausa per fermare il ciclo.', 'Press Run, then send a character from the INPUT port: it appears on OUTPUT. Use Pause to stop the loop.'),
      },
      {
        title: txt('Errori di mapping', 'Mapping errors'),
        body: txt(
          `Due errori tipici:
- scrivere nella **EPROM** (a sola lettura): il simulatore ti ferma con un messaggio;
- accedere a un indirizzo dove **nessun dispositivo è mappato** (nessun chip-select attivo).

Un terzo, subdolo: usare il chip-select sbagliato (per esempio scrivere a un chip-select di sola lettura). Il messaggio elenca quelli disponibili.`,
          `Two typical errors:
- writing to the **EPROM** (read-only): the simulator stops you with a message;
- accessing an address where **no device is mapped** (no chip select active).

A third, subtle one: using the wrong chip select (for example writing to a read-only chip select). The message lists the available ones.`,
        ),
        code: `        LHI  R1,0x1000        ; 0x10000000 appartiene alla EPROM
        SW   R0,0(R1)         ; ERRORE: la EPROM è a sola lettura
        HALT
`,
        tryIt: txt('Premi Run e leggi il messaggio. Poi cambia 0x1000 in 0x4000 (RAM): ora funziona.', 'Press Run and read the message. Then change 0x1000 to 0x4000 (RAM): now it works.'),
      },
    ],
  },

  // ================================================================
  // 8. Interrupt
  // ================================================================
  {
    id: 'interrupt',
    title: txt('Interrupt: INT, IAR, handler e RFE', 'Interrupts: INT, IAR, handler and RFE'),
    summary: txt(
      'Cosa fa la CPU quando arriva un interrupt, handler a 0x0, STARTUP per distinguere RESET e interrupt, salvataggio dei registri e azzeramento della richiesta.',
      'What the CPU does on an interrupt, handler at 0x0, STARTUP to tell RESET from interrupt, saving registers and clearing the request.',
    ),
    steps: [
      {
        title: txt('Polling o interrupt?', 'Polling or interrupt?'),
        body: txt(
          `Per sapere se è successo qualcosa (un tasto premuto, un dato arrivato) si può fare **polling**: la CPU controlla continuamente. È semplice ma spreca cicli.

Con gli **interrupt** è la periferica ad avvisare la CPU, tramite il segnale **INT**. Nel DLX:
- INT è sensibile al **livello**: se vale 1 e gli interrupt sono abilitati, la CPU reagisce; resta a 1 finché la causa non viene gestita dal software;
- c'è **un solo** pin INT: più sorgenti si combinano con un OR e il software capisce chi ha chiesto leggendo lo stato delle periferiche.`,
          `To know if something happened (a key pressed, data arrived) you can **poll**: the CPU checks continuously. It is simple but wastes cycles.

With **interrupts** the peripheral notifies the CPU through the **INT** signal. In the DLX:
- INT is **level**-sensitive: if it is 1 and interrupts are enabled, the CPU reacts; it stays 1 until software handles the cause;
- there is **only one** INT pin: several sources are combined with an OR and software finds out who asked by reading the peripherals' status.`,
        ),
      },
      {
        title: txt('Cosa fa la CPU', 'What the CPU does'),
        body: txt(
          `Quando INT = 1 e gli interrupt sono abilitati, **al termine dell'istruzione in corso** la CPU:
1. salva l'indirizzo di ritorno in **IAR** (IAR ← PC, già incrementato);
2. salta all'**interrupt handler**: **PC ← 0x00000000**;
3. **disabilita** gli interrupt (IEN ← 0).

L'handler termina con **RFE** (*Return From Exception*): **PC ← IAR** e interrupt di nuovo abilitati. C'è un solo IAR: per questo durante l'handler gli interrupt restano disattivati (niente annidamento nel DLX base).

Nel pannello "Cosa è successo" l'evento compare con il simbolo ⚡ e l'elenco delle sorgenti.`,
          `When INT = 1 and interrupts are enabled, **at the end of the current instruction** the CPU:
1. saves the return address in **IAR** (IAR ← PC, already incremented);
2. jumps to the **interrupt handler**: **PC ← 0x00000000**;
3. **disables** interrupts (IEN ← 0).

The handler ends with **RFE** (*Return From Exception*): **PC ← IAR** and interrupts enabled again. There is a single IAR: that is why interrupts stay off during the handler (no nesting in the base DLX).

In the "What happened" panel the event appears with the ⚡ symbol and the list of sources.`,
        ),
      },
      {
        title: txt('RESET o interrupt? Il segnale STARTUP', 'RESET or interrupt? The STARTUP signal'),
        body: txt(
          `Dopo il **RESET** il PC vale 0 e il DLX parte da 0x00000000. Ma anche l'handler sta a 0x00000000! Come distinguere i due casi? Con un segnale **STARTUP**: vale **1 dopo il RESET** e il software lo porta a **0** a fine inizializzazione. Il codice a 0x0 lo legge:
- STARTUP = 1 → è un avvio: inizializza e poi scrivi 0 in STARTUP;
- STARTUP = 0 → è un interrupt: salta all'handler.

Finché STARTUP vale 1 gli interrupt sono **disabilitati**: un interrupt durante l'inizializzazione sarebbe scambiato per un nuovo avvio. Scrivere 0 a \`CS_WRITE_STARTUP\` li abilita.

Ecco lo schema, con un pulsante come sorgente.`,
          `After **RESET** the PC is 0 and the DLX starts at 0x00000000. But the handler is also at 0x00000000! How do we tell them apart? With a **STARTUP** signal: it is **1 after RESET** and software sets it to **0** at the end of initialization. The code at 0x0 reads it:
- STARTUP = 1 → it is a boot: initialize, then write 0 to STARTUP;
- STARTUP = 0 → it is an interrupt: jump to the handler.

While STARTUP is 1 interrupts are **disabled**: an interrupt during initialization would be mistaken for a new boot. Writing 0 to \`CS_WRITE_STARTUP\` enables them.

Here is the scheme, with a button as the source.`,
        ),
        map: MAP_BUTTON,
        code: exampleCode('interrupt-pulsante'),
        tryIt: txt('Premi Run, poi il pulsante nella vista periferiche: il LED cambia. Con Step vedi ⚡, IAR e RFE.', 'Press Run, then the button in the peripherals view: the LED changes. With Step you see ⚡, IAR and RFE.'),
      },
      {
        title: txt('Azzerare la causa', 'Clearing the cause'),
        body: txt(
          `INT è un **livello**: se l'handler non elimina la causa, appena fa RFE l'interrupt riparte, all'infinito. Ogni periferica ha il suo modo:
- **INPUT**: leggere \`CS_INPUT\` azzera la richiesta;
- **pulsante**: scrivere \`CS_RESET_INT_BTN\` azzera il flip-flop (nelle slide: la trasformazione da fronte a livello con un FFD e A_RES);
- **contatore**: scrivere \`CS_RESET_COUNTER\`.

Con più sorgenti l'handler deve prima **identificare** chi ha richiesto (leggendo gli stati) e poi servirla, eventualmente con una priorità.`,
          `INT is a **level**: if the handler does not remove the cause, as soon as it does RFE the interrupt fires again, forever. Every peripheral has its own way:
- **INPUT**: reading \`CS_INPUT\` clears the request;
- **button**: writing \`CS_RESET_INT_BTN\` clears the flip-flop (in the slides: the edge-to-level conversion with a D-FF and A_RES);
- **counter**: writing \`CS_RESET_COUNTER\`.

With several sources the handler must first **identify** who asked (reading the statuses) and then serve it, possibly following a priority.`,
        ),
        tryIt: txt('Nell\'esempio del pulsante cancella la riga con CS_RESET_INT_BTN e premi Run + pulsante: vedrai l\'handler ripartire in continuazione.', 'In the button example delete the CS_RESET_INT_BTN line and press Run + button: you will see the handler restart continuously.'),
      },
      {
        title: txt('Salvare i registri', 'Saving registers'),
        body: txt(
          `Un interrupt può arrivare **in qualsiasi punto** del programma. Se l'handler modifica un registro che il main sta usando, al ritorno il main continua con un valore sbagliato (e il bug appare solo "ogni tanto"!).

Regola: l'handler **salva** i registri che usa e li **ripristina** prima di RFE. Non esiste lo stack, quindi si usa la memoria. Trucco: gli offset negativi da R0 raggiungono gli **ultimi byte** dello spazio di indirizzamento (\`SW R2,-4(R0)\` scrive a 0xFFFFFFFC, che è in RAM_H) senza bisogno di un registro base.

Negli esami il testo spesso dice quali registri sono liberi (es. "R20..R25 senza ripristino"): in quel caso nessun salvataggio. Nell'esempio sotto il main ha un valore protetto in R2: dopo ogni eco deve restare 100.`,
          `An interrupt can arrive at **any point** of the program. If the handler changes a register the main program is using, on return the main continues with a wrong value (and the bug only shows up "sometimes"!).

Rule: the handler **saves** the registers it uses and **restores** them before RFE. There is no stack, so memory is used. Trick: negative offsets from R0 reach the **last bytes** of the address space (\`SW R2,-4(R0)\` writes to 0xFFFFFFFC, which is in RAM_H) with no need for a base register.

In exams the text often says which registers are free (e.g. "R20..R25 without restoring"): then no saving is needed. In the example below the main keeps a protected value in R2: after every echo it must still be 100.`,
        ),
        map: MAP_INPUT_OUTPUT,
        code: exampleCode('interrupt-input'),
        tryIt: txt('Premi Run, invia alcuni caratteri dalla porta INPUT e osserva: R1 continua a crescere, R2 resta 100, OUTPUT mostra l\'eco.', 'Press Run, send a few characters from the INPUT port and watch: R1 keeps growing, R2 stays 100, OUTPUT shows the echo.'),
      },
    ],
  },

  // ================================================================
  // 9. Datapath e pipeline
  // ================================================================
  {
    id: 'datapath-pipeline',
    title: txt('Datapath sequenziale e pipeline', 'Sequential datapath and pipeline'),
    summary: txt(
      'Le fasi di una istruzione, cicli di clock e CPI nel DLX sequenziale; idea della pipeline, alee, stalli e forwarding.',
      'The phases of an instruction, clock cycles and CPI in the sequential DLX; the pipeline idea, hazards, stalls and forwarding.',
    ),
    steps: [
      {
        title: txt('Le fasi di una istruzione', 'The phases of an instruction'),
        body: txt(
          `Ogni istruzione passa per fasi:
1. **Fetch**: legge l'istruzione dalla memoria all'indirizzo del PC (IR ← M[PC]);
2. **Decode**: decodifica e legge i registri sorgente (A ← Rs1, B ← Rs2), PC ← PC + 4;
3. **Execute**: l'ALU calcola (risultato, indirizzo di una load/store o destinazione di un salto);
4. **Memory**: accesso alla memoria per load/store;
5. **Write-back**: il risultato viene scritto nel registro destinazione.

Nel DLX **sequenziale** (slide 07) la parte operativa (**datapath**) è una sola e un'unità di controllo la guida con una micro-sequenza di passi, uno per ciclo di clock. Ogni istruzione finisce prima che parta la successiva.`,
          `Every instruction goes through phases:
1. **Fetch**: reads the instruction from memory at the PC address (IR ← M[PC]);
2. **Decode**: decodes and reads the source registers (A ← Rs1, B ← Rs2), PC ← PC + 4;
3. **Execute**: the ALU computes (result, load/store address or jump target);
4. **Memory**: memory access for load/store;
5. **Write-back**: the result is written to the destination register.

In the **sequential** DLX (slide 07) there is one datapath and a control unit drives it with a micro-sequence of steps, one per clock cycle. Each instruction finishes before the next one starts.`,
        ),
        code: `        ADDI R1,R0,5
        ADDI R2,R0,7
        ADD  R3,R1,R2
        HALT
`,
        tryIt: txt('Apri il tab **Datapath** e fai Step: i componenti attivi si illuminano e vedi le micro-operazioni (RTL) di ogni fase.', 'Open the **Datapath** tab and Step: active components light up and you see the micro-operations (RTL) of every phase.'),
      },
      {
        title: txt('Cicli di clock e CPI', 'Clock cycles and CPI'),
        body: txt(
          `Le fasi richiedono cicli di clock, più eventuali cicli di **wait** (per l'attesa di READY dalle memorie lente). Nel DLX sequenziale delle slide:
- load: 8, store: 7, ALU: 6, set: 7;
- jump: 4, jump and link: 6;
- branch preso: 5, non preso: 4.

Il **CPI** (*cicli per istruzione*) medio dipende dal mix di istruzioni: CPI = Σ CPIᵢ · fᵢ. Il tempo di esecuzione è:

**CPUTime = N_istruzioni · CPI · T_clock**

Più una istruzione è "semplice", meno cicli costa. Il simulatore somma i cicli di ogni istruzione eseguita.`,
          `The phases need clock cycles, plus possible **wait** cycles (waiting for READY from slow memories). In the slides' sequential DLX:
- load: 8, store: 7, ALU: 6, set: 7;
- jump: 4, jump and link: 6;
- branch taken: 5, not taken: 4.

The average **CPI** (*cycles per instruction*) depends on the instruction mix: CPI = Σ CPIᵢ · fᵢ. Execution time is:

**CPUTime = N_instructions · CPI · T_clock**

The simpler an instruction, the fewer cycles it costs. The simulator sums the cycles of every executed instruction.`,
        ),
        code: `        ADD  R1,R0,R0
        ADDI R2,R0,4
Loop:   ADD  R1,R1,R2
        SUBI R2,R2,1
        BNEZ R2,Loop
        HALT
`,
        tryIt: txt('Esegui e confronta i cicli totali con il numero di istruzioni eseguite: dividendo ottieni il CPI del programma.', 'Run and compare the total cycles with the number of executed instructions: dividing gives the program CPI.'),
      },
      {
        title: txt('L\'idea della pipeline', 'The pipeline idea'),
        body: txt(
          `Nel sequenziale la maggior parte dell'hardware sta ferma mentre un'altra parte lavora. La **pipeline** fa lavorare **tutti gli stadi insieme**, su istruzioni diverse, come in una catena di montaggio. Il DLX ha 5 stadi:

**IF → ID → EX → MEM → WB**

Quando la pipeline è piena si **completa una istruzione per ciclo**: il CPI ideale è **1**. La *latenza* di una singola istruzione non migliora (5 cicli), ma il **throughput** sì, e il ciclo di clock è determinato dallo stadio più lento (per questo servono memorie veloci, cache).

Tra uno stadio e l'altro ci sono **registri di pipeline** (IF/ID, ID/EX, EX/MEM, MEM/WB) che trasportano dati e informazioni di controllo.`,
          `In the sequential design most of the hardware idles while another part works. The **pipeline** makes **all stages work together**, on different instructions, like an assembly line. The DLX has 5 stages:

**IF → ID → EX → MEM → WB**

When the pipeline is full **one instruction completes per cycle**: ideal CPI is **1**. The *latency* of a single instruction does not improve (5 cycles) but the **throughput** does, and the clock period is set by the slowest stage (which is why fast memories, caches, are needed).

Between stages there are **pipeline registers** (IF/ID, ID/EX, EX/MEM, MEM/WB) carrying data and control information.`,
        ),
        tryIt: txt('Apri il tab **Pipeline**: vedi il diagramma temporale con le istruzioni che si sovrappongono.', 'Open the **Pipeline** tab: you see the timing diagram with overlapping instructions.'),
      },
      {
        title: txt('Alee e stalli', 'Hazards and stalls'),
        body: txt(
          `A volte una istruzione non può proseguire nel ciclo previsto: è una **alea** (*hazard*). Tre tipi:
- **strutturali**: due stadi vogliono la stessa risorsa (nel DLX si risolve con memorie istruzioni e dati separate);
- **di dato (RAW)**: un'istruzione legge un registro che una precedente non ha ancora scritto;
- **di controllo**: dopo un branch non si sa subito quale istruzione caricare.

La soluzione di base è lo **stallo**: si ferma l'istruzione (e le successive) inserendo "bolle" finché l'alea sparisce. Il CPI effettivo diventa **CPI = 1 + stalli per istruzione**.

Nel codice sotto ogni istruzione dipende dalla precedente: è un caso di alea RAW a catena.`,
          `Sometimes an instruction cannot proceed in the expected cycle: that is a **hazard**. Three kinds:
- **structural**: two stages want the same resource (in the DLX solved with separate instruction and data memories);
- **data (RAW)**: an instruction reads a register that a previous one has not written yet;
- **control**: after a branch it is not immediately known which instruction to fetch.

The basic solution is a **stall**: the instruction (and the following ones) is held, inserting "bubbles" until the hazard goes away. The effective CPI becomes **CPI = 1 + stalls per instruction**.

In the code below each instruction depends on the previous one: a chain of RAW hazards.`,
        ),
        code: `        ADDI R1,R0,1
        ADD  R2,R1,R1       ; legge R1 appena scritto: alea RAW
        ADD  R3,R2,R1       ; legge R2 appena scritto: alea RAW
        SUB  R4,R3,R2       ; ancora
        HALT
`,
        tryIt: txt('Nel tab **Pipeline** cerca gli stalli e le dipendenze tra le istruzioni.', 'In the **Pipeline** tab look for the stalls and the dependencies between instructions.'),
      },
      {
        title: txt('Forwarding e salti', 'Forwarding and branches'),
        body: txt(
          `**Forwarding** (o *bypass*): il risultato di una istruzione è disponibile **alla fine di EX**, molto prima del write-back. Con percorsi aggiuntivi che lo riportano all'ingresso dell'ALU, quasi tutte le alee RAW spariscono **senza stalli**.

Eccezione: la **load**. Il dato arriva solo a fine MEM, quindi una istruzione che lo usa *subito dopo* deve aspettare 1 ciclo (*load-use hazard*). Spesso il compilatore riordina il codice per evitarlo.

Per i **salti** il nuovo PC si conosce solo avanti nella pipeline: le istruzioni già caricate vanno scartate (flush). Strategie: stallare sempre (fino a 3 cicli), *predict not taken* (si prosegue e si scarta solo se il salto è preso) o **predizione dinamica** (Branch Target Buffer). Il **delayed branch** lascia al compilatore il compito di riempire le "delay slot" con istruzioni utili.`,
          `**Forwarding** (or *bypass*): an instruction result is available **at the end of EX**, long before write-back. With extra paths bringing it back to the ALU input, almost all RAW hazards disappear **without stalls**.

Exception: **load**. The data only arrives at the end of MEM, so an instruction using it *right after* must wait 1 cycle (*load-use hazard*). Compilers often reorder code to avoid it.

For **branches** the new PC is known only late in the pipeline: instructions already fetched must be discarded (flush). Strategies: always stall (up to 3 cycles), *predict not taken* (continue and discard only if the branch is taken) or **dynamic prediction** (Branch Target Buffer). **Delayed branch** leaves it to the compiler to fill the "delay slots" with useful instructions.`,
        ),
        code: `        LHI  R1,0x4000
        ADDI R2,R0,9
        SW   R2,0(R1)
        LW   R3,0(R1)
        ADD  R4,R3,R2       ; usa R3 subito dopo la load: load-use
        BNEZ R4,fine        ; salto preso: scartate le istruzioni dopo
        ADDI R5,R0,1
fine:   HALT
`,
        tryIt: txt('Nel tab **Pipeline** confronta con e senza forwarding (se disponibile): conta gli stalli della ADD dopo la LW e del salto.', 'In the **Pipeline** tab compare with and without forwarding (if available): count the stalls of the ADD after the LW and of the branch.'),
      },
    ],
  },
];
