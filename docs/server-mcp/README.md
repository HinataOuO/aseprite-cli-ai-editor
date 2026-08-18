# Server MCP MVP

Node.js 20+/TypeScript strict. MCP usa stdio; stdout è riservato ai frame MCP e ogni log va a stderr.

## Strumenti

Flusso normale:

- `prepare_edit({intent,mode})`: genera e valida il Candidate, conserva diff/token per cinque minuti e restituisce anteprima PNG e ID monouso. `mode` è `edit_current` o `generate_new_layer`.
- `commit_edit({candidateId})`: dopo conferma utente, rivalida uno snapshot metadata-only e applica esattamente il Candidate preparato.

Diagnostica:

- `read_snapshot({includeCrop})`: stato minimo autorizzato; con `false` omette i pixel ma conserva il token completo.
- `confirm_mask({snapshotToken,mask})`: presenta/corregge la selezione in Aseprite.
- `apply_diff({diff})`: inoltra al plugin un diff già validato per applicazione atomica. Lo schema conserva `changes` e preferisce `spans: [{x,y,length,paletteRef}]` per forme e grandi aree; limite combinato 4096 pixel espansi.

## Bridge

`BridgeServer` ascolta solo `127.0.0.1`, una connessione alla volta. Pairing nonce monouso, ID di correlazione, timeout 10 s e limite 1 MiB. Errori/disconnessioni rifiutano tutte le richieste pendenti. Capability richieste: `read_snapshot`, `confirm_mask`, `apply_diff`.

Lifecycle: avvio bridge → stampa porta/nonce su stderr → connessione MCP stdio → pairing plugin → richieste correlate → chiusura/disconnessione.

## Pipeline ed errori

La pipeline congela intento, token, frame, UUID layer e maschera; converte il crop palette-indexed in PNG, chiama il provider e tratta la risposta come non fidata. Anteprima e diff derivano dallo stesso array row-major e condividono un hash content-addressed. Valida palette, sentinella trasparente, bounds, bitmask e token, calcola il diff minimo e limita i tentativi a tre. I retry non reinviano il documento e condividono un budget di generazione di 110 secondi; lo stesso `AbortSignal` raggiunge `fetch`, che viene annullato al timeout.

Gli errori seguono il [protocollo](../protocollo-dati/README.md): pairing/versione/payload, documento non supportato, snapshot scaduto, modifica non autorizzata, provider, validazione, conferma, tentativi e applicazione. Il timeout produce un errore `timeout` chiaro e il pannello torna sempre a `Idle`. Log stderr contengono solo fase, durata monotona e byte; mai prompt, immagini o credenziali. Le metriche registrano provider, commit e durata totale di elaborazione (prepare + commit), escludendo l'attesa umana della conferma, per verificare il vincolo di due minuti.

## Persistenza

`LocalStore` salva JSONL e cache content-addressed con rename atomico e permessi `0600`; chiavi includono contenuto, richiesta, autorizzazioni, provider, modello e versione. Retention e cancellazione sono locali. Campi riconducibili a immagini complete o credenziali sono rifiutati.
