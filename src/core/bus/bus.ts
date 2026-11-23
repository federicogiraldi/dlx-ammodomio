import { createDevice, Device, DeviceConfig, MemoryDevice } from './devices';
import { hex, SimError, Txt, txt } from '../util';

export interface MemAccess {
  kind: 'fetch' | 'read' | 'write';
  addr: number;
  size: 1 | 2 | 4;
  value: number;
  device: string; // nome dispositivo
  cs?: string; // chip-select per le periferiche
  garbage?: boolean;
}

/** voce del journal per lo step indietro: byte di memoria sovrascritti */
export interface ByteUndo {
  dev: MemoryDevice;
  addr: number;
  old: { value: number; init: boolean };
}

export class Bus {
  devices: Device[] = [];
  /** accessi dell'istruzione corrente */
  log: MemAccess[] = [];
  /** journal byte sovrascritti (riempito durante uno step) */
  undo: ByteUndo[] = [];

  constructor(configs: DeviceConfig[] = []) {
    this.setMap(configs);
  }

  setMap(configs: DeviceConfig[]) {
    this.devices = configs.map(createDevice).sort((a, b) => a.base - b.base);
  }

  find(addr: number): Device | undefined {
    addr >>>= 0;
    return this.devices.find((d) => addr >= d.base && addr <= d.end);
  }

  private dev(addr: number, kind: MemAccess['kind']): Device {
    const d = this.find(addr);
    if (!d) {
      throw new SimError(txt(
        `${kind === 'write' ? 'Scrittura' : kind === 'fetch' ? 'Lettura istruzione' : 'Lettura'} all'indirizzo ${hex(addr)}: nessun dispositivo è mappato lì (nessun chip-select attivo). Controlla l'indirizzo o la mappa di memoria.`,
        `${kind === 'write' ? 'Write' : kind === 'fetch' ? 'Instruction fetch' : 'Read'} at ${hex(addr)}: no device is mapped there (no chip-select active). Check the address or the memory map.`,
      ));
    }
    return d;
  }

  private align(addr: number, size: number, kind: MemAccess['kind']) {
    if (addr % size !== 0) {
      const what = size === 4 ? txt('una WORD deve stare a indirizzi multipli di 4', 'a WORD must be at multiples of 4') : txt('una HALF-WORD deve stare a indirizzi multipli di 2', 'a HALF-WORD must be at multiples of 2');
      throw new SimError(txt(
        `Alignment fault: accesso a ${size} byte all'indirizzo ${hex(addr)} (${kind === 'fetch' ? 'fetch' : kind === 'write' ? 'scrittura' : 'lettura'}): ${what.it}.`,
        `Alignment fault: ${size}-byte access at ${hex(addr)}: ${what.en}.`,
      ));
    }
  }

  read(addr: number, size: 1 | 2 | 4, kind: 'fetch' | 'read' = 'read'): number {
    addr >>>= 0;
    this.align(addr, size, kind);
    const d = this.dev(addr, kind);
    const info: { garbage?: boolean } = {};
    const value = d.read(addr, size, info) >>> 0;
    const csName = d instanceof MemoryDevice ? undefined : d.chipSelects().find((c) => c.offset === ((addr - d.base) & ~3) && c.access === 'R')?.name;
    this.log.push({ kind, addr, size, value, device: d.cfg.name, cs: csName, garbage: info.garbage });
    return value;
  }

  write(addr: number, size: 1 | 2 | 4, value: number) {
    addr >>>= 0;
    this.align(addr, size, 'write');
    const d = this.dev(addr, 'write');
    if (d instanceof MemoryDevice && !d.readOnly) {
      for (let i = 0; i < size; i++) this.undo.push({ dev: d, addr: addr + i, old: d.peekByte(addr + i) });
    }
    const mask = size === 4 ? 0xffffffff : size === 2 ? 0xffff : 0xff;
    d.write(addr, size, (value & mask) >>> 0);
    const csName = d instanceof MemoryDevice ? undefined : d.chipSelects().find((c) => c.offset === ((addr - d.base) & ~3) && c.access === 'W')?.name;
    this.log.push({ kind: 'write', addr, size, value: (value & mask) >>> 0, device: d.cfg.name, cs: csName });
  }

  /** lettura senza effetti collaterali per la UI (le periferiche non vengono toccate) */
  peek(addr: number): { value: number; init: boolean; device?: Device } {
    const d = this.find(addr);
    if (!d) return { value: 0, init: false };
    if (d instanceof MemoryDevice) return { ...d.peekByte(addr >>> 0), device: d };
    return { value: 0, init: false, device: d };
  }

  peekWord(addr: number): { value: number; init: boolean; device?: Device } {
    let v = 0;
    let init = true;
    let device: Device | undefined;
    for (let i = 0; i < 4; i++) {
      const b = this.peek(addr + i);
      v = v * 256 + b.value;
      init &&= b.init;
      device = b.device;
    }
    return { value: v >>> 0, init, device };
  }

  /** linea INT: OR di tutte le richieste di interrupt (come nelle slide 04) */
  intLine(): boolean {
    return this.devices.some((d) => d.irq());
  }

  intSources(): Device[] {
    return this.devices.filter((d) => d.irq());
  }

  resetDevices() {
    for (const d of this.devices) d.reset();
  }

  memories(): MemoryDevice[] {
    return this.devices.filter((d): d is MemoryDevice => d instanceof MemoryDevice);
  }

  /** carica l'immagine prodotta dall'assembler (programma anche la EPROM) */
  loadImage(bytes: Map<number, number>, byteLine: (addr: number) => number | undefined): { line?: number; text: Txt }[] {
    const errors: { line?: number; text: Txt }[] = [];
    const reported = new Set<number | undefined>();
    for (const m of this.memories()) m.clear();
    for (const [addr, b] of bytes) {
      const d = this.find(addr);
      if (!(d instanceof MemoryDevice)) {
        const line = byteLine(addr);
        if (!reported.has(line)) {
          reported.add(line);
          errors.push({
            line,
            text: d
              ? txt(`L'indirizzo ${hex(addr)} appartiene alla periferica "${d.cfg.name}": codice e dati devono stare in EPROM o RAM.`, `Address ${hex(addr)} belongs to peripheral "${d.cfg.name}": code and data must be in EPROM or RAM.`)
              : txt(`L'indirizzo ${hex(addr)} non corrisponde a nessuna memoria della mappa: codice e dati non possono essere caricati lì.`, `Address ${hex(addr)} is not in any memory of the map: code and data cannot be loaded there.`),
          });
        }
        continue;
      }
      d.program(addr, b);
    }
    return errors;
  }
}

// ------------------------------------------------------------------
// Validazione della mappa e decodifica dei chip-select
// ------------------------------------------------------------------

export function validateMap(configs: DeviceConfig[]): Txt[] {
  const errs: Txt[] = [];
  for (const c of configs) {
    if (c.size <= 0 || (c.size & (c.size - 1)) !== 0) {
      errs.push(txt(`"${c.name}": la dimensione (${c.size} byte) deve essere una potenza di 2.`, `"${c.name}": size (${c.size} bytes) must be a power of 2.`));
    } else if ((c.base >>> 0) % c.size !== 0) {
      errs.push(txt(`"${c.name}": l'indirizzo base ${hex(c.base)} deve essere multiplo della dimensione (${hex(c.size)}), come per i chip reali.`, `"${c.name}": base ${hex(c.base)} must be a multiple of the size (${hex(c.size)}).`));
    }
    if ((c.base >>> 0) + c.size > 0x100000000) errs.push(txt(`"${c.name}" esce dallo spazio di indirizzamento di 4 GB.`, `"${c.name}" exceeds the 4 GB address space.`));
  }
  const sorted = [...configs].sort((a, b) => (a.base >>> 0) - (b.base >>> 0));
  for (let i = 1; i < sorted.length; i++) {
    const p = sorted[i - 1];
    const c = sorted[i];
    if ((p.base >>> 0) + p.size > (c.base >>> 0)) {
      errs.push(txt(`"${p.name}" e "${c.name}" si sovrappongono: due chip-select sarebbero attivi insieme (conflitto sul bus dati).`, `"${p.name}" and "${c.name}" overlap: two chip-selects would be active together.`));
    }
  }
  if (!configs.some((c) => c.kind === 'eprom' && (c.base >>> 0) === 0)) {
    errs.push(txt('Serve una EPROM a partire da 0x00000000: è lì che il DLX legge la prima istruzione dopo il RESET (e salta in caso di interrupt).', 'An EPROM at 0x00000000 is required: the DLX fetches its first instruction there after RESET.'));
  }
  return errs;
}

export interface Decoding {
  id: string;
  name: string;
  /** bit d'indirizzo usati dalla decodifica semplificata (1 = bit controllato) */
  mask: number;
  /** bit d'indirizzo usati dalla decodifica completa (tutti quelli sopra la dimensione) */
  fullMask: number;
  /** valore richiesto sui bit controllati */
  value: number;
  range: [number, number];
  /** decodifica completa: bit fissi */
  full: string;
  /** decodifica semplificata (bit minimi che distinguono il dispositivo dagli altri) */
  simplified: string;
  chipSelects: { name: string; addr: number; expr: string }[];
}

const bitTerm = (bit: number, one: boolean) => (one ? `BA${bit}` : `BA${bit}*`); // * = negato (notazione "barrata")

function termsOf(mask: number, value: number): string {
  const t: string[] = [];
  for (let b = 31; b >= 2; b--) if ((mask >>> b) & 1) t.push(bitTerm(b, ((value >>> b) & 1) === 1));
  return t.length ? t.join('·') : '1';
}

/** Genera le espressioni di chip-select come richiesto negli esercizi d'esame. */
export function decodeMap(configs: DeviceConfig[]): Decoding[] {
  const blocks = configs.map((c) => {
    const size = c.size;
    const mask = ~(size - 1) >>> 0;
    return { c, mask, value: (c.base & mask) >>> 0 };
  });
  return blocks.map((b) => {
    // decodifica semplificata: rimuovo bit (dal meno significativo) finché non interseco altri dispositivi
    let mask = b.mask;
    for (let bit = 0; bit < 32; bit++) {
      if (!((mask >>> bit) & 1)) continue;
      const trial = (mask & ~(1 << bit)) >>> 0;
      const clash = blocks.some((o) => o !== b && (((o.value ^ b.value) & trial & o.mask) >>> 0) === 0);
      if (!clash) mask = trial;
    }
    const simplified = termsOf(mask, b.value);
    const isMem = b.c.kind === 'ram' || b.c.kind === 'eprom';
    const dev = createDevice(b.c);
    const css = isMem
      ? [0, 1, 2, 3].map((i) => ({ name: `CS_${b.c.name.toUpperCase().replace(/\W+/g, '_')}_${i}`, addr: b.c.base, expr: `CS_${b.c.name.toUpperCase().replace(/\W+/g, '_')}·BE${i}` }))
      : dev.chipSelects().map((c) => {
          const a = (b.c.base + c.offset) >>> 0;
          // bit interni al dispositivo che distinguono i chip-select (BA2, BA3, ...)
          const inner: string[] = [];
          const nCs = Math.max(1, Math.ceil(Math.log2(b.c.size / 4)));
          for (let bit = 2 + nCs - 1; bit >= 2; bit--) inner.push(bitTerm(bit, ((c.offset >>> bit) & 1) === 1));
          return { name: c.name, addr: a, expr: `${simplified}·${inner.join('·')}·${c.access === 'R' ? 'MEMRD' : 'MEMWR'}` };
        });
    return {
      id: b.c.id,
      name: b.c.name,
      mask,
      fullMask: b.mask,
      value: b.value,
      range: [b.c.base >>> 0, (b.c.base + b.c.size - 1) >>> 0],
      full: termsOf(b.mask, b.value),
      simplified,
      chipSelects: css,
    };
  });
}

/**
 * Con la decodifica semplificata il dispositivo risponde a tutti gli indirizzi a con (a & mask) == value:
 * il blocco reale più le sue "copie" (alias). Restituisce come un intervallo allineato [start, start+len)
 * (len potenza di 2) è coperto da queste zone: tutto, in parte o per niente.
 */
export function zoneCoverage(start: number, len: number, mask: number, value: number): 'all' | 'some' | 'none' {
  const hi = len >= 2 ** 32 ? 0 : (~(len - 1)) >>> 0; // bit fissati dall'intervallo
  if (((start ^ value) & mask & hi) >>> 0 !== 0) return 'none';
  return (mask & ~hi) >>> 0 ? 'some' : 'all';
}

/** Le zone (alias) in cui il dispositivo risponde con la decodifica semplificata, al massimo `limit`. */
export function aliasZones(d: { mask: number; fullMask: number; value: number }, limit = 16): { zones: number[]; total: number } {
  const free: number[] = [];
  for (let b = 31; b >= 0; b--) if (((d.fullMask & ~d.mask) >>> b) & 1) free.push(b);
  const total = 2 ** free.length;
  const zones: number[] = [];
  for (let i = 0; i < Math.min(total, limit); i++) {
    let a = d.value & d.fullMask;
    free.forEach((b, j) => { if ((i >> (free.length - 1 - j)) & 1) a |= 1 << b; });
    zones.push(a >>> 0);
  }
  return { zones, total };
}
