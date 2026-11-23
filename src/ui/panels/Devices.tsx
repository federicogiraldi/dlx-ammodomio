import { useState } from 'react';
import { useStore } from '../store';
import { tr } from '../../i18n';
import { hex, Txt } from '../../core/util';
import {
  ButtonDevice, CounterDevice, DeviceConfig, DeviceKind, InputDevice, KIND_INFO, LedDevice, OutputDevice, StartupDevice, createDevice,
} from '../../core/bus/devices';
import { decodeMap } from '../../core/bus/bus';
import { PRESETS, parseAddr, sizeLabel } from './mapUtil';
import { MapDesigner } from './MapDesigner';

export { PRESETS } from './mapUtil';

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
  const [designer, setDesigner] = useState<{ sel: string | null } | null>(null);
  const [errs, setErrs] = useState<Txt[]>([]);
  const [showDec, setShowDec] = useState(false);
  const intLine = m.bus.intLine();

  const apply = (map: DeviceConfig[]) => {
    const e = setMap(map);
    setErrs(e);
  };
  const decoding = decodeMap(m.map);

  return (
    <section className="panel devices">
      <header className="panel-h">
        <h2>{tr(lang, 'devices')}</h2>
        <span className={'chip ' + (intLine ? 'warn' : '')}>INT = {intLine ? 1 : 0}</span>
        <span className={'chip ' + (m.cpu.ien ? 'ok' : '')}>IEN = {m.cpu.ien ? 1 : 0}</span>
      </header>

      <>
          <div className="map-bar" role="group" aria-label={lang === 'it' ? 'Mappa di memoria: clicca un dispositivo per progettarla' : 'Memory map: click a device to design it'}>
            {m.map.slice().sort((a, b) => (a.base >>> 0) - (b.base >>> 0)).map((d) => {
              const left = ((d.base >>> 0) / 2 ** 32) * 100;
              const w = Math.max((d.size / 2 ** 32) * 100, 0.6);
              return <button key={d.id} className={'map-seg k-' + d.kind} style={{ left: `${left}%`, width: `${w}%` }} title={`${d.name}: ${hex(d.base)} – ${hex(d.base + d.size - 1)}`} aria-label={`${d.name} ${hex(d.base)}`} onClick={() => setDesigner({ sel: d.id })}><span>{d.size >= 0x10000000 ? d.name : ''}</span></button>;
            })}
            <div className="map-ticks"><span>0</span><span>1G</span><span>2G</span><span>3G</span><span>4G</span></div>
          </div>
          <div className="table-scroll">
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
          </div>
          <div className="row gap">
            <button className="primary" onClick={() => { setErrs([]); setDesigner({ sel: null }); }}>{lang === 'it' ? '🗺 Progetta la mappa' : '🗺 Design the map'}</button>
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
          {errs.length > 0 && <div className="alert error">{errs.map((e, i) => <p key={i}>{e[lang]}</p>)}</div>}
      </>
      {designer && <MapDesigner initialSel={designer.sel} onClose={() => setDesigner(null)} />}

      <details className="kinds">
        <summary>{lang === 'it' ? 'Cosa fa ogni tipo di dispositivo?' : 'What does each device do?'}</summary>
        <ul>{(Object.keys(KIND_INFO) as DeviceKind[]).map((k) => <li key={k}><b>{KIND_INFO[k].label[lang]}</b>: {KIND_INFO[k].doc[lang]}</li>)}</ul>
      </details>
    </section>
  );
}
