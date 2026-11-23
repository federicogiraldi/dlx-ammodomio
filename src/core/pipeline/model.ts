/**
 * Modello di TEMPORIZZAZIONE della pipeline a 5 stadi del DLX (IF ID EX MEM WB).
 *
 * Il simulatore esegue le istruzioni in modo funzionale (una per volta); questo modulo
 * prende la traccia delle istruzioni eseguite (`Machine.trace`) e ricostruisce, ciclo per ciclo,
 * come sarebbero attraversate le 5 fasi in una pipeline, con stalli e flush.
 *
 * Riferimenti alle slide del corso "08_DLX_pipelined.pdf":
 *
 *  [S-IDEALE]  "Latenza: 5 fasi (clock); Throughput: a regime un'istruzione per clock".
 *              N istruzioni senza alee -> N + 4 cicli (T_N = N * (1+S) * CLK con S = 0 a regime).
 *
 *  [S-STALLO]  Slide "Alee e Stalli": "L'istruzione che non puo' essere eseguita viene bloccata
 *              (stallo della pipeline), insieme a tutte quelle che la seguono, mentre le istruzioni
 *              che la precedono avanzano normalmente". "Stallo: blocco del clock dello stadio e di
 *              tutti quelli precedenti". Tabella: T_N = N * (1 + S) * CLK, CPI = 1 + stalli per istr.
 *              Nel modello: l'istruzione bloccata resta in ID (celle 'stall'), quella dopo resta in IF.
 *
 *  [S-RAW-NOFWD] Slide "Alee e Stalli" (esempio Ii dipendente da Ii-1): "Ii-1 scrive solo in WB
 *              (nel DLX si alterano i registri solo in WB)", Ii deve aspettare e il suo ID viene
 *              ripetuto dopo il WB: T5 = 8 CLK = (5 + 3) CLK -> 3 stalli per dipendenza adiacente
 *              (distanza 1) quando il register file NON e' split-cycle.
 *
 *  [S-SPLIT]   Slide "Split-cycle": "In questo semiperiodo si scrive il registro / In questo
 *              semiperiodo si legge il registro" (scrittura prima metà, lettura seconda metà del
 *              clock): l'ID dell'istruzione consumatrice puo' coincidere con il WB del produttore.
 *              Con split-cycle e senza forwarding: 2 stalli (distanza 1), 1 stallo (distanza 2),
 *              0 (distanza >= 3). Senza split-cycle: 3, 2, 1, 0. (Opzione `splitCycle`, default true.)
 *
 *  [S-FWD]     Slide "Forwarding" / "Implementazione del Forwarding": "Il forwarding consente di
 *              eliminare quasi tutte le alee di tipo RAW della pipeline del DLX senza stallare la
 *              pipeline". La Forwarding Unit confronta RS1/RS2 con RD1/RD2 (registri di destinazione
 *              in EX/MEM e MEM/WB) e comanda i MUX all'ingresso della ALU: il risultato di una
 *              istruzione ALU e' inoltrato da EX/MEM (distanza 1) o MEM/WB (distanza 2). Distanza 3:
 *              il dato e' nel register file grazie allo split-cycle / al bypass interno al RF
 *              ("Spesso realizzato all'interno del RF").
 *
 *  [S-LOAD]    Slide "Alea di dato dovuta alle istruzioni di LOAD": "il dato richiesto dalla ADD e'
 *              presente solo alla fine di MEM. L'alea non puo' essere eliminata con il forwarding.
 *              E' necessario stallare la pipeline" -> 1 stallo (load-use), poi forwarding da MEM/WB.
 *              (La slide "Delayed load" - gestione via compilatore - NON e' modellata: la CPU
 *              simulata non ha delay slot.)
 *
 *  [S-SALTI]   Slide "Pipeline del DLX / Esecuzione in pipeline di BRANCH, JR, JL": la condizione
 *              (=0?) e' calcolata in EX, il nuovo PC e' caricato dallo stadio MEM ("if (Cond) PC <- X"
 *              in MEM). Slide "Stalli nel salto (1/3)": il nuovo PC agisce sulla IM quando tre
 *              istruzioni hanno eseguito i primi tre stadi (fino a EX) -> 3 NOP forzate.
 *              "Stalli nel salto (2/3)": nuovo PC calcolato nello stesso periodo della condizione
 *              (EX) -> 2 NOP. "Stalli nel salto (3/3)": condizione in ID -> 1 NOP.
 *              Opzione `branchResolve`: 'MEM' (default, 3 stalli), 'EX' (2), 'ID' (1).
 *              Vale per salti condizionati e incondizionati (J, JAL, JR, JALR, RFE, TRAP n):
 *              "Durante JMP e BRANCH taken in IF/ID entra PC... sara' eliminata l'istruzione mediante NOP".
 *
 *  [S-POLICY]  Slide "Gestione delle Alee di Controllo":
 *              - "Always Stall (blocco di tre clock che si propaga)": CPI = 1 + 3 * 0.25 = 1.75 con
 *                25% di salti. Ogni salto (preso o no) ferma il fetch finche' il PC e' noto.
 *                -> branchPolicy 'stall'.
 *              - "Predict Not Taken": si prosegue a PC+4; se il salto e' preso le istruzioni sbagliate
 *                vengono trasformate in NOP (flush: "Nessun danno: nessuna istruzione ha effettuato WB").
 *                Salto non preso: 0 stalli; salto preso: 3 (o 2/1) cicli persi. -> 'predict-not-taken'.
 *              - "Delayed branch" (delay slot gestiti dal compilatore) e "BTB / Dynamic Prediction":
 *                NON implementati. Il primo richiede codice compilato con delay slot (la CPU simulata
 *                non li ha); il secondo e' descritto solo qualitativamente ("Predizione corretta: 0
 *                stalli; errata: da 1 a 3").
 *
 *  [S-STRUT]   Alee strutturali: il DLX ha memoria istruzioni e dati separate (IM/DM) e RF a doppia
 *              fase, quindi nessuna alea strutturale (tipo 'structural' previsto ma mai generato).
 *
 * Convenzioni di rappresentazione
 *  - Cicli numerati da 1. Una riga per istruzione ESEGUITA (kind 'executed'), nell'ordine di traccia.
 *  - Le istruzioni cosi' dette "sbagliate" (fetchate dopo un salto preso con 'predict-not-taken') non
 *    sono nella traccia: sono mostrate come righe `kind: 'discarded'` con testo "(istruzione scartata)",
 *    che attraversano gli stadi fino al ciclo in cui il salto e' risolto e poi hanno una cella 'flush'.
 *  - Politica 'stall': i cicli persi sono celle 'stall' nella riga dell'istruzione successiva al salto,
 *    prima del suo IF.
 *  - Stallo dati: celle 'stall' dopo l'ID dell'istruzione consumatrice (resta in ID), e dopo l'IF
 *    delle istruzioni successive (restano in IF).
 *  - Il dato letto da una store (rs2) e il dato di un branch/JR (rs1) sono richiesti in EX, come nel
 *    datapath delle slide (i MUX del forwarding sono davanti alla ALU/al registro B). Con
 *    `branchResolve: 'ID'` la condizione e' richiesta in ID.
 */

import type { Decoded } from '../isa/encode';
import type { StepResult } from '../cpu/cpu';

export type BranchPolicy = 'stall' | 'predict-not-taken';

export interface PipelineOptions {
  /** forwarding (bypass EX/MEM e MEM/WB verso gli ingressi della ALU) attivo? */
  forwarding: boolean;
  branchPolicy: BranchPolicy | string;
  /** stadio in cui e' nota la condizione e il nuovo PC (slide "Stalli nel salto 1/3, 2/3, 3/3"). Default 'MEM'. */
  branchResolve?: 'ID' | 'EX' | 'MEM';
  /** RF scritto nella prima meta' del clock e letto nella seconda (slide "Split-cycle"). Default true. */
  splitCycle?: boolean;
}

export type Stage = 'IF' | 'ID' | 'EX' | 'MEM' | 'WB' | 'stall' | 'flush';

export interface PipeCell {
  stage: Stage;
}

export interface PipeRow {
  /** indice dell'istruzione nella traccia (per le righe 'discarded': indice del salto che le ha causate) */
  index: number;
  pc: number;
  text: string;
  cells: Record<number /* ciclo */, PipeCell['stage']>;
  firstCycle: number;
  kind?: 'executed' | 'discarded';
}

export interface Hazard {
  kind: 'RAW' | 'load-use' | 'control' | 'structural';
  /** indice (nella traccia) dell'istruzione che subisce lo stallo / che riceve il dato */
  consumer: number;
  /** istruzione produttrice (RAW) o salto (control) */
  producer?: number;
  reg?: number;
  /** cicli di stallo attribuiti a questa alea (0 se risolta dal forwarding o dalla predizione corretta) */
  stalls: number;
  forwardedFrom?: 'EX/MEM' | 'MEM/WB';
  text: { it: string; en: string };
}

export interface PipelineResult {
  rows: PipeRow[];
  cycles: number;
  instructions: number;
  cpi: number;
  hazards: Hazard[];
  /** cicli persi totali = cycles - (instructions + 4) */
  totalStalls: number;
}

/** Cicli per N istruzioni senza alcuna alea: riempimento (4) + una per ciclo [S-IDEALE]. */
export const idealCycles = (n: number): number => (n > 0 ? n + 4 : 0);

/** Cicli persi per salto in funzione dello stadio di risoluzione [S-SALTI]. */
export const BRANCH_PENALTY: Record<'ID' | 'EX' | 'MEM', number> = { ID: 1, EX: 2, MEM: 3 };

/** Registri generali letti e scritto da un'istruzione. R0 non genera mai dipendenze. */
export function regsOf(d: Decoded): { reads: number[]; writes: number | null } {
  const def = d.def;
  let reads: number[] = [];
  let writes: number | null = null;
  switch (def.group) {
    case 'alu':
    case 'shift':
    case 'set':
      reads = def.shape === 'rrr' ? [d.rs1, d.rs2] : [d.rs1];
      writes = d.rd;
      break;
    case 'lhi':
      writes = d.rd;
      break;
    case 'load':
      reads = [d.rs1];
      writes = d.rd;
      break;
    case 'store':
      reads = [d.rs1, d.rs2];
      break;
    case 'branch':
      reads = [d.rs1];
      break;
    case 'jump':
      if (def.shape === 'jreg') reads = [d.rs1];
      if (def.mn === 'JAL' || def.mn === 'JALR') writes = 31;
      break;
    case 'special':
      if (def.mn === 'MOVI2S') reads = [d.rs1];
      else if (def.mn === 'MOVS2I') writes = d.rd;
      break;
    default:
      break;
  }
  reads = [...new Set(reads)].filter((r) => r !== 0);
  if (writes === 0) writes = null;
  return { reads, writes };
}

/** istruzione che cambia il flusso di controllo (HALT escluso) */
function isControl(s: StepResult): boolean {
  const d = s.decoded;
  if (s.halted) return false;
  if (d.def.group === 'branch' || d.def.group === 'jump') return true;
  if (d.def.mn === 'RFE') return true;
  if (d.def.mn === 'TRAP' && d.imm26 !== 0) return true;
  return false;
}

/** il salto cambia davvero il PC (preso / incondizionato / interrupt)? */
function redirects(s: StepResult): boolean {
  if (s.interrupt) return true;
  if (s.decoded.def.group === 'branch') return !!s.taken;
  return isControl(s);
}

/** produttore il cui risultato e' disponibile solo dopo MEM (load, link di JAL/JALR) [S-LOAD] */
function isLate(d: Decoded): boolean {
  return d.def.group === 'load' || d.def.mn === 'JAL' || d.def.mn === 'JALR';
}

const R = (n: number) => `R${n}`;

interface Writer {
  idx: number;
  ex: number;
  late: boolean;
}

export function simulatePipeline(trace: StepResult[], opts: PipelineOptions): PipelineResult {
  const fwd = !!opts.forwarding;
  const split = opts.splitCycle !== false;
  const policy = opts.branchPolicy === 'predict-not-taken' ? 'predict-not-taken' : 'stall';
  const resolveAt = opts.branchResolve ?? 'MEM';
  const penalty = BRANCH_PENALTY[resolveAt];

  const rows: PipeRow[] = [];
  const hazards: Hazard[] = [];
  const lastWriter = new Map<number, Writer>();
  const label = (i: number) => `#${i + 1} ${trace[i].text}`;

  let prevId = 1; // ciclo in cui l'istruzione precedente e' entrata in ID (= primo IF nominale della successiva)
  let prevEx = 0; // ciclo in cui l'istruzione precedente e' entrata in EX (= lascia ID)
  let redirectFetch = 0; // primo ciclo in cui si puo' fare il fetch al nuovo PC

  for (let i = 0; i < trace.length; i++) {
    const s = trace[i];
    const d = s.decoded;
    const nominalIF = i === 0 ? 1 : prevId;
    const ifc = Math.max(nominalIF, redirectFetch);
    const idc = Math.max(ifc + 1, prevEx);
    const nomEx = idc + 1;
    let ex = nomEx;

    // ---------- alee di dato ----------
    const { reads } = regsOf(d);
    // la condizione del salto con risoluzione in ID e' letta in ID
    const readInId = resolveAt === 'ID' && d.def.group === 'branch';
    const need: { reg: number; w: Writer; req: number }[] = [];
    for (const r of reads) {
      const w = lastWriter.get(r);
      if (!w) continue;
      let req: number;
      if (fwd) {
        req = w.ex + (w.late ? 2 : 1) + (readInId ? 1 : 0); // [S-FWD] [S-LOAD]
      } else {
        req = w.ex + 3 + (split ? 0 : 1); // [S-RAW-NOFWD] [S-SPLIT]
      }
      need.push({ reg: r, w, req });
      ex = Math.max(ex, req);
    }
    for (const n of need) {
      const dist = ex - n.w.ex; // 1 => EX/MEM, 2 => MEM/WB
      const stalls = Math.max(0, n.req - nomEx);
      const fromWhere: 'EX/MEM' | 'MEM/WB' | undefined = fwd ? (dist === 1 ? 'EX/MEM' : dist === 2 ? 'MEM/WB' : undefined) : undefined;
      if (stalls === 0 && !fromWhere) continue; // dato gia' nel register file: nessuna alea visibile
      const pIdx = n.w.idx;
      const kind: Hazard['kind'] = fwd && n.w.late && stalls > 0 ? 'load-use' : 'RAW';
      const dd = pIdx === i - 1 ? 'adiacente' : `a distanza ${i - pIdx}`;
      const ddEn = pIdx === i - 1 ? 'adjacent' : `distance ${i - pIdx}`;
      const base = {
        it: `RAW su ${R(n.reg)}: ${label(i)} usa ${R(n.reg)} prodotto da ${label(pIdx)} (${dd}). `,
        en: `RAW on ${R(n.reg)}: ${label(i)} uses ${R(n.reg)} produced by ${label(pIdx)} (${ddEn}). `,
      };
      let itT: string;
      let enT: string;
      if (!fwd) {
        itT = `Senza forwarding il dato e' scritto nel register file solo in WB${split ? ' (prima meta\' del clock; la lettura in ID avviene nella seconda)' : ''}: ${stalls} stall${stalls === 1 ? 'o' : 'i'}.`;
        enT = `Without forwarding the value reaches the register file only in WB${split ? ' (first half of the clock; ID reads in the second half)' : ''}: ${stalls} stall${stalls === 1 ? '' : 's'}.`;
      } else if (n.w.late && stalls > 0) {
        itT = `Load-use: ${stalls} stallo anche con forwarding (il dato e' disponibile solo dopo MEM, poi inoltrato da MEM/WB).`;
        enT = `Load-use: ${stalls} stall even with forwarding (data is only available after MEM, then forwarded from MEM/WB).`;
      } else if (stalls > 0) {
        itT = `Forwarding da ${fromWhere}, ma servono comunque ${stalls} stall${stalls === 1 ? 'o' : 'i'} (la condizione del salto e' letta in ID).`;
        enT = `Forwarding from ${fromWhere}, but ${stalls} stall${stalls === 1 ? '' : 's'} still needed (branch condition read in ID).`;
      } else {
        itT = `Risolta dal forwarding da ${fromWhere}: nessuno stallo.`;
        enT = `Solved by forwarding from ${fromWhere}: no stall.`;
      }
      hazards.push({
        kind,
        consumer: i,
        producer: pIdx,
        reg: n.reg,
        stalls,
        forwardedFrom: fromWhere,
        text: { it: base.it + itT, en: base.en + enT },
      });
    }

    const mem = ex + 1;
    const wb = ex + 2;

    // ---------- celle ----------
    const cells: Record<number, Stage> = {};
    for (let c = nominalIF; c < ifc; c++) cells[c] = 'stall'; // bolla da alea di controllo
    cells[ifc] = 'IF';
    for (let c = ifc + 1; c < idc; c++) cells[c] = 'stall'; // trattenuta in IF
    cells[idc] = 'ID';
    for (let c = idc + 1; c < ex; c++) cells[c] = 'stall'; // trattenuta in ID
    cells[ex] = 'EX';
    cells[mem] = 'MEM';
    cells[wb] = 'WB';
    const first = Math.min(...Object.keys(cells).map(Number));
    rows.push({ index: i, pc: s.pc, text: s.text, cells, firstCycle: first, kind: 'executed' });

    // ---------- alee di controllo ----------
    const next = i + 1 < trace.length ? i + 1 : -1;
    const ctrl = isControl(s) || !!s.interrupt;
    redirectFetch = 0;
    if (ctrl && next >= 0) {
      const resolve = resolveAt === 'ID' ? ex - 1 : resolveAt === 'EX' ? ex : ex + 1;
      const redirect = resolve + 1;
      const taken = redirects(s);
      const what = s.interrupt ? 'interrupt' : d.def.group === 'branch' ? (taken ? `${d.def.mn} preso` : `${d.def.mn} non preso`) : `${d.def.mn}`;
      const whatEn = s.interrupt ? 'interrupt' : d.def.group === 'branch' ? (taken ? `${d.def.mn} taken` : `${d.def.mn} not taken`) : `${d.def.mn}`;
      const stageIt = resolveAt === 'MEM' ? 'in MEM' : resolveAt === 'EX' ? 'in EX' : 'in ID';
      if (policy === 'stall') {
        redirectFetch = redirect;
        hazards.push({
          kind: 'control',
          consumer: next,
          producer: i,
          stalls: penalty,
          text: {
            it: `Alea di controllo: ${label(i)} (${what}). Politica "always stall": il fetch si ferma finche' il nuovo PC e' noto (${stageIt}): ${penalty} stall${penalty === 1 ? 'o' : 'i'} per ogni salto.`,
            en: `Control hazard: ${label(i)} (${whatEn}). "Always stall" policy: fetch waits until the new PC is known (${resolveAt}): ${penalty} stall${penalty === 1 ? '' : 's'} for every branch.`,
          },
        });
      } else if (taken) {
        redirectFetch = redirect;
        // istruzioni sbagliate fetchate lungo PC+4 fino alla risoluzione, poi flush [S-POLICY]
        let wpFetch = idc; // la successiva a PC+4 viene fetchata quando il salto entra in ID
        let wpPrevEx = ex;
        let k = 0;
        while (wpFetch <= resolve) {
          const wIdc = Math.max(wpFetch + 1, wpPrevEx);
          const wEx = wIdc + 1;
          const wc: Record<number, Stage> = {};
          wc[wpFetch] = 'IF';
          for (let c = wpFetch + 1; c < wIdc && c <= resolve; c++) wc[c] = 'stall';
          if (wIdc <= resolve) wc[wIdc] = 'ID';
          for (let c = wIdc + 1; c < wEx && c <= resolve; c++) wc[c] = 'stall';
          if (wEx <= resolve) wc[wEx] = 'EX';
          if (wEx + 1 <= resolve) wc[wEx + 1] = 'MEM';
          wc[resolve + 1] = 'flush';
          k++;
          rows.push({ index: i, pc: (s.pc + 4 * k) >>> 0, text: '(istruzione scartata)', cells: wc, firstCycle: wpFetch, kind: 'discarded' });
          wpFetch = wIdc;
          wpPrevEx = wEx;
        }
        hazards.push({
          kind: 'control',
          consumer: next,
          producer: i,
          stalls: penalty,
          text: {
            it: `Alea di controllo: ${label(i)} (${what}). Politica "predict not taken": il fetch e' proseguito a PC+4, ma il salto e' preso (nuovo PC noto ${stageIt}): ${k} istruzion${k === 1 ? 'e' : 'i'} scartat${k === 1 ? 'a' : 'e'} (flush, diventano NOP, nessuna ha fatto WB) = ${penalty} cicli persi.`,
            en: `Control hazard: ${label(i)} (${whatEn}). "Predict not taken" policy: fetch went on at PC+4 but the branch is taken (new PC known in ${resolveAt}): ${k} instruction${k === 1 ? '' : 's'} flushed (turned into NOPs, none reached WB) = ${penalty} lost cycles.`,
          },
        });
      } else {
        hazards.push({
          kind: 'control',
          consumer: next,
          producer: i,
          stalls: 0,
          text: {
            it: `${label(i)} (${what}): politica "predict not taken" corretta, si prosegue a PC+4 senza stalli.`,
            en: `${label(i)} (${whatEn}): "predict not taken" was right, fetch continues at PC+4 with no stall.`,
          },
        });
      }
    }

    // aggiornamento stato
    const { writes } = regsOf(d);
    if (writes !== null) lastWriter.set(writes, { idx: i, ex, late: isLate(d) });
    prevId = idc;
    prevEx = ex;
  }

  let cycles = 0;
  for (const r of rows) {
    if (r.kind !== 'executed') continue;
    for (const c of Object.keys(r.cells)) cycles = Math.max(cycles, Number(c));
  }
  const n = trace.length;
  return {
    rows,
    cycles,
    instructions: n,
    cpi: n ? cycles / n : 0,
    hazards,
    totalStalls: n ? cycles - idealCycles(n) : 0,
  };
}
