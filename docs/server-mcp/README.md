# Server MCP MVP

Node.js 20+/TypeScript strict. MCP usa stdio; stdout è riservato ai frame MCP e ogni log va a stderr.

## Strumenti

- `read_snapshot({includeCrop})`: stato minimo autorizzato del documento.
- `confirm_mask({snapshotToken,mask})`: presenta/corregge la selezione in Aseprite.
- `apply_diff({diff})`: inoltra al plugin un diff già validato per applicazione atomica.

## Bridge

`BridgeServer` ascolta solo `127.0.0.1`, una connessione alla volta. Pairing nonce monouso, ID di correlazione, timeout 10 s e limite 1 MiB. Errori/disconnessioni rifiutano tutte le richieste pendenti. Capability richieste: `read_snapshot`, `confirm_mask`, `apply_diff`.

Lifecycle: avvio bridge → stampa porta/nonce su stderr → connessione MCP stdio → pairing plugin → richieste correlate → chiusura/disconnessione.

## Pipeline ed errori

La pipeline congela intento, token, frame, UUID layer e maschera; converte il crop palette-indexed in PNG, chiama il provider e tratta la risposta come non fidata. Valida palette, sentinella trasparente, bounds, bitmask e token, calcola il diff minimo e limita i tentativi a tre. I retry non reinviano il documento.

Gli errori seguono il [protocollo](../protocollo-dati/README.md): pairing/versione/payload, documento non supportato, snapshot scaduto, modifica non autorizzata, provider, validazione, conferma, tentativi e applicazione.

## Persistenza

`LocalStore` salva JSONL e cache content-addressed con rename atomico e permessi `0600`; chiavi includono contenuto, richiesta, autorizzazioni, provider, modello e versione. Retention e cancellazione sono locali. Campi riconducibili a immagini complete o credenziali sono rifiutati.
