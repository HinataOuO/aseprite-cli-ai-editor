# Flusso end-to-end MVP

1. Il server MCP apre un WebSocket su `127.0.0.1` e mostra su stderr un nonce monouso.
2. Il comando del plugin connette Aseprite e invia nonce, versione e capability. Nonce errati/replay chiudono la connessione.
3. `read_snapshot` legge solo frame/layer attivi, palette, selezione e crop minimo. Lo snapshot SHA-256 lega sprite, frame, layer UUID, image ID/version, palette, trasparenza, maschera e pixel.
4. La selezione presente diventa l'unica maschera. Senza selezione, Vision propone una maschera: `<70` richiede una nuova proposta; `70–90` conferma/correzione; `>90` può evitare conferma solo dopo 30 campioni e approvazione modello/versione. Nel bootstrap la conferma è sempre obbligatoria.
5. Il server costruisce una specifica immutabile. Più layer richiedono UUID espliciti e confermati.
6. Il server analizza una volta il crop corrente e risolve un `ArtDirectionProfile`: vincoli tecnici → intento esplicito → stile osservato → default di risoluzione. Il profilo assegna outline, shadow, base e highlight a indici palette reali.
7. Il compilatore produce un art brief positivo/negativo e uno schema `Candidate` esatto. Al provider vanno brief, profilo, crop PNG, maschera, palette e intento; non viene richiesto né accettato Lua o raster generato.
8. Il server valida token, dimensioni, palette/trasparenza, maschera, frame e layer, poi controlla criteri artistici deterministici (numero colori, densità e spessore outline) e produce il diff minimo. I retry mantengono identici profilo, schema e autorizzazioni e aggiungono soltanto errori e diff precedente; massimo tre.
9. Lo score semantico resta osservativo e versionato. Fino all'approvazione della calibrazione richiede sempre conferma; dopo: `<50` retry, `50–70` conferma, `>70` applicazione.
10. Immediatamente prima della scrittura il plugin rivalida lo snapshot, clona l'immagine, applica il `PixelDiff` e assegna `cel.image` in una sola `app.transaction`. Ogni errore fa rollback; la UI si aggiorna solo dopo commit.

## Punti di arresto

`unsupported_document`, pairing fallito, provider indisponibile, token scaduto, output non valido, rifiuto utente o terzo tentativo lasciano il documento invariato. Una modifica concorrente durante Vision produce `stale_snapshot` e richiede una nuova lettura.
