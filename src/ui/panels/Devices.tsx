import { useState } from 'react';
import { useStore } from '../store';
import { tr } from '../../i18n';
import { hex, Txt } from '../../core/util';
import {
  ButtonDevice, CounterDevice, DeviceConfig, DeviceKind, InputDevice, KIND_INFO, LedDevice, OutputDevice, StartupDevice, createDevice,
} from '../../core/bus/devices';
import { decodeMap, validateMap } from '../../core/bus/bus';
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
];

function parseAddr(s: string): number | null {
  const t = s.trim().replace(/_/g, '');
  if (/^0x[0-9a-f]{1,8}$/i.test(t)) return parseInt(t, 16) >>> 0;
  if (/^[0-9a-f]{1,8}h$/i.test(t)) return parseInt(t, 16) >>> 0;
  if (/^\d+$/.test(t)) return Number(t) >>> 0;
  return null;
}

const SIZES: [string, number][] = [
  ['16 B', 16], ['256 B', 256], ['4 KB', 4096], ['64 KB', 0x10000], ['1 MB', 0x100000], ['16 MB', 0x1000000],
  ['64 MB', 0x4000000], ['128 MB', 0x8000000], ['256 MB', 0x10000000], ['512 MB', 0x20000000], ['1 GB', 0x40000000], ['2 GB', 0x80000000],
];
const sizeLabel = (n: number) => SIZES.find((s) => s[1] === n)?.[0] ?? `${n} B`;

function LiveDevice({ id }: { id: string }) {
  const lang = useStore((s) => s.lang);
  useStore((s) => s.version);
  const m = useStore((s) => s.machine);
  const bump = useStore((s) => s.bump);
  const [val, setVal] = useState('0x41');
  const d = m.bus.devices.find((x) => x.cfg.id === id);
  if (!d) return null;
  if (d instanceof LedDevice) {
    return <div className={'led' + (d.on ? ' on' : '')} title={d.on ? 'ON' : 'OFF'}><span /> {d.on ? (lang === 'it' ? 'acceso' : 'on') : (lang === 'it' ? 'spento' : 'off')}</div>;
  }
  if (d instanceof StartupDevice) return <span className={'chip ' + (d.value ? 'warn' : 'ok')}>STARTUP = {d.value ? 1 : 0}</span>;
  if (d instanceof InputDevice) {
    return (
      <form className="dev-ctl" onSubmit={(e) => {
        e.preventDefault();
        const v = val.startsWith("'") && val.length >= 2 ? val.charCodeAt(1) : parseAddr(val);
        if (v === null) return;
        d.provide(v);
        bump();
      }}>
        <input value={val} onChange={(e) => setVal(e.target.value)} aria-label="dato" size={8} />
        <button type="submit">{lang === 'it' ? 'Invia dato' : 'Send data'}</button>
        <span className={'chip ' + (d.pending ? 'warn' : '')}>{d.status()![lang]}{d.queue.length ? ` (+${d.queue.length})` : ''}</span>
      </form>
    );
  }
  if (d instanceof ButtonDevice) {
    return (
      <div className="dev-ctl">
        <button className="press" onClick={() => { d.press(); bump(); }}>{lang === 'it' ? '● Premi' : '● Press'}</button>
        <span className={'chip ' + (d.ff ? 'warn' : '')}>{d.status()![lang]}</span>
      </div>
    );
  }
  if (d instanceof CounterDevice) return <span className={'chip ' + (d.reached ? 'warn' : '')}>{d.status()![lang]}</span>;
  if (d instanceof OutputDevice) {
    const text = d.log.map((c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : c === 10 ? '\n' : '·')).join('');
    return (
      <div className="dev-ctl col">
        <span className="chip">{d.status()![lang]}</span>
        {d.log.length > 0 && <pre className="terminal">{text}</pre>}
      </div>
    );
  }
  return null;
}

export function Devices() {
  const lang = useStore((s) => s.lang);
  useStore((s) => s.version);
  const m = useStore((s) => s.machine);
  const setMap = useStore((s) => s.setMap);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DeviceConfig[]>(m.map);
  const [errs, setErrs] = useState<Txt[]>([]);
  const [showDec, setShowDec] = useState(false);
  const intLine = m.bus.intLine();

  const apply = (map: DeviceConfig[]) => {
    const e = setMap(map);
    setErrs(e);
    if (!e.length) setEditing(false);
  };
  const decoding = decodeMap(m.map);

  return (
    <section className="panel devices">
      <header className="panel-h">
        <h2>{tr(lang, 'devices')}</h2>
        <span className={'chip ' + (intLine ? 'warn' : '')}>INT = {intLine ? 1 : 0}</span>
        <span className={'chip ' + (m.cpu.ien ? 'ok' : '')}>IEN = {m.cpu.ien ? 1 : 0}</span>
      </header>

      {!editing && (
        <>
          <div className="map-bar" aria-label="mappa">
            {m.map.slice().sort((a, b) => (a.base >>> 0) - (b.base >>> 0)).map((d) => {
              const left = ((d.base >>> 0) / 2 ** 32) * 100;
              const w = Math.max((d.size / 2 ** 32) * 100, 0.6);
              return <div key={d.id} className={'map-seg k-' + d.kind} style={{ left: `${left}%`, width: `${w}%` }} title={`${d.name}: ${hex(d.base)} – ${hex(d.base + d.size - 1)}`}><span>{d.size >= 0x10000000 ? d.name : ''}</span></div>;
            })}
            <div className="map-ticks"><span>0</span><span>1G</span><span>2G</span><span>3G</span><span>4G</span></div>
          </div>
          <table className="devtable">
            <thead><tr><th>{lang === 'it' ? 'Dispositivo' : 'Device'}</th><th>{lang === 'it' ? 'Indirizzi' : 'Addresses'}</th><th>{lang === 'it' ? 'Stato / comandi' : 'State / controls'}</th></tr></thead>
            <tbody>
              {m.map.slice().sort((a, b) => (a.base >>> 0) - (b.base >>> 0)).map((d) => (
                <tr key={d.id}>
                  <td><b>{d.name}</b><br /><small className="muted">{KIND_INFO[d.kind].label[lang]} · {sizeLabel(d.size)}</small></td>
                  <td className="mono small">{hex(d.base)}<br />{hex(d.base + d.size - 1)}
                    {!KIND_INFO[d.kind].memory && (
                      <ul className="cslist">
                        {createDevice(d).chipSelects().map((c) => (
                          <li key={c.name} title={c.doc[lang]}><span className={'acc ' + c.access}>{c.access === 'R' ? 'LW/LB' : 'SW/SB'}</span> {hex(d.base + c.offset)} <span className="muted">{c.name}</span></li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td><LiveDevice id={d.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row gap">
            <button onClick={() => { setDraft(m.map.map((d) => ({ ...d }))); setEditing(true); setErrs([]); }}>{lang === 'it' ? '✎ Modifica mappa' : '✎ Edit map'}</button>
            <select onChange={(e) => { const p = PRESETS.find((x) => x.id === e.target.value); if (p) apply(p.map); e.target.value = ''; }} defaultValue="">
              <option value="" disabled>{lang === 'it' ? 'Carica mappa…' : 'Load map…'}</option>
              {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name[lang]}</option>)}
            </select>
            <button onClick={() => setShowDec((v) => !v)}>{showDec ? '▾' : '▸'} {lang === 'it' ? 'Chip-select e decodifica' : 'Chip-selects & decoding'}</button>
          </div>
          {showDec && (
            <div className="decoding">
              <p className="hint">{lang === 'it'
                ? 'Espressioni di decodifica come negli esercizi d\'esame. "Semplificata" usa solo i bit d\'indirizzo che bastano a distinguere il dispositivo dagli altri presenti nella mappa. BAx* = bit negato. Le memorie a 32 bit sono divise in 4 banchi da 8 bit selezionati da BE0..BE3.'
                : 'Decoding expressions as in exam exercises. "Simplified" uses only the address bits needed to tell the device apart from the others in the map. BAx* = negated bit. 32-bit memories are split into 4 8-bit banks selected by BE0..BE3.'}</p>
              {decoding.map((dd) => (
                <div key={dd.name} className="dec-item">
                  <div><b>{dd.name}</b> <span className="mono small">[{hex(dd.range[0])} – {hex(dd.range[1])}]</span></div>
                  <div className="mono small">{lang === 'it' ? 'completa' : 'full'}: CS_{dd.name} = {dd.full}</div>
                  <div className="mono small strong">{lang === 'it' ? 'semplificata' : 'simplified'}: CS_{dd.name} = {dd.simplified}</div>
                  <ul className="mono small">{dd.chipSelects.map((c) => <li key={c.name}>{c.name} = {c.expr}</li>)}</ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {editing && (
        <div className="map-editor">
          <table className="devtable">
            <thead><tr><th>{lang === 'it' ? 'Nome' : 'Name'}</th><th>{lang === 'it' ? 'Tipo' : 'Kind'}</th><th>{lang === 'it' ? 'Base' : 'Base'}</th><th>{lang === 'it' ? 'Dimensione' : 'Size'}</th><th></th></tr></thead>
            <tbody>
              {draft.map((d, i) => (
                <tr key={d.id}>
                  <td><input value={d.name} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} size={10} /></td>
                  <td>{KIND_INFO[d.kind].label[lang]}</td>
                  <td><AddrInput value={d.base} onChange={(v) => setDraft(draft.map((x, j) => (j === i ? { ...x, base: v } : x)))} /></td>
                  <td>
                    <select value={d.size} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, size: Number(e.target.value) } : x)))}>
                      {SIZES.filter(([, n]) => (KIND_INFO[d.kind].memory ? n >= 4096 : n <= 4096)).map(([l, n]) => <option key={n} value={n}>{l}</option>)}
                    </select>
                    {d.kind === 'counter' && (
                      <label className="small"> {lang === 'it' ? 'INT a' : 'INT at'} <input type="number" min={0} value={Number(d.params?.terminal ?? 0)} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, params: { ...x.params, terminal: Number(e.target.value) } } : x)))} style={{ width: 70 }} /></label>
                    )}
                    {d.kind === 'input' && (
                      <label className="small"> <input type="checkbox" checked={d.params?.interrupt !== false} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, params: { ...x.params, interrupt: e.target.checked } } : x)))} /> INT</label>
                    )}
                  </td>
                  <td><button className="icon" aria-label="elimina" onClick={() => setDraft(draft.filter((_, j) => j !== i))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row gap">
            <select defaultValue="" onChange={(e) => {
              const k = e.target.value as DeviceKind;
              if (!k) return;
              const size = KIND_INFO[k].defaultSize;
              const n = draft.filter((d) => d.kind === k).length + 1;
              setDraft([...draft, { id: `${k}${Date.now()}`, kind: k, name: `${k.toUpperCase()}${n > 1 ? n : ''}`, base: freeSpot(draft, size), size }]);
              e.target.value = '';
            }}>
              <option value="" disabled>{lang === 'it' ? '+ Aggiungi dispositivo…' : '+ Add device…'}</option>
              {(Object.keys(KIND_INFO) as DeviceKind[]).map((k) => <option key={k} value={k}>{KIND_INFO[k].label[lang]}</option>)}
            </select>
            <button className="primary" onClick={() => { const e = validateMap(draft); setErrs(e); if (!e.length) apply(draft); }}>{lang === 'it' ? 'Applica' : 'Apply'}</button>
            <button onClick={() => setEditing(false)}>{lang === 'it' ? 'Annulla' : 'Cancel'}</button>
          </div>
          {errs.length > 0 && <div className="alert error">{errs.map((e, i) => <p key={i}>{e[lang]}</p>)}</div>}
          <p className="hint">{lang === 'it' ? 'Come nei chip reali: dimensione potenza di 2 e indirizzo base multiplo della dimensione. Il programma viene ricaricato.' : 'As with real chips: power-of-2 size and base aligned to size. The program is reloaded.'}</p>
        </div>
      )}
      <details className="kinds">
        <summary>{lang === 'it' ? 'Cosa fa ogni tipo di dispositivo?' : 'What does each device do?'}</summary>
        <ul>{(Object.keys(KIND_INFO) as DeviceKind[]).map((k) => <li key={k}><b>{KIND_INFO[k].label[lang]}</b>: {KIND_INFO[k].doc[lang]}</li>)}</ul>
      </details>
    </section>
  );
}

function AddrInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [s, setS] = useState(hex(value));
  const ok = parseAddr(s) !== null;
  return <input className={'mono' + (ok ? '' : ' bad')} value={s} size={11} onChange={(e) => { setS(e.target.value); const v = parseAddr(e.target.value); if (v !== null) onChange(v); }} />;
}

function freeSpot(map: DeviceConfig[], size: number): number {
  for (let a = 0; a + size <= 2 ** 32; a += Math.max(size, 0x1000000)) {
    if (!map.some((d) => a < (d.base >>> 0) + d.size && (d.base >>> 0) < a + size)) return a >>> 0;
  }
  return 0;
}
