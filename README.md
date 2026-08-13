# Aseprite CLI AI Editor

## Scopo

Definire un sistema con cui un utente possa generare o modificare contenuti in Aseprite tramite un agente AI da riga di comando, mantenendo Aseprite come applicazione esterna.

## Responsabilità

Questo documento indicizza la visione, i componenti e il flusso del progetto senza fissare ancora codice, trasporto o protocollo.

## Input

- richiesta visiva dell'utente;
- contesto leggibile del documento Aseprite corrente.

## Output

Operazioni dichiarative validate che il plugin applica al documento aperto, con stato o errori restituiti all'agente.

## Dipendenze

- [Aseprite](https://www.aseprite.org/) (`[[Aseprite]]`), dipendenza esterna;
- un agente CLI compatibile con MCP;
- API Lua di Aseprite.

## Fuori ambito

- sostituire Aseprite;
- eseguire Lua arbitrario generato dall'AI;
- definire in questa fase implementazione e schema definitivi.

## Decisioni aperte

- trasporto tra server MCP e plugin;
- significato misurabile di “tempo reale”;
- rappresentazione di pixel, forme e immagini;
- accesso allo stato corrente di Aseprite.

## Flusso generale

1. L'utente descrive il risultato o la modifica all'[[docs/agente-ai-cli/README|Agente Ai Cli]].
2. L'[[docs/agente-ai-cli/agente-art-director|Agente Art Director]] traduce l'intento visivo in una richiesta strutturata.
3. Il [[docs/server-mcp/README|Server MCP]] valida e riduce la richiesta a operazioni dichiarative.
4. Il [[docs/plugin-lua/README|Plugin Lua]] applica le operazioni tramite le API di Aseprite.
5. Stato, risultati o errori tornano all'agente.

Dettaglio: [[docs/flusso-end-to-end/README|Flusso End To End]].

## Componenti

- [[docs/visione/README|Visione]] — problema, esperienza desiderata e confini.
- [[docs/agente-ai-cli/README|Agente Ai Cli]] — interazione con utente e server.
- [[docs/agente-ai-cli/agente-art-director|Agente Art Director]] — interpretazione artistica strutturata.
- [[docs/server-mcp/README|Server MCP]] — strumenti, validazione e comunicazione.
- [[docs/plugin-lua/README|Plugin Lua]] — integrazione controllata con Aseprite.
- [[docs/protocollo-dati/README|Protocollo Dati]] — contratto dichiarativo ancora da definire.
- [[docs/flusso-end-to-end/README|Flusso End To End]] — scenari principali.

## Stato di progettazione

Scheletro documentale iniziale. Nessun componente sorgente, protocollo definitivo o scelta di trasporto è stato approvato. La prossima sezione da sviluppare, una alla volta, è [[docs/protocollo-dati/README|Protocollo Dati]].

Piano approvato: [[docs/PIANO-MVP|Pipeline ibrida MVP]].
