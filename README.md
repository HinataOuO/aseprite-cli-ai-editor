# Aseprite CLI AI Editor

Pipeline per sprite statici e bridge MCP per modifiche pixel autorizzate. Aseprite resta l’autorità: palette, selezione, snapshot e transazione Undo vengono validati localmente.

## Requisiti

- Node.js 20+
- Python 3.11+
- Aseprite 1.3+

```sh
npm install
npm run verify
cd pixel-art-pipeline && PYTHONPATH=src python -m unittest discover -s tests -v
```

## Generazione statica supportata

Un file `sprite.json` canonico v1 rappresenta un solo sprite statico e viene importato come documento Indexed con un frame:

```text
image_gen → PNG → pixel-art-pipeline/scripts/generate.py → sprite.json → import Aseprite
```

```sh
PYTHONPATH=pixel-art-pipeline/src python pixel-art-pipeline/scripts/generate.py \
  --input generated.png --output out --size 64 --max-colors 256

aseprite -b \
  --script-param input="$PWD/out/sprite.json" \
  --script-param output="$PWD/out/sprite.aseprite" \
  --script plugin/import-sprite-json.lua
```

`--size` è obbligatorio (`16`, `32`, `64` o `128`): definisce il lato massimo e conserva le proporzioni. La pipeline accetta solo PNG statici reali, usa nearest-neighbor in ingrandimento e rimuove automaticamente soltanto lo sfondo opaco compatibile con il bordo e connesso ad esso. PNG già trasparenti restano intatti.

In GUI: **File → Scripts → Import Pixel Pipeline JSON**. Senza `output` il documento resta aperto e non salvato. Limiti import: versione 1, dimensioni `1–128`, area massima 16384 pixel, palette RGBA massima 256 colori, nessuna animazione.

## Modifica del documento via MCP

Installa `plugin/` come estensione Aseprite. Il server espone cinque operazioni:

```text
inspect_aseprite_selection
PNG locale ───────────────→ prepare_image_import ────────→ preview → approvazione → commit_edit
prompt ─→ OpenAI Image API → prepare_prompt_generation ─→ preview → approvazione → commit_edit
connessione ──────────────→ get_connection_info
```

Usare `$connection` per ottenere host, porta, nonce e stato senza richiedere un plugin già associato. In Aseprite aprire **File → Scripts → Connect CLI AI Editor** e inserire porta e nonce. Stati: `awaiting_pairing` indica nonce utilizzabile, `connected` plugin associato, `disconnected` nonce già consumato; in quest’ultimo caso riavviare il server MCP.

Selezionare prima l’area in Aseprite. I tool `prepare_*` non cambiano il documento: applicano `contain` (default) o `cover`, campionamento centrale, rimozione dello sfondo collegato al bordo e palette adattiva, poi restituiscono PNG preview, `candidateId`, bounds, conteggio pixel, hash e scadenza. `paletteMode:"auto"` è il default: sostituisce la palette su documenti vuoti o compatibili, altrimenti usa quella corrente. `current` forza la palette esistente; `extract` forza quella sorgente e rifiuta documenti incompatibili. `maxColors` è opzionale (`1–256`, trasparenza inclusa); default: 4 a 16px, 8 a 32/64px, 16 a 128px. Solo `commit_edit`, dopo approvazione esplicita, crea il layer e applica l’eventuale palette in una transazione Undo-safe.

Import locale: `AI_EDITOR_IMAGE_INPUT_DIR` limita i path consentiti; default directory di avvio. Sono ammessi solo file `.png` regolari, non symlink, entro 8 MiB e `2048×2048`.

Generazione: impostare `OPENAI_API_KEY`; `OPENAI_IMAGE_MODEL` è opzionale e vale `gpt-image-2` per default. La chiave non viene registrata nei log.

Esempi: “Importa `/workspace/hero.png` nella selezione.”; “Genera uno slime verde 32×32 nella selezione.”; oppure `prepare_prompt_generation({prompt:"slime verde",paletteMode:"extract",maxColors:8})`. In tutti i casi mostrare la preview, chiedere conferma, poi usare `commit_edit`.

Il bridge usa WebSocket solo su `127.0.0.1`, pairing con nonce monouso e payload massimo 1 MiB. I diff applicabili restano `changes`/`spans`, fino a 16384 pixel, dentro la selezione e in una singola transazione Undo. Se il client MCP lascia attivo il processo di una chat precedente, impostare `AI_EDITOR_PORT=0` nella sua configurazione e usare nel plugin porta e nonce stampati su stderr; una nuova chat da sola non garantisce EOF o segnali al processo precedente.

## Limiti documento MCP

- dimensioni rettangolari `1–128` per lato, area massima 16384 pixel, incluso `72×48`;
- Indexed/RGB, palette singola, frame corrente e image layer editabile;
- niente grayscale, tilemap, reference layer, palette multiple o animazioni generate;
- destinazione sempre nuovo layer; `commit_edit` richiede conferma e rivalida snapshot, hash e TTL.

## Test

```sh
npm run build
npm test
npm run test:aseprite
```

La suite Lua include import/salvataggio/riapertura di output rettangolari `72×48` e proporzionali `64×32`, palette con alpha, coordinate esatte e assenza di documenti residui su JSON invalido.

Documentazione: [pipeline](pixel-art-pipeline/README.md), [plugin](docs/plugin-lua/README.md), [server MCP](docs/server-mcp/README.md), [protocollo](docs/protocollo-dati/README.md).
