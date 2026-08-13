# Agente AI CLI

## Scopo

Integrare Claude Code, Codex, Pi o agenti equivalenti con il progetto tramite strumenti MCP, senza legare il flusso a un singolo fornitore.

## Responsabilità

- raccogliere la richiesta dell'utente e gli eventuali chiarimenti;
- leggere il contesto corrente reso disponibile dal sistema;
- usare l'[[agente-art-director|Agente Art Director]] per strutturare l'intento visivo;
- inviare la richiesta al [[../server-mcp/README|Server MCP]];
- presentare risultati, stato ed errori in modo comprensibile.

## Input

- descrizione in linguaggio naturale;
- riferimenti a sprite, frame, layer o selezioni;
- contesto corrente restituito dal server e dal plugin;
- preferenze artistiche esplicite.

## Output

Una richiesta strutturata per il server MCP e, dopo l'esecuzione, un resoconto per l'utente.

## Dipendenze

- agente CLI capace di usare MCP;
- strumenti esposti dal server;
- contesto leggibile del documento Aseprite.

## Fuori ambito

- chiamare direttamente le API Aseprite;
- applicare modifiche al documento;
- validare il protocollo al posto del server;
- generare o inoltrare Lua arbitrario.

## Decisioni aperte

- quantità minima di contesto da leggere per richiesta;
- strategia di conferma prima di operazioni ampie;
- formato esatto della richiesta strutturata;
- modalità di supporto dei diversi agenti CLI.
