# Flusso End To End

## Scopo

Descrivere i due percorsi iniziali del sistema senza trasformarli in un protocollo definitivo.

## Responsabilità

### Prima generazione

1. L'utente descrive il disegno all'[[../agente-ai-cli/README|Agente Ai Cli]].
2. L'[[../agente-ai-cli/agente-art-director|Agente Art Director]] raccoglie i vincoli e chiede solo i chiarimenti indispensabili.
3. L'agente invia una richiesta strutturata al [[../server-mcp/README|Server MCP]].
4. Il server valida e traduce la richiesta in operazioni dichiarative.
5. Il [[../plugin-lua/README|Plugin Lua]] applica le operazioni in una transazione Aseprite compatibile con undo.
6. Plugin e server restituiscono stato, risultato o errori; l'agente li presenta all'utente.

### Modifica puntuale

1. L'utente indica il risultato esistente, l'area da cambiare e ciò che deve restare invariato.
2. L'agente legge solo il contesto necessario di sprite, frame, layer o selezione.
3. L'Art Director struttura la differenza richiesta e le precondizioni.
4. Il server valida destinazioni e operazioni, rifiutando riferimenti obsoleti o ambigui.
5. Il plugin applica la modifica in una transazione annullabile e aggiorna il documento aperto.
6. Lo stato aggiornato torna all'utente per un'eventuale iterazione.

## Input

- richiesta iniziale o modifica puntuale;
- contesto del documento corrente;
- vincoli artistici e operativi.

## Output

Un documento aggiornato in Aseprite e un esito strutturato, oppure un errore utilizzabile per correggere o ripetere la richiesta.

## Dipendenze

- responsabilità separate dei tre livelli;
- [[../protocollo-dati/README|Protocollo Dati]] condiviso;
- transazioni e undo disponibili nel plugin;
- trasporto operativo tra server e plugin.

## Fuori ambito

- dettaglio delle chiamate API;
- schema definitivo dei messaggi;
- prestazioni garantite;
- gestione multiutente o distribuita.

## Decisioni aperte

- punti di conferma dell'utente;
- comportamento in caso di documento cambiato durante il flusso;
- quantità di contesto necessaria nei due scenari;
- criterio di completamento e latenza attesa di ogni iterazione.
