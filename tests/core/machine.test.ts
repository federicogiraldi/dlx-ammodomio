import { describe, it, expect } from 'vitest';
import { DEFAULT_MAP, Machine } from '../../src/core/machine';
import { Bus, decodeMap, validateMap } from '../../src/core/bus/bus';
import type { DeviceConfig } from '../../src/core/bus/devices';
import { ButtonDevice, MemoryDevice } from '../../src/core/bus/devices';
import { SimError } from '../../src/core/util';
import { fingerprint, mk, RAM } from './helpers';

const LEDMAP: DeviceConfig[] = [
  ...DEFAULT_MAP,
  { id: 'out', kind: 'output', name: 'OUT', base: 0xb0000000, size: 16 },
  { id: 'btn', kind: 'button', name: 'BTN', base: 0xa0000000, size: 16 },
];

describe('Machine: load / reset / ready', () => {
  it('load assembla, carica in EPROM, resetta la CPU', () => {
    const m = new Machine();
    expect(m.ready).toBe(false);
    const p = m.load('ADDI R1,R0,5\nHALT');
    expect(p.ok).toBe(true);
    expect(m.ready).toBe(true);
    expect(m.cpu.pc).toBe(0);
    expect(m.bus.peekWord(0).value).toBe(0x20200005);
    expect(m.bus.peekWord(0).init).toBe(true);
    expect(m.lineOfPC(0)).toBe(1);
    expect(m.lineOfPC(4)).toBe(2);
    expect(m.lineOfPC(8)).toBeUndefined();
  });
  it('.data va nella prima RAM (0x40000000) e viene caricato', () => {
    const m = new Machine();
    m.load('LHI R1,0x4000\nLW R2,0(R1)\nHALT\n.data\nv: .word 0x12345678');
    expect(m.program!.symbols.get('v')!.value).toBe(0x40000000);
    expect(m.bus.peekWord(RAM).value).toBe(0x12345678);
    m.run();
    expect(m.cpu.regs[2]).toBe(0x12345678);
  });
  it('dataBase segue la prima RAM della mappa, anche se non è a 0x40000000', () => {
    const map: DeviceConfig[] = [
      { id: 'e', kind: 'eprom', name: 'EPROM', base: 0, size: 0x10000 },
      { id: 'r2', kind: 'ram', name: 'R2', base: 0x20000000, size: 0x10000 },
      { id: 'r1', kind: 'ram', name: 'R1', base: 0x10000000, size: 0x10000 },
    ];
    const m = new Machine(map);
    expect(m.dataBase()).toBe(0x10000000);
    m.load('.data\nx: .word 7');
    expect(m.program!.symbols.get('x')!.value).toBe(0x10000000);
    expect(m.loadErrors).toEqual([]);
  });
  it('reset ricarica l\'immagine: la RAM torna come dopo il caricamento', () => {
    const m = new Machine();
    m.load('LHI R1,0x4000\nSW R1,0(R1)\nHALT\n.data\nv: .word 5');
    m.run();
    expect(m.bus.peekWord(RAM).value).toBe(0x40000000);
    m.reset();
    expect(m.bus.peekWord(RAM).value).toBe(5);
    expect(m.cpu.pc).toBe(0);
    expect(m.cpu.halted).toBe(false);
    expect(m.history).toHaveLength(0);
  });
  it('un nuovo load azzera la RAM precedente (niente residui)', () => {
    const m = new Machine();
    m.load('.data\n.word 1,2,3');
    m.load('NOP\nHALT');
    expect(m.bus.peekWord(RAM).init).toBe(false);
  });
  it('programma con errori: ready=false e step lancia SimError', () => {
    const m = new Machine();
    const p = m.load('FOO R1');
    expect(p.ok).toBe(false);
    expect(m.ready).toBe(false);
    expect(() => m.step()).toThrow(SimError);
    expect(m.run().reason).toBe('error');
  });
  it('codice fuori da EPROM/RAM → loadErrors e non pronto', () => {
    const m = new Machine();
    m.load('.org 0x30000000\nNOP');
    expect(m.program!.ok).toBe(true);
    expect(m.loadErrors).toHaveLength(1);
    expect(m.ready).toBe(false);
    const n = new Machine();
    n.load('.data 0x90000000\n.word 1'); // indirizzo di una periferica
    expect(n.loadErrors).toHaveLength(1);
    expect(n.loadErrors[0].text.it).toContain('LED');
  });
  it('dati in EPROM: caricabili e leggibili, ma non scrivibili da programma', () => {
    const m = new Machine();
    m.load('LW R1,v(R0)\nSW R1,v(R0)\nHALT\nv: .word 9');
    m.step();
    expect(m.cpu.regs[1]).toBe(9);
    expect(() => m.step()).toThrow(/EPROM/);
  });
  it('setMap: errori di validazione → mappa invariata; mappa valida ricarica il programma', () => {
    const m = new Machine();
    m.load('NOP\nHALT');
    const errs = m.setMap([{ id: 'r', kind: 'ram', name: 'RAM', base: 0x40000000, size: 0x1000 }]);
    expect(errs.length).toBeGreaterThan(0);
    expect(m.map).toBe(DEFAULT_MAP);
    const ok = m.setMap(LEDMAP);
    expect(ok).toEqual([]);
    expect(m.bus.devices).toHaveLength(LEDMAP.length);
    expect(m.bus.peekWord(0).init).toBe(true);
    expect(m.cpu.pc).toBe(0);
  });
});

describe('Machine: step e stepBack', () => {
  const prog = `
        LHI R1,0x4000
        LHI R9,0xB000
        ADDI R2,R0,0
loop:   SLLI R3,R2,2
        ADD R3,R3,R1
        SW R2,0x100(R3)
        SB R2,0x200(R3)
        SH R2,0x300(R3)
        SW R2,0(R9)
        ADDI R2,R2,1
        SNEI R4,R2,10
        BNEZ R4,loop
        HALT`;
  const RANGES: [number, number][] = [[RAM + 0x100, 0x40], [RAM + 0x200, 0x40], [RAM + 0x300, 0x40]];

  it('stepBack ripristina esattamente registri, PC, memoria, periferiche e contatori in 80 passi', () => {
    const m = mk(prog, {}, LEDMAP);
    const snaps: string[] = [fingerprint(m, RANGES)];
    let n = 0;
    while (!m.cpu.halted && n < 200) {
      m.step();
      n++;
      snaps.push(fingerprint(m, RANGES));
    }
    expect(m.cpu.halted).toBe(true);
    expect(n).toBeGreaterThan(70);
    // verifica che la memoria sia davvero cambiata nel mezzo
    expect(snaps[snaps.length - 1]).not.toBe(snaps[0]);
    for (let i = snaps.length - 2; i >= 0; i--) {
      const prev = m.stepBack();
      expect(fingerprint(m, RANGES), `dopo stepBack a ${i}`).toBe(snaps[i]);
      if (i > 0) expect(prev).toBeDefined();
      else expect(prev).toBeUndefined();
    }
    expect(m.canStepBack()).toBe(false);
    expect(m.stepBack()).toBeUndefined();
    expect(m.trace).toHaveLength(0);
  });
  it('stepBack riporta a "non inizializzato" le celle di RAM scritte la prima volta', () => {
    const m = mk('LHI R1,0x4000\nSW R1,0x10(R1)\nHALT');
    m.step();
    m.step();
    expect(m.bus.peekWord(RAM + 0x10).init).toBe(true);
    m.stepBack();
    expect(m.bus.peekWord(RAM + 0x10).init).toBe(false);
    for (let i = 0; i < 4; i++) expect(m.bus.peek(RAM + 0x10 + i).init).toBe(false);
  });
  it('stepBack ripristina il vecchio valore se la cella era già scritta (SB su SW)', () => {
    const m = mk('LHI R1,0x4000\nADDI R2,R0,0x55\nSW R2,0(R1)\nADDI R3,R0,0x99\nSB R3,2(R1)\nHALT');
    for (let i = 0; i < 5; i++) m.step();
    expect(m.bus.peekWord(RAM).value).toBe(0x00009955);
    expect(m.bus.peek(RAM + 2).value).toBe(0x99);
    m.stepBack();
    expect(m.bus.peekWord(RAM).value).toBe(0x55);
  });
  it('stepBack restituisce il risultato del passo precedente; lastResult è coerente', () => {
    const m = mk('ADDI R1,R0,1\nADDI R2,R0,2\nHALT');
    const r1 = m.step();
    m.step();
    expect(m.lastResult()!.text).toBe('ADDI R2,R0,2');
    expect(m.stepBack()).toBe(r1);
    expect(m.lastResult()).toBe(r1);
    expect(m.trace).toEqual([r1]);
  });
  it('stepBack ripristina regInit (registro "mai scritto")', () => {
    const m = mk('ADDI R5,R0,1\nHALT');
    expect(m.cpu.regInit[5]).toBe(0);
    m.step();
    expect(m.cpu.regInit[5]).toBe(1);
    m.stepBack();
    expect(m.cpu.regInit[5]).toBe(0);
  });
  it('stepBack dopo HALT ripristina halted=false e consente di ri-eseguire', () => {
    const m = mk('ADDI R1,R0,3\nHALT');
    m.run();
    expect(m.cpu.halted).toBe(true);
    m.stepBack();
    expect(m.cpu.halted).toBe(false);
    expect(m.cpu.pc).toBe(4);
    expect(m.run().reason).toBe('halt');
  });
  it('stepBack ripristina lo stato della periferica OUTPUT (log) e LED', () => {
    const m = mk('LHI R9,0xB000\nADDI R2,R0,65\nSW R2,0(R9)\nSW R2,0(R9)\nHALT', {}, LEDMAP);
    m.run();
    const out = m.bus.devices.find((d) => d.cfg.id === 'out') as unknown as { log: number[] };
    expect(out.log).toEqual([65, 65]);
    m.stepBack(); // HALT
    m.stepBack(); // 2ª scrittura
    expect(out.log).toEqual([65]);
    m.stepBack();
    expect(out.log).toEqual([]);
  });
  it('un passo che fallisce lascia invariati stato, storia e traccia', () => {
    const m = mk('LHI R1,0x4000\nSW R1,0(R1)\nSW R1,0x41(R1)\nHALT');
    m.step();
    m.step();
    const before = fingerprint(m, [[RAM, 0x50]]);
    const hist = m.history.length;
    const trace = m.trace.length;
    expect(() => m.step()).toThrow(/Alignment/);
    expect(fingerprint(m, [[RAM, 0x50]])).toBe(before);
    expect(m.history).toHaveLength(hist);
    expect(m.trace).toHaveLength(trace);
    // più tentativi: ancora lo stesso errore, nessuna deriva
    expect(() => m.step()).toThrow(/Alignment/);
    expect(fingerprint(m, [[RAM, 0x50]])).toBe(before);
  });
  it('fallimento a metà istruzione (scrittura in EPROM, periferica sbagliata) non lascia effetti', () => {
    const m = mk('LHI R1,0xD000\nSW R1,0(R1)\nHALT', {}, LEDMAP); // 0xD0000000 non mappato
    m.step();
    const before = fingerprint(m);
    expect(() => m.step()).toThrow(SimError);
    expect(fingerprint(m)).toBe(before);
    const n = mk('SW R1,0(R0)', {}, LEDMAP);
    const b2 = fingerprint(n);
    expect(() => n.step()).toThrow(/EPROM/);
    expect(fingerprint(n)).toBe(b2);
  });
  it('lettura da periferica con chip-select sbagliato non altera lo stato della periferica', () => {
    const m = mk('LHI R9,0xA000\nLW R1,8(R9)\nHALT', {}, LEDMAP);
    (m.bus.devices.find((d) => d.cfg.id === 'btn') as unknown as ButtonDevice).press();
    m.cpu.ien = false;
    m.step();
    const before = fingerprint(m);
    expect(() => m.step()).toThrow(/chip-select/);
    expect(fingerprint(m)).toBe(before);
  });
  it('la storia è limitata a maxHistory', () => {
    const m = mk('L: NOP\nJ L');
    m.maxHistory = 5;
    for (let i = 0; i < 20; i++) m.step();
    expect(m.history).toHaveLength(5);
    let k = 0;
    while (m.canStepBack()) { m.stepBack(); k++; }
    expect(k).toBe(5);
  });
  it('reset e load azzerano storia e traccia', () => {
    const m = mk('NOP\nHALT');
    m.step();
    m.load('NOP\nHALT');
    expect(m.history).toHaveLength(0);
    expect(m.trace).toHaveLength(0);
    expect(m.canStepBack()).toBe(false);
  });
  it('registri: stepBack ripristina i valori casuali iniziali, non zero', () => {
    const m = mk('ADDI R7,R0,1\nHALT');
    const initial = m.cpu.regs[7];
    m.step();
    expect(m.cpu.regs[7]).toBe(1);
    m.stepBack();
    expect(m.cpu.regs[7]).toBe(initial);
  });
});

describe('Machine: run', () => {
  it('halt: restituisce il numero di passi', () => {
    const m = mk('NOP\nNOP\nHALT');
    expect(m.run()).toEqual({ steps: 3, reason: 'halt' });
    expect(m.run()).toEqual({ steps: 0, reason: 'halt' });
  });
  it('breakpoint: si ferma PRIMA di eseguire l\'istruzione; run successivo riparte da lì', () => {
    const m = mk('NOP\nNOP\nADDI R1,R0,9\nNOP\nHALT', { 1: 0 });
    m.breakpoints.add(8);
    const o = m.run();
    expect(o).toEqual({ steps: 2, reason: 'breakpoint' });
    expect(m.cpu.pc).toBe(8);
    expect(m.cpu.regs[1]).toBe(0);
    const o2 = m.run();
    expect(o2.reason).toBe('halt');
    expect(o2.steps).toBe(3);
    expect(m.cpu.regs[1]).toBe(9);
  });
  it('breakpoint all\'indirizzo iniziale ignorato al primo passo', () => {
    const m = mk('NOP\nHALT');
    m.breakpoints.add(0);
    expect(m.run().reason).toBe('halt');
    const k = mk('NOP\nHALT');
    k.breakpoints.add(0);
    expect(k.run(100, false)).toEqual({ steps: 0, reason: 'breakpoint' });
  });
  it('breakpoint dentro un ciclo si ferma a ogni giro', () => {
    const m = mk('ADDI R1,R0,3\nL: SUBI R1,R1,1\nBNEZ R1,L\nHALT');
    m.breakpoints.add(4);
    let hits = 0;
    for (let i = 0; i < 10; i++) {
      const o = m.run();
      if (o.reason !== 'breakpoint') break;
      hits++;
    }
    expect(hits).toBe(3); // una sosta per ciascuno dei 3 giri
    expect(m.cpu.halted).toBe(true);
  });
  it('limit: maxSteps', () => {
    const m = mk('L: ADDI R1,R1,1\nJ L');
    const o = m.run(50);
    expect(o).toEqual({ steps: 50, reason: 'limit' });
  });
  it('selfloop: "fine: J fine"', () => {
    const m = mk('ADDI R1,R0,1\nfine: J fine');
    const o = m.run();
    expect(o.reason).toBe('selfloop');
    expect(o.steps).toBe(2);
    expect(m.cpu.pc).toBe(4);
  });
  it('selfloop anche con BEQZ R0 (salto a se stesso)', () => {
    const m = mk('x: BEQZ R0,x');
    expect(m.run().reason).toBe('selfloop');
  });
  it('un ciclo che non è un selfloop (2+ istruzioni) non viene scambiato per tale', () => {
    const m = mk('a: NOP\nJ a');
    expect(m.run(30).reason).toBe('limit');
  });
  it('selfloop NON dichiarato se c\'è una periferica che può interrompere (button/input) e ien=1', () => {
    const m = mk('fine: J fine', {}, LEDMAP);
    expect(m.cpu.ien).toBe(false); // con STARTUP in mappa le interruzioni partono disabilitate
    // LEDMAP ha STARTUP → ien=0 → selfloop è giusto; senza STARTUP:
    const noSt: DeviceConfig[] = [DEFAULT_MAP[0], DEFAULT_MAP[1], { id: 'btn', kind: 'button', name: 'BTN', base: 0xa0000000, size: 16 }];
    const n = mk('fine: J fine', {}, noSt);
    expect(n.cpu.ien).toBe(true);
    expect(n.run(20).reason).toBe('limit');
  });
  it('error: istruzione non valida / fuori programma, con testo e pc', () => {
    const m = mk('NOP');
    const o = m.run();
    expect(o.reason).toBe('error');
    expect(o.steps).toBe(1);
    expect(o.error!.pc).toBe(4);
    expect(o.error!.text.it).toContain('EPROM non programmata');
    expect(o.error!.text.en).toContain('unprogrammed EPROM');
    // dopo l'errore lo stato è quello prima del passo fallito
    expect(m.cpu.pc).toBe(4);
    expect(m.cpu.instret).toBe(1);
  });
  it('error: alignment fault dentro run con registri invariati', () => {
    const m = mk('LHI R1,0x4000\nLW R2,2(R1)\nHALT', { 2: 77 });
    const o = m.run();
    expect(o.reason).toBe('error');
    expect(o.steps).toBe(1);
    expect(m.cpu.regs[2]).toBe(77);
  });
  it('saltare in RAM non inizializzata: il PC ci arriva ma non c e codice scritto', () => {
    const m = mk('LHI R1,0x4000\nJR R1');
    m.step();
    m.step();
    expect(m.cpu.pc).toBe(RAM);
    expect(m.bus.peekWord(RAM).init).toBe(false);
  });
  it('le eccezioni non SimError non vengono inghiottite', () => {
    const m = mk('NOP\nHALT');
    (m.cpu as unknown as { step: () => never }).step = () => { throw new TypeError('boom'); };
    expect(() => m.run()).toThrow(TypeError);
  });
  it('run dopo interrupt: il contatore di passi include l\'handler', () => {
    const noSt: DeviceConfig[] = [DEFAULT_MAP[0], DEFAULT_MAP[1], { id: 'btn', kind: 'button', name: 'BTN', base: 0xa0000000, size: 16 }];
    const m = mk('J h\n.org 0x20\nmain: ADDI R1,R1,1\nSUBI R2,R2,1\nBNEZ R2,main\nHALT\n.org 0x80\nh: LHI R9,0xA000\nSW R0,4(R9)\nRFE', { 1: 0, 2: 3 }, noSt);
    m.cpu.pc = 0x20;
    (m.bus.devices.find((d) => d.cfg.id === 'btn') as unknown as ButtonDevice).press();
    const o = m.run();
    expect(o.reason).toBe('halt');
    expect(m.cpu.regs[1]).toBe(3);
    expect(m.cpu.ien).toBe(true);
  });
});

describe('Bus', () => {
  it('find: confini dei dispositivi', () => {
    const m = new Machine();
    const b = m.bus;
    expect(b.find(0)!.cfg.id).toBe('eprom');
    expect(b.find(0x1fffffff)!.cfg.id).toBe('eprom');
    expect(b.find(0x20000000)).toBeUndefined();
    expect(b.find(0x40000000)!.cfg.id).toBe('ram1');
    expect(b.find(0x7fffffff)!.cfg.id).toBe('ram1');
    expect(b.find(0x80000000)).toBeUndefined();
    expect(b.find(0x9000000f)!.cfg.id).toBe('led');
    expect(b.find(0x90000010)).toBeUndefined();
    expect(b.find(0xc0000000)!.cfg.id).toBe('startup');
    expect(b.find(0xe0000000)!.cfg.id).toBe('ram2');
    expect(b.find(0xffffffff)!.cfg.id).toBe('ram2');
    expect(b.find(-1)!.cfg.id).toBe('ram2'); // indirizzi "negativi" JS trattati come uint32
  });
  it('read/write con indirizzi negativi JS', () => {
    const m = new Machine();
    m.bus.write(-4, 4, 0xdeadbeef);
    expect(m.bus.read(0xfffffffc, 4)).toBe(0xdeadbeef);
  });
  it('write/read word, half, byte e big-endian; maschera del valore', () => {
    const m = new Machine();
    m.bus.write(RAM, 4, 0x01020304);
    expect(m.bus.read(RAM, 2)).toBe(0x0102);
    expect(m.bus.read(RAM + 2, 2)).toBe(0x0304);
    expect(m.bus.read(RAM + 1, 1)).toBe(0x02);
    m.bus.write(RAM + 1, 1, 0x1ff);
    expect(m.bus.read(RAM, 4)).toBe(0x01ff0304);
    m.bus.write(RAM + 2, 2, 0x12345);
    expect(m.bus.read(RAM, 4)).toBe(0x01ff2345);
  });
  it('allineamento: word/half', () => {
    const m = new Machine();
    for (const [a, sz] of [[1, 4], [2, 4], [3, 4], [1, 2]] as const) {
      expect(() => m.bus.read(RAM + a, sz)).toThrow(/Alignment/);
      expect(() => m.bus.write(RAM + a, sz, 0)).toThrow(/Alignment/);
    }
    expect(() => m.bus.read(RAM + 1, 1)).not.toThrow();
  });
  it('peek/peekWord non hanno effetti collaterali sulle periferiche e su indirizzi non mappati', () => {
    const m = new Machine(LEDMAP);
    expect(m.bus.peek(0x20000000)).toEqual({ value: 0, init: false });
    expect(m.bus.peekWord(0x90000000).init).toBe(false);
    const btn = m.bus.devices.find((d) => d.cfg.id === 'btn') as unknown as ButtonDevice;
    btn.press();
    m.bus.peekWord(0xa0000000);
    expect(btn.ff).toBe(true);
  });
  it('log degli accessi: kind, size, device', () => {
    const m = new Machine();
    m.bus.log = [];
    m.bus.write(RAM, 2, 0xabcd);
    m.bus.read(RAM, 2);
    m.bus.read(0, 4, 'fetch');
    expect(m.bus.log.map((a) => [a.kind, a.size, a.device])).toEqual([['write', 2, 'RAM'], ['read', 2, 'RAM'], ['fetch', 4, 'EPROM']]);
  });
  it('MemoryDevice: pagine, EPROM non programmata = 0xFF, RAM garbage stabile', () => {
    const b = new Bus(DEFAULT_MAP);
    const e = b.devices[0] as MemoryDevice;
    expect(e.peekByte(0x1234)).toEqual({ value: 0xff, init: false });
    e.program(0x1234, 0x42);
    expect(e.peekByte(0x1234)).toEqual({ value: 0x42, init: true });
    const r = b.find(RAM) as MemoryDevice;
    const g1 = r.peekByte(RAM + 10);
    const g2 = r.peekByte(RAM + 10);
    expect(g1.init).toBe(false);
    expect(g1.value).toBe(g2.value);
    // attraversa il confine di pagina (4096) senza problemi
    b.write(RAM + 4092, 4, 0x01020304);
    b.write(RAM + 4096, 4, 0x05060708);
    expect(b.read(RAM + 4092, 4)).toBe(0x01020304);
    expect(b.read(RAM + 4096, 2)).toBe(0x0506);
  });
  it('indirizzi molto alti nel MemoryDevice (> 2^31) funzionano', () => {
    const m = new Machine();
    m.bus.write(0xfffffff0, 4, 0xcafef00d);
    expect(m.bus.read(0xfffffff0, 4)).toBe(0xcafef00d);
    m.bus.write(0xffffffff - 3, 4, 0x11223344);
    expect(m.bus.read(0xfffffffc, 4)).toBe(0x11223344);
  });
});

describe('validateMap', () => {
  const E: DeviceConfig = { id: 'e', kind: 'eprom', name: 'EPROM', base: 0, size: 0x1000 };
  const R: DeviceConfig = { id: 'r', kind: 'ram', name: 'RAM', base: 0x1000, size: 0x1000 };
  it('mappa di default valida', () => {
    expect(validateMap(DEFAULT_MAP)).toEqual([]);
    expect(validateMap([E, R])).toEqual([]);
  });
  it('dimensione non potenza di 2 / zero / negativa', () => {
    expect(validateMap([E, { ...R, size: 3000 }]).length).toBeGreaterThan(0);
    expect(validateMap([E, { ...R, size: 0 }]).length).toBeGreaterThan(0);
    expect(validateMap([E, { ...R, size: -4096 }]).length).toBeGreaterThan(0);
  });
  it('base non multipla della dimensione', () => {
    const errs = validateMap([E, { ...R, base: 0x1800 }]);
    expect(errs.some((e) => /multiplo/.test(e.it))).toBe(true);
    expect(errs.every((e) => e.it.length > 0 && e.en.length > 0)).toBe(true);
  });
  it('sovrapposizione', () => {
    const errs = validateMap([E, { ...R, base: 0x0800, size: 0x800 }]);
    expect(errs.some((e) => /sovrappongono/.test(e.it))).toBe(true);
    // contenimento
    expect(validateMap([E, { ...R, base: 0, size: 0x100 }]).some((e) => /sovrappongono/.test(e.it))).toBe(true);
  });
  it('manca la EPROM a 0', () => {
    expect(validateMap([R]).some((e) => /EPROM/.test(e.it))).toBe(true);
    expect(validateMap([{ ...E, kind: 'ram' }, R]).some((e) => /EPROM/.test(e.it))).toBe(true);
    expect(validateMap([{ ...E, base: 0x1000 }, { ...R, base: 0x2000 }]).some((e) => /EPROM/.test(e.it))).toBe(true);
  });
  it('oltre i 4 GB', () => {
    const big: DeviceConfig = { id: 'x', kind: 'ram', name: 'X', base: 0xf0000000, size: 0x20000000 };
    expect(validateMap([E, big]).length).toBeGreaterThan(0);
    expect(validateMap([E, { ...big, base: 0xe0000000 }])).toEqual([]);
  });
  it('periferiche piccole (16 byte) alla fine dello spazio', () => {
    expect(validateMap([E, { id: 'l', kind: 'led', name: 'LED', base: 0xfffffff0, size: 16 }])).toEqual([]);
  });
});

describe('decodeMap', () => {
  const dm = decodeMap(DEFAULT_MAP);
  const by = (n: string) => dm.find((d) => d.name === n)!;
  it('un elemento per dispositivo con range corretto', () => {
    expect(dm.map((d) => d.name)).toEqual(['EPROM', 'RAM', 'LED', 'STARTUP', 'RAM_H']);
    expect(by('EPROM').range).toEqual([0, 0x1fffffff]);
    expect(by('RAM').range).toEqual([0x40000000, 0x7fffffff]);
    expect(by('LED').range).toEqual([0x90000000, 0x9000000f]);
    expect(by('RAM_H').range).toEqual([0xe0000000, 0xffffffff]);
  });
  it('decodifica completa: tutti i bit di indirizzo alto del blocco', () => {
    expect(by('EPROM').full).toBe('BA31*·BA30*·BA29*');
    expect(by('RAM').full).toBe('BA31*·BA30');
    expect(by('RAM_H').full).toBe('BA31·BA30·BA29');
    expect(by('LED').full.split('·')).toHaveLength(28); // bit 31..4
  });
  it('decodifica semplificata: solo i bit minimi (EPROM = BA31*·BA30*)', () => {
    expect(by('EPROM').simplified).toBe('BA31*·BA30*');
    expect(by('RAM').simplified).toBe('BA31*·BA30');
    expect(by('RAM_H').simplified).toBe('BA31·BA29');
  });
  it('semplificata: sempre ≤ completa e ancora univoca (nessun indirizzo mappato attiva due dispositivi)', () => {
    // verifica semantica: per ogni indirizzo campione, esattamente un dispositivo (o nessuno) attivo
    const termMatch = (expr: string, addr: number) =>
      expr === '1' || expr.split('·').every((t) => {
        const neg = t.endsWith('*');
        const bit = Number(t.replace('BA', '').replace('*', ''));
        const v = (addr >>> bit) & 1;
        return neg ? v === 0 : v === 1;
      });
    const samples = [0, 0x1000, 0x1fffffff, 0x40000000, 0x7ffffffc, 0x90000000, 0x9000000c, 0xc0000000, 0xc0000004, 0xe0000000, 0xfffffffc];
    for (const a of samples) {
      const active = dm.filter((d) => termMatch(d.simplified, a)).map((d) => d.name);
      const real = DEFAULT_MAP.filter((c) => a >>> 0 >= c.base >>> 0 && a >>> 0 <= (c.base + c.size - 1) >>> 0).map((c) => c.name);
      expect(active, `0x${a.toString(16)}`).toEqual(real);
    }
    for (const d of dm) expect(d.simplified.split('·').length).toBeLessThanOrEqual(d.full.split('·').length);
  });
  it('chip-select delle periferiche: indirizzi e espressioni con MEMRD/MEMWR', () => {
    const led = by('LED').chipSelects;
    expect(led.map((c) => c.name)).toEqual(['CS_READ_LED', 'CS_SWITCH_LED', 'CS_WRITE_LED']);
    expect(led.map((c) => c.addr)).toEqual([0x90000000, 0x90000004, 0x90000008]);
    expect(led[0].expr).toContain('MEMRD');
    expect(led[1].expr).toContain('MEMWR');
    expect(led[0].expr).toContain('BA3*·BA2*');
    expect(led[1].expr).toContain('BA3*·BA2');
    expect(led[2].expr).toContain('BA3·BA2*');
    const st = by('STARTUP').chipSelects;
    expect(st.map((c) => c.addr)).toEqual([0xc0000000, 0xc0000004]);
  });
  it('memorie: quattro chip-select di byte (BE0..BE3)', () => {
    const cs = by('RAM').chipSelects;
    expect(cs).toHaveLength(4);
    expect(cs.map((c) => c.expr)).toEqual(['CS_RAM·BE0', 'CS_RAM·BE1', 'CS_RAM·BE2', 'CS_RAM·BE3']);
  });
  it('mappa a un solo dispositivo: decodifica semplificata "1" (sempre attivo)', () => {
    const d = decodeMap([{ id: 'e', kind: 'eprom', name: 'E', base: 0, size: 0x10000 }]);
    expect(d[0].simplified).toBe('1');
  });
  it('mappa di esame tipica: EPROM+RAM+periferiche, la semplificata risulta più corta della completa', () => {
    const d = decodeMap([
      { id: 'e', kind: 'eprom', name: 'EPROM', base: 0, size: 0x10000000 },
      { id: 'r', kind: 'ram', name: 'RAM', base: 0x10000000, size: 0x10000000 },
      { id: 'i', kind: 'input', name: 'IN', base: 0x20000000, size: 16 },
    ]);
    const e = d.find((x) => x.name === 'EPROM')!;
    expect(e.full.split('·').length).toBe(4); // BA31..BA28
    expect(e.simplified.split('·').length).toBeLessThan(4);
  });
});
