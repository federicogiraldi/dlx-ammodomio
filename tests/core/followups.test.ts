import { describe, it, expect } from 'vitest';
import { assemble } from '../../src/core/asm/assembler';
import { Machine } from '../../src/core/machine';

describe('follow-up dopo la review', () => {
  it('etichetta sulla stessa riga di .align punta all\'indirizzo allineato', () => {
    const p = assemble('.data\n.byte 1\nw: .align 2\n.word 5\nHALT');
    expect(p.symbols.get('w')!.value).toBe(0x40000004);
  });
  it('suggerisce .word per la trasposizione .wrod', () => {
    const p = assemble('.data\n.wrod 1');
    expect(p.diagnostics[0].text.it).toContain('.word');
  });
  it('il testo nella traccia usa le etichette', () => {
    const m = new Machine();
    m.load('ADDI R1,R0,2\nloop: SUBI R1,R1,1\nBNEZ R1,loop\nHALT');
    m.run();
    expect(m.trace.some((r) => r.text === 'BNEZ R1,loop')).toBe(true);
  });
});
