import { Txt } from '../../core/util';
import { DeviceConfig, DeviceKind, KIND_INFO } from '../../core/bus/devices';
import { DEFAULT_MAP } from '../../core/machine';

export const PRESETS: { id: string; name: Txt; map: DeviceConfig[] }[] = [
  { id: 'default', name: { it: 'Predefinita (slide 03)', en: 'Default (slides 03)' }, map: DEFAULT_MAP },
  {
    id: 'io',
    name: { it: 'Con porte I/O, pulsante e contatore', en: 'With I/O ports, button and counter' },
    map: [
      ...DEFAULT_MAP,
      { id: 'in', kind: 'input', name: 'INPUT', base: 0x30000000, size: 16, params: { width: 8, interrupt: true } },
      { id: 'out', kind: 'output', name: 'OUTPUT', base: 0x30000010, size: 16 },
      { id: 'btn', kind: 'button', name: 'BUTTON', base: 0xa0000000, size: 16 },
      { id: 'cnt', kind: 'counter', name: 'COUNTER', base: 0xa4000000, size: 16, params: { bits: 16, terminal: 0 } },
    ],
  },
  {
    id: 'exam20200901',
    name: { it: 'Esame 1/9/2020 (1 GB EPROM, 512 MB RAM, input, LED)', en: 'Exam 2020-09-01' },
    map: [
      { id: 'eprom', kind: 'eprom', name: 'EPROM', base: 0x00000000, size: 0x40000000 },
      { id: 'ram', kind: 'ram', name: 'RAM', base: 0xe0000000, size: 0x10000000 },
      { id: 'in', kind: 'input', name: 'INPUT', base: 0xffff1000, size: 16, params: { width: 8, interrupt: false } },
      { id: 'cnt', kind: 'counter', name: 'CONTA_PARI', base: 0xffff2000, size: 16, params: { bits: 11, terminal: 1024 } },
      { id: 'led', kind: 'led', name: 'LED', base: 0xffff3000, size: 16 },
      { id: 'startup', kind: 'startup', name: 'STARTUP', base: 0xffff4000, size: 16 },
    ],
  },
  {
    id: 'esercitazione',
    name: { it: 'Esercitazione mapping: 512 MB EPROM in basso, 1 GB RAM in alto', en: 'Mapping exercise: 512 MB EPROM low, 1 GB RAM high' },
    map: [
      { id: 'eprom', kind: 'eprom', name: 'EPROM', base: 0x00000000, size: 0x20000000 },
      { id: 'ram', kind: 'ram', name: 'RAM', base: 0xc0000000, size: 0x40000000 },
    ],
  },
];

export function parseAddr(s: string): number | null {
  const t = s.trim().replace(/_/g, '');
  if (/^0x[0-9a-f]{1,8}$/i.test(t)) return parseInt(t, 16) >>> 0;
  if (/^[0-9a-f]{1,8}h$/i.test(t)) return parseInt(t, 16) >>> 0;
  if (/^\d{1,10}$/.test(t) && Number(t) <= 0xffffffff) return Number(t) >>> 0;
  return null;
}

/** dimensione leggibile: 16 B, 4 KB, 512 MB, 1 GB… */
export function sizeLabel(n: number): string {
  const u: [number, string][] = [[2 ** 30, 'GB'], [2 ** 20, 'MB'], [2 ** 10, 'KB']];
  for (const [v, l] of u) if (n >= v && n % v === 0) return `${n / v} ${l}`;
  return `${n} B`;
}

/** dimensioni ammesse per un tipo di dispositivo (potenze di 2) */
export function sizesFor(kind: DeviceKind): number[] {
  const out: number[] = [];
  const [lo, hi] = KIND_INFO[kind].memory ? [4096, 2 ** 31] : [16, 4096];
  for (let n = lo; n <= hi; n *= 2) out.push(n);
  return out;
}

/** primo indirizzo allineato libero in [start, start+len) per un blocco di `size` byte */
export function freeSpot(map: DeviceConfig[], size: number, start = 0, len = 2 ** 32, skipId?: string): number | null {
  const others = map.filter((d) => d.id !== skipId);
  const up = (a: number) => Math.ceil(a / size) * size;
  // il primo posto libero è all'inizio della zona o subito dopo la fine di un altro dispositivo
  const cands = [up(start), ...others.map((d) => up((d.base >>> 0) + d.size))]
    .filter((a) => a >= start && a + size <= start + len && a + size <= 2 ** 32)
    .sort((a, b) => a - b);
  for (const a of cands) {
    if (!others.some((d) => a < (d.base >>> 0) + d.size && (d.base >>> 0) < a + size)) return a >>> 0;
  }
  return null;
}
