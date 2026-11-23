import { txt } from '../core/util';
import type { Example } from './types';
import { MAP_BUTTON, MAP_INPUT_OUTPUT, MAP_OUTPUT } from './maps';

/**
 * Programmi di esempio. Tutti assemblano senza errori e terminano con HALT
 * oppure (esempi con interrupt) con un ciclo di attesa "J etichetta".
 * Il codice parte da 0x00000000 (EPROM); .data va di default in RAM a 0x40000000.
 */
export const EXAMPLES: Example[] = [
  {
    id: 'primo-programma',
    title: txt('Il primo programma', 'Your first program'),
    description: txt(
      'Quattro istruzioni: due costanti, una somma, una differenza. Perfetto per provare Step, Run e il pannello "Cosa è successo".',
      'Four instructions: two constants, a sum, a difference. Perfect to try Step, Run and the "What happened" panel.',
    ),
    code: `; Il mio primo programma DLX
; R0 vale sempre 0: ADDI Rd,R0,k è il modo classico per caricare una costante k.
        ADDI R1,R0,5        ; R1 ← 5
        ADDI R2,R0,7        ; R2 ← 7
        ADD  R3,R1,R2       ; R3 ← R1 + R2 = 12
        SUB  R4,R2,R1       ; R4 ← R2 - R1 = 2
        SLLI R5,R3,1        ; R5 ← R3 << 1 = 24 (shift a sinistra di 1 = per 2)
        HALT                ; fine del programma (TRAP 0)
`,
  },

  {
    id: 'somma-array',
    title: txt('Somma di un array di word', 'Sum of an array of words'),
    description: txt(
      'Dalle slide (03): somma degli 8 elementi di un vettore con indirizzamento indiretto. Il vettore sta in RAM a 0x40000000, il risultato va a 0xE0000200.',
      'From the slides (03): sum the 8 elements of a vector using indirect addressing. The vector is in RAM at 0x40000000, the result goes to 0xE0000200.',
    ),
    code: `; Somma degli 8 elementi di un vettore di word.
; Il vettore sta in RAM (sezione .data, a partire da 0x40000000);
; il risultato viene scritto a 0xE0000200 (RAM_H).
        LHI  R5,hi(vettore)     ; R5 ← indirizzo del vettore (parte alta)
        ORI  R5,R5,lo(vettore)  ;                            (parte bassa)
        ADD  R1,R0,R0           ; R1 = accumulatore = 0
        ADDI R2,R0,0x20         ; R2 = 32 = byte del vettore (8 word × 4)
Loop:   SUBI R2,R2,4            ; scendo di una word
        ADD  R8,R5,R2           ; R8 = indirizzo dell'elemento corrente
        LW   R3,0(R8)           ; R3 ← elemento
        ADD  R1,R1,R3           ; accumulo
        BNEZ R2,Loop            ; se R2 ≠ 0 ci sono ancora elementi
        LHI  R7,0xE000          ; R7 = 0xE0000000
        SW   R1,0x0200(R7)      ; M[0xE0000200] ← somma
        HALT

        .data
vettore: .word 3, 1, 4, 1, 5, 9, 2, 6     ; somma = 31
`,
  },

  {
    id: 'riempi-array',
    title: txt('Riempire un array (0, 1, 2, ...)', 'Fill an array (0, 1, 2, ...)'),
    description: txt(
      'Dalle slide (03): scrive le word 0..7 a partire da 0xE0000800. Ciclo con SNEI + BNEZ (compare and branch).',
      'From the slides (03): writes the words 0..7 starting at 0xE0000800. Loop with SNEI + BNEZ (compare and branch).',
    ),
    code: `; Scrive le word 0, 1, 2, ..., 7 a partire dall'indirizzo 0xE0000800.
        ADD  R2,R0,R0           ; R2 = indice del ciclo
        LHI  R3,0xE000          ; R3 = 0xE0000000 (puntatore)
Loop:   SW   R2,0x0800(R3)      ; scrive l'indice in memoria
        ADDI R2,R2,1            ; indice + 1
        ADDI R3,R3,4            ; puntatore + 4 (una word)
        SNEI R4,R2,8            ; R4 = 1 se indice ≠ 8
        BNEZ R4,Loop            ; se non abbiamo finito, ripeti
        HALT
`,
  },

  {
    id: 'costanti-32bit',
    title: txt('Costanti a 32 bit: LHI + ORI', '32-bit constants: LHI + ORI'),
    description: txt(
      "Un immediato ha 16 bit: per i valori a 32 bit servono due istruzioni. E la trappola dell'estensione del segno con ADDI.",
      'An immediate has 16 bits: 32-bit values need two instructions. And the sign-extension trap with ADDI.',
    ),
    code: `; Costruire costanti a 32 bit.
.equ MAGICO, 0xCAFEBABE

        LHI  R1,0x1234          ; R1 = 0x12340000   (16 bit alti)
        ORI  R1,R1,0x5678       ; R1 = 0x12345678   (ORI estende SENZA segno: sicuro)

        LHI  R2,hi(MAGICO)      ; hi() e lo() estraggono le due metà di una costante
        ORI  R2,R2,lo(MAGICO)   ; R2 = 0xCAFEBABE

; La trappola: ADDI estende l'immediato CON segno.
        LHI  R3,0x0001          ; R3 = 0x00010000
        ADDI R3,R3,0x8000       ; 0x8000 diventa 0xFFFF8000 (= -32768): R3 = 0x00008000, non 0x00018000!

        LHI  R4,0x0001
        ORI  R4,R4,0x8000       ; così invece R4 = 0x00018000, come volevamo
        HALT
`,
  },

  {
    id: 'procedura-jal',
    title: txt('Procedure: JAL e JR R31', 'Procedures: JAL and JR R31'),
    description: txt(
      'Una procedura max2 chiamata da max3: mostra JAL, JR R31 e perché un chiamante deve salvare R31.',
      'A max2 procedure called by max3: shows JAL, JR R31 and why a caller must save R31.',
    ),
    code: `; Massimo di tre numeri con segno, con due procedure.
; Convenzione (nostra): argomenti in R4, R5, R6; risultato in R2; R9 è un registro di lavoro.
        ADDI R4,R0,7
        ADDI R5,R0,-3
        ADDI R6,R0,12
        JAL  max3               ; R31 ← indirizzo della prossima istruzione; salta a max3
        LHI  R7,0xE000
        SW   R2,0(R7)           ; M[0xE0000000] ← massimo (12)
        HALT

; max2: R2 ← massimo tra R4 e R5 (con segno)
max2:   ADD  R2,R4,R0           ; R2 ← R4
        SGT  R9,R5,R4           ; R9 = 1 se R5 > R4
        BEQZ R9,fine2
        ADD  R2,R5,R0           ; R5 è maggiore: R2 ← R5
fine2:  JR   R31                ; ritorno al chiamante

; max3: R2 ← massimo tra R4, R5 e R6
; Chiama max2, quindi la JAL sovrascriverebbe R31: lo salviamo in R20.
max3:   ADD  R20,R31,R0         ; salva l'indirizzo di ritorno
        JAL  max2               ; R2 ← max(R4,R5)
        ADD  R4,R2,R0           ; R4 ← risultato parziale
        ADD  R5,R6,R0           ; R5 ← R6
        JAL  max2               ; R2 ← max(parziale, R6)
        JR   R20                ; ritorna usando la copia salvata
`,
  },

  {
    id: 'signed-unsigned',
    title: txt('Con segno o senza segno?', 'Signed or unsigned?'),
    description: txt(
      'Lo stesso pattern di bit letto con LB/LBU, LH/LHU e confrontato con SLT/SLTU dà risultati diversi.',
      'The same bit pattern read with LB/LBU, LH/LHU and compared with SLT/SLTU gives different results.',
    ),
    code: `; Stessi bit, interpretazioni diverse.
        LHI  R1,hi(dati)
        ORI  R1,R1,lo(dati)
        LB   R2,0(R1)           ; 0xF0 esteso CON segno  → 0xFFFFFFF0 (-16)
        LBU  R3,0(R1)           ; 0xF0 esteso SENZA segno → 0x000000F0 (240)
        LH   R4,2(R1)           ; 0x8001 con segno       → 0xFFFF8001 (-32767)
        LHU  R5,2(R1)           ; 0x8001 senza segno     → 0x00008001 (32769)

        ADDI R6,R0,-1           ; R6 = 0xFFFFFFFF
        ADDI R7,R0,1            ; R7 = 1
        SLT  R8,R6,R7           ; con segno:   -1 < 1            → 1
        SLTU R9,R6,R7           ; senza segno: 4294967295 < 1    → 0
        HALT

        .data
dati:   .byte 0xF0, 0x00        ; un byte con il bit 7 a 1
        .half 0x8001            ; una half-word con il bit 15 a 1
`,
  },

  {
    id: 'big-endian',
    title: txt('Big-endian: i byte di una word', 'Big-endian: the bytes of a word'),
    description: txt(
      'Scrive 0x12345678 in memoria e rilegge byte e half-word: il byte più significativo sta all\'indirizzo più basso.',
      'Stores 0x12345678 and reads back bytes and half-words: the most significant byte sits at the lowest address.',
    ),
    code: `; Il DLX è big-endian: all'indirizzo più basso sta il byte più significativo.
        LHI  R1,hi(dati)
        ORI  R1,R1,lo(dati)
        LHI  R2,0x1234
        ORI  R2,R2,0x5678       ; R2 = 0x12345678
        SW   R2,0(R1)           ; M[dati .. dati+3] ← 12 34 56 78
        LBU  R3,0(R1)           ; R3 = 0x12
        LBU  R4,1(R1)           ; R4 = 0x34
        LBU  R5,2(R1)           ; R5 = 0x56
        LBU  R6,3(R1)           ; R6 = 0x78
        LHU  R7,0(R1)           ; R7 = 0x1234
        LHU  R8,2(R1)           ; R8 = 0x5678
        HALT

        .data
dati:   .space 4
`,
  },

  {
    id: 'led-startup',
    title: txt('LED e segnale STARTUP', 'LED and the STARTUP signal'),
    description: txt(
      "Esercizio delle slide (03): legge STARTUP (0xC0000000), lo porta a 0 (0xC0000004), poi inverte il LED (0x90000004) e ne legge lo stato (0x90000000).",
      'Exercise from the slides (03): reads STARTUP (0xC0000000), sets it to 0 (0xC0000004), then toggles the LED (0x90000004) and reads its state (0x90000000).',
    ),
    code: `; Periferiche mappate in memoria: si usano con normali LW / SW.
;   CS_READ_LED     = 0x90000000 (lettura)    1 = acceso
;   CS_SWITCH_LED   = 0x90000004 (scrittura)  inverte il LED (il dato scritto non conta)
;   CS_READ_STARTUP = 0xC0000000 (lettura)    1 dopo il RESET
;   CS_WRITE_STARTUP= 0xC0000004 (scrittura)  porta STARTUP al bit 0 del dato
        LHI  R1,0x9000          ; R1 = base del LED
        LHI  R2,0xC000          ; R2 = base di STARTUP
        LW   R3,0(R2)           ; R3 ← STARTUP (vale 1: siamo appena partiti)
        SW   R0,4(R2)           ; STARTUP ← 0: fine inizializzazione
        ADDI R4,R0,3            ; invertiamo il LED 3 volte
Loop:   SW   R0,4(R1)           ; CS_SWITCH_LED: inverte il LED
        LW   R5,0(R1)           ; R5 ← stato del LED (1 = acceso)
        SUBI R4,R4,1
        BNEZ R4,Loop
        HALT                    ; dopo 3 inversioni il LED è acceso (R5 = 1)
`,
  },

  {
    id: 'output-hello',
    title: txt('Porta di OUTPUT: "Ciao, DLX!"', 'OUTPUT port: "Hello, DLX!"'),
    description: txt(
      'Una stringa .asciiz in RAM viene inviata carattere per carattere alla porta di OUTPUT (0xA0000000).',
      'An .asciiz string in RAM is sent character by character to the OUTPUT port (0xA0000000).',
    ),
    map: MAP_OUTPUT,
    code: `; Stampa una stringa sulla porta di OUTPUT (CS_OUTPUT = 0xA0000000, scrittura).
        LHI  R1,hi(msg)
        ORI  R1,R1,lo(msg)     ; R1 = indirizzo della stringa
        LHI  R2,0xA000         ; R2 = base della porta OUTPUT
Loop:   LBU  R3,0(R1)          ; legge un carattere (senza segno)
        BEQZ R3,fine           ; 0 = terminatore della stringa
        SB   R3,0(R2)          ; lo scrive sulla porta (1 byte)
        ADDI R1,R1,1           ; carattere successivo
        J    Loop
fine:   HALT

        .data
msg:    .asciiz "Ciao, DLX!"
`,
  },

  {
    id: 'interrupt-input',
    title: txt('Interrupt: eco dalla porta INPUT', 'Interrupt: echo from the INPUT port'),
    description: txt(
      "Il main conta all'infinito; ogni carattere inviato alla porta INPUT genera un interrupt e l'handler (a 0x0) lo rimanda sulla OUTPUT. Salvataggio/ripristino dei registri in RAM, distinzione RESET/interrupt con STARTUP, RFE.",
      'The main loop counts forever; every character sent to the INPUT port raises an interrupt and the handler (at 0x0) echoes it to OUTPUT. Register save/restore in RAM, RESET vs interrupt via STARTUP, RFE.',
    ),
    map: MAP_INPUT_OUTPUT,
    code: `; Interrupt da porta INPUT: eco sulla porta OUTPUT.
; Dopo un RESET *e* a ogni interrupt il DLX riparte da 0x00000000.
; STARTUP vale 1 solo dopo il RESET: leggendolo si distinguono i due casi.
; R20 e R21 sono riservati allo smistamento (non vanno ripristinati).
        LHI  R20,0xC000         ; R20 = base STARTUP
        LW   R21,0(R20)         ; CS_READ_STARTUP
        BEQZ R21,handler        ; STARTUP = 0 → è un interrupt

; ---------- avvio (STARTUP = 1) ----------
        SW   R0,-16(R0)         ; contatore caratteri = 0 (offset negativo da R0 = fondo della RAM_H, 0xFFFFFFF0)
        ADDI R2,R0,100          ; valore "da proteggere": l'handler non deve alterarlo
        XOR  R1,R1,R1           ; R1 = contatore del lavoro del main
        SW   R0,4(R20)          ; STARTUP ← 0: da ora gli interrupt sono abilitati
main:   ADDI R1,R1,1            ; il main "lavora"...
        J    main               ; ...finché non arriva un interrupt

; ---------- interrupt handler ----------
handler:
        SW   R2,-4(R0)          ; salva i registri che userò (0xFFFFFFFC, F8, F4)
        SW   R3,-8(R0)
        SW   R4,-12(R0)
        LHI  R3,0x8000          ; R3 = base INPUT
        LW   R2,0(R3)           ; CS_INPUT: legge il carattere e azzera la richiesta INT
        LHI  R4,0xA000          ; R4 = base OUTPUT
        SB   R2,0(R4)           ; eco sulla porta OUTPUT
        LW   R2,-16(R0)         ; contatore ← contatore + 1
        ADDI R2,R2,1
        SW   R2,-16(R0)
        LW   R4,-12(R0)         ; ripristina i registri
        LW   R3,-8(R0)
        LW   R2,-4(R0)
        RFE                     ; PC ← IAR, interrupt riabilitati
`,
  },

  {
    id: 'interrupt-pulsante',
    title: txt('Interrupt: il pulsante accende il LED', 'Interrupt: the button toggles the LED'),
    description: txt(
      "Ogni pressione del pulsante (flip-flop da fronte a livello) genera un interrupt; l'handler azzera il flip-flop (CS_RESET_INT_BTN) e inverte il LED.",
      'Each button press (edge-to-level flip-flop) raises an interrupt; the handler clears the flip-flop (CS_RESET_INT_BTN) and toggles the LED.',
    ),
    map: MAP_BUTTON,
    code: `; Pulsante → interrupt → inverte il LED.
; CS_READ_BTN = 0xD0000000 (R), CS_RESET_INT_BTN = 0xD0000004 (W)
        LHI  R20,0xC000         ; base STARTUP
        LW   R21,0(R20)         ; STARTUP: 1 = reset, 0 = interrupt
        BEQZ R21,handler
        SW   R0,4(R20)          ; STARTUP ← 0: abilita gli interrupt
attesa: J    attesa             ; il main non fa nulla: aspetta il pulsante

handler:
        LHI  R22,0xD000         ; base del pulsante
        SW   R0,4(R22)          ; CS_RESET_INT_BTN: azzera il flip-flop (altrimenti INT resterebbe a 1 e l'handler ripartirebbe subito!)
        LHI  R22,0x9000         ; base del LED
        SW   R0,4(R22)          ; CS_SWITCH_LED: inverte il LED
        RFE
`,
  },
];
