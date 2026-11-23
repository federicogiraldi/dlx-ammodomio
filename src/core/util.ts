/** Testo bilingue: tutto il core produce messaggi in entrambe le lingue. */
export interface Txt {
  it: string;
  en: string;
}
export const txt = (it: string, en: string = it): Txt => ({ it, en });

export const u32 = (v: number): number => v >>> 0;
export const s32 = (v: number): number => v | 0;

export const signExtend = (v: number, bits: number): number => {
  const shift = 32 - bits;
  return ((v << shift) >> shift) >>> 0;
};
export const zeroExtend = (v: number, bits: number): number =>
  bits >= 32 ? v >>> 0 : (v & ((1 << bits) - 1)) >>> 0;

export const hex = (v: number, digits = 8): string =>
  '0x' + (v >>> 0).toString(16).toUpperCase().padStart(digits, '0');

export const hexShort = (v: number): string => '0x' + (v >>> 0).toString(16).toUpperCase();

export const bin = (v: number, digits = 32): string => (v >>> 0).toString(2).padStart(digits, '0');

/** Valore con interpretazione decimale signed e, se diversa, unsigned. */
export const decBoth = (v: number): string => {
  const s = v | 0;
  const u = v >>> 0;
  return s === u ? `${u}` : `${s} (unsigned ${u})`;
};

export class SimError extends Error {
  constructor(
    public readonly text: Txt,
    public readonly pc?: number,
  ) {
    super(text.it);
  }
}
