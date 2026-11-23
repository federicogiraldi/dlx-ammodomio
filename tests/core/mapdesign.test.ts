import { describe, it, expect } from 'vitest';
import { aliasZones, decodeMap, zoneCoverage } from '../../src/core/bus/bus';
import { DEFAULT_MAP } from '../../src/core/machine';
import { freeSpot, parseAddr, sizeLabel } from '../../src/ui/panels/mapUtil';

const pop = (n: number) => { let c = 0; for (let x = n >>> 0; x; x >>>= 1) c += x & 1; return c; };

describe('zone della decodifica semplificata', () => {
  const dec = decodeMap(DEFAULT_MAP);

  it('ogni alias soddisfa il chip-select e include il blocco vero', () => {
    for (const d of dec) {
      const { zones, total } = aliasZones(d, 1 << 20);
      expect(total).toBe(2 ** (pop(d.fullMask) - pop(d.mask)));
      for (const z of zones) {
        expect(((z ^ d.value) & d.mask) >>> 0).toBe(0);
        expect((z & ~d.fullMask) >>> 0).toBe(0);
      }
      expect(zones).toContain(d.range[0]);
    }
  });

  it('le zone di dispositivi diversi non toccano i blocchi veri degli altri', () => {
    for (const d of dec) {
      for (const o of DEFAULT_MAP) {
        if (o.id === d.id) continue;
        expect(zoneCoverage(o.base >>> 0, o.size, d.mask, d.value)).toBe('none');
      }
    }
  });

  it('copertura di un intervallo: tutto, in parte, niente', () => {
    // CS = BA31·BA30* : risponde in 0x80000000–0xBFFFFFFF
    const mask = 0xc0000000, value = 0x80000000;
    expect(zoneCoverage(0x80000000, 0x10000000, mask, value)).toBe('all');
    expect(zoneCoverage(0x00000000, 0x10000000, mask, value)).toBe('none');
    expect(zoneCoverage(0, 2 ** 32, mask, value)).toBe('some');
  });
});

describe('helper della mappa', () => {
  it('freeSpot trova un posto allineato e libero', () => {
    const a = freeSpot(DEFAULT_MAP, 0x10000000)!;
    expect(a % 0x10000000).toBe(0);
    expect(DEFAULT_MAP.some((d) => a < (d.base >>> 0) + d.size && (d.base >>> 0) < a + 0x10000000)).toBe(false);
    expect(freeSpot(DEFAULT_MAP, 16, 0x90000000, 0x100)).toBe(0x90000010);
    expect(freeSpot(DEFAULT_MAP, 0x40000000, 0x40000000, 0x40000000)).toBeNull();
  });
  it('parseAddr e sizeLabel', () => {
    expect(parseAddr('E0000800h')).toBe(0xe0000800);
    expect(parseAddr('0x1FFFFFFFF')).toBeNull();
    expect(parseAddr('4294967296')).toBeNull();
    expect(sizeLabel(16)).toBe('16 B');
    expect(sizeLabel(0x20000000)).toBe('512 MB');
    expect(sizeLabel(2 ** 31)).toBe('2 GB');
  });
});
