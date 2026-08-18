# Plugin Lua MVP

Estensione Aseprite `>=1.3.0` in `plugin/`.

## Capability

- `read_snapshot`: legge sprite `16/32/64`, Indexed/RGB, frame corrente, layer attivo editabile, cel/image ID/version, palette singola, trasparenza, selezione bitmask e crop minimo in riferimenti palette.
- `confirm_mask`: mostra la proposta come selezione Aseprite; l'utente può correggerla prima di restituire la maschera finale.
- `apply_diff`: rivalida snapshot e destinazione, poi applica riferimenti palette/trasparenza da `changes` puntuali e/o `spans` orizzontali; massimo 4096 pixel dopo l'espansione.

Grayscale, tilemap, reference layer, group, layer bloccati, palette multiple e dimensioni diverse producono `unsupported_document`.

## Coordinate e stato

Le coordinate esposte sono canvas-relative. Lettura e scrittura traducono `cel.position`, fanno clipping e trattano l'assenza del cel come trasparenza. `Sprite.id`, `Layer.uuid`, frame number, `Image.id/version` e hash SHA-256 formano la precondizione di concorrenza.

## Transazione e undo

Gli span vengono validati ed espansi una sola volta prima della scrittura; anche autorizzazione e colori palette vengono precalcolati. L'immagine del cel viene clonata prima dei pixel, rompendo correttamente eventuali linked cel. Se serve spazio, il clone viene espanso al canvas. Creazione cel, assegnazione immagine, pixel e verifica finale sono in una sola `app.transaction`; un errore genera rollback. `app.refresh()` viene chiamato solo dopo commit e una sola operazione Undo ripristina tutto.

## Connessione

Il plugin è client WebSocket verso `ws://127.0.0.1:<porta>`, senza deflate. Il pannello modeless unico **AI Editor**, aperto all'avvio e riapribile da **File → Scripts → Connect CLI AI Editor** o **Show AI Editor Status**, contiene porta, nonce e pulsante **Connect**. Pallino e testo accessibile mostrano `Disconnected` finché il pairing non è confermato e `Connected` solo dopo la risposta positiva del server. Dopo il pairing quei controlli vengono nascosti e compare solo **Disconnect**; premendolo il plugin azzera e chiude il proprio WebSocket, senza terminare il processo Node/MCP, quindi ripristina i controlli di connessione senza mostrare un falso errore. La porta intera `1–65535` viene ricordata; il nonce deve essere non vuoto, non viene salvato ed è svuotato dopo l'uso. Errori di validazione, connessione o pairing appaiono nel pannello.

L'attività è `Unavailable` quando il plugin è disconnesso, `Ready` quando è connesso e in attesa, e `Processing...` durante ogni comando MCP, inclusa l'attesa del provider AI. Al termine o in caso di errore torna a `Ready`; **Disconnect**, disconnessione remota e arresto del plugin forzano `Disconnected` e `Unavailable`. Un nonce errato non associa il plugin. Nessun Lua arbitrario viene ricevuto o eseguito.
