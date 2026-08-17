# Aseprite CLI AI Editor — MVP

Server MCP Node/TypeScript e plugin Aseprite Lua per modifiche pixel dichiarative, limitate da selezione, palette e snapshot. Aseprite resta autorità e ogni applicazione è una transazione undo.

## Requisiti e installazione

- Node.js 20+
- Aseprite 1.3.0+

```sh
npm install
npm run build
npm test
```

Installa `plugin/` da **Edit → Preferences → Extensions → Add Extension** (zip rinominato `.aseprite-extension`, oppure cartella in `extensions`). In Pi il server MCP viene avviato automaticamente dall’estensione: non eseguire `npm start`. Esegui `/reload`, quindi apri **File → Scripts → Connect CLI AI Editor** in Aseprite e inserisci porta `32123` e nonce mostrati da Pi.

## Provider

L'adapter `OpenAICompatibleProvider` accetta `baseUrl`, modello, versione e API key. Endpoint loopback funzionano senza consenso cloud. Per endpoint remoti impostare esplicitamente `AI_EDITOR_CLOUD_CONSENT=1`; le credenziali restano in ambiente e non vengono loggate. Il fake provider è solo per test.

## Limiti MVP

- sprite quadrati `16×16`, `32×32`, `64×64`;
- modalità Indexed/RGB, palette singola;
- niente grayscale, tilemap, reference layer o layer bloccati;
- frame corrente; un layer di default, più layer solo con UUID espliciti e conferma;
- conferma sempre obbligatoria finché score e modello/versione non sono calibrati;
- massimo tre tentativi.

## Privacy e recovery

Al provider va soltanto crop minimo PNG, maschera, palette e intento minimo. Cache e campioni JSONL sono locali, content-addressed, soggetti a retention e cancellabili con `LocalStore.clear()`; immagini complete e credenziali sono rifiutate. Il bridge ascolta soltanto `127.0.0.1`, usa un nonce monouso e limita i messaggi a 1 MiB.

Su `stale_snapshot`, riconnettere/rileggere lo stato e confermare una nuova maschera. Su errore d'applicazione la transazione viene annullata; un solo Undo ripristina una modifica riuscita.

## Verifica con Aseprite reale

Prerequisiti: `aseprite` nel `PATH`, versione `>=1.3.0`. Il comando unico esegue baseline Node e matrice Lua headless:

```sh
npm run verify
```

Comandi separati, utili per isolare un difetto:

```sh
npm run build
npm test
aseprite -b --script tests/lua/read-state.lua
aseprite -b --script tests/lua/apply-diff.lua
aseprite -b --script tests/lua/undo.lua
```

| Script/test | Modalità | Copertura |
|---|---|---|
| `tests/lua/read-state.lua` | headless | 16/32/64, Indexed/RGB, crop e selezione irregolare, cel traslato/assente, token, documenti non supportati |
| `tests/lua/apply-diff.lua` | headless | apply Indexed/RGB, trasparenza, espansione cel, bordi, stale state e preflight atomico |
| `tests/lua/undo.lua` | headless | caso braccio 32×32, linked cel, isolamento layer/frame, singolo Undo e batch invalido |
| `tests/*.test.ts`, `tests/e2e/*.test.ts` | Node | protocollo, pipeline, retry, limiti, bridge e MCP |
| pairing, `confirm_mask` | GUI manuale | WebSocket/plugin e correzione pixel-per-pixel |

Aseprite non offre un costruttore Lua pubblico per documenti multi-palette. Per validare un fixture reale:

```sh
aseprite -b --script-param multiplePalette=/path/multi-palette.aseprite --script tests/lua/read-state.lua
```

### Smoke test GUI/WebSocket

1. Avvia `AI_EDITOR_PORT=0 npm start`; annota porta e nonce da stderr.
2. Installa `plugin/`, poi **File → Scripts → Connect CLI AI Editor**. Verifica nonce corretto; quindi nonce errato, replay e seconda connessione (rifiutati).
3. Tramite client MCP chiama `read_snapshot`, `confirm_mask` e `apply_diff`; confronta risposta/canvas. In `confirm_mask`, modifica la selezione e prova sia conferma sia annullamento (`confirmation_required`, sprite invariato).
4. Leggi uno snapshot, modifica a mano pixel/palette/frame/layer/selezione e invia il vecchio diff: atteso `stale_snapshot`, nessuna scrittura.
5. Verifica disconnessione e timeout. Registra versione Aseprite, modalità, esito e passi riproducibili per ogni difetto.

Risultato locale corrente: baseline Node superata; matrice Aseprite non eseguita perché il binario non è disponibile nell’ambiente.

Documentazione: [protocollo](docs/protocollo-dati/README.md), [flusso](docs/flusso-end-to-end/README.md), [plugin](docs/plugin-lua/README.md), [server](docs/server-mcp/README.md).
