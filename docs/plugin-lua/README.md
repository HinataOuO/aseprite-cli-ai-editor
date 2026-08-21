# Plugin Lua

Estensione Aseprite `>=1.3.0` in `plugin/`.

## Import JSON statico

**Import Pixel Pipeline JSON** apre un singolo `sprite.json` canonico v1 e lascia il documento non salvato. Headless:

```sh
aseprite -b --script-param input=/path/sprite.json \
  --script-param output=/path/sprite.aseprite \
  --script plugin/import-sprite-json.lua
```

`output` è opzionale e deve terminare in `.aseprite`. Prima di creare il documento vengono validati versione, dimensioni `1–128`, area `≤16384`, palette `#RRGGBBAA` di 1–256 colori, metadata, righe rettangolari e indici. Il risultato è Indexed, con un frame e un cel. Nessuna animazione.

## Bridge MCP

- `read_snapshot`: legge documenti rettangolari `1–128` per lato e area `≤16384`, Indexed/RGB, image layer, palette singola, selezione, crop e stato trasparente dell’intero documento.
- `confirm_mask`: presenta la selezione da correggere.
- `apply_diff`: rivalida snapshot e applica `changes`/`spans`, massimo 16384 pixel; sostituisce palette compatibili rimappando i cel indicizzati per RGBA nella stessa transazione Undo-safe.

Grayscale, tilemap, reference layer, group, layer bloccati, palette multiple e dimensioni fuori limite producono `unsupported_document`.

Le coordinate sono canvas-relative. Lettura e scrittura traducono `cel.position`; un cel assente è trasparente. Un diff con palette è accettato quando ogni RGBA già usato compare nella palette proposta; gli indici esistenti vengono rimappati per colore, mentre i cel RGB restano invariati. Palette sequenziale, indice trasparente `0` e nuovo layer conservano Indexed/RGB. Tutto avviene in una sola `app.transaction`; ogni errore esegue rollback e un singolo Undo ripristina palette, cel e layer.

Il pannello **AI Editor** connette il WebSocket soltanto a `127.0.0.1`, richiede porta e nonce, mostra stato e attività, e non esegue Lua ricevuto dalla rete. Quando la CLI MCP termina, l’evento WebSocket `CLOSE` riporta il pannello a **Disconnected**, azzera l’attività e rende nuovamente disponibile **Connect** per il pairing con il nuovo nonce.
