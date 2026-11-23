# DLX ammodomio

Simulatore didattico del processore **DLX**, pensato per il corso di *Calcolatori Elettronici T* (UniBo).
Interfaccia in italiano e inglese, funziona interamente nel browser.

**Provalo online:** https://federicogiraldi.github.io/dlx-ammodomio/

## Cosa fa
- **Assembler** con errori e suggerimenti in tempo reale (`0x800`, `800h`, decimali, negativi, etichette, direttive `.data`/`.word`/…).
- **Esecuzione** passo-passo avanti e indietro, Run con velocità regolabile, breakpoint.
- **"Cosa è successo"**: spiegazione di ogni istruzione con i valori reali e la codifica binaria a colori.
- **Registri, memoria, periferiche** (LED, STARTUP, input, output, contatore, pulsante) con editor della mappa e decodifica dei chip-select.
- **Interrupt** come nelle slide (IAR, RFE, IEN).
- **Datapath** sequenziale animato e **pipeline** a 5 stadi con alee, stalli e forwarding.
- **Impara**: tutorial, esercizi con verifica automatica (anche da prove d'esame) ed esempi.

## Sviluppo
```bash
npm install
npm run dev     # http://localhost:5173
npm test        # test del core
npm run build   # build in dist/
```

Stack: Vite, React, TypeScript, CodeMirror 6, Zustand, Vitest.
