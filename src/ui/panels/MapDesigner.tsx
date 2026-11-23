import { KeyboardEvent, PointerEvent as RPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { hex, Txt } from '../../core/util';
import { DeviceConfig, DeviceKind, KIND_INFO } from '../../core/bus/devices';
import { aliasZones, decodeMap, Decoding, validateMap, zoneCoverage } from '../../core/bus/bus';
import { freeSpot, parseAddr, PRESETS, sizeLabel, sizesFor } from './mapUtil';

/**
 * Progettista della mappa di memoria: lo spazio di 4 GB disegnato come nelle slide 02
 * (indirizzi alti in alto), con zoom per cifra esadecimale, trascinamento dei dispositivi,
 * e la decodifica semplificata ricalcolata dal vivo con le zone in cui ogni dispositivo risponde.
 */

const SPACE = 2 ** 32;
const COL_H = 512; // altezza della colonna in px (16 righe da 32)
const MIN_BLOCK = 22;

type View = { start: number; span: number };
type Drag = {
  id: string | null; // null = nuovo dispositivo dalla tavolozza
  kind: DeviceKind;
  size: number;
  origBase: number;
  grab: number; // distanza tra il punto afferrato e la base
  x0: number;
  y0: number;
  moved: boolean;
  cand: number | null;
};

const L = (lang: 'it' | 'en', it: string, en: string) => (lang === 'it' ? it : en);
const lg = (n: number) => Math.round(Math.log2(n));
const csName = (n: string) => n.toUpperCase().replace(/\W+/g, '_');
const overlaps = (map: DeviceConfig[], id: string | null, base: number, size: number) =>
  map.some((d) => d.id !== id && base < (d.base >>> 0) + d.size && (d.base >>> 0) < base + size);

/** livello di zoom in cui il dispositivo occupa almeno una riga intera */
function viewFor(d: { base: number; size: number }): View {
  let row = 16;
  while (row < d.size && row < SPACE / 16) row *= 16;
  const span = Math.min(SPACE, row * 16);
  return { start: Math.floor((d.base >>> 0) / span) * span, span };
}

export function MapDesigner({ initialSel, onClose }: { initialSel?: string | null; onClose: () => void }) {
  const lang = useStore((s) => s.lang);
  const machine = useStore((s) => s.machine);
  const setMap = useStore((s) => s.setMap);
  const [draft, setDraft] = useState<DeviceConfig[]>(() => machine.map.map((d) => ({ ...d, params: d.params ? { ...d.params } : undefined })));
  const [sel, setSel] = useState<string | null>(initialSel ?? null);
  const [view, setView] = useState<View>({ start: 0, span: SPACE });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [applyErrs, setApplyErrs] = useState<Txt[]>([]);
  const dlg = useRef<HTMLDialogElement>(null);
  const col = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const d = dlg.current;
    if (d && !d.open) d.showModal();
  }, []);

  const errs = useMemo(() => validateMap(draft), [draft]);
  const dec = useMemo(() => decodeMap(draft), [draft]);
  const decOf = (id: string) => dec.find((x) => x.id === id);
  const dirty = JSON.stringify(draft) !== JSON.stringify(machine.map);
  const selDev = draft.find((d) => d.id === sel) ?? null;
  const rs = view.span / 16;

  const close = () => {
    if (dirty && !confirm(L(lang, 'Chiudere senza applicare le modifiche alla mappa?', 'Close without applying the map changes?'))) return;
    dlg.current?.close();
    onClose();
  };
  const apply = () => {
    const e = setMap(draft);
    setApplyErrs(e);
    if (!e.length) { dlg.current?.close(); onClose(); }
  };
  const update = (id: string, patch: Partial<DeviceConfig>) => setDraft((m) => m.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const remove = (id: string) => { setDraft((m) => m.filter((d) => d.id !== id)); if (sel === id) setSel(null); };

  // ---------- geometria: indirizzi alti in alto ----------
  const yOf = (a: number) => COL_H * (1 - (a - view.start) / view.span);
  const addrAtY = (y: number) => view.start + view.span * (1 - Math.min(Math.max(y, 0), COL_H - 0.01) / COL_H);

  const candidate = (dr: Drag, addr: number): number => {
    if (dr.size >= rs) {
      const b = Math.round((addr - dr.grab) / dr.size) * dr.size;
      return Math.min(Math.max(b, 0), SPACE - dr.size) >>> 0;
    }
    const rowStart = Math.floor(addr / rs) * rs;
    const keep = rowStart + (dr.id ? dr.origBase % rs : 0);
    if (dr.id && !overlaps(draft, dr.id, keep, dr.size)) return keep >>> 0;
    return freeSpot(draft, dr.size, rowStart, rs, dr.id ?? undefined) ?? keep >>> 0;
  };

  const newDevice = (kind: DeviceKind, base: number): DeviceConfig => {
    const n = draft.filter((d) => d.kind === kind).length + 1;
    const name = `${kind.toUpperCase()}${n > 1 ? n : ''}`;
    const params: DeviceConfig['params'] = kind === 'input' ? { width: 8, interrupt: true } : kind === 'counter' ? { bits: 16, terminal: 0 } : undefined;
    return { id: `${kind}-${Date.now().toString(36)}`, kind, name, base, size: KIND_INFO[kind].defaultSize, params };
  };

  // ---------- trascinamento ----------
  const startDrag = (e: RPointerEvent, dr: Omit<Drag, 'x0' | 'y0' | 'moved' | 'cand'>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setDrag({ ...dr, x0: e.clientX, y0: e.clientY, moved: false, cand: null });
  };
  useEffect(() => {
    if (!drag) return;
    const inside = (ev: PointerEvent) => {
      const r = col.current?.getBoundingClientRect();
      return r && ev.clientX >= r.left - 40 && ev.clientX <= r.right + 40 && ev.clientY >= r.top && ev.clientY <= r.bottom ? r : null;
    };
    const move = (ev: PointerEvent) => {
      const moved = drag.moved || Math.abs(ev.clientX - drag.x0) + Math.abs(ev.clientY - drag.y0) > 4;
      const r = inside(ev);
      setDrag({ ...drag, moved, cand: moved && r ? candidate(drag, addrAtY(ev.clientY - r.top)) : null });
    };
    const up = () => {
      if (!drag.moved) {
        // semplice clic
        if (drag.id) setSel(drag.id);
        else {
          const b = freeSpot(draft, drag.size, view.start, view.span) ?? freeSpot(draft, drag.size);
          if (b !== null) { const d = newDevice(drag.kind, b); setDraft((m) => [...m, d]); setSel(d.id); }
        }
      } else if (drag.cand !== null) {
        if (drag.id) { update(drag.id, { base: drag.cand }); setSel(drag.id); }
        else { const d = newDevice(drag.kind, drag.cand); setDraft((m) => [...m, d]); setSel(d.id); }
      }
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  });

  const onBlockKey = (e: KeyboardEvent, d: DeviceConfig) => {
    // su/giù di una riga (o di un blocco, se il dispositivo è più grande di una riga): resta allineato
    const step = Math.max(d.size, rs);
    const b = d.base >>> 0;
    if (e.key === 'ArrowUp' && b + step + d.size <= SPACE) { e.preventDefault(); update(d.id, { base: (b + step) >>> 0 }); }
    else if (e.key === 'ArrowDown' && b >= step) { e.preventDefault(); update(d.id, { base: (b - step) >>> 0 }); }
    else if (e.key === 'Delete') { e.preventDefault(); remove(d.id); }
    else if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); setView(viewFor(d)); }
  };

  // ---------- blocchi visibili, con corsie per quelli che si sovrappongono a video ----------
  const blocks = useMemo(() => {
    const vis = draft
      .map((d) => {
        const lo = Math.max(d.base >>> 0, view.start);
        const hi = Math.min((d.base >>> 0) + d.size, view.start + view.span);
        if (hi <= lo) return null;
        const bottom = yOf(lo);
        let top = yOf(hi);
        if (bottom - top < MIN_BLOCK) top = Math.max(0, bottom - MIN_BLOCK);
        return { d, top, h: Math.max(bottom - top, MIN_BLOCK), lane: 0, clipped: lo > (d.base >>> 0) || hi < (d.base >>> 0) + d.size };
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => a.top - b.top);
    const ends: number[] = [];
    for (const b of vis) {
      let l = ends.findIndex((e) => e <= b.top + 0.5);
      if (l < 0) { l = ends.length; ends.push(0); }
      ends[l] = b.top + b.h;
      b.lane = l;
    }
    return { vis, lanes: Math.max(1, ends.length) };
  }, [draft, view]);

  const rows = Array.from({ length: 16 }, (_, i) => {
    const start = view.start + (15 - i) * rs;
    return { i, start };
  });
  const crumbs: View[] = [];
  for (let s = SPACE; s >= view.span; s /= 16) crumbs.push({ start: Math.floor(view.start / s) * s, span: s });
  const digitBits = `BA${lg(rs) + 3}…BA${lg(rs)}`;
  const zoneDevs = showAll ? dec : dec.filter((x) => x.id === sel);
  const dragDev = drag ? (drag.id ? draft.find((d) => d.id === drag.id) : null) : null;
  const ghostBad = drag?.cand != null && overlaps(draft, drag.id, drag.cand, drag.size);

  return (
    <dialog ref={dlg} className="mapdesigner" onCancel={(e) => { e.preventDefault(); close(); }} aria-label={L(lang, 'Progetta la mappa di memoria', 'Design the memory map')}>
      <header className="md-head">
        <h2>🗺 {L(lang, 'Progetta la mappa di memoria', 'Design the memory map')}</h2>
        <select value="" onChange={(e) => { const p = PRESETS.find((x) => x.id === e.target.value); if (p) { setDraft(p.map.map((d) => ({ ...d }))); setSel(null); setView({ start: 0, span: SPACE }); } }} aria-label={L(lang, 'Carica una mappa di esempio', 'Load an example map')}>
          <option value="" disabled>{L(lang, 'Parti da una mappa…', 'Start from a map…')}</option>
          {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name[lang]}</option>)}
        </select>
        <span className="spacer" />
        <button className="icon" onClick={close} aria-label={L(lang, 'Chiudi', 'Close')}>✕</button>
      </header>

      <div className="md-palette" role="toolbar" aria-label={L(lang, 'Dispositivi da aggiungere', 'Devices to add')}>
        <span className="small muted">{L(lang, 'Trascina nella mappa (o clicca) per aggiungere:', 'Drag into the map (or click) to add:')}</span>
        {(Object.keys(KIND_INFO) as DeviceKind[]).map((k) => (
          <button key={k} className={'md-pal k-' + k} title={KIND_INFO[k].doc[lang]}
            onPointerDown={(e) => startDrag(e, { id: null, kind: k, size: KIND_INFO[k].defaultSize, origBase: 0, grab: KIND_INFO[k].defaultSize >= rs ? KIND_INFO[k].defaultSize / 2 : 0 })}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const b = freeSpot(draft, KIND_INFO[k].defaultSize, view.start, view.span) ?? freeSpot(draft, KIND_INFO[k].defaultSize); if (b !== null) { const d = newDevice(k, b); setDraft((m) => [...m, d]); setSel(d.id); } } }}>
            + {KIND_INFO[k].label[lang]} <small>{sizeLabel(KIND_INFO[k].defaultSize)}</small>
          </button>
        ))}
      </div>

      <div className="md-body">
        {/* ---------------- colonna della memoria logica ---------------- */}
        <div className="md-mapwrap">
          <nav className="md-crumbs" aria-label="zoom">
            {crumbs.map((c, i) => (
              <span key={i}>{i > 0 && ' › '}
                <button className="linklike" disabled={c.span === view.span} onClick={() => setView(c)}>
                  {c.span === SPACE ? '4 GB' : `${hex(c.start)}–${hex(c.start + c.span - 1)}`}
                </button>
              </span>
            ))}
          </nav>
          <p className="small muted md-legend">
            {L(lang, `Righe da ${sizeLabel(rs)}: differiscono per ${digitBits} (una cifra esadecimale). 🔍 = ingrandisci la riga.`, `${sizeLabel(rs)} rows: they differ in ${digitBits} (one hex digit). 🔍 = zoom into the row.`)}
          </p>
          <div className="md-map">
            <div className="md-labels" style={{ height: COL_H }}>
              <span className="md-top mono">{hex(view.start + view.span - 1)}</span>
              {rows.map((r) => (
                <div key={r.i} className="md-rowlab" style={{ top: r.i * (COL_H / 16), height: COL_H / 16 }}>
                  <span className="mono">{hex(r.start)}</span>
                  {rs > 16 && (
                    <button className="md-zoom" onClick={() => setView({ start: r.start, span: rs })} aria-label={L(lang, `Ingrandisci ${hex(r.start)}`, `Zoom into ${hex(r.start)}`)}>🔍</button>
                  )}
                </div>
              ))}
            </div>
            <div className="md-col" ref={col} style={{ height: COL_H }}>
              {rows.map((r) => {
                const cov = selDev ? zoneCoverage(r.start, rs, decOf(selDev.id)?.mask ?? 0, decOf(selDev.id)?.value ?? 0) : 'none';
                return <div key={r.i} className={'md-row' + (cov !== 'none' ? ' z-' + cov + ' k-' + selDev!.kind : '')} style={{ top: r.i * (COL_H / 16), height: COL_H / 16 }} onDoubleClick={() => rs > 16 && setView({ start: r.start, span: rs })} />;
              })}
              {blocks.vis.map((b) => {
                const w = 100 / blocks.lanes;
                const isDragged = drag?.moved && drag.id === b.d.id;
                return (
                  <button key={b.d.id}
                    className={'md-block k-' + b.d.kind + (b.d.id === sel ? ' sel' : '') + (isDragged ? ' dragging' : '') + (errs.length && overlaps(draft, b.d.id, b.d.base >>> 0, b.d.size) ? ' bad' : '')}
                    style={{ top: b.top, height: b.h, left: `calc(${b.lane * w}% + 3px)`, width: `calc(${w}% - 6px)` }}
                    onPointerDown={(e) => startDrag(e, { id: b.d.id, kind: b.d.kind, size: b.d.size, origBase: b.d.base >>> 0, grab: addrAtY(e.clientY - (col.current?.getBoundingClientRect().top ?? 0)) - (b.d.base >>> 0) })}
                    onDoubleClick={() => setView(viewFor(b.d))}
                    onKeyDown={(e) => onBlockKey(e, b.d)}
                    onFocus={() => setSel(b.d.id)}
                    aria-label={`${b.d.name}, ${hex(b.d.base)}–${hex(b.d.base + b.d.size - 1)}, ${sizeLabel(b.d.size)}`}
                    title={`${b.d.name}: ${hex(b.d.base)} – ${hex(b.d.base + b.d.size - 1)} (${sizeLabel(b.d.size)})\n${L(lang, 'Trascina per spostare · doppio clic per ingrandire · frecce per spostare · Canc per eliminare', 'Drag to move · double-click to zoom · arrows to move · Del to delete')}`}>
                    <b>{b.d.name}</b>
                    {b.h >= 40 && <span className="mono small">{sizeLabel(b.d.size)} @ {hex(b.d.base)}</span>}
                    {b.clipped && <span className="small"> ⋯</span>}
                  </button>
                );
              })}
              {drag?.moved && drag.cand !== null && drag.cand + drag.size > view.start && drag.cand < view.start + view.span && (() => {
                const lo = Math.max(drag.cand, view.start);
                const hi = Math.min(drag.cand + drag.size, view.start + view.span);
                const bottom = yOf(lo);
                const top = Math.min(yOf(hi), bottom - MIN_BLOCK);
                return (
                  <div className={'md-ghost' + (ghostBad ? ' bad' : '')} style={{ top: Math.max(0, top), height: Math.max(bottom - top, MIN_BLOCK) }}>
                    <span className="mono">{dragDev?.name ?? KIND_INFO[drag.kind].label[lang]} → {hex(drag.cand)}</span>
                    {ghostBad && <span> ⚠ {L(lang, 'sovrapposto', 'overlaps')}</span>}
                  </div>
                );
              })()}
            </div>
            {/* gutter con le zone in cui ogni dispositivo risponde (decodifica semplificata) */}
            <div className="md-zones" style={{ height: COL_H }} aria-hidden="true">
              {zoneDevs.map((z) => {
                const d = draft.find((x) => x.id === z.id);
                if (!d) return null;
                return (
                  <div key={z.id} className={'md-zlane' + (z.id === sel ? ' sel' : '')} title={`CS_${csName(z.name)}`}>
                    {rows.map((r) => {
                      const c = zoneCoverage(r.start, rs, z.mask, z.value);
                      return c === 'none' ? null : <div key={r.i} className={'md-z z-' + c + ' k-' + d.kind} style={{ top: r.i * (COL_H / 16), height: COL_H / 16 }} />;
                    })}
                  </div>
                );
              })}
            </div>
          </div>
          <label className="small"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> {L(lang, 'Mostra le zone decodificate di tutti i dispositivi', 'Show the decoded zones of every device')}</label>
          <p className="small muted">{L(lang,
            'A destra della colonna: dove il chip-select è attivo con la decodifica semplificata. Pieno = tutta la riga, a righe = solo una parte (ingrandisci per vedere).',
            'Right of the column: where the chip-select is active with simplified decoding. Solid = whole row, striped = part of it (zoom in to see).')}</p>
        </div>

        {/* ---------------- ispettore ---------------- */}
        <div className="md-side">
          {selDev ? (
            <Inspector key={selDev.id} d={selDev} dec={decOf(selDev.id)} lang={lang} update={update} remove={remove} draft={draft} zoom={() => setView(viewFor(selDev))} />
          ) : (
            <Overview dec={dec} draft={draft} lang={lang} select={setSel} />
          )}
        </div>
      </div>

      <footer className="md-foot">
        {(errs.length > 0 || applyErrs.length > 0) && (
          <div className="alert error">{[...errs, ...applyErrs].map((e, i) => <p key={i}>⚠ {e[lang]}</p>)}</div>
        )}
        <div className="row gap">
          <button className="primary" disabled={!dirty || errs.length > 0} onClick={apply}>{L(lang, '✔ Applica alla macchina', '✔ Apply to the machine')}</button>
          <button disabled={!dirty} onClick={() => { setDraft(machine.map.map((d) => ({ ...d }))); setApplyErrs([]); }}>{L(lang, '↺ Ripristina', '↺ Revert')}</button>
          <button onClick={close}>{L(lang, 'Chiudi', 'Close')}</button>
          <span className="small muted">{dirty ? L(lang, 'Modifiche non ancora applicate: applicandole il programma viene ricaricato.', 'Unapplied changes: applying reloads the program.') : L(lang, 'Nessuna modifica.', 'No changes.')}</span>
        </div>
      </footer>
    </dialog>
  );
}

// ------------------------------------------------------------------

function BitStrip({ d, dc, lang }: { d: DeviceConfig; dc: Decoding; lang: 'it' | 'en' }) {
  const k = lg(d.size);
  const mem = KIND_INFO[d.kind].memory;
  const nCs = Math.max(1, Math.ceil(Math.log2(d.size / 4)));
  const cell = (b: number) => {
    const v = (dc.value >>> b) & 1;
    if ((dc.mask >>> b) & 1) return { cls: 'b-sel', txt: String(v), tip: L(lang, `BA${b} = ${v}: usato dalla decodifica semplificata`, `BA${b} = ${v}: used by simplified decoding`) };
    if ((dc.fullMask >>> b) & 1) return { cls: 'b-full', txt: String(v), tip: L(lang, `BA${b} = ${v} nella decodifica completa, ma non serve per distinguere ${d.name} dagli altri dispositivi`, `BA${b} = ${v} in full decoding, but not needed to tell ${d.name} apart`) };
    if (mem) {
      if (b < 2) return { cls: 'b-be', txt: 'BE', tip: L(lang, 'BA1, BA0 non escono dal DLX: al loro posto BE3…BE0 scelgono il banco', 'BA1, BA0 are not emitted: BE3…BE0 select the bank') };
      return { cls: 'b-in', txt: `A${b - 2}`, tip: L(lang, `BA${b} va al piedino A${b - 2} dei chip (indirizzo interno = logico / 4)`, `BA${b} goes to pin A${b - 2} of the chips (internal address = logical / 4)`) };
    }
    if (b >= 2 && b < 2 + nCs) return { cls: 'b-in', txt: '·', tip: L(lang, `BA${b} sceglie il registro interno (chip-select di II livello)`, `BA${b} selects the internal register`) };
    return { cls: 'b-dc', txt: '–', tip: L(lang, `BA${b} non usato`, `BA${b} unused`) };
  };
  const row = (from: number) => (
    <div className="bits">
      {Array.from({ length: 16 }, (_, i) => from - i).map((b) => {
        const c = cell(b);
        return <span key={b} className={'bit ' + c.cls + (b === k ? ' edge' : '')} title={c.tip}><small>{b}</small>{c.txt}</span>;
      })}
    </div>
  );
  return (
    <div className="bitstrip" aria-label={L(lang, 'Bit di indirizzo', 'Address bits')}>
      {row(31)}
      {row(15)}
      <div className="bit-legend small">
        <span className="bit b-sel">1</span> {L(lang, 'decodifica semplificata', 'simplified decoding')}
        <span className="bit b-full">0</span> {L(lang, 'solo nella completa', 'only in full')}
        <span className="bit b-in">A</span> {L(lang, 'interni al dispositivo', 'inside the device')}
        {mem && <><span className="bit b-be">BE</span> {L(lang, 'byte enable', 'byte enable')}</>}
      </div>
    </div>
  );
}

function Inspector({ d, dec, lang, update, remove, draft, zoom }: {
  d: DeviceConfig; dec?: Decoding; lang: 'it' | 'en'; draft: DeviceConfig[];
  update: (id: string, p: Partial<DeviceConfig>) => void; remove: (id: string) => void; zoom: () => void;
}) {
  const [baseTxt, setBaseTxt] = useState(hex(d.base));
  useEffect(() => setBaseTxt(hex(d.base)), [d.base]);
  const mem = KIND_INFO[d.kind].memory;
  const sizes = sizesFor(d.kind);
  const setSize = (n: number) => update(d.id, { size: n, base: (Math.floor((d.base >>> 0) / n) * n) >>> 0 });
  const baseOk = parseAddr(baseTxt) !== null;
  const al = dec ? aliasZones(dec, 8) : { zones: [], total: 1 };
  const saved = dec ? popcount(dec.fullMask) - popcount(dec.mask) : 0;
  const N = csName(d.name);
  const peri = dec?.chipSelects ?? [];

  return (
    <div className="md-insp">
      <div className="row gap">
        <span className={'md-dot k-' + d.kind} />
        <input className="md-name" value={d.name} onChange={(e) => update(d.id, { name: e.target.value })} aria-label={L(lang, 'Nome', 'Name')} />
        <span className="chip">{KIND_INFO[d.kind].label[lang]}</span>
      </div>
      <p className="small muted">{KIND_INFO[d.kind].doc[lang]}</p>
      <div className="md-fields">
        <label>{L(lang, 'Indirizzo base', 'Base address')}
          <input className={'mono' + (baseOk ? '' : ' bad')} value={baseTxt} size={12}
            onChange={(e) => setBaseTxt(e.target.value)}
            onBlur={() => { const v = parseAddr(baseTxt); if (v !== null) update(d.id, { base: v }); else setBaseTxt(hex(d.base)); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        </label>
        <label>{L(lang, 'Dimensione', 'Size')}
          <span className="row">
            <button className="icon" disabled={d.size <= sizes[0]} onClick={() => setSize(d.size / 2)} aria-label={L(lang, 'Dimezza', 'Halve')}>÷2</button>
            <select value={d.size} onChange={(e) => setSize(Number(e.target.value))}>
              {sizes.map((n) => <option key={n} value={n}>{sizeLabel(n)}</option>)}
            </select>
            <button className="icon" disabled={d.size >= sizes[sizes.length - 1]} onClick={() => setSize(d.size * 2)} aria-label={L(lang, 'Raddoppia', 'Double')}>×2</button>
          </span>
        </label>
        {d.kind === 'counter' && (
          <label>{L(lang, 'INT al valore', 'INT at value')}
            <input type="number" min={0} value={Number(d.params?.terminal ?? 0)} onChange={(e) => update(d.id, { params: { ...d.params, terminal: Math.max(0, Number(e.target.value) || 0) } })} style={{ width: 90 }} />
          </label>
        )}
        {d.kind === 'input' && (
          <label><span><input type="checkbox" checked={d.params?.interrupt !== false} onChange={(e) => update(d.id, { params: { ...d.params, interrupt: e.target.checked } })} /> {L(lang, 'genera interrupt', 'raises interrupt')}</span></label>
        )}
      </div>
      <p className="mono small">{hex(d.base)} – {hex(d.base + d.size - 1)} · {L(lang, `allineato a ${sizeLabel(d.size)}`, `aligned to ${sizeLabel(d.size)}`)}{(d.base >>> 0) % d.size ? ' ⚠' : ' ✓'}</p>
      <div className="row gap">
        <button onClick={zoom}>🔍 {L(lang, 'Ingrandisci', 'Zoom in')}</button>
        <button className="warnbtn" onClick={() => remove(d.id)}>🗑 {L(lang, 'Elimina', 'Delete')}</button>
      </div>

      {dec && (
        <>
          <h3>{L(lang, 'Decodifica (I livello)', 'Decoding (1st level)')}</h3>
          <BitStrip d={d} dc={dec} lang={lang} />
          <div className="md-cs">
            <div className="mono small"><span className="muted">{L(lang, 'completa', 'full')}:</span> CS_{N} = {dec.full}</div>
            <div className="mono strong"><span className="muted small">{L(lang, 'semplificata', 'simplified')}:</span> CS_{N} = {dec.simplified}</div>
          </div>
          {mem ? (
            <div className="md-banks small">
              <p>{L(lang,
                `Bus dati a 32 bit: ${d.name} è fatta di 4 chip da ${sizeLabel(d.size / 4)} (uno per banco). BA1 e BA0 non escono dal DLX: al loro posto BE3…BE0. BA2 va al piedino A0 dei chip.`,
                `32-bit data bus: ${d.name} is made of 4 chips of ${sizeLabel(d.size / 4)} (one per bank). BA1 and BA0 are not emitted: BE3…BE0 instead. BA2 goes to pin A0.`)}</p>
              <ul className="mono">{[3, 2, 1, 0].map((i) => <li key={i}>CS_{N}{i} = {dec.simplified}·BE{i}</li>)}</ul>
            </div>
          ) : (
            peri.length > 0 && <ul className="mono small md-peri">{peri.map((c) => <li key={c.name}>{c.name} = {c.expr} <span className="muted">({hex(c.addr)})</span></li>)}</ul>
          )}
          <h3>{L(lang, 'Dove risponde', 'Where it answers')}</h3>
          {al.total === 1 ? (
            <p className="small">{L(lang, 'La decodifica semplificata coincide con quella completa: il dispositivo risponde solo ai suoi indirizzi.', 'Simplified decoding equals full decoding: the device answers only at its own addresses.')}</p>
          ) : (
            <>
              <p className="small">{L(lang,
                `Togliendo ${saved} bit dalla decodifica, ${d.name} risponde in ${al.total.toLocaleString('it')} zone da ${sizeLabel(d.size)} (decodifica parziale, slide 02). Va bene perché nessun altro dispositivo sta lì: il programma deve usare solo ${hex(d.base)}.`,
                `Dropping ${saved} bits, ${d.name} answers in ${al.total.toLocaleString('en')} zones of ${sizeLabel(d.size)} (partial decoding, slides 02). That is fine because no other device lives there: programs must use only ${hex(d.base)}.`)}</p>
              <ul className="mono small md-alias">
                {al.zones.map((z) => <li key={z} className={z === (d.base >>> 0) ? 'strong' : ''}>{hex(z)} – {hex(z + d.size - 1)}{z === (d.base >>> 0) ? L(lang, '  ← quella vera', '  ← the real one') : ''}</li>)}
                {al.total > al.zones.length && <li className="muted">… {L(lang, `e altre ${(al.total - al.zones.length).toLocaleString('it')}`, `and ${(al.total - al.zones.length).toLocaleString('en')} more`)}</li>}
              </ul>
            </>
          )}
          {draft.length > 1 && <p className="small muted">{L(lang, 'Prova a spostare o aggiungere un altro dispositivo: la decodifica semplificata si ricalcola subito.', 'Try moving or adding another device: simplified decoding updates immediately.')}</p>}
        </>
      )}
    </div>
  );
}

function Overview({ dec, draft, lang, select }: { dec: Decoding[]; draft: DeviceConfig[]; lang: 'it' | 'en'; select: (id: string) => void }) {
  const sorted = [...dec].sort((a, b) => b.range[0] - a.range[0]);
  return (
    <div className="md-insp">
      <h3>{L(lang, 'Come si usa', 'How to use it')}</h3>
      <ul className="small">
        <li>{L(lang, 'Trascina un dispositivo nella colonna per spostarlo: si aggancia sempre a un indirizzo allineato alla sua dimensione.', 'Drag a device in the column to move it: it always snaps to an address aligned to its size.')}</li>
        <li>{L(lang, 'Trascina un tipo dalla barra in alto per aggiungerlo.', 'Drag a kind from the top bar to add it.')}</li>
        <li>{L(lang, 'Clicca un dispositivo per vedere bit, chip-select e zone in cui risponde.', 'Click a device to see its bits, chip-selects and zones.')}</li>
        <li>{L(lang, '🔍 o doppio clic per ingrandire: ogni livello è una cifra esadecimale (4 bit).', '🔍 or double-click to zoom: each level is one hex digit (4 bits).')}</li>
      </ul>
      <h3>{L(lang, 'Decodifica semplificata', 'Simplified decoding')}</h3>
      <table className="md-table small">
        <tbody>
          {sorted.map((x) => {
            const d = draft.find((y) => y.id === x.id)!;
            return (
              <tr key={x.id} onClick={() => select(x.id)}>
                <td><span className={'md-dot k-' + d.kind} /> <button className="linklike" onClick={() => select(x.id)}>{x.name}</button></td>
                <td className="mono">CS_{csName(x.name)} = {x.simplified}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function popcount(n: number) {
  let c = 0;
  for (let x = n >>> 0; x; x >>>= 1) c += x & 1;
  return c;
}
