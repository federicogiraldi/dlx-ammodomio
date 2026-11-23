import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { simulatePipeline, PipelineOptions } from '../../core/pipeline/model';
import { hex } from '../../core/util';

const WINDOW = 14;

export function PipelinePanel() {
  const lang = useStore((s) => s.lang);
  const version = useStore((s) => s.version);
  const m = useStore((s) => s.machine);
  const [opts, setOpts] = useState<PipelineOptions>({ forwarding: true, branchPolicy: 'predict-not-taken', branchResolve: 'MEM', splitCycle: true });
  const [windowStart, setWindowStart] = useState<number | null>(null); // null = ultime istruzioni

  const full = useMemo(() => simulatePipeline(m.trace, opts), [version, opts, m]);
  const n = m.trace.length;
  const start = windowStart ?? Math.max(0, n - WINDOW);
  const slice = useMemo(() => simulatePipeline(m.trace.slice(start, start + WINDOW), opts), [version, opts, start, m]);
  const it = lang === 'it';
  const seqCpi = m.cpu.instret ? m.cpu.cycles / m.cpu.instret : 0;

  const maxCycle = Math.max(0, ...slice.rows.flatMap((r) => Object.keys(r.cells).map(Number)));
  const cycles = Array.from({ length: maxCycle }, (_, i) => i + 1);

  return (
    <section className="panel pipeline">
      <header className="panel-h">
        <h2>{it ? 'Pipeline a 5 stadi' : '5-stage pipeline'}</h2>
        <span className="chip">{it ? 'come nelle slide 08' : 'as in slides 08'}</span>
      </header>
      <div className="pipe-opts">
        <label><input type="checkbox" checked={opts.forwarding} onChange={(e) => setOpts({ ...opts, forwarding: e.target.checked })} /> Forwarding</label>
        <label><input type="checkbox" checked={opts.splitCycle !== false} onChange={(e) => setOpts({ ...opts, splitCycle: e.target.checked })} /> Split-cycle RF</label>
        <label>{it ? 'Salti' : 'Branches'}{' '}
          <select value={opts.branchPolicy} onChange={(e) => setOpts({ ...opts, branchPolicy: e.target.value })}>
            <option value="stall">Always stall</option>
            <option value="predict-not-taken">Predict not taken</option>
          </select>
        </label>
        <label>{it ? 'Nuovo PC noto in' : 'New PC known in'}{' '}
          <select value={opts.branchResolve} onChange={(e) => setOpts({ ...opts, branchResolve: e.target.value as 'ID' | 'EX' | 'MEM' })}>
            <option value="MEM">MEM (3 {it ? 'stalli' : 'stalls'})</option>
            <option value="EX">EX (2)</option>
            <option value="ID">ID (1)</option>
          </select>
        </label>
      </div>

      {n === 0 ? (
        <p className="empty">{it ? 'Esegui qualche istruzione (Step o Run): qui vedrai come sarebbero eseguite da un DLX pipelined, con alee, stalli e forwarding.' : 'Run some instructions: you will see how a pipelined DLX would execute them, with hazards, stalls and forwarding.'}</p>
      ) : (
        <>
          <div className="pipe-stats">
            <div><b>{full.instructions}</b> {it ? 'istruzioni' : 'instructions'}</div>
            <div><b>{full.cycles}</b> {it ? 'cicli in pipeline' : 'pipeline cycles'} <span className="muted">({it ? 'ideale' : 'ideal'} {full.instructions + 4})</span></div>
            <div>CPI pipeline <b>{full.cpi.toFixed(2)}</b></div>
            <div>CPI {it ? 'sequenziale' : 'sequential'} <b>{seqCpi.toFixed(2)}</b></div>
            <div>{it ? 'Stalli totali' : 'Total stalls'} <b>{full.totalStalls}</b></div>
          </div>
          <div className="row gap">
            <button disabled={start === 0} onClick={() => setWindowStart(Math.max(0, start - WINDOW))}>◀</button>
            <span className="small muted">{it ? 'istruzioni' : 'instructions'} {start + 1}–{Math.min(n, start + WINDOW)} / {n}</span>
            <button disabled={start + WINDOW >= n} onClick={() => setWindowStart(start + WINDOW >= n - WINDOW ? null : start + WINDOW)}>▶</button>
            {windowStart !== null && <button onClick={() => setWindowStart(null)}>{it ? 'Ultime' : 'Latest'}</button>}
          </div>
          <div className="pipe-scroll">
            <table className="pipegrid">
              <thead>
                <tr><th>#</th><th>{it ? 'Istruzione' : 'Instruction'}</th>{cycles.map((c) => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {slice.rows.map((r, i) => (
                  <tr key={i} className={r.kind === 'discarded' ? 'discarded' : ''}>
                    <td className="muted">{r.kind === 'discarded' ? '' : start + r.index + 1}</td>
                    <td className="mono instr" title={hex(r.pc)}>{r.kind === 'discarded' ? (it ? '(istruzione scartata)' : '(discarded)') : r.text}</td>
                    {cycles.map((c) => {
                      const st = r.cells[c];
                      return <td key={c} className={'cell ' + (st ? 's-' + st : '')}>{st === 'stall' ? '●' : st === 'flush' ? '✕' : st ?? ''}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pipe-legend small">
            <span className="cell s-IF">IF</span> fetch · <span className="cell s-ID">ID</span> decode · <span className="cell s-EX">EX</span> execute · <span className="cell s-MEM">MEM</span> memory · <span className="cell s-WB">WB</span> write-back · <span className="cell s-stall">●</span> {it ? 'stallo' : 'stall'} · <span className="cell s-flush">✕</span> {it ? 'scartata' : 'flushed'}
          </div>
          <h3>{it ? 'Alee in questa finestra' : 'Hazards in this window'}</h3>
          {slice.hazards.length === 0 ? <p className="muted small">{it ? 'Nessuna alea.' : 'No hazards.'}</p> : (
            <ul className="hazards">
              {slice.hazards.map((h, i) => (
                <li key={i} className={h.stalls > 0 ? 'bad' : 'ok'}>
                  <span className={'chip ' + (h.stalls > 0 ? 'warn' : 'ok')}>{h.kind}{h.stalls > 0 ? ` · ${h.stalls} ${it ? 'stalli' : 'stalls'}` : h.forwardedFrom ? ` · fwd ${h.forwardedFrom}` : ''}</span> {h.text[lang]}
                </li>
              ))}
            </ul>
          )}
          <p className="hint">{it
            ? 'Il simulatore esegue le istruzioni una alla volta (DLX sequenziale). Questa vista ricostruisce come la stessa sequenza verrebbe eseguita in pipeline. Prova a disattivare il forwarding o a cambiare la gestione dei salti e guarda come cambia il CPI.'
            : 'The simulator runs one instruction at a time (sequential DLX). This view rebuilds how the same sequence would run in a pipeline. Try turning forwarding off or changing the branch policy and watch the CPI.'}</p>
        </>
      )}
    </section>
  );
}
