# Server MCP

Node.js/TypeScript strict; MCP su stdio, log soltanto su stderr.

## Strumenti pubblici

Discovery espone esattamente cinque tool:

- `get_connection_info({})`: restituisce host, porta effettiva, nonce e stato locale senza contattare il plugin.
- `inspect_aseprite_selection({includeCrop?})`: legge dimensioni, selezione, layer, frame, palette e crop opzionale.
- `prepare_image_import({imagePath,fit?,intent?,paletteMode?,maxColors?})`: importa PNG locale; `fit` default `contain`.
- `prepare_prompt_generation({prompt,fit?,paletteMode?,maxColors?})`: genera un PNG tramite OpenAI Image API; `fit` default `contain`.
- `commit_edit({candidateId})`: solo dopo conferma, rivalida snapshot/hash/TTL e crea un nuovo layer.

`inspect_*` e `prepare_*` non modificano Aseprite. `paletteMode` vale `auto` per default: usa la palette adattiva sorgente su documenti vuoti o compatibili e quella corrente sugli incompatibili. `current` e `extract` forzano le due policy; `extract` fallisce se un colore RGBA già usato manca dalla palette sorgente. `maxColors` è opzionale (`1–256`, trasparenza inclusa): 4 a 16px, 8 a 32/64px, 16 a 128px. Ogni `prepare_*` restituisce preview PNG e metadata (`candidateId`, bounds, pixel modificati, hash, scadenza), con istruzione di chiedere approvazione. `commit_edit` è separato, non idempotente e Undo-safe.

`get_connection_info` è read-only e idempotente, disponibile prima del pairing e non attiva lo stato `Processing`. La skill `$connection` mostra i valori e guida a **File → Scripts → Connect CLI AI Editor**.

`read_snapshot`, `confirm_mask` e `apply_diff` restano protocollo bridge interno ma non sono pubblicati via MCP. Anche `begin_agent_edit` e `submit_agent_png` restano implementazione interna/legacy non discoverable.

## Input e provider

`AI_EDITOR_IMAGE_INPUT_DIR` definisce la root import (default directory di avvio). Il server rifiuta traversal, file esterni, symlink, file non regolari, estensioni non PNG, PNG corrotti, file oltre 8 MiB e immagini oltre `1024×1024`.

`prepare_prompt_generation` usa `fetch` nativo verso `/v1/images/generations`. Richiede `OPENAI_API_KEY`; `OPENAI_IMAGE_MODEL` default `gpt-image-2`. Richiede un solo PNG base64 e converte errori HTTP/rete/timeout in `provider_unavailable`; configurazione o risposta invalida in `validation_failed`. Nessun segreto viene loggato.

Esempi:

- “Importa `/workspace/hero.png` nella selezione.” → `prepare_image_import` → mostra preview → conferma → `commit_edit`.
- “Genera uno slime verde 32×32 nella selezione.” → `prepare_prompt_generation` → mostra preview → conferma → `commit_edit`.
- Documento vuoto → `prepare_prompt_generation({prompt,paletteMode:"auto"})` → mostra preview e palette → conferma → `commit_edit`.

## Sicurezza e stato

`BridgeServer` ascolta solo `127.0.0.1`, accetta una connessione, usa nonce monouso, ID di correlazione, timeout 10 s e limite 1 MiB. Il processo chiude MCP e WebSocket e libera la porta su EOF/chiusura stdin, chiusura notificata dal transport MCP, `SIGTERM`, `SIGINT` o `SIGHUP`. Ogni avvio crea un nuovo bridge con nuovo nonce.

Una nuova chat non implica necessariamente una nuova connessione MCP: dipende dal client. Con porta fissa predefinita `32123`, il client deve riusare o terminare il bridge precedente. Per processi distinti senza EOF o segnali, configurare `AI_EDITOR_PORT=0`: il sistema assegna una porta libera; inserire nel plugin porta e nonce stampati su stderr.

Premendo **Connect** con nuovo pairing, il plugin chiude eventuale WebSocket precedente e usa nuova porta e nuovo nonce.

Stati restituiti da `get_connection_info`:

- `awaiting_pairing`: nonce ancora utilizzabile;
- `connected`: plugin associato;
- `disconnected`: pairing consumato e plugin non più connesso; riavviare il server MCP per ottenere un nuovo nonce.

Token, frame, UUID layer, palette e maschera restano congelati. Il PNG non fidato viene convertito localmente in Candidate palette-indexed; anteprima, palette proposta e diff condividono Candidate/hash. `commit_edit` consuma sempre ID, rivalida anche documento vuoto e rifiuta stato stale prima della scrittura.
