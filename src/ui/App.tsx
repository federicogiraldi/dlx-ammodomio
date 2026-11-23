import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { useStore, Tab, shareLink, WELCOME } from './store';
import { tr } from '../i18n';
import { Editor } from './editor/Editor';
import { Registers } from './panels/Registers';
import { Explain } from './panels/Explain';
import { Memory } from './panels/Memory';
import { Devices } from './panels/Devices';
import { Reference } from './panels/Reference';
import { Problems } from './panels/Problems';
import { DatapathView } from './datapath/DatapathView';
import { PipelinePanel } from './panels/Pipeline';
import { hex } from '../core/util';

const Learn = lazy(() => import('./panels/Learn'));

function Toolbar() {
  const s = useStore();
  const lang = s.lang;
  useStore((x) => x.version);
  const m = s.machine;
  const errors = s.live.diagnostics.some((d) => d.severity === 'error');
  const disabled = errors;
  const st = s.status;
  const statusText = typeof st.text === 'string' ? tr(lang, st.text) : st.text[lang];
  const speeds = [1, 2, 4, 10, 30, 100, 1000];
  return (
    <div className="toolbar" role="toolbar">
      <div className="tb-group">
        <button className="primary" onClick={s.step} disabled={disabled || s.running || m.cpu.halted} title={tr(lang, 'stepTip')}>⏭ {tr(lang, 'step')}</button>
        <button onClick={s.back} disabled={!m.canStepBack() || s.dirty} title={tr(lang, 'backTip')}>⏮ {tr(lang, 'back')}</button>
        {s.running
          ? <button onClick={s.pause} className="warnbtn">⏸ {tr(lang, 'pause')}</button>
          : <button onClick={s.run} disabled={disabled || m.cpu.halted} title={tr(lang, 'runTip')}>▶ {tr(lang, 'run')}</button>}
        <button onClick={s.runToEnd} disabled={disabled || s.running || m.cpu.halted} title={tr(lang, 'fastTip')}>⏩ {tr(lang, 'fast')}</button>
        <button onClick={s.reset} title={tr(lang, 'resetTip')}>⟲ {tr(lang, 'reset')}</button>
      </div>
      <label className="tb-speed">
        {tr(lang, 'speed')}
        <select value={s.speed} onChange={(e) => s.setSpeed(Number(e.target.value))}>
          {speeds.map((v) => <option key={v} value={v}>{v}/s</option>)}
        </select>
      </label>
      <div className={'tb-status st-' + st.kind} aria-live="polite">{statusText}</div>
      <div className="tb-counters mono" title={lang === 'it' ? 'Istruzioni eseguite, cicli di clock (DLX sequenziale) e CPI medio' : 'Instructions, clock cycles (sequential DLX), average CPI'}>
        <span>PC {hex(m.cpu.pc)}</span>
        <span>{m.cpu.instret} {tr(lang, 'instr')}</span>
        <span>{m.cpu.cycles} {tr(lang, 'clocks')}</span>
        {m.cpu.instret > 0 && <span>CPI {(m.cpu.cycles / m.cpu.instret).toFixed(2)}</span>}
      </div>
    </div>
  );
}

function Header() {
  const s = useStore();
  const lang = s.lang;
  const fileRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState('');
  const flash = (t: string) => { setToast(t); window.setTimeout(() => setToast(''), 2200); };
  const save = () => {
    const blob = new Blob([s.source], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'programma.dlx';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <header className="app-h">
      <div className="brand">
        <span className="logo">DLX</span>
        <div>
          <h1>DLX ammodomio</h1>
          <small>{tr(lang, 'appSubtitle')}</small>
        </div>
      </div>
      <nav className="file-actions">
        <button onClick={() => { if (confirm(lang === 'it' ? 'Sostituire il programma con quello di benvenuto?' : 'Replace the program with the welcome one?')) s.loadProgram(WELCOME); }}>{tr(lang, 'newFile')}</button>
        <button onClick={() => fileRef.current?.click()}>{tr(lang, 'open')}</button>
        <input ref={fileRef} type="file" accept=".dlx,.s,.asm,.txt" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) s.loadProgram(await f.text());
          e.target.value = '';
        }} />
        <button onClick={save}>{tr(lang, 'save')}</button>
        <button onClick={async () => { try { await navigator.clipboard.writeText(shareLink(s.source)); flash(tr(lang, 'linkCopied')); } catch { prompt('Link', shareLink(s.source)); } }}>{tr(lang, 'share')}</button>
        <button onClick={() => s.setTab('learn')} className="learn-btn">🎓 {tr(lang, 'learn')}</button>
        <button className="icon" onClick={() => s.setTheme(s.theme === 'dark' ? 'light' : 'dark')} aria-label={tr(lang, 'theme')} title={tr(lang, 'theme')}>{s.theme === 'dark' ? '☀' : '☾'}</button>
        <button className="icon lang" onClick={() => s.setLang(lang === 'it' ? 'en' : 'it')} aria-label="Lingua / Language">{lang === 'it' ? 'EN' : 'IT'}</button>
      </nav>
      {toast && <div className="toast">{toast}</div>}
    </header>
  );
}

const TABS: { id: Tab; key: Parameters<typeof tr>[1] }[] = [
  { id: 'explain', key: 'whatHappened' },
  { id: 'memory', key: 'memory' },
  { id: 'devices', key: 'devices' },
  { id: 'datapath', key: 'datapath' },
  { id: 'pipeline', key: 'pipeline' },
  { id: 'reference', key: 'reference' },
  { id: 'learn', key: 'learn' },
];

function DatapathTab() {
  const lang = useStore((s) => s.lang);
  useStore((s) => s.version);
  const last = useStore((s) => s.last);
  const c = useStore((s) => s.machine).cpu;
  return (
    <section className="panel">
      <DatapathView
        micro={last?.micro ?? []}
        values={{ PC: c.pc, MAR: c.mar, MDR: c.mdr, IR: c.ir, A: c.a, B: c.b, C: c.c, TEMP: c.temp, IAR: c.iar }}
        instructionText={last?.text}
        lang={lang}
      />
    </section>
  );
}

export function App() {
  const s = useStore();
  const lang = s.lang;
  useEffect(() => { document.documentElement.dataset.theme = s.theme; }, [s.theme]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  // scorciatoie da tastiera come il simulatore originale
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const st = useStore.getState();
      if (e.key === 'F8') { e.preventDefault(); if (e.shiftKey) st.back(); else st.step(); }
      else if (e.key === 'F9') { e.preventDefault(); if (st.running) st.pause(); else st.run(); }
      else if (e.key === 'F10') { e.preventDefault(); st.reset(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const tab = s.tab;
  return (
    <div className="app">
      <Header />
      <Toolbar />
      <main className="layout">
        <div className="col-editor">
          <div className="editor-card">
            <div className="editor-h">
              <span className="muted small">{lang === 'it' ? 'Programma' : 'Program'} · {tr(lang, 'breakpointHint')}</span>
              {s.dirty && <span className="chip warn small">{lang === 'it' ? 'modificato: verrà ricaricato al prossimo Step' : 'edited: reloads on next Step'}</span>}
            </div>
            <Editor />
          </div>
          <Problems />
        </div>
        <div className="col-regs">
          <Registers />
        </div>
        <div className="col-tabs">
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => s.setTab(t.id)}>
                {tr(lang, t.key)}
              </button>
            ))}
          </div>
          <div className="tab-body">
            {tab === 'explain' && <Explain />}
            {tab === 'memory' && <Memory />}
            {tab === 'devices' && <Devices />}
            {tab === 'datapath' && <DatapathTab />}
            {tab === 'pipeline' && <PipelinePanel />}
            {tab === 'reference' && <Reference />}
            {tab === 'learn' && <Suspense fallback={<p>…</p>}><Learn /></Suspense>}
          </div>
        </div>
      </main>
    </div>
  );
}
