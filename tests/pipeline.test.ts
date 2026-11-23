import { describe, it, expect } from 'vitest';
import { Machine } from '../src/core/machine';
import { decode } from '../src/core/isa/encode';
import { assemble } from '../src/core/asm/assembler';
import { idealCycles, regsOf, simulatePipeline, PipelineOptions } from '../src/core/pipeline/model';

function traceOf(src: string) {
  const m = new Machine();
  m.load(src);
  m.run();
  return m.trace;
}

const NOFWD: PipelineOptions = { forwarding: false, branchPolicy: 'stall' };
const FWD: PipelineOptions = { forwarding: true, branchPolicy: 'stall' };

/** decodifica la prima istruzione di un sorgente (per testare regsOf) */
function dec(line: string) {
  const prog = assemble(line + '\nHALT');
  const b = (a: number) => prog.bytes.get(a) ?? 0;
  const word = ((b(0) << 24) | (b(1) << 16) | (b(2) << 8) | b(3)) >>> 0;
  return decode(word)!;
}

describe('regsOf', () => {
  it('ALU, immediati, load, store, branch, jump, speciali', () => {
    expect(regsOf(dec('ADD R1,R2,R3'))).toEqual({ reads: [2, 3], writes: 1 });
    expect(regsOf(dec('ADDI R1,R2,5'))).toEqual({ reads: [2], writes: 1 });
    expect(regsOf(dec('ADD R1,R0,R0'))).toEqual({ reads: [], writes: 1 });
    expect(regsOf(dec('ADD R0,R2,R3'))).toEqual({ reads: [2, 3], writes: null });
    expect(regsOf(dec('LHI R4,0x4000'))).toEqual({ reads: [], writes: 4 });
    expect(regsOf(dec('LW R2,0(R1)'))).toEqual({ reads: [1], writes: 2 });
    expect(regsOf(dec('SW R2,4(R1)'))).toEqual({ reads: [1, 2], writes: null });
    expect(regsOf(dec('SLLI R1,R2,3'))).toEqual({ reads: [2], writes: 1 });
    expect(regsOf(dec('SEQ R1,R2,R2'))).toEqual({ reads: [2], writes: 1 });
    expect(regsOf(dec('JR R31'))).toEqual({ reads: [31], writes: null });
    expect(regsOf(dec('JALR R5'))).toEqual({ reads: [5], writes: 31 });
    expect(regsOf(dec('MOVS2I R3,IAR'))).toEqual({ reads: [], writes: 3 });
    expect(regsOf(dec('MOVI2S IAR,R3'))).toEqual({ reads: [3], writes: null });
    expect(regsOf(dec('NOP'))).toEqual({ reads: [], writes: null });
  });
  it('salti e JAL', () => {
    const t = traceOf(`
      ADDI R1,R0,0
      BEQZ R1,x
x:    JAL f
      HALT
f:    JR R31`);
    expect(regsOf(t[1].decoded)).toEqual({ reads: [1], writes: null });
    expect(regsOf(t[2].decoded)).toEqual({ reads: [], writes: 31 });
  });
});

describe('pipeline: caso ideale', () => {
  it('N istruzioni indipendenti: N + 4 cicli', () => {
    const t = traceOf(`
      ADDI R1,R0,1
      ADDI R2,R0,2
      ADDI R3,R0,3
      ADDI R4,R0,4
      HALT`);
    for (const o of [NOFWD, FWD]) {
      const r = simulatePipeline(t, o);
      expect(r.instructions).toBe(5);
      expect(r.cycles).toBe(idealCycles(5));
      expect(r.cycles).toBe(9);
      expect(r.hazards.filter((h) => h.stalls > 0)).toHaveLength(0);
      expect(r.rows[0].cells).toEqual({ 1: 'IF', 2: 'ID', 3: 'EX', 4: 'MEM', 5: 'WB' });
      expect(r.rows[4].cells[9]).toBe('WB');
    }
  });
  it('CPI tende a 1 con tante istruzioni', () => {
    const body = Array.from({ length: 100 }, (_, i) => `ADDI R${(i % 20) + 1},R0,${i}`).join('\n');
    const r = simulatePipeline(traceOf(body + '\nHALT'), FWD);
    expect(r.cycles).toBe(105);
    expect(r.cpi).toBeLessThan(1.05);
  });
  it('traccia vuota', () => {
    const r = simulatePipeline([], FWD);
    expect(r.cycles).toBe(0);
    expect(r.cpi).toBe(0);
  });
});

describe('pipeline: alee RAW', () => {
  const src = `
      ADDI R1,R0,5
      ADD R2,R1,R1
      HALT`;
  it('senza forwarding, split-cycle: 2 stalli a distanza 1', () => {
    const r = simulatePipeline(traceOf(src), NOFWD);
    expect(r.cycles).toBe(3 + 4 + 2);
    const h = r.hazards.find((x) => x.kind === 'RAW')!;
    expect(h.stalls).toBe(2);
    expect(h.reg).toBe(1);
    expect(h.consumer).toBe(1);
    expect(h.producer).toBe(0);
    expect(h.text.it).toContain('R1');
    expect(h.text.en).toContain('R1');
    // ADD: IF2 ID3 stall4 stall5 EX6; HALT trattenuto in IF
    expect(r.rows[1].cells).toMatchObject({ 2: 'IF', 3: 'ID', 4: 'stall', 5: 'stall', 6: 'EX', 7: 'MEM', 8: 'WB' });
    expect(r.rows[2].cells).toMatchObject({ 3: 'IF', 4: 'stall', 5: 'stall', 6: 'ID' });
  });
  it('senza forwarding e senza split-cycle: 3 stalli (slide: T5 = 5+3)', () => {
    const r = simulatePipeline(traceOf(src), { ...NOFWD, splitCycle: false });
    expect(r.hazards[0].stalls).toBe(3);
    expect(r.cycles).toBe(3 + 4 + 3);
  });
  it('senza forwarding: distanza 2 -> 1 stallo, distanza 3 -> 0', () => {
    const d2 = simulatePipeline(traceOf('ADDI R1,R0,5\nNOP\nADD R2,R1,R1\nHALT'), NOFWD);
    expect(d2.hazards[0].stalls).toBe(1);
    const d3 = simulatePipeline(traceOf('ADDI R1,R0,5\nNOP\nNOP\nADD R2,R1,R1\nHALT'), NOFWD);
    expect(d3.hazards).toHaveLength(0);
    expect(d3.cycles).toBe(5 + 4);
    const d3n = simulatePipeline(traceOf('ADDI R1,R0,5\nNOP\nNOP\nADD R2,R1,R1\nHALT'), { ...NOFWD, splitCycle: false });
    expect(d3n.hazards[0].stalls).toBe(1);
  });
  it('con forwarding: nessuno stallo, indicato EX/MEM e MEM/WB', () => {
    const r = simulatePipeline(traceOf(src), FWD);
    expect(r.cycles).toBe(7);
    expect(r.hazards).toHaveLength(1);
    expect(r.hazards[0].stalls).toBe(0);
    expect(r.hazards[0].forwardedFrom).toBe('EX/MEM');
    const r2 = simulatePipeline(traceOf('ADDI R1,R0,5\nNOP\nADD R2,R1,R1\nHALT'), FWD);
    expect(r2.hazards[0].forwardedFrom).toBe('MEM/WB');
    expect(r2.cycles).toBe(8);
  });
  it('R0 non crea dipendenze', () => {
    const r = simulatePipeline(traceOf('ADD R0,R0,R0\nADD R1,R0,R0\nHALT'), NOFWD);
    expect(r.hazards).toHaveLength(0);
    expect(r.cycles).toBe(7);
  });
  it('esempio slide Forwarding (ADD/SUB/OR/LW/AND su R3)', () => {
    const src2 = `
      ADDI R3,R0,8
      ADDI R1,R0,1
      ADDI R4,R0,1
      ADDI R5,R0,1
      ADD R3,R1,R4
      SUB R7,R3,R5
      OR R1,R3,R5
      LW R6,100(R3)
      AND R9,R5,R3
      HALT`;
    // R3 vale 8 + 1... basta che l'indirizzo LW sia valido: usiamo un valore RAM
    const m = new Machine();
    m.load(`
      LHI R3,0x4000
      ADDI R1,R0,1
      ADDI R4,R0,0
      ADDI R5,R0,1
      ADD R3,R3,R4
      SUB R7,R3,R5
      OR R1,R3,R5
      SW R5,100(R3)
      LW R6,100(R3)
      AND R9,R5,R3
      HALT`);
    m.run();
    void src2;
    const t = m.trace.slice(4); // da ADD in poi: ADD SUB OR SW LW AND HALT
    const f = simulatePipeline(t, FWD);
    // la slide: con forwarding nessuno stallo (clk 1..9 per le 5 istruzioni)
    expect(f.hazards.filter((h) => h.stalls > 0)).toHaveLength(0);
    expect(f.cycles).toBe(idealCycles(t.length));
    // senza forwarding e senza split-cycle: SUB subisce 3 stalli (T5 = 8 clk per la prima coppia)
    const n = simulatePipeline(t, { ...NOFWD, splitCycle: false });
    expect(n.hazards[0].stalls).toBe(3);
    expect(n.cycles).toBe(idealCycles(t.length) + 3);
  });
});

describe('pipeline: load-use', () => {
  it('slide "Alea di dato dovuta alle LOAD": 1 stallo con forwarding', () => {
    const t = traceOf(`
      LHI R6,0x4000
      SW R0,32(R6)
      LW R1,32(R6)
      ADD R4,R1,R7
      SUB R5,R1,R8
      AND R6,R1,R7
      HALT`);
    const r = simulatePipeline(t.slice(2), FWD); // LW ADD SUB AND HALT
    const lu = r.hazards.filter((h) => h.kind === 'load-use');
    expect(lu).toHaveLength(1);
    expect(lu[0].stalls).toBe(1);
    expect(lu[0].consumer).toBe(1);
    expect(lu[0].producer).toBe(0);
    expect(lu[0].forwardedFrom).toBe('MEM/WB');
    expect(lu[0].text.it).toMatch(/Load-use/);
    expect(r.cycles).toBe(idealCycles(5) + 1);
    // SUB riceve R1 con forwarding MEM/WB senza ulteriori stalli
    // (dopo lo stallo dell'ADD, SUB e' a 3 cicli dalla LOAD: il dato e' gia' nel RF, nessuna ulteriore alea)
    expect(r.hazards.find((h) => h.consumer === 2)).toBeUndefined();
    // celle dell'ADD: IF2 ID3 stall4 EX5 MEM6 WB7
    expect(r.rows[1].cells).toMatchObject({ 2: 'IF', 3: 'ID', 4: 'stall', 5: 'EX', 6: 'MEM', 7: 'WB' });
  });
  it('load seguita dopo 1 istruzione indipendente: nessuno stallo', () => {
    const t = traceOf(`
      LHI R6,0x4000
      SW R0,0(R6)
      LW R1,0(R6)
      ADDI R2,R0,1
      ADD R3,R1,R2
      HALT`);
    const r = simulatePipeline(t.slice(2), FWD);
    expect(r.cycles).toBe(idealCycles(4));
  });
  it('load-use senza forwarding: 2 stalli (come ALU, split-cycle)', () => {
    const t = traceOf(`
      LHI R6,0x4000
      SW R0,0(R6)
      LW R1,0(R6)
      ADD R3,R1,R1
      HALT`);
    const r = simulatePipeline(t.slice(2), NOFWD);
    expect(r.hazards[0].kind).toBe('RAW');
    expect(r.hazards[0].stalls).toBe(2);
  });
  it('store dopo load del dato: dato rs2 richiesto in EX -> 1 stallo con forwarding', () => {
    const t = traceOf(`
      LHI R6,0x4000
      SW R0,0(R6)
      LW R1,0(R6)
      SW R1,4(R6)
      HALT`);
    const r = simulatePipeline(t.slice(2), FWD);
    expect(r.hazards.find((h) => h.kind === 'load-use')?.stalls).toBe(1);
    // store dopo ALU: nessuno stallo
    const r2 = simulatePipeline(traceOf('LHI R6,0x4000\nADDI R1,R0,3\nSW R1,0(R6)\nHALT').slice(1), FWD);
    expect(r2.cycles).toBe(idealCycles(3));
  });
  it('store che usa R1 come base dopo ADDI: dipendenza su rs1', () => {
    const t = traceOf(`
      ADDI R1,R0,0
      LHI R2,0x4000
      SW R1,0(R2)
      HALT`);
    const r = simulatePipeline(t, NOFWD);
    // SW legge R1 (d2: 1 stallo) e R2 (d1: 2 stalli) -> stallo massimo 2
    expect(r.cycles).toBe(idealCycles(4) + 2);
    expect(r.hazards.map((h) => h.reg).sort()).toEqual([1, 2]);
  });
});

describe('pipeline: alee di controllo', () => {
  const taken = `
      ADDI R1,R0,0
      BEQZ R1,t
      ADDI R2,R0,1
t:    ADDI R3,R0,3
      HALT`;
  const notTaken = `
      ADDI R1,R0,1
      BEQZ R1,t
      ADDI R2,R0,1
t:    ADDI R3,R0,3
      HALT`;

  it('always stall: 3 stalli per OGNI salto (preso o no)', () => {
    const rt = simulatePipeline(traceOf(taken), FWD);
    expect(rt.instructions).toBe(4);
    expect(rt.cycles).toBe(idealCycles(4) + 3);
    const rn = simulatePipeline(traceOf(notTaken), FWD);
    expect(rn.instructions).toBe(5);
    expect(rn.cycles).toBe(idealCycles(5) + 3);
    // celle dell'istruzione dopo il salto: 3 bolle poi IF a 4 cicli dall'IF del salto (slide: fetch con nuovo PC al clk 5 per BEQZ al clk 1)
    expect(rt.rows[2].cells).toMatchObject({ 3: 'stall', 4: 'stall', 5: 'stall', 6: 'IF', 7: 'ID', 8: 'EX' });
    const c = rt.hazards.find((h) => h.kind === 'control')!;
    expect(c.stalls).toBe(3);
    expect(c.producer).toBe(1);
    expect(c.consumer).toBe(2);
  });
  it('CPI = 1 + 3*f con salti (slide: 25% di salti -> 1.75 a regime)', () => {
    // 3 istruzioni + 1 salto not-taken ripetuti: f = 0.25 per istruzione
    let body = 'ADDI R1,R0,1\n';
    for (let i = 0; i < 40; i++) body += `ADDI R2,R0,1\nADDI R3,R0,1\nADDI R4,R0,1\nBEQZ R1,x${i}\nx${i}: NOP\n`;
    const t = traceOf(body + 'HALT');
    const r = simulatePipeline(t, { forwarding: true, branchPolicy: 'stall' });
    const nBranch = 40;
    expect(r.cycles).toBe(idealCycles(t.length) + 3 * nBranch);
  });
  it('predict-not-taken: salto non preso 0 stalli', () => {
    const r = simulatePipeline(traceOf(notTaken), { forwarding: true, branchPolicy: 'predict-not-taken' });
    expect(r.cycles).toBe(idealCycles(5));
    expect(r.rows.filter((x) => x.kind === 'discarded')).toHaveLength(0);
    const c = r.hazards.find((h) => h.kind === 'control')!;
    expect(c.stalls).toBe(0);
  });
  it('predict-not-taken: salto preso -> 3 istruzioni scartate (flush), 3 cicli persi', () => {
    const r = simulatePipeline(traceOf(taken), { forwarding: true, branchPolicy: 'predict-not-taken' });
    expect(r.cycles).toBe(idealCycles(4) + 3);
    const disc = r.rows.filter((x) => x.kind === 'discarded');
    expect(disc).toHaveLength(3);
    expect(disc[0].text).toBe('(istruzione scartata)');
    // BEQZ: IF2 ID3 EX4 MEM5 (risolto al clk 5); scartate fetchate ai clk 3,4,5; flush al clk 6
    expect(disc[0].cells).toMatchObject({ 3: 'IF', 4: 'ID', 5: 'EX', 6: 'flush' });
    expect(disc[2].cells).toMatchObject({ 5: 'IF', 6: 'flush' });
    // l'istruzione al target parte al clk 6
    const tgt = r.rows.find((x) => x.kind === 'executed' && x.index === 2)!;
    expect(tgt.cells[6]).toBe('IF');
    // nessuna istruzione scartata arriva a WB
    for (const d of disc) expect(Object.values(d.cells)).not.toContain('WB');
  });
  it('risoluzione in EX o ID: 2 / 1 stalli (slide Stalli nel salto 2/3 e 3/3)', () => {
    const base: PipelineOptions = { forwarding: true, branchPolicy: 'stall' };
    expect(simulatePipeline(traceOf(taken), { ...base, branchResolve: 'MEM' }).cycles).toBe(idealCycles(4) + 3);
    expect(simulatePipeline(traceOf(taken), { ...base, branchResolve: 'EX' }).cycles).toBe(idealCycles(4) + 2);
    expect(simulatePipeline(traceOf(taken), { ...base, branchResolve: 'ID' }).cycles).toBe(idealCycles(4) + 1 + 1); // +1 per la ADDI->BEQZ con condizione letta in ID
    const pnt = simulatePipeline(traceOf(taken), { ...base, branchPolicy: 'predict-not-taken', branchResolve: 'EX' });
    expect(pnt.rows.filter((x) => x.kind === 'discarded')).toHaveLength(2);
  });
  it('salti incondizionati (J, JAL, JR) sono sempre una alea di controllo', () => {
    const t = traceOf(`
      JAL f
      HALT
f:    JR R31`);
    // JAL, JR, HALT
    expect(t.map((x) => x.decoded.def.mn)).toEqual(['JAL', 'JR', 'TRAP']);
    const r = simulatePipeline(t, FWD);
    // JAL -> 3 stalli; JR (usa R31 prodotto da JAL: late) -> +dipendenza; poi 3 stalli per JR
    expect(r.hazards.filter((h) => h.kind === 'control')).toHaveLength(2);
    const p = simulatePipeline(t, { ...FWD, branchPolicy: 'predict-not-taken' });
    expect(p.rows.filter((x) => x.kind === 'discarded').length).toBeGreaterThanOrEqual(6);
  });
  it('HALT non genera penalita\'', () => {
    const r = simulatePipeline(traceOf('HALT'), FWD);
    expect(r.cycles).toBe(5);
    expect(r.hazards).toHaveLength(0);
  });
  it('loop con SUBI/BNEZ: la dipendenza dal branch e\' risolta con forwarding', () => {
    const t = traceOf(`
      ADDI R1,R0,3
loop: SUBI R1,R1,1
      BNEZ R1,loop
      HALT`);
    const r = simulatePipeline(t, FWD);
    // 1 + 3*(2) + 1 = 8 istruzioni; 3 salti (2 presi, 1 no) -> 9 stalli di controllo
    expect(r.instructions).toBe(8);
    expect(r.cycles).toBe(idealCycles(8) + 9);
    const r2 = simulatePipeline(t, { ...FWD, branchPolicy: 'predict-not-taken' });
    expect(r2.cycles).toBe(idealCycles(8) + 6);
  });
});
