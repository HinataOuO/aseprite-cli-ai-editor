# Plugin Lua MVP

Estensione Aseprite `>=1.3.0` in `plugin/`.

## Capability

- `read_snapshot`: legge sprite `16/32/64`, Indexed/RGB, frame corrente, layer attivo editabile, cel/image ID/version, palette singola, trasparenza, selezione bitmask e crop minimo in riferimenti palette.
- `confirm_mask`: mostra la proposta come selezione Aseprite; l'utente può correggerla prima di restituire la maschera finale.
- `apply_diff`: rivalida snapshot e destinazione, poi applica riferimenti palette/trasparenza.

Grayscale, tilemap, reference layer, group, layer bloccati, palette multiple e dimensioni diverse producono `unsupported_document`.

## Coordinate e stato

Le coordinate esposte sono canvas-relative. Lettura e scrittura traducono `cel.position`, fanno clipping e trattano l'assenza del cel come trasparenza. `Sprite.id`, `Layer.uuid`, frame number, `Image.id/version` e hash SHA-256 formano la precondizione di concorrenza.

## Transazione e undo

L'immagine del cel viene clonata prima dei pixel, rompendo correttamente eventuali linked cel. Se serve spazio, il clone viene espanso al canvas. Creazione cel, assegnazione immagine e pixel sono in una sola `app.transaction`; un errore genera rollback. `app.refresh()` viene chiamato solo dopo commit e una sola operazione Undo ripristina tutto.

## Connessione

Il plugin è client WebSocket verso `ws://127.0.0.1:<porta>`, senza deflate. Il pannello modeless **AI Editor**, aperto all'avvio e riapribile da **File → Scripts → Show AI Editor Status**, mostra un pallino rosso finché il pairing non è confermato e verde solo dopo la risposta positiva del server. Chiusura, rifiuto, riconnessione e arresto del plugin ripristinano il rosso.

Apri **File → Scripts → Connect CLI AI Editor**, inserisci porta e nonce monouso generati dal server e premi **Connect**. Un nonce errato lascia il pannello rosso. Nessun Lua arbitrario viene ricevuto o eseguito.
