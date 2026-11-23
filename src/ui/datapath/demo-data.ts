import type { MicroStep } from '../../core/cpu/cpu';

/** LW R3,8(R2) — esempio con accesso in memoria. */
export const DEMO_LW: MicroStep[] = [
  { phase: 'FETCH', rtl: 'MAR ← PC', active: ['PC', 'MAR', 'S1', 'ALU', 'dest'], clocks: 1 },
  { phase: 'FETCH', rtl: 'IR ← M[MAR] = 0x8C430008', active: ['MAR', 'MEM', 'IR'], clocks: 2 },
  { phase: 'DECODE', rtl: 'A ← R2 = 0x00001000 ; B ← R3 = 0x00000000 ; PC ← PC+4 = 0x00000004', active: ['RF', 'A', 'B', 'PC', 'ALU'], clocks: 1 },
  { phase: 'EXECUTE', rtl: 'MAR ← A + (IR15)16##IR15..0 = 0x00001008', active: ['A', 'IR', 'ALU', 'MAR'], clocks: 1 },
  { phase: 'MEMORY', rtl: 'MDR ← M[MAR] = 0x0000002A', active: ['MAR', 'MEM', 'MDR'], clocks: 2 },
  { phase: 'WRITE-BACK', rtl: 'C ← MDR', active: ['MDR', 'ALU', 'C'], clocks: 1 },
  { phase: 'WRITE-BACK', rtl: 'R3 ← C', active: ['C', 'RF'], clocks: 1 },
];

/** ADD R1,R2,R3 — istruzione aritmetica registro-registro. */
export const DEMO_ADD: MicroStep[] = [
  { phase: 'FETCH', rtl: 'MAR ← PC', active: ['PC', 'MAR', 'S1', 'ALU', 'dest'], clocks: 1 },
  { phase: 'FETCH', rtl: 'IR ← M[MAR] = 0x00430820', active: ['MAR', 'MEM', 'IR'], clocks: 2 },
  { phase: 'DECODE', rtl: 'A ← R2 = 0x00000005 ; B ← R3 = 0x00000007 ; PC ← PC+4 = 0x00000008', active: ['RF', 'A', 'B', 'PC', 'ALU'], clocks: 1 },
  { phase: 'EXECUTE', rtl: 'TEMP ← B ; C ← A + TEMP = 0x0000000C', active: ['B', 'TEMP', 'A', 'ALU', 'C'], clocks: 1 },
  { phase: 'WRITE-BACK', rtl: 'R1 ← C', active: ['C', 'RF'], clocks: 1 },
];

export const DEMO_VALUES = {
  PC: 0x00000008,
  MAR: 0x00000004,
  MDR: 0x0000002a,
  IR: 0x00430820,
  A: 0x00000005,
  B: 0x00000007,
  C: 0x0000000c,
  TEMP: 0x00000007,
  IAR: 0x00000000,
};

export const DEMO_TEXT_LW = 'LW R3,8(R2)';
export const DEMO_TEXT_ADD = 'ADD R1,R2,R3';
