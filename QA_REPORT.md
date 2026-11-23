# Report QA — DLX ammodomio — 2026-11-23

## Sintesi
Il nucleo del simulatore è solido. Lo confermano decine di migliaia di casi casuali:
- encode/decode/assemble tornano allo stesso risultato (67.200 casi);
- lo step indietro ripristina esattamente lo stato (600 programmi, circa 13.200 passi);
- la pipeline rispetta sempre le invarianti (14.400 configurazioni).

Non ci sono falle di sicurezza sfruttabili da remoto: niente XSS, eval o segreti nel repository.

I problemi veri sono di **robustezza all'avvio**, **assembler troppo permissivo** e **esercizi che accettano soluzioni sbagliate**.

Finding confermati o plausibili: **7 alti, 26 medi, 22 bassi**. Nessuno critico. Scartati 2 (dettagli in fondo).

I 3 più importanti:
1. Certi input mandano in crash l'avvio e la pagina resta **bianca a ogni ricarica**, finché non si cancella il localStorage. Succede con un file con fine riga CR oppure con dati salvati corrotti.
2. Un link condiviso con `.space` enorme **congela la scheda** per 10 secondi o più.
3. Quattro esercizi (due d'esame) segnano come **risolte** soluzioni sbagliate.
4. Riaprire o ricaricare una pagina aperta da un link condiviso **cancella le modifiche** dell'utente.

## Flotta usata
| Ruolo | Modello | Area | Finding tenuti |
|---|---|---|---|
| Ricognizione | haiku | tutto il progetto | — |
| Revisore logica assembler/ISA | sonnet | `src/core/isa`, `src/core/asm` | 9 |
| Revisore logica CPU/bus/macchina | sonnet | `src/core/cpu`, `bus`, `machine.ts` | 5 |
| Revisore pipeline e contenuti | sonnet | `src/core/pipeline`, `src/content` | 10 |
| Revisore logica UI | sonnet | `src/ui` (store, editor, pannelli) | 12 |
| Sicurezza | sonnet | superficie d'attacco, workflow, git | 2 |
| Fuzzer / property test | sonnet | assembler, encode, Machine, pipeline | 5 |
| UI end-to-end nel browser | sonnet | app su localhost | 7 |
| Accessibilità e i18n | haiku | `src/ui`, `src/content`, CSS | 6 |
| Dipendenze e igiene repo | haiku | npm, git, CI | 7 |

Le verifiche personali del coordinatore (Opus) sono indicate con ✅. I duplicati tra agenti sono stati uniti.

Legenda: ✅ confermato (riprodotto) · 🟡 plausibile (dimostrato da un agente con script o lettura del codice, non rieseguito dal coordinatore).

---

## Finding

### [ALTA] Un sorgente con CR isolato o U+2028/U+2029 manda in crash l'assembler, e l'app resta bianca a ogni ricarica   ✅
- **Dove:** `src/core/asm/assembler.ts:354` (split con `/\r?\n/`) e `:402-403` (`match(...)!`); `src/ui/store.ts:136-137` (assemblaggio dentro `create()`).
- **Problema:** le righe vengono divise solo su `\n`, quindi un `\r` isolato resta dentro la riga. La regex `.` non lo matcha e `mm[1]` lancia un `TypeError`. Il programma viene salvato in localStorage prima di assemblarlo, quindi alla ricarica lo store va in crash durante la creazione: pagina bianca permanente.
- **Riproduzione:**
  - `assemble('ADD R1,R2,R3\rADD R1,R2,R3')` dà "Cannot read properties of null (reading '1')". Stesso risultato con `\u2028`.
  - Nello store: `loadProgram(<quel sorgente>)` lancia l'eccezione, `dlx.source` contiene il CR e il reload va in crash. Verificato con `vite-node`.
  - Nell'app: "Apri" su un file `.dlx` con fine riga in stile vecchio Mac, oppure un link `#code=` con quel testo.
- **Atteso vs ottenuto:** atteso uno split corretto o una diagnostica. Ottenuto: eccezione non gestita e app inutilizzabile finché non si cancella il localStorage.
- **Fix suggerito:** split con `/\r\n|\r|\n|\u2028|\u2029/`. Aggiungere anche try/catch attorno all'assemblaggio iniziale e un ErrorBoundary React (vedi il finding successivo).

### [ALTA] Dati corrotti in localStorage mandano in crash lo store all'avvio (pagina bianca)   ✅
- **Dove:** `src/ui/store.ts:16-23` (`LS.get` senza validazione), `:133-137`; `src/ui/panels/Learn.tsx:40` (`dlx.doneExercises`).
- **Problema:** `LS.get` si fida del tipo salvato. `dlx.map` vale `{}`, `null` o ha un `kind` sconosciuto, oppure `dlx.source` vale `123` o `null`: in questi casi `create()` lancia un'eccezione. Non c'è un ErrorBoundary, quindi l'app è inutilizzabile. Se `dlx.doneExercises` non è un array, la tab Esercizi smonta tutta l'app.
- **Riproduzione:** con `vite-node` e stub del localStorage:
  - `map={}` → "configs is not iterable";
  - `kind` sconosciuto → "Cannot read properties of undefined (reading 'reset')";
  - `source=123` → "source.split is not a function".
  - Inoltre `speed=0` e `lang="xx"` vengono accettati, con timer a ritardo infinito e lingua inesistente.
- **Atteso vs ottenuto:** atteso un ritorno ai valori di default con rimozione della chiave. Ottenuto: crash.
- **Fix suggerito:** validare ogni chiave (`Array.isArray` più `validateMap` per la mappa, `typeof string` per il sorgente, intervalli per speed/lang/theme), try/catch attorno alla costruzione e ErrorBoundary in `App`.

### [ALTA] `.space` enorme congela la scheda: link condiviso "esplosivo"   ✅
*(uniti: sec-1, asm-2, fuzz-2)*
- **Dove:** `src/core/asm/assembler.ts:501-505` (nessun limite), `:639-642` (un `Map.set` per byte); `src/ui/store.ts:49-62,136-137` (assemblaggio automatico all'apertura del link).
- **Problema:** un byte equivale a una voce in due Map, più `bus.loadImage`. All'apertura di `#code=` l'assemblaggio parte senza azione dell'utente e si ripete a ogni tasto premuto nell'editor. Oltre 2^24 byte V8 lancia "Map maximum size exceeded", che l'utente vede come messaggio tecnico non tradotto.
- **Riproduzione:**
  - `.space 4000000` impiega 1,6 s (misura del coordinatore);
  - `.space 16000000` impiega circa 8,6 s e 1,2 GB;
  - `.space 0x7fffffff` impiega circa 10 s, 1,4 GB e termina con RangeError;
  - link: `#code=LmRhdGEKLnNwYWNlIDB4N2ZmZmZmZmYK`.
- **Atteso vs ottenuto:** atteso un errore immediato del tipo "dimensione troppo grande". Ottenuto: UI bloccata per secondi e GB di RAM; su mobile la scheda va in crash.
- **Fix suggerito:** limitare `.space`/`.ascii`/`.word` (per esempio 1 MiB a direttiva e 4 MiB in totale), non scrivere byte per lo spazio riservato e limitare la lunghezza dell'hash.

### [ALTA] Esercizio "conta-pari" accetta la soluzione che conta i dispari   ✅
- **Dove:** `src/content/exercises.ts:84` (`PARI_DATA`), check a `:261`.
- **Problema:** i dati contengono 6 pari e 6 dispari, quindi scambiare `BNEZ` con `BEQZ` (l'errore più probabile) dà lo stesso risultato.
- **Riproduzione:** `scratchpad/qa/pipe/wrong.test.ts`: "conta-pari conta dispari" risulta ACCEPTED.
- **Fix suggerito:** dati con un numero di pari diverso dai dispari (per esempio 7 e 5).

### [ALTA] Esercizio d'esame 2020-09-01 accetta il conteggio dei caratteri dispari   ✅
- **Dove:** `src/content/exercises.ts:89` (`PARI_CHARS = 'ABCDEFGH'`, 4 pari e 4 dispari).
- **Problema:** con la condizione invertita il contatore arriva comunque a 4 e tutti i controlli passano.
- **Riproduzione:** `wrong.test.ts`: "2020 conta DISPARI" risulta ACCEPTED.
- **Fix suggerito:** una sequenza con pari diversi dai dispari, e controllare anche *quando* scatta l'interrupt.

### [ALTA] "Fino alla fine" congela la UI per secondi (fino a 500.000 passi sincroni, senza Pausa)   🟡
*(uniti: ui-8, cpu-5)*
- **Dove:** `src/ui/store.ts:272-278`; `src/core/machine.ts:101-121,162-181`.
- **Problema:** ogni step:
  - costruisce testi bilingui e micro-fasi;
  - salva lo stato di tutti i device;
  - fa `history.shift()` su un array di 20.000 elementi.

  Con un ciclo senza HALT, un solo click blocca il thread principale. Con INPUT/BUTTON nella mappa il selfloop non viene rilevato.
- **Riproduzione:** `loop: ADDI R1,R1,1 / SW / J loop` → `runToEnd` impiega circa 17,6 s in Node. `m.run(100000)` circa 3 s.
- **Fix suggerito:** esecuzione a blocchi con `setTimeout`/rAF e un pulsante Pausa attivo; history come ring buffer; spiegazioni generate in modo lazy.

### [ALTA] Il link `#code=` resta nell'URL: alla ricarica le modifiche vanno perse e il programma salvato viene sostituito   ✅
*(uniti: ui-5, e2e-1; riprodotto dal vivo nel browser)*
- **Dove:** `src/ui/store.ts:49-62` (`initialSource` legge prima l'hash, che non viene mai rimosso).
- **Riproduzione:** "Copia link", aprirlo in una nuova scheda, modificare il codice, premere F5: ricompare il programma originale del link e le modifiche non si vedono più. Aprire un link sostituisce anche, senza chiedere, il programma che l'utente aveva salvato.
- **Fix suggerito:** `history.replaceState(null, '', location.pathname)` dopo la lettura; chiedere conferma se il programma salvato è diverso da quello del link.

---

### [MEDIA] Gli stalli RAW su due operandi della stessa istruzione si sommano due volte nell'elenco alee   ✅
- **Dove:** `src/core/pipeline/model.ts:258`, `src/ui/panels/Pipeline.tsx:93`.
- **Problema:** con `ADDI R1; ADDI R2; ADD R3,R1,R2` senza forwarding risultano "Stalli totali 2", ma le alee mostrano RAW 1 + RAW 2 = 3.
- **Fix suggerito:** assegnare gli stalli solo all'operando dominante e indicare l'altro come "coperto".

### [MEDIA] JR/JALR con risoluzione in ID non pagano lo stallo sul registro letto in ID   ✅
- **Dove:** `src/core/pipeline/model.ts:242` (`readInId` vale solo per i branch).
- **Riproduzione:** `ADDI R1,R0,8; JR R1` dà RAW 0, mentre l'equivalente con `BEQZ R1` dà RAW 1 (forwarding attivo, `branchResolve: 'ID'`).
- **Fix suggerito:** `readInId = resolveAt==='ID' && (group==='branch' || shape==='jreg')`.

### [MEDIA] Con forwarding attivo l'opzione "Split-cycle RF" non ha effetto   🟡
- **Dove:** `src/core/pipeline/model.ts:249`, `Pipeline.tsx:33`.
- **Problema:** a distanza 3 senza split-cycle servirebbe uno stallo (o un bypass interno spiegato). La checkbox non cambia nulla e può confondere lo studente.
- **Fix suggerito:** modellare il caso `fwd && !split`, oppure disabilitare la checkbox con una spiegazione.

### [MEDIA] Esercizio "eco-maiuscolo" accetta un handler senza il limite 'z'   ✅
- **Dove:** `src/content/exercises.ts:87` (l'input `'Ciao dlx 2024!'` non ha caratteri oltre 'z').
- **Fix suggerito:** aggiungere `'a' 'z' '{' '`' '@' '['` ai dati di prova.

### [MEDIA] Esercizio d'esame 2016-07-07 non verifica il modulo 256 né il confine 127/128   ✅
- **Dove:** `src/content/exercises.ts:90` (`BYTES_2016`).
- **Riproduzione:** "2016 senza mod256" e "2016 <=128" risultano entrambi ACCEPTED.
- **Fix suggerito:** aggiungere i byte 127 e 128 e valori che portano la somma oltre 255.

### [MEDIA] `.space` negativo accettato: il location counter torna indietro   ✅
*(uniti: asm-2, fuzz-3)*
- **Dove:** `assembler.ts:501-505`.
- **Riproduzione:** `.space -4\nNOP` dà ok, con la NOP a 0xFFFFFFFC. `.data\n.space -5\n.word 7` mette la word sotto la RAM.
- **Fix suggerito:** richiedere un intero tra 0 e il limite.

### [MEDIA] `.align` con argomento ≥ 32 mette i dati all'indirizzo 0 (in EPROM) senza avviso   ✅
- **Dove:** `assembler.ts:478-483`.
- **Riproduzione:** `.data\n.align 40\nx: .word 7` dà ok, `x=0` e la word scritta a 0x0. Anche `.align -1` viene accettato.
- **Fix suggerito:** validare `0 ≤ n ≤ 31`.

### [MEDIA] Moltiplicazione nelle espressioni con `Math.imul`: overflow silenzioso   ✅
- **Dove:** `assembler.ts:254`.
- **Riproduzione:** `.word 65536*65536` dà ok e una word a 0, senza errore di range.
- **Fix suggerito:** usare `v * r` e lasciare il controllo del range a chi usa il valore.

### [MEDIA] `.ascii`/`.asciiz` con caratteri non ASCII: troncamento silenzioso ed etichette spostate   ✅
- **Dove:** `assembler.ts:508` (dimensione = lunghezza UTF-16), `:647` (un byte per code point).
- **Riproduzione:**
  - `.asciiz "€"` produce il byte 0xAC;
  - `.asciiz "😀"\nx: .byte 1` dà `x = base+3` con un buco a +2.
- **Fix suggerito:** rifiutare i caratteri oltre 0x7F, oppure codificare in UTF-8 e calcolare la dimensione sui byte.

### [MEDIA] Assembler quadratico nel numero di etichette   🟡
- **Dove:** `assembler.ts:301-305` (`findCaseInsensitive` scorre tutta la Map).
- **Riproduzione:** 10.000 etichette richiedono 1,1 s, 50.000 ne richiedono 32 s. L'assemblaggio parte a ogni tasto premuto.
- **Fix suggerito:** una Map indicizzata in minuscolo.

### [MEDIA] La somma dei clock delle micro-fasi (vista datapath) non coincide con i clock dell'istruzione   🟡
- **Dove:** `src/core/cpu/cpu.ts:169-171, 276-353`.
- **Problema:** `CLOCKS` è corretto rispetto alle slide, ma le micro-fasi mostrate sommano valori diversi:

  | Istruzione | Clock attesi | Somma micro-fasi |
  |---|---|---|
  | load | 8 | 9 |
  | store | 7 | 8 |
  | J | 4 | 6 |
  | JAL | 6 | 7 |
  | branch preso | 5 | 6 |
  | branch non preso | 4 | 5 |

  La fase INTERRUPT dichiara 1 clock che non viene mai contato. Per un simulatore didattico è un'incoerenza visibile.
- **Fix suggerito:** derivare `clocks` dalla somma delle micro-fasi, oppure allineare le fasi alla tabella delle slide.

### [MEDIA] `validateMap` accetta periferiche più piccole dei propri chip-select   🟡
- **Dove:** `src/core/bus/bus.ts:154-176`.
- **Problema:** un LED con size 4 viene accettato, ma `CS_SWITCH`/`CS_WRITE` cadono fuori e a runtime danno "nessun dispositivo mappato". `decodeMap` li elenca comunque. Anche size 0.5 supera il controllo "potenza di 2".
- **Fix suggerito:** `size ≥ max(offset CS) + 4` e `Number.isInteger(size)`.

### [MEDIA] Dopo un caricamento (esempi, tutorial, esercizi, Apri, Nuovo) lo stato torna subito "modificato"   🟡
- **Dove:** `src/ui/editor/Editor.tsx:211-227`, `src/ui/store.ts:309-318`.
- **Problema:** l'eco dell'editor richiama `setSource` con lo stesso testo e imposta `dirty=true`. Compare il chip "modificato", Indietro è disabilitato e il primo Step ricarica.
- **Fix suggerito:** in `setSource` non fare nulla se il testo non cambia, oppure ignorare le transazioni esterne nel listener.

### [MEDIA] I breakpoint sono legati al numero di riga e non seguono l'istruzione quando si modifica il testo   🟡
- **Dove:** `src/ui/store.ts:87,116-123,285-291`.
- **Riproduzione:** breakpoint sulla riga 3, poi una riga aggiunta in cima: il breakpoint ora ferma un'altra istruzione. Su righe senza istruzione il marker compare ma non ha effetto.
- **Fix suggerito:** usare posizioni CodeMirror rimappate, oppure rifiutare il toggle su righe vuote.

### [MEDIA] Gutter degli indirizzi non aggiornato mentre si scrive   🟡
- **Dove:** `src/ui/editor/Editor.tsx:230-248` (dipendenze dell'effetto senza `live`).
- **Problema:** dalla seconda modifica in poi gli indirizzi mostrati restano quelli vecchi fino a Step/Reset.
- **Fix suggerito:** aggiungere `live` alle dipendenze, oppure aggiornare il gutter nel listener.

### [MEDIA] "Apri" sostituisce il programma senza conferma; esempi e tutorial sovrascrivono anche la mappa periferiche personalizzata   🟡
- **Dove:** `src/ui/App.tsx:81-85`; `src/ui/panels/Learn.tsx:164,185`; `store.ts:309-314`.
- **Fix suggerito:** chiedere conferma se il programma è modificato o la mappa non è quella di default; non cambiare la mappa se l'esempio non ne richiede una.

### [MEDIA] Il link condiviso non contiene la mappa delle periferiche   ✅
- **Dove:** `src/ui/store.ts` (`shareLink` codifica solo il sorgente).
- **Problema:** chi apre il link di un programma con una mappa personalizzata (per esempio l'esempio con interrupt e pulsante a 0xD0000000) lo esegue con la propria mappa: accessi a indirizzi senza dispositivo.
- **Fix suggerito:** includere la mappa nell'hash, per esempio `#code=…&map=…`.

### [MEDIA] "Clic sul numero di riga = breakpoint" non funziona: funziona solo il clic sull'indirizzo   ✅
- **Dove:** `src/ui/editor/Editor.tsx` (gestione solo sul gutter degli indirizzi), testo in `src/i18n.ts:56`.
- **Fix suggerito:** gestire anche il gutter dei numeri di riga, oppure cambiare il testo in "Clic sull'indirizzo".

### [MEDIA] Tab nell'editor inserisce rientri; per uscire serve Esc e poi Tab, che non è spiegato, e l'editor non mostra il focus   ✅
- **Dove:** `src/ui/editor/Editor.tsx:210` (`indentWithTab`), CSS dell'editor senza indicatore di focus.
- **Problema:** chi naviga da tastiera, arrivato all'editor, modifica il programma a ogni Tab. CodeMirror permette l'uscita con Esc e poi Tab, ma l'interfaccia non lo dice.
- **Fix suggerito:** suggerimento "Esc poi Tab per uscire" quando l'editor ha il focus, più un contorno di focus visibile.

### [MEDIA] Tab Periferiche: la tabella esce dallo schermo a 375 px   ✅
- **Dove:** `table.devtable` (larga 417 px, `scrollWidth` 438 contro 375).
- **Nota:** il pannello è in fase di riscrittura in un'altra sessione: ricontrollare dopo.
- **Fix suggerito:** contenitore con `overflow-x: auto`, oppure layout a schede sotto i 480 px.

### [MEDIA] Pipeline: la finestra di istruzioni non si azzera dopo Reset o Indietro ("istruzioni 15–3 / 3", tabella vuota)   🟡
- **Dove:** `src/ui/panels/Pipeline.tsx:13,17,62-64`.
- **Fix suggerito:** limitare `start` a `max(0, n-WINDOW)` e azzerare `windowStart` quando la traccia si accorcia.

### [MEDIA] Controlli senza nome accessibile   🟡
- **Dove:**
  - `Devices.tsx:158,189,193,209,238` (select e input);
  - `Reference.tsx:20` (solo placeholder);
  - `Pipeline.tsx:61,63` (pulsanti ◀ ▶).
- **Fix suggerito:** `aria-label` bilingue.

### [MEDIA] Breakpoint impostabili solo con il mouse   ✅
- **Dove:** `src/ui/editor/Editor.tsx:79,197`. Non esiste un comando da tastiera.
- **Fix suggerito:** un comando CodeMirror, per esempio Ctrl+B, che chiama `toggleBreak` sulla riga del cursore, indicato anche nel suggerimento.

### [MEDIA] Contrasto del testo sotto 4,5:1 in diversi punti, in entrambi i temi   🟡
- **Dove:**
  - tema chiaro:
    - `.learn-btn` e `.seg button.on` (circa 4,2:1);
    - `.chip.warn` (circa 4,1:1);
    - indirizzi del gutter `.cm-addr` (circa 3,2:1);
    - testo bianco sui campi di codifica `.enc-f` (circa 3,5:1);
  - tema scuro: `.map-seg` (1,8–2,7:1) e `.logo` (2,5:1);
  - entrambi i temi: registri "garbage" con opacità 0,6 (circa 2,5:1).
- **Fix suggerito:** scurire il testo sulle tinte chiare, usare testo scuro sui colori dei campi e non ridurre l'opacità del testo.

### [MEDIA] Testi inglesi nella UI italiana e aria-label italiani con la UI in inglese   ✅
- **Dove:**
  - testi inglesi nella UI italiana:
    - `Pipeline.tsx:36-37,86` ("Always stall", "Predict not taken", legenda);
    - `DatapathView.tsx:39,200,230` (fasi e testi SVG);
    - `tutorials.ts:482,528` ("compare and branch");
  - aria-label solo in italiano:
    - `Devices.tsx:73,128,203`;
    - `Memory.tsx:100-101`;
    - `Learn.tsx:81`;
    - `DatapathView.tsx:315`.
- **Fix suggerito:** passare questi testi da `tr()` o da oggetti Txt.

### [MEDIA] Dipendenze di sviluppo con advisory (vite, vitest, esbuild, tinypool)   ✅
*(uniti: deps-1, deps-2, sec-2)*
- **Problema:**
  - `npm audit` trova 5 advisory (2 critical, 1 high), tutte in strumenti di sviluppo e test;
  - `npm audit --omit=dev` dà 0 vulnerabilità, quindi **il sito pubblicato non è esposto**;
  - il rischio riguarda solo `npm run dev`/vitest in esecuzione mentre si naviga su siti malevoli.
- **Fix suggerito:**
  - subito vite 5.4.21 e vitest 2.1.9;
  - poi valutare il salto a vite 6+ e vitest 4.x, verificando che i test passino.

---

### [BASSA]
- **Pulsanti "riga N" nel pannello Problemi:** non fanno nulla perché `onGoto` non viene mai passato (`App.tsx:156`, `Problems.tsx:24`). (ui-10 = a11y-2) ✅
- **Memoria, "Vai a":** valori oltre 32 bit vanno in wrap silenzioso (`0x1FFFFFFFF` → `0xFFFFFFFF`) (`Memory.tsx:30-36`). 🟡
- **Editor della mappa periferiche:** un indirizzo non valido viene ignorato da "Applica"; gli errori del preset non sono visibili fuori dalla modalità modifica (`Devices.tsx:111-115,223,235-239`). *Nota: un'altra sessione sta rifacendo questo pannello: rivalutare dopo.* 🟡
- **Nomi e id duplicati o due STARTUP** non vengono rifiutati da `validateMap` (`bus.ts:154-176`, `cpu.ts:120`). 🟡
- **Periferica INPUT:** `CS_RESET_INT` lascia la coda bloccata e i dati arrivano fuori ordine (`devices.ts:204-223`). 🟡
- **Operatori nelle espressioni:**
  - `^` e `|` hanno la stessa precedenza, diversa dal C: `1|2^3` = 0;
  - `1 << -1` dà un risultato non intero (`assembler.ts:267-291`). 🟡
- **Letterali carattere:** `'\r'` vale 0x72 invece di 0x0D (`assembler.ts:161`; le stringhe invece sono corrette). ✅
- **`LW R1,lo(x)` e `LW R1,(x)`:** danno il messaggio fuorviante "x non è un registro valido" (`assembler.ts:673-688`). 🟡
- **`.equ`:** non accetta etichette definite più avanti (`.equ SZ, end-start`) (`assembler.ts:455-464`). Da correggere o documentare. 🟡
- **Location counter oltre 0xFFFFFFFF:** riparte da 0 senza errore; `.org` con numeri enormi viene accettato (`assembler.ts:451-517`). (asm-9 = fuzz-5) 🟡
- **Esercizio "procedura-abs":** accetta |x| calcolato inline con una `JAL` finta (`exercises.ts:~367`). 🟡
- **Esercizi "somma-8-word", "quadrati", "costante-32bit":** accettano il risultato scritto direttamente come costante. ✅ (`wrong.test.ts`)
- **Chip delle alee:** mostra "1 stalli" / "1 stalls" (`Pipeline.tsx:93`). ✅
- **Titolo dell'esempio con interrupt e pulsante:** in italiano dice "accende", in inglese "toggles" (`examples.ts:284`). 🟡
- **Bundle:** il chunk principale pesa 640 kB (210 kB gzip), soprattutto React e CodeMirror. Valutare `import()` dinamico per l'editor. ✅
- **Dipendenza inutilizzata:** `codemirror` è dichiarata in `package.json` ma mai importata. 🟡
- **Dipendenze non aggiornate:** typescript 5.9, zustand 4.5.7 e @types/react sono aggiornabili in minor; le major sono da valutare. ✅
- **Email nei commit:** i commit di un repository pubblico contengono l'email personale. Attivare "Keep my email addresses private" su GitHub. 🟡
- **Licenza:** il repository pubblico non ha un file `LICENSE`. ✅
- **Workflow Pages:** usa `cancel-in-progress: true`; per i deploy GitHub suggerisce `false`. 🟡
- **Direttive senza argomenti:** `.word` senza argomenti viene accettata senza errore. ✅ (browser)
- **Feedback mancante:**
  - "Invia dato" ignora in silenzio un valore non valido e tronca 0x1FF a 8 bit;
  - nell'editor della mappa resta visibile un errore vecchio e i messaggi non hanno `role="alert"`;
  - la ricerca istruzioni senza risultati mostra un pannello vuoto, senza "nessun risultato". 🟡

---

## Prova end-to-end nel browser
Provati dal vivo su localhost:
- Step, Indietro, Run, Fino alla fine e Reset;
- tutti i pannelli;
- errori nell'editor e lista Problemi;
- breakpoint;
- preset delle periferiche e interrupt con pulsante e LED;
- un tutorial completo;
- **tutti i 12 esercizi** (codice iniziale bocciato, soluzione promossa) e **tutti gli 11 esempi** senza errori;
- cambio lingua, tema chiaro e scuro, larghezza 375 px e giro completo con Tab;
- link condiviso con accenti, € e virgolette tipografiche.

**Console del browser: nessun errore né warning di React.** I finding E2E sono integrati sopra.

## Sospetti non confermati
- Pipeline:
  - la finestra di 14 istruzioni ricalcola da zero e perde le dipendenze con l'istruzione precedente alla finestra, quindi gli stalli al bordo non compaiono;
  - `trace` è limitata a 2000 istruzioni: CPI pipeline e numerazione `#` si riferiscono solo alle ultime 2000;
  - JAL/JALR sono trattate come "late" (il link è disponibile solo dopo MEM), cosa che non viene dalle slide.
- Run:
  - F8 durante Run esegue uno step in parallelo al timer;
  - un'eccezione non-SimError dentro `tick()` lascia `running=true`;
  - cambiare velocità durante Run mantiene il vecchio ritardo fino a 1 s.
- Periferiche:
  - LB/LH dalle periferiche ignorano la corsia di byte (dipende da come le slide cablano il bus dati);
  - lo step indietro cancella gli eventi INPUT/BUTTON forniti nel frattempo (probabilmente voluto).
- Assembler:
  - etichette chiamate `R32`…`R99` si possono definire ma non usare;
  - i suggerimenti per parole di 1-2 lettere sono poco utili (`ld` → `LB`);
  - `x: .org 0x100` assegna a `x` il valore che c'era prima di `.org`;
  - `0b1h` viene letto come binario;
  - SLLI con immediato oltre 31 viene codificato `&0xFFFF` (c'è solo un warning).
- Disassembly: il testo disassemblato mostra i target dei salti come indirizzi assoluti; se lo si incolla nell'editor viene riletto come offset.
- Accessibilità:
  - tab senza `tabpanel`, `aria-controls` o navigazione con le frecce;
  - stati "selezionato" solo visivi (manca `aria-pressed`);
  - informazioni mostrate solo nei `title`;
  - legende basate solo sul colore.
- Workflow: le azioni non sono fissate a uno SHA (sono azioni ufficiali GitHub).
- Interfaccia:
  - premendo "Invia dato" la pagina a volte salta in alto, non in modo riproducibile;
  - Step disabilitato quando ci sono errori, senza spiegare perché;
  - "Nuovo" lascia la mappa personalizzata;
  - il suggerimento "manca HALT" compare anche negli esempi con interrupt.

## Scartati (2)
- **a11y-1 "Tab intrappolato nell'editor":** falso positivo. CodeMirror 6 attiva la modalità "tab focus" con Esc (`@codemirror/view`, `tabFocusMode`): Esc seguito da Tab sposta il focus fuori dall'editor. Il problema reale, cioè che la scorciatoia non è indicata e manca un focus visibile, è riportato tra i MEDI.
- **Eccezione dell'assembler sull'escape `'\r'`:** era un errore nello script di verifica del coordinatore (CR vero nel sorgente, già coperto dal primo finding ALTA). L'escape produce solo il valore sbagliato riportato tra le basse.

## Cosa non è stato coperto
- Comportamento reale con screen reader.
- Sito pubblicato su GitHub Pages: per regola non è stato toccato, i test sono stati fatti solo in locale.
- Rendering di memoria o datapath con immagini enormi.
- Interrupt con INPUT/BUTTON/COUNTER nel fuzzing; TRAP n≠0, RFE e MOVI2S con flussi reali; JR/JALR verso bersagli casuali; history oltre 20.000 passi.
- Aderenza del testo dei tutorial alle slide originali, confrontata solo con la semantica implementata.
- Il pannello Periferiche è in fase di riscrittura in un'altra sessione: i relativi finding vanno ricontrollati dopo.

## Comandi eseguiti e risultati
| Comando | Risultato |
|---|---|
| `npx tsc --noEmit` | ✅ nessun errore |
| `npx vitest run` | ✅ 9 file, 522 test passati |
| `npm run build` | ✅ ok, warning per il chunk da 640 kB |
| `npm audit` | ⚠️ 5 advisory (2 critical, 1 high, 2 moderate), tutte in dipendenze di sviluppo |
| `npm audit --omit=dev` | ✅ 0 vulnerabilità |
| `npm ls` | ✅ lockfile coerente |
| lint | — nessuno script di lint configurato |

Script e test di prova degli agenti, fuori dal progetto:
- `C:\Users\feder\AppData\Local\Temp\claude\eb097807d5b899ed\bfda7e04-4499-4d9e-8266-70eae27b115d\scratchpad\qa\`;
- verifiche del coordinatore: `C:\Users\feder\AppData\Local\Temp\claude\eb097807d5b899ed\19b13bf8-2a72-4de5-a878-d766263b0ccb\scratchpad\v\`.

## Stato delle correzioni (aggiornato 2026-11-23)
I **7 finding ALTI sono corretti**. Le regressioni sono coperte da `tests/qa-high.test.ts` (16 test) e verificate nel browser.

| Finding | Correzione |
|---|---|
| CR isolato o U+2028/U+2029 mandano in crash l'assembler | Lo split delle righe ora accetta tutte le forme di fine riga (`assembler.ts`). |
| localStorage corrotto: pagina bianca | Ogni chiave viene validata: forma della mappa più `validateMap`, tipi di sorgente, velocità, lingua e tema. Se il caricamento iniziale fallisce si riparte dal programma di benvenuto. In più c'è un `ErrorBoundary` (`src/ui/ErrorBoundary.tsx`) con "Ricarica" e "Riparti da zero". |
| `.space` enorme | Errore immediato oltre 256 KiB (`MAX_SPACE`). Sono errori anche `.space` negativo o non intero e `.align` fuori da 0..16. L'hash `#code=` ha un limite di 64 KB. |
| Link `#code=` che sostituisce il lavoro | L'hash viene tolto dall'URL dopo la lettura e viene chiesta conferma se c'era già un programma diverso. |
| conta-pari | Nuovi dati: 7 pari e 5 dispari. |
| Esame 2020-09-01 | Nuovi caratteri di prova `ABCDFH` (4 pari, 2 dispari). |
| "Fino alla fine" blocca la UI | Esecuzione a blocchi da 2000 istruzioni con `setTimeout`; il pulsante Pausa funziona. Nel browser il blocco massimo del thread è di circa 0,1 s, contro i circa 17 s di prima. |

I finding MEDI e BASSI restano aperti.
