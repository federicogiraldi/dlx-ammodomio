import type { DeviceConfig } from '../core/bus/devices';
import { DEFAULT_MAP } from '../core/machine';

/**
 * Periferiche aggiuntive usate da esempi, tutorial ed esercizi.
 * Si aggiungono a DEFAULT_MAP (EPROM, RAM, LED, STARTUP, RAM_H).
 * Chip-select (nomi generati dal simulatore a partire dal nome del dispositivo):
 *   INPUT   0x80000000: CS_INPUT (R +0), CS_STATUS_INPUT (R +4), CS_RESET_INT_INPUT (W +8)
 *   OUTPUT  0xA0000000: CS_OUTPUT (W +0), CS_READ_OUTPUT (R +4)
 *   COUNTER 0xB0000000: CS_READ_COUNTER (R +0), CS_INC_COUNTER (W +4), CS_RESET_COUNTER (W +8)
 *   BTN     0xD0000000: CS_READ_BTN (R +0), CS_RESET_INT_BTN (W +4)
 */
export const DEV_INPUT: DeviceConfig = { id: 'in', kind: 'input', name: 'INPUT', base: 0x80000000, size: 16, params: { width: 8 } };
export const DEV_OUTPUT: DeviceConfig = { id: 'out', kind: 'output', name: 'OUTPUT', base: 0xa0000000, size: 16 };
export const DEV_COUNTER: DeviceConfig = { id: 'cnt', kind: 'counter', name: 'COUNTER', base: 0xb0000000, size: 16, params: { bits: 8, terminal: 4 } };
export const DEV_BUTTON: DeviceConfig = { id: 'btn', kind: 'button', name: 'BTN', base: 0xd0000000, size: 16 };

export const mapWith = (...extra: DeviceConfig[]): DeviceConfig[] => [...DEFAULT_MAP.map((d) => ({ ...d })), ...extra.map((d) => ({ ...d, params: d.params ? { ...d.params } : undefined }))];

export const MAP_INPUT = mapWith(DEV_INPUT);
export const MAP_OUTPUT = mapWith(DEV_OUTPUT);
export const MAP_INPUT_OUTPUT = mapWith(DEV_INPUT, DEV_OUTPUT);
export const MAP_BUTTON = mapWith(DEV_BUTTON);
export const MAP_INPUT_COUNTER = mapWith(DEV_INPUT, DEV_COUNTER);
export const MAP_ALL_IO = mapWith(DEV_INPUT, DEV_OUTPUT, DEV_COUNTER, DEV_BUTTON);
