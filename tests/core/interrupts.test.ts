import { describe, it, expect } from 'vitest';
import { Machine } from '../../src/core/machine';
import type { DeviceConfig } from '../../src/core/bus/devices';
import { ButtonDevice, CounterDevice, InputDevice, LedDevice, OutputDevice, StartupDevice } from '../../src/core/bus/devices';
import { SimError } from '../../src/core/util';
import { fingerprint, mk, RAM } from './helpers';

const BASE: DeviceConfig[] = [
  { id: 'eprom', kind: 'eprom', name: 'EPROM', base: 0, size: 0x20000000 },
  { id: 'ram', kind: 'ram', name: 'RAM', base: 0x40000000, size: 0x40000000 },
];
const IN: DeviceConfig = { id: 'in', kind: 'input', name: 'INPUT', base: 0x80000000, size: 16 };
const BTN: DeviceConfig = { id: 'btn', kind: 'button', name: 'BTN', base: 0x90000000, size: 16 };
const CNT: DeviceConfig = { id: 'cnt', kind: 'counter', name: 'CNT', base: 0xa0000000, size: 16, params: { bits: 16, terminal: 3 } };
const OUT: DeviceConfig = { id: 'out', kind: 'output', name: 'OUT', base: 0xb0000000, size: 16 };
const ST: DeviceConfig = { id: 'st', kind: 'startup', name: 'STARTUP', base: 0xc0000000, size: 16 };
const LED: DeviceConfig = { id: 'led', kind: 'led', name: 'LED', base: 0xd0000000, size: 16 };

const dev = <T,>(m: Machine, id: string) => m.bus.devices.find((d) => d.cfg.id === id) as unknown as T;

describe('senza STARTUP: ien parte a 1', () => {
  it('il pulsante genera INT alla fine della prossima istruzione: IAR ← PC, PC ← 0, ien ← 0', () => {
    const m = mk('NOP\nNOP\nNOP\nHALT', {}, [...BASE, BTN]);
    expect(m.cpu.ien).toBe(true);
    dev<ButtonDevice>(m, 'btn').press();
    m.step(); // NOP @0 completa, poi INT
    expect(m.cpu.iar).toBe(4);
    expect(m.cpu.pc).toBe(0);
    expect(m.cpu.ien).toBe(false);
    expect(m.lastResult()!.interrupt).toEqual({ from: 4, sources: ['BTN'] });
    expect(m.lastResult()!.nextPC).toBe(0);
  });
  it('l\'interrupt NON avviene prima di un\'istruzione: l\'istruzione corrente completa i suoi effetti', () => {
    const m = mk('ADDI R1,R0,5\nHALT', { 1: 0 }, [...BASE, BTN]);
    dev<ButtonDevice>(m, 'btn').press();
    const r = m.step();
    expect(m.cpu.regs[1]).toBe(5);
    expect(r.interrupt).toBeDefined();
    expect(m.cpu.iar).toBe(4);
  });
  it('IAR dopo un salto preso è il target del salto', () => {
    const m = mk('J far\nNOP\nfar: HALT', {}, [...BASE, BTN]);
    dev<ButtonDevice>(m, 'btn').press();
    m.step();
    expect(m.cpu.iar).toBe(8);
  });
  it('nessun interrupt dopo HALT', () => {
    const m = mk('HALT', {}, [...BASE, BTN]);
    dev<ButtonDevice>(m, 'btn').press();
    const r = m.step();
    expect(r.halted).toBe(true);
    expect(r.interrupt).toBeUndefined();
    expect(m.cpu.pc).toBe(0);
  });
  it('senza richiesta pendente nessun interrupt', () => {
    const m = mk('NOP\nNOP\nHALT', {}, [...BASE, BTN]);
    expect(m.step().interrupt).toBeUndefined();
    expect(m.cpu.pc).toBe(4);
  });
});

describe('STARTUP', () => {
  it('con STARTUP ien parte a 0 e lo STARTUP vale 1', () => {
    const m = mk('NOP', {}, [...BASE, BTN, ST]);
    expect(m.cpu.ien).toBe(false);
    expect(dev<StartupDevice>(m, 'st').value).toBe(true);
  });
  it('una richiesta prima di STARTUP←0 non interrompe; subito dopo la scrittura sì', () => {
    const src = `
        LHI R20,0xC000
        NOP
        SW R0,4(R20)        ; CS_WRITE_STARTUP: STARTUP ← 0
        NOP
        HALT`;
    const m = mk(src, {}, [...BASE, BTN, ST]);
    dev<ButtonDevice>(m, 'btn').press();
    m.step(); // LHI
    expect(m.step().interrupt).toBeUndefined(); // NOP
    expect(m.cpu.ien).toBe(false);
    const r = m.step(); // SW → STARTUP=0 → ien=1 → INT subito
    expect(r.interrupt).toBeDefined();
    expect(m.cpu.iar).toBe(12);
    expect(m.cpu.pc).toBe(0);
    expect(m.cpu.ien).toBe(false); // l'interrupt l'ha di nuovo disabilitata
  });
  it('scrivere 1 su STARTUP non abilita le interruzioni', () => {
    const m = mk('LHI R20,0xC000\nADDI R1,R0,1\nSW R1,4(R20)\nNOP\nHALT', {}, [...BASE, BTN, ST]);
    dev<ButtonDevice>(m, 'btn').press();
    m.step(); m.step(); m.step();
    expect(m.cpu.ien).toBe(false);
    expect(dev<StartupDevice>(m, 'st').value).toBe(true);
  });
  it('lettura di CS_READ_STARTUP: 1 al boot, 0 dopo la scrittura; reset lo riporta a 1 e ien a 0', () => {
    const m = mk('LHI R20,0xC000\nLW R1,0(R20)\nSW R0,4(R20)\nLW R2,0(R20)\nHALT', { 1: 9, 2: 9 }, [...BASE, ST]);
    m.run();
    expect(m.cpu.regs[1]).toBe(1);
    expect(m.cpu.regs[2]).toBe(0);
    expect(m.cpu.ien).toBe(true);
    m.reset();
    expect(dev<StartupDevice>(m, 'st').value).toBe(true);
    expect(m.cpu.ien).toBe(false);
  });
  it('programma tipico d\'esame: boot / handler distinti leggendo STARTUP', () => {
    const src = `
        LHI R20,0xC000       ; STARTUP
        LHI R21,0x9000       ; BTN
        LHI R22,0x4000       ; RAM
        LW R1,0(R20)         ; 1 = boot, 0 = interrupt
        BNEZ R1,init
handler:
        LW R2,0(R21)         ; legge il FF
        SW R0,4(R21)         ; azzera il FF
        LW R3,0(R22)
        ADDI R3,R3,1
        SW R3,0(R22)
        RFE
init:   SW R0,0(R22)
        SW R0,4(R20)         ; STARTUP ← 0: abilita INT
main:   J main`;
    // NB: l'handler sta a un indirizzo diverso da 0 in questo schema semplificato:
    // al boot il codice parte da 0 e salta a init; l'interrupt riparte da 0, rilegge STARTUP=0 e cade nel handler.
    const m = mk(src, {}, [...BASE, BTN, ST]);
    const btn = dev<ButtonDevice>(m, 'btn');
    // esegue il boot fino al ciclo principale
    for (let i = 0; i < 12; i++) m.step();
    expect(m.cpu.ien).toBe(true);
    expect(m.lineOfPC()).toBe(src.split('\n').findIndex((l) => l.startsWith('main:')) + 1);
    for (let k = 1; k <= 3; k++) {
      btn.press();
      let guard = 0;
      // il ciclo "J main" è un selfloop, ma l'interrupt interviene
      const first = m.step();
      expect(first.interrupt).toBeDefined();
      while (m.cpu.pc !== m.program!.symbols.get('main')!.value && guard++ < 50) m.step();
      expect(guard).toBeLessThan(50);
      expect(m.bus.peekWord(RAM).value).toBe(k);
      expect(btn.ff).toBe(false);
      expect(m.cpu.ien).toBe(true);
    }
  });
});

describe('handler: RFE, IAR, ien disabilitato dentro l\'handler', () => {
  // handler a 0: salva il lavoro e RFE; main loop da 0x40
  const src = `
        J handler
        .org 0x40
main:   ADDI R10,R10,1
        J main
        .org 0x80
handler:
        LHI R21,0x9000
        SW R0,4(R21)          ; azzera FF
        ADDI R11,R11,1
        RFE`;
  const mkH = () => {
    const m = mk(src, { 10: 0, 11: 0 }, [...BASE, BTN]);
    m.cpu.pc = 0x40;
    return m;
  };
  it('esecuzione completa: handler eseguito una volta, main riprende dall\'istruzione interrotta', () => {
    const m = mkH();
    const btn = dev<ButtonDevice>(m, 'btn');
    m.step(); // ADDI R10 (1)
    btn.press();
    const r = m.step(); // J main → poi INT con IAR = 0x40
    expect(r.interrupt!.from).toBe(0x40);
    expect(m.cpu.iar).toBe(0x40);
    expect(m.cpu.pc).toBe(0);
    expect(m.cpu.ien).toBe(false);
    for (let i = 0; i < 8 && m.cpu.pc !== 0x40; i++) m.step();
    expect(m.cpu.pc).toBe(0x40);
    expect(m.cpu.regs[11]).toBe(1);
    expect(m.cpu.ien).toBe(true);
    expect(m.cpu.regs[10]).toBe(1);
  });
  it('durante l\'handler una nuova richiesta NON interrompe; dopo RFE sì, subito', () => {
    const m = mkH();
    const btn = dev<ButtonDevice>(m, 'btn');
    btn.press();
    m.step(); // INT
    expect(m.cpu.pc).toBe(0);
    // J handler @0, poi LHI, SW (azzera FF): ora premiamo di nuovo
    m.step(); // J handler → 0x80
    m.step(); // LHI
    m.step(); // SW azzera
    btn.press();
    const r1 = m.step(); // ADDI R11: ien=0 → nessun interrupt nonostante INT alto
    expect(r1.interrupt).toBeUndefined();
    expect(m.cpu.ien).toBe(false);
    const r2 = m.step(); // RFE: ien=1 e INT ancora alto → nuovo interrupt, IAR = indirizzo di ritorno
    expect(r2.interrupt!.from).toBe(0x44);
    expect(m.cpu.iar).toBe(0x44);
    expect(m.cpu.pc).toBe(0);
    expect(m.cpu.regs[11]).toBe(1);
  });
  it('FF non azzerato: dopo RFE l\'interrupt scatta di nuovo subito (INT a livello)', () => {
    const noClear = `
        J handler
        .org 0x40
main:   NOP
        J main
        .org 0x80
handler: RFE`;
    const m = mk(noClear, {}, [...BASE, BTN]);
    m.cpu.pc = 0x40;
    dev<ButtonDevice>(m, 'btn').press();
    m.step(); // INT: IAR=0x44
    expect(m.cpu.iar).toBe(0x44);
    m.step(); // J handler
    expect(m.cpu.pc).toBe(0x80);
    expect(m.cpu.ien).toBe(false);
    const r = m.step(); // RFE → ien=1, INT ancora attivo → nuovo interrupt con IAR=0x44 (indirizzo di ritorno)
    expect(r.interrupt).toBeDefined();
    expect(m.cpu.iar).toBe(0x44);
    expect(m.cpu.pc).toBe(0);
  });
  it('non si annida: finché ien=0 il PC resta nel handler anche con INT alto', () => {
    const m = mk('J h\n.org 0x20\nh: NOP\nNOP\nNOP\nNOP\nRFE', {}, [...BASE, BTN]);
    m.cpu.pc = 0x20;
    dev<ButtonDevice>(m, 'btn').press();
    m.step(); // NOP + INT
    expect(m.cpu.pc).toBe(0);
    m.step(); // J h
    for (let i = 0; i < 4; i++) {
      const r = m.step();
      expect(r.interrupt).toBeUndefined();
    }
    expect(m.cpu.pc).toBe(0x30);
    expect(m.cpu.iar).toBe(0x24);
  });
  it('annidamento manuale: MOVS2I/MOVI2S per salvare e ripristinare IAR', () => {
    const m = mk(`
        MOVS2I R1,IAR
        ADDI R2,R0,7
        MOVI2S IAR,R1
        RFE`, {}, BASE);
    m.cpu.iar = 0x100;
    m.cpu.ien = false;
    m.step(); m.step(); m.cpu.iar = 0x999; m.step();
    expect(m.cpu.iar).toBe(0x100);
    m.step();
    expect(m.cpu.pc).toBe(0x100);
    expect(m.cpu.ien).toBe(true);
  });
});

describe('porta di INPUT', () => {
  const h = `
        J handler
        .org 0x40
main:   NOP
        J main
        .org 0x80
handler:
        LHI R20,0x8000
        LW R1,0(R20)
        ADD R2,R2,R1
        RFE`;
  it('provide() solleva INT; la lettura di CS_INPUT restituisce il dato e azzera la richiesta', () => {
    const m = mk(h, { 2: 0 }, [...BASE, IN]);
    m.cpu.pc = 0x40;
    const inp = dev<InputDevice>(m, 'in');
    expect(inp.irq()).toBe(false);
    inp.provide(0x41);
    expect(inp.irq()).toBe(true);
    m.step();
    expect(m.cpu.pc).toBe(0);
    for (let i = 0; i < 6 && m.cpu.pc !== 0x40; i++) m.step();
    expect(m.cpu.regs[1]).toBe(0x41);
    expect(m.cpu.regs[2]).toBe(0x41);
    expect(inp.irq()).toBe(false);
  });
  it('il dato è mascherato alla larghezza (8 bit)', () => {
    const m = mk('NOP', {}, [...BASE, IN]);
    const inp = dev<InputDevice>(m, 'in');
    inp.provide(0x1ff);
    expect(inp.data).toBe(0xff);
  });
  it('larghezza 32 bit', () => {
    const m = mk('NOP', {}, [...BASE, { ...IN, params: { width: 32 } }]);
    const inp = dev<InputDevice>(m, 'in');
    inp.provide(0xdeadbeef);
    expect(inp.data).toBe(0xdeadbeef);
  });
  it('più dati in coda: dopo la lettura del primo il secondo è subito pronto', () => {
    const m = mk('LHI R20,0x8000\nLW R1,0(R20)\nLW R2,0(R20)\nLW R3,4(R20)\nHALT', {}, [...BASE, IN]);
    const inp = dev<InputDevice>(m, 'in');
    // niente interrupt (ien disabilitata artificialmente) per testare solo la porta
    m.cpu.ien = false;
    inp.provide(1);
    inp.provide(2);
    inp.provide(3);
    m.step(); m.step();
    expect(m.cpu.regs[1]).toBe(1);
    expect(inp.pending).toBe(true);
    m.step();
    expect(m.cpu.regs[2]).toBe(2);
    m.step(); // CS_STATUS: 1 = dato pronto (il terzo)
    expect(m.cpu.regs[3]).toBe(1);
    expect(inp.data).toBe(3);
  });
  it('CS_STATUS (offset 4) non azzera; scrittura su offset 8 azzera la richiesta senza leggere', () => {
    const m = mk('LHI R20,0x8000\nLW R1,4(R20)\nLW R2,4(R20)\nSW R0,8(R20)\nLW R3,4(R20)\nHALT', {}, [...BASE, IN]);
    m.cpu.ien = false;
    dev<InputDevice>(m, 'in').provide(5);
    m.run();
    expect([m.cpu.regs[1], m.cpu.regs[2], m.cpu.regs[3]]).toEqual([1, 1, 0]);
  });
  it('interrupt:false → nessuna richiesta di INT (polling)', () => {
    const m = mk('NOP\nHALT', {}, [...BASE, { ...IN, params: { interrupt: false } }]);
    dev<InputDevice>(m, 'in').provide(5);
    expect(m.bus.intLine()).toBe(false);
    expect(m.step().interrupt).toBeUndefined();
  });
  it('chip-select inesistente → errore leggibile; stato invariato', () => {
    const m = mk('LHI R20,0x8000\nLW R1,12(R20)\nHALT', {}, [...BASE, IN]);
    m.step();
    expect(() => m.step()).toThrow(/chip-select/);
    expect(m.cpu.pc).toBe(4);
    const n = mk('LHI R20,0x8000\nSW R1,0(R20)\nHALT', {}, [...BASE, IN]); // offset 0 è solo in lettura
    n.step();
    expect(() => n.step()).toThrow(SimError);
  });
});

describe('contatore', () => {
  it('INC incrementa; al valore terminale solleva INT; reset (offset 8) lo toglie', () => {
    const m = mk(`
        LHI R20,0xA000
        SW R0,4(R20)
        SW R0,4(R20)
        SW R0,4(R20)
        LW R1,0(R20)
        SW R0,8(R20)
        LW R2,0(R20)
        HALT`, {}, [...BASE, CNT]);
    m.cpu.ien = false;
    const c = dev<CounterDevice>(m, 'cnt');
    m.step(); m.step(); m.step();
    expect(c.value).toBe(2);
    expect(c.irq()).toBe(false);
    m.step();
    expect(c.value).toBe(3);
    expect(c.irq()).toBe(true);
    m.step();
    expect(m.cpu.regs[1]).toBe(3);
    m.step();
    expect(c.irq()).toBe(false);
    m.step();
    expect(m.cpu.regs[2]).toBe(0);
  });
  it('INT dal contatore interrompe il programma con ien=1', () => {
    const m = mk('LHI R20,0xA000\nSW R0,4(R20)\nSW R0,4(R20)\nSW R0,4(R20)\nNOP\nHALT', {}, [...BASE, CNT]);
    m.step(); m.step(); m.step();
    const r = m.step();
    expect(r.interrupt!.sources).toEqual(['CNT']);
    expect(m.cpu.iar).toBe(16);
  });
  it('wrap alla larghezza in bit', () => {
    const m = mk('LHI R20,0xA000\nSW R0,4(R20)\nSW R0,4(R20)\nSW R0,4(R20)\nSW R0,4(R20)\nSW R0,4(R20)\nHALT', {}, [...BASE, { ...CNT, params: { bits: 2, terminal: 0 } }]);
    m.cpu.ien = false;
    m.run();
    expect(dev<CounterDevice>(m, 'cnt').value).toBe(5 % 4);
    expect(dev<CounterDevice>(m, 'cnt').irq()).toBe(false);
  });
  it('terminal 0 = nessun INT', () => {
    const c = new CounterDevice({ ...CNT, params: { bits: 8, terminal: 0 } });
    for (let i = 0; i < 300; i++) c.write(0xa0000004);
    expect(c.value).toBe(300 % 256);
    expect(c.irq()).toBe(false);
  });
});

describe('periferiche semplici', () => {
  it('LED: lettura, toggle, set', () => {
    const m = mk(`
        LHI R20,0xD000
        LW R1,0(R20)
        SW R0,4(R20)        ; toggle → acceso
        LW R2,0(R20)
        SW R0,4(R20)        ; toggle → spento
        LW R3,0(R20)
        ADDI R5,R0,3
        SW R5,8(R20)        ; set a bit0 = 1
        LW R4,0(R20)
        SW R0,8(R20)        ; set a 0
        LW R6,0(R20)
        HALT`, {}, [...BASE, LED]);
    m.run();
    expect([1, 2, 3, 4, 6].map((i) => m.cpu.regs[i])).toEqual([0, 1, 0, 1, 0]);
    expect(dev<LedDevice>(m, 'led').on).toBe(false);
  });
  it('OUTPUT: scrive con maschera per dimensione, log e rilettura', () => {
    const m = mk(`
        LHI R20,0xB000
        LHI R1,0x1234
        ORI R1,R1,0x5678
        SW R1,0(R20)
        SH R1,0(R20)
        SB R1,0(R20)
        LW R2,4(R20)
        HALT`, {}, [...BASE, OUT]);
    m.run();
    const o = dev<OutputDevice>(m, 'out');
    expect(o.log).toEqual([0x12345678, 0x5678, 0x78]);
    expect(m.cpu.regs[2]).toBe(0x78);
    expect(o.last).toBe(0x78);
  });
  it('periferiche: i chip-select dichiarati hanno nomi dal nome del dispositivo', () => {
    const m = mk('NOP', {}, [...BASE, LED, BTN, ST, IN, OUT, CNT]);
    const names = (id: string) => m.bus.devices.find((d) => d.cfg.id === id)!.chipSelects().map((c) => c.name);
    expect(names('led')).toEqual(['CS_READ_LED', 'CS_SWITCH_LED', 'CS_WRITE_LED']);
    expect(names('st')).toEqual(['CS_READ_STARTUP', 'CS_WRITE_STARTUP']);
    expect(names('btn')).toEqual(['CS_READ_BTN', 'CS_RESET_INT_BTN']);
    expect(names('in')).toHaveLength(3);
    const st = m.bus.devices.find((d) => d.cfg.id === 'st')!.chipSelects();
    expect(st.map((c) => c.offset)).toEqual([0, 4]);
    expect(st.map((c) => c.access)).toEqual(['R', 'W']);
  });
  it('il log degli accessi riporta il chip-select', () => {
    const m = mk('LHI R20,0xD000\nSW R0,4(R20)\nLW R1,0(R20)\nHALT', {}, [...BASE, LED]);
    m.step();
    expect(m.step().mem.find((a) => a.kind === 'write')!.cs).toBe('CS_SWITCH_LED');
    expect(m.step().mem.find((a) => a.kind === 'read')!.cs).toBe('CS_READ_LED');
  });
  it('più richieste insieme: tutte le sorgenti sono elencate', () => {
    const m = mk('NOP\nHALT', {}, [...BASE, BTN, IN]);
    dev<ButtonDevice>(m, 'btn').press();
    dev<InputDevice>(m, 'in').provide(1);
    const r = m.step();
    expect(r.interrupt!.sources.sort()).toEqual(['BTN', 'INPUT']);
  });
});

describe('interrupt e stepBack', () => {
  it('stepBack dopo un interrupt ripristina pc, iar, ien e lo stato della periferica', () => {
    const m = mk('NOP\nNOP\nHALT', {}, [...BASE, BTN]);
    const before = fingerprint(m);
    dev<ButtonDevice>(m, 'btn').press();
    const pressed = fingerprint(m);
    m.step();
    expect(m.cpu.pc).toBe(0);
    m.stepBack();
    expect(fingerprint(m)).toBe(pressed);
    expect(before).not.toBe(pressed);
    expect(m.cpu.ien).toBe(true);
  });
  it('stepBack della scrittura che azzera STARTUP ripristina ien=0 e STARTUP=1', () => {
    const m = mk('LHI R20,0xC000\nSW R0,4(R20)\nNOP\nHALT', {}, [...BASE, ST]);
    m.step();
    const mid = fingerprint(m);
    m.step();
    expect(m.cpu.ien).toBe(true);
    m.stepBack();
    expect(fingerprint(m)).toBe(mid);
    expect(m.cpu.ien).toBe(false);
    expect(dev<StartupDevice>(m, 'st').value).toBe(true);
    // e rieseguendo si ottiene di nuovo lo stesso risultato
    m.step();
    expect(m.cpu.ien).toBe(true);
  });
  it('stepBack di una lettura che azzera la richiesta di INPUT la ripristina (con la coda)', () => {
    const m = mk('LHI R20,0x8000\nLW R1,0(R20)\nHALT', {}, [...BASE, IN]);
    m.cpu.ien = false;
    const inp = dev<InputDevice>(m, 'in');
    inp.provide(7);
    inp.provide(8);
    m.step();
    const mid = fingerprint(m);
    m.step();
    expect(m.cpu.regs[1]).toBe(7);
    expect(inp.data).toBe(8);
    m.stepBack();
    expect(fingerprint(m)).toBe(mid);
    expect(inp.data).toBe(7);
    expect(inp.queue).toEqual([8]);
  });
});
