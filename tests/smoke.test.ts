import { describe, it, expect } from 'vitest';
import { Machine } from '../src/core/machine';

describe('smoke', () => {
  it('somma array di word (slide 03)', () => {
    const m = new Machine();
    const p = m.load(`
        ADD R1,R0,R0      ; accumulatore
        ADDI R2,R0,20h
        LHI R5,0x4000
        ADDI R6,R0,0
init:   SW R6,0x0800(R5)
        ADDI R5,R5,4
        ADDI R6,R6,1
        SNEI R7,R6,8
        BNEZ R7,init
        LHI R5,0x4000
Loop:   SUBI R2,R2,4h
        ADD R8,R5,R2
        LW R3,0800h(R8)
        ADD R1,R1,R3
        BNEZ R2,Loop
        LHI R7,0xE000
        SW R1,0200h(R7)
        HALT`);
    expect(p.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    const out = m.run();
    expect(out.reason).toBe('halt');
    expect(m.cpu.regs[1]).toBe(28);
    expect(m.bus.peekWord(0xe0000200).value).toBe(28);
    m.stepBack();
    expect(m.cpu.halted).toBe(false);
  });
});
