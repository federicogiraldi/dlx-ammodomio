import { Fragment, ReactNode, useState } from 'react';
import { useStore } from '../store';
import { EXAMPLES, TUTORIALS, EXERCISES } from '../../content';
import type { Exercise, CheckResult } from '../../content/types';
import { Machine, DEFAULT_MAP } from '../../core/machine';
import { SimError } from '../../core/util';

/** markdown-lite: paragrafi, elenchi "- ", **grassetto**, `codice` */
function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const tok = m[0];
    out.push(tok.startsWith('**') ? <b key={m.index}>{tok.slice(2, -2)}</b> : <code key={m.index}>{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export function Md({ text }: { text: string }) {
  const blocks = text.trim().split(/\n\s*\n/);
  return (
    <div className="md">
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*- /.test(l))) {
          return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*- /, ''))}</li>)}</ul>;
        }
        return <p key={i}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}</p>;
      })}
    </div>
  );
}

const LS_DONE = 'dlx.doneExercises';
const getDone = (): string[] => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(LS_DONE) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};
const saveDone = (d: string[]) => { try { localStorage.setItem(LS_DONE, JSON.stringify(d)); } catch { /* ignora */ } };

function runCheck(ex: Exercise, source: string): { results: CheckResult[]; error?: string; steps: number } {
  const m = new Machine(ex.map ?? DEFAULT_MAP);
  m.load(source);
  if (!m.ready) {
    return { results: [{ ok: false, text: { it: 'Il programma ha errori: correggili prima (vedi "Problemi").', en: 'The program has errors: fix them first.' } }], steps: 0 };
  }
  ex.setup?.(m);
  try {
    const o = m.run(ex.maxSteps ?? 200000);
    const results = ex.check(m);
    const err = o.reason === 'error' ? o.error!.text : undefined;
    if (err) results.unshift({ ok: false, text: { it: `Errore in esecuzione: ${err.it}`, en: `Runtime error: ${err.en}` } });
    if (o.reason === 'limit' && !ex.maxSteps) results.unshift({ ok: false, text: { it: 'Il programma non termina (ciclo infinito?). Ricordati HALT.', en: 'The program never ends (infinite loop?). Remember HALT.' } });
    return { results, steps: o.steps };
  } catch (e) {
    if (e instanceof SimError) return { results: [{ ok: false, text: e.text }], steps: 0 };
    throw e;
  }
}

function Exercises() {
  const s = useStore();
  const lang = s.lang;
  const it = lang === 'it';
  const [sel, setSel] = useState<string | null>(null);
  const [hints, setHints] = useState(0);
  const [res, setRes] = useState<CheckResult[] | null>(null);
  const [showSol, setShowSol] = useState(false);
  const [done, setDone] = useState<string[]>(getDone);
  const ex = EXERCISES.find((e) => e.id === sel);

  if (!ex) {
    return (
      <ul className="cards">
        {EXERCISES.map((e) => (
          <li key={e.id}>
            <button className="card" onClick={() => { setSel(e.id); setHints(0); setRes(null); setShowSol(false); }}>
              <span className="card-title">{done.includes(e.id) ? '✅ ' : ''}{e.title[lang]}</span>
              <span className="stars" aria-label={`difficoltà ${e.difficulty}`}>{'★'.repeat(e.difficulty)}{'☆'.repeat(3 - e.difficulty)}</span>
            </button>
          </li>
        ))}
      </ul>
    );
  }
  const verify = () => {
    const r = runCheck(ex, s.source).results;
    setRes(r);
    if (r.every((x) => x.ok) && !done.includes(ex.id)) {
      const d = [...done, ex.id];
      setDone(d);
      saveDone(d);
    }
  };
  const allOk = res?.every((r) => r.ok);
  return (
    <div className="exercise">
      <button className="linklike" onClick={() => setSel(null)}>← {it ? 'Tutti gli esercizi' : 'All exercises'}</button>
      <h3 className="ex-h">{ex.title[lang]} <span className="stars">{'★'.repeat(ex.difficulty)}{'☆'.repeat(3 - ex.difficulty)}</span></h3>
      <Md text={ex.statement[lang]} />
      <div className="row gap">
        <button className="primary" onClick={() => { if (confirm(it ? 'Caricare il codice iniziale dell\'esercizio? Il programma attuale verrà sostituito (salvalo prima se ti serve).' : 'Load the exercise starter code? The current program will be replaced.')) { s.loadProgram(ex.starter, ex.map ?? DEFAULT_MAP); setRes(null); } }}>
          {it ? '1. Carica il codice iniziale' : '1. Load starter code'}
        </button>
        <button onClick={verify}>{it ? '2. ✔ Verifica la mia soluzione' : '2. ✔ Check my solution'}</button>
      </div>
      {res && (
        <div className={'alert ' + (allOk ? 'ok' : 'error')}>
          <b>{allOk ? (it ? '🎉 Esercizio risolto!' : '🎉 Solved!') : (it ? 'Non ancora: guarda cosa manca' : 'Not yet: see what is missing')}</b>
          <ul className="checks">{res.map((r, i) => <li key={i}>{r.ok ? '✅' : '❌'} {r.text[lang]}</li>)}</ul>
        </div>
      )}
      <div className="hints">
        {ex.hints.slice(0, hints).map((h, i) => <div key={i} className="hint-box">💡 <Md text={h[lang]} /></div>)}
        {hints < ex.hints.length && <button onClick={() => setHints(hints + 1)}>💡 {it ? `Suggerimento (${hints + 1}/${ex.hints.length})` : `Hint (${hints + 1}/${ex.hints.length})`}</button>}
        {' '}
        <button onClick={() => setShowSol(!showSol)}>{showSol ? (it ? 'Nascondi soluzione' : 'Hide solution') : (it ? 'Mostra una soluzione' : 'Show a solution')}</button>
      </div>
      {showSol && (
        <div className="solution">
          <pre className="code">{ex.solution}</pre>
          <button onClick={() => { if (confirm(it ? 'Caricare la soluzione nell\'editor?' : 'Load the solution into the editor?')) s.loadProgram(ex.solution, ex.map ?? DEFAULT_MAP); }}>{it ? 'Carica la soluzione nell\'editor' : 'Load solution into editor'}</button>
        </div>
      )}
      <p className="hint">{it ? 'La verifica esegue il tuo programma in una macchina separata (dopo un RESET), quindi non tocca lo stato che stai guardando.' : 'Checking runs your program on a separate machine (after RESET), so it does not touch the state you are looking at.'}</p>
    </div>
  );
}

function Tutorials() {
  const s = useStore();
  const lang = s.lang;
  const it = lang === 'it';
  const [sel, setSel] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const tut = TUTORIALS.find((t) => t.id === sel);
  if (!tut) {
    return (
      <ol className="cards numbered">
        {TUTORIALS.map((t) => (
          <li key={t.id}>
            <button className="card" onClick={() => { setSel(t.id); setStep(0); }}>
              <span className="card-title">{t.title[lang]}</span>
              <span className="card-sub">{t.summary[lang]}</span>
            </button>
          </li>
        ))}
      </ol>
    );
  }
  const st = tut.steps[step];
  return (
    <div className="tutorial">
      <button className="linklike" onClick={() => setSel(null)}>← {it ? 'Tutti i tutorial' : 'All tutorials'}</button>
      <h3 className="ex-h">{tut.title[lang]}</h3>
      <div className="progress">{tut.steps.map((_, i) => <button key={i} className={i === step ? 'on' : i < step ? 'past' : ''} onClick={() => setStep(i)} aria-label={`${i + 1}`} />)}</div>
      <h4>{step + 1}. {st.title[lang]}</h4>
      <Md text={st.body[lang]} />
      {st.code && (
        <div className="tut-code">
          <pre className="code">{st.code}</pre>
          <button className="primary" onClick={() => s.loadProgram(st.code!, st.map ?? DEFAULT_MAP)}>{it ? '▶ Carica nell\'editor' : '▶ Load into editor'}</button>
        </div>
      )}
      {st.tryIt && <div className="tryit">👉 <Md text={st.tryIt[lang]} /></div>}
      <div className="row gap">
        <button disabled={step === 0} onClick={() => setStep(step - 1)}>← {it ? 'Indietro' : 'Back'}</button>
        {step < tut.steps.length - 1
          ? <button className="primary" onClick={() => setStep(step + 1)}>{it ? 'Avanti' : 'Next'} →</button>
          : <button className="primary" onClick={() => setSel(null)}>{it ? 'Fine ✓' : 'Done ✓'}</button>}
      </div>
    </div>
  );
}

function Examples() {
  const s = useStore();
  const lang = s.lang;
  return (
    <ul className="cards">
      {EXAMPLES.map((e) => (
        <li key={e.id}>
          <button className="card" onClick={() => { if (confirm(lang === 'it' ? `Caricare l'esempio "${e.title.it}"? Il programma attuale verrà sostituito.` : `Load example "${e.title.en}"? The current program will be replaced.`)) { s.loadProgram(e.code, e.map ?? DEFAULT_MAP); s.setTab('explain'); } }}>
            <span className="card-title">{e.title[lang]}</span>
            <span className="card-sub">{e.description[lang]}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function Learn() {
  const lang = useStore((s) => s.lang);
  const [tab, setTab] = useState<'tut' | 'ex' | 'examples'>('tut');
  const it = lang === 'it';
  return (
    <section className="panel learn">
      <header className="panel-h">
        <h2>🎓 {it ? 'Impara il DLX' : 'Learn the DLX'}</h2>
        <div className="seg">
          <button className={tab === 'tut' ? 'on' : ''} onClick={() => setTab('tut')}>Tutorial</button>
          <button className={tab === 'ex' ? 'on' : ''} onClick={() => setTab('ex')}>{it ? 'Esercizi' : 'Exercises'}</button>
          <button className={tab === 'examples' ? 'on' : ''} onClick={() => setTab('examples')}>{it ? 'Esempi' : 'Examples'}</button>
        </div>
      </header>
      {tab === 'tut' && <Tutorials />}
      {tab === 'ex' && <Exercises />}
      {tab === 'examples' && <Examples />}
    </section>
  );
}
