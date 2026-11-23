import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { GROUP_NAMES, Group, INSTRUCTIONS, syntaxOf } from '../../core/isa/table';

export function Reference() {
  const lang = useStore((s) => s.lang);
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const list = INSTRUCTIONS.filter((d) => !qq || d.mn.toLowerCase().includes(qq) || d.doc[lang].toLowerCase().includes(qq) || d.rtl.toLowerCase().includes(qq));
    const g = new Map<Group, typeof list>();
    for (const d of list) g.set(d.group, [...(g.get(d.group) ?? []), d]);
    return g;
  }, [q, lang]);

  return (
    <section className="panel reference">
      <header className="panel-h">
        <h2>{lang === 'it' ? 'Riferimento istruzioni' : 'Instruction reference'}</h2>
        <input className="search" placeholder={lang === 'it' ? 'Cerca (es. load, segno, R31)…' : 'Search…'} value={q} onChange={(e) => setQ(e.target.value)} />
      </header>
      <details className="syntax-help" open={!q}>
        <summary>{lang === 'it' ? 'Sintassi dell\'assembler' : 'Assembler syntax'}</summary>
        {lang === 'it' ? (
          <ul>
            <li><b>Commenti</b>: <code>; testo</code> (anche <code>//</code>).</li>
            <li><b>Etichette</b>: <code>loop:</code> all'inizio della riga, anche da sola su una riga.</li>
            <li><b>Numeri</b>: decimali <code>12</code>, <code>-1</code>; esadecimali <code>0x800</code>, <code>800h</code>, <code>0FFh</code>; binari <code>0b1010</code>; caratteri <code>'A'</code>. Attenzione: <code>0800</code> senza h è decimale.</li>
            <li><b>Registri</b>: <code>R0</code>…<code>R31</code> (R0 = 0 sempre, R31 = ritorno di JAL). Registro speciale: <code>IAR</code>.</li>
            <li><b>Memoria</b>: <code>offset(Rbase)</code>, es. <code>LW R1,0x0800(R9)</code>, <code>SW R1,-4(R2)</code>, <code>LW R1,(R2)</code>. Nelle store va bene anche <code>SW 4(R2),R1</code>.</li>
            <li><b>Costanti a 32 bit</b>: <code>LHI R1,0x4000</code> + <code>ORI R1,R1,0x1234</code>, oppure con le funzioni <code>hi(etichetta)</code> e <code>lo(etichetta)</code>.</li>
            <li><b>Direttive</b>: <code>.data</code> (dati in RAM, da 0x40000000), <code>.text</code>, <code>.org indirizzo</code>, <code>.word 1,2,3</code>, <code>.half</code>, <code>.byte</code>, <code>.space n</code>, <code>.asciiz "testo"</code>, <code>.align 2</code>, <code>.equ NOME, valore</code> (o <code>NOME EQU valore</code>).</li>
            <li><b>Fine programma</b>: <code>HALT</code> (= <code>TRAP 0</code>). Il programma parte da <code>0x00000000</code>, dove il DLX inizia dopo il RESET; lì va anche l'interrupt handler.</li>
          </ul>
        ) : (
          <ul>
            <li><b>Comments</b>: <code>; text</code>. <b>Labels</b>: <code>loop:</code>.</li>
            <li><b>Numbers</b>: <code>12</code>, <code>-1</code>, <code>0x800</code>, <code>800h</code>, <code>0b1010</code>, <code>'A'</code>. Note: <code>0800</code> without h is decimal.</li>
            <li><b>Registers</b>: <code>R0</code>…<code>R31</code>, special <code>IAR</code>. <b>Memory</b>: <code>offset(Rbase)</code>.</li>
            <li><b>32-bit constants</b>: <code>LHI</code> + <code>ORI</code>, or <code>hi(label)</code>/<code>lo(label)</code>.</li>
            <li><b>Directives</b>: <code>.data .text .org .word .half .byte .space .asciiz .align .equ</code>.</li>
            <li><b>End</b>: <code>HALT</code>. Programs start at <code>0x00000000</code>, which is also the interrupt handler address.</li>
          </ul>
        )}
      </details>
      {[...groups.entries()].map(([g, list]) => (
        <div key={g} className="ref-group">
          <h3>{GROUP_NAMES[g][lang]}</h3>
          <table className="reftable">
            <tbody>
              {list.map((d) => (
                <tr key={d.mn}>
                  <td className="mono mn">{d.mn}<span className={'fmt f' + d.fmt}>{d.fmt}</span>{!d.course && <span className="ext" title={lang === 'it' ? 'Non presente nelle slide del corso' : 'Not in the course slides'}>+</span>}</td>
                  <td>
                    <div className="mono syn">{syntaxOf(d)}</div>
                    <div className="mono rtl">{d.rtl}</div>
                    <div>{d.doc[lang]}</div>
                    <div className="mono ex">{lang === 'it' ? 'es.' : 'e.g.'} {d.example}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
