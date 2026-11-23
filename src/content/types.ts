import type { DeviceConfig } from '../core/bus/devices';
import type { Machine } from '../core/machine';
import type { Txt } from '../core/util';

/** Programma di esempio caricabile nell'editor. */
export interface Example {
  id: string;
  title: Txt;
  description: Txt;
  code: string;
  /** mappa di memoria necessaria (se assente: DEFAULT_MAP) */
  map?: DeviceConfig[];
}

export interface TutorialStep {
  title: Txt;
  /** markdown-lite: paragrafi separati da riga vuota, **grassetto**, `codice`, elenchi con "- " */
  body: Txt;
  /** codice opzionale da caricare nell'editor */
  code?: string;
  /** mappa opzionale da attivare insieme al codice */
  map?: DeviceConfig[];
  /** cosa fare nel simulatore, es. "Premi Step 3 volte e guarda R1" */
  tryIt?: Txt;
}

export interface Tutorial {
  id: string;
  title: Txt;
  summary: Txt;
  steps: TutorialStep[];
}

export interface CheckResult {
  ok: boolean;
  text: Txt;
}

export interface Exercise {
  id: string;
  title: Txt;
  difficulty: 1 | 2 | 3;
  statement: Txt;
  /** codice iniziale (scheletro) caricato nell'editor */
  starter: string;
  hints: Txt[];
  /** soluzione di riferimento (mostrata solo su richiesta) */
  solution: string;
  map?: DeviceConfig[];
  /** limite di passi per l'esecuzione (utile per i programmi che finiscono con un ciclo infinito + interrupt) */
  maxSteps?: number;
  /**
   * Stimoli esterni (dato sulla porta di input, pressione di un pulsante...).
   * Va chiamata DOPO load()/reset(): il RESET azzera lo stato delle periferiche.
   */
  setup?: (m: Machine) => void;
  /** verifica a fine esecuzione: una riga di esito per ogni requisito */
  check: (m: Machine) => CheckResult[];
}
