import { useStore } from '../store';
import { tr } from '../../i18n';

export function Problems({ onGoto }: { onGoto?: (line: number) => void }) {
  const lang = useStore((s) => s.lang);
  const live = useStore((s) => s.live);
  useStore((s) => s.version);
  const m = useStore((s) => s.machine);
  const diags = [...live.diagnostics, ...(!useStore.getState().dirty ? m.loadErrors.map((e) => ({ line: e.line ?? 0, severity: 'error' as const, text: e.text, from: 0, to: 0 })) : [])];
  const errors = diags.filter((d) => d.severity === 'error').length;
  const warns = diags.filter((d) => d.severity === 'warning').length;
  return (
    <section className="problems">
      <div className="problems-h">
        <b>{tr(lang, 'problems')}</b>
        {errors > 0 && <span className="chip err">{errors} {lang === 'it' ? (errors === 1 ? 'errore' : 'errori') : 'errors'}</span>}
        {warns > 0 && <span className="chip warn">{warns} {lang === 'it' ? 'avvisi' : 'warnings'}</span>}
        {diags.length === 0 && <span className="muted">{tr(lang, 'noProblems')}</span>}
      </div>
      {diags.length > 0 && (
        <ul>
          {diags.map((d, i) => (
            <li key={i} className={'sev-' + d.severity}>
              <button className="linklike" onClick={() => onGoto?.(d.line)}>{lang === 'it' ? 'riga' : 'line'} {d.line}</button>
              <span>{d.severity === 'error' ? '✖' : d.severity === 'warning' ? '⚠' : 'ℹ'} {d.text[lang]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
