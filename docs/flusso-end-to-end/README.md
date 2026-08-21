# Flussi end-to-end

## Generazione di uno sprite statico

```text
image_gen → PNG → pixel-art-pipeline/scripts/generate.py → sprite.json → import Aseprite
```

1. `image_gen` produce un PNG statico reale.
2. `generate.py --size 16|32|64|128` imposta il lato massimo, conserva le proporzioni, campiona senza antialias e rimuove lo sfondo opaco connesso al bordo. PNG già trasparenti restano intatti.
3. `generate.py` limita la palette e scrive il formato canonico v1 (`width`, `height`, `palette`, `pixels`, `metadata`) più `sprite.png` e `preview.png`.
4. `plugin/import-sprite-json.lua` valida tutto il JSON prima di creare un documento.
5. L’import produce un documento Indexed, un frame e un cel. In GUI resta non salvato; headless salva `.aseprite` solo con `output`.

L'euristica di sfondo usa colore dominante e flood-fill dal bordo: non sostituisce una segmentazione e non distingue in modo affidabile soggetto e sfondo quasi identici.

Nessuna animazione o secondo formato JSON Aseprite.

## Modifica autorizzata via MCP

1. Il plugin effettua pairing col bridge loopback tramite nonce monouso.
2. `prepare_image_import` legge un PNG sotto `AI_EDITOR_IMAGE_INPUT_DIR`, oppure `prepare_prompt_generation` ottiene un PNG dalla OpenAI Image API.
3. Il tool valida snapshot e PNG, esegue il fixer locale, forza trasparenza fuori maschera e costruisce Candidate e PixelDiff per un nuovo layer. `contain` conserva proporzioni e centra con padding; `cover` ritaglia al centro.
4. Con `paletteMode:"auto"` estrae una palette adattiva e la usa se contiene esattamente tutti i colori RGBA già presenti; altrimenti rimappa sulla palette corrente. `current` forza quella esistente, `extract` forza quella sorgente o fallisce. Indice `0` resta riservato alla trasparenza.
5. L’utente deve confermare la preview.
6. Solo dopo la preview, `commit_edit` rivalida snapshot e compatibilità palette; il plugin rimappa gli indici esistenti per RGBA e applica palette, transparent index e nuovo layer in una sola `app.transaction` verificata.

File/provider non valido, timeout, snapshot stale, scadenza o rifiuto utente lasciano il documento invariato.
