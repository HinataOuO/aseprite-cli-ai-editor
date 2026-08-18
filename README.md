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

Installa `plugin/` da **Edit → Preferences → Extensions → Add Extension** (zip rinominato `.aseprite-extension`, oppure cartella in `extensions`). In Pi il server MCP viene avviato automaticamente dall’estensione: non eseguire `npm start`. Esegui `/reload`, quindi nel pannello modeless **AI Editor** inserisci porta `32123` e nonce mostrati da Pi e premi **Connect**. Il pannello mostra pallino e testo `Connected`/`Disconnected`, oltre all'attività `Unavailable`/`Ready`/`Processing...` per l'intero comando MCP. Dopo il pairing porta, nonce e **Connect** lasciano posto a **Disconnect**, che chiude solo il WebSocket del plugin e ripristina i controlli di connessione senza terminare Node/MCP. La porta viene ricordata, il nonce no. Se chiudi il pannello, **File → Scripts → Connect CLI AI Editor** o **Show AI Editor Status** lo riaprono.

## Provider

Configura il provider OpenAI-compatible con `AI_EDITOR_PROVIDER_URL` e `AI_EDITOR_MODEL`; sono opzionali `AI_EDITOR_API_KEY` e `AI_EDITOR_MODEL_VERSION`. Endpoint loopback funzionano senza consenso cloud. Per endpoint remoti impostare esplicitamente `AI_EDITOR_CLOUD_CONSENT=1`; le credenziali restano in ambiente e non vengono loggate. Il fake provider è solo per test. I tre tentativi condividono un budget di generazione di 110 secondi: alla scadenza la richiesta HTTP viene annullata e torna un errore `timeout`.

## Limiti MVP

- sprite quadrati `16×16`, `32×32`, `64×64`;
- modalità Indexed/RGB, palette singola;
- niente grayscale, tilemap, reference layer o layer bloccati;
- frame corrente; un layer di default, più layer solo con UUID espliciti e conferma;
- `prepare_edit` produce anteprima e ID monouso; chiamare `commit_edit` solo dopo conferma utente;
- l'ID scade dopo cinque minuti e viene invalidato a ogni tentativo di commit;
- massimo tre tentativi di generazione entro un unico budget di 110 secondi;
- i diff accettano `changes` puntuali e `spans` orizzontali compatti, fino a 4096 pixel espansi.

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
| `tests/lua/apply-diff.lua` | headless | apply Indexed/RGB, `changes`/`spans`, cerchio e fill 64×64, rollback, bordi, stale state e singolo Undo |
| `tests/lua/undo.lua` | headless | caso braccio 32×32, linked cel, isolamento layer/frame, singolo Undo e batch invalido |
| `tests/*.test.ts`, `tests/e2e/*.test.ts` | Node | protocollo, pipeline, retry, limiti, bridge e MCP |
| pairing, `confirm_mask` | GUI manuale | WebSocket/plugin e correzione pixel-per-pixel |

Aseprite non offre un costruttore Lua pubblico per documenti multi-palette. Per validare un fixture reale:

```sh
aseprite -b --script-param multiplePalette=/path/multi-palette.aseprite --script tests/lua/read-state.lua
```

### Smoke test GUI/WebSocket

1. Avvia `AI_EDITOR_PORT=0 npm start`; annota porta e nonce da stderr. Il pannello **AI Editor** deve mostrare pallino rosso, `Disconnected` e `Unavailable`.
2. Inserisci porta e nonce nel pannello unico (riapribile da **File → Scripts → Connect CLI AI Editor**) e premi **Connect**. Con il nonce corretto deve mostrare soltanto **Disconnect**, pallino verde, `Connected` e `Ready`. Premi **Disconnect**: il socket deve chiudersi senza arrestare Node/MCP né mostrare un errore, e porta, nonce e **Connect** devono ricomparire con `Disconnected` e `Unavailable`. Riconnettiti, quindi arresta Node: deve tornare a `Disconnected` e `Unavailable` mostrando l'errore. Porta non intera/fuori range e nonce vuoto devono essere rifiutati nel pannello. Ripeti con nonce errato, replay e seconda connessione: devono essere rifiutati.
3. Tramite client MCP chiama `prepare_edit`, conferma visivamente l'anteprima, poi `commit_edit`; lo stato deve essere `Processing...` dall'inizio del comando, inclusa l'attesa AI, e tornare sempre a `Ready`, anche su errore. Usa `read_snapshot`, `confirm_mask` e `apply_diff` soltanto per diagnosi. In `confirm_mask`, modifica la selezione e prova sia conferma sia annullamento (`confirmation_required`, sprite invariato).
4. Leggi uno snapshot, modifica a mano pixel/palette/frame/layer/selezione e invia il vecchio diff: atteso `stale_snapshot`, nessuna scrittura.
5. Verifica disconnessione e timeout. Registra versione Aseprite, modalità, esito e passi riproducibili per ogni difetto.

Risultato locale corrente: baseline Node superata; matrice Aseprite non eseguita perché il binario non è disponibile nell’ambiente.

Documentazione: [protocollo](docs/protocollo-dati/README.md), [flusso](docs/flusso-end-to-end/README.md), [plugin](docs/plugin-lua/README.md), [server](docs/server-mcp/README.md).
