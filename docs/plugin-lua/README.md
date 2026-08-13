# Plugin Lua

## Scopo

Collegare in modo controllato il sistema ad Aseprite e applicare al documento aperto soltanto operazioni dichiarative validate.

## Responsabilità

- ricevere operazioni dal [[../server-mcp/README|Server MCP]];
- verificare precondizioni legate allo stato effettivo del documento;
- usare le API Aseprite per modificare sprite, frame, layer e selezioni;
- raggruppare le modifiche in transazioni compatibili con undo;
- aggiornare e rendere visibile il documento aperto;
- restituire stato, risultati ed errori al server.

## Input

- operazioni dichiarative versionate e validate;
- identificatori e precondizioni sul documento corrente;
- richiesta di lettura dello stato necessario.

## Output

- documento Aseprite aggiornato;
- esito delle operazioni;
- stato minimo richiesto dal server;
- errori di precondizione o delle API.

## Dipendenze

- [Aseprite](https://www.aseprite.org/) e API Lua supportate;
- [[../protocollo-dati/README|Protocollo Dati]];
- trasporto locale o remoto ancora da scegliere.

## Fuori ambito

- interpretare richieste in linguaggio naturale;
- correggere decisioni artistiche;
- accettare o eseguire Lua arbitrario;
- sostituire la validazione strutturale del server.

## Decisioni aperte

- API Aseprite effettivamente disponibili per ogni operazione;
- trasporto e modello di connessione;
- granularità delle transazioni e comportamento su errore parziale;
- quantità e frequenza dello stato restituito.
