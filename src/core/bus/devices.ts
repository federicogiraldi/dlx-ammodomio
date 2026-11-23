import { Txt, txt, hex, SimError } from '../util';

export type DeviceKind = 'ram' | 'eprom' | 'led' | 'startup' | 'input' | 'output' | 'counter' | 'button';

/** Un chip-select di una rete logica: un indirizzo e il tipo di accesso che lo attiva. */
export interface ChipSelect {
  name: string; // es. CS_READ_LED
  offset: number; // rispetto alla base del dispositivo
  access: 'R' | 'W';
  doc: Txt;
}

export interface DeviceConfig {
  id: string;
  kind: DeviceKind;
  name: string;
  base: number;
  /** dimensione in byte (potenza di 2, base allineata) */
  size: number;
  /** parametri specifici */
  params?: Record<string, number | boolean | string>;
}

export interface AccessInfo {
  garbage?: boolean;
}

export abstract class Device {
  constructor(public cfg: DeviceConfig) {}
  get base() { return this.cfg.base >>> 0; }
  get end() { return (this.cfg.base + this.cfg.size - 1) >>> 0; }
  abstract read(addr: number, size: 1 | 2 | 4, info: AccessInfo): number;
  abstract write(addr: number, size: 1 | 2 | 4, value: number): void;
  abstract reset(): void;
  /** livello della richiesta di interrupt verso INT */
  irq(): boolean { return false; }
  /** stato serializzabile per lo step indietro */
  abstract save(): unknown;
  abstract load(s: unknown): void;
  chipSelects(): ChipSelect[] { return []; }
  /** testo breve dello stato per la UI */
  status(): Txt | null { return null; }
}

// ------------------------------------------------------------------
// Memorie: RAM ed EPROM, sparse a pagine
// ------------------------------------------------------------------

const PAGE = 4096;

function garbageByte(addr: number, seed: number): number {
  let x = (addr ^ seed) >>> 0;
  x ^= x << 13; x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5; x >>>= 0;
  return x & 0xff;
}

export class MemoryDevice extends Device {
  pages = new Map<number, { data: Uint8Array; init: Uint8Array }>();
  seed = (Math.random() * 0xffffffff) >>> 0;

  get readOnly() { return this.cfg.kind === 'eprom'; }

  private page(addr: number, create: boolean) {
    const idx = Math.floor(addr / PAGE);
    let p = this.pages.get(idx);
    if (!p && create) {
      p = { data: new Uint8Array(PAGE), init: new Uint8Array(PAGE) };
      this.pages.set(idx, p);
    }
    return p;
  }

  peekByte(addr: number): { value: number; init: boolean } {
    const p = this.page(addr, false);
    const o = addr % PAGE;
    if (p && p.init[o]) return { value: p.data[o], init: true };
    // EPROM non programmata: 0xFF (celle cancellate); RAM: valore casuale
    return { value: this.readOnly ? 0xff : garbageByte(addr, this.seed), init: false };
  }

  pokeByte(addr: number, v: number) {
    const p = this.page(addr, true)!;
    const o = addr % PAGE;
    p.data[o] = v & 0xff;
    p.init[o] = 1;
  }

  read(addr: number, size: 1 | 2 | 4, info: AccessInfo): number {
    let v = 0;
    for (let i = 0; i < size; i++) {
      const b = this.peekByte(addr + i);
      if (!b.init && !this.readOnly) info.garbage = true;
      v = v * 256 + b.value;
    }
    return v >>> 0;
  }

  write(addr: number, size: 1 | 2 | 4, value: number) {
    if (this.readOnly) {
      throw new SimError(txt(
        `Scrittura nella EPROM "${this.cfg.name}" all'indirizzo ${hex(addr)}: una EPROM è a sola lettura! Scrivi i dati in RAM.`,
        `Write to EPROM "${this.cfg.name}" at ${hex(addr)}: an EPROM is read-only! Store data in RAM.`,
      ));
    }
    for (let i = size - 1; i >= 0; i--) {
      this.pokeByte(addr + i, value & 0xff);
      value >>>= 8;
    }
  }

  /** usato dal loader per programmare anche la EPROM */
  program(addr: number, v: number) { this.pokeByte(addr, v); }

  reset() { /* la RAM mantiene il contenuto finché non si ricarica il programma */ }
  clear() { this.pages.clear(); }

  save() { return null; }
  load() {}
}

// ------------------------------------------------------------------
// Reti logiche (periferiche). Ogni chip-select è a un offset multiplo di 4,
// come nelle soluzioni d'esame (es. CS_READ_LED = 0x90000000, CS_SWITCH_LED = 0x90000004).
// Il segnale letto compare nei bit meno significativi del dato.
// ------------------------------------------------------------------

abstract class Peripheral extends Device {
  protected abstract css(): ChipSelect[];
  chipSelects() { return this.css(); }
  protected csAt(addr: number, access: 'R' | 'W'): ChipSelect {
    const off = (addr - this.base) >>> 0;
    const cs = this.css().find((c) => c.offset === (off & ~3) && c.access === access);
    if (!cs) {
      const avail = this.css().map((c) => `${c.name} (${c.access === 'R' ? 'lettura' : 'scrittura'}) = ${hex(this.base + c.offset)}`).join(', ');
      const availEn = this.css().map((c) => `${c.name} (${c.access === 'R' ? 'read' : 'write'}) = ${hex(this.base + c.offset)}`).join(', ');
      throw new SimError(txt(
        `${access === 'R' ? 'Lettura' : 'Scrittura'} all'indirizzo ${hex(addr)} del dispositivo "${this.cfg.name}": nessun chip-select risponde. Disponibili: ${avail}.`,
        `${access === 'R' ? 'Read' : 'Write'} at ${hex(addr)} of device "${this.cfg.name}": no chip-select responds. Available: ${availEn}.`,
      ));
    }
    return cs;
  }
}

const cs = (name: string, offset: number, access: 'R' | 'W', it: string, en: string): ChipSelect => ({ name, offset, access, doc: txt(it, en) });

export class LedDevice extends Peripheral {
  on = false;
  lastAccess: string | null = null;
  protected css() {
    const n = this.cfg.name.toUpperCase().replace(/\W+/g, '_');
    return [
      cs(`CS_READ_${n}`, 0, 'R', 'legge lo stato del LED (1 = acceso)', 'reads the LED state (1 = on)'),
      cs(`CS_SWITCH_${n}`, 4, 'W', 'inverte lo stato del LED (qualsiasi dato)', 'toggles the LED (any data)'),
      cs(`CS_WRITE_${n}`, 8, 'W', 'imposta il LED al bit 0 del dato', 'sets the LED to bit 0 of the data'),
    ];
  }
  read(addr: number) { this.csAt(addr, 'R'); return this.on ? 1 : 0; }
  write(addr: number, _s: number, v: number) {
    const c = this.csAt(addr, 'W');
    if (c.offset === 4) this.on = !this.on;
    else this.on = (v & 1) === 1;
  }
  reset() { this.on = false; }
  save() { return this.on; }
  load(s: unknown) { this.on = s as boolean; }
  status() { return this.on ? txt('acceso', 'on') : txt('spento', 'off'); }
}

export class StartupDevice extends Peripheral {
  value = true;
  protected css() {
    return [
      cs('CS_READ_STARTUP', 0, 'R', 'legge il segnale STARTUP (1 dopo il RESET)', 'reads STARTUP (1 after RESET)'),
      cs('CS_WRITE_STARTUP', 4, 'W', 'imposta STARTUP al bit 0 del dato (di solito 0 a fine inizializzazione)', 'sets STARTUP to bit 0 of data (usually 0 at end of init)'),
    ];
  }
  read(addr: number) { this.csAt(addr, 'R'); return this.value ? 1 : 0; }
  write(addr: number, _s: number, v: number) { this.csAt(addr, 'W'); this.value = (v & 1) === 1; }
  reset() { this.value = true; }
  save() { return this.value; }
  load(s: unknown) { this.value = s as boolean; }
  status() { return txt(`STARTUP = ${this.value ? 1 : 0}`); }
}

/** Porta di INPUT: l'utente inserisce un dato e preme "dato pronto" → interrupt. */
export class InputDevice extends Peripheral {
  data = 0;
  pending = false;
  queue: number[] = [];
  get width() { return Number(this.cfg.params?.width ?? 8); }
  get useInt() { return this.cfg.params?.interrupt !== false; }
  protected css() {
    const n = this.cfg.name.toUpperCase().replace(/\W+/g, '_');
    return [
      cs(`CS_${n}`, 0, 'R', 'legge il dato della porta (e azzera la richiesta di interrupt)', 'reads the port data (and clears the interrupt request)'),
      cs(`CS_STATUS_${n}`, 4, 'R', 'legge 1 se c\'è un dato pronto non ancora letto', 'reads 1 if new data is ready'),
      cs(`CS_RESET_INT_${n}`, 8, 'W', 'azzera la richiesta di interrupt senza leggere il dato', 'clears the interrupt request'),
    ];
  }
  /** chiamato dalla UI */
  provide(v: number) {
    const mask = this.width >= 32 ? 0xffffffff : (1 << this.width) - 1;
    if (this.pending) this.queue.push(v & mask);
    else {
      this.data = (v & mask) >>> 0;
      this.pending = true;
    }
  }
  read(addr: number) {
    const c = this.csAt(addr, 'R');
    if (c.offset === 4) return this.pending ? 1 : 0;
    const v = this.data;
    this.pending = false;
    if (this.queue.length) {
      this.data = this.queue.shift()!;
      this.pending = true;
    }
    return v;
  }
  write(addr: number) { this.csAt(addr, 'W'); this.pending = false; }
  irq() { return this.useInt && this.pending; }
  reset() { this.pending = false; this.queue = []; }
  save() { return { d: this.data, p: this.pending, q: [...this.queue] }; }
  load(s: unknown) { const o = s as { d: number; p: boolean; q: number[] }; this.data = o.d; this.pending = o.p; this.queue = [...o.q]; }
  status() { return this.pending ? txt(`dato pronto: ${hex(this.data, 2)}`, `data ready: ${hex(this.data, 2)}`) : txt('in attesa', 'idle'); }
}

/** Porta di OUTPUT: mostra l'ultimo dato scritto e un piccolo terminale di caratteri. */
export class OutputDevice extends Peripheral {
  last: number | null = null;
  log: number[] = [];
  protected css() {
    const n = this.cfg.name.toUpperCase().replace(/\W+/g, '_');
    return [
      cs(`CS_${n}`, 0, 'W', 'scrive un dato sulla porta (visualizzato come numero e come carattere)', 'writes a value to the port'),
      cs(`CS_READ_${n}`, 4, 'R', 'rilegge l\'ultimo dato scritto', 'reads back the last written value'),
    ];
  }
  read(addr: number) { this.csAt(addr, 'R'); return this.last ?? 0; }
  write(addr: number, size: number, v: number) {
    this.csAt(addr, 'W');
    const mask = size === 1 ? 0xff : size === 2 ? 0xffff : 0xffffffff;
    this.last = (v & mask) >>> 0;
    this.log.push(this.last);
    if (this.log.length > 500) this.log.shift();
  }
  reset() { this.last = null; this.log = []; }
  save() { return { l: this.last, g: [...this.log] }; }
  load(s: unknown) { const o = s as { l: number | null; g: number[] }; this.last = o.l; this.log = [...o.g]; }
  status() { return this.last === null ? txt('nessun dato', 'no data') : txt(`ultimo: ${hex(this.last, 2)} (${this.last})`, `last: ${hex(this.last, 2)} (${this.last})`); }
}

/** Contatore: incrementato via software, genera interrupt al raggiungimento del valore finale. */
export class CounterDevice extends Peripheral {
  value = 0;
  reached = false;
  get bits() { return Number(this.cfg.params?.bits ?? 16); }
  get terminal() { return Number(this.cfg.params?.terminal ?? 0); }
  protected css() {
    const n = this.cfg.name.toUpperCase().replace(/\W+/g, '_');
    return [
      cs(`CS_READ_${n}`, 0, 'R', 'legge il valore del contatore', 'reads the counter value'),
      cs(`CS_INC_${n}`, 4, 'W', 'incrementa il contatore di 1 (qualsiasi dato)', 'increments the counter (any data)'),
      cs(`CS_RESET_${n}`, 8, 'W', 'azzera contatore e richiesta di interrupt', 'resets counter and interrupt request'),
    ];
  }
  read(addr: number) { this.csAt(addr, 'R'); return this.value; }
  write(addr: number) {
    const c = this.csAt(addr, 'W');
    if (c.offset === 4) {
      const mask = this.bits >= 32 ? 0xffffffff : (1 << this.bits) - 1;
      this.value = ((this.value + 1) & mask) >>> 0;
      if (this.terminal > 0 && this.value === this.terminal) this.reached = true;
    } else {
      this.value = 0;
      this.reached = false;
    }
  }
  irq() { return this.reached; }
  reset() { this.value = 0; this.reached = false; }
  save() { return [this.value, this.reached]; }
  load(s: unknown) { const [v, r] = s as [number, boolean]; this.value = v; this.reached = r; }
  status() { return txt(`valore ${this.value}${this.reached ? ' — INT attivo' : ''}`, `value ${this.value}${this.reached ? ' — INT active' : ''}`); }
}

/** Pulsante con flip-flop D "da fronte a livello" (slide 04): premuto → INT a 1 finché il software non lo azzera. */
export class ButtonDevice extends Peripheral {
  ff = false;
  protected css() {
    const n = this.cfg.name.toUpperCase().replace(/\W+/g, '_');
    return [
      cs(`CS_READ_${n}`, 0, 'R', 'legge il flip-flop (1 = premuto e non ancora servito)', 'reads the flip-flop (1 = pressed, not yet served)'),
      cs(`CS_RESET_INT_${n}`, 4, 'W', 'azzera il flip-flop (A_RES) e quindi la richiesta di interrupt', 'clears the flip-flop and the interrupt request'),
    ];
  }
  press() { this.ff = true; }
  read(addr: number) { this.csAt(addr, 'R'); return this.ff ? 1 : 0; }
  write(addr: number) { this.csAt(addr, 'W'); this.ff = false; }
  irq() { return this.ff; }
  reset() { this.ff = false; }
  save() { return this.ff; }
  load(s: unknown) { this.ff = s as boolean; }
  status() { return this.ff ? txt('INT attivo', 'INT active') : txt('a riposo', 'idle'); }
}

export function createDevice(cfg: DeviceConfig): Device {
  switch (cfg.kind) {
    case 'ram':
    case 'eprom': return new MemoryDevice(cfg);
    case 'led': return new LedDevice(cfg);
    case 'startup': return new StartupDevice(cfg);
    case 'input': return new InputDevice(cfg);
    case 'output': return new OutputDevice(cfg);
    case 'counter': return new CounterDevice(cfg);
    case 'button': return new ButtonDevice(cfg);
  }
}

export const KIND_INFO: Record<DeviceKind, { label: Txt; defaultSize: number; doc: Txt; memory: boolean }> = {
  eprom: { label: txt('EPROM'), defaultSize: 0x20000000, memory: true, doc: txt('Memoria a sola lettura: contiene il programma (a partire da 0x00000000, dove il DLX inizia dopo il RESET e dove salta in caso di interrupt).', 'Read-only memory: holds the program (from 0x00000000, where the DLX starts after RESET and jumps on interrupts).') },
  ram: { label: txt('RAM'), defaultSize: 0x20000000, memory: true, doc: txt('Memoria di lettura/scrittura per i dati. All\'accensione contiene valori casuali.', 'Read/write data memory. Holds random values at power-on.') },
  led: { label: txt('LED'), defaultSize: 16, memory: false, doc: txt('Rete con flip-flop che pilota un LED, inizialmente spento.', 'Flip-flop network driving a LED, initially off.') },
  startup: { label: txt('STARTUP'), defaultSize: 16, memory: false, doc: txt('Segnale che vale 1 dopo il RESET: il codice a 0x0 lo legge per capire se è un avvio o un interrupt, poi lo porta a 0.', 'Signal that is 1 after RESET: the code at 0x0 reads it to tell boot from interrupt, then sets it to 0.') },
  input: { label: txt('Porta di INPUT', 'INPUT port'), defaultSize: 16, memory: false, doc: txt('Porta da cui leggere dati inseriti da te; quando arriva un dato genera un interrupt.', 'Port that returns data you type; new data raises an interrupt.') },
  output: { label: txt('Porta di OUTPUT', 'OUTPUT port'), defaultSize: 16, memory: false, doc: txt('Porta su cui scrivere: vedi i valori (e i caratteri) scritti dal programma.', 'Port to write to: shows the values (and characters) written by the program.') },
  counter: { label: txt('Contatore', 'Counter'), defaultSize: 16, memory: false, doc: txt('Contatore incrementato via software; al valore finale genera un interrupt.', 'Software-incremented counter; raises an interrupt at the terminal value.') },
  button: { label: txt('Pulsante (FF-D)', 'Button (D-FF)'), defaultSize: 16, memory: false, doc: txt('Pulsante con flip-flop D: la pressione (fronte) diventa un livello di INT finché il software non lo azzera.', 'Button with D flip-flop: a press (edge) becomes an INT level until software clears it.') },
};
