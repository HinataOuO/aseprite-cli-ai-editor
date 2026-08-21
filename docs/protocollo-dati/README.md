# Protocollo dati

## Bridge

JSON UTF-8 versione `1.0`, massimo 1 MiB. Richieste `{version,id,type,payload}`; risposte `{version,id,ok,payload?,error?}`. Pairing iniziale con nonce monouso. Capability: `read_snapshot`, `confirm_mask`, `apply_diff`.

Coordinate canvas-relative, origine in alto a sinistra; rettangoli con estremi destro/inferiore esclusi. Documenti: `width` e `height` interi `1–128`, area massima 16384.

## Snapshot e autorizzazione

Lo snapshot contiene sprite, dimensioni, modalità, frame, tutti gli image layer del frame attivo, palette, trasparenza, `documentEmpty`, `usedRgba`, selezione e crop row-major. `usedRgba` è l’insieme ordinato dei colori non trasparenti usati in tutti layer/frame, inclusi nascosti. Il token SHA-256 lega lo stato autorizzante. Prima della scrittura viene riletto uno snapshot metadata-only e ogni differenza produce `stale_snapshot`; una sostituzione palette ricontrolla compatibilità dentro la transazione.

La maschera `{bounds,bits}` usa base64 row-major, bit meno significativo per primo. Deve avere lunghezza e padding esatti. Solo i bit `1` autorizzano modifiche.

Palette: `[{index,rgba}]`, indici unici e RGBA `0xRRGGBBAA`. Candidate e diff usano indici palette o `-1` per trasparenza.

## Candidate e diff

Il protocollo bridge conserva internamente `read_snapshot`, `confirm_mask` e `apply_diff`; questi metodi non sono esposti nella discovery MCP. Il livello MCP prepara Candidate da PNG locale o OpenAI Image API, mentre solo `commit_edit` inoltra un diff validato al bridge.

`Candidate` e `PixelDiff` possono includere `palette`. Essa partecipa al Candidate hash, è sequenziale, riserva indice `0` a RGBA trasparente e contiene massimo 256 entry. `PixelDiff` conserva `changes: [{x,y,paletteRef}]` e `spans: [{x,y,length,paletteRef}]`; massimo 16384 pixel espansi. Ogni pixel deve restare nel canvas e nella maschera. `createLayer` crea atomicamente un nuovo layer; palette proposta, transparent index e layer condividono la stessa transazione.

`commit_edit` accetta un ID casuale monouso, rivalida lo snapshot e applica il diff in una singola transazione.

## Formato canonico sprite v1

Il file scambiato con la pipeline Python è distinto dal protocollo bridge ma resta l’unica sorgente per l’import statico:

```json
{"version":1,"width":72,"height":48,"palette":["#00000000"],"pixels":[[0]],"metadata":{}}
```

`pixels[y][x]` contiene indici della palette. Un file rappresenta un solo sprite statico e un solo frame.
